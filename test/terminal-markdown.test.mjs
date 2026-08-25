import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { renderMarkdown } from '../public/markdown.js';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const style = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');

test('terminal provider messages render Markdown safely', () => {
  const html = renderMarkdown([
    '### Changes',
    '',
    '- Added terminal Markdown',
    '- Preserved `copy` text',
    '',
    '```text',
    '<script>alert("unsafe")</script>',
    '```',
  ].join('\n'));

  assert.match(html, /<h5>Changes<\/h5>/);
  assert.match(html, /<ul><li>Added terminal Markdown<\/li><li>Preserved <code>copy<\/code> text<\/li><\/ul>/);
  assert.match(html, /<pre><code>&lt;script&gt;alert\(&quot;unsafe&quot;\)&lt;\/script&gt;<\/code><\/pre>/);
  assert.doesNotMatch(html, /<script>/);
});

test('terminal provider messages render pipe tables as accessible tables', () => {
  const html = renderMarkdown([
    '| Claim | App client | Connector client |',
    '|:---|:---:|---:|',
    '| `sub` | bf89d6b6 | **identical** |',
    '| tenant | <img src=x onerror=alert(1)> | Auto-Reg-01 \\| SFTP |',
    '| code pipe | `left|right` | stable |',
    '| missing | value |',
    '| extra | one | two | ignored |',
  ].join('\n'));

  assert.match(html, /<div class="markdown-table-scroll" role="region" aria-label="Scrollable table" tabindex="0">/);
  assert.match(html, /<table><thead><tr><th scope="col">Claim<\/th><th scope="col" class="align-center">App client<\/th><th scope="col" class="align-right">Connector client<\/th><\/tr><\/thead>/);
  assert.match(html, /<td><code>sub<\/code><\/td><td class="align-center">bf89d6b6<\/td><td class="align-right"><strong>identical<\/strong><\/td>/);
  assert.match(html, /Auto-Reg-01 \| SFTP/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /<td class="align-center"><code>left\|right<\/code><\/td>/);
  assert.match(html, /<td>missing<\/td><td class="align-center">value<\/td><td class="align-right"><\/td>/);
  assert.doesNotMatch(html, /ignored/);
});

test('table-like text without a delimiter row remains plain Markdown', () => {
  const html = renderMarkdown('Call | Result\navailable-owner-groups | 200');
  assert.equal(html, '<p>Call | Result</p><p>available-owner-groups | 200</p>');
});

test('Task Activity applies Markdown to final and live provider responses only', () => {
  assert.match(app, /\['agentMessage', 'agent_message'\]\.includes\(item\?\.type\)[\s\S]{0,80}\['claude\/message', 'opencode\/message'\]\.includes\(payloadType\)/);
  assert.match(app, /const body = role === 'user'[\s\S]*?\? escapeHtml\(p\.message\)[\s\S]*?: renderMarkdown\(p\.message\)/);
  assert.match(app, /'event-message-body term-response-body markdown-document terminal-markdown'/);
  assert.match(app, /<pre class="event-output-content">\$\{escapeHtml\(visibleText\)\}<\/pre>/);
  assert.match(style, /\.events-section \.terminal-markdown pre \{[^}]*background: #0c0e17;[^}]*white-space: pre;/s);
  assert.match(style, /\.events-section \.terminal-markdown code \{[^}]*color: var\(--term-cyan\);/s);
  assert.match(style, /\.markdown-document \.markdown-table-scroll \{[^}]*overflow-x: auto;/s);
  assert.match(style, /\.events-section \.terminal-markdown \.markdown-table-scroll \{[^}]*border-color: var\(--term-border\);/s);
  assert.match(style, /\.events-section \.terminal-markdown th \{[^}]*color: #e5ebff;[^}]*background: rgb\(122 162 247 \/ 16%\);/s);
});

test('Task Activity labels provider turn boundaries without claiming the session finished', () => {
  assert.match(app, /title: payloadType === 'turn\/started' \? 'Turn started' : 'Turn finished'/);
  assert.doesNotMatch(app, /Session finished/);
});
