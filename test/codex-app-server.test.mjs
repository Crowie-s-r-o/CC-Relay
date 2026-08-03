import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import {
  CodexAppServer,
  CODEX_APP_SERVER_ENDPOINT,
  advertisedWebSocketEndpoint,
  isFreshThreadPersistenceError,
  normalizeThread,
  SHARED_CODEX_ENDPOINT,
} from '../src/codex-app-server.mjs';
import { RELAY_NON_INTERACTIVE_INSTRUCTION } from '../src/relay-prompt.mjs';

const THREAD_ID = '019f6b51-cad9-7582-99fb-e9a6ee76ead2';

class FakeProxy extends EventEmitter {
  constructor(threadIds = [THREAD_ID]) {
    super();
    this.target = null;
    this.threadIds = threadIds;
  }

  async start() {}

  listConnectedThreadIds() {
    return this.threadIds;
  }

  stop() {}
}

function fakeAppServerProcess(endpoint = 'ws://127.0.0.1:61234') {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => {
    queueMicrotask(() => child.emit('close', 0, null));
    return true;
  };
  queueMicrotask(() => child.stderr.write(`codex app-server (WebSockets)\n  listening on: ${endpoint}\n`));
  return child;
}

function messageEvent(message) {
  const event = new Event('message');
  Object.defineProperty(event, 'data', { value: JSON.stringify(message) });
  return event;
}

test('Codex user-input server requests raise terminal attention without changing fallback responses', () => {
  const sent = [];
  const requested = [];
  const diagnostics = [];
  const client = new CodexAppServer({
    proxy: new FakeProxy(),
    diagnostic: (event, fields) => diagnostics.push({ event, fields }),
  });
  client.socket = {
    readyState: 1,
    send: (value) => sent.push(JSON.parse(value)),
    close: () => {},
  };
  client.on('userInputRequested', (request) => requested.push(request));

  try {
    client.handleLine(JSON.stringify({
      id: 91,
      method: 'item/tool/requestUserInput',
      params: {
        threadId: THREAD_ID,
        turnId: 'turn-question',
        itemId: 'item-question',
        questions: [{ id: 'scope', question: 'What should I review?' }],
      },
    }));
    client.handleLine(JSON.stringify({
      id: 92,
      method: 'mcpServer/elicitation/request',
      params: {
        threadId: THREAD_ID,
        turnId: 'turn-question',
        serverName: 'review-helper',
        mode: 'form',
        message: 'Choose the review scope.',
      },
    }));

    assert.deepEqual(sent, [
      { id: 91, result: { answers: {} } },
      { id: 92, result: { action: 'cancel' } },
    ]);
    assert.deepEqual(
      requested.map(({ requestId, method, threadId, turnId, itemId }) => ({
        requestId, method, threadId, turnId, itemId,
      })),
      [
        {
          requestId: 91,
          method: 'item/tool/requestUserInput',
          threadId: THREAD_ID,
          turnId: 'turn-question',
          itemId: 'item-question',
        },
        {
          requestId: 92,
          method: 'mcpServer/elicitation/request',
          threadId: THREAD_ID,
          turnId: 'turn-question',
          itemId: null,
        },
      ],
    );
    assert.equal(
      diagnostics.filter(({ event }) => event === 'task.codex.input_requested').length,
      2,
    );
  } finally {
    client.close();
  }
});

class FakeWebSocket extends EventTarget {
  constructor(received, {
    emitCompletion = true,
    missingRollout = false,
    emptyRolloutAfterStartFailures = 0,
    threadStatus = 'idle',
  } = {}) {
    super();
    this.received = received;
    this.emitCompletion = emitCompletion;
    this.missingRollout = missingRollout;
    this.emptyRolloutAfterStartFailures = emptyRolloutAfterStartFailures;
    this.threadStatus = threadStatus;
    this.turnStarted = false;
    this.readyState = 0;
    queueMicrotask(() => {
      this.readyState = 1;
      this.dispatchEvent(new Event('open'));
    });
  }

  respond(message) {
    queueMicrotask(() => this.dispatchEvent(messageEvent(message)));
  }

  send(value) {
    const message = JSON.parse(value);
    this.received.push(message);

    if (message.method === 'initialize') {
      this.respond({
        id: message.id,
        result: { userAgent: 'relay-test/0.2.0', codexHome: '/tmp/.codex' },
      });
    } else if (message.method === 'thread/read') {
      const completedTurn = {
        id: 'turn-1',
        items: [{ id: 'message-1', type: 'agentMessage', text: 'Task finished.' }],
        status: 'completed',
      };
      this.respond({
        id: message.id,
        result: {
          thread: {
            id: message.params.threadId,
            sessionId: message.params.threadId,
            name: 'CC Relay test thread',
            preview: 'A test session',
            cwd: '/tmp/repository',
            source: 'cli',
            status: { type: this.threadStatus },
            updatedAt: 100,
            turns: message.params.includeTurns && this.turnStarted ? [completedTurn] : undefined,
          },
        },
      });
    } else if (message.method === 'thread/start') {
      this.respond({ id: message.id, result: { thread: { id: 'fresh-thread' } } });
    } else if (message.method === 'thread/resume') {
      if (this.missingRollout && !this.turnStarted) {
        this.respond({
          id: message.id,
          error: { message: `no rollout found for thread id ${THREAD_ID}` },
        });
      } else if (this.emptyRolloutAfterStartFailures > 0) {
        this.emptyRolloutAfterStartFailures -= 1;
        this.respond({
          id: message.id,
          error: {
            message: 'failed to read thread: thread-store internal error: rollout at /tmp/rollout.jsonl is empty',
          },
        });
      } else {
        this.respond({ id: message.id, result: { thread: { id: THREAD_ID } } });
      }
    } else if (message.method === 'model/list') {
      this.respond({
        id: message.id,
        result: {
          data: [{
            model: 'gpt-test',
            displayName: 'GPT Test',
            description: 'Test model',
            hidden: false,
            isDefault: true,
            defaultReasoningEffort: 'medium',
            supportedReasoningEfforts: [
              { reasoningEffort: 'medium', description: 'Balanced' },
              { reasoningEffort: 'high', description: 'Thorough' },
            ],
          }],
          nextCursor: null,
        },
      });
    } else if (message.method === 'thread/unsubscribe') {
      this.respond({ id: message.id, result: {} });
    } else if (message.method === 'turn/start') {
      this.turnStarted = true;
      const threadId = message.params.threadId;
      this.respond({
        id: message.id,
        result: { turn: { id: 'turn-1', items: [], status: 'inProgress' } },
      });
      if (!this.emitCompletion) {
        return;
      }
      this.respond({
        method: 'item/reasoning/summaryTextDelta',
        params: {
          threadId,
          turnId: 'turn-1',
          itemId: 'reasoning-1',
          summaryIndex: 0,
          delta: 'Checking the requested behavior.',
        },
      });
      this.respond({
        method: 'item/completed',
        params: {
          threadId,
          turnId: 'turn-1',
          item: { id: 'message-1', type: 'agentMessage', text: 'Task finished.' },
          completedAtMs: 100,
        },
      });
      this.respond({
        method: 'thread/tokenUsage/updated',
        params: {
          threadId,
          turnId: 'turn-1',
          tokenUsage: {
            total: { totalTokens: 2400, inputTokens: 1000, cachedInputTokens: 0, outputTokens: 1400, reasoningOutputTokens: 900 },
            last: { totalTokens: 2400, inputTokens: 1000, cachedInputTokens: 0, outputTokens: 1400, reasoningOutputTokens: 900 },
            modelContextWindow: 200000,
          },
        },
      });
      this.respond({
        method: 'turn/completed',
        params: {
          threadId,
          turn: {
            id: 'turn-1',
            items: [{ id: 'message-1', type: 'agentMessage', text: 'Task finished.' }],
            status: 'completed',
          },
        },
      });
    }
  }

  close() {
    if (this.readyState === 3) {
      return;
    }
    this.readyState = 3;
    queueMicrotask(() => this.dispatchEvent(new Event('close')));
  }
}

test('thread metadata is trimmed for the connected terminal picker', () => {
  const thread = normalizeThread({
    id: THREAD_ID,
    sessionId: THREAD_ID,
    preview: '  Fix   the\ncheckout tests  ',
    cwd: '/tmp/repository',
    source: 'cli',
    status: { type: 'idle' },
    updatedAt: 100,
  });

  assert.equal(thread.title, 'Fix the checkout tests');
  assert.equal(thread.provider, 'codex');
  assert.equal(thread.status, 'idle');
  assert.equal(thread.connectedToSharedServer, true);
});

test('fresh-thread persistence errors include missing and temporarily empty rollouts', () => {
  assert.equal(isFreshThreadPersistenceError(new Error(`no rollout found for thread id ${THREAD_ID}`)), true);
  assert.equal(isFreshThreadPersistenceError(new Error('rollout at /tmp/rollout.jsonl is empty')), true);
  assert.equal(isFreshThreadPersistenceError(new Error('permission denied')), false);
});

test('app-server listening output exposes its dynamic WebSocket endpoint', () => {
  assert.equal(
    advertisedWebSocketEndpoint('  listening on: ws://127.0.0.1:61234'),
    'ws://127.0.0.1:61234',
  );
  assert.equal(advertisedWebSocketEndpoint('unrelated output'), null);
});

test('a live update steers the exact active Codex turn', async () => {
  const diagnostics = [];
  const client = new CodexAppServer({
    proxy: new FakeProxy(),
    diagnostic: (event, fields) => diagnostics.push({ event, fields }),
  });
  const requests = [];
  client.activeTurns.set(THREAD_ID, {
    taskId: 42,
    threadId: THREAD_ID,
    turnId: 'turn-live',
  });
  client.request = async (method, params) => {
    requests.push({ method, params });
    return { turnId: 'turn-live' };
  };

  const result = await client.steer(42, '  Correct the current work  ', [{ path: '/tmp/follow-up.png' }]);

  assert.deepEqual(result, { taskId: 42, threadId: THREAD_ID, turnId: 'turn-live' });
  assert.deepEqual(requests, [{
    method: 'turn/steer',
    params: {
      threadId: THREAD_ID,
      input: [
        {
          type: 'text',
          text: `Correct the current work\n\n${RELAY_NON_INTERACTIVE_INSTRUCTION}`,
          text_elements: [],
        },
        { type: 'localImage', path: '/tmp/follow-up.png' },
      ],
      expectedTurnId: 'turn-live',
      clientUserMessageId: 'relay-steer-42-1',
    },
  }]);
  assert.equal(diagnostics.some(({ event }) => event === 'task.codex.steer.completed'), true);
});

test('live updates reject inactive tasks instead of queueing elsewhere', async () => {
  const client = new CodexAppServer({ proxy: new FakeProxy() });
  await assert.rejects(client.steer(42, 'Correct the current work'), /no longer has an active Codex turn/);
  await assert.rejects(client.steer(42, '   '), /Write a follow-up/);
});

test('live updates reject an unexpected turn response', async () => {
  const client = new CodexAppServer({ proxy: new FakeProxy() });
  client.activeTurns.set(THREAD_ID, {
    taskId: 42,
    threadId: THREAD_ID,
    turnId: 'turn-live',
  });
  client.request = async () => ({ turnId: 'turn-other' });
  await assert.rejects(client.steer(42, 'Correct the current work'), /different turn/);
});

test('shared app-server lists connected threads and completes a queued turn', async () => {
  const received = [];
  let spawnArgs = null;
  let spawnOptions = null;
  let connectedEndpoint = null;
  const proxy = new FakeProxy();
  const client = new CodexAppServer({
    spawnProcess: (command, args, options) => {
      spawnArgs = [command, ...args];
      spawnOptions = options;
      return fakeAppServerProcess();
    },
    webSocketFactory: (endpoint) => {
      connectedEndpoint = endpoint;
      return new FakeWebSocket(received);
    },
    proxy,
  });
  const events = [];

  try {
    const threads = await client.listConnectedThreads();
    assert.equal(threads.length, 1);
    assert.equal(threads[0].id, THREAD_ID);
    assert.deepEqual(spawnArgs.slice(-2), ['--listen', CODEX_APP_SERVER_ENDPOINT]);
    assert.equal(connectedEndpoint, 'ws://127.0.0.1:61234');
    assert.equal(proxy.target, 'ws://127.0.0.1:61234');
    assert.equal(spawnOptions.detached, process.platform !== 'win32');
    assert.equal(
      client.status().launchCommand,
      `codex --dangerously-bypass-approvals-and-sandbox --cd . --remote ${SHARED_CODEX_ENDPOINT}`,
    );

    const models = await client.listModels();
    assert.equal(models.length, 1);
    assert.equal(models[0].model, 'gpt-test');

    const result = await client.run({
      thread_id: THREAD_ID,
      prompt: 'Complete the queued task.',
      model: 'gpt-test',
      effort: 'high',
      attachments: [{
        id: 'image-1',
        name: 'reference.png',
        mimeType: 'image/png',
        path: '/tmp/relay/reference.png',
      }],
    }, {
      onEvent: (event) => events.push(event),
      onStderr: () => {},
    });

    assert.equal(result.finalResponse, 'Task finished.');
    assert.equal(result.sessionId, THREAD_ID);
    assert.equal(events.some(({ event }) => event.type === 'turn/completed'), true);
    assert.equal(events.find(({ event }) => event.type === 'turn/completed').event.tokenUsage.last.reasoningOutputTokens, 900);
    const reasoning = events.find(({ event }) => event.type === 'item/updated');
    assert.equal(reasoning.event.item.type, 'reasoning');
    assert.equal(reasoning.event.item.summary[0].text, 'Checking the requested behavior.');
    const resume = received.find((message) => message.method === 'thread/resume');
    assert.equal(resume.params.threadId, THREAD_ID);
    assert.equal(resume.params.approvalPolicy, 'never');
    assert.equal(resume.params.sandbox, 'danger-full-access');

    const turnStart = received.find((message) => message.method === 'turn/start');
    assert.equal(turnStart.params.threadId, THREAD_ID);
    assert.equal(
      turnStart.params.input[0].text,
      `Complete the queued task.\n\n${RELAY_NON_INTERACTIVE_INSTRUCTION}`,
    );
    assert.deepEqual(turnStart.params.input[1], {
      type: 'localImage',
      path: '/tmp/relay/reference.png',
    });
    assert.equal(turnStart.params.model, 'gpt-test');
    assert.equal(turnStart.params.effort, 'high');
    assert.deepEqual(turnStart.params.sandboxPolicy, {
      type: 'dangerFullAccess',
    });
    assert.equal(received.some((message) => message.method === 'thread/unsubscribe'), true);
  } finally {
    client.close();
  }
});

test('a disconnected selected Codex terminal is a non-retryable task failure', async () => {
  const client = new CodexAppServer({
    spawnProcess: () => fakeAppServerProcess(),
    webSocketFactory: () => new FakeWebSocket([]),
    proxy: new FakeProxy([]),
  });

  try {
    await assert.rejects(client.run({
      id: 216,
      thread_id: THREAD_ID,
      prompt: 'Do not loop this task.',
    }, {
      onEvent: () => {},
      onStderr: () => {},
    }), (error) => {
      assert.match(error.message, /no longer connected/i);
      assert.equal(error.retryable, false);
      return true;
    });
  } finally {
    client.close();
  }
});

test('an immediate follow-up rejects a newly busy Codex thread without waiting or starting a turn', async () => {
  const received = [];
  const client = new CodexAppServer({
    spawnProcess: () => fakeAppServerProcess(),
    webSocketFactory: () => new FakeWebSocket(received, { threadStatus: 'active' }),
    proxy: new FakeProxy(),
  });

  try {
    await assert.rejects(client.run({
      id: 42,
      thread_id: THREAD_ID,
      prompt: 'Start this follow-up now.',
      sessionFollowUp: true,
    }, {
      onEvent: () => {},
      onStderr: () => {},
    }), /became busy.*not queued/i);
    assert.equal(received.some((message) => message.method === 'turn/start'), false);
  } finally {
    client.close();
  }
});

test('polling completes a turn when its completion notification is missed', async () => {
  const received = [];
  const client = new CodexAppServer({
    spawnProcess: () => fakeAppServerProcess(),
    webSocketFactory: () => new FakeWebSocket(received, { emitCompletion: false }),
    proxy: new FakeProxy(),
  });

  try {
    const result = await client.run({
      thread_id: THREAD_ID,
      prompt: 'Complete without notifications.',
    }, {
      onEvent: () => {},
      onStderr: () => {},
    });

    assert.equal(result.finalResponse, 'Task finished.');
    assert.equal(received.some((message) => (
      message.method === 'thread/read' && message.params.includeTurns === true
    )), true);
    assert.equal(received.some((message) => message.method === 'thread/unsubscribe'), true);
  } finally {
    client.close();
  }
});

test('a freshly launched terminal subscribes to live output after its first turn creates a rollout', async () => {
  const received = [];
  const diagnostics = [];
  const client = new CodexAppServer({
    spawnProcess: () => fakeAppServerProcess(),
    webSocketFactory: () => new FakeWebSocket(received, { missingRollout: true }),
    proxy: new FakeProxy(),
    diagnostic: (event, fields) => diagnostics.push({ event, fields }),
  });

  try {
    const result = await client.run({
      id: 48,
      thread_id: THREAD_ID,
      prompt: 'Create the first persisted turn.',
    }, {
      onEvent: () => {},
      onStderr: () => {},
    });

    assert.equal(result.finalResponse, 'Task finished.');
    assert.equal(received.some((message) => message.method === 'turn/start'), true);
    assert.equal(received.filter((message) => message.method === 'thread/resume').length, 2);
    assert.equal(received.some((message) => message.method === 'thread/unsubscribe'), true);
    assert.equal(diagnostics.some(({ event }) => event === 'task.codex.thread.fresh'), true);
    assert.equal(diagnostics.some(({ event }) => event === 'task.codex.thread.subscribed_after_start'), true);
  } finally {
    client.close();
  }
});

test('a fresh thread retries an empty rollout without surfacing a terminal warning', async () => {
  const received = [];
  const diagnostics = [];
  const warnings = [];
  const client = new CodexAppServer({
    spawnProcess: () => fakeAppServerProcess(),
    webSocketFactory: () => new FakeWebSocket(received, {
      missingRollout: true,
      emptyRolloutAfterStartFailures: 2,
    }),
    proxy: new FakeProxy(),
    diagnostic: (event, fields) => diagnostics.push({ event, fields }),
    freshThreadRetryDelayMs: 0,
  });

  try {
    const result = await client.run({
      id: 49,
      thread_id: THREAD_ID,
      prompt: 'Create the first persisted turn after the rollout race.',
    }, {
      onEvent: () => {},
      onStderr: (line) => warnings.push(line),
    });

    assert.equal(result.finalResponse, 'Task finished.');
    assert.equal(received.filter((message) => message.method === 'thread/resume').length, 4);
    assert.equal(warnings.length, 0);
    assert.equal(diagnostics.filter(({ event }) => event === 'task.codex.thread.subscription_deferred').length, 2);
    assert.equal(diagnostics.some(({ event, fields }) => (
      event === 'task.codex.thread.subscribed_after_start' && fields.attempt === 3
    )), true);
  } finally {
    client.close();
  }
});

test('a fresh thread still completes by polling when its live subscription stays unavailable', async () => {
  const received = [];
  const diagnostics = [];
  const warnings = [];
  const client = new CodexAppServer({
    spawnProcess: () => fakeAppServerProcess(),
    webSocketFactory: () => new FakeWebSocket(received, {
      emitCompletion: false,
      missingRollout: true,
      emptyRolloutAfterStartFailures: 99,
    }),
    proxy: new FakeProxy(),
    diagnostic: (event, fields) => diagnostics.push({ event, fields }),
    freshThreadRetryDelayMs: 0,
  });

  try {
    const result = await client.run({
      id: 50,
      thread_id: THREAD_ID,
      prompt: 'Finish through polling without a live subscription.',
    }, {
      onEvent: () => {},
      onStderr: (line) => warnings.push(line),
    });

    assert.equal(result.finalResponse, 'Task finished.');
    assert.equal(received.filter((message) => message.method === 'thread/resume').length, 9);
    assert.equal(received.some((message) => (
      message.method === 'thread/read' && message.params.includeTurns === true
    )), true);
    assert.equal(warnings.length, 0);
    assert.equal(diagnostics.some(({ event }) => (
      event === 'task.codex.thread.subscribe_after_start_unavailable'
    )), true);
  } finally {
    client.close();
  }
});

test('plan review runs in the Codex read-only sandbox', async () => {
  const received = [];
  const client = new CodexAppServer({
    spawnProcess: () => fakeAppServerProcess(),
    webSocketFactory: () => new FakeWebSocket(received),
    proxy: new FakeProxy(),
  });

  try {
    await client.run({
      thread_id: THREAD_ID,
      prompt: 'Review this plan.',
      model: 'gpt-test',
      effort: 'high',
      read_only: true,
    }, {
      onEvent: () => {},
      onStderr: () => {},
    });

    const resume = received.find((message) => message.method === 'thread/resume');
    assert.equal(resume.params.sandbox, 'read-only');
    const turnStart = received.find((message) => message.method === 'turn/start');
    assert.deepEqual(turnStart.params.sandboxPolicy, {
      type: 'readOnly',
      networkAccess: false,
    });
  } finally {
    client.close();
  }
});

test('direct execution resets a reused plan-review thread to full access', async () => {
  const received = [];
  const client = new CodexAppServer({
    spawnProcess: () => fakeAppServerProcess(),
    webSocketFactory: () => new FakeWebSocket(received),
    proxy: new FakeProxy(),
  });

  try {
    await client.run({
      thread_id: THREAD_ID,
      prompt: 'Review this plan without editing.',
      read_only: true,
    }, {
      onEvent: () => {},
      onStderr: () => {},
    });
    await client.run({
      thread_id: THREAD_ID,
      prompt: 'Implement the reviewed plan.',
    }, {
      onEvent: () => {},
      onStderr: () => {},
    });

    const resumes = received.filter((message) => message.method === 'thread/resume');
    assert.equal(resumes.at(-2).params.sandbox, 'read-only');
    assert.equal(resumes.at(-1).params.sandbox, 'danger-full-access');

    const turnStarts = received.filter((message) => message.method === 'turn/start');
    assert.deepEqual(turnStarts.at(-2).params.sandboxPolicy, {
      type: 'readOnly',
      networkAccess: false,
    });
    assert.deepEqual(turnStarts.at(-1).params.sandboxPolicy, {
      type: 'dangerFullAccess',
    });
  } finally {
    client.close();
  }
});
