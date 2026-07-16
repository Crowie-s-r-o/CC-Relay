import { EventEmitter } from 'node:events';
import WebSocket, { WebSocketServer } from 'ws';

function parseMessage(data, isBinary) {
  if (isBinary) {
    return null;
  }
  try {
    return JSON.parse(data.toString('utf8'));
  } catch {
    return null;
  }
}

export class RelayWebSocketProxy extends EventEmitter {
  constructor({
    host = '127.0.0.1',
    port = 4769,
    target = 'ws://127.0.0.1:4770',
    WebSocketClient = WebSocket,
    WebSocketServerClass = WebSocketServer,
    diagnostic = () => {},
  } = {}) {
    super();
    this.host = host;
    this.port = port;
    this.target = target;
    this.WebSocketClient = WebSocketClient;
    this.WebSocketServerClass = WebSocketServerClass;
    this.diagnostic = diagnostic;
    this.nextClientId = 1;
    this.server = null;
    this.clients = new Set();
    this.startPromise = null;
    this.actualPort = null;
  }

  get endpoint() {
    return `ws://${this.host}:${this.actualPort ?? this.port}`;
  }

  async start() {
    if (this.server) {
      return this.endpoint;
    }
    if (this.startPromise) {
      return this.startPromise;
    }
    this.startPromise = this.startServer();
    try {
      return await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  startServer() {
    return new Promise((resolve, reject) => {
      const server = new this.WebSocketServerClass({ host: this.host, port: this.port });
      const fail = (error) => {
        server.close();
        reject(error);
      };
      server.once('error', fail);
      server.once('listening', () => {
        server.off('error', fail);
        server.on('error', (error) => this.emit('error', error));
        server.on('connection', (frontend) => this.connectClient(frontend));
        this.server = server;
        this.actualPort = server.address().port;
        this.diagnostic('proxy.listening', { endpoint: this.endpoint, target: this.target });
        resolve(this.endpoint);
      });
    });
  }

  connectClient(frontend) {
    const backend = new this.WebSocketClient(this.target);
    const client = {
      id: this.nextClientId++,
      frontend,
      backend,
      queued: [],
      pending: new Map(),
      threadId: null,
      closed: false,
    };
    this.clients.add(client);
    this.diagnostic('proxy.client.connected', { clientId: client.id, connectedClients: this.clients.size });

    frontend.on('message', (data, isBinary) => {
      this.inspectClientMessage(client, data, isBinary);
      if (backend.readyState === WebSocket.OPEN) {
        backend.send(data, { binary: isBinary });
      } else if (backend.readyState === WebSocket.CONNECTING && client.queued.length < 100) {
        client.queued.push({ data, isBinary });
      }
    });
    frontend.on('close', () => this.disconnectClient(client));
    frontend.on('error', (error) => this.emit('clientError', error));

    backend.on('open', () => {
      this.diagnostic('proxy.backend.connected', { clientId: client.id, queuedMessages: client.queued.length });
      for (const { data, isBinary } of client.queued) {
        backend.send(data, { binary: isBinary });
      }
      client.queued.length = 0;
    });
    backend.on('message', (data, isBinary) => {
      this.inspectServerMessage(client, data, isBinary);
      if (frontend.readyState === WebSocket.OPEN) {
        frontend.send(data, { binary: isBinary });
      }
    });
    backend.on('close', () => this.disconnectClient(client));
    backend.on('error', (error) => this.emit('clientError', error));
  }

  inspectClientMessage(client, data, isBinary) {
    const message = parseMessage(data, isBinary);
    if (message?.id == null || !message.method) {
      return;
    }
    if (message.method === 'thread/resume') {
      this.diagnostic('proxy.thread.resume.requested', { clientId: client.id, threadId: message.params?.threadId });
      client.pending.set(String(message.id), {
        method: message.method,
        threadId: message.params?.threadId,
      });
    } else if (message.method === 'thread/start' || message.method === 'thread/fork') {
      this.diagnostic('proxy.thread.create.requested', { clientId: client.id, method: message.method });
      client.pending.set(String(message.id), { method: message.method });
    }
  }

  inspectServerMessage(client, data, isBinary) {
    const message = parseMessage(data, isBinary);
    if (message?.id == null || message.method) {
      return;
    }
    const pending = client.pending.get(String(message.id));
    if (!pending) {
      return;
    }
    client.pending.delete(String(message.id));
    if (message.error) {
      this.diagnostic('proxy.thread.request.failed', { clientId: client.id, method: pending.method, error: message.error.message });
      return;
    }
    const threadId = message.result?.thread?.id || pending.threadId;
    if (threadId && client.threadId !== threadId) {
      client.threadId = threadId;
      this.diagnostic('proxy.thread.joined', { clientId: client.id, threadId, method: pending.method });
      this.emit('changed', this.listConnectedThreadIds());
    }
  }

  disconnectClient(client) {
    if (client.closed) {
      return;
    }
    client.closed = true;
    this.clients.delete(client);
    this.diagnostic('proxy.client.disconnected', { clientId: client.id, threadId: client.threadId, connectedClients: this.clients.size });
    const hadThread = Boolean(client.threadId);
    if (client.frontend.readyState === WebSocket.OPEN || client.frontend.readyState === WebSocket.CONNECTING) {
      client.frontend.close();
    }
    if (client.backend.readyState === WebSocket.OPEN || client.backend.readyState === WebSocket.CONNECTING) {
      client.backend.close();
    }
    if (hadThread) {
      this.emit('changed', this.listConnectedThreadIds());
    }
  }

  listConnectedThreadIds() {
    return [...new Set(
      [...this.clients]
        .filter((client) => !client.closed && client.threadId)
        .map((client) => client.threadId),
    )];
  }

  stop() {
    for (const client of [...this.clients]) {
      this.disconnectClient(client);
    }
    this.server?.close();
    this.server = null;
    this.actualPort = null;
  }
}
