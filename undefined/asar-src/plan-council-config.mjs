import { validateTurboCouncilConfig } from './turbo-council-config.mjs';

export const PLAN_COUNCIL_ORDER = Object.freeze(['claude', 'codex']);
export const PLAN_COUNCIL_ORDERS = Object.freeze([
  PLAN_COUNCIL_ORDER,
  Object.freeze(['codex', 'claude']),
]);

function hasRoute(input) {
  return Array.isArray(input?.order) || Array.isArray(input?.councilOrder);
}

export function validatePlanCouncilConfig(input = {}, options = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Plan council configuration must be an object.');
  }
  const normalizedInput = {
    ...input,
    enabled: input?.enabled ?? input?.councilEnabled ?? true,
    ...(!hasRoute(input) ? { order: [...PLAN_COUNCIL_ORDER] } : {}),
  };
  try {
    const config = validateTurboCouncilConfig(normalizedInput, options);
    if (!config.enabled) {
      throw new Error('Plan council must be explicitly enabled.');
    }
    return config;
  } catch (error) {
    throw new Error(String(error?.message || error).replaceAll('Turbo Plan council', 'Plan council'));
  }
}
