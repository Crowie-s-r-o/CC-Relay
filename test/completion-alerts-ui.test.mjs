import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const style = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');

test('settings align completion audio and expose configurable speech details', () => {
  assert.match(html, /id="completion-sound"[\s\S]*?value="none"[\s\S]*?value="chime"[\s\S]*?value="bell"[\s\S]*?value="pulse"/);
  assert.match(html, /class="completion-alert-control-row completion-sound-setting"/);
  assert.match(html, /id="completion-speech"[^>]*role="switch"[^>]*aria-controls="completion-speech-options"/);
  assert.match(html, /id="completion-speech-project"[^>]*checked/);
  assert.match(html, /id="completion-speech-task"[^>]*checked/);
  assert.match(html, /id="completion-speech-status"/);
  assert.match(html, /id="completion-speech-words"[^>]*min="1" max="12"/);
  assert.match(html, /id="completion-speech-example"[^>]*aria-live="polite"/);
  assert.match(html, /id="completion-alert-preview"[\s\S]*?>Test<\/button>/);
  assert.match(style, /\.completion-alert-settings \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\);/);
  assert.match(style, /\.completion-speech-choices \{[\s\S]*?grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/);
  assert.match(style, /html\[data-theme="dark"\] \.completion-speech-options/);
});

test('true completion transitions trigger the saved sound and optional voice', () => {
  assert.match(app, /const completedTasks = state\.projectCompletionNotifications\.observe/);
  assert.match(app, /state\.completionAlerts\.notify\(task, state\.completionAlertPreferences\)/);
  assert.match(app, /completionAlerts: state\.completionAlertPreferences/);
  assert.match(app, /setCompletionAlertPreferences\(preferences\.completionAlerts, \{ persist: false \}\)/);
  assert.match(app, /completionSpeechText\([\s\S]*?state\.completionAlertPreferences/);
  assert.match(app, /localStorage\.setItem\('relay\.completionSpeechOptions'/);
  assert.match(app, /taskWords: elements\.completionSpeechWords\.value/);
  assert.match(app, /const operations = \[uiPreferencesReady\.then\(\(\) => load\(\)\)\]/);
});
