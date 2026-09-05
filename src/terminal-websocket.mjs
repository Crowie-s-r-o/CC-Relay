import { WebSocketServer, WebSocket } from 'ws';

const MAX_BUFFERED_BYTES = 4 * 1024 * 1024;

// The socket can attach only to a persisted task's current, locally owned PTY.
// Neither native handles nor arbitrary launch commands are accepted from the renderer.
export function attachTerminalWebSockets(server, { terminals, host }) {
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 128 * 1024, perMessageDeflate: false });
  const controllers = new Map();
  const upgrade = (request, socket, head) => {
    let url;
    try {
      const origin = new URL(request.headers.origin);
      if (origin.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname)
        || origin.host !== request.headers.host || Number(origin.port) !== server.address()?.port) throw new Error();
      url = new URL(request.url, origin);
      if (url.searchParams.getAll('threadId').length !== 1 || url.searchParams.getAll('launchId').length !== 1) throw new Error();
    } catch {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    const match = url.pathname.match(/^\/api\/tasks\/(\d+)\/terminal$/);
    const taskId = Number(match?.[1]);
    const threadId = url.searchParams.get('threadId');
    const launchId = url.searchParams.get('launchId');
    let identity = match && Number.isSafeInteger(taskId) && threadId.length <= 512 && launchId.length <= 512
      ? terminals.connection(taskId, threadId, launchId) : null;
    if (!identity) {
      socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      return;
    }
    const current = () => {
      const next = terminals.connection(taskId, identity.threadId, launchId);
      if (JSON.stringify(next) === JSON.stringify(identity)) return true;
      // Registration gives the same PTY its durable conversation ID. Permit this
      // one handoff without dropping output or input, then pin that conversation.
      // Every other ownership field must still match the original connection.
      if (identity.threadId === `launch:${launchId}` && next
        && JSON.stringify({ ...next, threadId: identity.threadId }) === JSON.stringify(identity)) {
        identity = next;
        return true;
      }
      return false;
    };
    sockets.handleUpgrade(request, socket, head, (client) => {
      const previous = controllers.get(launchId);
      controllers.set(launchId, client);
      previous?.close(4001, 'Terminal opened in another view.');
      let unsubscribe = () => {};
      let bytes = 0;
      let intervalStarted = Date.now();
      const valid = () => client.readyState === WebSocket.OPEN
        && controllers.get(launchId) === client && current();
      const send = (event) => {
        if (!valid()) { client.close(4004, 'Task terminal changed.'); return; }
        if (client.bufferedAmount > MAX_BUFFERED_BYTES) { client.close(4008, 'Terminal output is too slow.'); return; }
        client.send(JSON.stringify(event));
        if (event.type === 'exit') client.close(1000, 'Terminal closed.');
      };
      // Recheck even an idle socket after task deletion, rebinding, or process exit.
      const timer = setInterval(() => { if (!valid()) client.close(4004, 'Task terminal changed.'); }, 1000);
      timer.unref?.();
      client.on('message', (payload, binary) => {
        try {
          if (!valid() || binary) throw new Error('Task terminal changed.');
          if (Date.now() - intervalStarted >= 1000) { bytes = 0; intervalStarted = Date.now(); }
          bytes += payload.length;
          if (bytes > 1024 * 1024) throw new Error('Terminal input is too fast.');
          const message = JSON.parse(payload.toString());
          if (message.type === 'input' && typeof message.data === 'string' && message.data.length <= 32_768) {
            host.write(launchId, message.data);
          } else if (message.type === 'binary' && typeof message.data === 'string'
            && message.data.length <= 32_768 && /^[A-Za-z0-9+/]*={0,2}$/.test(message.data)) {
            host.write(launchId, Buffer.from(message.data, 'base64'));
          } else if (message.type === 'resize') {
            host.resize(launchId, message.cols, message.rows);
          } else throw new Error('Invalid terminal input.');
        } catch { client.close(4004, 'Terminal input rejected.'); }
      });
      client.on('error', () => client.terminate());
      client.on('close', () => {
        clearInterval(timer);
        unsubscribe();
        if (controllers.get(launchId) === client) controllers.delete(launchId);
      });
      void host.attach(launchId, send).then((dispose) => {
        unsubscribe = dispose;
        if (!valid()) { dispose(); client.close(4004, 'Task terminal changed.'); }
      }).catch(() => client.close(4004, 'Terminal unavailable.'));
    });
  };
  server.on('upgrade', upgrade);
  return () => {
    server.off('upgrade', upgrade);
    for (const client of sockets.clients) client.terminate();
    sockets.close();
  };
}
