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

    const disconnected = once(proxy, 'changed');
    client.close();
    await disconnected;
    assert.deepEqual(proxy.listConnectedThreadIds(), []);
  } finally {
    client.close();
    proxy.stop();
    await new Promise((resolve) => backend.close(resolve));
  }
});
