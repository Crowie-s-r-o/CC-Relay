import { CLAUDE_MODELS, validateExecutionSettings } from './model-catalog.mjs';

export const TURBO_COUNCIL_ORDER = Object.freeze(['codex', 'claude']);
export const TURBO_COUNCIL_ORDERS = Object.freeze([
  TURBO_COUNCIL_ORDER,
  Object.freeze(['claude', 'codex']),
]);

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function readValue(input, ...keys) {
  for (const key of keys) {
    if (key && hasOwn(input, key)) return input[key];
  }
  return undefined;
}

function runtimeReady(options = {}) {
  if (options.claudeReady === true) return true;
  const status = options.claudeStatus || options.claude || options.status || {};
  const available = options.claudeAvailable ?? status.available ?? options.available;
  const authenticated = options.claudeAuthenticated ?? status.authenticated ?? options.authenticated;
  return available === true && authenticated === true;
}

function validateRoute(input) {
  const requested = readValue(input, 'order', 'councilOrder');
  if (requested === undefined) return [...TURBO_COUNCIL_ORDER];
  if (!Array.isArray(requested)) {
    throw new Error('Turbo Plan council order must be an array containing Codex and Claude once each.');
  }
  const matched = TURBO_COUNCIL_ORDERS.find((order) => (
    requested.length === order.length && order.every((provider, index) => requested[index] === provider)
  ));
  if (!matched) {
    throw new Error('Turbo Plan council order must be Codex then Claude or Claude then Codex.');
  }
  return [...matched];
}

function roleSettings(input, role, provider, options) {
  const roleName = role === 'author' ? 'author' : 'reviewer';
  const model = readValue(
    input,
    `${roleName}Model`,
    `council${roleName[0].toUpperCase()}${roleName.slice(1)}Model`,
    provider === 'claude' ? 'councilClaudeModel' : 'councilCodexModel',
  );
  const effort = readValue(
    input,
    `${roleName}Effort`,
    `council${roleName[0].toUpperCase()}${roleName.slice(1)}Effort`,
    provider === 'claude' ? 'councilClaudeEffort' : 'councilCodexEffort',
  );
  if (typeof model !== 'string' || !model.trim()) {
    throw new Error(`Turbo Plan council needs a ${provider === 'claude' ? 'Claude' : 'Codex'} ${roleName} model.`);
  }
  if (effort !== undefined && effort !== null && typeof effort !== 'string') {
    throw new Error(`Turbo Plan council ${roleName} effort must be a string.`);
  }
  const models = provider === 'claude'
    ? options.claudeModels || options.models || CLAUDE_MODELS
    : options.codexModels || [];
  let normalized;
  try {
    normalized = validateExecutionSettings({ model, effort, models });
  } catch (error) {
    throw new Error(`Turbo Plan council ${provider === 'claude' ? 'Claude' : 'Codex'} ${roleName} settings are invalid: ${error.message}`);
  }
  if (!normalized.model) {
    throw new Error(`Turbo Plan council needs a ${provider === 'claude' ? 'Claude' : 'Codex'} ${roleName} model.`);
  }
  return normalized;
}

export function validateTurboCouncilConfig(input = {}, options = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Turbo Plan council configuration must be an object.');
  }
  const order = validateRoute(input);
  const enabledValue = readValue(input, 'enabled', 'councilEnabled');
  if (enabledValue !== undefined && typeof enabledValue !== 'boolean') {
    throw new Error('Turbo Plan council enabled must be a boolean.');
  }
  if (enabledValue !== true) return { enabled: false, order };
  if (!runtimeReady(options)) {
    throw new Error('Turbo Plan council needs an authenticated Claude CLI. Sign in to Claude and restart CC Relay.');
  }

  const authorProvider = readValue(input, 'authorProvider', 'councilAuthorProvider') || order[0];
  const reviewerProvider = readValue(input, 'reviewerProvider', 'councilReviewerProvider') || order[1];
  if (authorProvider !== order[0]) {
    throw new Error(`Turbo Plan council author provider must be ${order[0] === 'claude' ? 'Claude' : 'Codex'} for the selected order.`);
  }
  if (reviewerProvider !== order[1]) {
    throw new Error(`Turbo Plan council reviewer provider must be ${order[1] === 'claude' ? 'Claude' : 'Codex'} for the selected order.`);
  }
  const author = roleSettings(input, 'author', authorProvider, options);
  const reviewer = roleSettings(input, 'reviewer', reviewerProvider, options);
  return {
    enabled: true,
    order,
    authorProvider,
    authorModel: author.model,
    authorEffort: author.effort,
    reviewerProvider,
    reviewerModel: reviewer.model,
    reviewerEffort: reviewer.effort,
  };
}

export const normalizeTurboCouncilConfig = validateTurboCouncilConfig;
export const validateCouncilConfig = validateTurboCouncilConfig;
export const normalizeTurboCouncil = validateTurboCouncilConfig;
export const validateTurboCouncil = validateTurboCouncilConfig;
