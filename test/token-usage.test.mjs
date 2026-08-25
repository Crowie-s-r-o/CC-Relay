import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addTokenUsage,
  normalizeTokenUsage,
  providerTokenUsageEvent,
} from '../src/token-usage.mjs';

test('token usage normalizes OpenCode nested cache statistics', () => {
  assert.deepEqual(normalizeTokenUsage({
    input: 100,
    output: 20,
    reasoning: 5,
    cache: { read: 30, write: 4 },
  }), {
    inputTokens: 100,
    outputTokens: 20,
    reasoningTokens: 5,
    cacheReadTokens: 30,
    cacheWriteTokens: 4,
    totalTokens: 159,
  });
});

test('token usage honors a native total and accumulates provider steps', () => {
  const first = normalizeTokenUsage({ inputTokens: 80, outputTokens: 20, totalTokens: 90 });
  const cumulative = addTokenUsage(first, { input_tokens: 10, output_tokens: 5 });
  assert.equal(cumulative.totalTokens, 105);
  assert.deepEqual(providerTokenUsageEvent('opencode', cumulative), {
    type: 'provider/token-usage',
    provider: 'opencode',
    source: 'native',
    cumulative: true,
    usage: cumulative,
  });
});
