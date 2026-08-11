import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { markdownPreviewText, renderMarkdown } from '../public/markdown.js';

const root = new URL('../', import.meta.url);

test('result Markdown renders common document structure and escapes raw HTML', () => {
  const html = renderMarkdown([
    '## Executive Summary',
    '',
    '**Ticket confidence: High** with `inline code`.',
    '',
    '- First item',
    '- Second item',
    '',
    '```js',
    '<script>alert("unsafe")</script>',
    '```',
  ].join('\n'));

  assert.match(html, /<h4>Executive Summary<\/h4>/);
  assert.match(html, /<strong>Ticket confidence: High<\/strong>/);
  assert.match(html, /<code>inline code<\/code>/);
  assert.match(html, /<ul><li>First item<\/li><li>Second item<\/li><\/ul>/);
  assert.match(html, /<pre><code>&lt;script&gt;alert\(&quot;unsafe&quot;\)&lt;\/script&gt;<\/code><\/pre>/);
  assert.doesNotMatch(html, /<script>/);
});

test('result preview removes Markdown punctuation', () => {
  assert.equal(
    markdownPreviewText('## Executive Summary\n\n**Ticket confidence: High** with `code`.'),
    'Executive Summary Ticket confidence: High with code.',
  );
});

test('Task Activity renders Result as a larger Markdown document', async () => {
  const [app, page, style] = await Promise.all([
    readFile(new URL('public/app.js', root), 'utf8'),
    readFile(new URL('public/index.html', root), 'utf8'),
    readFile(new URL('public/style.css', root), 'utf8'),
  ]);

  assert.match(app, /elements\.detailResult\.innerHTML = renderMarkdown\(resultContent\)/);
  assert.match(app, /compactText\(markdownPreviewText\(task\.result\), 96\)/);
  assert.match(page, /<div id="detail-result" class="markdown-document result-markdown"><\/div>/);
  assert.match(style, /\.detail-panel \.detail-copy-disclosure > \.result-markdown \{[^}]*max-height: 320px;[^}]*font-size: 15px;/s);
  assert.match(style, /\.detail-section > pre \{[^}]*background: #fafbfc;/s);
  assert.match(style, /\.markdown-document pre \{[^}]*background: #182720;/s);
  assert.match(style, /\.markdown-document pre code \{[^}]*color: #e7f0ed;/s);
  assert.doesNotMatch(style, /^\.detail-section pre \{/m);
});
