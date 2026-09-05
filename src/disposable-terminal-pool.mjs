import { readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { resolveClaudeTranscriptPath } from './claude-transcript-tail.mjs';
import {
  claudeCompleteLaunchSettings,
  claudeFirstLaunchSettings,
} from './claude-launch-settings.mjs';
import {
  claudeCouncilLaunchTask,
  inspectPlanCouncilCheckpoint,
  planCouncilProviderSettings,
} from './plan-council-runner.mjs';

const PROVIDERS = ['codex', 'claude', 'opencode'];
const TERMINAL_PROVIDERS = ['codex', 'claude'];

function emptyProviderCounts() {
  return { codex: 0, claude: 0, opencode: 0 };
}

function providerName(provider) {
  if (provider === 'opencode') return 'OpenCode';
  return provider === 'claude' ? 'Claude' : 'Codex';
}

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
  if (!isDisposableTerminalTask(task)) return emptyProviderCounts();
  if (task.mode === 'plan') return { codex: 1, claude: 1, opencode: 0 };
  if (task.mode === 'turbo') {
    // One Turbo parent owns one native terminal at a time. A queued planner can overlap with
    // several already-planned parents, but each parent execution is one fresh Codex session.
    return { codex: 1, claude: 0, opencode: 0 };
  }
  if (['execute', 'breakdown'].includes(task.mode) && PROVIDERS.includes(task.provider)) {
    return {
      codex: task.provider === 'codex' ? 1 : 0,
      claude: task.provider === 'claude' ? 1 : 0,
      opencode: task.provider === 'opencode' ? 1 : 0,
    };
  }
  return emptyProviderCounts();
}

export function disposableTerminalConfigurationRequirements(task) {
  if (!isDisposableTerminalTask(task) || task.mode !== 'turbo') {
    return disposableTerminalRequirements(task);
  }
  const configured = Number(task.turbo?.workerCount || 1);
  const executionCount = Number.isInteger(configured) && configured > 0 ? configured : 1;
  const councilEnabled = task.turbo?.council?.enabled === true
    || task.turbo?.councilEnabled === true;
  return {
    codex: executionCount + 1,
    claude: councilEnabled
      && task.turbo?.councilTerminalExecution !== false ? 1 : 0,
    opencode: 0,
  };
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
    this.pendingTurboLaunches = new Set();
  }

  limits(repoPath) {
    const project = this.database.getProjectByPath(repoPath);
    return {
      codex: Number(project?.max_codex_instances || 1),
      claude: Number(project?.max_claude_instances || 1),
      opencode: Number(project?.max_opencode_instances || 1),
    };
  }

  planCheckpoint(task) {
    return task?.mode === 'plan'
      ? inspectPlanCouncilCheckpoint(task, this.artifacts)
      : null;
  }

  requirements(task, checkpoint = null) {
    if (!isDisposableTerminalTask(task) || task.mode !== 'plan') {
      return disposableTerminalRequirements(task);
    }
    const state = checkpoint || this.planCheckpoint(task);
    const providers = new Set((state?.pendingStages || []).map((stage) => stage.provider));
    return {
      codex: providers.has('codex') ? 1 : 0,
      claude: providers.has('claude') ? 1 : 0,
      opencode: 0,
    };
  }

  capacityIssue(task, checkpoint = null) {
    const required = task?.mode === 'plan'
      ? this.requirements(task, checkpoint)
      : disposableTerminalConfigurationRequirements(task);
    const limits = this.limits(task.repo_path);
    for (const provider of PROVIDERS) {
      if (required[provider] > limits[provider]) {
        return `${task.mode === 'turbo' ? 'Turbo' : 'This task'} needs ${required[provider]} ${providerName(provider)} instance${required[provider] === 1 ? '' : 's'}, but this project allows ${limits[provider]}.`;
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
        launch.virtual === true || (
          typeof this.launcher.terminalForLaunch === 'function'
          ? !launch.launchId || this.launcher.terminalForLaunch(launch.launchId)
          : !launch.threadId || this.launcher.terminalForThread(launch.threadId)
        )
      ));
      if (retained.length > 0) this.allocations.set(taskId, retained);
      else this.allocations.delete(taskId);
    }
  }

  usage(repoPath, reservedTasks = []) {
    this.reconcileAllocations();
    const usage = emptyProviderCounts();
    const allocatedByTask = new Map();

    // A native window can take several seconds to bind its conversation identity. Count that
    // interval immediately so direct queue work cannot claim the same provider slot while a
    // just-in-time Turbo stage is still opening.
    for (const pending of this.pendingTurboLaunches) {
      if (pending.repoPath === repoPath && PROVIDERS.includes(pending.provider)) {
        usage[pending.provider] += 1;
        const allocated = allocatedByTask.get(pending.taskId) || emptyProviderCounts();
        allocated[pending.provider] += 1;
        allocatedByTask.set(pending.taskId, allocated);
      }
    }

    for (const [taskId, launches] of this.allocations) {
      const allocationTask = this.database.getTask(taskId);
      const allocationPath = allocationTask?.repo_path
        || launches.find((launch) => launch.repoPath)?.repoPath
        || launches.find((launch) => launch.thread?.cwd)?.thread.cwd
        || null;
      if (allocationPath !== repoPath) continue;
      const allocated = allocatedByTask.get(taskId) || emptyProviderCounts();
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
      const required = this.requirements(task);
      const allocated = allocatedByTask.get(task.id) || emptyProviderCounts();
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
    if (turbo.executionThreadId) ids.add(turbo.executionThreadId);
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
    const required = this.requirements(task);
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

  async launch(task, provider, resumeThreadId, isCancelled, {
    claudeLaunchSettings = null,
    codexLaunchSettings = null,
    allocationMetadata = null,
  } = {}) {
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
      {
        ...launchOptions,
        ...(this.launcher?.embeddedTerminalHost ? { taskId: task.id } : {}),
        ...(claudeLaunchSettings ? { claudeLaunchSettings } : {}),
        ...(codexLaunchSettings ? { codexLaunchSettings } : {}),
      },
    );
    if (!launched.threadId) {
      this.rememberAllocation(task.id, {
        provider,
        repoPath: task.repo_path,
        launchId: launched.launchId || null,
        threadId: null,
        thread: null,
        ...(allocationMetadata || {}),
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
      ...(allocationMetadata || {}),
    };
    this.rememberAllocation(task.id, allocation);
    if (isCancelled()) throw cancelledError();
    return allocation;
  }

  supportsTurboStages(task) {
    return isDisposableTerminalTask(task) && task?.mode === 'turbo';
  }

  async launchTurboStage(task, {
    provider = 'codex',
    role,
    packageId = null,
    slot = null,
    model = null,
    effort = null,
    resumeThreadId = null,
    isCancelled = () => false,
  } = {}) {
    if (!this.supportsTurboStages(task)) {
      throw new Error('Just-in-time Turbo terminals require a disposable Turbo task.');
    }
    if (!['planner', 'council', 'worker'].includes(role)) {
      throw new Error('A Turbo terminal stage needs a planner, council, or worker role.');
    }
    if (!TERMINAL_PROVIDERS.includes(provider)) {
      throw new Error(`Unsupported Turbo terminal provider: ${provider}`);
    }
    const allocations = this.allocations.get(task.id) || [];
    const stageMatches = (allocation) => (
      allocation.turboRole === role
      && allocation.turboPackageId === packageId
      && allocation.turboSlot === slot
    );
    if (allocations.some(stageMatches)
      || [...this.pendingTurboLaunches].some((pending) => pending.taskId === task.id && stageMatches(pending))) {
      throw new Error(`Turbo ${role} terminal is already launching or running.`);
    }
    const usage = this.usage(task.repo_path);
    const limits = this.limits(task.repo_path);
    if (usage[provider] >= limits[provider]) {
      throw Object.assign(
        new Error(`Turbo is waiting for a free ${provider === 'codex' ? 'Codex' : 'Claude'} terminal slot.`),
        { retryable: true, capacityWait: true },
      );
    }
    const pendingLaunch = {
      taskId: task.id,
      provider,
      repoPath: task.repo_path,
      turboRole: role,
      turboPackageId: packageId,
      turboSlot: slot,
    };
    this.pendingTurboLaunches.add(pendingLaunch);
    let allocation;
    try {
      allocation = await this.launch(task, provider, resumeThreadId, isCancelled, {
        ...(provider === 'codex' ? { codexLaunchSettings: { model, effort } } : {}),
        allocationMetadata: {
          turboRole: role,
          turboPackageId: packageId,
          turboSlot: slot,
        },
      });
    } catch (error) {
      const partial = (this.allocations.get(task.id) || []).filter((candidate) => (
        candidate.turboRole === role
        && candidate.turboPackageId === packageId
        && candidate.turboSlot === slot
      ));
      for (const candidate of partial) {
        // A stage whose native launch cannot be closed must not enter the automatic retry loop.
        // Keep the ambiguous launch counted and surface a non-retryable cleanup failure instead.
        await this.finishTurboStage(task.id, candidate, { retain: false, failOnError: true });
      }
      throw error;
    } finally {
      this.pendingTurboLaunches.delete(pendingLaunch);
    }
    try {
      if (role === 'planner' || role === 'council' || (role === 'worker' && packageId === 'execution')) {
        const storedTask = this.database.getTask(task.id);
        const turbo = storedTask?.turbo || task.turbo || {};
        const updatedTurbo = role === 'planner'
          ? {
              ...turbo,
              plannerThreadId: allocation.threadId,
              plannerThreadName: allocation.thread.title || 'Turbo planner',
            }
          : role === 'council'
            ? {
                ...turbo,
                councilThreadId: allocation.threadId,
                councilThreadName: allocation.thread.title || 'Turbo Claude council',
                councilThreadSource: allocation.thread.source,
              }
            : {
                ...turbo,
                executionThreadId: allocation.threadId,
                executionThreadName: allocation.thread.title || 'Turbo execution session',
                executionThreadSource: allocation.thread.source,
              };
        const updated = this.database.updateTask(task.id, {
          ...(role !== 'council' ? {
            thread_id: allocation.threadId,
            thread_name: allocation.thread.title,
            thread_source: allocation.thread.source,
          } : {}),
          turbo_json: JSON.stringify(updatedTurbo),
        });
        this.launcher.confirmTaskTerminalBinding?.(allocation.launchId, task.id, allocation.threadId);
        if (role !== 'council') this.artifacts.updateTaskAssignment(updated);
      }
      this.database.addEvent(
        task.id,
        'queue',
        role === 'worker'
          ? packageId === 'execution'
            ? 'Fresh execution terminal opened for the complete plan.'
            : `Fresh execution terminal opened for ${packageId || `slot ${slot}`}.`
          : `Fresh ${provider === 'claude' ? 'Claude ' : ''}${role} terminal opened.`,
      );
      return allocation;
    } catch (error) {
      await this.finishTurboStage(task.id, allocation, { retain: false, failOnError: true });
      throw error;
    }
  }

  sameAllocation(left, right) {
    if (!left || !right) return false;
    if (left.launchId && right.launchId) return left.launchId === right.launchId;
    return left === right;
  }

  removeAllocation(taskId, target) {
    const allocations = this.allocations.get(taskId) || [];
    const retained = allocations.filter((allocation) => !this.sameAllocation(allocation, target));
    if (retained.length > 0) this.allocations.set(taskId, retained);
    else this.allocations.delete(taskId);
  }

  async finishTurboStage(taskId, allocation, { retain = null, failOnError = false } = {}) {
    const allocations = this.allocations.get(taskId) || [];
    const owned = allocations.find((candidate) => this.sameAllocation(candidate, allocation));
    if (!owned) return { closed: 0, retained: 0, failed: 0 };
    if (!owned.launchId && !owned.threadId) {
      this.removeAllocation(taskId, owned);
      this.diagnostic('terminal.pool.cleanup_skipped', {
        taskId,
        provider: owned.provider,
        turboRole: owned.turboRole,
        reason: 'no-exact-native-target',
      });
      return { closed: 0, retained: 0, failed: 0 };
    }
    const keepOpen = retain == null
      ? this.database.getTask(taskId)?.keep_terminal_open === true
      : retain === true;
    try {
      if (keepOpen) {
        if (!owned.launchId || typeof this.launcher.retainOwnedLaunch !== 'function') {
          throw new Error('CC Relay cannot promote this Turbo terminal to a retained session.');
        }
        await this.launcher.retainOwnedLaunch(owned.launchId);
      } else if (owned.launchId && typeof this.launcher.closeOwnedLaunch === 'function') {
        await this.launcher.closeOwnedLaunch(owned.launchId);
      } else {
        await this.launcher.closeOwnedTerminal(owned.threadId);
      }
    } catch (error) {
      this.diagnostic(keepOpen ? 'terminal.pool.retain_failed' : 'terminal.pool.cleanup_failed', {
        taskId,
        provider: owned.provider,
        launchId: owned.launchId,
        threadId: owned.threadId,
        turboRole: owned.turboRole,
        turboPackageId: owned.turboPackageId,
        error: error.message,
      });
      try {
        this.database.addEvent(
          taskId,
          'system',
          `CC Relay could not ${keepOpen ? 'keep open' : 'close'} one Turbo ${owned.turboRole || 'stage'} terminal: ${error.message}`,
        );
      } catch (eventError) {
        this.diagnostic('terminal.pool.event_failed', {
          taskId,
          turboRole: owned.turboRole,
          error: eventError.message,
        });
      }
      if (failOnError) {
        throw Object.assign(
          new Error(`Turbo ${owned.turboRole || 'planning'} terminal cleanup failed: ${error.message}`),
          { retryable: false, terminalCleanupFailed: true },
        );
      }
      return { closed: 0, retained: 0, failed: 1 };
    }
    this.removeAllocation(taskId, owned);
    const role = owned.turboRole === 'worker'
      ? owned.turboPackageId === 'execution'
        ? 'execution session'
        : `worker session for ${owned.turboPackageId || `slot ${owned.turboSlot}`}`
      : `${owned.turboRole || 'Turbo'} session`;
    try {
      this.database.addEvent(
        taskId,
        'queue',
        keepOpen ? `${role} kept open for more work.` : `${role} closed; its conversation can be resumed later.`,
      );
    } catch (error) {
      this.diagnostic('terminal.pool.event_failed', {
        taskId,
        turboRole: owned.turboRole,
        error: error.message,
      });
    }
    return { closed: keepOpen ? 0 : 1, retained: keepOpen ? 1 : 0, failed: 0 };
  }

  async prepare(task, { isCancelled = () => false } = {}) {
    if (!isDisposableTerminalTask(task)) return task;
    if (this.allocations.has(task.id)) {
      throw new Error('This task already owns a disposable terminal allocation.');
    }
    const checkpoint = this.planCheckpoint(task);
    const issue = this.capacityIssue(task, checkpoint);
    if (issue) throw Object.assign(new Error(issue), { retryable: false });

    this.database.addEvent(
      task.id,
      'queue',
      task.mode === 'turbo'
        ? 'Turbo will launch one planner terminal and one execution terminal only when each stage starts.'
        : task.mode === 'plan' && checkpoint?.pendingStages?.length === 0
          ? 'All provider stages are checkpointed. Retrying final plan persistence without launching a terminal.'
        : task.mode === 'plan' && checkpoint?.pendingStages?.length === 1
          ? `Saved council artifacts leave only the ${checkpoint.pendingStages[0].label} stage. Launching only that provider.`
        : task.provider === 'opencode'
          ? 'Reserving a headless OpenCode execution slot for this task.'
          : 'Launching disposable terminal instances for this task.',
    );
    try {
      if (task.mode === 'plan') {
        // These legacy columns now identify provider terminals, not fixed roles:
        // author_thread_id stores Claude and thread_id stores Codex for both council orders.
        const pendingStages = checkpoint?.pendingStages || [];
        if (pendingStages.length === 0) {
          return task;
        }
        const pendingProviders = new Set(pendingStages.map((stage) => stage.provider));
        const revisionOnly = pendingStages.length === 1 && pendingStages[0].id === 'revision';
        const launched = {};
        if (pendingProviders.has('claude')) {
          launched.claude = await this.launch(
            task,
            'claude',
            revisionOnly ? null : task.author_thread_id,
            isCancelled,
            {
              claudeLaunchSettings: claudeCompleteLaunchSettings(
                claudeCouncilLaunchTask(task),
              ),
            },
          );
        }
        if (pendingProviders.has('codex')) {
          const settings = planCouncilProviderSettings(task, 'codex');
          launched.codex = await this.launch(
            task,
            'codex',
            revisionOnly ? null : task.thread_id,
            isCancelled,
            {
              codexLaunchSettings: settings.model || settings.effort
                ? { model: settings.model || null, effort: settings.effort || null }
                : null,
            },
          );
        }
        const updated = this.database.updateTask(task.id, {
          ...(launched.codex ? {
            thread_id: launched.codex.threadId,
            thread_name: launched.codex.thread.title,
            thread_source: launched.codex.thread.source,
          } : {}),
          ...(launched.claude ? {
            author_thread_id: launched.claude.threadId,
            author_thread_name: launched.claude.thread.title,
            author_thread_source: launched.claude.thread.source,
          } : {}),
        });
        for (const terminal of Object.values(launched)) {
          this.launcher.confirmTaskTerminalBinding?.(terminal.launchId, task.id, terminal.threadId);
        }
        this.artifacts.updateTaskAssignment(updated);
        this.artifacts.updateCouncilAuthorAssignment(updated);
        this.database.addEvent(
          task.id,
          'queue',
          revisionOnly
            ? `Saved draft.md and review.md were found. A fresh ${providerName(pendingStages[0].provider)} author terminal is ready for the final revision.`
            : 'Claude and Codex council terminals are ready.',
        );
        return updated;
      }

      if (task.mode === 'turbo') {
        // Turbo owns a planner stage and one complete-plan execution stage. The configured count
        // limits concurrent parent executions in the queue. Returning without a launch here
        // prevents idle pre-warmed windows; the runner opens and closes each stage just in time.
        return task;
      }

      if (task.provider === 'opencode') {
        if (isCancelled()) throw cancelledError();
        this.rememberAllocation(task.id, {
          provider: 'opencode',
          repoPath: task.repo_path,
          launchId: null,
          threadId: task.thread_id || null,
          thread: null,
          virtual: true,
        });
        const updated = this.database.updateTask(task.id, {
          thread_name: task.thread_name || 'OpenCode headless session',
          thread_source: 'CC Relay managed headless runner',
        });
        this.artifacts.updateTaskAssignment(updated);
        this.database.addEvent(task.id, 'queue', 'OpenCode headless execution slot is ready.');
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
      const codexLaunchSettings = provider === 'codex' && (task.model || task.effort)
        ? { model: task.model || null, effort: task.effort || null }
        : null;
      const terminal = await this.launch(task, provider, task.thread_id, isCancelled, {
        claudeLaunchSettings,
        codexLaunchSettings,
      });
      const updated = this.database.updateTask(task.id, {
        thread_id: terminal.threadId,
        thread_name: terminal.thread.title,
        thread_source: terminal.thread.source,
      });
      this.launcher.confirmTaskTerminalBinding?.(terminal.launchId, task.id, terminal.threadId);
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
      if (allocation.virtual === true) continue;
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
      if (allocation.virtual === true) continue;
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
