const TOKEN_LEVELS = [
  { maximum: 50_000, key: 'quiet', label: 'Quiet' },
  { maximum: 200_000, key: 'steady', label: 'Steady' },
  { maximum: 500_000, key: 'heavy', label: 'Heavy' },
  { maximum: Infinity, key: 'intense', label: 'Intense' },
];

function nonNegativeInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : 0;
}

export function compactTokenCount(value) {
  const tokens = nonNegativeInteger(value);
  if (tokens < 1_000) return tokens.toLocaleString('en-US');
  if (tokens < 10_000) return `${(tokens / 1_000).toFixed(1)}k`;
  if (tokens < 1_000_000) return `${Math.round(tokens / 1_000)}k`;
  return `${(tokens / 1_000_000).toFixed(tokens >= 100_000_000 ? 0 : 1)}m`;
}

export function taskTokenPresentation(task) {
  const metrics = task?.conversation_metrics;
  if (!metrics || ![true, 1].includes(metrics.token_observed)) return null;

  const inputTokens = nonNegativeInteger(metrics.input_tokens);
  const outputTokens = nonNegativeInteger(metrics.output_tokens);
  const measuredTokens = inputTokens + outputTokens;
  const totalTokens = Object.hasOwn(metrics, 'total_tokens')
    ? nonNegativeInteger(metrics.total_tokens)
    : measuredTokens;
  const otherTokens = Math.max(0, totalTokens - outputTokens);
  const level = TOKEN_LEVELS.find((candidate) => totalTokens < candidate.maximum)
    || TOKEN_LEVELS.at(-1);
  const title = [
    `${totalTokens.toLocaleString('en-US')} provider-reported tokens`,
    `${outputTokens.toLocaleString('en-US')} output tokens`,
    `${otherTokens.toLocaleString('en-US')} input, cache, reasoning, or unclassified tokens`,
    `${level.label} token load`,
  ].join(' | ');

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    otherTokens,
    combinedTokens: totalTokens,
    inputLabel: compactTokenCount(inputTokens),
    outputLabel: compactTokenCount(outputTokens),
    totalLabel: compactTokenCount(totalTokens),
    level: level.key,
    levelLabel: level.label,
    title,
  };
}

const PROVIDER_LABELS = {
  claude: 'Claude',
  codex: 'Codex',
  opencode: 'OpenCode',
};

export function dailyTokenUsagePresentation(usage, { supported = true } = {}) {
  if (!supported) {
    return {
      label: 'Today --',
      title: 'Restart CC Relay to show today\'s recorded token usage.',
      state: 'unavailable',
      totalTokens: null,
      projects: [],
    };
  }
  const totalTokens = nonNegativeInteger(usage?.totalTokens);
  if (totalTokens === 0) {
    return {
      label: 'Today 0',
      title: 'No provider-reported token usage has been recorded today.',
      state: 'empty',
      totalTokens,
      inputTokens: 0,
      outputTokens: 0,
      projects: [],
    };
  }
  const providers = usage?.providers && typeof usage.providers === 'object'
    ? usage.providers
    : {};
  const inputTokens = nonNegativeInteger(usage?.inputTokens);
  const outputTokens = nonNegativeInteger(usage?.outputTokens);
  const projects = Array.isArray(usage?.projects)
    ? usage.projects.map((project) => ({
      name: String(project?.name || project?.path || 'Unknown project'),
      path: String(project?.path || ''),
      inputTokens: nonNegativeInteger(project?.inputTokens),
      outputTokens: nonNegativeInteger(project?.outputTokens),
      totalTokens: nonNegativeInteger(project?.totalTokens),
    })).filter((project) => project.totalTokens > 0)
    : [];
  const providerOrder = Object.keys(PROVIDER_LABELS);
  const providerTotals = Object.entries(providers)
    .map(([provider, value]) => ({
      provider,
      totalTokens: nonNegativeInteger(value?.totalTokens ?? value),
    }))
    .filter((entry) => entry.totalTokens > 0)
    .sort((left, right) => {
      const leftIndex = providerOrder.indexOf(left.provider);
      const rightIndex = providerOrder.indexOf(right.provider);
      if (leftIndex === -1 && rightIndex === -1) return left.provider.localeCompare(right.provider);
      if (leftIndex === -1) return 1;
      if (rightIndex === -1) return -1;
      return leftIndex - rightIndex;
    });
  const breakdown = providerTotals.length > 0
    ? ` ${providerTotals.map((entry) => (
      `${PROVIDER_LABELS[entry.provider] || entry.provider}: ${entry.totalTokens.toLocaleString('en-US')}`
    )).join(' | ')}.`
    : '';
  return {
    label: `Today In ${compactTokenCount(inputTokens)} Out ${compactTokenCount(outputTokens)}`,
    title: `Today's recorded usage: ${inputTokens.toLocaleString('en-US')} input and ${outputTokens.toLocaleString('en-US')} output tokens; ${totalTokens.toLocaleString('en-US')} provider-reported tokens.${breakdown} Provider totals include cache, reasoning, and completed Claude sub-agent usage when reported.`,
    state: 'ready',
    totalTokens,
    inputTokens,
    outputTokens,
    projects,
  };
}
