import { EventEmitter } from 'node:events';
import { now } from './database.mjs';

const RETRYABLE_STATUSES = new Set(['failed', 'cancelled', 'interrupted']);
const FOLLOW_UP_SOURCE_STATUSES = new Set(['complete', 'failed', 'cancelled', 'interrupted']);
const FOLLOW_UP_ERROR_PREFIX = 'Same-session follow-up';

export class TaskQueue extends EventEmitter {
  constructor({
    database,
    artifacts,
    runner,
    retryDelayMs = 5000,
    maxAutomaticRetries = 3,
    isThreadAvailable = () => true,
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
    this.retryTimers = new Map();
    this.automaticRetryCounts = new Map();
  }

  taskThreadIds(task) {
    const ids = new Set();
    const directThreadId = task?.thread_id || task?.thread?.id;
    if (directThreadId) ids.add(directThreadId);
    const turbo = task?.turbo || {};
    const plannerThreadId = turbo.plannerThreadId || turbo.planner?.threadId;
    if (plannerThreadId) ids.add(plannerThreadId);
    for (const worker of turbo.workers || []) {
      if (worker?.threadId) ids.add(worker.threadId);
    }
    return [...ids];
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

  startFollowUp(task) {
    const sourceTask = this.database.getTask(task?.id);
    if (!sourceTask) throw new Error('Task not found.');
    if (typeof task.prompt !== 'string' || !task.prompt.trim()) {
      throw new Error('Write a follow-up before sending it.');
    }
    if (sourceTask.mode !== 'execute' || !['codex', 'claude'].includes(sourceTask.provider)) {
      throw new Error('Only direct Codex or Claude tasks can continue in one terminal session.');
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
      throw new Error('Relay is stopping. Your follow-up was not queued.');
    }
    if (this.taskHasUnavailableThread(sourceTask)) {
      throw new Error('That terminal is closing. Your follow-up was not queued.');
    }
    if (this.activeTasks.has(sourceTask.id) || this.activePreparations.has(sourceTask.id)) {
      throw new Error('That task still owns active work. Your follow-up was not queued.');
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
    this.clearAutoRetry(sourceTask.id);
    const storedAttachments = this.stageTaskAttachments(sourceTask.id, task.attachments);
    const runtimeTask = { ...task, attachments: storedAttachments };
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
      'Follow-up dispatch requested for immediate same-session execution. It will not be queued.',
    );
    this.database.addEvent(sourceTask.id, sourceTask.provider, task.prompt, userEvent);
    this.beginTask(runtimeTask, { sessionFollowUp: true });
    void this.executeTask(runtimeTask, { sessionFollowUp: true });
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
    return {
      paused: this.database.isPaused() || (repoPath ? this.database.isProjectPaused(repoPath) : false),
      pausedProjectPaths: this.database.pausedProjectPaths(),
      activeTaskId: activeTaskIds[0] || null,
      activeTaskIds,
      planningTaskIds,
      reviewingTaskIds,
    };
  }

  enqueue(input) {
    const { attachments = [], runNow = false, submissionId = null, ...taskInput } = input;
    const existing = this.database.getTaskBySubmissionId(submissionId);
    if (existing) {
      const sameSubmission = existing.prompt === taskInput.prompt
        && existing.mode === (taskInput.mode || 'execute')
        && existing.provider === (taskInput.provider || 'codex');
      if (!sameSubmission) {
        throw new Error('That submission ID was already used for different work.');
      }
      return existing;
    }
    if (this.taskHasUnavailableThread(taskInput)) {
      throw new Error('That terminal is closing. Choose another Relay before adding work.');
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
      this.artifacts.deleteTask(task.id);
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
    if (!this.runner.cancel(taskId)) {
      throw new Error('The AI process is no longer running.');
    }
    this.changed(taskId);
  }

  retry(taskId, { automatic = false } = {}) {
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
    if (this.taskHasUnavailableThread(task)) {
      throw new Error('That terminal is closing. Retry after choosing another Relay.');
    }

    const tasks = this.database.listTasks().filter((item) => item.repo_path === task.repo_path);
    const maxPosition = tasks.reduce((maximum, item) => Math.max(maximum, item.position), 0);
    const updated = this.database.updateTask(taskId, {
      status: 'queued',
      position: maxPosition + 1,
      started_at: null,
      finished_at: null,
      session_id: null,
      result: null,
      error: null,
      exit_code: null,
    });
    this.artifacts.clearOutcome(taskId, {
      preservePlan: task.mode === 'plan',
    });
    this.database.addEvent(taskId, 'queue', 'Task queued for retry.');
    this.changed(taskId);
    this.schedule();
    return updated;
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
    const deleted = this.database.deleteTask(taskId);
    if (deleted) {
      this.artifacts.deleteTask(taskId);
    }
    this.changed(taskId);
    return deleted;
  }

  edit(taskId, { title, prompt }) {
    const task = this.database.getTask(taskId);
    if (!task) throw new Error('Task not found.');
    if (task.status !== 'queued') {
      throw new Error('Only a task that is still waiting in the queue can be edited.');
    }
    if (this.activePreparations.has(taskId)) {
      throw new Error('This task is already being prepared. Cancel it before changing its request.');
    }
    const updated = this.database.updateQueuedTask(taskId, { title, prompt });
    try {
      this.artifacts.initializeTask(updated);
    } catch (error) {
      this.database.updateTask(taskId, { title: task.title, prompt: task.prompt });
      throw error;
    }
    this.artifacts.clearOutcome(taskId);
    this.database.addEvent(taskId, 'queue', 'Queued task request edited before execution.');
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
    if (!this.isThreadAvailable(thread.id)) throw new Error('That terminal is closing. Choose another Relay.');
    const updated = this.database.updateTask(taskId, {
      thread_id: thread.id,
      thread_name: thread.title,
      thread_source: thread.source,
    });
    this.artifacts.updateTaskAssignment(updated);
    this.database.addEvent(taskId, 'queue', `Task assigned to ${thread.title}.`);
    this.changed(taskId);
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

  isDirectExecutionTask(task) {
    return this.isConcurrentCodexTask(task) || this.isDirectClaudeTask(task);
  }

  turboPlan(task) {
    try { return this.artifacts.readTurboPlan(task.id); } catch { return null; }
  }

  isTurboExecuting(task) {
    return task?.mode === 'turbo' && this.turboPlan(task)?.status === 'executing';
  }

  reservedThreadIds() {
    const reserved = new Set();
    for (const task of this.activeTasks.values()) {
      if (this.isDirectExecutionTask(task)) {
        if (task.thread_id) reserved.add(task.thread_id);
        continue;
      }
      if (task.mode !== 'turbo') continue;
      const plan = this.turboPlan(task);
      if (plan?.status === 'executing') {
        for (const worker of plan.workers || task.turbo?.workers || []) {
          if (worker?.threadId) reserved.add(worker.threadId);
        }
      } else {
        const plannerThreadId = task.turbo?.plannerThreadId || task.thread_id;
        if (plannerThreadId) reserved.add(plannerThreadId);
      }
    }
    for (const entry of this.activePreparations.values()) {
      if (entry.plannerBusy && entry.plannerThreadId) reserved.add(entry.plannerThreadId);
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
    if (activeTurbo.length === 0) return;
    const workerThreads = new Set(activeTurbo.flatMap((task) => {
      const plan = this.turboPlan(task);
      return (plan?.workers || task.turbo?.workers || []).map((worker) => worker.threadId);
    }));
    const planningThreads = new Set([...this.activePreparations.values()]
      .filter((entry) => entry.plannerBusy)
      .map((entry) => entry.plannerThreadId));
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
      const plannerThreadId = task.turbo?.plannerThreadId || task.thread_id;
      if (!plannerThreadId || workerThreads.has(plannerThreadId) || planningThreads.has(plannerThreadId)) continue;
      planningThreads.add(plannerThreadId);
      this.startPreparation(task, plannerThreadId);
    }
  }

  startPreparation(task, plannerThreadId) {
    const councilEnabled = task?.turbo?.council?.enabled === true || task?.turbo?.councilEnabled === true;
    const councilOrder = task?.turbo?.council?.order || ['codex', 'claude'];
    const entry = {
      plannerThreadId,
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
    this.database.addEvent(task.id, 'queue', 'Planning ahead while another Turbo task executes.');
    this.changed(task.id);
    preparation.then(() => {
      const current = this.database.getTask(task.id);
      if (current?.status === 'queued') {
        this.database.addEvent(task.id, 'queue', 'Forward plan ready; waiting for worker execution.');
        this.changed(task.id);
      }
    }, (error) => {
      const current = this.database.getTask(task.id);
      if (current?.status !== 'queued') return;
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

    let sharedExclusiveAvailable = !active.some((task) => !this.isDirectExecutionTask(task));
    for (const [repoPath, projectQueued] of queuedByProject) {
      const projectActive = activeByProject.get(repoPath) || [];
      const executingTurbo = projectActive.some((task) => this.isTurboExecuting(task));

      if (executingTurbo) {
        for (const task of projectQueued) {
          if (!this.isConcurrentCodexTask(task) || !task.thread_id || reservedThreads.has(task.thread_id)) continue;
          reservedThreads.add(task.thread_id);
          runnable.push(task);
        }
        continue;
      }

      if (projectActive.some((task) => !this.isDirectExecutionTask(task))) continue;
      const first = projectQueued[0];
      if (first?.mode === 'turbo' && this.activePreparations.has(first.id)) continue;

      if (first && !this.isDirectExecutionTask(first)) {
        if (projectActive.length > 0 || !sharedExclusiveAvailable) continue;
        runnable.push(first);
        sharedExclusiveAvailable = false;
        continue;
      }

      for (const task of projectQueued) {
        if (!this.isDirectExecutionTask(task)) break;
        if (!task.thread_id || reservedThreads.has(task.thread_id)) continue;
        reservedThreads.add(task.thread_id);
        runnable.push(task);
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
    this.database.updateTask(task.id, {
      status: 'running',
      started_at: now(),
      finished_at: null,
      error: null,
    });
    const execution = [task.model, task.effort ? `${task.effort} effort` : null].filter(Boolean);
    this.database.addEvent(
      task.id,
      'queue',
      sessionFollowUp
        ? `Follow-up started immediately in the same terminal session${execution.length > 0 ? ` with ${execution.join(', ')}` : ''}.`
        : execution.length > 0 ? `Task started with ${execution.join(', ')}.` : 'Task started.',
    );
    this.changed(task.id);
  }

  runTask(task, options = {}) {
    this.beginTask(task, options);
    return this.executeTask(task, options);
  }

  async executeTask(task, { sessionFollowUp = false } = {}) {
    try {
      const outcome = await this.runner.run(task, {
        onEvent: ({ event, message }) => {
          this.artifacts.appendRawEvent(task.id, event);
          const kind = event.provider || (
            event.type === 'item/completed' && event.item?.type === 'agentMessage'
              ? 'result'
              : 'codex'
          );
          this.database.addEvent(task.id, kind, message, event);
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
          : 'Codex completed without a final text response.');
      this.database.updateTask(task.id, {
        status: 'complete',
        finished_at: now(),
        session_id: outcome.sessionId,
        result,
        error: null,
        exit_code: outcome.exitCode,
      });
      if (task.mode !== 'plan') {
        this.artifacts.writeResult(task.id, result);
      }
      this.automaticRetryCounts.delete(task.id);
      this.database.addEvent(task.id, 'queue', sessionFollowUp ? 'Follow-up completed.' : 'Task completed.');
    } catch (error) {
      const status = this.stopping ? 'interrupted' : error.cancelled ? 'cancelled' : 'failed';
      const message = this.stopping
        ? 'Relay stopped while this task was running.'
        : error.message;
      const storedError = sessionFollowUp
        ? `${FOLLOW_UP_ERROR_PREFIX} ${status}: ${message}`
        : message;
      this.database.updateTask(task.id, {
        status,
        finished_at: now(),
        error: storedError,
        exit_code: error.exitCode ?? null,
      });
      this.artifacts.writeError(task.id, storedError);
      const retryEligible = !sessionFollowUp
        && status === 'failed'
        && task.mode !== 'plan'
        && error.retryable !== false;
      const willRetry = retryEligible && this.canAutomaticallyRetry(task.id);
      this.database.addEvent(
        task.id,
        'queue',
        this.stopping
          ? 'Task interrupted because Relay stopped.'
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
      this.activeTasks.delete(task.id);
      this.changed(task.id);
      this.emit('taskIdle', task.id);
      if (this.activeTasks.size === 0) this.emit('idle');
      this.schedule();
    }
  }

  async shutdown() {
    this.stopping = true;
    for (const taskId of this.retryTimers.keys()) {
      this.clearAutoRetry(taskId);
    }
    if (this.activeTasks.size === 0 && this.activePreparations.size === 0) {
      return;
    }

    const taskIds = [...this.activeTasks.keys()];
    for (const taskId of taskIds) {
      this.database.addEvent(taskId, 'system', 'Relay shutdown requested.');
    }
    const idle = new Promise((resolve) => this.once('idle', resolve));
    for (const taskId of taskIds) this.runner.cancel(taskId);
    for (const taskId of this.activePreparations.keys()) this.runner.cancel(taskId);
    const preparationPromises = [...this.activePreparations.values()].map(({ promise }) => promise);
    const executionsDone = taskIds.length === 0 ? Promise.resolve() : idle;
    const preparationsDone = Promise.allSettled(preparationPromises);
    const timeout = new Promise((resolve) => {
      const timer = setTimeout(resolve, 3000);
      timer.unref();
    });
    await Promise.race([Promise.all([executionsDone, preparationsDone]), timeout]);
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
