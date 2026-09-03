import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
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
  assert.match(app, /<img data-preview-source="\$\{source\}" alt="" loading="lazy" decoding="async" draggable="false">/);
  assert.match(app, /class="task-attachment-overflow"[\s\S]*?>\+\$\{remaining\}</);
  assert.match(app, /\$\{taskCardAttachmentPreviewsMarkup\(task\)\}[\s\S]*?\$\{turboFleetMarkup\(task\)\}/);
});

test('task card images load only near the viewport and release before a list rebuild', () => {
  assert.match(app, /new window\.IntersectionObserver\([\s\S]*?rootMargin: '240px 0px'/);
  assert.match(app, /entry\.isIntersecting[\s\S]*?image\.setAttribute\('src', source\)/);
  assert.match(app, /else if \(image\.hasAttribute\('src'\)\)[\s\S]*?image\.removeAttribute\('src'\)/);
  assert.match(app, /function releaseTaskAttachmentPreviews\(\)[\s\S]*?taskAttachmentPreviewObserver\.disconnect\(\)/);
  assert.match(app, /const showingPreviews = releaseTaskAttachmentPreviews\(\);\s*elements\.taskList\.innerHTML/);
  assert.match(app, /elements\.taskList\.innerHTML = visibleTasks[\s\S]*?observeTaskAttachmentPreviews\(showingPreviews\)/);
  // A rebuild must restore the painted source before observing, or the browser
  // paints a blank frame between the innerHTML swap and the observer callback.
  assert.match(
    app,
    /previouslyShowing\.has\(source\)\) image\.setAttribute\('src', source\);\s*taskAttachmentPreviewObserver\.observe\(image\);/,
  );
  assert.match(style, /\.task-card \{[\s\S]*?content-visibility: auto;[\s\S]*?contain-intrinsic-size: auto 150px;/);
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

function taskAttachmentPreviewModule() {
  const start = app.indexOf('function releaseTaskAttachmentPreviews()');
  const end = app.indexOf('// end task attachment previews');
  assert.ok(start !== -1 && end > start, 'the preview helpers should be extractable from app.js');
  return new Function(
    'elements',
    'taskAttachmentPreviewObserver',
    `${app.slice(start, end)}\nreturn { releaseTaskAttachmentPreviews, observeTaskAttachmentPreviews };`,
  );
}

function fakeImage(source, src = null) {
  const attributes = new Map();
  if (src) attributes.set('src', src);
  return {
    dataset: { previewSource: source },
    getAttribute: (name) => (attributes.has(name) ? attributes.get(name) : null),
    setAttribute: (name, value) => attributes.set(name, value),
    hasAttribute: (name) => attributes.has(name),
    removeAttribute: (name) => attributes.delete(name),
  };
}

test('a list rebuild restores already painted thumbnails before the observer ticks', () => {
  let images = [];
  const elements = {
    taskList: {
      querySelectorAll: (selector) => (selector.endsWith('[src]')
        ? images.filter((image) => image.hasAttribute('src'))
        : images),
    },
  };
  const observed = [];
  let disconnects = 0;
  const observer = {
    observe: (image) => observed.push({ source: image.dataset.previewSource, src: image.getAttribute('src') }),
    disconnect: () => { disconnects += 1; },
  };
  const { releaseTaskAttachmentPreviews, observeTaskAttachmentPreviews } = taskAttachmentPreviewModule()(elements, observer);

  // First render: one thumbnail scrolled into view and loaded, one stayed offscreen.
  images = [fakeImage('/api/tasks/1/attachments/image-1'), fakeImage('/api/tasks/1/attachments/image-2')];
  observeTaskAttachmentPreviews();
  assert.deepEqual(observed.map((entry) => entry.src), [null, null]);
  images[0].setAttribute('src', images[0].dataset.previewSource);

  // A ticking field on a running task changes the render signature and rebuilds the list.
  const showing = releaseTaskAttachmentPreviews();
  assert.equal(disconnects, 1);
  assert.deepEqual([...showing], ['/api/tasks/1/attachments/image-1']);
  assert.equal(images[0].getAttribute('src'), '/api/tasks/1/attachments/image-1', 'discarded nodes keep their src');

  observed.length = 0;
  images = [fakeImage('/api/tasks/1/attachments/image-1'), fakeImage('/api/tasks/1/attachments/image-2')];
  observeTaskAttachmentPreviews(showing);

  assert.equal(images[0].getAttribute('src'), '/api/tasks/1/attachments/image-1');
  assert.equal(images[1].getAttribute('src'), null, 'offscreen thumbnails stay viewport gated');
  // No observer callback has run yet, so the restore has to be visible in the observe() call itself.
  assert.deepEqual(observed, [
    { source: '/api/tasks/1/attachments/image-1', src: '/api/tasks/1/attachments/image-1' },
    { source: '/api/tasks/1/attachments/image-2', src: null },
  ]);
});

test('the intersection observer still releases a primed thumbnail that is offscreen', () => {
  const start = app.indexOf('new window.IntersectionObserver((entries) => {');
  const end = app.indexOf("}, { rootMargin: '240px 0px' })");
  assert.ok(start !== -1 && end > start, 'the observer callback should be extractable from app.js');
  const body = app.slice(start + 'new window.IntersectionObserver('.length, end + 1);
  const callback = new Function('HTMLImageElement', `return ${body};`)(Object);

  // Primed by the rebuild restore, then reported as offscreen by the first tick.
  const offscreen = fakeImage('/api/tasks/1/attachments/image-2', '/api/tasks/1/attachments/image-2');
  const onscreen = fakeImage('/api/tasks/1/attachments/image-1', '/api/tasks/1/attachments/image-1');
  const cold = fakeImage('/api/tasks/1/attachments/image-3');

  callback([
    { target: offscreen, isIntersecting: false },
    { target: onscreen, isIntersecting: true },
    { target: cold, isIntersecting: true },
  ]);

  assert.equal(offscreen.getAttribute('src'), null, 'an offscreen primed image must release its decoded bitmap');
  assert.equal(onscreen.getAttribute('src'), '/api/tasks/1/attachments/image-1', 'a visible image keeps its src');
  assert.equal(cold.getAttribute('src'), '/api/tasks/1/attachments/image-3', 'a newly visible image loads lazily');
});

function serveTaskAttachmentModule(server, body) {
  const start = server.indexOf('function serveTaskAttachment(');
  const end = server.indexOf('function readPlanRecord(');
  assert.ok(start !== -1 && end > start, 'serveTaskAttachment should be extractable from server.mjs');
  return new Function(
    'resolve',
    'artifacts',
    'isPathInside',
    'existsSync',
    'statSync',
    'readFileSync',
    'createHash',
    'sendError',
    'TASK_ATTACHMENT_CACHE_CONTROL',
    `${server.slice(start, end)}\nreturn serveTaskAttachment;`,
  )(
    (...parts) => parts.join('/'),
    { taskDirectory: (id) => `/data/tasks/${id}` },
    () => true,
    () => true,
    () => ({ isFile: () => true }),
    () => body,
    createHash,
    (response, status, message) => { response.writeHead(status, {}); response.end(message); },
    'private, max-age=60',
  );
}

function fakeResponse() {
  const sent = { status: 0, headers: {}, body: undefined };
  return {
    sent,
    writeHead: (status, headers) => { sent.status = status; sent.headers = headers; },
    end: (payload) => { sent.body = payload; },
  };
}

test('the attachment route caches image bytes briefly and answers only a matching conditional request', () => {
  const server = readFileSync(new URL('../src/server.mjs', import.meta.url), 'utf8');
  const body = Buffer.from('reference-image-bytes');
  const serve = serveTaskAttachmentModule(server, body);
  const task = { id: 7 };
  const attachment = { fileName: 'image-1.png', mimeType: 'image/png' };
  const etag = `"${createHash('sha256').update(body).digest('hex')}"`;

  const fresh = fakeResponse();
  serve(task, attachment, fresh, { headers: {} });
  assert.equal(fresh.sent.status, 200);
  assert.equal(fresh.sent.headers['Cache-Control'], 'private, max-age=60');
  assert.equal(fresh.sent.headers.ETag, etag);
  assert.equal(fresh.sent.headers['Content-Length'], body.length);
  assert.equal(fresh.sent.headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(fresh.sent.body, body);

  const matched = fakeResponse();
  serve(task, attachment, matched, { headers: { 'if-none-match': etag } });
  assert.equal(matched.sent.status, 304);
  assert.equal(matched.sent.headers.ETag, etag);
  assert.equal(matched.sent.body, undefined);

  // A stale validator must resend the bytes, or every thumbnail blanks permanently.
  const stale = fakeResponse();
  serve(task, attachment, stale, { headers: { 'if-none-match': '"stale"' } });
  assert.equal(stale.sent.status, 200);
  assert.equal(stale.sent.body, body);

  // A weak validator is not a match for a strong ETag.
  const weak = fakeResponse();
  serve(task, attachment, weak, { headers: { 'if-none-match': `W/${etag}` } });
  assert.equal(weak.sent.status, 200);

  // One tag inside a list still matches.
  const listed = fakeResponse();
  serve(task, attachment, listed, { headers: { 'if-none-match': `"other", ${etag}` } });
  assert.equal(listed.sent.status, 304);
});

test('the attachment route keeps its short cache contract and id-keyed lookup', () => {
  const server = readFileSync(new URL('../src/server.mjs', import.meta.url), 'utf8');
  assert.match(server, /const TASK_ATTACHMENT_CACHE_CONTROL = 'private, max-age=60';/);
  const helper = server.slice(
    server.indexOf('const TASK_ATTACHMENT_CACHE_CONTROL'),
    server.indexOf('function readPlanRecord('),
  );
  // Task ids restart after a `.data` wipe, so attachment bytes are not immutable for a URL.
  assert.doesNotMatch(helper, /immutable/);
  // The lookup stays keyed by the stable attachment id, never by array position.
  assert.match(server, /task\?\.attachments\.find\(\(item\) => item\.id === attachmentId\)/);
  assert.match(server, /serveTaskAttachment\(task, attachment, response, request\);/);
});
