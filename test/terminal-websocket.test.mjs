import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { WebSocket } from 'ws';
import { attachTerminalWebSockets } from '../src/terminal-websocket.mjs';
import { ProjectLauncher } from '../src/project-launcher.mjs';
import { TaskOriginalTerminal } from '../src/task-original-terminal.mjs';

function nextMessage(socket) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      socket.off('message', message);
      socket.off('close', closed);
      socket.off('error', failed);
    };
    const message = (...args) => { cleanup(); resolve(args); };
    const closed = () => { cleanup(); reject(new assert.AssertionError({ message: 'The terminal closed before producing its next output.' })); };
    const failed = (error) => { cleanup(); reject(error); };
    socket.once('message', message);
    socket.once('close', closed);
    socket.once('error', failed);
  });
}

function expectedClose(socket) {
  return new Promise((resolve, reject) => {
    const closed = (...args) => { clearTimeout(timer); resolve(args); };
    const timer = setTimeout(() => {
      socket.off('close', closed);
      reject(new assert.AssertionError({ message: 'The terminal stayed open after its ownership changed.' }));
    }, 2000);
    socket.once('close', closed);
  });
}

async function world(t, { starting = false, terminals = null } = {}) {
  const server = createServer();
  const threadId = starting ? 'launch:launch-qa' : 'session-qa';
  const identity = { taskId: 7, threadId, launchId: 'launch-qa', provider: 'codex', cwd: '/synthetic/project',
    taskProvider: 'codex', mode: 'execute' };
  let current = identity;
  let listener = null;
  const input = [];
  const sizes = [];
  let detached = 0;
  const stop = attachTerminalWebSockets(server, {
    terminals: terminals || { connection: (id, thread, launch) => id === 7 && launch === 'launch-qa'
      && (thread === current?.threadId || (starting && thread === threadId)) ? current : null },
    host: { attach: async (_id, send) => { listener = send; send({ type: 'snapshot', data: '\x1b[31mCLI', cols: 120, rows: 30 }); return () => detached++; },
      write: (id, data) => input.push({ id, data }), resize: (id, cols, rows) => sizes.push({ id, cols, rows }) },
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  t.after(async () => { stop(); await new Promise((done) => server.close(done)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const connect = (suffix = '', options = { origin }) => new WebSocket(
    origin.replace('http:', 'ws:') + `/api/tasks/7/terminal?threadId=${threadId}&launchId=launch-qa${suffix}`, options);
  return { connect, input, sizes, identity, setCurrent: (value) => { current = value; },
    send: (event) => listener(event), detached: () => detached };
}

test('PTY socket sends raw output, keys and dimensions, then rejects stale task input', async (t) => {
  const w = await world(t);
  const socket = w.connect();
  const [snapshot] = await nextMessage(socket);
  assert.equal(JSON.parse(snapshot).data, '\x1b[31mCLI');
  const output = nextMessage(socket);
  w.send({ type: 'data', data: '\x1b[HNative redraw' });
  assert.equal(JSON.parse((await output)[0]).data, '\x1b[HNative redraw');
  socket.send(JSON.stringify({ type: 'input', data: 'hello\r\x03' }));
  socket.send(JSON.stringify({ type: 'resize', cols: 90, rows: 24 }));
  await new Promise((done) => setTimeout(done, 25));
  assert.deepEqual(w.input, [{ id: 'launch-qa', data: 'hello\r\x03' }]);
  assert.deepEqual(w.sizes, [{ id: 'launch-qa', cols: 90, rows: 24 }]);
  w.setCurrent(null);
  const closed = once(socket, 'close');
  socket.send(JSON.stringify({ type: 'input', data: 'must not reach another task' }));
  assert.equal((await closed)[0], 4004);
  assert.equal(w.input.length, 1);
  await new Promise((done) => setTimeout(done, 25));
  assert.equal(w.detached(), 1);
});

test('conversation registration keeps the startup socket open and pins its first bound conversation', async (t) => {
  const w = await world(t, { starting: true });
  const socket = w.connect();
  await nextMessage(socket);
  w.setCurrent({ ...w.identity, threadId: 'session-qa' });
  const output = nextMessage(socket);
  w.send({ type: 'data', data: 'Same terminal after registration' });
  assert.equal(JSON.parse((await output)[0]).data, 'Same terminal after registration');
  socket.send(JSON.stringify({ type: 'input', data: 'continue\r' }));
  await new Promise((done) => setTimeout(done, 25));
  assert.equal(socket.readyState, WebSocket.OPEN);
  assert.deepEqual(w.input, [{ id: 'launch-qa', data: 'continue\r' }]);
  assert.equal(w.detached(), 0);

  w.setCurrent({ ...w.identity, threadId: 'different-conversation' });
  const closed = once(socket, 'close');
  socket.send(JSON.stringify({ type: 'input', data: 'must not follow a second binding' }));
  assert.equal((await closed)[0], 4004);
  assert.equal(w.input.length, 1);
});

test('startup registration cannot change task, project, provider, workflow, or launch ownership', async (t) => {
  for (const change of [
    { taskId: 8 }, { cwd: '/synthetic/other' }, { provider: 'claude' },
    { taskProvider: 'claude' }, { mode: 'plan' }, { launchId: 'other-launch' },
  ]) {
    await t.test(JSON.stringify(change), async (t) => {
      const w = await world(t, { starting: true });
      const socket = w.connect();
      await nextMessage(socket);
      w.setCurrent({ ...w.identity, threadId: 'session-qa', ...change });
      const closed = expectedClose(socket);
      socket.send(JSON.stringify({ type: 'input', data: 'rejected' }));
      assert.equal((await closed)[0], 4004);
      assert.equal(w.input.length, 0);
    });
  }
});

test('the real task service keeps one socket through provider binding and delayed task persistence', async (t) => {
  for (const [mode, provider, field] of [
    ['execute', 'codex', 'thread_id'], ['plan', 'claude', 'author_thread_id'],
    ['turbo', 'claude', 'councilThreadId'],
  ]) {
    await t.test(`${mode} ${provider}`, async (t) => {
      const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'relay-synthetic-startup-')));
      t.after(() => rmSync(cwd, { recursive: true, force: true }));
      let alive = true;
      const task = { id: 7, mode, provider: mode === 'execute' ? provider : 'codex', repo_path: cwd, status: 'running', turbo: {} };
      const launcher = new ProjectLauncher({ embeddedTerminalHost: { isAlive: () => alive } });
      launcher.trackOwnedTerminal({ launchId: 'launch-qa', provider, path: cwd, terminalProcessId: 4242,
        taskId: task.id, transport: 'pty' });
      const terminals = new TaskOriginalTerminal({ launcher, database: { getTask: (id) => id === task.id ? task : null },
        knownThread: () => null, platform: 'darwin' });
      const w = await world(t, { starting: true, terminals });
      const socket = w.connect();
      await nextMessage(socket);
      launcher.bindOwnedTerminal('launch-qa', { id: 'session-qa', provider, cwd });
      // Council waits for its other provider before saving either conversation.
      await new Promise((done) => setTimeout(done, 1100));
      assert.equal(socket.readyState, WebSocket.OPEN);
      assert.equal((await terminals.read(7, 'launch:launch-qa')).threadId, 'launch:launch-qa');
      socket.send(JSON.stringify({ type: 'input', data: 'before persistence' }));
      if (mode === 'turbo') task.turbo[field] = 'session-qa';
      else task[field] = 'session-qa';
      launcher.confirmTaskTerminalBinding('launch-qa', 7, 'session-qa');
      const output = nextMessage(socket);
      w.send({ type: 'data', data: 'Registered in the same terminal' });
      assert.equal(JSON.parse((await output)[0]).data, 'Registered in the same terminal');
      socket.send(JSON.stringify({ type: 'input', data: 'after persistence' }));
      await new Promise((done) => setTimeout(done, 25));
      assert.equal(socket.readyState, WebSocket.OPEN);
      assert.deepEqual(w.input.map(({ data }) => data), ['before persistence', 'after persistence']);
      assert.equal((await terminals.read(7, 'launch:launch-qa')).threadId, 'session-qa');
      assert.equal(w.detached(), 0);

      alive = false;
      const closed = once(socket, 'close');
      socket.send(JSON.stringify({ type: 'input', data: 'closed terminal input' }));
      assert.equal((await closed)[0], 4004);
      assert.equal(w.input.length, 2);
    });
  }
});

test('terminal WebSocket rejects external origins, missing origins, duplicate identifiers, and foreign sessions', async (t) => {
  const w = await world(t);
  for (const [suffix, options] of [
    ['', { origin: 'https://untrusted.invalid' }], ['', {}], ['&threadId=other', undefined], ['&launchId=other', undefined],
  ]) {
    const socket = w.connect(suffix, options);
    const [error] = await once(socket, 'error');
    assert.match(error.message, /403|404/);
  }
  assert.equal(w.input.length, 0);
});

test('a second view replaces the previous input controller without closing the CLI', async (t) => {
  const w = await world(t);
  const first = w.connect();
  await nextMessage(first);
  const closed = once(first, 'close');
  const second = w.connect();
  await nextMessage(second);
  assert.equal((await closed)[0], 4001);
  second.send(JSON.stringify({ type: 'input', data: 'active' }));
  await new Promise((done) => setTimeout(done, 25));
  assert.deepEqual(w.input, [{ id: 'launch-qa', data: 'active' }]);
  const ended = once(second, 'close'); second.close(); await ended;
});
