import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../public/embedded-terminal.js', import.meta.url), 'utf8');

function renderer() {
  const terminals = [];
  const sockets = [];
  const element = {
    children: [], clears: 0,
    getClientRects: () => [{}],
    replaceChildren() { this.children = []; this.clears += 1; },
  };
  class Terminal {
    constructor(options) {
      this.options = options;
      this.parser = { registerCsiHandler() {}, registerDcsHandler() {} };
      this.writes = [];
      terminals.push(this);
    }
    loadAddon() {}
    open(mount) { mount.children.push(this); }
    onData(callback) { this.input = callback; }
    onBinary() {}
    onResize() {}
    resize() {}
    write(data, callback) { this.writes.push(data); callback?.(); }
    dispose() { this.disposed = true; }
  }
  class Socket {
    static OPEN = 1;
    constructor(url) { this.url = url; this.readyState = 1; this.sent = []; sockets.push(this); }
    send(data) { this.sent.push(JSON.parse(data)); }
    close() { this.readyState = 3; this.onclose?.({ code: 1000 }); }
  }
  class Observer { observe() {} disconnect() {} }
  const View = runInNewContext(`${source.replace('export class', 'class')}; EmbeddedTerminalView`, {
    Terminal, WebSocket: Socket, ResizeObserver: Observer, MutationObserver: Observer, URL,
    document: { hidden: false, documentElement: { dataset: { theme: 'dark' } } },
    location: { href: 'http://127.0.0.1:4999/', protocol: 'http:' },
    FitAddon: { FitAddon: class { proposeDimensions() { return { cols: 80, rows: 24 }; } } },
  });
  return { view: new View(element), element, terminals, sockets };
}

test('registering the same task launch preserves its terminal DOM, socket, output, and input', () => {
  const { view, element, terminals, sockets } = renderer();
  const starting = { taskId: 7, threadId: 'launch:synthetic-launch', launchId: 'synthetic-launch' };
  view.connect(starting);
  const terminal = terminals[0];
  const socket = sockets[0];
  socket.onmessage({ data: JSON.stringify({ type: 'snapshot', data: 'Startup screen', cols: 80, rows: 24 }) });
  const clears = element.clears;
  view.connect({ ...starting, threadId: 'synthetic-conversation' });
  socket.onmessage({ data: JSON.stringify({ type: 'data', data: 'Task running' }) });
  terminal.input('Continue\r');

  assert.equal(terminals.length, 1);
  assert.equal(sockets.length, 1);
  assert.equal(socket.readyState, 1);
  assert.equal(terminal.disposed, undefined);
  assert.equal(element.children[0], terminal);
  assert.equal(element.clears, clears, 'registration never clears the visible terminal');
  assert.deepEqual(terminal.writes, ['Startup screen', 'Task running']);
  assert.deepEqual(socket.sent, [{ type: 'input', data: 'Continue\r' }]);
  view.dispose();
});

test('a different task or launch replaces the old terminal and rejects its late output', () => {
  for (const change of [{ taskId: 8 }, { launchId: 'replacement-launch' }]) {
    const { view, element, terminals, sockets } = renderer();
    const identity = { taskId: 7, threadId: 'synthetic-conversation', launchId: 'synthetic-launch' };
    view.connect(identity);
    const oldSocket = sockets[0];
    view.connect({ ...identity, ...change });
    oldSocket.onmessage({ data: JSON.stringify({ type: 'data', data: 'Wrong terminal' }) });
    assert.equal(terminals.length, 2);
    assert.equal(sockets.length, 2);
    assert.equal(terminals[0].disposed, true);
    assert.equal(oldSocket.readyState, 3);
    assert.equal(element.children[0], terminals[1]);
    assert.deepEqual(terminals[1].writes, []);
    view.dispose();
  }
});

test('an actual socket disconnect still disables input and reconnects to a fresh authorized view', () => {
  const { view, terminals, sockets } = renderer();
  const identity = { taskId: 7, threadId: 'synthetic-conversation', launchId: 'synthetic-launch' };
  view.connect(identity);
  sockets[0].onmessage({ data: JSON.stringify({ type: 'snapshot', data: 'Original', cols: 80, rows: 24 }) });
  sockets[0].onclose({ code: 4004 });
  terminals[0].input('Stale input');
  assert.equal(terminals[0].options.disableStdin, true);
  assert.deepEqual(sockets[0].sent, []);
  view.connect(identity);
  assert.equal(sockets.length, 2);
  assert.equal(terminals[0].disposed, true);
  view.dispose();
});
