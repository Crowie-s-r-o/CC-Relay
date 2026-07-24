import test from 'node:test';
import assert from 'node:assert/strict';
import { CLAUDE_MODELS } from '../src/model-catalog.mjs';
import {
  TURBO_COUNCIL_ORDER,
  normalizeTurboCouncilConfig,
  validateTurboCouncilConfig,
} from '../src/turbo-council-config.mjs';

const codexModels = [{
  model: 'sol',
  displayName: 'Sol',
  isDefault: true,
  defaultReasoningEffort: 'high',
  supportedReasoningEfforts: [{ reasoningEffort: 'medium' }, { reasoningEffort: 'high' }],
}];
const ready = { claudeStatus: { available: true, authenticated: true }, codexModels };

test('omitted and disabled council normalize without Claude availability', () => {
  assert.deepEqual(validateTurboCouncilConfig(), { enabled: false, order: ['codex', 'claude'] });
  assert.deepEqual(validateTurboCouncilConfig({ councilEnabled: false, order: ['claude', 'codex'] }), {
    enabled: false,
    order: ['claude', 'codex'],
  });
  assert.deepEqual(TURBO_COUNCIL_ORDER, ['codex', 'claude']);
});

test('enabled council requires authenticated Claude and validates Codex-first route', () => {
  const input = {
    councilEnabled: true,
    councilAuthorProvider: 'codex',
    councilAuthorModel: 'sol',
    councilAuthorEffort: 'high',
    councilReviewerProvider: 'claude',
    councilReviewerModel: 'best',
    councilReviewerEffort: 'high',
  };
  assert.throws(() => validateTurboCouncilConfig(input, { codexModels }), /authenticated Claude CLI/);
  assert.deepEqual(validateTurboCouncilConfig(input, ready), {
    enabled: true,
    order: ['codex', 'claude'],
    authorProvider: 'codex',
    authorModel: 'sol',
    authorEffort: 'high',
    reviewerProvider: 'claude',
    reviewerModel: 'best',
    reviewerEffort: 'high',
  });
});

test('accepts Claude-first and Codex-second with matching models', () => {
  assert.deepEqual(validateTurboCouncilConfig({
    enabled: true,
    order: ['claude', 'codex'],
    authorProvider: 'claude',
    authorModel: 'sonnet',
    authorEffort: 'high',
    reviewerProvider: 'codex',
    reviewerModel: 'sol',
    reviewerEffort: 'medium',
  }, ready), {
    enabled: true,
    order: ['claude', 'codex'],
    authorProvider: 'claude',
    authorModel: 'sonnet',
    authorEffort: 'high',
    reviewerProvider: 'codex',
    reviewerModel: 'sol',
    reviewerEffort: 'medium',
  });
});

test('rejects malformed routes, provider mismatches, and invalid settings', () => {
  assert.throws(() => validateTurboCouncilConfig({ councilEnabled: 'true' }), /enabled must be a boolean/);
  assert.throws(() => validateTurboCouncilConfig({ councilEnabled: true, councilOrder: ['claude'] }, ready), /order must be/);
  assert.throws(() => validateTurboCouncilConfig({
    enabled: true, order: ['claude', 'codex'], authorProvider: 'codex', authorModel: 'sol', reviewerProvider: 'codex', reviewerModel: 'sol',
  }, ready), /author provider must be Claude/);
  assert.throws(() => validateTurboCouncilConfig({
    enabled: true, authorProvider: 'codex', authorModel: 'sol', reviewerProvider: 'claude', reviewerModel: 'missing',
  }, ready), /not available/);
  assert.throws(() => validateTurboCouncilConfig({
    enabled: true, authorProvider: 'codex', authorModel: 'sol', reviewerProvider: 'claude', reviewerModel: 'haiku', reviewerEffort: 'high',
  }, ready), /does not support/);
});

test('uses a supplied Claude catalog through existing execution validation', () => {
  const models = CLAUDE_MODELS.filter((model) => model.model === 'sonnet');
  assert.equal(normalizeTurboCouncilConfig({
    enabled: true,
    authorProvider: 'codex',
    authorModel: 'sol',
    authorEffort: 'high',
    reviewerProvider: 'claude',
    reviewerModel: 'sonnet',
    reviewerEffort: 'xhigh',
  }, { ...ready, claudeModels: models }).reviewerEffort, 'xhigh');
});
