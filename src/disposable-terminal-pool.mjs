import { readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { resolveClaudeTranscriptPath } from './claude-transcript-tail.mjs';
import { claudeFirstLaunchSettings } from './claude-launch-settings.mjs';

const PROVIDERS = ['codex', 'claude'];

export function inspectClaudeConversation(repoPath, sessionId, {
  resolveTranscriptPath = resolveClaudeTranscriptPath,
  stat = statSync,
} = {}) {
  const transcriptPath = resolveTranscriptPath(repoPath, sessionId);
  try {
    return stat(transcriptPath).size > 0 ? 'present' : 'missing';
  } catch (error) {
    return error?.code === 'ENOENT' ? 'missing' : 'unknown';
  }
}

function codexRolloutPaths(threadId, {
  codexHome = join(homedir(), '.codex'),
  readDirectory = readdirSync,
} = {}) {
  const paths = [];
  const endings = [
    `-${threadId}.jsonl`,
    `-${threadId}.jsonl.zst`,
    `-${threadId}.json`,
  ];
  for (const root of [
    join(codexHome, 'sessions'),
    join(codexHome, 'archived_sessions'),
  ]) {
    let entries;
    try {
      entries = readDirectory(root, { recursive: true, withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw error;
    }
    for (const entry of entries) {
      if (!entry.isFile() || !endings.some((ending) => entry.name.endsWith(ending))) continue;
      paths.push(join(entry.parentPath || entry.path || root, entry.name));
    }
  }
  return paths;
}

export function inspectCodexConversation(threadId, {
  codexHome,
  readDirectory,
  findRollouts = null,
  stat = statSync,
} = {}) {
  let rolloutPaths;
  try {
    rolloutPaths = findRollouts
      ? findRollouts(threadId)
      : codexRolloutPaths(threadId, { codexHome, readDirectory });
  } catch (error) {
    return error?.code === 'ENOENT' ? 'missing' : 'unknown';
  }
  let emptyRollout = false;
  for (const rolloutPath of rolloutPaths) {
    try {
      if (stat(rolloutPath).size > 0) return 'present';
      emptyRollout = true;
    } catch (error) {
      if (error?.code !== 'ENOENT') return 'unknown';
    }
  }
  return emptyRollout || rolloutPaths.length === 0 ? 'missing' : 'unknown';
}

export function isDisposableTerminalTask(task) {
  return task?.terminal_lifecycle === 'disposable';
}

export function disposableTerminalRequirements(task) {
  if (!isDisposableTerminalTask(task)) return { codex: 0, claude: 0 };
  if (task.mode === 'plan') return { codex: 1, claude: 1 };
  if (task.mode === 'turbo') {
    const workerCount = Number(task.turbo?.workerCount || task.turbo?.workers?.length || 0);
    const councilEnabled = task.turbo?.council?.enabled === true
      || task.turbo?.councilEnabled === true;
    const councilTerminal = councilEnabled && task.turbo?.councilTerminalExecution !== false;
    return { codex: Math.max(1, workerCount + 1), claude: councilTerminal ? 1 : 0 };
  }
  if (['execute', 'breakdown'].includes(task.mode) && PROVIDERS.includes(task.provider)) {
    return {
      codex: task.provider === 'codex' ? 1 : 0,
      claude: task.provider === 'claude' ? 1 : 0,
    };
  }
  return { codex: 0, claude: 0 };
}

function cancelledError() {
  return Object.assign(
    new Error('Task cancelled while CC Relay was preparing its terminal.'),
    { cancelled: true, retryable: false },
  );
}

export class DisposableTerminalPool {
  constructor({
    database,
    artifacts,
    coordinator,
    launcher,
    diagnostic = () => {},
    claudeConversationState = inspectClaudeConversation,
    codexConversationState = inspectCodexConversation,
  }) {
    this.database = database;
    this.artifacts = artifacts;
    this.coordinator = coordinator;
    this.launcher = launcher;
    this.diagnostic = diagnostic;
    this.claudeConversationState = claudeConversationState;
    this.codexConversationState = codexConversationState;
    this.allocations = new Map();
  }

  limits(repoPath) {
    const project = this.database.getProjectByPath(repoPath);
    return {
      codex: Number(project?.max_codex_instances || 1),
      claude: Number(project?.max_claude_instances || 1),
    };
  }

  capacityIssue(task) {
    const required = disposableTerminalRequirements(task);
    const limits = this.limits(task.repo_path);
    for (const provider of PROVIDERS) {
      if (required[provider] > limits[provider]) {
        return `${task.mode === 'turbo' ? 'Turbo' : 'This task'} needs ${required[provider]} ${provider === 'codex' ? 'Codex' : 'Claude'} instance${required[provider] === 1 ? '' : 's'}, but this project allows ${limits[provider]}.`;
      }
    }
    return '';
  }

  reconcileAllocations() {
    if (
      typeof this.launcher.terminalForLaunch !== 'function'
      && typeof this.launcher.terminalForThread !== 'function'
    ) return;
    for (const [taskId, launches] of this.allocations) {
      const retained = launches.filter((launch) => (
        typeof this.launcher.terminalForLaunch === 'function'
          ? !launch.launchId || this.launcher.terminalForLaunch(launch.launchId)
          : !launch.threadId || this.launcher.terminalForThread(launch.threadId)
      ));
      if (retained.length > 0) this.allocations.set(taskId, retained);
      else this.allocations.delete(taskId);
    }
  }

  usage(repoPath, reservedTasks = []) {
    this.reconcileAllocations();
    const usage = { codex: 0, claude: 0 };
    const allocatedByTask = new Map();

    for (const [taskId, launches] of this.allocations) {
      const allocationTask = this.database.getTask(taskId);
      const allocationPath = allocationTask?.repo_path
        || launches.find((launch) => launch.repoPath)?.repoPath
        || launches.find((launch) => launch.thread?.cwd)?.thread.cwd
        || null;
      if (allocationPath !== repoPath) continue;
      const allocated = { codex: 0, claude: 0 };
      for (const launch of launches) {
        if (!PROVIDERS.includes(launch.provider)) continue;
        usage[launch.provider] += 1;
        allocated[launch.provider] += 1;
      }
      allocatedByTask.set(taskId, allocated);
    }

    const countedReservations = new Set();
    for (const task of reservedTasks) {
      if (
        !isDisposableTerminalTask(task)
        || task.repo_path !== repoPath
        || countedReservations.has(task.id)
      ) continue;
      countedReservations.add(task.id);
      const required = disposableTerminalRequirements(task);
      const allocated = allocatedByTask.get(task.id) || { codex: 0, claude: 0 };
      for (const provider of PROVIDERS) {
        usage[provider] += Math.max(0, required[provider] - allocated[provider]);
      }
    }
    return usage;
  }

  taskConversationIds(task) {
    const ids = new Set();
    if (task?.thread_id) ids.add(task.thread_id);
    if (task?.author_thread_id) ids.add(task.author_thread_id);
    const turbo = task?.turbo || {};
    if (turbo.plannerThreadId) ids.add(turbo.plannerThreadId);
    if (turbo.councilThreadId) ids.add(turbo.councilThreadId);
    for (const worker of turbo.workers || []) {
      if (worker?.threadId) ids.add(worker.threadId);
    }
    return ids;
  }

  hasAllocatedConversation(task) {
    const conversationIds = this.taskConversationIds(task);
    if (conversationIds.size === 0) return false;
    return [...this.allocations.values()].some((launches) => launches.some((launch) => (
      launch.threadId && conversationIds.has(launch.threadId)
    )));
  }

  canRun(task, reservedTasks = []) {
    if (!isDisposableTerminalTask(task)) return true;
    this.reconcileAllocations();
    if (this.hasAllocatedConversation(task)) return false;
    if (this.capacityIssue(task)) return false;
    const usage = this.usage(task.repo_path, reservedTasks);
    const required = disposableTerminalRequirements(task);
    const limits = this.limits(task.repo_path);
    return PROVIDERS.every((provider) => usage[provider] + required[provider] <= limits[provider]);
  }

  projectStatus(repoPath, reservedTasks = []) {
    return { limits: this.limits(repoPath), active: this.usage(repoPath, reservedTasks) };
  }

  rememberAllocation(taskId, allocation) {
    const allocations = this.allocations.get(taskId) || [];
    allocations.push(allocation);
    this.allocations.set(taskId, allocations);
    return allocation;
  }

  async launch(task, provider, resumeThreadId, isCancelled, { claudeLaunchSettings = null } = {}) {
    if (isCancelled()) throw cancelledError();
    let launchOptions = { resumeThreadId: resumeThreadId || null };
    if (provider === 'claude' && resumeThreadId && task.sessionFollowUp !== true) {
      let conversationState = 'unknown';
      try {
        conversationState = this.claudeConversationState(task.repo_path, resumeThreadId);
      } catch (error) {
        this.diagnostic('terminal.pool.claude_session_inspection_failed', {
          taskId: task.id,
          threadId: resumeThreadId,
          repoPath: task.repo_path,
          error: error.message,
        });
      }
      if (conversationState === 'missing') {
        launchOptions = { initializeThreadId: resumeThreadId };
        this.diagnostic('terminal.pool.claude_session_initializing', {
          taskId: task.id,
          threadId: resumeThreadId,
          repoPath: task.repo_path,
        });
        this.database.addEvent(
          task.id,
          'queue',
          'The saved Claude session has no conversation transcript, so CC Relay is reopening its UUID for the first turn.',
        );
      }
    }
    if (provider === 'codex' && resumeThreadId && task.sessionFollowUp !== true) {
      let conversationState = 'unknown';
      try {
        conversationState = this.codexConversationState(resumeThreadId);
      } catch (error) {
        this.diagnostic('terminal.pool.codex_thread_inspection_failed', {
          taskId: task.id,
          threadId: resumeThreadId,
          repoPath: task.repo_path,
          error: error.message,
        });
      }
      if (conversationState === 'missing') {
        launchOptions = { resumeThreadId: null };
        this.diagnostic('terminal.pool.codex_thread_starting_fresh', {
          taskId: task.id,
          previousThreadId: resumeThreadId,
          repoPath: task.repo_path,
        });
        this.database.addEvent(
          task.id,
          'queue',
          'The saved Codex thread has no rollout, so CC Relay is opening a fresh conversation for this retry.',
        );
      }
    }
    const launched = await this.coordinator.launch(
      task.repo_path,
      provider,
      task.terminal_layout,
      // Spread last so the fresh-versus-resume decision above stays authoritative while the
      // task's model and effort ride along on whichever session argument it chose.
      { ...launchOptions, ...(claudeLaunchSettings ? { claudeLaunchSettings } : {}) },
    );
    if (!launched.threadId) {
      this.rememberAllocation(task.id, {
        provider,
        repoPath: task.repo_path,
        launchId: launched.launchId || null,
        threadId: null,
        thread: null,
      });
      this.diagnostic('terminal.pool.binding_failed', {
        taskId: task.id,
        provider,
        launchId: launched.launchId || null,
        connectionStatus: launched.connectionStatus || null,
        error: launched.bindingError || null,
      });
      const message = launched.bindingError
        || `The ${provider === 'codex' ? 'Codex' : 'Claude'} terminal did not connect to CC Relay in time.`;
      throw Object.assign(new Error(message), {
        // A rejected identity binding is not transient. A resumed conversation timeout also
        // requires inspection because the CLI may already have loaded that conversation.
        // In both cases opening more terminals automatically only multiplies ambiguity.
        retryable: launched.connectionStatus !== 'binding_rejected' && !resumeThreadId,
      });
    }
    const allocation = {
      provider,
      repoPath: task.repo_path,
      launchId: launched.launchId,
      threadId: launched.threadId,
      thread: launched.thread || {
        id: launched.threadId,
        provider,
        cwd: task.repo_path,
        title: `${provider === 'codex' ? 'Codex' : 'Claude'} task terminal`,
        source: 'CC Relay managed terminal',
      },
    };
    this.rememberAllocation(task.id, allocation);
    if (isCancelled()) throw cancelledError();
    return allocation;
  }

  async prepare(task, { isCancelled = () => false } = {}) {
    if (!isDisposableTerminalTask(task)) return task;
    if (this.allocations.has(task.id)) {
      throw new Error('This task already owns a disposable terminal allocation.');
    }
    const issue = this.capacityIssue(task);
    if (issue) throw Object.assign(new Error(issue), { retryable: false });

    this.database.addEvent(task.id, 'queue', 'Launching disposable terminal instances for this task.');
    try {
      if (task.mode === 'plan') {
        // These legacy columns now identify provider terminals, not fixed roles:
        // author_thread_id stores Claude and thread_id stores Codex for both council orders.
        const claude = await this.launch(task, 'claude', task.author_thread_id, isCancelled);
        const codex = await this.launch(task, 'codex', task.thread_id, isCancelled);
        const updated = this.database.updateTask(task.id, {
          thread_id: codex.threadId,
          thread_name: codex.thread.title,
          thread_source: codex.thread.source,
          author_thread_id: claude.threadId,
          author_thread_name: claude.thread.title,
          author_thread_source: claude.thread.source,
        });
        this.artifacts.updateTaskAssignment(updated);
        this.artifacts.updateCouncilAuthorAssignment(updated);
        this.database.addEvent(task.id, 'queue', 'Claude and Codex council terminals are ready.');
        return updated;
      }

      if (task.mode === 'turbo') {
        const turbo = task.turbo || {};
        const workerCount = Number(turbo.workerCount || turbo.workers?.length || 0);
        const planner = await this.launch(
          task,
          'codex',
          turbo.plannerThreadId || task.thread_id,
          isCancelled,
        );
        const workers = [];
        for (let index = 0; index < workerCount; index += 1) {
          const previous = turbo.workers?.[index];
          const worker = await this.launch(task, 'codex', previous?.threadId, isCancelled);
          workers.push({
            threadId: worker.threadId,
            title: worker.thread.title || `Codex worker ${index + 1}`,
          });
        }
        const councilEnabled = turbo.council?.enabled === true || turbo.councilEnabled === true;
        const council = councilEnabled && turbo.councilTerminalExecution !== false
          ? await this.launch(task, 'claude', turbo.councilThreadId, isCancelled)
          : null;
        const updatedTurbo = {
          ...turbo,
          plannerThreadId: planner.threadId,
          workers,
          ...(council ? {
            councilThreadId: council.threadId,
            councilThreadName: council.thread.title,
            councilThreadSource: council.thread.source,
          } : {}),
        };
        const updated = this.database.updateTask(task.id, {
          thread_id: planner.threadId,
          thread_name: planner.thread.title,
          thread_source: planner.thread.source,
          turbo_json: JSON.stringify(updatedTurbo),
        });
        this.artifacts.updateTaskAssignment(updated);
        this.database.addEvent(
          task.id,
          'queue',
          `Codex planner, ${workers.length} disposable worker terminal${workers.length === 1 ? '' : 's'}${council ? ', and one Claude council terminal' : ''} are ready.`,
        );
        return updated;
      }

      const provider = task.provider;
      // Direct Execute is the one path where the pool and the executor read the SAME stored task
      // row through the SAME function, so the launch command can carry the turn's model and
      // effort and the executor can prove it does not need to restart the process. Plan council
      // and Turbo synthesize their stage settings at run time and keep the relaunch path.
      const claudeLaunchSettings = provider === 'claude'
        ? claudeFirstLaunchSettings(task)
        : null;
      const terminal = await this.launch(task, provider, task.thread_id, isCancelled, {
        claudeLaunchSettings,
      });
      const updated = this.database.updateTask(task.id, {
        thread_id: terminal.threadId,
        thread_name: terminal.thread.title,
        thread_source: terminal.thread.source,
      });
      this.artifacts.updateTaskAssignment(updated);
      this.database.addEvent(
        task.id,
        'queue',
        `${provider === 'codex' ? 'Codex' : 'Claude'} disposable terminal is ready.`,
      );
      return updated;
    } catch (error) {
      await this.release(task.id);
      throw error;
    }
  }

  async release(taskId) {
    const allocations = this.allocations.get(taskId) || [];
    if (allocations.length === 0) return { closed: 0, failed: 0 };
    let closed = 0;
    const retained = [];
    for (const allocation of [...allocations].reverse()) {
      if (!allocation.launchId && !allocation.threadId) {
        // Nothing exact to close. Reporting this as closed would overstate cleanup, and
        // closing by a null conversation ID used to match whichever owned launch was still
        // binding, which could destroy another task's terminal. Drop the accounting entry
        // only, because it never held a native handle.
        this.diagnostic('terminal.pool.cleanup_skipped', {
          taskId,
          provider: allocation.provider,
          reason: 'no-exact-native-target',
        });
        continue;
      }
      try {
        if (allocation.launchId && typeof this.launcher.closeOwnedLaunch === 'function') {
          await this.launcher.closeOwnedLaunch(allocation.launchId);
        } else {
          await this.launcher.closeOwnedTerminal(allocation.threadId);
        }
        closed += 1;
      } catch (error) {
        retained.push(allocation);
        this.diagnostic('terminal.pool.cleanup_failed', {
          taskId,
          provider: allocation.provider,
          launchId: allocation.launchId,
          threadId: allocation.threadId,
          error: error.message,
        });
        const task = this.database.getTask(taskId);
        if (task) {
          this.database.addEvent(
            taskId,
            'system',
            `CC Relay could not close one disposable ${allocation.provider === 'codex' ? 'Codex' : 'Claude'} terminal: ${error.message}`,
          );
        }
      }
    }
    if (retained.length > 0) this.allocations.set(taskId, retained);
    else this.allocations.delete(taskId);
    if (closed > 0 && this.database.getTask(taskId)) {
      this.database.addEvent(
        taskId,
        'queue',
        `${closed} disposable terminal instance${closed === 1 ? '' : 's'} closed.`,
      );
    }
    return { closed, failed: retained.length };
  }

  async retain(taskId) {
    const allocations = this.allocations.get(taskId) || [];
    if (allocations.length === 0) return { retained: 0, failed: 0 };
    let retainedCount = 0;
    const failed = [];
    for (const allocation of allocations) {
      try {
        if (!allocation.launchId || typeof this.launcher.retainOwnedLaunch !== 'function') {
          throw new Error('CC Relay cannot promote this terminal launch to a retained session.');
        }
        await this.launcher.retainOwnedLaunch(allocation.launchId);
        retainedCount += 1;
      } catch (error) {
        failed.push(allocation);
        this.diagnostic('terminal.pool.retain_failed', {
          taskId,
          provider: allocation.provider,
          launchId: allocation.launchId,
          threadId: allocation.threadId,
          error: error.message,
        });
        const task = this.database.getTask(taskId);
        if (task) {
          this.database.addEvent(
            taskId,
            'system',
            `CC Relay could not keep one ${allocation.provider === 'codex' ? 'Codex' : 'Claude'} terminal open: ${error.message}`,
          );
        }
      }
    }
    if (failed.length > 0) this.allocations.set(taskId, failed);
    else this.allocations.delete(taskId);
    if (retainedCount > 0 && this.database.getTask(taskId)) {
      this.database.addEvent(
        taskId,
        'queue',
        `${retainedCount} terminal instance${retainedCount === 1 ? '' : 's'} kept open for more work.`,
      );
    }
    return { retained: retainedCount, failed: failed.length };
  }
}
