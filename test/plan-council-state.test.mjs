import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizePlanCouncilSettings,
  planCouncilRequest,
} from '../public/plan-council-state.js';

const catalogs = {
  codex: [{
    model: 'sol',
    isDefault: true,
    defaultReasoningEffort: 'high',
    supportedReasoningEfforts: [{ reasoningEffort: 'medium' }, { reasoningEffort: 'high' }],
  }],
  claude: [{
    model: 'fable',
    isDefault: true,
    defaultReasoningEffort: 'high',
    supportedReasoningEfforts: [{ reasoningEffort: 'high' }, { reasoningEffort: 'max' }],
  }],
};

test('Execute Plan council preserves provider settings while switching the author order', () => {
  const claudeFirst = normalizePlanCouncilSettings({
    enabled: true,
    claudeModel: 'fable',
    claudeEffort: 'max',
    codexModel: 'sol',
    codexEffort: 'medium',
  }, catalogs);
  assert.deepEqual(claudeFirst.councilOrder, ['claude', 'codex']);
  assert.equal(claudeFirst.authorModel, 'fable');
  assert.equal(claudeFirst.reviewerModel, 'sol');

  const codexFirst = normalizePlanCouncilSettings({
    ...claudeFirst,
    councilOrder: ['codex', 'claude'],
  }, catalogs);
  assert.equal(codexFirst.authorProvider, 'codex');
  assert.equal(codexFirst.authorModel, 'sol');
  assert.equal(codexFirst.authorEffort, 'medium');
  assert.equal(codexFirst.reviewerProvider, 'claude');
  assert.equal(codexFirst.reviewerModel, 'fable');
  assert.equal(codexFirst.reviewerEffort, 'max');
});

test('Execute Plan council request carries the selected route and role settings', () => {
  assert.deepEqual(planCouncilRequest({
    enabled: true,
    councilOrder: ['codex', 'claude'],
    claudeModel: 'fable',
    claudeEffort: 'max',
    codexModel: 'sol',
    codexEffort: 'high',
  }, catalogs), {
    councilOrder: ['codex', 'claude'],
    authorProvider: 'codex',
    authorModel: 'sol',
    authorEffort: 'high',
    reviewerProvider: 'claude',
    reviewerModel: 'fable',
    reviewerEffort: 'max',
  });
});

test('legacy role settings still normalize to the original Claude-first route', () => {
  const normalized = normalizePlanCouncilSettings({
    enabled: true,
    authorModel: 'fable',
    authorEffort: 'max',
    reviewerModel: 'sol',
    reviewerEffort: 'medium',
  }, catalogs);
  assert.deepEqual(normalized.councilOrder, ['claude', 'codex']);
  assert.equal(normalized.claudeModel, 'fable');
  assert.equal(normalized.codexModel, 'sol');
});

test('provider effort can explicitly use the selected model default', () => {
  const normalized = normalizePlanCouncilSettings({
    enabled: true,
    claudeModel: 'fable',
    claudeEffort: '',
    codexModel: 'sol',
    codexEffort: '',
  }, catalogs);
  assert.equal(normalized.claudeEffort, '');
  assert.equal(normalized.codexEffort, '');
});
