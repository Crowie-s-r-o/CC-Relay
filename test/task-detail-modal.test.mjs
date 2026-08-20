import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const markup = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const style = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');

function sourceBetween(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex);
  assert.notEqual(startIndex, -1, `${start} should exist`);
  assert.notEqual(endIndex, -1, `${end} should exist after ${start}`);
  return source.slice(startIndex, endIndex);
}

test('the compact inspector opens every full task surface in one modal', () => {
  assert.match(markup, /id="task-detail-open"[^>]*aria-haspopup="dialog"[^>]*aria-controls="task-detail-modal"/);
  const modal = sourceBetween(markup, '<dialog id="task-detail-modal"', '</dialog>');
  for (const id of [
    'plan-preview',
    'turbo-preview',
    'prompt-section',
    'detail-attachments-section',
    'session-history',
    'result-section',
  ]) {
    assert.match(modal, new RegExp(`id="${id}"`));
  }
  assert.ok(markup.indexOf('id="session-strip"') < markup.indexOf('<dialog id="task-detail-modal"'));
  assert.ok(markup.indexOf('</dialog>') < markup.indexOf('id="terminal-height-resizer"'));
});

test('task detail modal wiring supports normal tasks, council tasks, and backdrop close', () => {
  assert.match(app, /elements\.taskDetailModal\.showModal\(\)/);
  assert.match(app, /elements\.taskDetailModal\.close\(\)/);
  assert.match(
    app,
    /function openTaskDetailModal\(\) \{[\s\S]*?if \(!elements\.promptSection\.hidden\) elements\.promptSection\.open = true;[\s\S]*?elements\.taskDetailModal\.showModal\(\)/,
  );
  assert.match(app, /task\.mode === 'plan' \? 'Council details' : manualSessionSurface \? 'Session details' : 'Full details'/);
  assert.match(app, /event\.target === elements\.taskDetailModal/);
  assert.match(app, /function revealPlanExecution\(\) \{[\s\S]*?openTaskDetailModal\(\);/);
});

test('the terminal is taller by default and new inspector geometry uses em units', () => {
  assert.match(
    style,
    /\.detail-panel #task-detail \{\s*grid-template-rows: minmax\(7\.5em, 1fr\) \.4375em minmax\(11\.25em, var\(--event-terminal-height, min\(84%, calc\(100% - 9\.375em\)\)\)\);/,
  );
  assert.match(style, /#task-detail:has\(\.session-strip:not\(\[hidden\]\)\)[^{]*\{[\s\S]*?72%/);
  assert.match(app, /state\.terminalHeight \|\| renderedHeight/);
  assert.doesNotMatch(app, /state\.terminalHeight \|\| elements\.taskDetail\.clientHeight \/ 2/);
  assert.match(style, /\.task-detail-modal \{\s*width: min\(72em, calc\(100vw - 2em\)\);/);
  assert.match(style, /\.task-detail-modal-body \{[\s\S]*?padding: 1\.25em 1\.5em 1\.75em;/);
  assert.match(style, /html\[data-theme="dark"\] \.task-detail-modal \.plan-stage\[data-state="complete"\]/);
});

test('the compact inspector names the task and emphasizes its execution profile', () => {
  assert.match(markup, /id="detail-task-name" class="detail-task-name"/);
  assert.match(markup, /id="detail-execution-profile" class="detail-execution-profile"/);
  assert.match(
    app,
    /function taskInspectorDefinition\(task\) \{[\s\S]*?const generatedTitle = compactText\(prompt, 80\);[\s\S]*?title !== generatedTitle \? title : prompt/,
  );
  assert.match(app, /elements\.detailTaskName\.textContent = taskInspectorDefinition\(task\);/);
  assert.match(
    style,
    /\.detail-panel \.detail-task-name \{[\s\S]*?display: -webkit-box;[\s\S]*?overflow-wrap: anywhere;[\s\S]*?-webkit-line-clamp: 3;[\s\S]*?white-space: normal;/,
  );
  assert.match(app, /elements\.detailExecutionProfile\.innerHTML = `[\s\S]*?executionLabel\(task\)/);
  assert.match(style, /\.detail-panel \.detail-execution-profile strong \{[\s\S]*?font-size: 13px;/);
});

test('the full task record uses comfortable reading typography', () => {
  assert.match(style, /\.task-detail-modal-header h2 \{\s*font-size: 18px;/);
  assert.match(style, /\.task-detail-modal-header p \{\s*font-size: 12px;/);
  assert.match(style, /\.detail-copy-disclosure > summary b \{[^}]*font-size: 13px;/s);
  assert.match(style, /\.detail-panel \.detail-copy-disclosure > pre \{[^}]*font-size: 13px;[^}]*line-height: 1\.55;/s);
  assert.match(style, /\.detail-panel \.detail-copy-disclosure > \.result-markdown \{[^}]*font-size: 15px;[^}]*line-height: 1\.7;/s);
});
