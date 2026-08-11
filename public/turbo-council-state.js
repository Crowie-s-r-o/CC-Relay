import { normalizeClaudeModelSelection } from './claude-model-selection.js';

export const TURBO_COUNCIL_ORDERS = Object.freeze([
  Object.freeze(['codex', 'claude']),
  Object.freeze(['claude', 'codex']),
]);

function normalizeOrder(input) {
  const requested = Array.isArray(input?.councilOrder)
    ? input.councilOrder
    : Array.isArray(input?.order)
      ? input.order
      : input?.councilFirstProvider === 'claude'
        ? ['claude', 'codex']
        : ['codex', 'claude'];
  return TURBO_COUNCIL_ORDERS.find((order) => order.every((provider, index) => requested[index] === provider))
    || TURBO_COUNCIL_ORDERS[0];
}

function modelsFor(catalogs, provider) {
  return Array.isArray(catalogs?.[provider]) ? catalogs[provider] : [];
}

function preferredModel(catalogs, provider, requested) {
  const models = modelsFor(catalogs, provider);
  const selected = provider === 'claude'
    ? normalizeClaudeModelSelection(requested)
    : requested;
  return models.find((model) => model?.model === selected)
    || models.find((model) => provider === 'claude' && model?.model === 'fable')
    || models.find((model) => model?.isDefault)
    || models[0]
    || null;
}

function effortsFor(model) {
  return Array.isArray(model?.supportedReasoningEfforts)
    ? model.supportedReasoningEfforts.map((item) => typeof item === 'string' ? item : item?.reasoningEffort).filter(Boolean)
    : [];
}

function normalizedEffort(model, requested) {
  const efforts = effortsFor(model);
  return efforts.includes(requested)
    ? requested
    : efforts.includes('high')
      ? 'high'
      : efforts.includes(model?.defaultReasoningEffort)
        ? model.defaultReasoningEffort
        : efforts[0] || '';
}

export function normalizeTurboCouncilSettings(input = {}, catalogs = {}) {
  const councilOrder = [...normalizeOrder(input)];
  const codex = preferredModel(catalogs, 'codex', input.plannerModel || input.councilCodexModel);
  const claude = preferredModel(
    catalogs,
    'claude',
    input.councilClaudeModel || input.councilReviewerModel,
  );
  const codexEffort = normalizedEffort(codex, input.plannerEffort || input.councilCodexEffort);
  const claudeEffort = normalizedEffort(
    claude,
    input.councilClaudeEffort || input.councilReviewerEffort,
  );
  const authorProvider = councilOrder[0];
  const reviewerProvider = councilOrder[1];
  const modelFor = (provider) => provider === 'codex' ? codex?.model || '' : claude?.model || '';
  const effortFor = (provider) => provider === 'codex' ? codexEffort : claudeEffort;
  return {
    councilEnabled: input.councilEnabled === true,
    councilOrder,
    councilFirstProvider: authorProvider,
    councilAuthorProvider: authorProvider,
    councilAuthorModel: modelFor(authorProvider),
    councilAuthorEffort: effortFor(authorProvider),
    councilReviewerProvider: reviewerProvider,
    councilReviewerModel: modelFor(reviewerProvider),
    councilReviewerEffort: effortFor(reviewerProvider),
    councilCodexModel: codex?.model || '',
    councilCodexEffort: codexEffort,
    councilClaudeModel: claude?.model || '',
    councilClaudeEffort: claudeEffort,
  };
}

export function turboCouncilReadiness({
  enabled = false,
  claudeReady = false,
  claudeAuthenticated = false,
  claudeIssue = '',
  authorModel = '',
  reviewerModel = '',
} = {}) {
  if (!enabled) return { ready: true, missing: [], reason: '' };
  const missing = [];
  if (!(claudeReady || claudeAuthenticated)) missing.push(claudeIssue || 'Claude CLI sign-in');
  if (!authorModel) missing.push('an author model');
  if (!reviewerModel) missing.push('a reviewer model');
  return {
    ready: missing.length === 0,
    missing,
    reason: missing.length ? `Turbo Plan council needs ${missing.join(' and ')}.` : '',
  };
}

export function turboCouncilRequest(settings = {}, catalogs = {}) {
  const normalized = normalizeTurboCouncilSettings(settings, catalogs);
  return {
    councilEnabled: normalized.councilEnabled,
    councilOrder: normalized.councilOrder,
    councilAuthorProvider: normalized.councilAuthorProvider,
    councilAuthorModel: normalized.councilAuthorModel,
    councilAuthorEffort: normalized.councilAuthorEffort || null,
    councilReviewerProvider: normalized.councilReviewerProvider,
    councilReviewerModel: normalized.councilReviewerModel,
    councilReviewerEffort: normalized.councilReviewerEffort || null,
  };
}

export const normalizeCouncilSettings = normalizeTurboCouncilSettings;
export const councilReadiness = turboCouncilReadiness;
export const buildTurboCouncilRequest = turboCouncilRequest;
