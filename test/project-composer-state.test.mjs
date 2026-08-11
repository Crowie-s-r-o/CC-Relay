import assert from 'node:assert/strict';
import test from 'node:test';
import {
  executionSettingsForThread,
  freshProjectComposerState,
  freshProjectTerminalSettings,
  hydrateThreadExecutionSettings,
  normalizeProjectTerminalSettings,
  ProjectComposerStore,
  projectComposerKey,
  providerEligibleForComposer,
  rememberThreadExecution,
} from '../public/project-composer-state.js';

test('project composer sessions isolate prompts, images, workflow state, and terminals', () => {
  const store = new ProjectComposerStore();
  store.save('/work/alpha', {
    taskName: 'Alpha release',
    prompt: 'Alpha task',
    attachments: [{ id: 'alpha-image', data: 'data:image/png;base64,alpha' }],
    selectedTaskId: 41,
    selectedThreadId: 'alpha-relay',
    selectedProvider: 'codex',
    taskMode: 'turbo',
    terminalSettings: {
      ...freshProjectTerminalSettings(),
      keepTerminalOpen: false,
      layout: { ...freshProjectTerminalSettings().layout, columns: 2 },
    },
    executionSettings: { codex: { model: 'alpha-model', effort: 'high' } },
    planSettings: { enabled: false },
    turboSettings: { workerCount: 4 },
  });
  store.save('/work/beta', {
    taskName: 'Beta audit',
    prompt: 'Beta task',
    attachments: [],
    selectedTaskId: 73,
    selectedThreadId: 'beta-claude',
    selectedProvider: 'claude',
    taskMode: 'execute',
    terminalSettings: {
      ...freshProjectTerminalSettings(),
      keepTerminalOpen: true,
      layout: { ...freshProjectTerminalSettings().layout, columns: 5 },
    },
    executionSettings: { claude: { model: 'beta-model', effort: 'max' } },
    planSettings: { enabled: false },
    turboSettings: { workerCount: 3 },
  });

  const alpha = store.load('/work/alpha/');
  const beta = store.load('/work/beta');
  assert.equal(alpha.taskName, 'Alpha release');
  assert.equal(alpha.prompt, 'Alpha task');
  assert.equal(alpha.attachments[0].id, 'alpha-image');
  assert.equal(alpha.selectedTaskId, 41);
  assert.equal(alpha.selectedThreadId, 'alpha-relay');
  assert.equal(alpha.taskMode, 'turbo');
  assert.equal(alpha.terminalSettings.keepTerminalOpen, false);
  assert.equal(alpha.terminalSettings.layout.columns, 2);
  assert.equal(beta.taskName, 'Beta audit');
  assert.equal(beta.prompt, 'Beta task');
  assert.equal(beta.attachments.length, 0);
  assert.equal(beta.selectedTaskId, 73);
  assert.equal(beta.selectedThreadId, 'beta-claude');
  assert.equal(beta.selectedProvider, 'claude');
  assert.equal(beta.terminalSettings.keepTerminalOpen, true);
  assert.equal(beta.terminalSettings.layout.columns, 5);

  alpha.attachments[0].id = 'mutated';
  alpha.terminalSettings.layout.columns = 8;
  assert.equal(store.load('/work/alpha').attachments[0].id, 'alpha-image');
  assert.equal(store.load('/work/alpha').terminalSettings.layout.columns, 2);
});

test('a project without a saved session receives an independent blank composer', () => {
  const store = new ProjectComposerStore();
  const first = store.load('/work/new');
  first.prompt = 'Changed locally';
  first.attachments.push({ id: 'image' });

  const second = store.load('/work/new');
  assert.equal(second.taskName, '');
  assert.equal(second.prompt, '');
  assert.deepEqual(second.attachments, []);
  assert.equal(second.selectedTaskId, null);
  assert.equal(second.selectedProvider, 'codex');
  assert.equal(second.taskMode, 'execute');
  assert.deepEqual(second.planSettings.councilOrder, ['claude', 'codex']);
  assert.equal(second.planSettings.claudeModel, 'fable');
  assert.equal(second.planSettings.codexModel, null);
  assert.equal(second.terminalSettings.keepTerminalOpen, false);
  assert.equal(second.terminalSettings.preferIdleTerminal, false);
  assert.deepEqual(second.terminalSettings.layout, {
    enabled: true,
    columns: 3,
    rows: 3,
    display: 0,
    background: true,
  });
  assert.equal(Object.hasOwn(second, 'taskScope'), false);
});

test('composer state cannot be created without a selected project', () => {
  assert.throws(() => projectComposerKey(null), /project path is required/i);
});

test('persisted terminal settings never inherit values from another project', () => {
  const alpha = normalizeProjectTerminalSettings({
    keep_terminal_open: false,
    prefer_idle_terminal: true,
    terminal_layout: {
      enabled: true,
      columns: 2,
      rows: 4,
      display: 1,
      background: false,
    },
  });
  const beta = normalizeProjectTerminalSettings({
    keep_terminal_open: true,
    prefer_idle_terminal: false,
    terminal_layout: null,
  }, alpha);

  assert.equal(beta.keepTerminalOpen, true);
  assert.equal(beta.preferIdleTerminal, false);
  assert.deepEqual(beta.layout, freshProjectTerminalSettings().layout);
});

test('Plan council and Turbo only accept Codex Relays in their terminal picker', () => {
  const session = freshProjectComposerState();
  assert.equal(providerEligibleForComposer(session, 'codex'), true);
  assert.equal(providerEligibleForComposer(session, 'claude'), true);

  session.planSettings.enabled = true;
  assert.equal(providerEligibleForComposer(session, 'codex'), true);
  assert.equal(providerEligibleForComposer(session, 'claude'), false);

  session.planSettings.enabled = false;
  session.taskMode = 'turbo';
  assert.equal(providerEligibleForComposer(session, 'codex'), true);
  assert.equal(providerEligibleForComposer(session, 'claude'), false);
});

test('each CC Relay terminal retains its own provider model and effort', () => {
  const session = freshProjectComposerState();
  const firstCodex = executionSettingsForThread(session, 'codex', 'codex-one');
  firstCodex.model = 'sol';
  firstCodex.effort = 'high';
  const secondCodex = executionSettingsForThread(session, 'codex', 'codex-two');
  secondCodex.effort = 'low';
  const claude = executionSettingsForThread(session, 'claude', 'claude-one');
  claude.model = 'opus';
  claude.effort = 'max';

  assert.equal(executionSettingsForThread(session, 'codex', 'codex-one').effort, 'high');
  assert.equal(executionSettingsForThread(session, 'codex', 'codex-two').effort, 'low');
  assert.deepEqual(executionSettingsForThread(session, 'claude', 'claude-one'), {
    provider: 'claude', model: 'opus', effort: 'max', source: 'default', taskId: null,
  });
});

test('idle routing remembers the accepted effort on the destination CC Relay', () => {
  const session = freshProjectComposerState();
  rememberThreadExecution(session, 'codex', 'selected-busy-relay', {
    model: 'sol', effort: 'xhigh',
  });
  rememberThreadExecution(session, 'codex', 'routed-idle-relay', {
    model: 'sol', effort: 'xhigh',
  });

  assert.equal(executionSettingsForThread(session, 'codex', 'selected-busy-relay').effort, 'xhigh');
  assert.equal(executionSettingsForThread(session, 'codex', 'routed-idle-relay').effort, 'xhigh');
  assert.equal(session.executionSettings.codex.effort, 'xhigh');
});

test('latest accepted task replaces an early default without overwriting an unsent choice', () => {
  const session = freshProjectComposerState();
  const defaulted = executionSettingsForThread(session, 'codex', 'relay-one');
  defaulted.model = 'sol';
  defaulted.effort = 'low';

  hydrateThreadExecutionSettings(session, [{
    id: 171,
    mode: 'execute',
    provider: 'codex',
    thread_id: 'relay-one',
    model: 'sol',
    effort: 'xhigh',
  }]);
  assert.equal(executionSettingsForThread(session, 'codex', 'relay-one').effort, 'xhigh');
  assert.equal(executionSettingsForThread(session, 'codex', 'relay-one').source, 'task');

  rememberThreadExecution(session, 'codex', 'relay-one', { model: 'sol', effort: 'max' });
  hydrateThreadExecutionSettings(session, [{
    id: 172,
    mode: 'execute',
    provider: 'codex',
    thread_id: 'relay-one',
    model: 'sol',
    effort: 'low',
  }]);
  assert.equal(executionSettingsForThread(session, 'codex', 'relay-one').effort, 'max');
  assert.equal(executionSettingsForThread(session, 'codex', 'relay-one').source, 'user');
});

test('a newly bound Claude task does not overwrite an unsent automatic effort choice', () => {
  const session = freshProjectComposerState();
  rememberThreadExecution(session, 'claude', null, {
    model: 'opus',
    effort: 'max',
  });

  hydrateThreadExecutionSettings(session, [{
    id: 301,
    mode: 'execute',
    provider: 'claude',
    thread_id: 'newly-bound-claude',
    model: 'opus',
    effort: 'high',
  }]);

  assert.deepEqual(session.executionSettings.claude, {
    model: 'opus',
    effort: 'max',
    source: 'user',
    taskId: null,
  });
  assert.deepEqual(executionSettingsForThread(session, 'claude', 'newly-bound-claude'), {
    provider: 'claude',
    model: 'opus',
    effort: 'high',
    source: 'task',
    taskId: 301,
  });
});

test('provider defaults hydrate from the newest accepted task regardless of terminal order', () => {
  const session = freshProjectComposerState();

  hydrateThreadExecutionSettings(session, [{
    id: 402,
    mode: 'execute',
    provider: 'claude',
    thread_id: 'claude-newer',
    model: 'opus',
    effort: 'max',
  }, {
    id: 401,
    mode: 'execute',
    provider: 'claude',
    thread_id: 'claude-older',
    model: 'opus',
    effort: 'high',
  }]);

  assert.deepEqual(session.executionSettings.claude, {
    model: 'opus',
    effort: 'max',
    source: 'task',
    taskId: 402,
  });
});

test('task history preserves Fable model selections', () => {
  const session = freshProjectComposerState();

  hydrateThreadExecutionSettings(session, [{
    id: 403,
    mode: 'execute',
    provider: 'claude',
    thread_id: 'claude-legacy',
    model: 'fable',
    effort: 'max',
  }]);

  assert.equal(session.executionSettings.claude.model, 'fable');
  assert.equal(executionSettingsForThread(session, 'claude', 'claude-legacy').model, 'fable');
});
