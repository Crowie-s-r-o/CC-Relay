import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const style = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');

test('orange is reserved for Claude while running uses purple', () => {
  assert.match(style, /--claude: #c94f2c/);
  assert.match(style, /--running: #7857d8/);
  assert.match(style, /--running-soft: #f3efff/);
  assert.match(style, /\.task-status\.status-running \{\s*color: #6947c7;\s*background: #f3efff;/);
  assert.doesNotMatch(style, /--amber(?:-soft)?:/);
});

test('the CC Relay identity palette contains no Claude orange slot', () => {
  assert.match(style, /\.relay-color-4 \{ --relay-accent: #147bab; --relay-soft: #eaf8ff; \}/);
  assert.doesNotMatch(style, /\.relay-color-\d[^\n]*(?:#c94f2c|#c95f25)/i);
});

test('queued and cancelled tasks use visibly distinct semantic colors', () => {
  assert.match(style, /\.task-status\.status-queued \{\s*color: #3657c8;\s*background: #edf2ff;/);
  assert.match(style, /\.task-status\.status-cancelled \{\s*color: #626c7e;\s*background: #f1f2f4;/);
  assert.match(style, /\.task-card\[data-status="queued"\] \.task-duration \{ color: #5069aa; \}/);
  assert.match(style, /\.task-card\[data-status="queued"\] \.task-duration::before \{\s*border-color: #617de5;\s*background: #edf2ff;/);
  assert.match(style, /\.task-card\[data-status="cancelled"\] \.task-duration::before \{\s*border-color: #8f98a5;\s*background: #8f98a5;/);
});
