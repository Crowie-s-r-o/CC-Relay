import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CLAUDE_MODELS,
  normalizeClaudeModel,
  validateExecutionSettings,
} from '../src/model-catalog.mjs';
import { supportedClaudeModelCatalog } from '../public/claude-model-selection.js';
import {
  claudeCompleteLaunchSettings,
  claudeFirstLaunchSettings,
  claudeTerminalExecutionSettings,
  selectedClaudeTerminalModel,
} from '../src/claude-launch-settings.mjs';

const models = [{
  model: 'gpt-test',
  displayName: 'GPT Test',
  isDefault: true,
  supportedReasoningEfforts: [
    { reasoningEffort: 'medium' },
    { reasoningEffort: 'high' },
  ],
}];

test('execution settings accept account models and their supported effort', () => {
  assert.deepEqual(validateExecutionSettings({
    model: 'gpt-test',
    effort: 'high',
    models,
  }), { model: 'gpt-test', effort: 'high' });
  assert.deepEqual(validateExecutionSettings({ models }), { model: null, effort: null });
});

test('execution settings reject unknown models and unsupported effort', () => {
  assert.throws(
    () => validateExecutionSettings({ model: 'missing', effort: 'high', models }),
    /Model is not available/,
  );
  assert.throws(
    () => validateExecutionSettings({ model: 'gpt-test', effort: 'low', models }),
    /does not support low effort/,
  );
});

test('Claude catalog exposes Fable and canonicalizes the legacy best alias to Fable', () => {
  assert.deepEqual(CLAUDE_MODELS.map((model) => model.model), [
    'default',
    'opus',
    'fable',
    'sonnet',
    'haiku',
  ]);
  assert.equal(normalizeClaudeModel('best'), 'fable');
  assert.equal(normalizeClaudeModel('fable'), 'fable');
  assert.equal(normalizeClaudeModel('sonnet'), 'sonnet');
  assert.deepEqual(validateExecutionSettings({
    model: 'fable',
    effort: 'max',
    models: CLAUDE_MODELS,
  }), { model: 'fable', effort: 'max' });
  assert.deepEqual(supportedClaudeModelCatalog([
    { model: 'best' },
    { model: 'fable' },
    { model: 'opus' },
    { model: 'sonnet' },
  ]).map((model) => model.model), ['fable', 'opus', 'sonnet']);
  assert.deepEqual(supportedClaudeModelCatalog([
    { model: 'best', displayName: 'Best available' },
    { model: 'opus', displayName: 'Opus' },
  ]).map((model) => [model.model, model.displayName]), [
    ['fable', 'Fable'],
    ['opus', 'Opus'],
  ]);
});

test('terminal launch settings pass Fable through and map best to Fable', () => {
  assert.equal(selectedClaudeTerminalModel('best'), 'fable');
  assert.equal(selectedClaudeTerminalModel('fable'), 'fable');
  assert.equal(selectedClaudeTerminalModel('default'), null);
  assert.deepEqual(claudeFirstLaunchSettings({ model: 'fable', effort: 'max' }), {
    model: 'fable',
    effort: 'max',
  });
  assert.equal(claudeTerminalExecutionSettings({ model: 'best' }).model, 'fable');
});

test('complete Claude launch settings include Plan tools and unique attachment directories', () => {
  assert.deepEqual(claudeCompleteLaunchSettings({
    model: 'opus',
    effort: 'max',
    terminal_permission_mode: 'plan',
    terminal_tools: ['Read', 'Glob', 'Read'],
    attachments: [
      { path: '/project/.data/tasks/1/attachments/01.png' },
      { path: '/project/.data/tasks/1/attachments/02.png' },
      { path: '/project/reference/diagram.png' },
    ],
  }), {
    model: 'opus',
    effort: 'max',
    permissionMode: 'plan',
    tools: ['Read', 'Glob'],
    addDirectories: [
      '/project/.data/tasks/1/attachments',
      '/project/reference',
    ],
  });
});
