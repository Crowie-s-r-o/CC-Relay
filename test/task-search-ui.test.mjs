import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const style = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');
const server = readFileSync(new URL('../src/server.mjs', import.meta.url), 'utf8');

test('task list exposes a capability-gated full conversation search', () => {
  assert.match(html, /id="task-search-input"[^>]*type="search"[^>]*maxlength="200"/);
  assert.match(html, /Search every command and response/);
  assert.match(server, /taskFullTextSearch: true/);
  assert.match(server, /pathname === '\/api\/tasks\/search'/);
  assert.match(server, /database\.listTaskSearchDocuments\(resolve\(requestedPath\)\)/);
  assert.match(app, /capabilities\?\.taskFullTextSearch === true/);
  assert.match(app, /TASK_SEARCH_DEBOUNCE_MS/);
});

test('task search supersedes date filtering and keeps filtered queue cards read-only', () => {
  assert.match(app, /const searching = taskSearchActive\(state\.taskSearchQuery\)/);
  assert.match(app, /searching\s+\? tasksForSearchResults\(scopedTasks, state\.taskSearchResults\)/);
  assert.match(app, /const operationalQueue = !historyActive && !searching/);
  assert.match(app, /button\.disabled = searching/);
  assert.match(app, /taskSearchMatchMarkup\(searchMatch\)/);
});

test('task search has responsive light and dark evidence styling', () => {
  assert.match(style, /\.task-search:focus-within/);
  assert.match(style, /\.task-search-match\[data-source="response"\]::before/);
  assert.match(style, /\.task-search-match mark/);
  assert.match(style, /html\[data-theme="dark"\] \.task-search/);
  assert.match(style, /html\[data-theme="dark"\] \.task-search input \{[\s\S]*?background: transparent;[\s\S]*?box-shadow: none;[\s\S]*?\}/);
  assert.match(style, /html\[data-theme="dark"\] \.task-search input:focus \{[\s\S]*?box-shadow: none;[\s\S]*?\}/);
  assert.match(style, /@media \(max-width: 760px\)[\s\S]*?\.task-search kbd/);
  assert.match(style, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.task-search/);
});
