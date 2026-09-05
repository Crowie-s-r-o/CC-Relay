import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';
import { WebSocket } from 'ws';
import { attachTerminalWebSockets } from '../src/terminal-websocket.mjs';

async function world(t) {
  const server = createServer();
  const identity = { taskId: 7, threadId: 'session-qa', launchId: 'launch-qa', provider: 'codex', cwd: '/synthetic/project' };
  let current = identity;
  let listener = null;
  const input = [];
  const sizes = [];
  let detached = 0;
  const stop = attachTerminalWebSockets(server, {
    terminals: { connection: (id, thread, launch) => id === 7 && thread === 'session-qa' && launch === 'launch-qa' ? current : null },
    host: { attach: async (_id, send) => { listener = send; send({ type: 'snapshot', data: '\x1b[31mCLI', cols: 120, rows: 30 }); return () => detached++; },
      write: (id, data) => input.push({ id, data }), resize: (id, cols, rows) => sizes.push({ id, cols, rows }) },
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  t.after(async () => { stop(); await new Promise((done) => server.close(done)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const connect = (suffix = '', options = { origin }) => new WebSocket(
    origin.replace('http:', 'ws:') + `/api/tasks/7/terminal?threadId=session-qa&launchId=launch-qa${suffix}`, options);
  return { connect, input, sizes, setCurrent: (value) => { current = value; },
    send: (event) => listener(event), detached: () => detached };
}

test('PTY socket sends raw output, keys and dimensions, then rejects stale task input', async (t) => {
  const w = await world(t);
  const socket = w.connect();
  const [snapshot] = await once(socket, 'message');
  assert.equal(JSON.parse(snapshot).data, '\x1b[31mCLI');
  const output = once(socket, 'message');
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
  await once(first, 'message');
  const closed = once(first, 'close');
  const second = w.connect();
  await once(second, 'message');
  assert.equal((await closed)[0], 4001);
  second.send(JSON.stringify({ type: 'input', data: 'active' }));
  await new Promise((done) => setTimeout(done, 25));
  assert.deepEqual(w.input, [{ id: 'launch-qa', data: 'active' }]);
  const ended = once(second, 'close'); second.close(); await ended;
});
