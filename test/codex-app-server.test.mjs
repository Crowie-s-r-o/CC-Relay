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
  notificationMessage,
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

test('Codex collaboration items reach the task event stream with useful messages', () => {
  const client = new CodexAppServer({ proxy: new FakeProxy() });
  const events = [];
  client.activeTurns.set(THREAD_ID, {
    taskId: 114,
    threadId: THREAD_ID,
    turnId: 'turn-agents',
    reasoningSummaries: new Map(),
    onEvent: (event) => events.push(event),
  });

  try {
    client.handleNotification('item/completed', {
      threadId: THREAD_ID,
      turnId: 'turn-agents',
      item: {
        type: 'collabAgentToolCall',
        id: 'spawn-worker',
        tool: 'spawnAgent',
        status: 'completed',
        senderThreadId: THREAD_ID,
        receiverThreadIds: ['agent-thread'],
        prompt: 'Inspect the renderer.',
        model: 'gpt-test',
        reasoningEffort: 'high',
        agentsStates: { 'agent-thread': { status: 'running', message: null } },
      },
    });
    client.handleNotification('item/completed', {
      threadId: THREAD_ID,
      turnId: 'turn-agents',
      item: {
        type: 'subAgentActivity',
        id: 'activity-started',
        kind: 'started',
        agentThreadId: 'agent-thread',
        agentPath: '/root/renderer_worker',
      },
    });
    client.handleNotification('item/completed', {
      threadId: THREAD_ID,
      turnId: 'turn-agents',
      item: {
        type: 'subAgentActivity',
        id: 'activity-finished',
        kind: 'interacted',
        agentThreadId: 'agent-thread',
        agentPath: '/root/renderer_worker',
      },
    });

    assert.deepEqual(events.map(({ event }) => event.item.type), [
      'collabAgentToolCall',
      'subAgentActivity',
      'subAgentActivity',
    ]);
    assert.deepEqual(events.map(({ message }) => message), [
      'Codex started a sub-agent.',
      'Codex started sub-agent "renderer_worker".',
      'Codex recorded activity for sub-agent "renderer_worker".',
    ]);
  } finally {
    client.activeTurns.clear();
    client.close();
  }
});

test('Windows and POSIX sub-agent paths resolve to the same sub-agent name', () => {
  const client = new CodexAppServer({ proxy: new FakeProxy() });
  const events = [];
  client.activeTurns.set(THREAD_ID, {
    taskId: 115,
    threadId: THREAD_ID,
    turnId: 'turn-agents',
    reasoningSummaries: new Map(),
    onEvent: (event) => events.push(event),
  });

  try {
    client.handleNotification('item/completed', {
      threadId: THREAD_ID,
      turnId: 'turn-agents',
      item: {
        type: 'subAgentActivity',
        id: 'activity-windows',
        kind: 'started',
        agentThreadId: 'agent-thread',
        agentPath: 'C:\\Users\\dev\\agents\\renderer_worker',
      },
    });
    client.handleNotification('item/completed', {
      threadId: THREAD_ID,
      turnId: 'turn-agents',
      item: {
        type: 'subAgentActivity',
        id: 'activity-posix',
        kind: 'started',
        agentThreadId: 'agent-thread',
        agentPath: '/home/dev/agents/renderer_worker',
      },
    });

    assert.deepEqual(events.map(({ message }) => message), [
      'Codex started sub-agent "renderer_worker".',
      'Codex started sub-agent "renderer_worker".',
    ]);
  } finally {
    client.activeTurns.clear();
    client.close();
  }
});

// The turn id a goal-driven thread reports for plan and goal updates differs from the one
// turn/start returned, so these fixtures deliberately use a second turn-id space.
const GOAL_TURN_ID = 'a86ddc0c-bb5f-4596-9dc1-26b7311638ae';
const ACTIVE_TURN_ID = '019ff6aa-83cb-7bd1-a81f-620552d6afc2';
// A second turn on the same thread reports its own ids in both turn-id spaces. Nothing may
// fold two turns into one plan row, so no fixture below reuses a turn id across turns.
const SECOND_ACTIVE_TURN_ID = '019ff7c1-4d2e-7a55-b0c7-4f1d9a2b6e83';
const SECOND_GOAL_TURN_ID = 'c4b1f0d7-2a68-4f3c-9b5e-71d0e8a3c942';

// finishActiveTurn resolves the run promise and releases the thread subscription, so the
// fixture carries the fields that path reads as well as the notification fields. It mirrors
// the record `run` builds, so a field missing here that `run` sets is a bug in the fixture.
function activeTurnFixture({ taskId, turnId, events }) {
  return {
    taskId,
    threadId: THREAD_ID,
    turnId,
    finalResponse: '',
    reasoningSummaries: new Map(),
    lastGoalPayload: null,
    subscribed: false,
    earlyCompletion: null,
    cancelRequested: false,
    onEvent: (event) => events.push(event),
    onStderr: () => {},
    resolve: () => {},
    reject: () => {},
  };
}

function planTurnClient(taskId, turnId = ACTIVE_TURN_ID) {
  const client = new CodexAppServer({ proxy: new FakeProxy() });
  const events = [];
  client.activeTurns.set(THREAD_ID, activeTurnFixture({ taskId, turnId, events }));
  return { client, events };
}

function completeTurn(client, turnId) {
  client.finishActiveTurn({
    threadId: THREAD_ID,
    turn: { id: turnId, status: 'completed', items: [] },
  });
}

const LIVE_GOAL = {
  objective: 'Summarize the repository README',
  status: 'active',
  tokenBudget: null,
  tokensUsed: 38885,
  timeUsedSeconds: 19,
  createdAt: 1786549797,
  updatedAt: 1786549816,
};

test('a Codex plan update on a goal-driven turn id still reaches the task event stream', () => {
  const { client, events } = planTurnClient(210);

  try {
    client.handleNotification('turn/plan/updated', {
      threadId: THREAD_ID,
      turnId: GOAL_TURN_ID,
      explanation: null,
      plan: [
        { step: 'Locate the repository README', status: 'inProgress' },
        { step: 'Read the README completely', status: 'pending' },
        { step: 'Summarize the README key guidance', status: 'pending' },
      ],
    });

    assert.equal(events.length, 1);
    assert.deepEqual(events[0].event, {
      type: 'turn/plan/updated',
      threadId: THREAD_ID,
      turnId: GOAL_TURN_ID,
      planKey: `${THREAD_ID}:${GOAL_TURN_ID}`,
      explanation: '',
      plan: [
        { step: 'Locate the repository README', status: 'inProgress' },
        { step: 'Read the README completely', status: 'pending' },
        { step: 'Summarize the README key guidance', status: 'pending' },
      ],
    });
  } finally {
    client.activeTurns.clear();
    client.close();
  }
});

test('the turn guard still drops ordinary notifications from a foreign turn', () => {
  const { client, events } = planTurnClient(211);

  try {
    client.handleNotification('item/completed', {
      threadId: THREAD_ID,
      turnId: GOAL_TURN_ID,
      item: { id: 'foreign', type: 'agentMessage', text: 'Reply from another turn.' },
    });

    assert.deepEqual(events, []);
  } finally {
    client.activeTurns.clear();
    client.close();
  }
});

test('a plan update for an unrelated Codex thread is ignored', () => {
  const { client, events } = planTurnClient(212);

  try {
    client.handleNotification('turn/plan/updated', {
      threadId: '019f0000-0000-7000-8000-000000000000',
      turnId: GOAL_TURN_ID,
      explanation: 'Other thread.',
      plan: [{ step: 'Should not be stored', status: 'pending' }],
    });

    assert.deepEqual(events, []);
  } finally {
    client.activeTurns.clear();
    client.close();
  }
});

test('successive plan revisions each carry the full plan under one fold key', () => {
  const { client, events } = planTurnClient(213);

  try {
    client.handleNotification('turn/plan/updated', {
      threadId: THREAD_ID,
      turnId: GOAL_TURN_ID,
      explanation: 'Starting the review.',
      plan: [
        { step: 'Read the executor', status: 'inProgress' },
        { step: 'Patch the guard', status: 'pending' },
      ],
    });
    client.handleNotification('turn/plan/updated', {
      threadId: THREAD_ID,
      turnId: GOAL_TURN_ID,
      explanation: 'Guard located.',
      plan: [
        { step: 'Read the executor', status: 'completed' },
        { step: 'Patch the guard', status: 'inProgress' },
      ],
    });

    assert.equal(events.length, 2);
    assert.deepEqual(events.map(({ event }) => event.planKey), [
      `${THREAD_ID}:${GOAL_TURN_ID}`,
      `${THREAD_ID}:${GOAL_TURN_ID}`,
    ]);
    assert.deepEqual(events.map(({ event }) => event.plan.length), [2, 2]);
    assert.deepEqual(events[1].event.plan, [
      { step: 'Read the executor', status: 'completed' },
      { step: 'Patch the guard', status: 'inProgress' },
    ]);
    assert.deepEqual(events.map(({ message }) => message), [
      'Codex updated its plan (0/2 steps done): Read the executor',
      'Codex updated its plan (1/2 steps done): Patch the guard',
    ]);
  } finally {
    client.activeTurns.clear();
    client.close();
  }
});

test('malformed Codex plan payloads normalize instead of throwing', () => {
  const { client, events } = planTurnClient(214);

  try {
    client.handleNotification('turn/plan/updated', { threadId: THREAD_ID, turnId: GOAL_TURN_ID });
    client.handleNotification('turn/plan/updated', {
      threadId: THREAD_ID,
      turnId: GOAL_TURN_ID,
      explanation: '  Recovering  ',
      plan: 'not-an-array',
    });
    client.handleNotification('turn/plan/updated', {
      threadId: THREAD_ID,
      turnId: GOAL_TURN_ID,
      plan: [
        { step: 42, status: 'inProgress' },
        { step: 'Unknown status step', status: 'abandoned' },
        { step: 'Multi\nline  step', status: 'completed' },
        null,
      ],
    });
    client.handleNotification('turn/plan/updated', { threadId: THREAD_ID, plan: [] });

    assert.equal(events.length, 4);
    assert.deepEqual(events[0].event.plan, []);
    assert.equal(events[0].event.explanation, '');
    assert.deepEqual(events[1].event.plan, []);
    assert.equal(events[1].event.explanation, 'Recovering');
    assert.deepEqual(events[2].event.plan, [
      { step: '', status: 'inProgress' },
      { step: 'Unknown status step', status: 'pending' },
      { step: 'Multi line step', status: 'completed' },
      { step: '', status: 'pending' },
    ]);
    assert.equal(events[3].event.turnId, null);
    assert.equal(events[3].event.planKey, THREAD_ID);
    assert.deepEqual(events.map(({ message }) => message), [
      'Codex updated its plan.',
      'Codex updated its plan.',
      'Codex updated its plan (1/4 steps done).',
      'Codex updated its plan.',
    ]);
  } finally {
    client.activeTurns.clear();
    client.close();
  }
});

test('Codex thread goal updates and clears reach the task event stream', () => {
  const { client, events } = planTurnClient(215);

  try {
    client.handleNotification('thread/goal/updated', {
      threadId: THREAD_ID,
      turnId: GOAL_TURN_ID,
      goal: {
        threadId: THREAD_ID,
        objective: 'Summarize the repository README',
        status: 'active',
        tokenBudget: null,
        tokensUsed: 38885,
        timeUsedSeconds: 19,
        createdAt: 1786549797,
        updatedAt: 1786549816,
      },
    });
    client.handleNotification('thread/goal/updated', {
      threadId: THREAD_ID,
      turnId: null,
      goal: { objective: '  Paused work  ', status: 'usageLimited', tokensUsed: 'many' },
    });
    client.handleNotification('thread/goal/cleared', { threadId: THREAD_ID });

    assert.equal(events.length, 3);
    assert.deepEqual(events[0].event, {
      type: 'thread/goal/updated',
      threadId: THREAD_ID,
      turnId: GOAL_TURN_ID,
      goal: {
        objective: 'Summarize the repository README',
        status: 'active',
        tokenBudget: null,
        tokensUsed: 38885,
        timeUsedSeconds: 19,
        createdAt: 1786549797,
        updatedAt: 1786549816,
      },
    });
    assert.equal(events[1].event.turnId, null);
    assert.equal(events[1].event.goal.objective, 'Paused work');
    assert.equal(events[1].event.goal.tokensUsed, null);
    assert.deepEqual(events[2].event, { type: 'thread/goal/cleared', threadId: THREAD_ID });
    assert.deepEqual(events.map(({ message }) => message), [
      'Codex goal active: Summarize the repository README',
      'Codex goal usageLimited: Paused work',
      'Codex cleared the thread goal.',
    ]);
  } finally {
    client.activeTurns.clear();
    client.close();
  }
});

test('a goal still live when the Codex turn ends is closed by one turn-final record', () => {
  const { client, events } = planTurnClient(216);

  try {
    client.handleNotification('thread/goal/updated', {
      threadId: THREAD_ID,
      turnId: GOAL_TURN_ID,
      goal: { threadId: THREAD_ID, ...LIVE_GOAL },
    });
    completeTurn(client, ACTIVE_TURN_ID);
    // Codex reports the finished goal after the active turn is gone, so these two are dropped
    // by the active-turn guard. The turn-final record above is the only thing standing between
    // the operator and a goal row that claims to be live forever.
    client.handleNotification('thread/goal/updated', {
      threadId: THREAD_ID,
      turnId: GOAL_TURN_ID,
      goal: { ...LIVE_GOAL, status: 'complete' },
    });
    client.handleNotification('thread/goal/cleared', { threadId: THREAD_ID });

    assert.equal(events.length, 2);
    assert.equal(events[0].event.turnEnded, undefined);
    assert.deepEqual(events[1].event, {
      type: 'thread/goal/updated',
      threadId: THREAD_ID,
      turnId: GOAL_TURN_ID,
      goal: { ...LIVE_GOAL },
      turnEnded: true,
    });
    assert.deepEqual(events.map(({ message }) => message), [
      'Codex goal active: Summarize the repository README',
      'Codex goal active as the turn ended: Summarize the repository README',
    ]);
  } finally {
    client.activeTurns.clear();
    client.close();
  }
});

test('the turn-final goal record carries the last goal once, however the turn end is observed', () => {
  const { client, events } = planTurnClient(217);

  try {
    client.handleNotification('thread/goal/updated', {
      threadId: THREAD_ID,
      turnId: GOAL_TURN_ID,
      goal: { ...LIVE_GOAL },
    });
    client.handleNotification('thread/goal/updated', {
      threadId: THREAD_ID,
      turnId: GOAL_TURN_ID,
      goal: { ...LIVE_GOAL, status: 'blocked', tokensUsed: 41200 },
    });
    completeTurn(client, ACTIVE_TURN_ID);
    // The turn-completed notification and the one-second turn poll both call finishActiveTurn,
    // so a second finish must not append a second turn-final record. The active-turn delete in
    // finishActiveTurn is the whole guard: no once-only flag rides on the turn record.
    completeTurn(client, ACTIVE_TURN_ID);

    assert.equal(events.length, 3);
    assert.equal(events[2].event.turnEnded, true);
    assert.equal(events[2].event.goal.status, 'blocked');
    assert.equal(events[2].event.goal.tokensUsed, 41200);
    assert.equal(events.filter(({ event }) => event.turnEnded === true).length, 1);
  } finally {
    client.activeTurns.clear();
    client.close();
  }
});

test('a Codex turn that never reported a goal records no turn-final goal', () => {
  const { client, events } = planTurnClient(218);

  try {
    client.handleNotification('turn/plan/updated', {
      threadId: THREAD_ID,
      turnId: GOAL_TURN_ID,
      plan: [{ step: 'Read the README completely', status: 'inProgress' }],
    });
    completeTurn(client, ACTIVE_TURN_ID);

    assert.equal(events.length, 1);
    assert.equal(events[0].event.type, 'turn/plan/updated');
    assert.deepEqual(events.filter(({ event }) => String(event.type).startsWith('thread/goal/')), []);
  } finally {
    client.activeTurns.clear();
    client.close();
  }
});

test('a goal cleared before the turn ends stays resolved instead of gaining a live record', () => {
  const { client, events } = planTurnClient(219);

  try {
    client.handleNotification('thread/goal/updated', {
      threadId: THREAD_ID,
      turnId: GOAL_TURN_ID,
      goal: { ...LIVE_GOAL },
    });
    client.handleNotification('thread/goal/cleared', { threadId: THREAD_ID });
    completeTurn(client, ACTIVE_TURN_ID);

    assert.equal(events.length, 2);
    assert.deepEqual(events[1].event, { type: 'thread/goal/cleared', threadId: THREAD_ID });
    assert.deepEqual(events.filter(({ event }) => event.turnEnded === true), []);
  } finally {
    client.activeTurns.clear();
    client.close();
  }
});

test('a goal set again after a clear is closed by the turn-final record', () => {
  const { client, events } = planTurnClient(220);

  try {
    client.handleNotification('thread/goal/updated', {
      threadId: THREAD_ID,
      turnId: GOAL_TURN_ID,
      goal: { ...LIVE_GOAL },
    });
    client.handleNotification('thread/goal/cleared', { threadId: THREAD_ID });
    client.handleNotification('thread/goal/updated', {
      threadId: THREAD_ID,
      turnId: SECOND_GOAL_TURN_ID,
      goal: { ...LIVE_GOAL, objective: 'Review the release gates' },
    });
    completeTurn(client, ACTIVE_TURN_ID);

    assert.equal(events.length, 4);
    assert.deepEqual(events[3].event, {
      type: 'thread/goal/updated',
      threadId: THREAD_ID,
      turnId: SECOND_GOAL_TURN_ID,
      goal: { ...LIVE_GOAL, objective: 'Review the release gates' },
      turnEnded: true,
    });
  } finally {
    client.activeTurns.clear();
    client.close();
  }
});

// A goal notification whose `goal` object is missing, null, or wrongly typed normalizes to
// blank text with null or bare-zero usage. Task Activity folds every goal event into one row
// and the turn-final record is the one nothing can revise afterwards, so replaying a blank as
// the turn ends would settle the row on a bare "Recorded" label with no objective. The blank is
// still logged verbatim: Codex output is reported as it arrived, it just cannot become the
// turn's last word.
test('a goal update naming neither objective nor status cannot become the turn-final goal', () => {
  const { client, events } = planTurnClient(225);

  try {
    client.handleNotification('thread/goal/updated', {
      threadId: THREAD_ID,
      turnId: GOAL_TURN_ID,
      goal: { ...LIVE_GOAL },
    });
    client.handleNotification('thread/goal/updated', {
      threadId: THREAD_ID,
      turnId: GOAL_TURN_ID,
      goal: { objective: 42, status: null, tokensUsed: 0, timeUsedSeconds: 0 },
    });
    completeTurn(client, ACTIVE_TURN_ID);

    assert.equal(events.length, 3);
    // The blank update still reaches the activity log exactly as it normalized.
    assert.equal(events[1].event.turnEnded, undefined);
    assert.deepEqual(events[1].event.goal, {
      objective: '',
      status: '',
      tokenBudget: null,
      tokensUsed: 0,
      timeUsedSeconds: 0,
      createdAt: null,
      updatedAt: null,
    });
    assert.deepEqual(events[2].event, {
      type: 'thread/goal/updated',
      threadId: THREAD_ID,
      turnId: GOAL_TURN_ID,
      goal: { ...LIVE_GOAL },
      turnEnded: true,
    });
    assert.deepEqual(events.map(({ message }) => message), [
      'Codex goal active: Summarize the repository README',
      'Codex goal updated.',
      'Codex goal active as the turn ended: Summarize the repository README',
    ]);
  } finally {
    client.activeTurns.clear();
    client.close();
  }
});

test('a Codex turn whose only goal update named nothing records no turn-final goal', () => {
  const { client, events } = planTurnClient(226);

  try {
    client.handleNotification('thread/goal/updated', {
      threadId: THREAD_ID,
      turnId: GOAL_TURN_ID,
    });
    completeTurn(client, ACTIVE_TURN_ID);

    assert.equal(events.length, 1);
    assert.equal(events[0].event.goal.objective, '');
    // Nothing readable was ever reported, so there is no goal worth closing the row on and the
    // renderer settles the row from the finished task status instead.
    assert.deepEqual(events.filter(({ event }) => event.turnEnded === true), []);
  } finally {
    client.activeTurns.clear();
    client.close();
  }
});

// Pinned decision rather than a discovery: the blank update after a clear leaves the turn with
// no goal to close on, so the folded row keeps the blank live record and leans on the finished
// task status. Reviving the cleared goal instead would be worse: it would claim Codex still
// held a goal it had already dropped.
test('a cleared goal is not revived by a goal update that names nothing', () => {
  const { client, events } = planTurnClient(227);

  try {
    client.handleNotification('thread/goal/updated', {
      threadId: THREAD_ID,
      turnId: GOAL_TURN_ID,
      goal: { ...LIVE_GOAL },
    });
    client.handleNotification('thread/goal/cleared', { threadId: THREAD_ID });
    client.handleNotification('thread/goal/updated', {
      threadId: THREAD_ID,
      turnId: GOAL_TURN_ID,
      goal: { objective: '   ', status: '  ' },
    });
    completeTurn(client, ACTIVE_TURN_ID);

    assert.equal(events.length, 3);
    assert.deepEqual(events[1].event, { type: 'thread/goal/cleared', threadId: THREAD_ID });
    assert.equal(events[2].event.goal.objective, '');
    assert.deepEqual(events.filter(({ event }) => event.turnEnded === true), []);
  } finally {
    client.activeTurns.clear();
    client.close();
  }
});

// Nothing that ends one turn may outlive it. Every `run` builds a fresh turn record, so the
// second turn on a thread closes on its own goal; a guard latched across turns, or held on the
// client instead of the record, would leave this turn with no terminal record at all.
test('two Codex turns on one thread each close on their own turn-final goal record', () => {
  const { client, events } = planTurnClient(228);

  try {
    client.handleNotification('thread/goal/updated', {
      threadId: THREAD_ID,
      turnId: GOAL_TURN_ID,
      goal: { ...LIVE_GOAL },
    });
    completeTurn(client, ACTIVE_TURN_ID);
    client.activeTurns.set(THREAD_ID, activeTurnFixture({
      taskId: 228,
      turnId: SECOND_ACTIVE_TURN_ID,
      events,
    }));
    client.handleNotification('thread/goal/updated', {
      threadId: THREAD_ID,
      turnId: SECOND_GOAL_TURN_ID,
      goal: { ...LIVE_GOAL, objective: 'Review the release gates', tokensUsed: 51200 },
    });
    completeTurn(client, SECOND_ACTIVE_TURN_ID);

    assert.equal(events.length, 4);
    assert.deepEqual(
      events.map(({ event }) => [event.turnId, event.goal.objective, event.turnEnded === true]),
      [
        [GOAL_TURN_ID, 'Summarize the repository README', false],
        [GOAL_TURN_ID, 'Summarize the repository README', true],
        [SECOND_GOAL_TURN_ID, 'Review the release gates', false],
        [SECOND_GOAL_TURN_ID, 'Review the release gates', true],
      ],
    );
    assert.equal(events[3].event.goal.tokensUsed, 51200);
  } finally {
    client.activeTurns.clear();
    client.close();
  }
});

// The goal row folds every goal event on a thread into one entry that outlives the turn, so it
// needs a terminal record. A plan row folds on `planKey`, which is turn scoped, so replaying
// the checklist would repeat the whole plan without changing a single rendered row.
test('a plan left mid-flight when the turn ends is not replayed as a turn-final record', () => {
  const { client, events } = planTurnClient(221);

  try {
    client.handleNotification('turn/plan/updated', {
      threadId: THREAD_ID,
      turnId: GOAL_TURN_ID,
      plan: [
        { step: 'Read the executor', status: 'completed' },
        { step: 'Patch the guard', status: 'inProgress' },
      ],
    });
    client.handleNotification('thread/goal/updated', {
      threadId: THREAD_ID,
      turnId: GOAL_TURN_ID,
      goal: { ...LIVE_GOAL },
    });
    completeTurn(client, ACTIVE_TURN_ID);

    assert.equal(events.length, 3);
    assert.equal(events.filter(({ event }) => event.type === 'turn/plan/updated').length, 1);
    assert.equal(events[0].event.turnEnded, undefined);
    assert.equal(events[2].event.type, 'thread/goal/updated');
    assert.equal(events[2].event.turnEnded, true);
  } finally {
    client.activeTurns.clear();
    client.close();
  }
});

test('two Codex turns on one thread keep two plan rows', () => {
  const { client, events } = planTurnClient(222);

  try {
    client.handleNotification('turn/plan/updated', {
      threadId: THREAD_ID,
      turnId: GOAL_TURN_ID,
      plan: [{ step: 'Read the README completely', status: 'inProgress' }],
    });
    completeTurn(client, ACTIVE_TURN_ID);
    client.activeTurns.set(THREAD_ID, activeTurnFixture({
      taskId: 222,
      turnId: SECOND_ACTIVE_TURN_ID,
      events,
    }));
    client.handleNotification('turn/plan/updated', {
      threadId: THREAD_ID,
      turnId: SECOND_GOAL_TURN_ID,
      plan: [{ step: 'Summarize the README key guidance', status: 'inProgress' }],
    });
    completeTurn(client, SECOND_ACTIVE_TURN_ID);

    const planKeys = events.map(({ event }) => event.planKey);
    assert.equal(events.length, 2);
    assert.deepEqual(planKeys, [
      `${THREAD_ID}:${GOAL_TURN_ID}`,
      `${THREAD_ID}:${SECOND_GOAL_TURN_ID}`,
    ]);
    assert.equal(new Set(planKeys).size, 2);
    assert.notEqual(planKeys[0], planKeys[1]);
  } finally {
    client.activeTurns.clear();
    client.close();
  }
});

// Known behavior, pinned so it is a decision rather than a surprise: a plan update that reports
// no turn id keys on the thread alone, so two turns that both omit it do share one row. Codex
// has always reported a turn id on the plan notification, and keying the fallback on the active
// turn instead would leave `planKey` naming a different turn than the event's own `turnId`.
test('plan updates without a turn id keep the thread-scoped fallback key', () => {
  const { client, events } = planTurnClient(223);

  try {
    client.handleNotification('turn/plan/updated', {
      threadId: THREAD_ID,
      plan: [{ step: 'Read the README completely', status: 'inProgress' }],
    });
    completeTurn(client, ACTIVE_TURN_ID);
    client.activeTurns.set(THREAD_ID, activeTurnFixture({
      taskId: 223,
      turnId: SECOND_ACTIVE_TURN_ID,
      events,
    }));
    client.handleNotification('turn/plan/updated', {
      threadId: THREAD_ID,
      plan: [{ step: 'Summarize the README key guidance', status: 'inProgress' }],
    });

    assert.deepEqual(events.map(({ event }) => event.planKey), [THREAD_ID, THREAD_ID]);
    assert.deepEqual(events.map(({ event }) => event.turnId), [null, null]);
  } finally {
    client.activeTurns.clear();
    client.close();
  }
});

test('Codex goal timestamps survive as epoch numbers or ISO strings and nothing else', () => {
  const { client, events } = planTurnClient(224);
  const update = (createdAt, updatedAt) => client.handleNotification('thread/goal/updated', {
    threadId: THREAD_ID,
    turnId: GOAL_TURN_ID,
    goal: { objective: 'Timestamp shapes', status: 'active', createdAt, updatedAt },
  });

  try {
    // The live Codex payload reports epoch integers, the app-server schema declares int64 with
    // no unit, and other Codex surfaces report ISO strings. Both forms are stored as they
    // arrived so no consumer inherits a seconds-against-milliseconds guess.
    update(1786549797, 1786549816);
    update('2026-08-12T09:09:57Z', '  2026-08-12T09:10:16.500+02:00  ');
    update('2026-08-12', '2026-08-12 09:10:16');
    update('yesterday', 'Dec 25, 2026');
    update('2026-13-45T00:00:00Z', { seconds: 1786549797 });
    update(Number.NaN, Number.POSITIVE_INFINITY);
    update(0, null);

    assert.deepEqual(
      events.map(({ event }) => [event.goal.createdAt, event.goal.updatedAt]),
      [
        [1786549797, 1786549816],
        ['2026-08-12T09:09:57Z', '2026-08-12T09:10:16.500+02:00'],
        ['2026-08-12', '2026-08-12 09:10:16'],
        [null, null],
        [null, null],
        [null, null],
        [0, null],
      ],
    );
  } finally {
    client.activeTurns.clear();
    client.close();
  }
});

test('plan and goal notifications read as single readable log lines', () => {
  assert.equal(
    notificationMessage('turn/plan/updated', {
      plan: [
        { step: 'Locate the repository README', status: 'completed' },
        { step: 'Read the README completely', status: 'inProgress' },
        { step: 'Summarize the key guidance', status: 'pending' },
      ],
    }),
    'Codex updated its plan (1/3 steps done): Read the README completely',
  );
  assert.equal(
    notificationMessage('turn/plan/updated', {
      plan: [{ step: 'Ship the change', status: 'completed' }],
    }),
    'Codex updated its plan (1/1 steps done).',
  );
  assert.equal(notificationMessage('turn/plan/updated', {}), 'Codex updated its plan.');
  assert.equal(
    notificationMessage('thread/goal/updated', { goal: { objective: 'Ship plan visibility', status: 'blocked' } }),
    'Codex goal blocked: Ship plan visibility',
  );
  assert.equal(notificationMessage('thread/goal/updated', {}), 'Codex goal updated.');
  assert.equal(
    notificationMessage('thread/goal/updated', {
      turnEnded: true,
      goal: { objective: 'Ship plan visibility', status: 'active' },
    }),
    'Codex goal active as the turn ended: Ship plan visibility',
  );
  assert.equal(
    notificationMessage('thread/goal/updated', { turnEnded: true, goal: {} }),
    'Codex goal updated as the turn ended.',
  );
  assert.equal(notificationMessage('thread/goal/cleared', {}), 'Codex cleared the thread goal.');
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

test('rate-limit reads use the authenticated Codex app-server account endpoint', async () => {
  const diagnostics = [];
  const requests = [];
  const client = new CodexAppServer({
    proxy: new FakeProxy(),
    diagnostic: (event, fields) => diagnostics.push({ event, fields }),
  });
  client.start = async () => client.status();
  client.socket = {
    readyState: 1,
    send: (value) => {
      const request = JSON.parse(value);
      requests.push(request);
      queueMicrotask(() => client.handleLine(JSON.stringify({
        id: request.id,
        result: { rateLimitsByLimitId: {} },
      })));
    },
    close: () => {},
  };

  try {
    const result = await client.readRateLimits();

    assert.deepEqual(result, { rateLimitsByLimitId: {} });
    assert.deepEqual(requests, [{
      id: 1,
      method: 'account/rateLimits/read',
      params: null,
    }]);
    assert.deepEqual(diagnostics.find(({ event }) => event === 'appserver.request.sent'), {
      event: 'appserver.request.sent',
      fields: {
        id: 1,
        method: 'account/rateLimits/read',
        threadId: undefined,
        model: undefined,
        effort: undefined,
      },
    });
  } finally {
    client.close();
  }
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

test('shared app-server resolves the Windows codex shim and launches it through cmd.exe', async () => {
  let invocation = null;
  const client = new CodexAppServer({
    platform: 'win32',
    // Windows PATH search only appends .com and .exe, so the bare name finds nothing.
    resolveExecutable: (name) => (name === 'codex' ? 'C:\\Users\\dev\\AppData\\Roaming\\npm\\codex.cmd' : name),
    spawnProcess: (command, args, options) => {
      invocation = { command, args, options };
      return fakeAppServerProcess();
    },
    webSocketFactory: () => new FakeWebSocket([]),
    proxy: new FakeProxy(),
    // Keeps the win32 teardown from reaching the real taskkill implementation on this host.
    terminateProcess: () => true,
  });

  try {
    await client.listConnectedThreads();
    assert.equal(invocation.command, 'cmd.exe');
    assert.deepEqual(invocation.args.slice(0, 3), ['/d', '/s', '/c']);
    assert.ok(invocation.args[3].includes('codex.cmd'));
    assert.ok(invocation.args[3].includes('app-server'));
    assert.ok(invocation.args[3].includes(CODEX_APP_SERVER_ENDPOINT));
    assert.equal(invocation.options.windowsVerbatimArguments, true);
    assert.equal(invocation.options.windowsHide, true);
    // Windows has no process groups, so the detached launch must stay off there.
    assert.equal(invocation.options.detached, false);
    assert.deepEqual(invocation.options.stdio, ['ignore', 'pipe', 'pipe']);
  } finally {
    client.close();
  }
});

test('shared app-server spawns a real Windows codex executable directly', async () => {
  let invocation = null;
  const client = new CodexAppServer({
    platform: 'win32',
    resolveExecutable: () => 'C:\\Program Files\\codex\\codex.exe',
    spawnProcess: (command, args, options) => {
      invocation = { command, args, options };
      return fakeAppServerProcess();
    },
    webSocketFactory: () => new FakeWebSocket([]),
    proxy: new FakeProxy(),
    terminateProcess: () => true,
  });

  try {
    await client.listConnectedThreads();
    assert.equal(invocation.command, 'C:\\Program Files\\codex\\codex.exe');
    assert.deepEqual(invocation.args, ['-c', 'allow_login_shell=false', 'app-server', '--listen', CODEX_APP_SERVER_ENDPOINT]);
    assert.equal(invocation.options.windowsVerbatimArguments, undefined);
    assert.equal(invocation.options.windowsHide, true);
  } finally {
    client.close();
  }
});

test('shared app-server termination reports its platform so Windows kills the whole tree', async () => {
  const terminations = [];
  const client = new CodexAppServer({
    platform: 'win32',
    resolveExecutable: () => 'C:\\npm\\codex.cmd',
    spawnProcess: () => fakeAppServerProcess(),
    webSocketFactory: () => new FakeWebSocket([]),
    proxy: new FakeProxy(),
    terminateProcess: (child, signal, platform) => {
      terminations.push({ pid: child?.pid ?? null, signal, platform });
      return true;
    },
  });

  await client.listConnectedThreads();
  client.close();
  // An orphaned app-server would keep the shared WebSocket port bound after a restart.
  assert.deepEqual(terminations, [{ pid: null, signal: 'SIGTERM', platform: 'win32' }]);
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
      `codex --dangerously-bypass-approvals-and-sandbox --cd . --remote ${SHARED_CODEX_ENDPOINT} -c check_for_update_on_startup=false`,
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
