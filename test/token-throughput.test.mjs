import assert from 'node:assert/strict';
import test from 'node:test';
import { tokenThroughput, tokenThroughputFromSnapshot } from '../public/token-throughput.js';

function usageEvent(createdAt, usage, provider = 'opencode') {
  return {
    created_at: createdAt,
    payload: {
      type: 'provider/token-usage',
      provider,
      source: 'native',
      cumulative: true,
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        ...usage,
      },
    },
  };
}

test('token throughput updates against elapsed time during a run', () => {
  const task = {
    provider: 'opencode',
    status: 'running',
    started_at: '2026-08-25T10:00:00.000Z',
  };
  const events = [
    usageEvent('2026-08-25T09:59:59.000Z', {
      totalTokens: 999_999,
      inputTokens: 999_000,
      outputTokens: 999,
    }),
    usageEvent('2026-08-25T10:00:05.000Z', {
      totalTokens: 200_600,
      inputTokens: 200_000,
      outputTokens: 600,
      reasoningTokens: 300,
      cacheReadTokens: 180_000,
    }),
  ];
  const first = tokenThroughput(events, task, Date.parse('2026-08-25T10:00:10.000Z'));
  const later = tokenThroughput(events, task, Date.parse('2026-08-25T10:00:20.000Z'));
  assert.equal(first.tokensPerSecond, 60);
  assert.equal(first.rateLabel, '60.0');
  assert.equal(first.inputTokens, 200_000);
  assert.equal(first.outputTokens, 600);
  assert.equal(first.cacheReadTokens, 180_000);
  assert.equal(later.tokensPerSecond, 30);
});

test('completed throughput freezes at task finish and snapshots use native usage', () => {
  const task = {
    provider: 'opencode',
    status: 'complete',
    started_at: '2026-08-25T10:00:00.000Z',
    finished_at: '2026-08-25T10:00:08.000Z',
  };
  const throughput = tokenThroughputFromSnapshot({
    provider: 'opencode',
    createdAt: '2026-08-25T10:00:07.000Z',
    usage: { totalTokens: 80_800, inputTokens: 80_000, outputTokens: 800 },
  }, task, Date.parse('2026-08-25T11:00:00.000Z'));
  assert.equal(throughput.tokensPerSecond, 100);
  assert.equal(throughput.elapsedSeconds, 8);
});

test('a finished manual session freezes at its last native usage event', () => {
  const task = {
    provider: 'codex',
    status: 'open',
    started_at: '2026-08-25T10:00:00.000Z',
  };
  const throughput = tokenThroughput([
    usageEvent('2026-08-25T10:00:04.000Z', {
      totalTokens: 20_200,
      inputTokens: 20_000,
      outputTokens: 200,
    }, 'codex'),
  ], task, Date.parse('2026-08-25T11:00:00.000Z'));
  assert.equal(throughput.tokensPerSecond, 50);
  assert.equal(throughput.elapsedSeconds, 4);
});

test('computed usage is never presented as provider-native throughput', () => {
  const task = {
    provider: 'opencode',
    status: 'running',
    started_at: '2026-08-25T10:00:00.000Z',
  };
  const event = usageEvent('2026-08-25T10:00:02.000Z', {
    totalTokens: 200,
    inputTokens: 150,
    outputTokens: 50,
  });
  event.payload.source = 'estimated';
  assert.equal(tokenThroughput([event], task, Date.parse('2026-08-25T10:00:04.000Z')), null);
});

test('usage without native input and output components is not labeled as output throughput', () => {
  const task = {
    provider: 'opencode',
    status: 'running',
    started_at: '2026-08-25T10:00:00.000Z',
  };
  const event = usageEvent('2026-08-25T10:00:02.000Z', { totalTokens: 200 });
  delete event.payload.usage.inputTokens;
  delete event.payload.usage.outputTokens;
  assert.equal(tokenThroughput([event], task, Date.parse('2026-08-25T10:00:04.000Z')), null);
});
