import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);

test('task detail exposes copy actions for prompt, result, and every plan output', async () => {
  const [html, app, style] = await Promise.all([
    readFile(new URL('public/index.html', root), 'utf8'),
    readFile(new URL('public/app.js', root), 'utf8'),
    readFile(new URL('public/style.css', root), 'utf8'),
  ]);

  for (const content of ['prompt', 'result', 'planDraft', 'planReview', 'planFinal']) {
    assert.match(html, new RegExp(`data-copy-content="${content}"`));
    assert.match(app, new RegExp(`${content}:`));
  }

  assert.match(app, /navigator\.clipboard\.writeText\(text\)/);
  assert.match(app, /planDraft: plan\?\.draft/);
  assert.match(app, /planReview: plan\?\.review/);
  assert.match(app, /planFinal: plan\?\.finalPlan/);
  assert.match(style, /\.content-copy-button/);
});
