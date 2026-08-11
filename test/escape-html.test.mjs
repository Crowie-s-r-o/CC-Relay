import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { escapeHtml } from '../public/escape-html.js';

test('escapeHtml escapes the HTML metacharacters', () => {
  assert.equal(escapeHtml('a & b < c > d'), 'a &amp; b &lt; c &gt; d');
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
});

test('escapeHtml escapes double and single quotes so it is attribute-safe (Finding 19)', () => {
  // A quote in agent-controlled text must not break out of a quoted attribute.
  const payload = 'x" onmouseover="evil';
  const escaped = escapeHtml(payload);
  assert.doesNotMatch(escaped, /"/);
  assert.match(escaped, /&quot;/);
  assert.equal(escaped, 'x&quot; onmouseover=&quot;evil');

  const single = escapeHtml("x' onmouseover='evil");
  assert.doesNotMatch(single, /'/);
  assert.match(single, /&#39;/);

  // Interpolated into a quoted attribute the payload cannot escape the value.
  const markup = `<i title="${escapeHtml(payload)}"></i>`;
  assert.equal((markup.match(/"/g) || []).length, 2);
});

test('app.js interpolates agent-controlled attributes through escapeHtml', () => {
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  // The header running-task card interpolates task names and responses into title attributes.
  assert.match(app, /title="\$\{escapeHtml\(taskDisplayName\(task\)\)\}"/);
  assert.match(app, /title="\$\{escapeHtml\(response\)\}"/);
  // escapeHtml is the shared imported helper, not a DOM trick that leaves quotes intact.
  assert.match(app, /import \{ escapeHtml \} from '\.\/escape-html\.js'/);
  assert.doesNotMatch(app, /function escapeHtml\(/);
});
