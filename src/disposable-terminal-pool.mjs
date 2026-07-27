const PROVIDERS = ['codex', 'claude'];

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
    new Error('Task cancelled while Relay was preparing its terminal.'),
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
  }) {
    this.database = database;
    this.artifacts = artifacts;
    this.coordinator = coordinator;
    this.launcher = launcher;
    this.diagnostic = diagnostic;
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

  async launch(task, provider, resumeThreadId, isCancelled) {
    if (isCancelled()) throw cancelledError();
    const launched = await this.coordinator.launch(
      task.repo_path,
      provider,
      task.terminal_layout,
      { resumeThreadId: resumeThreadId || null },
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
        || `The ${provider === 'codex' ? 'Codex' : 'Claude'} terminal did not connect to Relay in time.`;
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
        source: 'Relay managed terminal',
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
        const author = await this.launch(task, 'claude', task.author_thread_id, isCancelled);
        const reviewer = await this.launch(task, 'codex', task.thread_id, isCancelled);
        const updated = this.database.updateTask(task.id, {
          thread_id: reviewer.threadId,
          thread_name: reviewer.thread.title,
          thread_source: reviewer.thread.source,
          author_thread_id: author.threadId,
          author_thread_name: author.thread.title,
          author_thread_source: author.thread.source,
        });
        this.artifacts.updateTaskAssignment(updated);
        this.artifacts.updateCouncilAuthorAssignment(updated);
        this.database.addEvent(task.id, 'queue', 'Claude author and Codex reviewer terminals are ready.');
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
      const terminal = await this.launch(task, provider, task.thread_id, isCancelled);
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
            `Relay could not close one disposable ${allocation.provider === 'codex' ? 'Codex' : 'Claude'} terminal: ${error.message}`,
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
}
