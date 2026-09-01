import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const style = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');

test('task cards render a bounded row of clickable image previews', () => {
  assert.match(app, /const TASK_CARD_ATTACHMENT_SLOT_LIMIT = 6;/);
  assert.match(
    app,
    /function taskCardAttachmentPreviewsMarkup\(task\) \{[\s\S]*?attachments\.length > TASK_CARD_ATTACHMENT_SLOT_LIMIT[\s\S]*?TASK_CARD_ATTACHMENT_SLOT_LIMIT - 1/,
  );
  assert.match(app, /class="task-attachment-preview"[\s\S]*?href="\$\{source\}"[\s\S]*?target="_blank"[\s\S]*?rel="noreferrer"/);
  assert.match(app, /encodeURIComponent\(attachment\.id\)/);
  assert.match(app, /aria-label="Open image \$\{index \+ 1\} of \$\{attachments\.length\}: \$\{escapeHtml\(name\)\}"/);
  assert.match(app, /<img src="\$\{source\}" alt="" loading="lazy" draggable="false">/);
  assert.match(app, /class="task-attachment-overflow"[\s\S]*?>\+\$\{remaining\}</);
  assert.match(app, /\$\{taskCardAttachmentPreviewsMarkup\(task\)\}[\s\S]*?\$\{turboFleetMarkup\(task\)\}/);
});

test('thumbnail links keep their own pointer and keyboard behavior inside task cards', () => {
  assert.match(app, /event\.target\.closest\('a, input, select, textarea'\)/);
  assert.match(app, /!event\.target\.closest\('a, button, input, form'\)/);
  assert.match(app, /if \(event\.target\.closest\('a, button, input, form'\)\) \{/);
});

test('task image previews stay square, compact, focused, and theme-aware', () => {
  assert.match(style, /\.task-attachment-preview:focus-visible,/);
  assert.match(
    style,
    /\.task-attachment-preview,\s*\.task-attachment-overflow \{[\s\S]*?flex: 0 0 34px;[\s\S]*?width: 34px;[\s\S]*?height: 34px;/,
  );
  assert.match(style, /\.task-attachment-preview img \{[\s\S]*?object-fit: cover;/);
  assert.match(style, /html\[data-theme="dark"\] \.task-attachment-preview \{/);
  assert.match(style, /html\[data-theme="dark"\] \.task-attachment-overflow \{/);
});
