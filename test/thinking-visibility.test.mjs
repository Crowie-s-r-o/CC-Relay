import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const markup = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const style = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');

test('Task Activity keeps reasoning visible without a thinking toggle', () => {
  assert.doesNotMatch(markup, /thinking-visibility-button/);
  assert.doesNotMatch(app, /showThinking|thinkingVisibilityButton|updateThinkingVisibilityControl|Thinking is hidden/);
  assert.doesNotMatch(style, /thinking-visibility-button/);
  assert.match(app, /filterEventEntries\(grouped, state\.eventFilter\)/);
});

test('thinking visibility keeps counts and copied output aligned with the rendered stream', () => {
  assert.match(app, /all: filterEventEntries\(grouped, 'all'\)\.length/);
  assert.match(app, /state\.visibleEventEntries = visible/);
  assert.match(app, /state\.visibleEventEntries\s*\.map\(\(entry\) => eventCopyText/);
  assert.match(app, /updateEventControls\(filterCounts\)/);
});

test('reasoning previews are bounded while Copy log keeps the stored text', () => {
  assert.match(app, /const REASONING_PREVIEW_LIMIT = 50_000/);
  assert.match(app, /preview: reasoningPreview\(summary\)/);
  assert.match(app, /Copy log retains the complete reasoning/);
  assert.match(app, /item\?\.type === 'reasoning'[\s\S]*?lines\.push\(\(item\.summary \|\| \[\]\)/);
});
