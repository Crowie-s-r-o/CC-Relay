const CLAUDE_FULL_EFFORTS = [
  ['low', 'Fastest for small, well-scoped work.'],
  ['medium', 'Balanced for routine implementation.'],
  ['high', 'More analysis for difficult changes.'],
  ['xhigh', 'Deeper reasoning for agentic coding work.'],
  ['max', 'Maximum depth for the hardest tasks.'],
];

function effortOptions(entries) {
  return entries.map(([reasoningEffort, description]) => ({ reasoningEffort, description }));
}

const CLAUDE_LEGACY_MODEL_ALIASES = Object.freeze(['best']);

export function normalizeClaudeModel(model) {
  const requested = typeof model === 'string' ? model.trim() : '';
  return CLAUDE_LEGACY_MODEL_ALIASES.includes(requested) ? 'fable' : requested;
}

export const CLAUDE_MODELS = [
  {
    model: 'default',
    displayName: 'Account default',
    description: 'Use the recommended Claude model for the connected account.',
    isDefault: true,
    defaultReasoningEffort: 'high',
    supportedReasoningEfforts: effortOptions(CLAUDE_FULL_EFFORTS),
  },
  {
    model: 'opus',
    displayName: 'Opus',
    description: 'The latest Opus model for complex reasoning and implementation.',
    isDefault: false,
    defaultReasoningEffort: 'high',
    supportedReasoningEfforts: effortOptions(CLAUDE_FULL_EFFORTS),
  },
  {
    model: 'fable',
    displayName: 'Fable',
    description: 'Fable 5 for the hardest and longest-running tasks.',
    isDefault: false,
    defaultReasoningEffort: 'high',
    supportedReasoningEfforts: effortOptions(CLAUDE_FULL_EFFORTS),
    legacyModelAliases: CLAUDE_LEGACY_MODEL_ALIASES,
  },
  {
    model: 'sonnet',
    displayName: 'Sonnet',
    description: 'The latest Sonnet model for daily coding work.',
    isDefault: false,
    defaultReasoningEffort: 'high',
    supportedReasoningEfforts: effortOptions(CLAUDE_FULL_EFFORTS),
  },
  {
    model: 'haiku',
    displayName: 'Haiku',
    description: 'The fast Claude model for simple and narrow tasks.',
    isDefault: false,
    defaultReasoningEffort: null,
    supportedReasoningEfforts: [],
  },
];

export function validateExecutionSettings({ model, effort, models }) {
  const requestedModel = typeof model === 'string' ? model.trim() : '';
  const requestedEffort = typeof effort === 'string' ? effort.trim() : '';
  if (!requestedModel && !requestedEffort) {
    return { model: null, effort: null };
  }

  const selectedModel = requestedModel
    ? models.find((item) => item.model === requestedModel)
      || models.find((item) => item.legacyModelAliases?.includes(requestedModel))
    : models.find((item) => item.isDefault) || models[0];
  if (!selectedModel) {
    throw new Error(requestedModel
      ? `Model is not available for this account: ${requestedModel}`
      : 'No model is available for this account.');
  }

  if (requestedEffort) {
    const supported = selectedModel.supportedReasoningEfforts
      .some((item) => item.reasoningEffort === requestedEffort);
    if (!supported) {
      throw new Error(`${selectedModel.displayName} does not support ${requestedEffort} effort.`);
    }
  }

  return {
    model: requestedModel ? selectedModel.model : null,
    effort: requestedEffort || null,
  };
}
