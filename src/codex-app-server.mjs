import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createInterface } from 'node:readline';
import { RelayWebSocketProxy } from './websocket-proxy.mjs';

export const SHARED_CODEX_ENDPOINT = 'ws://127.0.0.1:4769';
export const CODEX_APP_SERVER_ENDPOINT = 'ws://127.0.0.1:4770';

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export class CodexAppServerError extends Error {
  constructor(message, { cancelled = false } = {}) {
    super(message);
    this.name = 'CodexAppServerError';
    this.cancelled = cancelled;
  }
}

function sourceLabel(source) {
  if (typeof source === 'string') {
    return source;
  }
  if (source && typeof source === 'object') {
    return Object.keys(source)[0] || 'unknown';
  }
  return 'unknown';
}

export function normalizeThread(thread) {
  const preview = typeof thread.preview === 'string'
    ? thread.preview.replace(/\s+/g, ' ').trim().slice(0, 240)
    : '';
  const title = typeof thread.name === 'string' && thread.name.trim()
    ? thread.name.trim()
    : preview || `Codex session ${thread.id.slice(0, 8)}`;

  return {
    id: thread.id,
    provider: 'codex',
    sessionId: thread.sessionId ?? thread.id,
    title,
    preview,
    cwd: thread.cwd,
    source: sourceLabel(thread.source),
    status: thread.status?.type || 'idle',
    connectedToSharedServer: true,
    updatedAt: thread.updatedAt ?? null,
  };
}

function itemMessage(item, phase) {
  if (!item) {
    return `Codex item ${phase}.`;
  }
  if (item.type === 'agentMessage') {
    return item.text || `Agent message ${phase}.`;
  }
  if (item.type === 'commandExecution') {
    const command = item.command || item.commands?.join(' ') || 'command';
    return `${phase === 'started' ? 'Running' : 'Command completed'}: ${command}`;
  }
  if (item.type === 'fileChange') {
    return `File change ${phase}.`;
  }
  return `${item.type || 'Codex item'} ${phase}.`;
}

export function notificationMessage(method, params) {
  if (method === 'item/reasoning/summaryTextDelta') {
    return 'Codex reasoning summary updated.';
  }
  if (method === 'item/started') {
    return itemMessage(params.item, 'started');
  }
  if (method === 'item/completed') {
    return itemMessage(params.item, 'completed');
  }
  if (method === 'turn/started') {
    return 'Codex started the turn.';
  }
  if (method === 'turn/completed') {
    return `Codex turn ${params.turn?.status || 'completed'}.`;
  }
  if (method === 'error') {
    return params.error?.message || params.message || 'Codex reported an error.';
  }
  return method;
}

function shouldStoreNotification(method) {
  return method === 'item/reasoning/summaryTextDelta'
    || method === 'item/started'
    || method === 'item/completed'
    || method === 'turn/started'
    || method === 'turn/completed'
    || method === 'error';
}

function socketData(event) {
  if (typeof event.data === 'string') {
    return event.data;
  }
  if (event.data instanceof ArrayBuffer) {
    return Buffer.from(event.data).toString('utf8');
  }
  return String(event.data);
}

export class CodexAppServer extends EventEmitter {
  constructor({
    command = 'codex',
    endpoint = CODEX_APP_SERVER_ENDPOINT,
    publicEndpoint = SHARED_CODEX_ENDPOINT,
    spawnProcess = spawn,
    webSocketFactory = (url) => new WebSocket(url),
    proxy = null,
    diagnostic = () => {},
  } = {}) {
    super();
    this.command = command;
    this.endpoint = endpoint;
    this.publicEndpoint = publicEndpoint;
    this.spawnProcess = spawnProcess;
    this.webSocketFactory = webSocketFactory;
    this.diagnostic = diagnostic;
    this.proxy = proxy || new RelayWebSocketProxy({ target: endpoint, diagnostic });
    this.child = null;
    this.socket = null;
    this.stdoutLines = null;
    this.stderrLines = null;
    this.nextRequestId = 1;
    this.pending = new Map();
    this.startPromise = null;
    this.connected = false;
    this.codexHome = null;
    this.userAgent = null;
    this.lastError = null;
    this.activeTurns = new Map();
    this.proxy.on('changed', () => this.emit('threads'));
    this.proxy.on('error', (error) => this.emit('stderr', `Shared Codex proxy error: ${error.message}`));
    this.proxy.on('clientError', (error) => this.emit('stderr', `Connected Codex client error: ${error.message}`));
  }

  status() {
    return {
      connected: this.connected,
      endpoint: this.publicEndpoint,
      launchCommand: `codex --dangerously-bypass-approvals-and-sandbox --remote ${this.publicEndpoint}`,
      userAgent: this.userAgent,
      codexHome: this.codexHome,
      error: this.lastError,
    };
  }

  async start() {
    if (this.connected) {
      return this.status();
    }
    if (this.startPromise) {
      return this.startPromise;
    }

    this.startPromise = this.startProcess();
    try {
      return await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  async startProcess() {
    this.diagnostic('appserver.start.requested', { endpoint: this.endpoint, publicEndpoint: this.publicEndpoint });
    const child = this.spawnProcess(
      this.command,
      ['-c', 'allow_login_shell=false', 'app-server', '--listen', this.endpoint],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    this.child = child;
    this.stdoutLines = createInterface({ input: child.stdout });
    this.stderrLines = createInterface({ input: child.stderr });

    this.stdoutLines.on('line', (line) => this.emit('stderr', line));
    this.stderrLines.on('line', (line) => this.emit('stderr', line));
    child.once('error', (error) => this.handleProcessExit(
      `Could not start shared Codex app-server: ${error.message}`,
      child,
    ));
    child.once('close', (code, signal) => {
      const suffix = signal ? ` after ${signal}` : ` with code ${code}`;
      this.handleProcessExit(`Shared Codex app-server stopped${suffix}.`, child);
    });

    try {
      const socket = await this.connectWithRetry(child);
      this.socket = socket;
      socket.addEventListener('message', (event) => this.handleLine(socketData(event)));
      socket.addEventListener('close', () => this.handleSocketExit(
        'Relay lost its connection to the shared Codex app-server.',
        socket,
      ));
      socket.addEventListener('error', () => {
        this.emit('stderr', 'Relay WebSocket reported an app-server connection error.');
      });

      const initialized = this.request('initialize', {
        clientInfo: {
          name: 'relay',
          title: 'Relay',
          version: '0.2.0',
        },
        capabilities: { experimentalApi: true },
      }, 20_000);
      this.notify('initialized', {});
      const response = await initialized;
      await this.proxy.start();
      this.connected = true;
      this.codexHome = response.codexHome;
      this.userAgent = response.userAgent;
      this.lastError = null;
      this.emit('status', this.status());
      this.diagnostic('appserver.ready', { endpoint: this.endpoint, userAgent: this.userAgent });
      return this.status();
    } catch (error) {
      this.diagnostic('appserver.start.failed', { error: error.message });
      this.lastError = error.message;
      this.stopProcess();
      throw error;
    }
  }

  async connectWithRetry(child) {
    const deadline = Date.now() + 15_000;
    let lastError = null;

    while (Date.now() < deadline && this.child === child) {
      try {
        return await this.openSocket();
      } catch (error) {
        lastError = error;
        await delay(100);
      }
    }

    throw new CodexAppServerError(
      this.lastError || lastError?.message || `Could not connect to ${this.endpoint}.`,
    );
  }

  openSocket() {
    return new Promise((resolve, reject) => {
      const socket = this.webSocketFactory(this.endpoint);
      const timeout = setTimeout(() => {
        socket.close();
        reject(new CodexAppServerError(`Timed out connecting to ${this.endpoint}.`));
      }, 1_000);

      socket.addEventListener('open', () => {
        clearTimeout(timeout);
        resolve(socket);
      }, { once: true });
      socket.addEventListener('error', () => {
        clearTimeout(timeout);
        reject(new CodexAppServerError(`Could not connect to ${this.endpoint}.`));
      }, { once: true });
    });
  }

  request(method, params = {}, timeoutMs = 30_000) {
    if (!this.socket || this.socket.readyState !== 1) {
      this.diagnostic('appserver.request.rejected', { method, reason: 'not-connected' });
      return Promise.reject(new CodexAppServerError('Relay is not connected to the shared Codex app-server.'));
    }

    const id = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(String(id));
        this.diagnostic('appserver.request.timeout', { id, method, timeoutMs });
        reject(new CodexAppServerError(`Codex app-server request timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(String(id), { method, resolve, reject, timer });
      this.diagnostic('appserver.request.sent', {
        id,
        method,
        threadId: params.threadId,
        model: params.model,
        effort: params.effort,
      });
      this.write({ id, method, params });
    });
  }

  notify(method, params = {}) {
    this.write({ method, params });
  }

  write(message) {
    this.socket.send(JSON.stringify(message));
  }

  handleLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch (error) {
      this.emit('stderr', `Could not parse app-server output: ${error.message}`);
      return;
    }

    if (message.id != null && !message.method) {
      const pending = this.pending.get(String(message.id));
      if (!pending) {
        return;
      }
      clearTimeout(pending.timer);
      this.pending.delete(String(message.id));
      if (message.error) {
        this.diagnostic('appserver.request.failed', { id: message.id, method: pending.method, error: message.error.message });
        pending.reject(new CodexAppServerError(
          message.error.message || `${pending.method} failed.`,
        ));
      } else {
        this.diagnostic('appserver.request.completed', { id: message.id, method: pending.method });
        pending.resolve(message.result);
      }
      return;
    }

    if (message.id != null && message.method) {
      this.handleServerRequest(message);
      return;
    }

    if (message.method) {
      this.handleNotification(message.method, message.params || {});
    }
  }

  handleServerRequest(message) {
    const cancellableApprovals = new Set([
      'item/commandExecution/requestApproval',
      'item/fileChange/requestApproval',
      'applyPatchApproval',
      'execCommandApproval',
    ]);

    if (cancellableApprovals.has(message.method)) {
      this.write({ id: message.id, result: { decision: 'cancel' } });
      return;
    }
    if (message.method === 'item/tool/requestUserInput') {
      this.write({ id: message.id, result: { answers: {} } });
      return;
    }
    if (message.method === 'mcpServer/elicitation/request') {
      this.write({ id: message.id, result: { action: 'cancel' } });
      return;
    }

    this.write({
      id: message.id,
      error: { code: -32601, message: `Relay cannot answer server request: ${message.method}` },
    });
  }

  handleNotification(method, params) {
    this.emit('notification', { method, params });
    const active = this.activeTurns.get(params.threadId);
    if (!active) {
      return;
    }
    if (active.turnId && params.turnId && params.turnId !== active.turnId) {
      return;
    }

    if (method === 'item/reasoning/summaryPartAdded') {
      const summaries = active.reasoningSummaries.get(params.itemId) || [];
      summaries[params.summaryIndex] ||= '';
      active.reasoningSummaries.set(params.itemId, summaries);
      return;
    }
    if (method === 'item/reasoning/summaryTextDelta') {
      const summaries = active.reasoningSummaries.get(params.itemId) || [];
      summaries[params.summaryIndex] = `${summaries[params.summaryIndex] || ''}${params.delta || ''}`;
      active.reasoningSummaries.set(params.itemId, summaries);
      active.onEvent({
        event: {
          type: 'item/updated',
          threadId: params.threadId,
          turnId: params.turnId,
          item: {
            id: params.itemId,
            type: 'reasoning',
            status: 'inProgress',
            summary: summaries.map((text) => ({ text })),
          },
        },
        message: notificationMessage(method, params),
      });
      return;
    }
    if (method === 'item/completed' && params.item?.type === 'agentMessage') {
      active.finalResponse = params.item.text || active.finalResponse;
    }
    if (shouldStoreNotification(method)) {
      active.onEvent({
        event: { type: method, ...params },
        message: notificationMessage(method, params),
      });
    }
    if (method === 'turn/completed') {
      if (!active.turnId) {
        active.earlyCompletion = params;
      } else if (params.turn?.id === active.turnId) {
        this.finishActiveTurn(params);
      }
    }
  }

  finishActiveTurn(params) {
    const active = this.activeTurns.get(params.threadId);
    if (!active) {
      return;
    }
    this.activeTurns.delete(active.threadId);
    const { turn } = params;
    const finalItem = [...(turn.items || [])].reverse().find((item) => item.type === 'agentMessage');
    const finalResponse = active.finalResponse || finalItem?.text || '';

    this.releaseSubscription(active).then(() => {
      if (turn.status === 'completed') {
        this.diagnostic('task.codex.turn.completed', { taskId: active.taskId, threadId: active.threadId, turnId: turn.id });
        active.resolve({ finalResponse, sessionId: active.threadId, exitCode: 0 });
        return;
      }
      if (turn.status === 'interrupted') {
        active.reject(new CodexAppServerError('Task cancelled.', { cancelled: active.cancelRequested }));
        return;
      }
      active.reject(new CodexAppServerError(turn.error?.message || `Codex turn ${turn.status}.`));
    });
  }

  async releaseSubscription(active) {
    if (!active.subscribed) {
      return;
    }
    active.subscribed = false;
    try {
      await this.request('thread/unsubscribe', { threadId: active.threadId }, 5_000);
    } catch (error) {
      active.onStderr(`Could not release Relay's Codex thread subscription: ${error.message}`);
    }
  }

  failOutstanding(message) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new CodexAppServerError(message));
    }
    this.pending.clear();
    for (const active of this.activeTurns.values()) {
      active.reject(new CodexAppServerError(message));
    }
    this.activeTurns.clear();
  }

  handleSocketExit(message, socket) {
    if (this.socket !== socket) {
      return;
    }
    this.socket = null;
    this.connected = false;
    this.lastError = message;
    this.proxy.stop();
    this.failOutstanding(message);
    if (this.child) {
      this.child.kill('SIGTERM');
    }
    this.emit('status', this.status());
  }

  handleProcessExit(message, exitedChild) {
    if (this.child && this.child !== exitedChild) {
      return;
    }
    if (!this.child && !this.connected && this.pending.size === 0 && this.activeTurns.size === 0) {
      return;
    }
    this.child = null;
    this.connected = false;
    this.lastError = message;
    this.proxy.stop();
    const socket = this.socket;
    this.socket = null;
    if (socket?.readyState === 0 || socket?.readyState === 1) {
      socket.close();
    }
    this.failOutstanding(message);
    this.emit('status', this.status());
  }

  async listConnectedThreads() {
    await this.start();
    const threads = await Promise.all(this.proxy.listConnectedThreadIds().map(async (threadId) => {
      try {
        const response = await this.request('thread/read', { threadId, includeTurns: false });
        return normalizeThread(response.thread);
      } catch (error) {
        this.emit('stderr', `Could not read shared Codex thread ${threadId}: ${error.message}`);
        return null;
      }
    }));

    const connected = threads
      .filter(Boolean)
      .filter((thread) => !thread.source.toLowerCase().includes('subagent'))
      .sort((left, right) => (right.updatedAt || 0) - (left.updatedAt || 0));
    this.diagnostic('threads.discovery.completed', {
      proxyThreadIds: this.proxy.listConnectedThreadIds(),
      threads: connected.map((thread) => ({ id: thread.id, cwd: thread.cwd, status: thread.status })),
    });
    return connected;
  }

  async listModels() {
    await this.start();
    const models = [];
    let cursor = null;
    do {
      const response = await this.request('model/list', {
        cursor,
        limit: 100,
        includeHidden: false,
      });
      models.push(...response.data.filter((model) => !model.hidden));
      cursor = response.nextCursor;
    } while (cursor);
    return models;
  }

  async readConnectedThread(threadId) {
    const threads = await this.listConnectedThreads();
    return threads.find((thread) => thread.id === threadId) || null;
  }

  async waitForIdleThread(threadId, active) {
    let announced = false;
    let checks = 0;
    while (!active.cancelRequested) {
      const response = await this.request('thread/read', { threadId, includeTurns: false });
      const state = response.thread.status?.type;
      if (state !== 'active') {
        this.diagnostic('task.codex.thread.idle', { taskId: active.taskId, threadId, checks, state });
        return;
      }
      checks += 1;
      if (!announced) {
        this.diagnostic('task.codex.waiting_for_idle', { taskId: active.taskId, threadId, state });
        active.onEvent({
          event: { type: 'relay/waitingForIdle', threadId },
          message: 'Waiting for the connected Codex terminal to become idle.',
        });
        announced = true;
      }
      if (checks % 10 === 0) {
        this.diagnostic('task.codex.still_waiting_for_idle', { taskId: active.taskId, threadId, checks, state });
      }
      await delay(1_000);
    }
    throw new CodexAppServerError('Task cancelled.', { cancelled: true });
  }

  async pollActiveTurn(active) {
    while (this.activeTurns.get(active.threadId) === active && active.turnId) {
      await delay(1_000);
      if (this.activeTurns.get(active.threadId) !== active) {
        return;
      }
      try {
        const response = await this.request('thread/read', {
          threadId: active.threadId,
          includeTurns: true,
        });
        const turn = response.thread.turns?.find((item) => item.id === active.turnId);
        if (turn && turn.status !== 'inProgress') {
          this.finishActiveTurn({ threadId: active.threadId, turn });
          return;
        }
      } catch (error) {
        active.onStderr(`Could not poll Codex turn state: ${error.message}`);
      }
    }
  }

  async run(task, { onEvent, onStderr }) {
    if (this.activeTurns.has(task.thread_id)) {
      throw new CodexAppServerError('That Codex terminal already has an active Relay turn.');
    }
    if (!task.thread_id) {
      throw new CodexAppServerError('This task does not have a connected Codex thread.');
    }

    const completion = new Promise((resolve, reject) => {
      this.activeTurns.set(task.thread_id, {
        taskId: task.id,
        threadId: task.thread_id,
        turnId: null,
        finalResponse: '',
        reasoningSummaries: new Map(),
        earlyCompletion: null,
        cancelRequested: false,
        subscribed: false,
        onEvent,
        onStderr,
        resolve,
        reject,
      });
    });
    const stderrListener = (line) => this.activeTurns.has(task.thread_id) && onStderr(line);
    this.on('stderr', stderrListener);
    this.diagnostic('task.codex.run.requested', {
      taskId: task.id,
      threadId: task.thread_id,
      repoPath: task.repo_path,
      model: task.model,
      effort: task.effort,
      readOnly: Boolean(task.read_only),
    });

    try {
      await this.start();
      if (!await this.readConnectedThread(task.thread_id)) {
        this.diagnostic('task.codex.thread.missing', { taskId: task.id, threadId: task.thread_id });
        throw new CodexAppServerError('The selected Codex terminal is no longer connected to Relay. Reconnect it and retry.');
      }
      const activeTurn = this.activeTurns.get(task.thread_id);
      await this.waitForIdleThread(task.thread_id, activeTurn);
      if (activeTurn.cancelRequested) {
        throw new CodexAppServerError('Task cancelled.', { cancelled: true });
      }
      const sandbox = task.read_only ? 'read-only' : 'workspace-write';
      try {
        await this.request('thread/resume', {
          threadId: task.thread_id,
          approvalPolicy: 'never',
          sandbox,
          config: { allow_login_shell: false },
        });
        activeTurn.subscribed = true;
        this.diagnostic('task.codex.thread.resumed', { taskId: task.id, threadId: task.thread_id });
      } catch (error) {
        if (!/no rollout found for thread id/i.test(error.message)) {
          throw error;
        }
        this.diagnostic('task.codex.thread.fresh', {
          taskId: task.id,
          threadId: task.thread_id,
        });
      }
      const started = await this.request('turn/start', {
        threadId: task.thread_id,
        input: [
          { type: 'text', text: task.prompt },
          ...(task.attachments || []).map((attachment) => ({
            type: 'localImage',
            path: attachment.path,
          })),
        ],
        approvalPolicy: 'never',
        ...(task.read_only
          ? { sandboxPolicy: { type: 'readOnly', networkAccess: false } }
          : {}),
        ...(task.model ? { model: task.model } : {}),
        ...(task.effort ? { effort: task.effort } : {}),
      });
      if (!this.activeTurns.has(task.thread_id)) {
        throw new CodexAppServerError('Codex turn ended before Relay received its start response.');
      }
      const active = this.activeTurns.get(task.thread_id);
      active.turnId = started.turn.id;
      this.diagnostic('task.codex.turn.started', { taskId: task.id, threadId: task.thread_id, turnId: active.turnId });
      if (active.cancelRequested) {
        this.interruptActiveTurn(active);
      }
      if (active.earlyCompletion?.turn?.id === active.turnId) {
        this.finishActiveTurn(active.earlyCompletion);
      } else {
        this.pollActiveTurn(active).catch((error) => {
          this.activeTurns.get(task.thread_id)?.onStderr(`Codex turn polling stopped: ${error.message}`);
        });
      }
      return await completion;
    } catch (error) {
      this.diagnostic('task.codex.run.failed', { taskId: task.id, threadId: task.thread_id, error: error.message });
      if (this.activeTurns.has(task.thread_id)) {
        const active = this.activeTurns.get(task.thread_id);
        this.activeTurns.delete(task.thread_id);
        await this.releaseSubscription(active);
        active.reject(error);
      }
      completion.catch(() => {});
      throw error;
    } finally {
      this.off('stderr', stderrListener);
    }
  }

  interruptActiveTurn(active) {
    if (!active?.turnId) {
      return;
    }
    this.request('turn/interrupt', {
      threadId: active.threadId,
      turnId: active.turnId,
    }).catch((error) => active.onStderr(`Could not interrupt Codex: ${error.message}`));
  }

  cancel(taskId = null) {
    const active = taskId == null
      ? this.activeTurns.values().next().value
      : [...this.activeTurns.values()].find((turn) => turn.taskId === taskId);
    if (!active) {
      return false;
    }
    active.cancelRequested = true;
    this.interruptActiveTurn(active);
    return true;
  }

  stopProcess() {
    const socket = this.socket;
    this.socket = null;
    if (socket?.readyState === 0 || socket?.readyState === 1) {
      socket.close();
    }
    this.stdoutLines?.close();
    this.stderrLines?.close();
    if (this.child) {
      this.child.kill('SIGTERM');
    }
    this.proxy.stop();
    this.child = null;
    this.connected = false;
  }

  close() {
    this.stopProcess();
  }
}
