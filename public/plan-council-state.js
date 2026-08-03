export const PLAN_COUNCIL_ORDERS = Object.freeze([
  Object.freeze(['claude', 'codex']),
  Object.freeze(['codex', 'claude']),
]);

function normalizeOrder(input) {
  const requested = Array.isArray(input?.councilOrder)
    ? input.councilOrder
    : Array.isArray(input?.order)
      ? input.order
      : input?.authorProvider === 'codex'
        ? ['codex', 'claude']
        : ['claude', 'codex'];
  return PLAN_COUNCIL_ORDERS.find((order) => (
    requested.length === order.length
    && order.every((provider, index) => requested[index] === provider)
  )) || PLAN_COUNCIL_ORDERS[0];
}

function modelsFor(catalogs, provider) {
  return Array.isArray(catalogs?.[provider]) ? catalogs[provider] : [];
}

function preferredModel(catalogs, provider, requested) {
  const models = modelsFor(catalogs, provider);
  return models.find((model) => model?.model === requested)
    || models.find((model) => provider === 'claude' && model?.model === 'fable')
    || models.find((model) => model?.isDefault)
    || models[0]
    || null;
}

function effortsFor(model) {
  return Array.isArray(model?.supportedReasoningEfforts)
    ? model.supportedReasoningEfforts
      .map((item) => typeof item === 'string' ? item : item?.reasoningEffort)
      .filter(Boolean)
    : [];
}

function normalizedEffort(model, requested) {
  const efforts = effortsFor(model);
  if (requested === '') return '';
  return efforts.includes(requested)
    ? requested
    : efforts.includes('high')
      ? 'high'
      : efforts.includes(model?.defaultReasoningEffort)
        ? model.defaultReasoningEffort
        : efforts[0] || '';
}

function legacyProviderSetting(input, provider, field) {
  const authorProvider = input?.authorProvider || 'claude';
  const reviewerProvider = input?.reviewerProvider || (authorProvider === 'claude' ? 'codex' : 'claude');
  if (authorProvider === provider) return input?.[`author${field}`];
  if (reviewerProvider === provider) return input?.[`reviewer${field}`];
  return undefined;
}

function providerSetting(input, provider, field) {
  const key = `${provider}${field}`;
  if (Object.prototype.hasOwnProperty.call(input, key) && input[key] !== null) {
    return input[key];
  }
  return legacyProviderSetting(input, provider, field);
}

export function normalizePlanCouncilSettings(input = {}, catalogs = {}) {
  const councilOrder = [...normalizeOrder(input)];
  const codex = preferredModel(
    catalogs,
    'codex',
    providerSetting(input, 'codex', 'Model'),
  );
  const claude = preferredModel(
    catalogs,
    'claude',
    providerSetting(input, 'claude', 'Model'),
  );
  const codexEffort = normalizedEffort(
    codex,
    providerSetting(input, 'codex', 'Effort'),
  );
  const claudeEffort = normalizedEffort(
    claude,
    providerSetting(input, 'claude', 'Effort'),
  );
  const authorProvider = councilOrder[0];
  const reviewerProvider = councilOrder[1];
  const modelFor = (provider) => provider === 'codex' ? codex?.model || '' : claude?.model || '';
  const effortFor = (provider) => provider === 'codex' ? codexEffort : claudeEffort;
  return {
    enabled: input.enabled === true,
    authorThreadId: input.authorThreadId || null,
    councilOrder,
    councilFirstProvider: authorProvider,
    authorProvider,
    authorModel: modelFor(authorProvider),
    authorEffort: effortFor(authorProvider),
    reviewerProvider,
    reviewerModel: modelFor(reviewerProvider),
    reviewerEffort: effortFor(reviewerProvider),
    codexModel: codex?.model || '',
    codexEffort,
    claudeModel: claude?.model || '',
    claudeEffort,
  };
}

export function planCouncilRequest(settings = {}, catalogs = {}) {
  const normalized = normalizePlanCouncilSettings(settings, catalogs);
  return {
    councilOrder: normalized.councilOrder,
    authorProvider: normalized.authorProvider,
    authorModel: normalized.authorModel,
    authorEffort: normalized.authorEffort || null,
    reviewerProvider: normalized.reviewerProvider,
    reviewerModel: normalized.reviewerModel,
    reviewerEffort: normalized.reviewerEffort || null,
  };
}
