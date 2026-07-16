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
    model: 'best',
    displayName: 'Best available',
    description: 'Use Fable when available, otherwise the latest Opus model.',
    isDefault: false,
    defaultReasoningEffort: 'high',
    supportedReasoningEfforts: effortOptions(CLAUDE_FULL_EFFORTS),
  },
  {
    model: 'fable',
    displayName: 'Fable',
    description: 'Claude model for the hardest and longest-running tasks.',
    isDefault: false,
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
    model: requestedModel || null,
    effort: requestedEffort || null,
  };
}
