import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createInterface } from 'node:readline';
import {
  providerCommandInvocation,
  resolveExecutableOnPath,
  terminateChildProcess,
} from './claude-binary.mjs';
import { CODEX_UPDATE_PROMPT_OVERRIDE } from './project-launcher.mjs';
import { withRelayNonInteractiveInstruction } from './relay-prompt.mjs';
import { RelayWebSocketProxy } from './websocket-proxy.mjs';

export const SHARED_CODEX_ENDPOINT = 'ws://127.0.0.1:4769';
export const CODEX_APP_SERVER_ENDPOINT = 'ws://127.0.0.1:0';

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export function isFreshThreadPersistenceError(error) {
  const message = error instanceof Error ? error.message : String(error || '');
  return /no rollout found for thread id|rollout(?: at)? .* is empty/i.test(message);
}

export class CodexAppServerError extends Error {
  constructor(message, { cancelled = false, retryable = true } = {}) {
    super(message);
    this.name = 'CodexAppServerError';
    this.cancelled = cancelled;
    this.retryable = retryable;
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

// POSIX gets a process-group kill because the app-server is spawned detached. Windows has no
// process groups, and the spawned child may be cmd.exe wrapping the codex shim, so the whole
// tree is killed there instead. Leaving the real app-server alive would keep the shared
// WebSocket port bound and the next CC Relay start would talk to a stale server.
function terminateProcessTree(child, signal = 'SIGTERM', platform = process.platform) {
  if (!child) {
    return false;
  }
  if (platform !== 'win32' && Number.isInteger(child.pid)) {
    try {
      process.kill(-child.pid, signal);
      return true;
    } catch {}
  }
  return terminateChildProcess(child, { signal, platform });
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
  if (item.type === 'subAgentActivity') {
    const agent = String(item.agentPath || item.agentThreadId || 'sub-agent').split(/[\\/]/).filter(Boolean).at(-1);
    if (item.kind === 'started') {
      return `Codex started sub-agent "${agent}".`;
    }
    if (item.kind === 'interacted') {
      return `Codex recorded activity for sub-agent "${agent}".`;
    }
    if (item.kind === 'interrupted') {
      return `Sub-agent "${agent}" was interrupted.`;
    }
  }
  if (item.type === 'collabAgentToolCall' && item.tool === 'spawnAgent') {
    return phase === 'started' ? 'Codex is starting a sub-agent.' : 'Codex started a sub-agent.';
  }
  return `${item.type || 'Codex item'} ${phase}.`;
}

const PLAN_STEP_STATUSES = new Set(['pending', 'inProgress', 'completed']);

// Plan steps, explanations, and goal objectives are provider text rendered as single-line
// rows, so whitespace is collapsed the same way connected thread previews are.
function singleLineText(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

// Codex reports an absent token budget as null. Number() would turn that into a real 0 budget,
// so only finite numbers survive and everything else stays null.
function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

// Codex declares the goal timestamps as `int64` with no unit and reports them as epoch
// integers today, while other Codex surfaces report times as ISO 8601 strings. Both forms are
// therefore kept exactly as they arrived: rewriting an epoch number into a string would mean
// guessing seconds against milliseconds, and reading 1786549797 as milliseconds lands in 1970,
// which would write a wrong date into stored history. A string only survives when it really is
// an ISO 8601 date, so provider free text cannot reach a consumer that calls Date.parse on it.
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

function goalTimestamp(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  const text = singleLineText(value);
  return ISO_TIMESTAMP.test(text) && Number.isFinite(Date.parse(text)) ? text : null;
}

// Codex resends the whole checklist on every revision, so the stored event carries the full
// plan plus a stable planKey that folds every revision of one turn into a single entry.
// Goal-driven threads report plan updates on a second turn-id space, so a missing turn id
// falls back to the thread alone rather than baking "null" into the key.
function normalizePlanParams(params) {
  const threadId = typeof params.threadId === 'string' ? params.threadId : '';
  const turnId = singleLineText(params.turnId) || null;
  const steps = Array.isArray(params.plan) ? params.plan : [];
  return {
    threadId: threadId || null,
    turnId,
    planKey: turnId ? `${threadId}:${turnId}` : threadId,
    explanation: singleLineText(params.explanation),
    plan: steps.map((entry) => ({
      step: singleLineText(entry?.step),
      status: PLAN_STEP_STATUSES.has(entry?.status) ? entry.status : 'pending',
    })),
  };
}

// A goal status CC Relay does not know about is still worth showing, so it is kept as trimmed
// text instead of being forced into a known value the way plan step statuses are.
function normalizeGoalParams(params) {
  const goal = params.goal && typeof params.goal === 'object' ? params.goal : {};
  return {
    threadId: typeof params.threadId === 'string' ? params.threadId : null,
    turnId: singleLineText(params.turnId) || null,
    goal: {
      objective: singleLineText(goal.objective),
      status: singleLineText(goal.status),
      tokenBudget: finiteNumber(goal.tokenBudget),
      tokensUsed: finiteNumber(goal.tokensUsed),
      timeUsedSeconds: finiteNumber(goal.timeUsedSeconds),
      createdAt: goalTimestamp(goal.createdAt),
      updatedAt: goalTimestamp(goal.updatedAt),
    },
  };
}

// The objective and the status are the two fields that name a goal and its state, so a
// normalized goal carrying neither describes nothing an operator can read. That is exactly
// what a notification with a missing, null, or wrongly typed `goal` object normalizes to:
// every field blanks and the usage numbers land as null or as a bare 0. Codex resends the
// whole goal on every update, so such a record is a malformed report rather than a usage-only
// tick, and it must never become the goal a turn closes on.
function describesGoal(goal) {
  return Boolean(goal?.objective) || Boolean(goal?.status);
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
  if (method === 'turn/plan/updated') {
    const { plan } = normalizePlanParams(params);
    if (plan.length === 0) {
      return 'Codex updated its plan.';
    }
    const completed = plan.filter((entry) => entry.status === 'completed').length;
    const progress = `Codex updated its plan (${completed}/${plan.length} steps done)`;
    const current = plan.find((entry) => entry.status === 'inProgress')?.step;
    return current ? `${progress}: ${current}` : `${progress}.`;
  }
  if (method === 'thread/goal/updated') {
    const { goal } = normalizeGoalParams(params);
    const label = goal.status ? `Codex goal ${goal.status}` : 'Codex goal updated';
    // The turn-final replay repeats a goal state the log already showed, so it names itself
    // rather than reading as a second, later report from Codex.
    const scoped = params.turnEnded === true ? `${label} as the turn ended` : label;
    return goal.objective ? `${scoped}: ${goal.objective}` : `${scoped}.`;
  }
  if (method === 'thread/goal/cleared') {
    return 'Codex cleared the thread goal.';
  }
  return method;
}

// Plan and goal notifications are deliberately absent here. They are stored by their own
// branches in handleNotification, which run above the turn guard and return immediately, so
// listing them again would store a second unnormalized copy of every notification.
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

export function advertisedWebSocketEndpoint(line) {
  const match = String(line || '').match(/\blistening on:\s*(ws:\/\/[^\s]+)/i);
  return match?.[1] || null;
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
    freshThreadRetryDelayMs = 100,
    terminateProcess = terminateProcessTree,
    platform = process.platform,
    resolveExecutable = resolveExecutableOnPath,
  } = {}) {
    super();
    this.command = command;
    this.platform = platform;
    this.resolveExecutable = resolveExecutable;
    this.endpoint = endpoint;
    this.publicEndpoint = publicEndpoint;
    this.spawnProcess = spawnProcess;
    this.webSocketFactory = webSocketFactory;
    this.diagnostic = diagnostic;
    this.freshThreadRetryDelayMs = freshThreadRetryDelayMs;
    this.terminateProcess = terminateProcess;
    const publicUrl = new URL(publicEndpoint);
    this.proxy = proxy || new RelayWebSocketProxy({
      host: publicUrl.hostname,
      port: Number(publicUrl.port),
      target: endpoint,
      diagnostic,
    });
    this.child = null;
    this.socket = null;
    this.stdoutLines = null;
    this.stderrLines = null;
    this.nextRequestId = 1;
    this.nextSteerId = 1;
    this.pending = new Map();
    this.startPromise = null;
    this.connected = false;
    this.codexHome = null;
    this.userAgent = null;
    this.lastError = null;
    this.activeTurns = new Map();
    this.cachedThreads = [];
    this.threadsCachedAt = 0;
    this.threadsCacheMs = 750;
    this.threadsPending = null;
    this.threadsStale = false;
    this.cachedModels = null;
    this.modelsCachedAt = 0;
    this.modelsCacheMs = 60_000;
    this.modelsPending = null;
    this.proxy.on('changed', () => this.emit('threads'));
    this.proxy.on('error', (error) => this.emit('stderr', `Shared Codex proxy error: ${error.message}`));
    this.proxy.on('clientError', (error) => this.emit('stderr', `Connected Codex client error: ${error.message}`));
  }

  status() {
    return {
      connected: this.connected,
      endpoint: this.publicEndpoint,
      // The update-prompt override comes from project-launcher.mjs so this command cannot drift from
      // CODEX_RELAY_COMMAND: a pending Codex release otherwise blocks the interactive TUI before it
      // dials --remote.
      launchCommand: `codex --dangerously-bypass-approvals-and-sandbox --cd . --remote ${this.publicEndpoint} ${CODEX_UPDATE_PROMPT_OVERRIDE}`,
      userAgent: this.userAgent,
      codexHome: this.codexHome,
      error: this.lastError,
    };
  }

  reserveLaunchClient(workspace, launchId) {
    return this.proxy.reserveLaunchClient(workspace, launchId);
  }

  runtimeClientForThread(threadId) {
    return this.proxy.runtimeClientForThread?.(threadId) || null;
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
    const dynamicEndpoint = new URL(this.endpoint).port === '0';
    // On Windows the bare `codex` name resolves to nothing: PATH search only appends `.com` and
    // `.exe`, while a normal install leaves `codex.cmd`. Resolve it to a real file first, then
    // shape the invocation so a shim runs through cmd.exe without flashing a console window.
    const resolvedCommand = this.resolveExecutable(this.command, { platform: this.platform });
    const invocation = providerCommandInvocation(
      resolvedCommand,
      ['-c', 'allow_login_shell=false', 'app-server', '--listen', this.endpoint],
      { platform: this.platform },
    );
    const child = this.spawnProcess(
      invocation.command,
      invocation.args,
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: this.platform !== 'win32',
        ...invocation.options,
      },
    );
    this.child = child;
    this.stdoutLines = createInterface({ input: child.stdout });
    this.stderrLines = createInterface({ input: child.stderr });

    let settleAdvertisedEndpoint = () => {};
    const endpointReady = dynamicEndpoint
      ? new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new CodexAppServerError('Codex app-server did not advertise its listening endpoint.'));
        }, 15_000);
        settleAdvertisedEndpoint = (error, endpoint) => {
          clearTimeout(timeout);
          if (error) reject(error);
          else resolve(endpoint);
        };
      })
      : Promise.resolve(this.endpoint);
    const handleProcessLine = (line) => {
      const advertisedEndpoint = advertisedWebSocketEndpoint(line);
      const startupMetadata = advertisedEndpoint
        || /^\s*(?:codex app-server \(WebSockets\)|readyz:|healthz:|note: binds localhost only)/i.test(line);
      if (!startupMetadata) {
        this.emit('stderr', line);
      }
      if (dynamicEndpoint && advertisedEndpoint) {
        settleAdvertisedEndpoint(null, advertisedEndpoint);
        settleAdvertisedEndpoint = () => {};
      }
    };
    this.stdoutLines.on('line', handleProcessLine);
    this.stderrLines.on('line', handleProcessLine);
    child.once('error', (error) => {
      const message = `Could not start shared Codex app-server: ${error.message}`;
      settleAdvertisedEndpoint(new CodexAppServerError(message));
      settleAdvertisedEndpoint = () => {};
      this.handleProcessExit(message, child);
    });
    child.once('close', (code, signal) => {
      const suffix = signal ? ` after ${signal}` : ` with code ${code}`;
      settleAdvertisedEndpoint(new CodexAppServerError(`Shared Codex app-server stopped${suffix}.`));
      settleAdvertisedEndpoint = () => {};
      this.handleProcessExit(`Shared Codex app-server stopped${suffix}.`, child);
    });

    try {
      const activeEndpoint = await endpointReady;
      this.diagnostic('appserver.endpoint.ready', { configuredEndpoint: this.endpoint, activeEndpoint });
      this.proxy.target = activeEndpoint;
      const socket = await this.connectWithRetry(child, activeEndpoint);
      this.socket = socket;
      socket.addEventListener('message', (event) => this.handleLine(socketData(event)));
      socket.addEventListener('close', () => this.handleSocketExit(
        'CC Relay lost its connection to the shared Codex app-server.',
        socket,
      ));
      socket.addEventListener('error', () => {
        this.emit('stderr', 'CC Relay WebSocket reported an app-server connection error.');
      });

      const initialized = this.request('initialize', {
        clientInfo: {
          name: 'relay',
          title: 'CC Relay',
          version: '0.2.0',
        },
        capabilities: { experimentalApi: true },
      }, 20_000);
      this.notify('initialized', {});
      const response = await initialized;
      const publicEndpoint = await this.proxy.start();
      if (publicEndpoint) this.publicEndpoint = publicEndpoint;
      this.connected = true;
      this.codexHome = response.codexHome;
      this.userAgent = response.userAgent;
      this.lastError = null;
      this.emit('status', this.status());
      this.diagnostic('appserver.ready', {
        endpoint: activeEndpoint,
        publicEndpoint: this.publicEndpoint,
        userAgent: this.userAgent,
      });
      return this.status();
    } catch (error) {
      this.diagnostic('appserver.start.failed', { error: error.message });
      this.lastError = error.message;
      this.stopProcess();
      throw error;
    }
  }

  async connectWithRetry(child, endpoint = this.endpoint) {
    const deadline = Date.now() + 15_000;
    let lastError = null;

    while (Date.now() < deadline && this.child === child) {
      try {
        return await this.openSocket(endpoint);
      } catch (error) {
        lastError = error;
        await delay(100);
      }
    }

    throw new CodexAppServerError(
      this.lastError || lastError?.message || `Could not connect to ${endpoint}.`,
    );
  }

  openSocket(endpoint = this.endpoint) {
    return new Promise((resolve, reject) => {
      const socket = this.webSocketFactory(endpoint);
      const timeout = setTimeout(() => {
        socket.close();
        reject(new CodexAppServerError(`Timed out connecting to ${endpoint}.`));
      }, 1_000);

      socket.addEventListener('open', () => {
        clearTimeout(timeout);
        resolve(socket);
      }, { once: true });
      socket.addEventListener('error', () => {
        clearTimeout(timeout);
        reject(new CodexAppServerError(`Could not connect to ${endpoint}.`));
      }, { once: true });
    });
  }

  request(method, params = {}, timeoutMs = 30_000) {
    if (!this.socket || this.socket.readyState !== 1) {
      this.diagnostic('appserver.request.rejected', { method, reason: 'not-connected' });
      return Promise.reject(new CodexAppServerError('CC Relay is not connected to the shared Codex app-server.'));
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
        threadId: params?.threadId,
        model: params?.model,
        effort: params?.effort,
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
      this.emitUserInputRequested(message);
      this.write({ id: message.id, result: { answers: {} } });
      return;
    }
    if (message.method === 'mcpServer/elicitation/request') {
      this.emitUserInputRequested(message);
      this.write({ id: message.id, result: { action: 'cancel' } });
      return;
    }

    this.write({
      id: message.id,
      error: { code: -32601, message: `CC Relay cannot answer server request: ${message.method}` },
    });
  }

  emitUserInputRequested(message) {
    const params = message.params || {};
    this.diagnostic('task.codex.input_requested', {
      requestId: message.id,
      method: message.method,
      threadId: params.threadId,
      turnId: params.turnId,
      itemId: params.itemId,
    });
    this.emit('userInputRequested', {
      requestId: message.id,
      method: message.method,
      threadId: params.threadId || null,
      turnId: params.turnId || null,
      itemId: params.itemId || null,
      params,
    });
  }

  handleNotification(method, params) {
    this.emit('notification', { method, params });
    const active = this.activeTurns.get(params.threadId);
    if (!active) {
      return;
    }

    // Plan and goal updates are routed by thread alone, above the turn guard. A thread that
    // carries a goal reports them on a second turn-id space, so the guard below would drop
    // every plan and goal update on exactly the threads that have a goal. Each branch returns
    // so the generic store path cannot emit a second event for the same notification.
    if (method === 'turn/plan/updated') {
      active.onEvent({
        event: { type: method, ...normalizePlanParams(params) },
        message: notificationMessage(method, params),
      });
      return;
    }
    if (method === 'thread/goal/updated') {
      // A goal belongs to the thread, not to the turn, so every goal update that lands after
      // the turn finished is dropped by the `active` guard above. The last goal that named an
      // objective or a status is kept here so finishActiveTurn can close the row with a real
      // record. A goal update that names neither is still logged verbatim below, because Codex
      // output is reported as it arrived, but it cannot become the turn's last word: Task
      // Activity folds every goal event into one row, so replaying a blank record as the turn
      // ends would erase a real objective and its usage behind a bare "Recorded" label, and
      // that record is the one nothing can revise afterwards.
      const payload = normalizeGoalParams(params);
      if (describesGoal(payload.goal)) {
        active.lastGoalPayload = payload;
      }
      active.onEvent({
        event: { type: method, ...payload },
        message: notificationMessage(method, params),
      });
      return;
    }
    if (method === 'thread/goal/cleared') {
      // A cleared goal already resolves its row, so the turn end has nothing left to record.
      active.lastGoalPayload = null;
      active.onEvent({
        event: { type: method, threadId: params.threadId },
        message: notificationMessage(method, params),
      });
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
    if (method === 'thread/tokenUsage/updated') {
      active.tokenUsage = params.tokenUsage || null;
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
        event: {
          type: method,
          ...params,
          ...(method === 'turn/completed' && active.tokenUsage ? { tokenUsage: active.tokenUsage } : {}),
        },
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
    this.recordTurnFinalGoal(active);
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

  // Task Activity folds every goal event on a thread into one row, so a goal last reported as
  // `active` keeps describing live work long after the turn that reported it is gone. The last
  // goal Codex reported during the turn is replayed once as the turn ends, flagged
  // `turnEnded`, so the stored history closes on a record that cannot change again. Codex is
  // never second-guessed: the status it last reported is replayed verbatim, and a goal that was
  // cleared or never seen during the turn records nothing.
  //
  // Once per turn needs no flag on the record. finishActiveTurn is the only caller, and it
  // reads the record out of `activeTurns` and deletes it, so the second finish of one turn (the
  // turn/completed notification and the one-second poll both call it) finds nothing to replay.
  // Nothing re-enters finishActiveTurn synchronously from inside the replay either: its other
  // two call sites sit after awaits, and the only synchronous one is the socket message
  // dispatch. A second turn on the same thread is a second `run`, which builds a fresh record,
  // so it replays its own goal rather than inheriting a spent guard.
  recordTurnFinalGoal(active) {
    if (!active?.lastGoalPayload) {
      return;
    }
    const payload = { ...active.lastGoalPayload, turnEnded: true };
    active.onEvent({
      event: { type: 'thread/goal/updated', ...payload },
      message: notificationMessage('thread/goal/updated', payload),
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
      active.onStderr(`Could not release CC Relay's Codex thread subscription: ${error.message}`);
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
      this.terminateProcess(this.child, 'SIGTERM', this.platform);
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

  // Discovery is one `thread/read` round trip per connected terminal, so it must not sit on
  // the task-add path uncached. Concurrent callers share one discovery and a failed
  // discovery keeps the last known good list rather than reporting zero terminals.
  async listConnectedThreads({ refresh = false } = {}) {
    if (!refresh && Date.now() - this.threadsCachedAt < this.threadsCacheMs) {
      return this.cachedThreads;
    }
    // A forced refresh joins a discovery that is already in flight rather than starting a
    // second one. That discovery reads live state at the moment it resolves, so the caller
    // still gets current data; the only thing it gives up is control over when the read
    // started. This is deliberate: dispatch and the 800 ms liveness poll can both ask at once,
    // and starting a probe per caller is what produced the spawn storm in the first place.
    if (this.threadsPending) return this.threadsPending;
    this.threadsPending = this.discoverConnectedThreads()
      .then((threads) => {
        this.cachedThreads = threads;
        this.threadsCachedAt = Date.now();
        this.threadsStale = false;
        return threads;
      })
      .catch((error) => {
        this.threadsCachedAt = Date.now();
        this.threadsStale = true;
        this.lastError = error.message;
        return this.cachedThreads;
      })
      .finally(() => {
        this.threadsPending = null;
      });
    return this.threadsPending;
  }

  // Add-path lookup: warm cache only, never forces a cold round trip per connected terminal.
  async findConnectedThread(threadId) {
    const threads = await this.listConnectedThreads();
    return threads.find((thread) => thread.id === threadId) || null;
  }

  knownThread(threadId) {
    return this.cachedThreads.find((thread) => thread.id === threadId) || null;
  }

  threadIdForLaunch(launchId) {
    return this.proxy.threadIdForLaunch?.(launchId) || null;
  }

  async discoverConnectedThreads() {
    await this.start();
    const threads = await Promise.all(this.proxy.listConnectedThreadIds().map(async (threadId) => {
      try {
        const response = await this.request('thread/read', { threadId, includeTurns: false });
        return {
          ...normalizeThread(response.thread),
          launchId: this.proxy.launchIdForThread?.(threadId) || null,
        };
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

  // The app-server owns ChatGPT authentication and returns the same subscription windows that
  // Codex renders itself. Keeping this request here means CC Relay never reads or stores an auth
  // token, and the status endpoint can consume a cached monitor snapshot instead of doing I/O.
  async readRateLimits() {
    await this.start();
    return this.request('account/rateLimits/read', null, 10_000);
  }

  // The model list is a paginated JSON-RPC round trip, and every Codex, Plan council, and
  // Turbo submission validates its model against it. Leaving it uncached kept a cold wire
  // round trip (up to the 30s request timeout, more than once when paginated) on the
  // task-add path. Models change rarely, so this caches for a minute, deduplicates
  // concurrent callers, and keeps the last known good list if a refresh fails.
  async listModels({ refresh = false } = {}) {
    if (!refresh && this.cachedModels && Date.now() - this.modelsCachedAt < this.modelsCacheMs) {
      return this.cachedModels;
    }
    if (this.modelsPending) return this.modelsPending;
    this.modelsPending = this.discoverModels()
      .then((models) => {
        this.cachedModels = models;
        this.modelsCachedAt = Date.now();
        return models;
      })
      .catch((error) => {
        if (!this.cachedModels) throw error;
        this.modelsCachedAt = Date.now();
        this.lastError = error.message;
        return this.cachedModels;
      })
      .finally(() => {
        this.modelsPending = null;
      });
    return this.modelsPending;
  }

  async discoverModels() {
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

  // Dispatch-time and liveness lookup: forces current truth before CC Relay drives a terminal.
  async readConnectedThread(threadId) {
    const threads = await this.listConnectedThreads({ refresh: true });
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
        if (isFreshThreadPersistenceError(error)) {
          this.diagnostic('task.codex.turn.poll_deferred', {
            taskId: active.taskId,
            threadId: active.threadId,
            turnId: active.turnId,
            error: error.message,
          });
        } else {
          active.onStderr(`Could not poll Codex turn state: ${error.message}`);
        }
      }
    }
  }

  async subscribeFreshThread(active, baseThreadParams, maximumAttempts = 8) {
    let lastError = null;
    for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
      if (this.activeTurns.get(active.threadId) !== active) {
        return false;
      }
      try {
        await this.request('thread/resume', {
          ...baseThreadParams,
          threadId: active.threadId,
        });
        active.subscribed = true;
        this.diagnostic('task.codex.thread.subscribed_after_start', {
          taskId: active.taskId,
          threadId: active.threadId,
          turnId: active.turnId,
          attempt,
        });
        return true;
      } catch (error) {
        lastError = error;
        if (!isFreshThreadPersistenceError(error)) {
          throw error;
        }
        this.diagnostic('task.codex.thread.subscription_deferred', {
          taskId: active.taskId,
          threadId: active.threadId,
          turnId: active.turnId,
          attempt,
          error: error.message,
        });
        if (attempt < maximumAttempts) {
          await delay(this.freshThreadRetryDelayMs * attempt);
        }
      }
    }
    this.diagnostic('task.codex.thread.subscribe_after_start_unavailable', {
      taskId: active.taskId,
      threadId: active.threadId,
      turnId: active.turnId,
      attempts: maximumAttempts,
      error: lastError?.message,
    });
    return false;
  }

  async run(task, { onEvent, onStderr }) {
    if (this.activeTurns.has(task.thread_id)) {
      throw new CodexAppServerError('That Codex terminal already has an active CC Relay turn.');
    }
    if (!task.thread_id) {
      throw new CodexAppServerError('This task does not have a connected Codex thread.', { retryable: false });
    }

    const completion = new Promise((resolve, reject) => {
      this.activeTurns.set(task.thread_id, {
        taskId: task.id,
        threadId: task.thread_id,
        turnId: null,
        finalResponse: '',
        reasoningSummaries: new Map(),
        lastGoalPayload: null,
        earlyCompletion: null,
        cancelRequested: false,
        subscribed: false,
        onEvent,
        onStderr,
        resolve,
        reject,
      });
    });
    const stderrListener = (line) => (
      [...this.activeTurns.values()].some((turn) => turn.taskId === task.id) && onStderr(line)
    );
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
        throw new CodexAppServerError(
          'The selected Codex terminal is no longer connected to CC Relay. Reconnect it and retry.',
          { retryable: false },
        );
      }
      const activeTurn = this.activeTurns.get(task.thread_id);
      if (task.sessionFollowUp) {
        const response = await this.request('thread/read', {
          threadId: task.thread_id,
          includeTurns: false,
        });
        if (response.thread.status?.type === 'active') {
          throw new CodexAppServerError('That Codex terminal became busy. Your follow-up was not queued.');
        }
      } else {
        await this.waitForIdleThread(task.thread_id, activeTurn);
      }
      if (activeTurn.cancelRequested) {
        throw new CodexAppServerError('Task cancelled.', { cancelled: true });
      }
      const sandbox = task.read_only ? 'read-only' : 'danger-full-access';
      const sandboxPolicy = task.read_only
        ? { type: 'readOnly', networkAccess: false }
        : { type: 'dangerFullAccess' };
      const executionThreadId = task.thread_id;
      let freshThread = false;
      const baseThreadParams = {
        approvalPolicy: 'never',
        sandbox,
        config: { allow_login_shell: false },
      };
      const resumeParams = { ...baseThreadParams, threadId: executionThreadId };
      try {
        await this.request('thread/resume', resumeParams);
        activeTurn.subscribed = true;
        this.diagnostic('task.codex.thread.resumed', { taskId: task.id, threadId: executionThreadId });
      } catch (error) {
        if (!isFreshThreadPersistenceError(error)) {
          throw error;
        }
        this.diagnostic('task.codex.thread.fresh', {
          taskId: task.id,
          threadId: executionThreadId,
        });
        freshThread = true;
      }
      const started = await this.request('turn/start', {
        threadId: executionThreadId,
        input: [
          { type: 'text', text: withRelayNonInteractiveInstruction(task.prompt) },
          ...(task.attachments || []).map((attachment) => ({
            type: 'localImage',
            path: attachment.path,
          })),
        ],
        approvalPolicy: 'never',
        sandboxPolicy,
        ...(task.model ? { model: task.model } : {}),
        ...(task.effort ? { effort: task.effort } : {}),
      });
      if (!this.activeTurns.has(executionThreadId)) {
        throw new CodexAppServerError('Codex turn ended before CC Relay received its start response.');
      }
      const active = this.activeTurns.get(executionThreadId);
      active.turnId = started.turn.id;
      this.diagnostic('task.codex.turn.started', { taskId: task.id, threadId: executionThreadId, turnId: active.turnId });
      if (freshThread) {
        try {
          await this.subscribeFreshThread(active, baseThreadParams);
        } catch (error) {
          active.onStderr(`Could not subscribe to live output for the new Codex thread: ${error.message}`);
          this.diagnostic('task.codex.thread.subscribe_after_start_failed', {
            taskId: task.id,
            threadId: executionThreadId,
            turnId: active.turnId,
            error: error.message,
          });
        }
      }
      if (active.cancelRequested) {
        this.interruptActiveTurn(active);
      }
      if (active.earlyCompletion?.turn?.id === active.turnId) {
        this.finishActiveTurn(active.earlyCompletion);
      } else {
        this.pollActiveTurn(active).catch((error) => {
          this.activeTurns.get(executionThreadId)?.onStderr(`Codex turn polling stopped: ${error.message}`);
        });
      }
      return await completion;
    } catch (error) {
      this.diagnostic('task.codex.run.failed', { taskId: task.id, threadId: task.thread_id, error: error.message });
      const active = [...this.activeTurns.values()].find((turn) => turn.taskId === task.id);
      if (active) {
        this.activeTurns.delete(active.threadId);
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

  async steer(taskId, prompt, attachments = []) {
    const value = typeof prompt === 'string' ? prompt.trim() : '';
    if (!value) {
      throw new CodexAppServerError('Write a follow-up before sending it.');
    }
    const active = [...this.activeTurns.values()].find((turn) => turn.taskId === taskId);
    if (!active?.turnId) {
      throw new CodexAppServerError('That task no longer has an active Codex turn.');
    }
    const clientUserMessageId = `relay-steer-${taskId}-${this.nextSteerId}`;
    this.nextSteerId += 1;
    this.diagnostic('task.codex.steer.requested', {
      taskId,
      threadId: active.threadId,
      turnId: active.turnId,
      clientUserMessageId,
    });
    try {
      const response = await this.request('turn/steer', {
        threadId: active.threadId,
        input: [
          {
            type: 'text',
            text: withRelayNonInteractiveInstruction(value),
            text_elements: [],
          },
          ...attachments.map((attachment) => ({
            type: 'localImage',
            path: attachment.path,
          })),
        ],
        expectedTurnId: active.turnId,
        clientUserMessageId,
      });
      if (response.turnId !== active.turnId) {
        throw new CodexAppServerError('Codex updated a different turn than CC Relay expected.');
      }
      this.diagnostic('task.codex.steer.completed', {
        taskId,
        threadId: active.threadId,
        turnId: active.turnId,
        clientUserMessageId,
      });
      return { taskId, threadId: active.threadId, turnId: active.turnId };
    } catch (error) {
      this.diagnostic('task.codex.steer.failed', {
        taskId,
        threadId: active.threadId,
        turnId: active.turnId,
        error: error.message,
      });
      throw error;
    }
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
      this.terminateProcess(this.child, 'SIGTERM', this.platform);
    }
    this.proxy.stop();
    this.child = null;
    this.connected = false;
  }

  close() {
    this.stopProcess();
  }
}
