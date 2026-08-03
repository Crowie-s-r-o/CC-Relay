import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const electron = readFileSync(new URL('../src/electron-main.mjs', import.meta.url), 'utf8');
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const server = readFileSync(new URL('../src/server.mjs', import.meta.url), 'utf8');
const style = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');

test('desktop exposes a guarded localhost task import action', () => {
  assert.match(html, /id="import-tasks-button"[^>]*hidden/);
  assert.match(html, /id="task-import-status"[^>]*role="status"/);
  assert.match(electron, /'--relay-desktop'/);
  assert.match(server, /localhostTaskImport: true/);
  assert.match(server, /pathname === '\/api\/tasks\/import-localhost'/);
  assert.match(app, /api\('\/api\/tasks\/import-localhost'/);
  assert.match(app, /taskHistoryImport/);
});

test('queue cards use the project canvas tint and expose Today and Past dividers', () => {
  assert.match(style, /\.task-card \{[^}]*color-mix\(in srgb, var\(--mist\)/);
  assert.match(style, /\.queue-date-heading \{/);
  assert.match(app, /queuePeriod === 'today' \? 'Today' : 'Past'/);
});
