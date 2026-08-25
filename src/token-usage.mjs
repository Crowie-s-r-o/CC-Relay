function nonNegativeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function firstNumber(source, names) {
  for (const name of names) {
    if (source && Object.hasOwn(source, name)) {
      const number = Number(source[name]);
      if (Number.isFinite(number) && number >= 0) return number;
    }
  }
  return null;
}

export function normalizeTokenUsage(value) {
  const source = value && typeof value === 'object' ? value : {};
  const cache = source.cache && typeof source.cache === 'object' ? source.cache : {};
  const inputTokens = firstNumber(source, ['inputTokens', 'input_tokens', 'input']) || 0;
  const outputTokens = firstNumber(source, ['outputTokens', 'output_tokens', 'output']) || 0;
  const reasoningTokens = firstNumber(source, [
    'reasoningTokens',
    'reasoning_tokens',
    'reasoningOutputTokens',
    'reasoning_output_tokens',
    'reasoning',
  ]) || 0;
  const cacheReadTokens = firstNumber(source, [
    'cacheReadTokens',
    'cache_read_tokens',
    'cacheReadInputTokens',
    'cache_read_input_tokens',
    'cachedInputTokens',
    'cached_input_tokens',
    'cache_read',
    'cacheRead',
  ]) ?? firstNumber(cache, ['read', 'readTokens', 'read_tokens']) ?? 0;
  const cacheWriteTokens = firstNumber(source, [
    'cacheWriteTokens',
    'cache_write_tokens',
    'cacheCreationInputTokens',
    'cache_creation_input_tokens',
    'cache_write',
    'cacheWrite',
  ]) ?? firstNumber(cache, ['write', 'writeTokens', 'write_tokens']) ?? 0;
  const measuredTotal = inputTokens
    + outputTokens
    + reasoningTokens
    + cacheReadTokens
    + cacheWriteTokens;
  const reportedTotal = firstNumber(source, ['totalTokens', 'total_tokens', 'total']);

  return {
    inputTokens,
    outputTokens,
    reasoningTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens: reportedTotal ?? measuredTotal,
  };
}

export function addTokenUsage(left, right) {
  const first = normalizeTokenUsage(left);
  const second = normalizeTokenUsage(right);
  return {
    inputTokens: first.inputTokens + second.inputTokens,
    outputTokens: first.outputTokens + second.outputTokens,
    reasoningTokens: first.reasoningTokens + second.reasoningTokens,
    cacheReadTokens: first.cacheReadTokens + second.cacheReadTokens,
    cacheWriteTokens: first.cacheWriteTokens + second.cacheWriteTokens,
    totalTokens: first.totalTokens + second.totalTokens,
  };
}

export function providerTokenUsageEvent(provider, usage, {
  source = 'native',
  cumulative = true,
} = {}) {
  return {
    type: 'provider/token-usage',
    provider,
    source,
    cumulative,
    usage: normalizeTokenUsage(usage),
  };
}

export function codexTurnTokenUsage(tokenUsage) {
  const source = tokenUsage && typeof tokenUsage === 'object' ? tokenUsage : {};
  return normalizeTokenUsage(source.last || source.total || source);
}

export function tokenUsageMessage(provider, usage) {
  const total = Math.round(nonNegativeNumber(normalizeTokenUsage(usage).totalTokens));
  const label = provider === 'opencode' ? 'OpenCode' : provider === 'claude' ? 'Claude' : 'Codex';
  return `${label} used ${total.toLocaleString('en-US')} tokens so far.`;
}
