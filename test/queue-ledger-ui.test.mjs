import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const style = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');

test('queue cards expose spaced Today, Ready for review, and Past dividers', () => {
  assert.match(style, /\.task-card \{[^}]*color-mix\(in srgb, var\(--mist\)/);
  assert.match(style, /\.queue-date-heading \{[\s\S]*?margin: 12px 2px 4px;/);
  assert.match(style, /\.queue-review-heading \{[\s\S]*?color: #b12f59;/);
  assert.match(style, /html\[data-theme="dark"\] \.queue-review-heading \{[\s\S]*?color: #ff91aa;/);
  assert.match(app, /queueSection === 'today' \? 'Today' : 'Past'/);
  assert.match(app, /<span>Ready for review<\/span>/);
  assert.match(app, /sortOperationalTasks\(scopedTasks,[\s\S]*?isReadyForReview:/);
});

test('the task queue heading no longer offers a localhost import action', () => {
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const server = readFileSync(new URL('../src/server.mjs', import.meta.url), 'utf8');
  const database = readFileSync(new URL('../src/database.mjs', import.meta.url), 'utf8');

  assert.doesNotMatch(html, /import-tasks-button|task-import-status|Import localhost/);
  assert.doesNotMatch(app, /importTasksButton|taskHistoryImport|import-localhost/);
  assert.doesNotMatch(server, /import-localhost|localhostTaskImport|localhost-task-database/);
  assert.doesNotMatch(database, /importTaskHistory/);
  // Rows imported before the action was removed keep their origin columns and unique index.
  assert.match(database, /this\.ensureColumn\('import_source', 'TEXT'\);/);
  assert.match(database, /this\.ensureColumn\('import_task_id', 'INTEGER'\);/);
  assert.match(database, /idx_tasks_import_origin/);
});
