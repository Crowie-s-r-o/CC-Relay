// Run: node node_modules/electron/cli.js scripts/verify-terminal-rendering.cjs [output-directory]
// Uses the real renderer, terminal host and socket bridge with synthetic output only.
const { app, BrowserWindow, nativeTheme } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const out = path.resolve(process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'relay-terminal-rendering-')));
fs.mkdirSync(out, { recursive: true });
const project = { id: 1, name: 'Terminal fixture', path: '/synthetic/terminal', max_codex_instances: 1, max_claude_instances: 1 };
const task = { id: 7, title: 'Read a long terminal response', prompt: 'Verify long terminal output.',
  provider: 'codex', mode: 'execute', status: 'running', repo_path: project.path, thread_id: 'fixture-thread',
  terminal_lifecycle: 'disposable', created_at: '2026-09-05T10:00:00Z', started_at: '2026-09-05T10:00:00Z' };
const identity = { taskId: task.id, threadId: task.thread_id, launchId: 'fixture-launch' };
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
const until = async (condition, label) => {
  for (let i = 0; i < 150; i += 1) {
    if (await condition()) return;
    await pause(20);
  }
  throw new Error(`Timed out: ${label}`);
};
let window, server, host, detachSockets, output, exit, preferences;
let expectedText = '';
let terminalClosed = false;
const conversationEvents = [{ id: 1, kind: 'result', message: 'The completed response is ready for review.',
  payload: {}, created_at: '2026-09-05T10:01:00Z' }];
const errors = [];
const sizes = [];

app.whenReady().then(async () => {
  try {
    const { EmbeddedTerminalHost } = await import(pathToFileURL(path.join(root, 'src/embedded-terminal.mjs')));
    const { attachTerminalWebSockets } = await import(pathToFileURL(path.join(root, 'src/terminal-websocket.mjs')));
    host = new EmbeddedTerminalHost({ spawn: () => ({
      pid: 424242, onData: (callback) => { output = callback; }, onExit: (callback) => { exit = callback; },
      write() {}, pause() {}, resume() {}, resize: (cols, rows) => sizes.push({ cols, rows }),
      kill: () => exit({ exitCode: 0 }),
    }) });
    host.launch({ ...identity, provider: task.provider, path: project.path, command: 'synthetic-output' });
    const answer = (url, method, body) => {
      if (url.pathname === '/api/status') return { capabilities: { projectLauncher: true, disposableTerminalPools: true,
        taskTerminalScreen: true, originalTerminalScreen: true, nativeTerminalScreen: true },
      codex: { available: true, authenticated: true }, claude: { available: true, authenticated: true },
      runningTasks: [task], queue: { runningTaskId: task.id, waiting: 0 }, counts: { running: 1, queued: 0, complete: 0 } };
      if (url.pathname === '/api/projects') return { projects: [project], activeProjectPath: project.path };
      if (url.pathname === '/api/tasks') return { tasks: [task] };
      if (url.pathname === `/api/tasks/${task.id}`) return { task, events: conversationEvents, prompts: [] };
      if (url.pathname.endsWith('/terminal-screen')) return { terminal: terminalClosed ? { state: 'unavailable', message: 'Terminal closed' }
        : { ...identity, state: 'interactive', transport: 'pty', provider: task.provider } };
      if (url.pathname === '/api/threads') return { threads: [], connection: { connected: true }, providers: [] };
      if (url.pathname === '/api/models') return { models: [] };
      if (url.pathname === '/api/plans') return { plans: [] };
      if (url.pathname === '/api/ui-preferences') {
        if (method === 'PATCH') preferences = JSON.parse(body);
        return { preferences };
      }
      return {};
    };
    server = http.createServer((request, response) => {
      const url = new URL(request.url, 'http://localhost');
      if (url.pathname === '/api/events') {
        response.writeHead(200, { 'Content-Type': 'text/event-stream' });
        response.write(': fixture\n\n');
        return;
      }
      if (url.pathname.startsWith('/api/')) {
        let body = '';
        request.on('data', (chunk) => { body += chunk; });
        request.on('end', () => {
          response.writeHead(200, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify(answer(url, request.method, body)));
        });
        return;
      }
      const vendors = { '/vendor/xterm.js': '@xterm/xterm/lib/xterm.js', '/vendor/xterm.css': '@xterm/xterm/css/xterm.css',
        '/vendor/addon-fit.js': '@xterm/addon-fit/lib/addon-fit.js' };
      const file = vendors[url.pathname] ? path.join(root, 'node_modules', vendors[url.pathname])
        : path.join(root, 'public', url.pathname === '/' ? 'index.html' : url.pathname);
      try {
        let data = fs.readFileSync(file);
        if (url.pathname === '/app.js') data = `${data}\n;globalThis.qaRefreshTask = () => selectTask(7, { openOriginal: false });`;
        // Expose the actual instance only in this isolated fixture, with no product debug API.
        if (url.pathname === '/vendor/xterm.js') data = `${data}\n;globalThis.Terminal = class extends globalThis.Terminal {
          constructor(options) { super(options); globalThis.qaTerminal = this; }
        };`;
        response.writeHead(200, { 'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'",
          'Content-Type': ({ '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
          '.svg': 'image/svg+xml', '.woff2': 'font/woff2' })[path.extname(file)] || 'application/octet-stream' });
        response.end(data);
      } catch { response.writeHead(404); response.end(); }
    });
    detachSockets = attachTerminalWebSockets(server, { host, terminals: {
      connection: (taskId, threadId, launchId) => taskId === identity.taskId && threadId === identity.threadId
        && launchId === identity.launchId ? identity : null,
    } });
    await new Promise((done) => server.listen(0, '127.0.0.1', done));
    nativeTheme.themeSource = 'dark';
    window = new BrowserWindow({ show: false, frame: false, width: 1720, height: 1040,
      webPreferences: { sandbox: true, partition: `terminal-rendering-${Date.now()}` } });
    window.webContents.on('console-message', ({ level, message }) => { if (['warning', 'error'].includes(level)) errors.push(message); });
    const js = (source) => window.webContents.executeJavaScript(source);
    await window.loadURL(`http://127.0.0.1:${server.address().port}/`);
    await until(() => sizes.length > 0, 'terminal attachment and fit');
    await js('document.fonts.ready');
    const write = async (data) => {
      output(data);
      await new Promise((done) => host.get(identity.launchId).terminal.write('', done));
      await until(() => js(`qaTerminal.buffer.active.getLine(qaTerminal.buffer.active.baseY + qaTerminal.buffer.active.cursorY)?.translateToString(true).includes('READY')`), 'rendered output');
      await pause(80);
    };
    const geometry = () => js(`(() => {
      const container = document.querySelector('#embedded-terminal');
      const screen = container.querySelector('.xterm-screen');
      const rect = container.getBoundingClientRect();
      const inner = screen.getBoundingClientRect();
      const padding = getComputedStyle(container.querySelector('.xterm'));
      const pane = document.querySelector('#native-terminal-screen');
      const paneStyle = getComputedStyle(pane);
      return { pane: pane.getBoundingClientRect().toJSON(), paneBorder: paneStyle.borderTopWidth,
        paneRadius: paneStyle.borderRadius, resizer: Boolean(document.querySelector('#terminal-height-resizer')),
        container: rect.toJSON(), screen: inner.toJSON(), cols: qaTerminal.cols, rows: qaTerminal.rows,
        containerBackground: getComputedStyle(container).backgroundColor,
        paddingRight: parseFloat(padding.paddingRight), paddingBottom: parseFloat(padding.paddingBottom),
        backgrounds: Array.from(container.querySelectorAll('.xterm,.xterm-viewport,.xterm-screen'), element =>
          ({ className: element.className, background: getComputedStyle(element).backgroundColor })),
        pageWidth: document.body.scrollWidth, viewportWidth: innerWidth,
        lastRowBottom: screen.querySelector('.xterm-rows > div:last-child')?.getBoundingClientRect().bottom };
    })()`);
    const text = () => js(`(() => {
      const buffer = qaTerminal.buffer.active;
      const lines = [];
      const last = buffer.baseY + buffer.cursorY;
      for (let i = 0; i <= last; i += 1) {
        const line = buffer.getLine(i);
        const value = line.translateToString(i === last || !buffer.getLine(i + 1)?.isWrapped);
        if (line.isWrapped && lines.length) lines[lines.length - 1] += value;
        else lines.push(value);
      }
      return lines.join('\\n');
    })()`);
    const capture = async (name) => {
      await pause(120);
      fs.writeFileSync(path.join(out, `${name}.png`), (await window.webContents.capturePage()).toPNG());
      const measurements = await geometry();
      assert.equal(measurements.resizer, false, 'No draggable separator');
      assert.equal(measurements.paneBorder, '0px', 'No terminal card border');
      assert.equal(measurements.paneRadius, '0px', 'No rounded terminal card');
      assert.ok(Math.abs(measurements.container.bottom - measurements.pane.bottom) <= 1, `${name}: terminal fills pane height`);
      fs.writeFileSync(path.join(out, `${name}.json`), JSON.stringify(measurements, null, 2));
      assert.ok(measurements.screen.right <= measurements.container.right - measurements.paddingRight + 1, `${name}: last columns fit inside the terminal`);
      assert.ok(measurements.screen.bottom <= measurements.container.bottom - measurements.paddingBottom + 1, `${name}: last rows and cursor fit inside the terminal`);
      assert.ok(measurements.pageWidth <= measurements.viewportWidth, `${name}: no page overflow`);
      const viewportBackground = measurements.backgrounds.find(item => item.className === 'xterm-viewport').background;
      assert.ok(viewportBackground === 'rgba(0, 0, 0, 0)' || viewportBackground === measurements.containerBackground,
        `${name}: terminal insets follow the active theme`);
      assert.deepEqual({ cols: measurements.cols, rows: measurements.rows }, sizes.at(-1), `${name}: PTY and browser dimensions match`);
      const actualText = await text();
      fs.writeFileSync(path.join(out, `${name}.txt`), actualText);
      if (actualText !== expectedText) {
        fs.writeFileSync(path.join(out, 'expected.txt'), expectedText);
        let mismatch = 0;
        while (mismatch < Math.min(expectedText.length, actualText.length) && expectedText[mismatch] === actualText[mismatch]) mismatch += 1;
        assert.fail(`${name}: text changed at ${mismatch}: ${JSON.stringify(actualText.slice(mismatch - 20, mismatch + 80))}`);
      }
    };
    const lines = Array.from({ length: 60 }, (_, i) => `Paragraph ${String(i + 1).padStart(2, '0')}: `
      + 'Long terminal output should stay readable from the first column to the last, with every word preserved. '.repeat(4)
      + `END-${i + 1}`);
    lines.push('  const path = "/synthetic/' + 'long_path_segment/'.repeat(24) + 'last-file.txt";',
      '  Unicode: café, naïve, Ελληνικά, 中文. Keep indentation and blank lines.', '', '> READY');
    expectedText = lines.join('\n');
    await write(lines.join('\r\n'));
    await capture('dark-inline-long');
    await js(`document.querySelector('#terminal-window-open').click()`);
    await capture('dark-window-long');
    for (const theme of ['dark', 'light']) {
      await js(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}`);
      for (const width of [380, 1720]) {
        window.setContentSize(width, 900);
        await capture(`${theme}-${width}-long`);
      }
    }
    await js(`qaTerminal.scrollToTop()`);
    const top = await js(`qaTerminal.buffer.active.viewportY`);
    expectedText += '\nBackground output while reading earlier text.\n> READY';
    await write('\r\nBackground output while reading earlier text.\r\n> READY');
    assert.equal(await js(`qaTerminal.buffer.active.viewportY`), top, 'New output preserves a manually scrolled viewport');
    await capture('scrolled-long');
    await js(`qaTerminal.scrollToBottom(); document.querySelector('#terminal-window-close').click()`);
    await capture('restored-inline-long');
    await js(`document.querySelector('[data-event-filter="conversation"]').click(); document.querySelector('#original-terminal-view').click()`);
    await until(() => js(`qaTerminal.buffer.active.getLine(qaTerminal.buffer.active.baseY + qaTerminal.buffer.active.cursorY)?.translateToString(true).includes('READY')`), 'reconnected terminal');
    await capture('reconnected-long');
    // Extra pass: zoom and a short viewport change cell geometry independently of docking.
    await js(`document.querySelector('#terminal-window-open').click()`);
    window.webContents.setZoomFactor(1.25);
    window.setContentSize(1100, 650);
    await capture('zoomed-short-long');
    window.webContents.setZoomFactor(1);
    for (const width of [420, 1280, 600, 1720]) {
      window.setContentSize(width, 900);
      await pause(35);
    }
    await capture('resize-burst-long');
    // Completion with a retained PTY stays live; its actual exit reveals the saved conversation.
    task.status = 'complete';
    task.finished_at = '2026-09-05T10:01:00Z';
    await js('qaRefreshTask()');
    assert.equal(await js(`document.querySelector('#native-terminal-screen').hidden`), false);
    terminalClosed = true;
    exit({ exitCode: 0 });
    await until(() => js(`!document.querySelector('#detail-events').hidden`), 'conversation after terminal exit');
    assert.equal(await js(`document.querySelector('[data-terminal-window-view="conversation"]').getAttribute('aria-pressed')`), 'true');
    assert.ok(await js(`document.querySelector('#detail-events').textContent.includes('The completed response is ready for review.')`));
    fs.writeFileSync(path.join(out, 'completed-conversation-window.png'), (await window.webContents.capturePage()).toPNG());
    await js(`document.querySelector('#terminal-window-close').click()`);
    await js('qaRefreshTask()');
    assert.equal(await js(`document.querySelector('#detail-events').hidden`), false);
    assert.equal(await js(`document.querySelector('[data-event-filter="conversation"]').getAttribute('aria-pressed')`), 'true');
    fs.writeFileSync(path.join(out, 'completed-conversation-inline.png'), (await window.webContents.capturePage()).toPNG());
    assert.deepEqual(errors, [], 'No renderer warnings or errors');
    console.log(`Long terminal rendering passed. Artifacts: ${out}`);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    if (window && !window.isDestroyed()) window.destroy();
    detachSockets?.();
    await host?.shutdown();
    server?.closeAllConnections();
    if (server?.listening) await new Promise((done) => server.close(done));
    app.exit(process.exitCode || 0);
  }
});
