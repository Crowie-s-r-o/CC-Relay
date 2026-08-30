import { EventEmitter } from 'node:events';
import { now } from './database.mjs';
import { captureTaskDiffBaseline } from './task-diff.mjs';
import { taskTitleFromInput } from './task-title.mjs';
import { isTurboExecutionSession } from './task-continuation.mjs';

const RETRYABLE_STATUSES = new Set(['failed', 'cancelled', 'interrupted']);
const FOLLOW_UP_SOURCE_STATUSES = new Set(['open', 'complete', 'failed', 'cancelled', 'interrupted']);
const FOLLOW_UP_ERROR_PREFIX = 'Same-session follow-up';
const MANUAL_SESSION_CLOSE_CONFIRMATIONS = 2;
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function providerName(provider) {
  if (provider === 'opencode') return 'OpenCode';
  return provider === 'claude' ? 'Claude' : 'Codex';
}

export function isManualSessionTask(task) {
  return task?.manual_completion === true
    && task?.keep_terminal_open === true
    && task?.terminal_lifecycle === 'disposable'
    && task?.mode === 'execute'
    && ['codex', 'claude'].includes(task?.provider);
}

export class TaskQueue extends EventEmitter {
  constructor({
    database,
    artifacts,
    runner,
    retryDelayMs = 5000,
    maxAutomaticRetries = 3,
    isThreadAvailable = () => true,
    listIdleSessions = null,
    terminalPool = null,
    dispatchWait = wait,
    dispatchPollMs = 1_000,
    captureDiffBaseline = captureTaskDiffBaseline,
  }) {
    super();
    this.database = database;
    this.artifacts = artifacts;
    this.runner = runner;
    this.activeTasks = new Map();
    this.activePreparations = new Map();
    this.scheduling = false;
    this.stopping = false;
    this.retryDelayMs = retryDelayMs;
    this.maxAutomaticRetries = maxAutomaticRetries;
    this.isThreadAvailable = isThreadAvailable;
    this.listIdleSessions = listIdleSessions;
    this.terminalPool = terminalPool;
    this.dispatchWait = dispatchWait;
    this.dispatchPollMs = dispatchPollMs;
    this.captureDiffBaseline = captureDiffBaseline;
    // A Claude task whose selected terminal is externally busy stays queued here until the
    // terminal is idle or idle routing finds another destination. Codex still uses this map
    // for its short routing window after beginTask. In both cases no runner owns the task yet,
    // so cancellation has to be represented by this guard.
    this.dispatchGuards = new Map();
    this.retryTimers = new Map();
    this.automaticRetryCounts = new Map();
    this.tokenUsageAttemptStarts = new Map();
    this.manualSessionTerminalMisses = new Map();
  }

  taskThreadIds(task) {
    const ids = new Set();
    const directThreadId = task?.thread_id || task?.thread?.id;
    if (directThreadId) ids.add(directThreadId);
    if (task?.author_thread_id) ids.add(task.author_thread_id);
    const turbo = task?.turbo || {};
    const plannerThreadId = turbo.plannerThreadId || turbo.planner?.threadId;
    if (plannerThreadId) ids.add(plannerThreadId);
    if (turbo.executionThreadId) ids.add(turbo.executionThreadId);
    for (const worker of turbo.workers || []) {
      if (worker?.threadId) ids.add(worker.threadId);
    }
    return [...ids];
  }

  disposableConversationId(task) {
    const lifecycle = task?.terminal_lifecycle || task?.terminalLifecycle;
    if (
      lifecycle !== 'disposable'
      || task?.mode !== 'execute'
      || !['codex', 'claude', 'opencode'].includes(task?.provider)
    ) return null;
    return task.thread_id || task.thread?.id || null;
  }

  disposableConversationConflict(task, { excludeTaskId = null } = {}) {
    const threadId = this.disposableConversationId(task);
    if (!threadId) return null;
    return this.database.listTasks().find((candidate) => (
      candidate.id !== excludeTaskId
      && candidate.provider === task.provider
      && candidate.thread_id === threadId
      && ['queued', 'running'].includes(candidate.status)
    )) || null;
  }

  taskHasUnavailableThread(task) {
    return this.taskThreadIds(task).some((threadId) => !this.isThreadAvailable(threadId));
  }

  stageTaskAttachments(taskId, attachments) {
    if (!attachments?.length) return [];
    const task = this.database.getTask(taskId);
    if (!task) throw new Error('Task not found.');
    const stored = this.artifacts.stageAttachments(taskId, attachments, task.attachments);
    this.database.updateTask(taskId, {
      attachments_json: JSON.stringify([...task.attachments, ...stored]),
    });
    return stored;
  }

  commitTaskAttachments(taskId, attachments, heading = 'Follow-up reference images') {
    if (!attachments?.length) return;
    this.artifacts.documentAttachments(taskId, attachments, heading);
    this.database.addEvent(
      taskId,
      'queue',
      `${attachments.length} follow-up reference image${attachments.length === 1 ? '' : 's'} attached.`,
    );
    this.changed(taskId);
  }

  discardTaskAttachments(taskId, attachments) {
    if (!attachments?.length) return;
    const discardedIds = new Set(attachments.map((attachment) => attachment.id));
    const task = this.database.getTask(taskId);
    if (task) {
      this.database.updateTask(taskId, {
        attachments_json: JSON.stringify(task.attachments.filter((attachment) => !discardedIds.has(attachment.id))),
      });
    }
    this.artifacts.discardAttachments(attachments);
  }

  startFollowUp(task, { resumeDisposable = false } = {}) {
    const sourceTask = this.database.getTask(task?.id);
    if (!sourceTask) throw new Error('Task not found.');
    if (typeof task.prompt !== 'string' || !task.prompt.trim()) {
      throw new Error('Write a follow-up before sending it.');
    }
    const turboExecution = isTurboExecutionSession(sourceTask);
    if ((sourceTask.mode !== 'execute' || !['codex', 'claude'].includes(sourceTask.provider)) && !turboExecution) {
      throw new Error('Only direct tasks and completed Turbo execution sessions can continue.');
    }
    if (isManualSessionTask(sourceTask) && sourceTask.status === 'complete') {
      throw new Error('This terminal session task is complete and cannot accept more messages.');
    }
    if (
      sourceTask.thread_id !== task.thread_id
      || sourceTask.provider !== task.provider
      || sourceTask.repo_path !== task.repo_path
    ) {
      throw new Error('The follow-up no longer matches the original terminal session.');
    }
    if (!FOLLOW_UP_SOURCE_STATUSES.has(sourceTask.status)) {
      throw new Error('That task is not ready for a new turn. Your follow-up was not queued.');
    }
    if (this.stopping) {
      throw new Error('CC Relay is stopping. Your follow-up was not queued.');
    }
    if (this.taskHasUnavailableThread(sourceTask)) {
      throw new Error('That terminal is closing. Your follow-up was not queued.');
    }
    if (this.activeTasks.has(sourceTask.id) || this.activePreparations.has(sourceTask.id)) {
      throw new Error('That task still owns active work. Your follow-up was not queued.');
    }
    if (
      resumeDisposable
      && (sourceTask.terminal_lifecycle !== 'disposable' || !this.terminalPool)
    ) {
      throw new Error('CC Relay cannot relaunch this task conversation. Your follow-up was not sent.');
    }

    const targetThreadIds = new Set(this.taskThreadIds(sourceTask));
    if (targetThreadIds.size === 0) {
      throw new Error('The original terminal session is unavailable. Your follow-up was not queued.');
    }
    const threadConflict = this.database.listTasks().find((candidate) => (
      candidate.id !== sourceTask.id
      && ['queued', 'running'].includes(candidate.status)
      && this.taskThreadIds(candidate).some((threadId) => targetThreadIds.has(threadId))
    ));
    if (threadConflict || [...this.reservedThreadIds()].some((threadId) => targetThreadIds.has(threadId))) {
      throw new Error('That terminal already has active or queued work. Your follow-up was not queued.');
    }
    if (
      resumeDisposable
      && !this.terminalPool.canRun(task, [...this.activeTasks.values()])
    ) {
      throw new Error('No terminal slot is free for this conversation. Finish active work, then send again. Your follow-up was not queued.');
    }
    this.clearAutoRetry(sourceTask.id);
    const storedAttachments = this.stageTaskAttachments(sourceTask.id, task.attachments);
    const runtimeTask = { ...task, attachments: storedAttachments, sessionFollowUp: true };
    this.commitTaskAttachments(sourceTask.id, storedAttachments);
    const userEvent = {
      type: 'item/completed',
      provider: sourceTask.provider,
      item: {
        id: `relay-follow-up-${sourceTask.id}-${Date.now()}`,
        type: 'userMessage',
        content: [
          { type: 'text', text: task.prompt },
          ...storedAttachments.map((attachment) => ({ type: 'localImage', path: attachment.path })),
        ],
      },
    };
    this.artifacts.appendRawEvent(sourceTask.id, userEvent);
    this.database.addEvent(
      sourceTask.id,
      'queue',
      resumeDisposable
        ? 'Follow-up dispatch requested in the same task. CC Relay will relaunch its saved conversation without creating a queue task.'
        : 'Follow-up dispatch requested for immediate same-session execution. It will not be queued.',
    );
    this.database.addEvent(sourceTask.id, sourceTask.provider, task.prompt, userEvent);
    this.beginTask(runtimeTask, { sessionFollowUp: true });
    void this.executeTask(runtimeTask, {
      sessionFollowUp: true,
      prepareDisposable: resumeDisposable,
    });
    return this.database.getTask(sourceTask.id);
  }

  start() {
    this.database.recoverInterruptedTasks();
    this.schedule();
  }

  status(repoPath = null) {
    const activeTaskIds = [...this.activeTasks.keys()];
    const planningTaskIds = [...this.activePreparations.keys()];
    const reviewingTaskIds = [...this.activePreparations.entries()]
      .filter(([, entry]) => entry.councilStage === 'reviewing')
      .map(([taskId]) => taskId);
    const activeTasks = [...this.activeTasks.values()];
    return {
      paused: this.database.isPaused() || (repoPath ? this.database.isProjectPaused(repoPath) : false),
      pausedProjectPaths: this.database.pausedProjectPaths(),
      activeTaskId: activeTaskIds[0] || null,
      activeTaskIds,
      planningTaskIds,
      reviewingTaskIds,
      ...(repoPath && this.terminalPool
        ? { terminalPool: { repoPath, ...this.terminalPool.projectStatus(repoPath, activeTasks) } }
        : {}),
    };
  }

  enqueue(input) {
    const { attachments = [], runNow = false, submissionId = null, ...taskInput } = input;
    const existing = this.database.getTaskBySubmissionId(submissionId);
    if (existing) {
      const sameSubmission = existing.prompt === taskInput.prompt
        && existing.title === taskInput.title
        && existing.mode === (taskInput.mode || 'execute')
        && existing.provider === (taskInput.provider || 'codex');
      if (!sameSubmission) {
        throw new Error('That submission ID was already used for different work.');
      }
      return existing;
    }
    if (this.disposableConversationConflict(taskInput)) {
      throw new Error('This conversation already has queued or running work.');
    }
    if (this.taskHasUnavailableThread(taskInput)) {
      throw new Error('That terminal is closing. Choose another CC Relay before adding work.');
    }
    let task = this.database.createTask({ ...taskInput, submissionId, priority: runNow });
    try {
      this.artifacts.initializeTask(task);
      const storedAttachments = this.artifacts.writeAttachments(task.id, attachments);
      if (storedAttachments.length > 0) {
        task = this.database.updateTask(task.id, {
          attachments_json: JSON.stringify(storedAttachments),
        });
        this.database.addEvent(
          task.id,
          'queue',
          `${storedAttachments.length} reference image${storedAttachments.length === 1 ? '' : 's'} attached.`,
        );
      }
    } catch (error) {
      this.database.deleteTask(task.id);
      this.artifacts.deleteTask(task.id, { repoPath: task.repo_path });
      throw error;
    }
    if (runNow) {
      this.database.addEvent(task.id, 'queue', 'Priority submission placed ahead of waiting tasks.');
    }
    this.changed(task.id);
    this.schedule();
    return task;
  }

  pause(repoPath) {
    if (repoPath) this.database.setProjectPaused(repoPath, true);
    else this.database.setPaused(true);
    this.changed();
  }

  resume(repoPath) {
    if (repoPath) this.database.setProjectPaused(repoPath, false);
    else this.database.setPaused(false);
    this.changed();
    this.schedule();
  }

  cancel(taskId) {
    this.clearAutoRetry(taskId);
    this.automaticRetryCounts.delete(taskId);
    const task = this.database.getTask(taskId);
    if (!task) {
      throw new Error('Task not found.');
    }

    if (task.status === 'queued') {
      const dispatchGuard = this.dispatchGuards.get(taskId);
      if (dispatchGuard) dispatchGuard.cancelRequested = true;
      if (this.activePreparations.has(taskId)) {
        this.database.addEvent(taskId, 'queue', 'Cancellation requested for the active forward planner.');
        if (!this.runner.cancel(taskId)) throw new Error('The planning process is no longer running.');
      }
      this.database.updateTask(taskId, {
        status: 'cancelled',
        finished_at: now(),
        error: 'Task cancelled before it started.',
      });
      this.database.addEvent(taskId, 'queue', 'Queued task cancelled.');
      this.artifacts.writeError(taskId, 'Task cancelled before it started.');
      this.changed(taskId);
      return;
    }

    if (task.status !== 'running' || !this.activeTasks.has(taskId)) {
      throw new Error('Only queued or running tasks can be cancelled.');
    }

    this.database.addEvent(taskId, 'queue', 'Cancellation requested.');
    // The task is running but is still inside the idle-routing window, so no runner owns it
    // yet. Without this branch the user sees a visibly running task refuse to cancel with
    // "The AI process is no longer running."
    const guard = this.dispatchGuards.get(taskId);
    if (guard) {
      guard.cancelRequested = true;
      this.changed(taskId);
      return;
    }
    if (!this.runner.cancel(taskId)) {
      throw new Error('The AI process is no longer running.');
    }
    this.changed(taskId);
  }

  keepTerminalOpen(taskId) {
    const task = this.database.getTask(taskId);
    if (!task) {
      throw new Error('Task not found.');
    }
    if (task.status !== 'running') {
      throw new Error('Only a running task can stop terminal auto-close.');
    }
    if (!this.activeTasks.has(taskId)) {
      throw new Error('That task is no longer active in this CC Relay process.');
    }
    if (task.terminal_lifecycle !== 'disposable') {
      throw new Error('This task uses a persistent terminal, so automatic close does not apply.');
    }
    if (task.provider === 'opencode') {
      throw new Error('OpenCode runs headlessly and has no terminal window to keep open.');
    }
    if (task.keep_terminal_open === true) return task;

    const updated = this.database.updateTask(taskId, { keep_terminal_open: 1 });
    const activeTask = this.activeTasks.get(taskId);
    if (activeTask) {
      this.activeTasks.set(taskId, { ...activeTask, keep_terminal_open: true });
    }
    const guard = this.dispatchGuards.get(taskId);
    if (guard?.task) {
      guard.task = { ...guard.task, keep_terminal_open: true };
    }
    const target = ['plan', 'turbo'].includes(task.mode) ? 'terminals' : 'terminal';
    this.database.addEvent(
      taskId,
      'queue',
      `Automatic close stopped. CC Relay will keep this task's ${target} open after the run.`,
    );
    this.changed(taskId);
    return updated;
  }

  completeSession(taskId) {
    const task = this.database.getTask(taskId);
    if (!task) {
      throw new Error('Task not found.');
    }
    if (!isManualSessionTask(task)) {
      throw new Error('Only a terminal session task can be completed manually.');
    }
    if (task.status !== 'open' || this.activeTasks.has(taskId)) {
      throw new Error('Wait for the current session turn to finish before completing this task.');
    }
    return this.finishManualSession(
      task,
      'Terminal session completed manually. This does not close any retained terminal.',
    );
  }

  completeSessionAfterTerminalClose(taskId) {
    const task = this.database.getTask(taskId);
    if (
      !isManualSessionTask(task)
      || task.status !== 'open'
      || this.activeTasks.has(taskId)
    ) return null;
    return this.finishManualSession(
      task,
      'Terminal session completed automatically after its retained terminal closed.',
    );
  }

  finishManualSession(task, eventMessage) {
    const updated = this.database.updateTask(task.id, {
      status: 'complete',
      finished_at: now(),
      error: null,
    });
    if (task.result) this.artifacts.writeResult(task.id, task.result);
    this.database.addEvent(task.id, 'queue', eventMessage);
    this.manualSessionTerminalMisses.delete(task.id);
    this.changed(task.id);
    return updated;
  }

  reconcileManualSessionTerminals(threads, {
    authoritativeProviders = [],
    observationId = null,
  } = {}) {
    const authoritative = new Set(authoritativeProviders);
    const liveThreadKeys = new Set((threads || [])
      .filter((thread) => thread?.id && ['codex', 'claude'].includes(thread?.provider))
      .map((thread) => `${thread.provider}:${thread.id}`));
    const candidates = this.database.listTasks().filter((task) => (
      task.status === 'open'
      && Boolean(task.thread_id)
      && isManualSessionTask(task)
    ));
    const candidateIds = new Set(candidates.map((task) => task.id));
    for (const taskId of this.manualSessionTerminalMisses.keys()) {
      if (!candidateIds.has(taskId)) this.manualSessionTerminalMisses.delete(taskId);
    }
    if (observationId === null || observationId === undefined) return [];

    const completed = [];
    for (const task of candidates) {
      if (!authoritative.has(task.provider)) continue;
      if (liveThreadKeys.has(`${task.provider}:${task.thread_id}`)) {
        this.manualSessionTerminalMisses.delete(task.id);
        continue;
      }
      const previous = this.manualSessionTerminalMisses.get(task.id);
      if (previous?.observationId === observationId) continue;
      const misses = (previous?.misses || 0) + 1;
      this.manualSessionTerminalMisses.set(task.id, { misses, observationId });
      if (misses < MANUAL_SESSION_CLOSE_CONFIRMATIONS) continue;
      const finished = this.completeSessionAfterTerminalClose(task.id);
      if (finished) completed.push(finished);
    }
    return completed;
  }

  retry(taskId, {
    automatic = false,
    reuseRetainedTerminal = false,
    execution = null,
  } = {}) {
    this.clearAutoRetry(taskId);
    if (!automatic) this.automaticRetryCounts.delete(taskId);
    const task = this.database.getTask(taskId);
    if (!task) {
      throw new Error('Task not found.');
    }
    if (!RETRYABLE_STATUSES.has(task.status)) {
      throw new Error('Only failed, cancelled, or interrupted tasks can be retried.');
    }
    if (String(task.error || '').startsWith(FOLLOW_UP_ERROR_PREFIX)) {
      throw new Error('Use Continue session to send that follow-up again. It cannot be placed in the task queue.');
    }
    const executionRequested = execution !== null && execution !== undefined;
    if (executionRequested && automatic) {
      throw new Error('Automatic retries cannot change executor or effort.');
    }
    if (
      executionRequested
      && (task.mode !== 'execute' || task.terminal_lifecycle !== 'disposable')
    ) {
      throw new Error('Only automatic Execute tasks can change executor or effort when retrying.');
    }
    const nextProvider = executionRequested
      ? String(execution?.provider || '').trim()
      : task.provider;
    if (executionRequested && !['codex', 'claude', 'opencode'].includes(nextProvider)) {
      throw new Error(`Unsupported AI provider: ${nextProvider}`);
    }
    const optionalSetting = (value, label) => {
      if (value === null || value === undefined || value === '') return null;
      if (typeof value !== 'string') throw new Error(`${label} must be text.`);
      return value.trim() || null;
    };
    const nextModel = executionRequested ? optionalSetting(execution.model, 'Model') : task.model;
    const nextEffort = executionRequested ? optionalSetting(execution.effort, 'Effort') : task.effort;
    const providerChanged = nextProvider !== task.provider;
    const executionChanged = executionRequested && (
      providerChanged || nextModel !== task.model || nextEffort !== task.effort
    );
    if (!providerChanged && this.disposableConversationConflict(task, { excludeTaskId: task.id })) {
      throw new Error('This conversation already has queued or running work.');
    }
    if (!providerChanged && this.taskHasUnavailableThread(task)) {
      throw new Error('That terminal is closing. Retry after choosing another CC Relay.');
    }
    if (reuseRetainedTerminal && providerChanged) {
      throw new Error('Changing executors requires a fresh terminal for this retry.');
    }
    if (
      reuseRetainedTerminal
      && (
        task.terminal_lifecycle !== 'disposable'
        || task.keep_terminal_open !== true
        || task.mode !== 'execute'
      )
    ) {
      throw new Error('Only a retained direct task can retry in its open terminal.');
    }

    const tasks = this.database.listTasks().filter((item) => item.repo_path === task.repo_path);
    const maxPosition = tasks.reduce((maximum, item) => Math.max(maximum, item.position), 0);
    const updated = this.database.updateRetryableTask(taskId, {
      status: 'queued',
      position: maxPosition + 1,
      started_at: null,
      finished_at: null,
      session_id: null,
      result: null,
      error: null,
      exit_code: null,
      ...(executionRequested ? {
        provider: nextProvider,
        model: nextModel,
        effort: nextEffort,
      } : {}),
      ...(providerChanged ? {
        thread_id: null,
        thread_name: null,
        thread_source: null,
        continued_from_task_id: null,
      } : {}),
      ...(nextProvider === 'opencode' ? {
        keep_terminal_open: 0,
        manual_completion: 0,
      } : {}),
    });
    if (executionChanged) {
      try {
        this.artifacts.initializeTask(updated);
      } catch (error) {
        this.database.updateTask(taskId, {
          status: task.status,
          position: task.position,
          started_at: task.started_at,
          finished_at: task.finished_at,
          session_id: task.session_id,
          result: task.result,
          error: task.error,
          exit_code: task.exit_code,
          provider: task.provider,
          model: task.model,
          effort: task.effort,
          thread_id: task.thread_id,
          thread_name: task.thread_name,
          thread_source: task.thread_source,
          continued_from_task_id: task.continued_from_task_id,
          keep_terminal_open: task.keep_terminal_open ? 1 : 0,
          manual_completion: task.manual_completion ? 1 : 0,
        });
        throw error;
      }
    }
    this.artifacts.clearOutcome(taskId, {
      preservePlan: task.mode === 'plan',
      repoPath: task.repo_path,
    });
    if (providerChanged) {
      this.database.addEvent(
        taskId,
        'queue',
        `Retry executor changed from ${providerName(task.provider)} to ${providerName(nextProvider)}. A fresh ${providerName(nextProvider)} conversation will be used.`,
      );
    } else if (executionChanged) {
      this.database.addEvent(
        taskId,
        'queue',
        `Retry execution settings changed to ${providerName(nextProvider)} / ${nextModel || 'model default'} / ${nextEffort || 'effort default'}.`,
      );
    }
    this.database.addEvent(taskId, 'queue', 'Task queued for retry.');
    this.changed(taskId);
    if (reuseRetainedTerminal) {
      this.database.addEvent(taskId, 'queue', 'Retry is reusing the retained terminal session.');
      void this.runTask(updated, { reuseRetainedTerminal: true });
    } else {
      this.schedule();
    }
    return reuseRetainedTerminal ? this.database.getTask(taskId) : updated;
  }

  delete(taskId) {
    this.clearAutoRetry(taskId);
    this.automaticRetryCounts.delete(taskId);
    const task = this.database.getTask(taskId);
    if (!task) {
      return false;
    }
    if (task.status === 'running') {
      throw new Error('Cancel the running task before deleting it.');
    }
    if (this.activePreparations.has(taskId)) {
      throw new Error('Wait for the forward planner to finish or cancel it before deleting the task.');
    }
    const dispatchGuard = this.dispatchGuards.get(taskId);
    if (dispatchGuard) dispatchGuard.cancelRequested = true;
    const deleted = this.database.deleteTask(taskId);
    if (deleted) {
      this.artifacts.deleteTask(taskId, { repoPath: task.repo_path });
    }
    this.changed(taskId);
    return deleted;
  }

  edit(taskId, {
    title,
    prompt,
    provider = undefined,
    model = undefined,
    effort = undefined,
  }) {
    const task = this.database.getTask(taskId);
    if (!task) throw new Error('Task not found.');
    if (task.status !== 'queued') {
      throw new Error('Only a task that is still waiting in the queue can be edited.');
    }
    if (this.activePreparations.has(taskId)) {
      throw new Error('This task is already being prepared. Cancel it before changing its request.');
    }
    const executionChanged = provider !== undefined || model !== undefined || effort !== undefined;
    if (
      executionChanged
      && (task.mode !== 'execute' || task.terminal_lifecycle !== 'disposable')
    ) {
      throw new Error('Only automatic queued Execute tasks can change AI provider or execution settings.');
    }
    const nextProvider = provider === undefined ? task.provider : provider;
    if (executionChanged && !['codex', 'claude', 'opencode'].includes(nextProvider)) {
      throw new Error(`Unsupported AI provider: ${nextProvider}`);
    }
    const providerChanged = nextProvider !== task.provider;
    const titleChanged = title !== task.title;
    const promptChanged = prompt !== task.prompt;
    const executionEditDescription = titleChanged && promptChanged
      ? 'name, request, and execution settings'
      : titleChanged
        ? 'name and execution settings'
        : promptChanged ? 'request and execution settings' : 'execution settings';
    const changes = {
      title,
      prompt,
      ...(executionChanged ? {
        provider: nextProvider,
        model: model ?? null,
        effort: effort ?? null,
      } : {}),
      ...(providerChanged ? {
        thread_id: null,
        thread_name: null,
        thread_source: null,
        session_id: null,
        continued_from_task_id: null,
      } : {}),
      ...(nextProvider === 'opencode' ? {
        keep_terminal_open: 0,
        manual_completion: 0,
      } : {}),
    };
    const updated = this.database.updateQueuedTask(taskId, changes);
    const dispatchGuard = this.dispatchGuards.get(taskId);
    if (dispatchGuard) dispatchGuard.task = updated;
    try {
      this.artifacts.initializeTask(updated);
    } catch (error) {
      this.database.updateTask(taskId, {
        title: task.title,
        prompt: task.prompt,
        provider: task.provider,
        model: task.model,
        effort: task.effort,
        thread_id: task.thread_id,
        thread_name: task.thread_name,
        thread_source: task.thread_source,
        session_id: task.session_id,
        continued_from_task_id: task.continued_from_task_id,
        keep_terminal_open: task.keep_terminal_open ? 1 : 0,
        manual_completion: task.manual_completion ? 1 : 0,
      });
      throw error;
    }
    this.artifacts.clearOutcome(taskId, { repoPath: task.repo_path });
    this.database.addEvent(
      taskId,
      'queue',
      providerChanged
        ? `Queued task switched from ${providerName(task.provider)} to ${providerName(nextProvider)} before execution. A fresh ${providerName(nextProvider)} conversation will be used.`
        : executionChanged
          ? `Queued task ${executionEditDescription} edited before execution.`
          : titleChanged && promptChanged
            ? 'Queued task name and request edited before execution.'
            : titleChanged
              ? `Queued task renamed from "${task.title}" to "${updated.title}" before execution.`
              : 'Queued task request edited before execution.',
    );
    this.changed(taskId);
    this.schedule();
    return updated;
  }

  rename(taskId, title) {
    const task = this.database.getTask(taskId);
    if (!task) throw new Error('Task not found.');
    if (task.mode === 'breakdown') {
      throw new Error('Planner breakdown tasks keep the name of their linked plan step.');
    }
    if (this.activePreparations.has(taskId)) {
      throw new Error('This task is already being prepared. Wait for preparation to finish before renaming it.');
    }
    const nextTitle = taskTitleFromInput(title, task.prompt);
    if (nextTitle === task.title) return task;

    const updated = this.database.updateTask(taskId, { title: nextTitle });
    try {
      this.artifacts.updateTaskTitle(updated);
    } catch (error) {
      this.database.updateTask(taskId, { title: task.title });
      throw error;
    }
    if (this.activeTasks.has(taskId)) {
      this.activeTasks.set(taskId, { ...this.activeTasks.get(taskId), title: updated.title });
    }
    const dispatchGuard = this.dispatchGuards.get(taskId);
    if (dispatchGuard) dispatchGuard.task = { ...dispatchGuard.task, title: updated.title };
    this.database.addEvent(
      taskId,
      'queue',
      `Task renamed from "${task.title}" to "${updated.title}".`,
    );
    this.changed(taskId);
    return updated;
  }

  setStarred(taskId, starred) {
    if (typeof starred !== 'boolean') throw new Error('Task starred state must be true or false.');
    const task = this.database.getTask(taskId);
    if (!task) throw new Error('Task not found.');
    if (task.starred === starred) return task;
    const updated = this.database.updateTask(taskId, { starred: starred ? 1 : 0 });
    this.database.addEvent(
      taskId,
      'queue',
      starred ? 'Task starred and moved to the top of task views.' : 'Task removed from Starred.',
    );
    this.changed(taskId);
    return updated;
  }

  reorder(taskIds, expectedTaskIds = null, repoPath = null) {
    const tasks = this.database.reorderQueuedTasks(taskIds, expectedTaskIds, repoPath);
    this.changed();
    this.schedule();
    return tasks;
  }

  assign(taskId, thread) {
    const task = this.database.getTask(taskId);
    if (!task) throw new Error('Task not found.');
    if (task.status !== 'queued') throw new Error('Only queued tasks can be assigned to another terminal.');
    if (task.terminal_lifecycle === 'disposable') {
      throw new Error('This task uses the automatic terminal pool and cannot be assigned manually.');
    }
    if (!this.isThreadAvailable(thread.id)) throw new Error('That terminal is closing. Choose another CC Relay.');
    const updated = this.database.updateTask(taskId, {
      thread_id: thread.id,
      thread_name: thread.title,
      thread_source: thread.source,
    });
    const dispatchGuard = this.dispatchGuards.get(taskId);
    if (dispatchGuard) dispatchGuard.task = updated;
    this.artifacts.updateTaskAssignment(updated);
    this.database.addEvent(taskId, 'queue', `Task assigned to ${thread.title}.`);
    this.changed(taskId);
    this.schedule();
    return updated;
  }

  schedule() {
    if (this.scheduling || this.stopping || this.database.isPaused()) {
      return;
    }
    this.scheduling = true;
    queueMicrotask(() => {
      try {
        this.runNext();
        this.planAhead();
      } finally {
        this.scheduling = false;
        if (!this.stopping && !this.database.isPaused() && this.runnableTasks().length > 0) {
          this.schedule();
        }
      }
    });
  }

  isConcurrentCodexTask(task) {
    return task?.mode === 'execute' && task.provider === 'codex';
  }

  isDirectClaudeTask(task) {
    return task?.mode === 'execute' && task.provider === 'claude';
  }

  isDirectOpenCodeTask(task) {
    return task?.mode === 'execute' && task.provider === 'opencode';
  }

  isDirectExecutionTask(task) {
    return this.isConcurrentCodexTask(task)
      || this.isDirectClaudeTask(task)
      || this.isDirectOpenCodeTask(task);
  }

  // Tasks that occupy exactly one session for one turn and therefore need no barrier
  // beyond "one CC Relay task per session id". Direct execution plus Planner breakdowns.
  //
  // A breakdown is planning work, but mechanically it is ordinary single-session work:
  // RelayRunner sends it to the provider runner by task.provider, like a direct task.
  // Scheduling it as an exclusive head froze its entire project and consumed the shared
  // exclusive slot for no safety benefit. Plan council and legacy persistent Turbo retain
  // their exclusive barriers. Automatic Turbo is non-single-session work with a separate
  // capacity-managed pipeline in runnableTasks().
  isSingleSessionTask(task) {
    return this.isDirectExecutionTask(task) || task?.mode === 'breakdown';
  }

  isDisposablePoolTask(task) {
    return Boolean(this.terminalPool) && task?.terminal_lifecycle === 'disposable';
  }

  isCapacityManagedCouncil(task) {
    return this.isDisposablePoolTask(task) && task?.mode === 'plan';
  }

  isCapacityManagedTurbo(task) {
    return this.isDisposablePoolTask(task)
      && task?.mode === 'turbo'
      && this.terminalPool?.supportsTurboStages?.(task);
  }

  turboConcurrency(task) {
    const configured = Number(task?.turbo?.workerCount || 1);
    return Number.isInteger(configured) && configured > 0 ? configured : 1;
  }

  canShareProjectWithCouncil(tasks) {
    return tasks.every((task) => (
      this.isDisposablePoolTask(task)
      && (this.isSingleSessionTask(task) || this.isCapacityManagedCouncil(task))
    ));
  }

  turboPlan(task) {
    try { return this.artifacts.readTurboPlan(task.id); } catch { return null; }
  }

  isTurboExecuting(task) {
    return task?.mode === 'turbo' && this.turboPlan(task)?.status === 'executing';
  }

  reservedThreadIds({ excludeTaskId = null } = {}) {
    const reserved = new Set();
    for (const task of this.activeTasks.values()) {
      if (excludeTaskId !== null && task.id === excludeTaskId) continue;
      if (this.isSingleSessionTask(task)) {
        if (task.thread_id) reserved.add(task.thread_id);
        continue;
      }
      if (task.mode === 'plan') {
        for (const threadId of this.taskThreadIds(task)) reserved.add(threadId);
        continue;
      }
      if (task.mode !== 'turbo') continue;
      const plan = this.turboPlan(task);
      if (plan?.status === 'executing') {
        for (const worker of plan.workers || task.turbo?.workers || []) {
          if (worker?.threadId) reserved.add(worker.threadId);
        }
        for (const item of plan.tasks || []) {
          if (item?.status === 'running' && item.workerThreadId) reserved.add(item.workerThreadId);
        }
      } else {
        const plannerThreadId = task.turbo?.plannerThreadId || task.thread_id;
        if (plannerThreadId) reserved.add(plannerThreadId);
      }
    }
    for (const entry of this.activePreparations.values()) {
      if (entry.plannerBusy && entry.plannerThreadId) reserved.add(entry.plannerThreadId);
    }
    for (const guard of this.dispatchGuards.values()) {
      if (excludeTaskId !== null && guard.task?.id === excludeTaskId) continue;
      for (const threadId of this.taskThreadIds(guard.task)) reserved.add(threadId);
    }
    return reserved;
  }

  preparationCallbacks(task, preparation = null) {
    return {
      onEvent: ({ event, message }) => {
        if (preparation && event?.type === 'turbo/stage') {
          if (event.phase === 'planner' && event.status === 'running') {
            preparation.plannerBusy = true;
          } else if (event.phase === 'planner' && event.status === 'complete') {
            preparation.plannerBusy = !preparation.councilEnabled;
            preparation.councilStage = preparation.councilEnabled
              ? event.plan?.council?.status || 'queued'
              : null;
          } else if (event.phase === 'council-review') {
            preparation.plannerBusy = false;
            preparation.councilStage = event.status === 'running' ? 'reviewing' : event.status || preparation.councilStage;
          } else if (event.phase === 'council-author') {
            preparation.plannerBusy = false;
            preparation.councilStage = event.status === 'running' ? 'authoring' : event.status || preparation.councilStage;
          }
        }
        this.artifacts.appendRawEvent(task.id, event);
        this.database.addEvent(task.id, event.provider || 'plan', message, event);
        this.changed(task.id);
        if (event.phase === 'workers' || event.phase === 'planner' || event.phase === 'council-review' || event.phase === 'council-author') this.schedule();
        if (preparation && preparation.councilEnabled && event.phase === 'planner' && event.status === 'complete') {
          queueMicrotask(() => this.planAhead());
        }
        if (preparation && preparation.councilEnabled && event.phase === 'council-author' && event.status === 'running') {
          queueMicrotask(() => this.planAhead());
        }
      },
      onStderr: (line) => {
        this.artifacts.appendRawEvent(task.id, { type: 'stderr', text: line });
        this.database.addEvent(task.id, 'stderr', line);
        this.changed(task.id);
      },
    };
  }

  planAhead() {
    if (this.stopping || this.database.isPaused()) return;
    const activeTurbo = [...this.activeTasks.values()].filter((task) => this.isTurboExecuting(task));
    const workerThreads = new Set(activeTurbo.flatMap((task) => {
      const plan = this.turboPlan(task);
      return (plan?.workers || task.turbo?.workers || []).map((worker) => worker.threadId);
    }));
    const planningThreads = new Set([...this.activePreparations.values()]
      .filter((entry) => entry.plannerBusy)
      .map((entry) => entry.plannerThreadId));
    const dynamicPlanningProjects = new Set([...this.activePreparations.values()]
      .filter((entry) => entry.dynamicTerminals)
      .map((entry) => entry.repoPath));
    // Forward planning starts a real turn on the planner session, so it has to honour the
    // same reservation every dispatch does. Look-ahead only avoided Turbo's own worker and
    // planner threads before, which was survivable while every other non-direct mode froze
    // its whole project. Single-session breakdowns run beside Turbo now, so a breakdown
    // holding a session in another project has to be visible here too.
    const reservedThreads = this.reservedThreadIds();
    const candidates = this.database.listTasks()
      .filter((task) => task.status === 'queued'
        && task.mode === 'turbo'
        && !this.taskHasUnavailableThread(task)
        && !this.database.isProjectPaused(task.repo_path))
      .sort((left, right) => left.position - right.position || left.id - right.id);
    for (const task of candidates) {
      if (this.activePreparations.has(task.id)) continue;
      const plan = this.turboPlan(task);
      if (plan?.status === 'ready') continue;
      const dynamicTerminals = this.isDisposablePoolTask(task)
        && this.terminalPool?.supportsTurboStages?.(task);
      if (dynamicTerminals) {
        if (dynamicPlanningProjects.has(task.repo_path)) continue;
        const pool = this.terminalPool.projectStatus(
          task.repo_path,
          [...this.activeTasks.values()],
        );
        if (pool.active.codex >= pool.limits.codex) continue;
        dynamicPlanningProjects.add(task.repo_path);
        this.startPreparation(task, null);
        continue;
      }
      if (activeTurbo.length === 0) continue;
      const plannerThreadId = task.turbo?.plannerThreadId || task.thread_id;
      if (!plannerThreadId
        || workerThreads.has(plannerThreadId)
        || planningThreads.has(plannerThreadId)
        || reservedThreads.has(plannerThreadId)) continue;
      planningThreads.add(plannerThreadId);
      this.startPreparation(task, plannerThreadId);
    }
  }

  startPreparation(task, plannerThreadId) {
    const councilEnabled = task?.turbo?.council?.enabled === true || task?.turbo?.councilEnabled === true;
    const councilOrder = task?.turbo?.council?.order || ['codex', 'claude'];
    const entry = {
      plannerThreadId,
      repoPath: task.repo_path,
      dynamicTerminals: this.isDisposablePoolTask(task)
        && this.terminalPool?.supportsTurboStages?.(task),
      plannerBusy: !councilEnabled || councilOrder[0] === 'codex',
      councilEnabled,
      councilStage: null,
      promise: null,
    };
    this.activePreparations.set(task.id, entry);
    let preparation;
    try {
      preparation = Promise.resolve(this.runner.prepare(task, this.preparationCallbacks(task, entry)));
    } catch (error) {
      preparation = Promise.reject(error);
    }
    entry.promise = preparation;
    this.database.addEvent(
      task.id,
      'queue',
      entry.dynamicTerminals
        ? 'Planning ahead in a fresh terminal; queue position is unchanged.'
        : 'Planning ahead while another Turbo task executes.',
    );
    this.changed(task.id);
    preparation.then(() => {
      const current = this.database.getTask(task.id);
      if (current?.status === 'queued') {
        this.database.addEvent(
          task.id,
          'queue',
          entry.dynamicTerminals
            ? 'Forward plan ready; waiting for an execution lane.'
            : 'Forward plan ready; waiting for worker execution.',
        );
        this.changed(task.id);
      }
    }, (error) => {
      const current = this.database.getTask(task.id);
      if (current?.status !== 'queued') return;
      if (error.capacityWait === true) {
        this.database.addEvent(task.id, 'queue', error.message);
        this.changed(task.id);
        return;
      }
      this.database.updateTask(task.id, { status: 'failed', finished_at: now(), error: error.message });
      this.artifacts.writeError(task.id, error.message);
      const willRetry = error.retryable !== false && this.canAutomaticallyRetry(task.id);
      this.database.addEvent(
        task.id,
        'queue',
        willRetry
          ? `Forward plan failed. Retrying automatically in ${this.retryDelayMs / 1000} seconds.`
          : error.retryable === false
            ? 'Forward plan failed and needs attention. Fix the session issue, then retry it manually.'
            : `Forward plan failed after ${this.maxAutomaticRetries} automatic retries and needs attention. Retry it manually when the cause is fixed.`,
      );
      if (willRetry) this.scheduleAutoRetry(task.id);
    }).finally(() => {
      if (this.activePreparations.get(task.id) === entry) this.activePreparations.delete(task.id);
      this.changed(task.id);
      this.schedule();
    });
  }

  runnableTasks() {
    if (this.database.isPaused()) return [];
    const queued = this.database.listTasks().filter(
      (task) => task.status === 'queued'
        && !this.taskHasUnavailableThread(task)
        && !this.database.isProjectPaused(task.repo_path),
    );
    const active = [...this.activeTasks.values()];
    const runnable = [];
    const reservedThreads = this.reservedThreadIds();
    const queuedByProject = new Map();
    const activeByProject = new Map();
    for (const task of queued) {
      if (!queuedByProject.has(task.repo_path)) queuedByProject.set(task.repo_path, []);
      queuedByProject.get(task.repo_path).push(task);
    }
    for (const task of active) {
      if (!activeByProject.has(task.repo_path)) activeByProject.set(task.repo_path, []);
      activeByProject.get(task.repo_path).push(task);
    }

    let sharedExclusiveAvailable = !active.some((task) => !this.isSingleSessionTask(task));
    let blockingWorkflowActive = active.some((task) => (
      !this.isSingleSessionTask(task) && !this.isCapacityManagedTurbo(task)
    ));
    for (const [repoPath, projectQueued] of queuedByProject) {
      const projectActive = activeByProject.get(repoPath) || [];
      const legacyExecutingTurbo = projectActive.some((task) => (
        this.isTurboExecuting(task) && !this.isCapacityManagedTurbo(task)
      ));

      if (legacyExecutingTurbo) {
        for (const task of projectQueued) {
          // Turbo's workflow parent remains exclusive, but a direct disposable turn needs
          // only its own provider slot. Claude used to be skipped here unconditionally, so a
          // project could show 0 / 2 Claude instances active while its first Claude task waited
          // behind unrelated Codex workers. Capacity and exact conversation ownership are the
          // complete safety gates for both direct providers.
          if (!this.isDirectExecutionTask(task)) continue;
          if (task.terminal_lifecycle === 'disposable') {
            if (task.thread_id && reservedThreads.has(task.thread_id)) continue;
            if (!this.terminalPool?.canRun(task, [...active, ...runnable])) continue;
            if (task.thread_id) reservedThreads.add(task.thread_id);
          } else {
            if (!task.thread_id || reservedThreads.has(task.thread_id)) continue;
            reservedThreads.add(task.thread_id);
          }
          runnable.push(task);
        }
        continue;
      }

      const activeExclusive = projectActive.filter((task) => (
        !this.isSingleSessionTask(task) && !this.isCapacityManagedTurbo(task)
      ));
      const activeCapacityManagedCouncil = activeExclusive.length === 1
        && this.isCapacityManagedCouncil(activeExclusive[0])
        && this.canShareProjectWithCouncil(projectActive);
      if (activeExclusive.length > 0 && !activeCapacityManagedCouncil) continue;

      // A disposable Plan council still owns the one global council slot, but its project
      // concurrency is governed by the atomic Codex and Claude pool requirements. It may
      // therefore run beside disposable single-session work while both provider limits fit.
      // Legacy councils and Turbo retain the project-draining exclusive barrier.
      let projectHasCapacityManagedCouncil = activeCapacityManagedCouncil;
      const projectRunnable = [];
      let runningTurboExecutions = projectActive.filter((task) => (
        this.isCapacityManagedTurbo(task) && this.isTurboExecuting(task)
      )).length;
      const activeTurboLimits = projectActive
        .filter((task) => this.isCapacityManagedTurbo(task))
        .map((task) => this.turboConcurrency(task));
      let turboExecutionLimit = activeTurboLimits.length > 0
        ? Math.min(...activeTurboLimits)
        : Number.POSITIVE_INFINITY;
      let turboQueueSaturated = false;
      for (const task of projectQueued) {
        if (this.isSingleSessionTask(task)) {
          if (projectHasCapacityManagedCouncil && !this.isDisposablePoolTask(task)) break;
          if (this.dispatchGuards.has(task.id)) continue;
          if (task.terminal_lifecycle === 'disposable') {
            if (task.thread_id && reservedThreads.has(task.thread_id)) continue;
            if (!this.terminalPool?.canRun(task, [...active, ...runnable])) continue;
            if (task.thread_id) reservedThreads.add(task.thread_id);
          } else {
            if (!task.thread_id || reservedThreads.has(task.thread_id)) continue;
            reservedThreads.add(task.thread_id);
          }
          runnable.push(task);
          projectRunnable.push(task);
          continue;
        }

        if (this.isCapacityManagedTurbo(task)) {
          const plan = this.turboPlan(task);
          if (plan?.status !== 'ready') continue;
          if (blockingWorkflowActive) continue;
          if (turboQueueSaturated) continue;
          const taskLimit = this.turboConcurrency(task);
          const effectiveLimit = Math.min(turboExecutionLimit, taskLimit);
          if (runningTurboExecutions >= effectiveLimit) {
            // Preserve Turbo FIFO without blocking later direct Claude or Codex work. A lower
            // concurrency setting starts a new execution batch after the current batch drains.
            turboQueueSaturated = true;
            continue;
          }
          if (this.dispatchGuards.has(task.id)) continue;
          if (!this.terminalPool.canRun(task, [...active, ...runnable])) {
            turboQueueSaturated = true;
            continue;
          }
          runnable.push(task);
          projectRunnable.push(task);
          runningTurboExecutions += 1;
          turboExecutionLimit = effectiveLimit;
          sharedExclusiveAvailable = false;
          continue;
        }

        if (this.isCapacityManagedCouncil(task)) {
          if (
            projectHasCapacityManagedCouncil
            || !sharedExclusiveAvailable
            || this.dispatchGuards.has(task.id)
            || !this.canShareProjectWithCouncil([...projectActive, ...projectRunnable, task])
          ) break;
          const threadIds = this.taskThreadIds(task);
          if (threadIds.some((threadId) => reservedThreads.has(threadId))) break;
          if (!this.terminalPool.canRun(task, [...active, ...runnable])) break;
          for (const threadId of threadIds) reservedThreads.add(threadId);
          runnable.push(task);
          projectRunnable.push(task);
          projectHasCapacityManagedCouncil = true;
          sharedExclusiveAvailable = false;
          blockingWorkflowActive = true;
          continue;
        }

        if (
          projectActive.length > 0
          || projectRunnable.length > 0
          || !sharedExclusiveAvailable
          || this.dispatchGuards.has(task.id)
        ) break;
        const threadIds = this.taskThreadIds(task);
        if (
          task.terminal_lifecycle === 'disposable'
          && threadIds.some((threadId) => reservedThreads.has(threadId))
        ) break;
        if (
          task.terminal_lifecycle === 'disposable'
          && !this.terminalPool?.canRun(task, [...active, ...runnable])
        ) break;
        if (task.terminal_lifecycle === 'disposable') {
          for (const threadId of threadIds) reservedThreads.add(threadId);
        }
        runnable.push(task);
        projectRunnable.push(task);
        sharedExclusiveAvailable = false;
        blockingWorkflowActive = true;
        break;
      }
    }
    return runnable;
  }

  runNext() {
    const tasks = this.runnableTasks();
    if (tasks.length === 0) return;
    void Promise.allSettled(tasks.map((task) => this.runTask(task)));
  }

  beginTask(task, { sessionFollowUp = false } = {}) {
    this.activeTasks.set(task.id, task);
    const persisted = this.database.getTask(task.id);
    const attemptStartedAt = now();
    // A manual terminal session preserves its first persisted start so the workspace lifetime
    // remains visible. Token telemetry still belongs to this exact provider attempt, so keep a
    // separate runtime boundary and stamp every native usage event with it.
    this.tokenUsageAttemptStarts.set(task.id, attemptStartedAt);
    const startedAt = isManualSessionTask(persisted) && persisted.started_at
      ? persisted.started_at
      : attemptStartedAt;
    this.database.updateTask(task.id, {
      status: 'running',
      started_at: startedAt,
      finished_at: null,
      error: null,
    });
    const executionModel = this.isCapacityManagedTurbo(task)
      ? task.turbo?.workerModel
      : task.model;
    const executionEffort = this.isCapacityManagedTurbo(task)
      ? task.turbo?.workerEffort
      : task.effort;
    const execution = [executionModel, executionEffort ? `${executionEffort} effort` : null].filter(Boolean);
    this.database.addEvent(
      task.id,
      'queue',
      sessionFollowUp
        ? `Follow-up started in the same task and conversation${execution.length > 0 ? ` with ${execution.join(', ')}` : ''}.`
        : execution.length > 0 ? `Task started with ${execution.join(', ')}.` : 'Task started.',
      {
        type: 'relay/task-attempt-started',
        provider: task.provider,
        attemptStartedAt,
      },
    );
    this.changed(task.id);
    // Captured once per task. A follow-up or retry re-enters here, keeps the original baseline,
    // and only clears the frozen end so the diff goes live again. A failure is recorded as diff
    // state and never reaches the task.
    //
    // Deliberately not awaited. beginTask has to hand control to executeTask inside the same
    // tick as runNext(), because planAhead() runs immediately after it and reads state that
    // only runner.run() establishes; awaiting anything here silently stops Turbo look-ahead.
    // The snapshot therefore races the provider's first write and wins by a wide margin: it
    // starts now, while the runner still has a CLI to start and a model to wait for.
    void this.captureDiffBaseline({ database: this.database, taskId: task.id });
  }

  runTask(task, options = {}) {
    if (
      !options.sessionFollowUp
      && !options.reuseRetainedTerminal
      && task.terminal_lifecycle === 'disposable'
      && this.terminalPool
    ) {
      this.beginTask(task, options);
      return this.executeTask(task, { ...options, prepareDisposable: true });
    }
    if (!options.sessionFollowUp && this.shouldWaitForClaudeDispatch(task)) {
      return this.startClaudeDispatch(task, options);
    }
    this.beginTask(task, options);
    return this.executeTask(task, options);
  }

  shouldWaitForClaudeDispatch(task) {
    return Boolean(this.listIdleSessions)
      && (
        (this.isDirectClaudeTask(task) && Boolean(task.thread_id))
        || (task?.mode === 'plan' && Boolean(task.author_thread_id))
      );
  }

  claudeDispatchTask(task) {
    if (task?.mode !== 'plan') return task;
    return {
      ...task,
      provider: 'claude',
      thread_id: task.author_thread_id,
      thread_name: task.author_thread_name,
      thread_source: task.author_thread_source,
      prefer_idle_terminal: 0,
    };
  }

  claudeDispatchThreadId(task) {
    return task?.mode === 'plan' ? task.author_thread_id : task?.thread_id;
  }

  startClaudeDispatch(task, options = {}) {
    const existing = this.dispatchGuards.get(task.id);
    if (existing?.promise) return existing.promise;
    const guard = {
      task,
      cancelRequested: false,
      promise: null,
    };
    this.dispatchGuards.set(task.id, guard);
    guard.promise = this.waitForClaudeDispatch(task, guard, options)
      .finally(() => {
        if (this.dispatchGuards.get(task.id) === guard) {
          this.dispatchGuards.delete(task.id);
        }
        this.changed(task.id);
        this.schedule();
      });
    return guard.promise;
  }

  async waitForClaudeDispatch(task, guard, options = {}) {
    let announcedThreadId = null;
    while (!this.stopping && !guard.cancelRequested) {
      const current = this.database.getTask(task.id);
      if (!current || current.status !== 'queued') return;
      guard.task = current;
      const dispatchTask = this.claudeDispatchTask(current);

      const resolution = await this.resolveIdleDestination(dispatchTask, {
        holdBusySelected: true,
        expectedStatus: 'queued',
      });
      if (guard.cancelRequested || this.stopping) return;
      if (resolution.retry) continue;

      if (resolution.ready) {
        const latest = this.database.getTask(task.id);
        if (
          !latest
          || latest.status !== 'queued'
          || this.claudeDispatchThreadId(latest) !== resolution.task.thread_id
        ) {
          continue;
        }
        guard.task = latest;
        if (announcedThreadId) {
          this.database.addEvent(
            task.id,
            'queue',
            `Claude session ${dispatchTask.thread_name || dispatchTask.thread_id} is ready. Starting the queued task.`,
          );
        }
        this.dispatchGuards.delete(task.id);
        this.beginTask(latest, options);
        return this.executeTask(latest, { ...options, dispatchResolved: true });
      }

      if (announcedThreadId !== dispatchTask.thread_id) {
        const planPrefix = current.mode === 'plan' ? 'Plan council ' : '';
        const recovery = current.mode === 'plan'
          ? 'Finish its active work, or cancel and retry with another Claude council terminal.'
          : 'Finish its active work or assign this task to another Claude CC Relay.';
        const message = `The selected ${planPrefix}Claude session ${dispatchTask.thread_name || dispatchTask.thread_id} is busy. This task remains queued and nothing has been sent. ${recovery}`;
        const event = {
          type: 'claude/waiting',
          provider: 'claude',
          sessionId: dispatchTask.thread_id,
          queued: true,
        };
        this.artifacts.appendRawEvent(task.id, event);
        this.database.addEvent(task.id, 'claude', message, event);
        this.changed(task.id);
        announcedThreadId = dispatchTask.thread_id;
      }
      await this.dispatchWait(this.dispatchPollMs);
    }
  }

  // Dispatch-time idle routing. Claude direct tasks claim a dispatch guard synchronously but
  // stay persisted as queued until this lookup finds a usable destination. The guard prevents
  // concurrent claims without presenting unsent work as running. Other routing paths retain
  // the short post-beginTask guard. Routing never leaves repo_path.
  //
  // The gate remains synchronous because schedule() calls runNext() and planAhead() in the
  // same tick. An unconditional await on unrelated tasks can silently stop Turbo look-ahead
  // from observing the state established by runner.run().
  shouldRouteIdle(task) {
    return Boolean(this.listIdleSessions)
      && task.prefer_idle_terminal === 1
      && task.mode === 'execute'
      && Boolean(task.thread_id);
  }

  async resolveIdleDestination(task, {
    holdBusySelected = false,
    expectedStatus = null,
  } = {}) {
    let candidates = [];
    try {
      candidates = (await this.listIdleSessions(task)) || [];
    } catch {
      // Discovery trouble must never fail a task that already has a valid destination.
      return { task, ready: true, retry: false, selected: null };
    }
    if (expectedStatus) {
      const latest = this.database.getTask(task.id);
      if (
        !latest
        || latest.status !== expectedStatus
        || this.claudeDispatchThreadId(latest) !== task.thread_id
      ) {
        return { task: latest || task, ready: false, retry: true, selected: null };
      }
    }
    if (candidates.length === 0) {
      return { task, ready: true, retry: false, selected: null };
    }

    const reserved = this.reservedThreadIds({ excludeTaskId: task.id });
    // Sessions that already own waiting or active single-session CC Relay work. Routing onto
    // one would not be unsafe (runnableTasks() still serializes per session), but it would
    // send the task to a terminal that is about to be busy, which defeats the point.
    const assigned = new Set(this.database.listTasks()
      .filter((item) => item.id !== task.id
        && this.isSingleSessionTask(item)
        && ['queued', 'running'].includes(item.status)
        && item.thread_id)
      .map((item) => item.thread_id));
    const isFree = (session) => Boolean(session)
      && session.status === 'idle'
      && !reserved.has(session.id)
      && !assigned.has(session.id);

    // The session the user actually chose always wins when it is free.
    const selected = candidates.find((session) => session.id === task.thread_id);
    if (isFree(selected)) {
      return { task, ready: true, retry: false, selected };
    }

    const target = this.shouldRouteIdle(task) ? candidates.find(isFree) : null;
    if (!target || target.id === task.thread_id) {
      const selectedBusy = selected && selected.status !== 'idle';
      return {
        task,
        ready: !(holdBusySelected && selectedBusy),
        retry: false,
        selected,
      };
    }

    const updated = this.database.updateTask(task.id, {
      thread_id: target.id,
      thread_name: target.title,
      thread_source: target.source,
    });
    this.artifacts.updateTaskAssignment(updated);
    this.database.addEvent(
      task.id,
      'queue',
      `The selected terminal was busy, so idle routing moved this task to ${target.title}.`,
    );
    const routed = {
      ...task,
      thread_id: target.id,
      thread_name: target.title,
      thread_source: target.source,
    };
    this.changed(task.id);
    return { task: routed, ready: true, retry: false, selected: target };
  }

  async routeToIdleSession(task) {
    if (!this.shouldRouteIdle(task)) return task;
    const resolution = await this.resolveIdleDestination(task);
    const routed = resolution.task;
    if (routed.thread_id !== task.thread_id) {
      this.activeTasks.set(task.id, routed);
      // The originally selected session is free again, so another waiting task may start on it.
      this.schedule();
    }
    return routed;
  }

  async executeTask(task, {
    sessionFollowUp = false,
    dispatchResolved = false,
    prepareDisposable = false,
  } = {}) {
    let disposableGuard = null;
    let disposablePrepared = false;
    let retainPreparedTerminal = false;
    let routed = task;
    try {
      // A follow-up is pinned to its exact conversation. A closed disposable conversation
      // first binds a new owned terminal, while a connected conversation invokes the runner
      // immediately. The shouldRouteIdle() gate keeps this path await-free for every task
      // that is not opting into idle routing, so runner.run() is still invoked in the
      // dispatch tick.
      if (prepareDisposable) {
        disposableGuard = {
          task,
          cancelRequested: false,
          promise: null,
          phase: 'preparing',
        };
        this.dispatchGuards.set(task.id, disposableGuard);
        const prepared = await this.terminalPool.prepare(task, {
          isCancelled: () => disposableGuard.cancelRequested || this.stopping,
        });
        routed = sessionFollowUp
          ? {
              ...prepared,
              prompt: task.prompt,
              attachments: task.attachments,
              sessionFollowUp: true,
            }
          : prepared;
        disposablePrepared = true;
        this.activeTasks.set(task.id, routed);
        disposableGuard.task = routed;
        if (disposableGuard.cancelRequested || this.stopping) {
          throw Object.assign(new Error('Task cancelled before its terminal was ready.'), { cancelled: true });
        }
        this.dispatchGuards.delete(task.id);
        disposableGuard = null;
      }
      if (!sessionFollowUp && !dispatchResolved && this.shouldRouteIdle(task)) {
        const guard = { cancelRequested: false };
        this.dispatchGuards.set(task.id, guard);
        try {
          routed = await this.routeToIdleSession(task);
        } finally {
          this.dispatchGuards.delete(task.id);
        }
        if (guard.cancelRequested) {
          throw Object.assign(new Error('Task cancelled before CC Relay chose a terminal.'), { cancelled: true });
        }
      }
      const outcome = await this.runner.run(routed, {
        onEvent: ({ event, message }) => {
          if (event?.type === 'opencode/session' && task.provider === 'opencode') {
            const nativeSessionId = String(event.sessionId || '').trim();
            const current = this.database.getTask(task.id);
            if (
              nativeSessionId
              && current
              && (!current.thread_id || current.thread_id === nativeSessionId)
            ) {
              const sessionTask = this.database.updateTask(task.id, {
                thread_id: nativeSessionId,
                session_id: nativeSessionId,
                thread_name: current.thread_name || 'OpenCode headless session',
                thread_source: 'CC Relay managed headless runner',
              });
              this.activeTasks.set(task.id, sessionTask);
              this.artifacts.updateTaskAssignment(sessionTask);
            }
          }
          const storedEvent = event?.type === 'provider/token-usage'
            ? { ...event, attemptStartedAt: this.tokenUsageAttemptStarts.get(task.id) }
            : event;
          this.artifacts.appendRawEvent(task.id, storedEvent);
          const kind = storedEvent.provider || (
            storedEvent.type === 'item/completed' && storedEvent.item?.type === 'agentMessage'
              ? 'result'
              : 'codex'
          );
          this.database.addEvent(task.id, kind, message, storedEvent);
          this.changed(task.id);
        },
        onStderr: (line) => {
          this.artifacts.appendRawEvent(task.id, { type: 'stderr', text: line });
          this.database.addEvent(task.id, 'stderr', line);
          this.changed(task.id);
        },
      });

      const result = outcome.finalResponse
        || (task.mode === 'plan'
          ? 'The plan council completed without a final text response.'
          : `${providerName(task.provider)} completed without a final text response.`);
      const latestTask = this.database.getTask(task.id) || routed;
      const manualSession = isManualSessionTask(latestTask);
      const completedTask = this.database.updateTask(task.id, {
        status: manualSession ? 'open' : 'complete',
        finished_at: manualSession ? null : now(),
        session_id: outcome.sessionId,
        ...(task.provider === 'opencode' && outcome.sessionId ? {
          thread_id: outcome.sessionId,
          thread_name: latestTask.thread_name || 'OpenCode headless session',
          thread_source: 'CC Relay managed headless runner',
        } : {}),
        result,
        error: null,
        exit_code: outcome.exitCode,
      });
      if (task.provider === 'opencode' && outcome.sessionId) {
        this.artifacts.updateTaskAssignment(completedTask);
      }
      if (task.mode !== 'plan') {
        this.artifacts.writeResult(task.id, result);
      }
      this.automaticRetryCounts.delete(task.id);
      this.database.addEvent(
        task.id,
        'queue',
        manualSession
          ? 'Turn completed. The terminal session remains open for another message or manual completion.'
          : sessionFollowUp ? 'Follow-up completed.' : 'Task completed.',
      );
      retainPreparedTerminal = latestTask.keep_terminal_open === true;
    } catch (error) {
      const outcomeStatus = this.stopping ? 'interrupted' : error.cancelled ? 'cancelled' : 'failed';
      const message = this.stopping
        ? 'CC Relay stopped while this task was running.'
        : error.message;
      const storedError = sessionFollowUp
        ? `${FOLLOW_UP_ERROR_PREFIX} ${outcomeStatus}: ${message}`
        : message;
      const latestTask = this.database.getTask(task.id) || routed;
      const manualSession = isManualSessionTask(latestTask);
      const status = manualSession ? 'open' : outcomeStatus;
      this.database.updateTask(task.id, {
        status,
        finished_at: manualSession ? null : now(),
        error: storedError,
        exit_code: error.exitCode ?? null,
      });
      this.artifacts.writeError(task.id, storedError);
      const retryEligible = !manualSession
        && !sessionFollowUp
        && outcomeStatus === 'failed'
        && task.mode !== 'plan'
        && error.retryable !== false;
      const willRetry = retryEligible && this.canAutomaticallyRetry(task.id);
      retainPreparedTerminal = latestTask.keep_terminal_open === true && !willRetry;
      this.database.addEvent(
        task.id,
        'queue',
        manualSession
          ? outcomeStatus === 'cancelled'
            ? 'The current turn was stopped. The terminal session remains open.'
            : outcomeStatus === 'interrupted'
              ? 'The current turn was interrupted. The terminal session remains open.'
              : 'The current turn failed. The terminal session remains open for a corrected message or manual completion.'
          : this.stopping
          ? 'Task interrupted because CC Relay stopped.'
          : error.cancelled
            ? sessionFollowUp ? 'Follow-up cancelled.' : 'Task cancelled.'
            : willRetry
              ? `Task failed. Retrying automatically in ${this.retryDelayMs / 1000} seconds.`
              : sessionFollowUp
                ? 'Follow-up failed in the same terminal session. It was not queued. Fix the session issue and send it again.'
                : task.mode === 'plan'
                  ? 'Plan council stopped at the failed stage. Fix the provider or session issue, then retry to resume from its saved checkpoints.'
                  : retryEligible
                    ? `Task failed after ${this.maxAutomaticRetries} automatic retries and needs attention. Retry it manually when the cause is fixed.`
                  : 'Task failed and needs attention. Fix the session issue, then retry it manually.',
      );
      if (willRetry) {
        this.scheduleAutoRetry(task.id);
      }
    } finally {
      if (disposableGuard && this.dispatchGuards.get(task.id) === disposableGuard) {
        this.dispatchGuards.delete(task.id);
      }
      if (prepareDisposable) {
        if (disposablePrepared && retainPreparedTerminal) {
          await this.terminalPool.retain(task.id);
        } else {
          await this.terminalPool.release(task.id);
        }
      }
      this.activeTasks.delete(task.id);
      this.tokenUsageAttemptStarts.delete(task.id);
      this.changed(task.id);
      this.emit('taskIdle', task.id);
      if (this.activeTasks.size === 0) this.emit('idle');
      this.schedule();
    }
  }

  async shutdown() {
    this.stopping = true;
    const dispatchPromises = [];
    for (const guard of this.dispatchGuards.values()) {
      guard.cancelRequested = true;
      if (guard.promise) dispatchPromises.push(guard.promise);
    }
    for (const taskId of this.retryTimers.keys()) {
      this.clearAutoRetry(taskId);
    }
    if (
      this.activeTasks.size === 0
      && this.activePreparations.size === 0
      && dispatchPromises.length === 0
    ) {
      return;
    }

    const taskIds = [...this.activeTasks.keys()];
    for (const taskId of taskIds) {
      this.database.addEvent(taskId, 'system', 'CC Relay shutdown requested.');
    }
    if (this.terminalPool && typeof this.terminalPool.retain === 'function') {
      for (const taskId of taskIds) {
        const task = this.database.getTask(taskId) || this.activeTasks.get(taskId);
        const preparing = this.dispatchGuards.get(taskId)?.phase === 'preparing';
        if (
          task?.terminal_lifecycle === 'disposable'
          && task.keep_terminal_open === true
          && !preparing
        ) {
          await this.terminalPool.retain(taskId);
        }
      }
    }
    const idle = new Promise((resolve) => this.once('idle', resolve));
    for (const taskId of taskIds) this.runner.cancel(taskId);
    for (const taskId of this.activePreparations.keys()) this.runner.cancel(taskId);
    const preparationPromises = [...this.activePreparations.values()].map(({ promise }) => promise);
    const executionsDone = taskIds.length === 0 ? Promise.resolve() : idle;
    const preparationsDone = Promise.allSettled(preparationPromises);
    const dispatchesDone = Promise.allSettled(dispatchPromises);
    const timeout = new Promise((resolve) => {
      const timer = setTimeout(resolve, 3000);
      timer.unref();
    });
    await Promise.race([Promise.all([executionsDone, preparationsDone, dispatchesDone]), timeout]);
  }

  changed(taskId = null) {
    this.emit('changed', { taskId, status: this.status() });
  }

  canAutomaticallyRetry(taskId) {
    return (this.automaticRetryCounts.get(taskId) || 0) < this.maxAutomaticRetries;
  }

  scheduleAutoRetry(taskId) {
    this.clearAutoRetry(taskId);
    if (!this.canAutomaticallyRetry(taskId)) return;
    const timer = setTimeout(() => {
      this.retryTimers.delete(taskId);
      if (this.stopping) return;
      const task = this.database.getTask(taskId);
      if (task?.status !== 'failed') return;
      try {
        const retryCount = (this.automaticRetryCounts.get(taskId) || 0) + 1;
        this.automaticRetryCounts.set(taskId, retryCount);
        this.retry(taskId, { automatic: true });
        this.database.addEvent(taskId, 'queue', 'Automatic retry started after the 5-second wait.');
        this.changed(taskId);
      } catch {}
    }, this.retryDelayMs);
    timer.unref();
    this.retryTimers.set(taskId, timer);
  }

  clearAutoRetry(taskId) {
    const timer = this.retryTimers.get(taskId);
    if (timer) {
      clearTimeout(timer);
      this.retryTimers.delete(taskId);
    }
  }

  pendingRetryTaskIds() {
    return new Set(this.retryTimers.keys());
  }
}
