import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const style = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');

test('direct AI response text is bold without changing other terminal signals', () => {
  assert.match(app, /const bodyClasses = role === 'user'[\s\S]*?: 'event-message-body term-response-body markdown-document terminal-markdown'/);
  assert.match(app, /messageRole: 'assistant'/);
  assert.match(style, /\.detail-panel \.event-list \.term-response-body \{\s*font-size: 12\.5px;\s*font-weight: 650;/);
  assert.match(style, /\.detail-panel \.event-list \.event-message-user \.term-response-body \{\s*font-weight: 500;/);
  assert.match(style, /\.detail-panel \.event-list \.term-cmd \{ font-size: 12\.5px; \}/);
  assert.doesNotMatch(style, /\.detail-panel \.event-list \.term-cmd \{[^}]*font-weight:/);
});
