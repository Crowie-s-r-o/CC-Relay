import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const style = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');

test('average output-token speed and usage totals are visible in Task Activity and the running-task header', () => {
  assert.match(app, /import \{ tokenThroughput, tokenThroughputFromSnapshot \}/);
  assert.match(app, /data-task-token-speed/);
  assert.match(app, /data-header-token-speed="\$\{task\.id\}"/);
  assert.match(app, /tokens\/s/);
  assert.match(app, /output tokens\/s/);
  assert.match(app, /input tokens/);
  assert.match(app, /output tokens/);
  assert.match(app, /nativeTokenUsageTitle/);
  assert.match(app, /throughput\?\.reasoningTokens \?\? stats\.thinkingTokens/);
  assert.match(style, /\.event-metrics \.has-token-speed/);
  assert.match(style, /\.event-metrics \.has-token-input/);
  assert.match(style, /\.event-metrics \.has-token-output/);
  assert.match(style, /\.header-running-token-speed/);
});

test('both live token-speed surfaces refresh on the one-second duration tick', () => {
  const start = app.indexOf('function refreshTaskDurations()');
  const end = app.indexOf('\nasync function reorderQueuedTasks', start);
  const source = app.slice(start, end);

  assert.match(source, /tokenThroughputFromSnapshot\(task\.latestTokenUsage, task\)/);
  assert.match(source, /querySelector\('\[data-task-token-speed\]'\)/);
  assert.match(source, /tokenThroughput\(state\.selectedTaskEvents, fresh\)/);
});

test('conversation cards show heat-colored lifetime provider and output totals', () => {
  assert.match(app, /dailyTokenUsagePresentation,[\s\S]*?taskTokenPresentation,[\s\S]*?from '\.\/task-conversation-metrics\.js';/);
  assert.match(app, /taskTokenMetricsMarkup\(tokenUsage\)/);
  assert.match(app, /taskTokenMetricsMarkup\(tokenUsage, 'header-running-token-usage'\)/);
  assert.match(app, /<small>Total<\/small>/);
  assert.match(app, /<small>Out<\/small>/);
  assert.match(app, /data-token-level=/);
  assert.match(style, /\.task-token-metrics\[data-token-level="quiet"\]/);
  assert.match(style, /\.task-token-metrics\[data-token-level="steady"\]/);
  assert.match(style, /\.task-token-metrics\[data-token-level="heavy"\]/);
  assert.match(style, /\.task-token-metrics\[data-token-level="intense"\]/);
  assert.match(style, /html\[data-theme="dark"\] \.task-token-metrics/);
});
