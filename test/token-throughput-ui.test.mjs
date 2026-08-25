import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const style = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');

test('native token speed is visible in Task Activity and the running-task header', () => {
  assert.match(app, /import \{ tokenThroughput, tokenThroughputFromSnapshot \}/);
  assert.match(app, /data-task-token-speed/);
  assert.match(app, /data-header-token-speed="\$\{task\.id\}"/);
  assert.match(app, /tokens\/s/);
  assert.match(style, /\.event-metrics \.has-token-speed/);
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
