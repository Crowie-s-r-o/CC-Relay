import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import {
  CodexAppServer,
  CODEX_APP_SERVER_ENDPOINT,
  normalizeThread,
  SHARED_CODEX_ENDPOINT,
} from '../src/codex-app-server.mjs';

const THREAD_ID = '019f6b51-cad9-7582-99fb-e9a6ee76ead2';

class FakeProxy extends EventEmitter {
  async start() {}

  listConnectedThreadIds() {
    return [THREAD_ID];
  }

  stop() {}
}

function fakeAppServerProcess() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => {
    queueMicrotask(() => child.emit('close', 0, null));
    return true;
  };
  return child;
}

function messageEvent(message) {
  const event = new Event('message');
  Object.defineProperty(event, 'data', { value: JSON.stringify(message) });
  return event;
}

class FakeWebSocket extends EventTarget {
  constructor(received, { emitCompletion = true, missingRollout = false } = {}) {
    super();
    this.received = received;
    this.emitCompletion = emitCompletion;
    this.missingRollout = missingRollout;
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
            id: THREAD_ID,
            sessionId: THREAD_ID,
            name: 'Relay test thread',
            preview: 'A test session',
            cwd: '/tmp/repository',
            source: 'cli',
            status: { type: 'idle' },
            updatedAt: 100,
            turns: message.params.includeTurns && this.turnStarted ? [completedTurn] : undefined,
          },
        },
      });
    } else if (message.method === 'thread/resume') {
      if (this.missingRollout && !this.turnStarted) {
        this.respond({
          id: message.id,
          error: { message: `no rollout found for thread id ${THREAD_ID}` },
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
          threadId: THREAD_ID,
          turnId: 'turn-1',
          itemId: 'reasoning-1',
          summaryIndex: 0,
          delta: 'Checking the requested behavior.',
        },
      });
      this.respond({
        method: 'item/completed',
        params: {
          threadId: THREAD_ID,
          turnId: 'turn-1',
          item: { id: 'message-1', type: 'agentMessage', text: 'Task finished.' },
          completedAtMs: 100,
        },
      });
      this.respond({
        method: 'turn/completed',
        params: {
          threadId: THREAD_ID,
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

test('shared app-server lists connected threads and completes a queued turn', async () => {
  const received = [];
  let spawnArgs = null;
  const client = new CodexAppServer({
    spawnProcess: (command, args) => {
      spawnArgs = [command, ...args];
      return fakeAppServerProcess();
    },
    webSocketFactory: () => new FakeWebSocket(received),
    proxy: new FakeProxy(),
  });
  const events = [];

  try {
    const threads = await client.listConnectedThreads();
    assert.equal(threads.length, 1);
    assert.equal(threads[0].id, THREAD_ID);
    assert.deepEqual(spawnArgs.slice(-2), ['--listen', CODEX_APP_SERVER_ENDPOINT]);
    assert.equal(
      client.status().launchCommand,
      `codex --dangerously-bypass-approvals-and-sandbox --remote ${SHARED_CODEX_ENDPOINT}`,
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
    const reasoning = events.find(({ event }) => event.type === 'item/updated');
    assert.equal(reasoning.event.item.type, 'reasoning');
    assert.equal(reasoning.event.item.summary[0].text, 'Checking the requested behavior.');
    const resume = received.find((message) => message.method === 'thread/resume');
    assert.equal(resume.params.threadId, THREAD_ID);
    assert.equal(resume.params.approvalPolicy, 'never');

    const turnStart = received.find((message) => message.method === 'turn/start');
    assert.equal(turnStart.params.threadId, THREAD_ID);
    assert.equal(turnStart.params.input[0].text, 'Complete the queued task.');
    assert.deepEqual(turnStart.params.input[1], {
      type: 'localImage',
      path: '/tmp/relay/reference.png',
    });
    assert.equal(turnStart.params.model, 'gpt-test');
    assert.equal(turnStart.params.effort, 'high');
    assert.equal(received.some((message) => message.method === 'thread/unsubscribe'), true);
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
