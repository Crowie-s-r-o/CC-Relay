// Run: node node_modules/electron/cli.js scripts/verify-task-review.cjs [output-directory]
// Uses only a synthetic loopback server and an isolated Electron storage partition.
const { app, BrowserWindow, nativeTheme } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const root = path.resolve(__dirname, '../public');
const out = path.resolve(process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'relay-task-review-')));
fs.mkdirSync(out, { recursive: true });
const projectPath = '/synthetic/alpha';
const projects = ['alpha', 'beta'].map((name, index) => ({
  id: index + 1, name, path: `/synthetic/${name}`, max_codex_instances: 2, max_claude_instances: 2,
}));
const recent = new Date().toISOString();
const task = (id, status, extra = {}) => ({
  id, status, repo_path: projectPath, title: `Verify synthetic task ${id}`, prompt: 'Check the review workflow.',
  provider: 'codex', model: 'gpt-6-astra', effort: 'high', mode: 'execute', terminal_lifecycle: 'disposable',
  created_at: recent, started_at: recent, finished_at: status === 'complete' ? recent : null,
  result: status === 'complete' ? 'Synthetic finished result.' : null, latest_event_id: 0, ...extra,
});
const tasks = [task(101, 'running'), task(102, 'complete', { ready_for_review: true, starred: true, created_at: '2025-01-01T12:00:00Z' }),
  task(103, 'complete', { ready_for_review: true }), task(104, 'complete', { ready_for_review: false }),
  task(105, 'queued', { position: 1 }), task(106, 'failed'),
  task(201, 'complete', { repo_path: '/synthetic/beta', ready_for_review: true }),
  task(301, 'complete', { repo_path: '/synthetic/alpha/nested', ready_for_review: true })];
let prefs = null;
let searchDelay = 0;
const clients = new Set();
const errors = [];
const writes = [];
function answer(url, method, body) {
  const route = url.pathname;
  if (method !== 'GET') writes.push({ route, body });
  if (route === '/api/status') return { capabilities: { projectLauncher: true, disposableTerminalPools: true, taskFullTextSearch: true, taskStarring: true, taskNaming: true },
    codex: { available: true, authenticated: true }, claude: { available: true, authenticated: true },
    queue: { runningTaskId: 101, waiting: 1 }, counts: { running: 1, queued: 1 }, runningTasks: [tasks[0]], paused: false };
  if (route === '/api/ui-preferences') { if (method === 'PATCH') prefs = body; return { preferences: prefs }; }
  if (route === '/api/projects') return { projects, activeProjectPath: projectPath };
  if (route === '/api/threads') return { threads: [], connection: { connected: true }, providers: [] };
  if (route === '/api/tasks') return { tasks };
  if (route === '/api/tasks/search') return { query: url.searchParams.get('query'), total: 1, results: [{ taskId: 104, excerpt: 'Reviewed search result', source: 'response', highlights: [] }] };
  if (/^\/api\/tasks\/\d+$/.test(route)) return { task: tasks.find(item => item.id === Number(route.split('/').at(-1))), events: [], prompts: [] };
  if (/^\/api\/tasks\/\d+\/review$/.test(route)) {
    const item = tasks.find(item => item.id === Number(route.split('/').at(-2)));
    assert.equal(body.finishedAt, item.finished_at);
    item.ready_for_review = false;
    return { task: item };
  }
  if (route === '/api/tasks/review-project') {
    let reviewedCount = 0;
    for (const review of body.reviews) {
      const item = tasks.find(item => item.id === review.taskId);
      assert.equal(item.repo_path, body.projectPath);
      assert.equal(item.finished_at, review.finishedAt);
      item.ready_for_review = false;
      reviewedCount += 1;
    }
    return { reviewedCount };
  }
  if (route === '/api/models') return { models: [] };
  if (route === '/api/plans') return { plans: [] };
  if (route === '/api/terminal-displays') return { displays: [] };
  return {};
}
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write(': fixture\n\n');
    clients.add(res); res.on('close', () => clients.delete(res)); return;
  }
  if (url.pathname.startsWith('/api/')) {
    let body = ''; req.on('data', data => { body += data; });
    req.on('end', () => {
      const response = answer(url, req.method, body ? JSON.parse(body) : {});
      const send = () => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(response)); };
      if (url.pathname === '/api/tasks/search' && searchDelay) setTimeout(send, searchDelay); else send();
    }); return;
  }
  const vendors = { '/vendor/xterm.js': '@xterm/xterm/lib/xterm.js', '/vendor/xterm.css': '@xterm/xterm/css/xterm.css', '/vendor/addon-fit.js': '@xterm/addon-fit/lib/addon-fit.js' };
  const file = vendors[url.pathname] ? path.join(root, '../node_modules', vendors[url.pathname]) : path.join(root, url.pathname === '/' ? 'index.html' : url.pathname);
  try {
    const data = fs.readFileSync(file);
    res.writeHead(200, { 'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'", 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' })[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch { res.writeHead(404); res.end(); }
});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let window;
app.whenReady().then(async () => {
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    nativeTheme.themeSource = 'dark';
    window = new BrowserWindow({ show: false, frame: false, width: 1720, height: 1040, webPreferences: { sandbox: true, partition: `relay-review-qa-${Date.now()}` } });
    window.webContents.on('console-message', details => { if (['warning', 'error'].includes(details.level)) errors.push(details.message); });
    const js = source => window.webContents.executeJavaScript(source);
    const until = async (source, label) => {
      for (let attempt = 0; attempt < 80; attempt += 1) { if (await js(source)) return; await sleep(50); }
      assert.fail(label);
    };
    const ids = () => js(`Array.from(document.querySelectorAll('#task-list .task-card'), card => Number(card.dataset.taskId))`);
    const click = selector => js(`document.querySelector(${JSON.stringify(selector)}).click()`);
    const capture = async name => {
      await sleep(150);
      assert.ok(await js(`document.body.scrollWidth <= innerWidth`), `No viewport overflow: ${name}`);
      assert.ok(await js(`Array.from(document.querySelectorAll('.queue-header, .task-card'), e => e.scrollWidth <= e.clientWidth + 1).every(Boolean)`), `No queue clipping: ${name}`);
      fs.writeFileSync(path.join(out, `${name}.png`), (await window.webContents.capturePage()).toPNG());
    };
    await window.loadURL(`http://127.0.0.1:${server.address().port}/`);
    await until(`document.querySelector('#task-review-count').textContent === '2'`, 'Review count loads');
    await js('document.fonts.ready');
    assert.equal(await js(`document.querySelectorAll('.task-card-unread .task-unread-marker').length`), 2);
    assert.equal(await js(`getComputedStyle(document.querySelector('.task-card-unread'), '::before').display`), 'block', 'Final cascade preserves review rail');
    assert.notEqual(await js(`getComputedStyle(document.querySelector('.task-card-unread')).backgroundColor`), await js(`getComputedStyle(document.querySelector('[data-task-id="104"]')).backgroundColor`));
    await capture('queue-dark');
    await click('#task-review-filter');
    assert.deepEqual(await ids(), [102, 103], 'Review view includes old and starred unread tasks only');
    assert.ok(await js(`document.querySelector('#history-ledger').hidden && document.querySelector('#parallel-batch-bar').hidden`));
    assert.equal(await js(`document.querySelectorAll('#task-list .drag-grip, #task-list .parallel-task-check, #task-list .task-assign-button').length`), 0);
    await capture('review-dark');
    await click('#theme-toggle'); await capture('review-light');
    for (const width of [1180, 380]) {
      window.setContentSize(width, 900);
      if (width <= 1100) await js(`document.querySelector('.queue-panel').scrollIntoView({block:'start'})`);
      await capture(`review-light-${width}`);
      await click('#theme-toggle'); await capture(`review-dark-${width}`); await click('#theme-toggle');
    }
    window.setContentSize(1720, 1040);
    await window.reload();
    await until(`document.querySelector('#task-review-filter').getAttribute('aria-pressed') === 'true' && document.querySelectorAll('#task-list .task-card').length === 2`, 'Review view persists after reload');
    await click('[data-project-id="2"]');
    assert.deepEqual(await ids(), [201], 'Review scope switches to exact selected project');
    assert.equal(await js(`document.querySelector('#task-review-count').textContent`), '1');
    await click('[data-project-id="1"]');
    assert.deepEqual(await ids(), [102, 103], 'Returning to project does not acknowledge completions');
    await js(`const search=document.querySelector('#task-search-input'); search.value='result'; search.dispatchEvent(new Event('input', {bubbles:true}));`);
    await until(`document.querySelector('[data-task-id="104"]') !== null`, 'Search retains all-date scope');
    assert.equal(await js(`document.querySelector('#task-review-filter').getAttribute('aria-pressed')`), 'false');
    await click('#task-review-filter');
    assert.deepEqual(await ids(), [102, 103], 'Review control exits full-text search');
    assert.equal(await js(`document.querySelector('#task-search-input').value`), '');
    searchDelay = 500;
    await js(`document.querySelector('#task-search-input').value='delayed'; document.querySelector('#task-search-input').dispatchEvent(new Event('input', {bubbles:true}));`);
    await sleep(230); await click('#task-review-filter'); await sleep(600);
    assert.deepEqual(await ids(), [102, 103], 'Late search cannot replace review view');
    await js(`document.querySelector('[data-task-id="102"]').focus(); document.querySelector('[data-task-id="102"]').dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', bubbles:true}));`);
    await until(`document.querySelector('#task-review-count').textContent === '1'`, 'Opening a review task acknowledges only that task');
    assert.deepEqual(await ids(), [103]);
    assert.equal(await js(`document.activeElement.dataset.taskId`), '103', 'Keyboard review keeps focus on the remaining card');
    assert.match(await js(`document.querySelector('#queue-summary').textContent`), /^1 task ready for review/);
    assert.match(await js(`document.querySelector('#detail-title').textContent`), /102/);
    await click('#clear-task-notifications-button');
    await until(`document.querySelector('#task-review-count').textContent === '0'`, 'Bulk review clears exact project');
    assert.deepEqual(await ids(), []);
    assert.match(await js(`document.querySelector('.queue-empty strong').textContent`), /No tasks ready for review/);
    assert.equal(tasks.find(item => item.id === 201).ready_for_review, true);
    assert.equal(tasks.find(item => item.id === 301).ready_for_review, true);
    await capture('review-empty');
    // Extra verification: fresh completions must leave the bulk action usable after a successful clear.
    tasks.find(item => item.id === 104).ready_for_review = true;
    for (const client of clients) client.write('event: change\ndata: {"tasks":true}\n\n');
    await until(`document.querySelector('#task-review-count').textContent === '1'`, 'New review arrives through refresh');
    assert.equal(await js(`document.querySelector('#clear-task-notifications-button').disabled`), false);
    await click('#clear-task-notifications-button');
    await until(`document.querySelector('#task-review-count').textContent === '0'`, 'Bulk review remains reusable');
    tasks.find(item => item.id === 103).ready_for_review = true;
    for (const client of clients) client.write('event: change\ndata: {"tasks":true}\n\n');
    await until(`document.querySelector('#task-review-count').textContent === '1'`, 'Final keyboard review arrives');
    await js(`document.querySelector('[data-task-id="103"]').focus(); document.querySelector('[data-task-id="103"]').dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', bubbles:true}));`);
    await until(`document.querySelector('#task-review-count').textContent === '0'`, 'Last task leaves the review view');
    assert.equal(await js(`document.activeElement.id`), 'task-review-filter', 'Empty review view retains a keyboard target');
    await click('[data-task-view="queue"]');
    assert.ok((await ids()).includes(105), 'Normal queue remains accessible');
    assert.equal(tasks.find(item => item.id === 105).position, 1);
    assert.ok(!writes.some(write => /\/reorder|\/assign|\/parallel$/.test(write.route) || write.route === '/api/tasks'), 'Filtered inspection never changes execution');
    assert.deepEqual(errors, [], 'No renderer warnings or errors');
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ writes, errors }, null, 2));
    console.log(`Review verification passed. Artifacts: ${out}`);
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally {
    if (window && !window.isDestroyed()) window.destroy();
    for (const client of clients) client.end();
    server.closeAllConnections();
    server.close(() => app.exit(process.exitCode || 0));
  }
});
