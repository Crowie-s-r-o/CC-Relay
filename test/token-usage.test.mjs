import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addTokenUsage,
  codexTurnTokenUsage,
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

test('token usage recognizes Codex cache-write input tokens', () => {
  assert.deepEqual(normalizeTokenUsage({
    inputTokens: 100,
    outputTokens: 20,
    cachedInputTokens: 70,
    cacheWriteInputTokens: 6,
    totalTokens: 120,
  }), {
    inputTokens: 100,
    outputTokens: 20,
    reasoningTokens: 0,
    cacheReadTokens: 70,
    cacheWriteTokens: 6,
    totalTokens: 120,
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

test('Codex task usage subtracts the pre-attempt total and grows cumulatively', () => {
  const first = codexTurnTokenUsage({
    total: {
      totalTokens: 1_050,
      inputTokens: 1_000,
      cachedInputTokens: 800,
      outputTokens: 50,
      reasoningOutputTokens: 20,
    },
    last: {
      totalTokens: 150,
      inputTokens: 100,
      cachedInputTokens: 80,
      outputTokens: 50,
      reasoningOutputTokens: 20,
    },
  });
  assert.deepEqual(first.usage, {
    inputTokens: 100,
    outputTokens: 50,
    reasoningTokens: 20,
    cacheReadTokens: 80,
    cacheWriteTokens: 0,
    totalTokens: 150,
  });

  const second = codexTurnTokenUsage({
    total: {
      totalTokens: 1_300,
      inputTokens: 1_200,
      cachedInputTokens: 950,
      outputTokens: 100,
      reasoningOutputTokens: 30,
    },
    last: {
      totalTokens: 250,
      inputTokens: 200,
      cachedInputTokens: 150,
      outputTokens: 50,
      reasoningOutputTokens: 10,
    },
  }, first.baseline);
  assert.deepEqual(second.usage, {
    inputTokens: 300,
    outputTokens: 100,
    reasoningTokens: 30,
    cacheReadTokens: 230,
    cacheWriteTokens: 0,
    totalTokens: 400,
  });
});
