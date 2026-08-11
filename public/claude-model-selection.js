const CLAUDE_MODEL_ALIASES = new Map([['best', 'fable']]);

export function normalizeClaudeModelSelection(model) {
  return CLAUDE_MODEL_ALIASES.get(model) || model;
}

export function supportedClaudeModelCatalog(models) {
  if (!Array.isArray(models)) return [];
  const hasFable = models.some((model) => model?.model === 'fable');
  return models.flatMap((model) => {
    if (model?.model !== 'best') return [model];
    if (hasFable) return [];
    return [{ ...model, model: 'fable', displayName: 'Fable' }];
  });
}
