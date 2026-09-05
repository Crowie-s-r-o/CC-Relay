// Run: node node_modules/electron/cli.js scripts/verify-terminal-startup.cjs [output-directory]
// Real renderer, host, launcher ownership and socket bridge; synthetic PTY only.
const { app, BrowserWindow, nativeTheme } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const out = path.resolve(process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'relay-terminal-startup-')));
fs.mkdirSync(out, { recursive: true });
const cwd = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'relay-synthetic-startup-ui-')));
const task = { id: 7, title: 'Verify uninterrupted terminal startup', prompt: 'Check startup.',
  provider: 'codex', mode: 'execute', status: 'running', repo_path: cwd, thread_id: null,
  terminal_lifecycle: 'disposable', created_at: '2026-09-05T10:00:00Z', started_at: '2026-09-05T10:00:00Z' };
const launchId = 'synthetic-startup-launch';
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
const errors = [];
const input = [];
let window, server, host, detachSockets, output, exit, preferences;

app.whenReady().then(async () => {
  try {
    const moduleAt = (name) => import(pathToFileURL(path.join(root, 'src', name)));
    const { EmbeddedTerminalHost } = await moduleAt('embedded-terminal.mjs');
    const { ProjectLauncher } = await moduleAt('project-launcher.mjs');
    const { TaskOriginalTerminal } = await moduleAt('task-original-terminal.mjs');
    const { attachTerminalWebSockets } = await moduleAt('terminal-websocket.mjs');
    host = new EmbeddedTerminalHost({ spawn: () => ({
      pid: 424242, onData: (callback) => { output = callback; }, onExit: (callback) => { exit = callback; },
      write: (data) => input.push(data), pause() {}, resume() {}, resize() {}, kill: () => exit({ exitCode: 0 }),
    }) });
    host.launch({ launchId, provider: task.provider, path: cwd, command: 'synthetic-startup' });
    const launcher = new ProjectLauncher({ embeddedTerminalHost: host });
    launcher.trackOwnedTerminal({ launchId, provider: task.provider, path: cwd, taskId: task.id,
      transport: 'pty', terminalProcessId: 424242 });
    const terminals = new TaskOriginalTerminal({ launcher, database: { getTask: (id) => id === task.id ? task : null },
      knownThread: () => null });
    const answer = async (url, method, body) => {
      if (url.pathname === '/api/status') return { capabilities: { projectLauncher: true, disposableTerminalPools: true,
        nativeTerminalScreen: true, embeddedTerminal: true }, codex: { available: true, authenticated: true },
        runningTasks: [task], queue: { runningTaskId: task.id, waiting: 0 }, counts: { running: 1, queued: 0, complete: 0 } };
      if (url.pathname === '/api/projects') return { projects: [{ id: 1, name: 'Startup fixture', path: cwd,
        max_codex_instances: 1, max_claude_instances: 1 }], activeProjectPath: cwd };
      if (url.pathname === '/api/tasks') return { tasks: [task] };
      if (url.pathname === `/api/tasks/${task.id}`) return { task, events: [], prompts: [] };
      if (url.pathname.endsWith('/terminal-screen')) return { terminal: await terminals.read(task.id, url.searchParams.get('threadId')) };
      if (url.pathname === '/api/threads') return { threads: [], connection: { connected: true }, providers: [] };
      if (url.pathname === '/api/models') return { models: [] };
      if (url.pathname === '/api/plans') return { plans: [] };
      if (url.pathname === '/api/tasks/completion-reviews/migrate') return { migrated: 0 };
      if (url.pathname === '/api/ui-preferences') {
        if (method === 'PATCH') preferences = JSON.parse(body);
        return { preferences };
      }
      assert.ok(method !== 'POST', `Unexpected mutation: ${url.pathname}`);
      return {};
    };
    server = http.createServer((request, response) => {
      const url = new URL(request.url, 'http://localhost');
      if (url.pathname === '/api/events') {
        response.writeHead(200, { 'Content-Type': 'text/event-stream' });
        response.write(': synthetic fixture\n\n');
        return;
      }
      if (url.pathname.startsWith('/api/')) {
        let body = '';
        request.on('data', (chunk) => { body += chunk; });
        request.on('end', async () => {
          try {
            const result = await answer(url, request.method, body);
            response.writeHead(200, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify(result));
          } catch (error) { errors.push(error.message); response.writeHead(500); response.end('{}'); }
        });
        return;
      }
      const vendors = { '/vendor/xterm.js': '@xterm/xterm/lib/xterm.js', '/vendor/xterm.css': '@xterm/xterm/css/xterm.css',
        '/vendor/addon-fit.js': '@xterm/addon-fit/lib/addon-fit.js' };
      const file = vendors[url.pathname] ? path.join(root, 'node_modules', vendors[url.pathname])
        : path.join(root, 'public', url.pathname === '/' ? 'index.html' : url.pathname);
      try {
        let data = fs.readFileSync(file);
        // These probes exist only in this isolated fixture, never in product assets.
        if (url.pathname === '/vendor/xterm.js') data = `${data}\n;
          globalThis.qaTerminals = []; globalThis.qaSockets = [];
          globalThis.Terminal = class extends globalThis.Terminal {
            constructor(options) { super(options); qaTerminals.push(this); }
          };
          globalThis.WebSocket = class extends globalThis.WebSocket {
            constructor(...args) { super(...args); qaSockets.push(this); }
          };`;
        response.writeHead(200, { 'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'",
          'Content-Type': ({ '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
          '.svg': 'image/svg+xml', '.woff2': 'font/woff2' })[path.extname(file)] || 'application/octet-stream' });
        response.end(data);
      } catch { response.writeHead(404); response.end(); }
    });
    detachSockets = attachTerminalWebSockets(server, { host, terminals });
    await new Promise((done) => server.listen(0, '127.0.0.1', done));
    output('STARTUP READY\r\nThe original terminal stays visible.');
    nativeTheme.themeSource = 'dark';
    window = new BrowserWindow({ show: false, frame: false, width: 1720, height: 1040,
      webPreferences: { sandbox: true, partition: `terminal-startup-${Date.now()}` } });
    window.webContents.on('console-message', ({ level, message }) => { if (['warning', 'error'].includes(level)) errors.push(message); });
    const js = (source) => window.webContents.executeJavaScript(source);
    const until = async (condition, label) => {
      for (let i = 0; i < 150; i += 1) { if (await condition()) return; await pause(20); }
      throw new Error(`Timed out: ${label}`);
    };
    await window.loadURL(`http://127.0.0.1:${server.address().port}/`);
    await until(() => js(`globalThis.qaTerminals?.[0]?.buffer.active.getLine(0)?.translateToString(true).includes('STARTUP READY')`), 'startup terminal');
    window.webContents.debugger.attach('1.3');
    await window.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true });
    await js(`
      globalThis.qaNode = document.querySelector('#embedded-terminal .xterm');
      globalThis.qaHiddenFrames = 0; globalThis.qaObserve = true;
      const inspectFrame = () => {
        if (!qaObserve) return;
        if (!qaNode.isConnected || !qaNode.checkVisibility() || qaNode.getBoundingClientRect().height === 0) qaHiddenFrames++;
        requestAnimationFrame(inspectFrame);
      };
      requestAnimationFrame(inspectFrame);
      qaTerminals[0].focus(); qaTerminals[0].select(0, 0, 7);
      globalThis.qaFocus = document.activeElement;
    `);
    const capture = async (name) => fs.writeFileSync(path.join(out, `${name}.png`), (await window.webContents.capturePage()).toPNG());
    const stable = async () => {
      assert.deepEqual(await js(`({terminals:qaTerminals.length,sockets:qaSockets.length,
        connected:qaSockets[0].readyState,node:qaNode===document.querySelector('#embedded-terminal .xterm'),
        hidden:qaHiddenFrames})`), { terminals: 1, sockets: 1, connected: 1, node: true, hidden: 0 });
    };
    await capture('startup-dark');
    launcher.bindOwnedTerminal(launchId, { id: 'synthetic-conversation', provider: task.provider, cwd });
    output('\r\nPROVIDER REGISTERED');
    await pause(1200);
    await stable();
    await capture('registered-before-persistence');
    task.thread_id = 'synthetic-conversation';
    launcher.confirmTaskTerminalBinding(launchId, task.id, task.thread_id);
    output('\r\nTASK READY');
    await pause(1200);
    await stable();
    assert.equal(await js('document.activeElement === qaFocus'), true, 'Startup keeps keyboard focus');
    assert.equal(await js('qaTerminals[0].getSelection()'), 'STARTUP', 'Startup keeps text selection');
    window.webContents.sendInputEvent({ type: 'char', keyCode: 'x' });
    await until(() => input.includes('x'), 'typing after registration');
    await js(`document.querySelector('#original-terminal-view').click()`);
    await pause(200);
    await stable();
    await capture('registered-dark');
    await js(`document.querySelector('#terminal-window-open').click()`);
    await pause(150);
    await stable();
    await capture('registered-window');
    await js(`document.documentElement.dataset.theme = 'light'`);
    window.setContentSize(380, 900);
    await pause(200);
    await stable();
    await capture('registered-light-compact');
    // Extra verification: an explicit view switch must still close its socket.
    await js(`qaObserve = false; document.querySelector('#terminal-window-close').click();
      document.querySelector('[data-event-filter="conversation"]').click()`);
    await until(() => js('qaSockets[0].readyState === 3'), 'intentional view disconnect');
    await js(`document.querySelector('#original-terminal-view').click()`);
    await until(() => js('qaSockets.length === 2 && qaSockets[1].readyState === 1'), 'intentional view reconnect');
    assert.deepEqual(errors, [], 'No renderer warnings or errors');
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ uninterrupted: true, focusPreserved: true,
      selectionPreserved: true, inputVerified: true, errors }, null, 2));
    console.log(`Uninterrupted terminal startup passed. Artifacts: ${out}`);
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally {
    if (window && !window.isDestroyed()) window.destroy();
    detachSockets?.();
    await host?.shutdown();
    server?.closeAllConnections();
    if (server?.listening) await new Promise((done) => server.close(done));
    fs.rmSync(cwd, { recursive: true, force: true });
    app.exit(process.exitCode || 0);
  }
});
