import assert from 'node:assert/strict';
import test from 'node:test';
import {
  activeSubAgentCount,
  entryItem,
  eventStreamStats,
  filterEventEntries,
  groupEventEntries,
  isSubAgentEntry,
  subAgentEntryState,
} from '../public/event-stream.js';

function itemEvent(id, phase, type, overrides = {}) {
  return {
    id: overrides.eventId || id,
    kind: overrides.kind || 'codex',
    message: `${type} ${phase}.`,
    created_at: overrides.createdAt || '2026-07-16T10:00:00.000Z',
    payload: {
      type: `item/${phase}`,
      item: { id, type, ...overrides.item },
    },
  };
}

test('event stream groups item start and completion into one signal', () => {
  const events = [
    { id: 1, kind: 'queue', message: 'Task started.', created_at: '2026-07-16T10:00:00.000Z', payload: null },
    itemEvent('command-1', 'started', 'commandExecution', { eventId: 2, item: { command: 'npm test' } }),
    itemEvent('command-1', 'completed', 'commandExecution', {
      eventId: 3,
      item: { command: 'npm test', exitCode: 0, aggregatedOutput: '22 tests passed' },
    }),
  ];

  const entries = groupEventEntries(events);
  assert.equal(entries.length, 2);
  assert.equal(entries[1].events.length, 2);
  assert.equal(entries[1].startedEvent.id, 2);
  assert.equal(entries[1].completedEvent.id, 3);
  assert.equal(entryItem(entries[1]).aggregatedOutput, '22 tests passed');
});

test('event stream summarizes execution telemetry', () => {
  const entries = groupEventEntries([
    itemEvent('command-1', 'started', 'commandExecution'),
    itemEvent('command-1', 'completed', 'commandExecution'),
    itemEvent('files-1', 'completed', 'fileChange'),
    itemEvent('message-1', 'completed', 'agentMessage'),
    itemEvent('prompt-1', 'completed', 'userMessage'),
    itemEvent('failed-1', 'completed', 'commandExecution', { item: { status: 'failed' } }),
  ]);
  assert.deepEqual(eventStreamStats(entries), {
    commands: 2,
    files: 1,
    messages: 2,
    errors: 1,
    running: 0,
    thinkingTokens: 0,
    agents: 0,
  });
});

test('live turn updates appear in the Messages filter but stay out of Highlights', () => {
  const entries = groupEventEntries([
    itemEvent('prompt-live', 'completed', 'userMessage', {
      item: { content: [{ type: 'text', text: 'Correct the current work' }] },
    }),
  ]);
  assert.equal(filterEventEntries(entries, 'messages').length, 1);
  assert.equal(filterEventEntries(entries, 'highlights').length, 0);
  assert.equal(eventStreamStats(entries).messages, 1);
});

test('event stream reports reasoning output tokens from turn completion', () => {
  const entries = groupEventEntries([{
    id: 1,
    kind: 'codex',
    message: 'Codex turn completed.',
    created_at: '2026-07-16T10:00:00.000Z',
    payload: {
      type: 'turn/completed',
      tokenUsage: { last: { reasoningOutputTokens: 4321 } },
    },
  }]);
  assert.equal(eventStreamStats(entries).thinkingTokens, 4321);
});

test('event stream highlight filter removes protocol noise but keeps useful work', () => {
  const entries = groupEventEntries([
    itemEvent('reasoning-1', 'completed', 'reasoning'),
    itemEvent('command-1', 'completed', 'commandExecution'),
    itemEvent('message-1', 'completed', 'agentMessage', { kind: 'result' }),
    { id: 4, kind: 'queue', message: 'Task completed.', created_at: '2026-07-16T10:00:04.000Z', payload: null },
  ]);

  assert.equal(filterEventEntries(entries, 'highlights').length, 3);
  assert.equal(filterEventEntries(entries, 'commands').length, 1);
  assert.equal(filterEventEntries(entries, 'messages').length, 1);
  assert.equal(filterEventEntries(entries, 'all').length, 4);
});

test('claude/progress heartbeats stay out of Highlights while claude/started remains', () => {
  const progress = groupEventEntries([{
    id: 1,
    kind: 'claude',
    message: 'Claude is still working in the relay-9 terminal.',
    created_at: '2026-07-16T10:00:00.000Z',
    payload: { type: 'claude/progress' },
  }]);
  assert.equal(filterEventEntries(progress, 'highlights').length, 0);

  const started = groupEventEntries([{
    id: 2,
    kind: 'claude',
    message: 'Claude is running this turn inside the relay-9 terminal.',
    created_at: '2026-07-16T10:00:01.000Z',
    payload: { type: 'claude/started' },
  }]);
  assert.equal(filterEventEntries(started, 'highlights').length, 1);
});

test('Claude terminal input requests remain visible in Highlights', () => {
  const entries = groupEventEntries([{
    id: 1,
    kind: 'claude',
    message: 'Claude paused in the relay-9 terminal and may be waiting for your input.',
    created_at: '2026-07-16T10:00:00.000Z',
    payload: { type: 'claude/input-required', provider: 'claude' },
  }]);

  assert.equal(filterEventEntries(entries, 'highlights').length, 1);
  assert.equal(filterEventEntries(entries, 'messages').length, 1);
});

// Sub-agent shapes below mirror the events Relay records for a real Claude team session:
// an `Agent` tool call that returns immediately, then a task notification minutes later.
function subAgentEvent(toolUseId, phase, overrides = {}) {
  const completed = phase === 'completed';
  return {
    id: overrides.eventId || 1,
    kind: 'claude',
    message: completed ? 'Sub-agent is working in the background.' : 'Claude started sub-agent.',
    created_at: overrides.createdAt || '2026-07-27T17:28:57.672Z',
    payload: {
      type: `item/${phase}`,
      provider: 'claude',
      item: {
        type: 'mcpToolCall',
        id: toolUseId,
        server: 'Claude Code',
        tool: 'Agent',
        arguments: {
          description: 'dev-1: editor layout rework',
          subagent_type: 'fullstack-engineer',
          prompt: 'You are dev-1 on the dev-team.',
        },
        status: completed ? 'completed' : 'inProgress',
        result: completed ? { content: [{ type: 'text', text: 'Async agent launched successfully.' }] } : null,
        subAgent: true,
        toolUseId,
        agentName: 'dev-1: editor layout rework',
        agentType: 'fullstack-engineer',
        ...(completed ? { backgrounded: true, agentId: 'ac125e8d59ad9fbc1' } : {}),
        ...overrides.item,
      },
    },
  };
}

function agentFinishedEvent(toolUseId, overrides = {}) {
  return {
    id: overrides.eventId || 9,
    kind: 'claude',
    message: 'Agent "dev-1: editor layout rework" finished',
    created_at: overrides.createdAt || '2026-07-27T17:45:03.085Z',
    payload: {
      type: 'claude/agent-finished',
      provider: 'claude',
      toolUseId,
      agentId: overrides.agentId || 'ac125e8d59ad9fbc1',
      status: overrides.status || 'completed',
      summary: 'Agent "dev-1: editor layout rework" finished',
      agentName: 'dev-1: editor layout rework',
    },
  };
}

test('a backgrounded sub-agent stays active until its task notification arrives', () => {
  const launch = [
    subAgentEvent('toolu_01Aso7KBUau8jdFaHD8WtB9N', 'started', { eventId: 1 }),
    subAgentEvent('toolu_01Aso7KBUau8jdFaHD8WtB9N', 'completed', { eventId: 2 }),
  ];
  const working = groupEventEntries(launch);
  assert.equal(working.length, 1);
  assert.equal(isSubAgentEntry(working[0]), true);
  assert.equal(subAgentEntryState(working[0]), 'backgrounded');
  assert.equal(activeSubAgentCount(working), 1);
  assert.equal(eventStreamStats(working).agents, 1);

  const resolved = groupEventEntries([...launch, agentFinishedEvent('toolu_01Aso7KBUau8jdFaHD8WtB9N')]);
  assert.equal(resolved.length, 1, 'the notification resolves the launch instead of adding a signal');
  assert.equal(resolved[0].events.length, 3);
  assert.equal(subAgentEntryState(resolved[0]), 'finished');
  assert.equal(activeSubAgentCount(resolved), 0);
});

test('a task notification recorded before its own launch still folds into one signal', () => {
  // Claude appends the notification out of order; task 320 recorded exactly this sequence.
  const entries = groupEventEntries([
    agentFinishedEvent('toolu_012M2JjykSAMBUw7JewJMYeX', { eventId: 1 }),
    subAgentEvent('toolu_012M2JjykSAMBUw7JewJMYeX', 'started', { eventId: 2 }),
    subAgentEvent('toolu_012M2JjykSAMBUw7JewJMYeX', 'completed', { eventId: 3 }),
  ]);

  assert.equal(entries.length, 1);
  assert.equal(entryItem(entries[0]).agentName, 'dev-1: editor layout rework');
  assert.equal(subAgentEntryState(entries[0]), 'finished');
  assert.equal(activeSubAgentCount(entries), 0);
});

test('a notification for a launch this stream never saw keeps its own signal', () => {
  // A resumed agent reports through the SendMessage tool use that woke it.
  const entries = groupEventEntries([
    subAgentEvent('toolu_01Aso7KBUau8jdFaHD8WtB9N', 'started', { eventId: 1 }),
    subAgentEvent('toolu_01Aso7KBUau8jdFaHD8WtB9N', 'completed', { eventId: 2 }),
    agentFinishedEvent('toolu_01GL9D1R3PPMn2Vh2NHRERXA', { eventId: 3 }),
  ]);

  assert.equal(entries.length, 2);
  assert.equal(isSubAgentEntry(entries[1]), true);
  assert.equal(subAgentEntryState(entries[1]), 'finished');
  // The orphan notification never resolves the unrelated launch, which is still working.
  assert.equal(activeSubAgentCount(entries), 1);
});

test('the active sub-agent count never goes negative', () => {
  const strayFinishes = groupEventEntries([
    agentFinishedEvent('toolu_01GL9D1R3PPMn2Vh2NHRERXA', { eventId: 1 }),
    agentFinishedEvent('toolu_01HRJZ5EyCSjqw1WoiKsgBoi', { eventId: 2 }),
    agentFinishedEvent('toolu_01CGSVLPYFeYywpEi2Tze2bi', { eventId: 3 }),
  ]);
  assert.equal(activeSubAgentCount(strayFinishes), 0);
  assert.equal(eventStreamStats(strayFinishes).agents, 0);

  const repeated = groupEventEntries([
    subAgentEvent('toolu_01Aso7KBUau8jdFaHD8WtB9N', 'started', { eventId: 1 }),
    subAgentEvent('toolu_01Aso7KBUau8jdFaHD8WtB9N', 'completed', { eventId: 2 }),
    agentFinishedEvent('toolu_01Aso7KBUau8jdFaHD8WtB9N', { eventId: 3 }),
    agentFinishedEvent('toolu_01Aso7KBUau8jdFaHD8WtB9N', { eventId: 4 }),
  ]);
  assert.equal(activeSubAgentCount(repeated), 0);
  assert.equal(groupEventEntries([]).length, 0);
  assert.equal(activeSubAgentCount(undefined), 0);
});

test('a finished turn owns no live sub-agents', () => {
  const entries = groupEventEntries([
    subAgentEvent('toolu_01Aso7KBUau8jdFaHD8WtB9N', 'started', { eventId: 1 }),
    subAgentEvent('toolu_01Aso7KBUau8jdFaHD8WtB9N', 'completed', { eventId: 2 }),
  ]);

  assert.equal(activeSubAgentCount(entries), 1);
  assert.equal(activeSubAgentCount(entries, { turnEnded: true }), 0);
  assert.equal(eventStreamStats(entries, { turnEnded: true }).agents, 0);
});

test('a sub-agent that answers inline finishes with its tool call', () => {
  const entries = groupEventEntries([
    subAgentEvent('toolu_01Aso7KBUau8jdFaHD8WtB9N', 'started', { eventId: 1 }),
    subAgentEvent('toolu_01Aso7KBUau8jdFaHD8WtB9N', 'completed', {
      eventId: 2,
      item: { backgrounded: false, agentId: undefined },
    }),
  ]);

  assert.equal(subAgentEntryState(entries[0]), 'finished');
  assert.equal(activeSubAgentCount(entries), 0);
});

test('a sub-agent whose launch failed is not counted as working', () => {
  const entries = groupEventEntries([
    subAgentEvent('toolu_01Aso7KBUau8jdFaHD8WtB9N', 'started', { eventId: 1 }),
    subAgentEvent('toolu_01Aso7KBUau8jdFaHD8WtB9N', 'completed', {
      eventId: 2,
      item: { status: 'failed', backgrounded: undefined },
    }),
  ]);

  assert.equal(subAgentEntryState(entries[0]), 'finished');
  assert.equal(activeSubAgentCount(entries), 0);
  assert.equal(eventStreamStats(entries).errors, 1);
});

test('sub-agent signals stay in the Highlights and Commands views', () => {
  const entries = groupEventEntries([
    subAgentEvent('toolu_01Aso7KBUau8jdFaHD8WtB9N', 'started', { eventId: 1 }),
    subAgentEvent('toolu_01Aso7KBUau8jdFaHD8WtB9N', 'completed', { eventId: 2 }),
    agentFinishedEvent('toolu_01GL9D1R3PPMn2Vh2NHRERXA', { eventId: 3 }),
  ]);

  assert.equal(filterEventEntries(entries, 'highlights').length, 2);
  assert.equal(filterEventEntries(entries, 'commands').length, 1);
  assert.equal(filterEventEntries(entries, 'all').length, 2);
});

test('legacy Agent tool calls without sub-agent metadata behave exactly as before', () => {
  const legacyStarted = subAgentEvent('toolu_legacy', 'started', { eventId: 1 });
  const legacyCompleted = subAgentEvent('toolu_legacy', 'completed', { eventId: 2 });
  for (const event of [legacyStarted, legacyCompleted]) {
    delete event.payload.item.subAgent;
    delete event.payload.item.toolUseId;
    delete event.payload.item.agentName;
    delete event.payload.item.agentType;
    delete event.payload.item.backgrounded;
    delete event.payload.item.agentId;
  }
  const entries = groupEventEntries([
    legacyStarted,
    legacyCompleted,
    agentFinishedEvent('toolu_legacy', { eventId: 3 }),
  ]);

  assert.equal(isSubAgentEntry(entries[0]), false);
  assert.equal(entries[0].events.length, 2, 'a legacy tool call is never folded');
  assert.equal(entries.length, 2);
  assert.equal(eventStreamStats(entries).agents, 0);
  assert.equal(filterEventEntries(entries, 'commands').length, 1);
});

test('event stream folds streamed reasoning summaries into one All entry', () => {
  const started = itemEvent('reasoning-live', 'started', 'reasoning');
  const first = itemEvent('reasoning-live', 'updated', 'reasoning', {
    eventId: 2,
    item: { summary: [{ text: 'Inspecting the queue' }], status: 'inProgress' },
  });
  const second = itemEvent('reasoning-live', 'updated', 'reasoning', {
    eventId: 3,
    item: { summary: [{ text: 'Inspecting the queue and terminal bridge.' }], status: 'inProgress' },
  });
  const entries = groupEventEntries([started, first, second]);

  assert.equal(entries.length, 1);
  assert.equal(entries[0].events.length, 3);
  assert.equal(entryItem(entries[0]).summary[0].text, 'Inspecting the queue and terminal bridge.');
  assert.equal(filterEventEntries(entries, 'highlights').length, 0);
  assert.equal(filterEventEntries(entries, 'all').length, 1);
});
