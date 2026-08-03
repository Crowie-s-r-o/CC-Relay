import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);

function disclosureSummary(html, sectionId) {
  const sectionStart = html.indexOf(`<details id="${sectionId}"`);
  assert.notEqual(sectionStart, -1, `${sectionId} disclosure should exist`);
  const summaryEnd = html.indexOf('</summary>', sectionStart);
  assert.notEqual(summaryEnd, -1, `${sectionId} summary should exist`);
  return html.slice(sectionStart, summaryEnd);
}

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

test('prompt and result copy actions stay available in collapsed disclosure summaries', async () => {
  const [html, app, style] = await Promise.all([
    readFile(new URL('public/index.html', root), 'utf8'),
    readFile(new URL('public/app.js', root), 'utf8'),
    readFile(new URL('public/style.css', root), 'utf8'),
  ]);

  assert.match(disclosureSummary(html, 'prompt-section'), /data-copy-content="prompt"/);
  assert.match(disclosureSummary(html, 'result-section'), /data-copy-content="result"/);
  assert.match(app, /button\.closest\('summary'\)/);
  assert.match(app, /event\.stopPropagation\(\)/);
  assert.match(style, /\.detail-disclosure-actions/);
});
