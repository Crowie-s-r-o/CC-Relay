import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_MODEL_EFFORT,
  defaultEffortForModel,
  supportedEffortValues,
} from '../public/model-effort.js';

test('high is the CC Relay default for every model that supports it', () => {
  const model = {
    defaultReasoningEffort: 'low',
    supportedReasoningEfforts: [
      { reasoningEffort: 'low' },
      { reasoningEffort: 'medium' },
      { reasoningEffort: 'high' },
    ],
  };

  assert.equal(DEFAULT_MODEL_EFFORT, 'high');
  assert.equal(defaultEffortForModel(model), 'high');
});

test('models without high effort keep a valid provider fallback', () => {
  assert.equal(defaultEffortForModel({
    defaultReasoningEffort: 'medium',
    supportedReasoningEfforts: ['low', 'medium'],
  }), 'medium');
  assert.equal(defaultEffortForModel({
    supportedReasoningEfforts: [{ reasoningEffort: 'low' }],
  }), 'low');
  assert.equal(defaultEffortForModel({ supportedReasoningEfforts: [] }), '');
});

test('supported effort values accept provider objects and strings', () => {
  assert.deepEqual(supportedEffortValues({
    supportedReasoningEfforts: [
      { reasoningEffort: 'low' },
      'high',
      null,
    ],
  }), ['low', 'high']);
});
