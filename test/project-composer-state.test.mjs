import assert from 'node:assert/strict';
import test from 'node:test';
import {
  executionSettingsForThread,
  freshProjectComposerState,
  hydrateThreadExecutionSettings,
  ProjectComposerStore,
  projectComposerKey,
  providerEligibleForComposer,
  rememberThreadExecution,
} from '../public/project-composer-state.js';

test('project composer sessions isolate prompts, images, workflow state, and terminals', () => {
  const store = new ProjectComposerStore();
  store.save('/work/alpha', {
    prompt: 'Alpha task',
    attachments: [{ id: 'alpha-image', data: 'data:image/png;base64,alpha' }],
    selectedThreadId: 'alpha-relay',
    selectedProvider: 'codex',
    taskMode: 'turbo',
    executionSettings: { codex: { model: 'alpha-model', effort: 'high' } },
    planSettings: { enabled: false },
    turboSettings: { workerCount: 4 },
  });
  store.save('/work/beta', {
    prompt: 'Beta task',
    attachments: [],
    selectedThreadId: 'beta-claude',
    selectedProvider: 'claude',
    taskMode: 'execute',
    executionSettings: { claude: { model: 'beta-model', effort: 'max' } },
    planSettings: { enabled: false },
    turboSettings: { workerCount: 3 },
  });

  const alpha = store.load('/work/alpha/');
  const beta = store.load('/work/beta');
  assert.equal(alpha.prompt, 'Alpha task');
  assert.equal(alpha.attachments[0].id, 'alpha-image');
  assert.equal(alpha.selectedThreadId, 'alpha-relay');
  assert.equal(alpha.taskMode, 'turbo');
  assert.equal(beta.prompt, 'Beta task');
  assert.equal(beta.attachments.length, 0);
  assert.equal(beta.selectedThreadId, 'beta-claude');
  assert.equal(beta.selectedProvider, 'claude');

  alpha.attachments[0].id = 'mutated';
  assert.equal(store.load('/work/alpha').attachments[0].id, 'alpha-image');
});

test('a project without a saved session receives an independent blank composer', () => {
  const store = new ProjectComposerStore();
  const first = store.load('/work/new');
  first.prompt = 'Changed locally';
  first.attachments.push({ id: 'image' });

  const second = store.load('/work/new');
  assert.equal(second.prompt, '');
  assert.deepEqual(second.attachments, []);
  assert.equal(second.selectedProvider, 'codex');
  assert.equal(second.taskMode, 'execute');
  assert.equal(Object.hasOwn(second, 'taskScope'), false);
});

test('composer state cannot be created without a selected project', () => {
  assert.throws(() => projectComposerKey(null), /project path is required/i);
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

test('each Relay terminal retains its own provider model and effort', () => {
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

test('idle routing remembers the accepted effort on the destination Relay', () => {
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
