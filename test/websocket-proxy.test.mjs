import assert from 'node:assert/strict';
import test from 'node:test';
import WebSocket, { WebSocketServer } from 'ws';
import { RelayWebSocketProxy } from '../src/websocket-proxy.mjs';

const THREAD_ID = '019f6b51-cad9-7582-99fb-e9a6ee76ead2';

function once(target, event) {
  return new Promise((resolve, reject) => {
    target.once(event, resolve);
    target.once('error', reject);
  });
}

test('proxy tracks only live clients that joined a Codex thread', async () => {
  const backend = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(backend, 'listening');
  backend.on('connection', (socket) => {
    socket.on('message', (data) => {
      const message = JSON.parse(data.toString('utf8'));
      if (message.method === 'thread/resume') {
        socket.send(JSON.stringify({
          id: message.id,
          result: { thread: { id: message.params.threadId } },
        }));
      }
    });
  });

  const address = backend.address();
  const proxy = new RelayWebSocketProxy({
    port: 0,
    target: `ws://127.0.0.1:${address.port}`,
  });
  await proxy.start();
  const client = new WebSocket(proxy.endpoint);

  try {
    await once(client, 'open');
    const connected = once(proxy, 'changed');
    client.send(JSON.stringify({
      id: 1,
      method: 'thread/resume',
      params: { threadId: THREAD_ID },
    }));
    await connected;
    assert.deepEqual(proxy.listConnectedThreadIds(), [THREAD_ID]);
    const runtimeClient = proxy.runtimeClientForThread(THREAD_ID);
    assert.equal(Number.isInteger(runtimeClient.clientPort), true);
    assert.equal(runtimeClient.clientPort > 0, true);
    assert.equal(runtimeClient.serverPort, Number(new URL(proxy.endpoint).port));

    const disconnected = once(proxy, 'changed');
    client.close();
    await disconnected;
    assert.deepEqual(proxy.listConnectedThreadIds(), []);
    assert.equal(proxy.runtimeClientForThread(THREAD_ID), null);
  } finally {
    client.close();
    proxy.stop();
    await new Promise((resolve) => backend.close(resolve));
  }
});

test('proxy applies a launched project workspace to a new remote thread', async () => {
  const backend = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(backend, 'listening');
  const received = new Promise((resolve) => {
    backend.on('connection', (socket) => {
      socket.on('message', (data) => {
        const message = JSON.parse(data.toString('utf8'));
        resolve(message);
        socket.send(JSON.stringify({
          id: message.id,
          result: { thread: { id: THREAD_ID } },
        }));
      });
    });
  });

  const address = backend.address();
  const proxy = new RelayWebSocketProxy({
    port: 0,
    target: `ws://127.0.0.1:${address.port}`,
  });
  await proxy.start();
  const workspace = '/tmp/project with spaces';
  const launchId = 'launch-123';
  const reservation = await proxy.reserveLaunchClient(workspace, launchId);
  const client = new WebSocket(reservation.endpoint);

  try {
    await once(client, 'open');
    const connected = once(proxy, 'changed');
    client.send(JSON.stringify({
      id: 2,
      method: 'thread/start',
      params: { model: 'gpt-test', cwd: '/wrong/workspace' },
    }));
    const message = await received;
    await connected;
    assert.equal(message.params.cwd, workspace);
    assert.equal(message.params.model, 'gpt-test');
    assert.equal(proxy.launchIdForThread(THREAD_ID), launchId);
  } finally {
    client.close();
    proxy.stop();
    await new Promise((resolve) => backend.close(resolve));
  }
});

test('a dedicated launch endpoint cannot be claimed by a manual shared-proxy client', async () => {
  const backend = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(backend, 'listening');
  const received = [];
  backend.on('connection', (socket) => {
    socket.on('message', (data) => {
      const message = JSON.parse(data.toString('utf8'));
      received.push(message);
      const threadId = message.params.model === 'manual' ? 'manual-thread' : 'launched-thread';
      socket.send(JSON.stringify({
        id: message.id,
        result: { thread: { id: threadId } },
      }));
    });
  });

  const address = backend.address();
  const proxy = new RelayWebSocketProxy({
    port: 0,
    target: `ws://127.0.0.1:${address.port}`,
  });
  await proxy.start();
  const launchId = 'exact-launch';
  const reservation = await proxy.reserveLaunchClient('/work/launched', launchId);
  const manual = new WebSocket(proxy.endpoint);
  let launched = null;

  try {
    await once(manual, 'open');
    let connected = once(proxy, 'changed');
    manual.send(JSON.stringify({
      id: 10,
      method: 'thread/start',
      params: { model: 'manual', cwd: '/work/manual' },
    }));
    await connected;
    assert.equal(proxy.launchIdForThread('manual-thread'), null);

    launched = new WebSocket(reservation.endpoint);
    await once(launched, 'open');
    connected = once(proxy, 'changed');
    launched.send(JSON.stringify({
      id: 11,
      method: 'thread/start',
      params: { model: 'launched', cwd: '/wrong/workspace' },
    }));
    await connected;
    assert.equal(proxy.launchIdForThread('launched-thread'), launchId);
    assert.equal(received.find((message) => message.id === 10).params.cwd, '/work/manual');
    assert.equal(received.find((message) => message.id === 11).params.cwd, '/work/launched');
  } finally {
    manual.close();
    launched?.close();
    proxy.stop();
    await new Promise((resolve) => backend.close(resolve));
  }
});

test('runtime process recovery refuses a thread joined by more than one proxy client', async () => {
  const backend = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(backend, 'listening');
  backend.on('connection', (socket) => {
    socket.on('message', (data) => {
      const message = JSON.parse(data.toString('utf8'));
      socket.send(JSON.stringify({
        id: message.id,
        result: { thread: { id: THREAD_ID } },
      }));
    });
  });
  const address = backend.address();
  const proxy = new RelayWebSocketProxy({
    port: 0,
    target: `ws://127.0.0.1:${address.port}`,
  });
  await proxy.start();
  const first = new WebSocket(proxy.endpoint);
  const second = new WebSocket(proxy.endpoint);

  try {
    await Promise.all([once(first, 'open'), once(second, 'open')]);
    let joined = once(proxy, 'changed');
    first.send(JSON.stringify({ id: 21, method: 'thread/resume', params: { threadId: THREAD_ID } }));
    await joined;
    joined = once(proxy, 'changed');
    second.send(JSON.stringify({ id: 22, method: 'thread/resume', params: { threadId: THREAD_ID } }));
    await joined;
    assert.deepEqual(proxy.listConnectedThreadIds(), [THREAD_ID]);
    assert.equal(proxy.runtimeClientForThread(THREAD_ID), null);
  } finally {
    first.close();
    second.close();
    proxy.stop();
    await new Promise((resolve) => backend.close(resolve));
  }
});
