import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const markup = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const style = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');

test('Task Activity exposes a default-visible thinking switch', () => {
  assert.match(markup, /id="thinking-visibility-button"[^>]*aria-controls="detail-events"[^>]*aria-pressed="true"[^>]*>\s*<span>Thinking<\/span>/);
  assert.match(app, /showThinking: true/);
  assert.match(app, /filterEventEntries\(grouped, state\.eventFilter, filterOptions\)/);
  assert.match(app, /state\.showThinking = !state\.showThinking/);
  assert.match(app, /Thinking is hidden/);
  assert.match(style, /\.thinking-visibility-button\[aria-pressed="true"\]/);
});

test('thinking visibility keeps counts and copied output aligned with the rendered stream', () => {
  assert.match(app, /all: filterEventEntries\(grouped, 'all', filterOptions\)\.length/);
  assert.match(app, /state\.visibleEventEntries = visible/);
  assert.match(app, /state\.visibleEventEntries\s*\.map\(\(entry\) => eventCopyText/);
  assert.match(app, /updateEventControls\(filterCounts, reasoningCount\)/);
});
