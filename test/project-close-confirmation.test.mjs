import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const markup = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const style = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');

function sourceBetween(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex);
  assert.notEqual(startIndex, -1, `${start} should exist`);
  assert.notEqual(endIndex, -1, `${end} should exist after ${start}`);
  return source.slice(startIndex, endIndex);
}

test('closing a project opens an accessible confirmation with Cancel as the safe default', () => {
  const modal = sourceBetween(markup, '<dialog id="project-close-modal"', '</dialog>');
  assert.match(modal, /class="terminal-settings-modal project-close-modal"/);
  assert.match(modal, /aria-labelledby="project-close-title"/);
  assert.match(modal, /aria-describedby="project-close-description"/);
  assert.match(modal, /id="project-close-name"/);
  assert.match(modal, /id="project-close-path"/);
  assert.match(modal, /Project files and saved tasks are not deleted/);
  assert.match(modal, /id="project-close-cancel"[^>]*autofocus>Cancel<\/button>/);
  assert.match(modal, /id="project-close-confirm" class="button danger compact"[^>]*>Close project<\/button>/);
  assert.match(app, /data-project-action="delete" aria-label="Close \$\{escapeHtml\(project\.name\)\}"/);
});

test('the project close action waits for confirmation and locks the modal during deletion', () => {
  const closeFlow = sourceBetween(app, 'function projectCloseTarget()', 'function projectColorTarget()');
  assert.match(closeFlow, /state\.projects\.length <= 1/);
  assert.match(closeFlow, /elements\.projectCloseModal\.showModal\(\)/);
  assert.match(closeFlow, /elements\.projectCloseCancel\.focus\(\)/);
  assert.match(closeFlow, /elements\.projectCloseCard\.setAttribute\('aria-busy', String\(submitting\)\)/);
  assert.match(closeFlow, /elements\.projectCloseDismiss\.disabled = submitting/);
  assert.match(closeFlow, /elements\.projectCloseCancel\.disabled = submitting/);
  assert.match(closeFlow, /elements\.projectCloseConfirm\.disabled = submitting/);
  assert.match(closeFlow, /if \(!project\) \{[\s\S]*?closeProjectCloseConfirmation\(\);[\s\S]*?This project is already closed\./);
  assert.match(closeFlow, /api\(`\/api\/projects\/\$\{project\.id\}`, \{ method: 'DELETE' \}\)/);
  assert.match(closeFlow, /state\.projectComposerStore\.delete\(project\.path\)/);
  assert.match(closeFlow, /await loadProjects\(\)/);

  const clickFlow = sourceBetween(
    app,
    "elements.projectList.addEventListener('click'",
    "elements.projectList.addEventListener('keydown'",
  );
  assert.match(clickFlow, /button\.dataset\.projectAction === 'delete'[\s\S]*?openProjectCloseConfirmation\(project\);[\s\S]*?return;/);
  assert.doesNotMatch(clickFlow, /method: 'DELETE'/);
});

test('the project close confirmation supports Escape, backdrop dismissal, and both themes', () => {
  const listeners = sourceBetween(
    app,
    "elements.projectCloseDismiss.addEventListener('click'",
    "elements.projectColorPresetList.addEventListener('click'",
  );
  assert.match(listeners, /projectCloseCancel\.addEventListener\('click', closeProjectCloseConfirmation\)/);
  assert.match(listeners, /projectCloseConfirm\.addEventListener\('click', confirmProjectClose\)/);
  assert.match(listeners, /projectCloseModal\.addEventListener\('cancel',[\s\S]*?event\.preventDefault\(\);[\s\S]*?closeProjectCloseConfirmation\(\)/);
  assert.match(listeners, /event\.target === elements\.projectCloseModal/);
  assert.match(style, /\.project-close-modal \{[\s\S]*?width: min\(460px, calc\(100vw - 32px\)\);/);
  assert.match(style, /\.project-close-target \{[\s\S]*?var\(--project-accent\)/);
  assert.match(style, /html\[data-theme="dark"\] \.project-close-target/);
  assert.match(style, /html\[data-theme="dark"\] \.project-close-actions \.button\.danger/);
});
