import assert from 'node:assert/strict';
import test from 'node:test';
import {
  entryItem,
  eventStreamStats,
  filterEventEntries,
  groupEventEntries,
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
