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
