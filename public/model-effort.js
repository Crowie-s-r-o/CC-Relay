export const DEFAULT_MODEL_EFFORT = 'high';

export function supportedEffortValues(model) {
  return Array.isArray(model?.supportedReasoningEfforts)
    ? model.supportedReasoningEfforts
      .map((item) => typeof item === 'string' ? item : item?.reasoningEffort)
      .filter(Boolean)
    : [];
}

export function defaultEffortForModel(model) {
  const efforts = supportedEffortValues(model);
  if (efforts.includes(DEFAULT_MODEL_EFFORT)) return DEFAULT_MODEL_EFFORT;
  if (efforts.includes(model?.defaultReasoningEffort)) return model.defaultReasoningEffort;
  return efforts[0] || '';
}
