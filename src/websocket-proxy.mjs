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
    this.launchServers = new Set();
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

  async reserveLaunchClient(workspace, launchId, timeoutMs = 30_000) {
    if (typeof workspace !== 'string' || !workspace || typeof launchId !== 'string' || !launchId) {
      throw new Error('A workspace and launch ID are required for a dedicated Codex endpoint.');
    }
    const server = new this.WebSocketServerClass({ host: this.host, port: 0 });
    this.launchServers.add(server);
    await new Promise((resolve, reject) => {
      const fail = (error) => {
        server.close();
        this.launchServers.delete(server);
        reject(error);
      };
      server.once('error', fail);
      server.once('listening', () => {
        server.off('error', fail);
        resolve();
      });
    });

    const address = server.address();
    const endpoint = `ws://${this.host}:${address.port}`;
    let claimed = false;
    let cancelled = false;
    const closeListener = () => {
      clearTimeout(timer);
      this.launchServers.delete(server);
    };
    const cancel = (event = 'proxy.launch.reservation.cancelled') => {
      if (cancelled || claimed) return;
      cancelled = true;
      clearTimeout(timer);
      server.close();
      this.launchServers.delete(server);
      this.diagnostic(event, { workspace, launchId, endpoint });
    };
    const timer = setTimeout(
      () => cancel('proxy.launch.reservation.expired'),
      timeoutMs,
    );
    timer.unref?.();
    server.once('close', closeListener);
    server.on('error', (error) => this.emit('error', error));
    server.on('connection', (frontend) => {
      if (claimed || cancelled) {
        frontend.close();
        return;
      }
      claimed = true;
      clearTimeout(timer);
      this.diagnostic('proxy.launch.reservation.claimed', {
        workspace,
        launchId,
        endpoint,
      });
      this.connectClient(frontend, { workspace, launchId });
      server.close();
    });
    this.diagnostic('proxy.launch.reservation.created', { workspace, launchId, endpoint });
    return { endpoint, cancel };
  }

  connectClient(frontend, reservation = null) {
    const backend = new this.WebSocketClient(this.target);
    const frontendSocket = frontend?._socket;
    const client = {
      id: this.nextClientId++,
      frontend,
      backend,
      queued: [],
      pending: new Map(),
      threadId: null,
      workspace: reservation?.workspace || null,
      launchId: reservation?.launchId || null,
      clientPort: Number(frontendSocket?.remotePort) || null,
      serverPort: Number(frontendSocket?.localPort) || null,
      closed: false,
    };
    this.clients.add(client);
    this.diagnostic('proxy.client.connected', {
      clientId: client.id,
      connectedClients: this.clients.size,
      workspace: client.workspace,
      launchId: client.launchId,
      clientPort: client.clientPort,
      serverPort: client.serverPort,
    });

    frontend.on('message', (data, isBinary) => {
      const forwarded = this.prepareClientMessage(client, data, isBinary);
      if (backend.readyState === WebSocket.OPEN) {
        backend.send(forwarded.data, { binary: forwarded.isBinary });
      } else if (backend.readyState === WebSocket.CONNECTING && client.queued.length < 100) {
        client.queued.push(forwarded);
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

  prepareClientMessage(client, data, isBinary) {
    const message = parseMessage(data, isBinary);
    this.inspectClientMessage(client, data, isBinary);
    if (!client.workspace || message?.method !== 'thread/start') {
      return { data, isBinary };
    }
    const rewritten = {
      ...message,
      params: { ...(message.params || {}), cwd: client.workspace },
    };
    this.diagnostic('proxy.thread.workspace.applied', {
      clientId: client.id,
      workspace: client.workspace,
    });
    return { data: JSON.stringify(rewritten), isBinary: false };
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
      if (client.launchId) {
        this.emit('terminalThread', { launchId: client.launchId, threadId });
      }
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

  launchIdForThread(threadId) {
    return [...this.clients].find((client) => (
      !client.closed && client.threadId === threadId && client.launchId
    ))?.launchId || null;
  }

  threadIdForLaunch(launchId) {
    return [...this.clients].find((client) => (
      !client.closed && client.launchId === launchId && client.threadId
    ))?.threadId || null;
  }

  runtimeClientForThread(threadId) {
    const matches = [...this.clients].filter((client) => (
      !client.closed
      && client.threadId === threadId
      && Number.isInteger(client.clientPort)
      && client.clientPort > 0
      && Number.isInteger(client.serverPort)
      && client.serverPort > 0
    ));
    if (matches.length !== 1) return null;
    return {
      clientPort: matches[0].clientPort,
      serverPort: matches[0].serverPort,
    };
  }

  stop() {
    for (const client of [...this.clients]) {
      this.disconnectClient(client);
    }
    for (const launchServer of this.launchServers) {
      launchServer.close();
    }
    this.launchServers.clear();
    this.server?.close();
    this.server = null;
    this.actualPort = null;
  }
}
