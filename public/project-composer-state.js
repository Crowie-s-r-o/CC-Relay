import { normalizeClaudeModelSelection } from './claude-model-selection.js';

function cloneValue(value) {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneValue(item)]));
  }
  return value;
}

export function projectComposerKey(path) {
  const normalized = String(path || '').replace(/[\\/]+$/, '').replaceAll('\\', '/');
  if (!normalized) throw new Error('A project path is required for composer state.');
  return normalized;
}

export function freshProjectTerminalSettings() {
  return {
    keepTerminalOpen: false,
    preferIdleTerminal: false,
    layout: {
      enabled: true,
      columns: 3,
      rows: 3,
      display: 0,
      background: true,
    },
  };
}

export function normalizeProjectTerminalSettings(project, fallback = freshProjectTerminalSettings()) {
  const defaults = freshProjectTerminalSettings();
  const fallbackSettings = fallback && typeof fallback === 'object' ? fallback : defaults;
  const hasProjectLayout = project && Object.hasOwn(project, 'terminal_layout');
  const layoutDefaults = hasProjectLayout
    ? defaults.layout
    : { ...defaults.layout, ...(fallbackSettings.layout || {}) };
  const storedLayout = project?.terminal_layout && typeof project.terminal_layout === 'object'
    ? project.terminal_layout
    : layoutDefaults;
  const integerOr = (value, defaultValue, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) => {
    const number = Number(value);
    return Number.isInteger(number) && number >= minimum && number <= maximum
      ? number
      : defaultValue;
  };
  const hasKeepSetting = project && Object.hasOwn(project, 'keep_terminal_open');
  const hasIdleSetting = project && Object.hasOwn(project, 'prefer_idle_terminal');
  return {
    keepTerminalOpen: hasKeepSetting
      ? project.keep_terminal_open === true || project.keep_terminal_open === 1
      : fallbackSettings.keepTerminalOpen === true,
    preferIdleTerminal: hasIdleSetting
      ? project.prefer_idle_terminal === true || project.prefer_idle_terminal === 1
      : fallbackSettings.preferIdleTerminal === true,
    layout: {
      enabled: typeof storedLayout.enabled === 'boolean'
        ? storedLayout.enabled
        : layoutDefaults.enabled,
      columns: integerOr(storedLayout.columns, layoutDefaults.columns, 1, 8),
      rows: integerOr(storedLayout.rows, layoutDefaults.rows, 1, 8),
      display: integerOr(storedLayout.display, layoutDefaults.display),
      background: typeof storedLayout.background === 'boolean'
        ? storedLayout.background
        : layoutDefaults.background,
    },
  };
}

export function freshProjectComposerState() {
  return {
    taskName: '',
    prompt: '',
    attachments: [],
    taskReferences: [],
    selectedTaskId: null,
    selectedThreadId: null,
    selectedProvider: 'codex',
    taskMode: 'execute',
    terminalSettings: freshProjectTerminalSettings(),
    executionSettings: {
      codex: { model: null, effort: '', source: 'default', taskId: null },
      claude: { model: null, effort: '', source: 'default', taskId: null },
    },
    threadExecutionSettings: {},
    planSettings: {
      enabled: false,
      authorThreadId: null,
      councilOrder: ['claude', 'codex'],
      claudeModel: 'fable',
      claudeEffort: 'max',
      codexModel: null,
      codexEffort: 'high',
      authorModel: 'fable',
      authorEffort: 'max',
      reviewerModel: null,
      reviewerEffort: 'high',
    },
    turboSettings: {
      plannerModel: 'gpt-5.6-sol',
      plannerEffort: 'high',
      workerModel: 'gpt-5.6-luna',
      workerEffort: 'high',
      workerCount: 3,
      councilEnabled: false,
      councilOrder: ['codex', 'claude'],
      councilClaudeModel: 'fable',
      councilClaudeEffort: 'high',
    },
  };
}

export function providerEligibleForComposer(session, provider) {
  if (!['codex', 'claude'].includes(provider)) return false;
  if (provider === 'codex') return true;
  return session?.taskMode === 'execute' && session?.planSettings?.enabled !== true;
}

export function executionSettingsForThread(session, provider, threadId) {
  const providerSettings = session.executionSettings[provider];
  if (!threadId) return providerSettings;
  session.threadExecutionSettings ||= {};
  const saved = session.threadExecutionSettings[threadId];
  if (saved?.provider === provider) return saved;
  const settings = {
    provider,
    model: providerSettings.model,
    effort: providerSettings.effort,
    source: 'default',
    taskId: null,
  };
  session.threadExecutionSettings[threadId] = settings;
  return settings;
}

export function rememberThreadExecution(session, provider, threadId, settings, {
  source = 'user',
  taskId = null,
} = {}) {
  const remembered = executionSettingsForThread(session, provider, threadId);
  Object.assign(remembered, settings, { source, taskId });
  const providerSettings = session.executionSettings[provider];
  if (remembered !== providerSettings) {
    Object.assign(providerSettings, settings, { source, taskId });
  }
  return remembered;
}

function hydrateExecutionTarget(target, task) {
  if (target.source === 'user') return;
  if (target.source === 'task' && Number(target.taskId) >= Number(task.id)) return;
  Object.assign(target, {
    model: task.provider === 'claude'
      ? normalizeClaudeModelSelection(task.model) || target.model
      : task.model || target.model,
    effort: task.effort || target.effort,
    source: 'task',
    taskId: task.id,
  });
}

export function hydrateThreadExecutionSettings(session, tasks) {
  const latestByThread = new Map();
  for (const task of tasks || []) {
    if (task?.mode !== 'execute' || !task.thread_id || !['codex', 'claude'].includes(task.provider)) continue;
    if (!task.model && !task.effort) continue;
    const previous = latestByThread.get(task.thread_id);
    if (!previous || Number(task.id) > Number(previous.id)) {
      latestByThread.set(task.thread_id, task);
    }
  }
  for (const task of latestByThread.values()) {
    const current = executionSettingsForThread(session, task.provider, task.thread_id);
    hydrateExecutionTarget(current, task);
    hydrateExecutionTarget(session.executionSettings[task.provider], task);
  }
  return session.threadExecutionSettings;
}

export class ProjectComposerStore {
  constructor() {
    this.sessions = new Map();
  }

  save(path, session) {
    this.sessions.set(projectComposerKey(path), cloneValue(session));
  }

  load(path) {
    const session = this.sessions.get(projectComposerKey(path));
    return cloneValue(session || freshProjectComposerState());
  }

  delete(path) {
    this.sessions.delete(projectComposerKey(path));
  }
}
