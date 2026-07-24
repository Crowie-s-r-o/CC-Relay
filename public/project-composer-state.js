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

export function freshProjectComposerState() {
  return {
    prompt: '',
    attachments: [],
    selectedThreadId: null,
    selectedProvider: 'codex',
    taskMode: 'execute',
    executionSettings: {
      codex: { model: null, effort: '' },
      claude: { model: null, effort: '' },
    },
    threadExecutionSettings: {},
    planSettings: {
      enabled: false,
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
      councilClaudeModel: 'best',
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
  Object.assign(session.executionSettings[provider], settings);
  return remembered;
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
    if (current.source === 'user') continue;
    if (current.source === 'task' && Number(current.taskId) >= Number(task.id)) continue;
    rememberThreadExecution(session, task.provider, task.thread_id, {
      model: task.model || current.model,
      effort: task.effort || current.effort,
    }, { source: 'task', taskId: task.id });
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
