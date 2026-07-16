import assert from 'node:assert/strict';
import test from 'node:test';
import { validateExecutionSettings } from '../src/model-catalog.mjs';

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
