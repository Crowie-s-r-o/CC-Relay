import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeTurboCouncilSettings,
  turboCouncilReadiness,
  turboCouncilRequest,
} from '../public/turbo-council-state.js';

const catalogs = {
  codex: [
    { model: 'sol', isDefault: true, defaultReasoningEffort: 'high', supportedReasoningEfforts: [{ reasoningEffort: 'medium' }, { reasoningEffort: 'high' }] },
  ],
  claude: [
    { model: 'fable', isDefault: false, defaultReasoningEffort: 'high', supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'high' }] },
    { model: 'sonnet', isDefault: true, defaultReasoningEffort: 'medium', supportedReasoningEfforts: [{ reasoningEffort: 'medium' }] },
  ],
};

test('normalizes both selectable council orders with provider-specific settings', () => {
  const codexFirst = normalizeTurboCouncilSettings({ councilEnabled: true, plannerModel: 'sol', plannerEffort: 'high' }, catalogs);
  assert.deepEqual(codexFirst.councilOrder, ['codex', 'claude']);
  assert.equal(codexFirst.councilAuthorProvider, 'codex');
  assert.equal(codexFirst.councilAuthorModel, 'sol');
  assert.equal(codexFirst.councilReviewerProvider, 'claude');
  assert.equal(codexFirst.councilReviewerModel, 'fable');

  const claudeFirst = normalizeTurboCouncilSettings({
    councilEnabled: true,
    councilOrder: ['claude', 'codex'],
    plannerModel: 'sol',
    councilClaudeModel: 'sonnet',
  }, catalogs);
  assert.equal(claudeFirst.councilFirstProvider, 'claude');
  assert.equal(claudeFirst.councilAuthorModel, 'sonnet');
  assert.equal(claudeFirst.councilReviewerProvider, 'codex');
  assert.equal(claudeFirst.councilReviewerModel, 'sol');
});

test('normalizes Claude effort against the selected model', () => {
  assert.equal(normalizeTurboCouncilSettings({ plannerModel: 'sol', councilClaudeModel: 'sonnet', councilClaudeEffort: 'high' }, catalogs).councilClaudeEffort, 'medium');
  assert.equal(normalizeTurboCouncilSettings({ plannerModel: 'sol', councilClaudeModel: 'missing', councilClaudeEffort: 'low' }, catalogs).councilClaudeModel, 'fable');
});

test('disabled council never blocks readiness and enabled council names missing requirements', () => {
  assert.deepEqual(turboCouncilReadiness({ enabled: false }), { ready: true, missing: [], reason: '' });
  assert.equal(turboCouncilReadiness({ enabled: true, claudeReady: false, authorModel: 'sol', reviewerModel: 'best' }).ready, false);
  assert.match(turboCouncilReadiness({ enabled: true, claudeReady: false, authorModel: 'sol', reviewerModel: 'best' }).reason, /Claude CLI/);
  assert.match(turboCouncilReadiness({
    enabled: true,
    claudeReady: false,
    claudeIssue: 'Claude CLI is signed out. Run claude auth login',
    authorModel: 'sol',
    reviewerModel: 'best',
  }).reason, /claude auth login/);
  assert.match(turboCouncilReadiness({ enabled: true, claudeReady: true, authorModel: '', reviewerModel: 'best' }).reason, /author model/);
  assert.equal(turboCouncilReadiness({ enabled: true, claudeReady: true, authorModel: 'sol', reviewerModel: 'best' }).ready, true);
});

test('request state carries the selected author and reviewer route', () => {
  assert.deepEqual(turboCouncilRequest({
    councilEnabled: true,
    councilOrder: ['claude', 'codex'],
    plannerModel: 'sol',
    plannerEffort: 'high',
    councilClaudeModel: 'best',
    councilClaudeEffort: 'low',
  }, catalogs), {
    councilEnabled: true,
    councilOrder: ['claude', 'codex'],
    councilAuthorProvider: 'claude',
    councilAuthorModel: 'fable',
    councilAuthorEffort: 'low',
    councilReviewerProvider: 'codex',
    councilReviewerModel: 'sol',
    councilReviewerEffort: 'high',
  });
});
