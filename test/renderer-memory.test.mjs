import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const database = readFileSync(new URL('../src/database.mjs', import.meta.url), 'utf8');
const server = readFileSync(new URL('../src/server.mjs', import.meta.url), 'utf8');

test('task snapshots use compact summaries with event revisions', () => {
  assert.match(database, /listTaskSummaries\(\) \{/);
  assert.match(database, /name === 'prompt'[\s\S]*?ELSE substr\(\$\{identifier\}, 1, 512\) END AS prompt/);
  assert.match(database, /ORDER BY events\.id DESC\s*LIMIT 1[\s\S]*?AS latest_event_id/);
  assert.match(server, /pathname === '\/api\/status'[\s\S]*?const tasks = database\.listTaskSummaries\(\)/);
  assert.match(server, /pathname === '\/api\/tasks'[\s\S]*?database\.listTaskSummaries\(\)/);
  assert.match(server, /eventRevision: database\.latestEventId\(taskId\)/);
});

test('server push is primary and the full snapshot poll is a slow fallback', () => {
  assert.match(app, /const SNAPSHOT_FALLBACK_POLL_MS = 15_000;/);
  assert.match(app, /new EventSource\('\/api\/events'\)/);
  assert.match(app, /setInterval\(\(\) => \{[\s\S]*?load\(\)\.catch\(console\.error\);[\s\S]*?SNAPSHOT_FALLBACK_POLL_MS\);/);
});

test('unchanged task lists and selected details skip repeated reconstruction', () => {
  assert.match(app, /function taskListRenderSignature\(visibleTasks, searching\)/);
  assert.match(app, /key === 'latest_event_id' \? undefined : value/);
  assert.match(app, /if \(renderedTaskListSignature === listSignature\) return;/);
  assert.match(app, /const detailIsCurrent = supportsEventRevision[\s\S]*?selectedTaskEventRevision[\s\S]*?selectedTaskSnapshotSignature/);
  assert.match(app, /if \(!detailIsCurrent\) await selectTask\(state\.selectedTaskId\);/);
});

test('conversation extraction filters canonical event shapes in SQLite', () => {
  assert.match(database, /listTaskPrompts\(taskId\)[\s\S]*?json_extract\(payload, '\$\.item\.type'\) = 'userMessage'/);
  assert.match(database, /listTaskResponses\(taskId\)[\s\S]*?json_extract\(payload, '\$\.type'\) = 'item\/completed'/);
  assert.match(database, /listTaskSearchDocuments\(repoPath\)[\s\S]*?json_valid\(payload\) = 1[\s\S]*?json_extract\(payload, '\$\.type'\) IN \('claude\/message', 'opencode\/message'\)/);
});
