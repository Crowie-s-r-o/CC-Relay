import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const markup = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const style = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');

test('terminal controls expose separate user and AI message filters with live counts', () => {
  assert.match(markup, /data-event-filter="mine"[^>]*>[\s\S]*?My messages[\s\S]*?data-event-filter-count/);
  assert.match(markup, /data-event-filter="ai"[^>]*>[\s\S]*?AI messages[\s\S]*?data-event-filter-count/);
  assert.match(app, /mine: messageCounts\.user,[\s\S]*?ai: messageCounts\.assistant/);
  assert.match(app, /button\.setAttribute\('aria-label', `\$\{label\}: \$\{count\} signal/);
  assert.match(style, /\.event-filters \{[^}]*overflow-x: auto;[^}]*scrollbar-width: none;/s);
});

test('terminal message rows identify the speaker and preserve original signal numbers', () => {
  assert.match(app, /messageRole: 'assistant'/);
  assert.match(app, /messageRole: 'user'/);
  assert.match(app, /payloadType === 'claude\/message' \|\| lastEvent\?\.kind === 'result'/);
  assert.match(app, /const roleLabel = role === 'user' \? 'My message' : 'AI message'/);
  assert.match(app, /const entrySequence = new Map\(grouped\.map/);
  assert.match(app, /renderEventEntry\(entry, task, entrySequence\.get\(entry\)\)/);
  assert.match(style, /\.event-message-user \.term-response \{[^}]*border-left-color: rgb\(115 218 202 \/ 58%\);/s);
  assert.match(style, /\.event-provider-claude\.event-message-assistant \.term-response/);
});

test('terminal rendering merges canonical prompt history without mutating provider events', () => {
  assert.match(app, /mergePromptMessages\(events, prompts, \{ provider: taskProvider\(task\) \}\)/);
  assert.match(app, /state\.selectedTaskPrompts = prompts/);
  assert.match(app, /renderEventStream\(events, task, \{[\s\S]*?prompts: promptHistory,[\s\S]*?\}\);/);
  assert.match(app, /<small>sent<\/small>/);
  assert.match(app, /<small>AI messages<\/small>/);
});

test('terminal status bar keeps full model beside effort without relay or follow labels', () => {
  const statusBar = markup.match(/<div class="term-statusbar"[\s\S]*?<\/div>/)?.[0] || '';
  const signalsIndex = statusBar.indexOf('id="event-summary"');
  const modelIndex = statusBar.indexOf('id="term-provider"');
  const effortIndex = statusBar.indexOf('id="term-effort"');
  const durationIndex = statusBar.indexOf('id="term-duration"');

  assert.ok(signalsIndex >= 0);
  assert.ok(signalsIndex < modelIndex);
  assert.ok(modelIndex < effortIndex);
  assert.ok(effortIndex < durationIndex);
  assert.doesNotMatch(statusBar, /term-relay|follow-events-button|Following/);
  assert.doesNotMatch(app, /termRelay|followEventsButton/);
  assert.match(style, /\.term-seg-provider \{[\s\S]*?flex: 0 0 auto;[\s\S]*?\}/);
  assert.doesNotMatch(style, /\.term-seg-provider[^}]*text-overflow/);
  assert.doesNotMatch(style, /\.term-seg-effort \{ display: none; \}/);
});
