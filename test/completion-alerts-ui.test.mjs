import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const style = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');

test('settings offer selectable completion sounds, speech, and a preview', () => {
  assert.match(html, /id="completion-sound"[\s\S]*?value="none"[\s\S]*?value="chime"[\s\S]*?value="bell"[\s\S]*?value="pulse"/);
  assert.match(html, /id="completion-speech"/);
  assert.match(html, /id="completion-alert-preview"[\s\S]*?>Test<\/button>/);
  assert.match(style, /\.completion-alert-settings \{/);
  assert.match(style, /html\[data-theme="dark"\] \.completion-alert-settings/);
});

test('true completion transitions trigger the saved sound and optional voice', () => {
  assert.match(app, /const completedTasks = state\.projectCompletionNotifications\.observe/);
  assert.match(app, /state\.completionAlerts\.notify\(task, state\.completionAlertPreferences\)/);
  assert.match(app, /completionAlerts: state\.completionAlertPreferences/);
  assert.match(app, /setCompletionAlertPreferences\(preferences\.completionAlerts, \{ persist: false \}\)/);
  assert.match(app, /const operations = \[uiPreferencesReady\.then\(\(\) => load\(\)\)\]/);
});
