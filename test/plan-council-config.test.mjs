import assert from 'node:assert/strict';
import test from 'node:test';
import { validatePlanCouncilConfig } from '../src/plan-council-config.mjs';

const codexModels = [{
  model: 'sol',
  displayName: 'Sol',
  isDefault: true,
  defaultReasoningEffort: 'high',
  supportedReasoningEfforts: [{ reasoningEffort: 'medium' }, { reasoningEffort: 'high' }],
}];
const ready = {
  claudeStatus: { available: true, authenticated: true },
  codexModels,
};

test('Execute Plan council keeps Claude-first with Fable', () => {
  assert.deepEqual(validatePlanCouncilConfig({
    authorProvider: 'claude',
    authorModel: 'fable',
    authorEffort: 'max',
    reviewerProvider: 'codex',
    reviewerModel: 'sol',
    reviewerEffort: 'high',
  }, ready), {
    enabled: true,
    order: ['claude', 'codex'],
    authorProvider: 'claude',
    authorModel: 'fable',
    authorEffort: 'max',
    reviewerProvider: 'codex',
    reviewerModel: 'sol',
    reviewerEffort: 'high',
  });
});

test('Execute Plan council accepts Codex author and Claude reviewer settings', () => {
  assert.deepEqual(validatePlanCouncilConfig({
    councilOrder: ['codex', 'claude'],
    authorProvider: 'codex',
    authorModel: 'sol',
    authorEffort: 'medium',
    reviewerProvider: 'claude',
    reviewerModel: 'sonnet',
    reviewerEffort: 'high',
  }, ready), {
    enabled: true,
    order: ['codex', 'claude'],
    authorProvider: 'codex',
    authorModel: 'sol',
    authorEffort: 'medium',
    reviewerProvider: 'claude',
    reviewerModel: 'sonnet',
    reviewerEffort: 'high',
  });
});

test('Execute Plan council rejects a route and settings that do not align', () => {
  assert.throws(() => validatePlanCouncilConfig({
    councilOrder: ['codex', 'claude'],
    authorProvider: 'claude',
    authorModel: 'fable',
    reviewerProvider: 'codex',
    reviewerModel: 'sol',
  }, ready), /author provider must be Codex/);
  assert.throws(() => validatePlanCouncilConfig({
    councilOrder: ['codex', 'claude'],
    authorProvider: 'codex',
    authorModel: 'missing',
    reviewerProvider: 'claude',
    reviewerModel: 'sonnet',
  }, ready), /not available/);
});
