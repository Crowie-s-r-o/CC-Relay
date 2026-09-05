const SUPPORTED_PROVIDERS = new Set(['codex', 'claude', 'opencode']);

// IDs come exclusively from the persisted task, never from a selected project or native handle.
export function taskTerminalCandidates(task) {
  if (!task) return [];
  const candidates = [];
  const add = (id, provider, label) => {
    if (typeof id !== 'string' || !id || !SUPPORTED_PROVIDERS.has(provider)) return;
    if (candidates.some((item) => item.id === id && item.provider === provider)) return;
    candidates.push({ id, provider, cwd: task.repo_path, label });
  };
  if (task.mode === 'plan') {
    add(task.thread_id, 'codex', 'Codex');
    add(task.author_thread_id, 'claude', 'Claude');
  } else {
    add(task.thread_id, task.provider, task.provider);
  }
  if (task.mode === 'turbo') {
    add(task.turbo?.plannerThreadId || task.turbo?.planner?.threadId, 'codex', 'Planner');
    const workers = Array.isArray(task.turbo?.workers) ? task.turbo.workers : [];
    for (const [index, worker] of workers.entries()) {
      add(worker?.threadId, 'codex', `Worker ${index + 1}`);
    }
  }
  return candidates;
}

export class TaskOriginalTerminal {
  constructor({ database, launcher, knownThread, claudeMode = () => null, platform = process.platform }) {
    Object.assign(this, { database, launcher, knownThread, claudeMode, platform });
  }

  targets(task) {
    return taskTerminalCandidates(task).filter((thread) => {
      if (thread.provider === 'opencode') return false;
      if (thread.provider === 'claude' && (this.platform !== 'darwin'
        || this.claudeMode(thread.id) === 'headless')) return false;
      const owned = this.launcher.terminalForThread(thread.id);
      return owned?.provider === thread.provider && owned.path === thread.cwd;
    });
  }

  async read(taskId, requestedThreadId = null, { isRequested = () => true } = {}) {
    const unavailable = (message) => ({ state: 'unavailable', text: '', busy: false, message });
    const task = this.database.getTask(taskId);
    if (!task) return unavailable('This task no longer exists.');
    if (this.platform !== 'darwin') {
      return unavailable('The original terminal screen is unavailable on this platform. Use Relay activity below.');
    }
    const targets = this.targets(task);
    if (!targets.length) {
      if (!taskTerminalCandidates(task).length && ['queued', 'running'].includes(task.status)) {
        return { state: 'connecting', text: '', busy: false, message: 'Waiting for this task’s terminal to connect.' };
      }
      return unavailable('This task has no verified interactive terminal. Its conversation and activity are available below.');
    }
    const target = requestedThreadId
      ? targets.find((item) => item.id === requestedThreadId)
      : targets.length === 1 ? targets[0] : null;
    if (!target) {
      return requestedThreadId
        ? unavailable('That terminal is no longer part of this task.')
        : { state: 'choose', text: '', busy: false, targets: targets.map(({ id, provider, label }) => ({ id, provider, label })) };
    }
    const launchId = this.launcher.terminalForThread(target.id)?.launchId;
    const isCurrent = () => {
      const latest = this.database.getTask(taskId);
      return isRequested() && latest?.repo_path === task.repo_path && latest.provider === task.provider
        && latest.mode === task.mode
        && this.targets(latest).some((item) => item.id === target.id && item.provider === target.provider)
        && this.launcher.terminalForThread(target.id)?.launchId === launchId;
    };
    try {
      if (!isCurrent()) return unavailable('The task terminal changed before it could be read.');
      const terminal = await this.launcher.readTerminalScreen(target.id, { ...this.knownThread(target), ...target });
      if (!isCurrent()) return unavailable('The task terminal changed while it was being read.');
      return {
        ...terminal,
        taskId,
        threadId: target.id,
        provider: target.provider,
        source: 'Terminal.app',
        capturedAt: new Date().toISOString(),
        targets: targets.length > 1 ? targets.map(({ id, provider, label }) => ({ id, provider, label })) : [],
        message: terminal.state === 'live' ? '' : 'The original terminal screen is temporarily unavailable. You can use Relay activity.',
      };
    } catch {
      return unavailable('Could not read the original terminal screen. You can use Relay activity.');
    }
  }

  async open(taskId, requestedThreadId = null, { isRequested = () => true } = {}) {
    const task = this.database.getTask(taskId);
    if (!task) return { state: 'unavailable', message: 'This task no longer exists.' };
    if (!['darwin', 'win32'].includes(this.platform)) {
      return { state: 'unavailable', message: 'Use Relay activity on this platform. Original terminal opening supports macOS and Windows.' };
    }
    const targets = this.targets(task);
    if (!targets.length) {
      const headless = task.provider === 'opencode'
        || (task.provider === 'claude' && (this.platform !== 'darwin'
          || this.claudeMode(task.thread_id) === 'headless'));
      return {
        state: 'unavailable',
        message: headless
          ? 'This task runs without an interactive terminal. Its conversation and live activity are available below.'
          : 'This task has no verified open terminal. Its saved conversation and activity are available below.',
      };
    }
    const target = requestedThreadId
      ? targets.find((item) => item.id === requestedThreadId)
      : targets.length === 1 ? targets[0] : null;
    if (!target) {
      return requestedThreadId
        ? { state: 'unavailable', message: 'That terminal is no longer part of this task.' }
        : { state: 'choose', targets: targets.map(({ id, provider, label }) => ({ id, provider, label })) };
    }
    const launchId = this.launcher.terminalForThread(target.id)?.launchId;
    const isCurrent = () => {
      const latest = this.database.getTask(taskId);
      return isRequested() && latest?.repo_path === task.repo_path && latest.provider === task.provider
        && latest.mode === task.mode
        && this.targets(latest).some((item) => item.id === target.id && item.provider === target.provider)
        && this.launcher.terminalForThread(target.id)?.launchId === launchId;
    };
    try {
      const known = this.knownThread(target);
      return await this.launcher.openOriginalTerminal({ ...known, ...target }, { isCurrent });
    } catch (error) {
      return { state: 'unavailable', message: `${error.message} Use Relay activity below.` };
    }
  }
}
