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

test('Task Activity applies Markdown to final and live provider responses only', () => {
  assert.match(app, /item\?\.type === 'agentMessage' \|\| payloadType === 'claude\/message'/);
  assert.match(app, /terminal-markdown">\$\{renderMarkdown\(p\.message\)\}/);
  assert.match(app, /<pre class="event-output-content">\$\{escapeHtml\(visibleText\)\}<\/pre>/);
  assert.match(style, /\.events-section \.terminal-markdown pre \{[^}]*background: #0c0e17;[^}]*white-space: pre;/s);
  assert.match(style, /\.events-section \.terminal-markdown code \{[^}]*color: var\(--term-cyan\);/s);
});
