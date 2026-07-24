import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const style = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');

test('orange is reserved for Claude while running uses purple', () => {
  assert.match(style, /--claude: #c96a1f/);
  assert.match(style, /--running: #6d4bd1/);
  assert.match(style, /--running-soft: #f1edff/);
  assert.match(style, /\.task-status\.status-running \{\s*color: #6541c1;\s*background: #f1edff;/);
  assert.doesNotMatch(style, /--amber(?:-soft)?:/);
});

test('the Relay identity palette contains no Claude orange slot', () => {
  assert.match(style, /\.relay-color-4 \{ --relay-accent: #2674a8; --relay-soft: #eef8fd; \}/);
  assert.doesNotMatch(style, /\.relay-color-\d[^\n]*(?:#c96a1f|#c95f25)/i);
});

test('queued and cancelled tasks use visibly distinct semantic colors', () => {
  assert.match(style, /\.task-status\.status-queued \{\s*color: #3155b7;\s*background: #eaf0ff;/);
  assert.match(style, /\.task-status\.status-cancelled \{\s*color: #626c7e;\s*background: #f1f2f4;/);
  assert.match(style, /\.task-card\[data-status="queued"\] \.task-duration \{ color: #536a9d; \}/);
  assert.match(style, /\.task-card\[data-status="queued"\] \.task-duration::before \{\s*border-color: #5e79c7;\s*background: #eef3ff;/);
  assert.match(style, /\.task-card\[data-status="cancelled"\] \.task-duration::before \{\s*border-color: #8f98a5;\s*background: #8f98a5;/);
});
