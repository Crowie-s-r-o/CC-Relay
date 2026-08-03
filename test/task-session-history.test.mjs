import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeTaskPrompts } from '../public/task-prompt-history.js';
import {
  buildSessionTurns,
  sessionConversationText,
  sessionHistoryCountLabel,
  sessionStateLabel,
} from '../public/task-session-history.js';

const task = {
  id: 12,
  status: 'complete',
  prompt: 'Map the auth flow',
  created_at: '2026-08-01T09:00:00.000Z',
  finished_at: '2026-08-01T09:40:00.000Z',
};

function threeTurnPrompts() {
  return normalizeTaskPrompts(task, [
    { id: 'p1', kind: 'original', text: 'Map the auth flow', created_at: '2026-08-01T09:00:00.000Z' },
    { id: 'p2', kind: 'follow-up', text: 'Now list the token stores', created_at: '2026-08-01T09:10:00.000Z' },
    { id: 'p3', kind: 'follow-up', text: 'Write it up', created_at: '2026-08-01T09:30:00.000Z' },
  ]);
}

test('turns pair interleaved multi-message responses with the prompt that preceded them', () => {
  const turns = buildSessionTurns({
    task,
    prompts: threeTurnPrompts(),
    responses: [
      { id: 'r1', text: 'Reading the router', created_at: '2026-08-01T09:02:00.000Z' },
      { id: 'r2', text: 'Auth starts in session.mjs', created_at: '2026-08-01T09:06:00.000Z' },
      { id: 'r3', text: 'Two stores: cookie and keychain', created_at: '2026-08-01T09:12:00.000Z' },
      { id: 'r4', text: 'Draft ready', created_at: '2026-08-01T09:35:00.000Z' },
      { id: 'r5', text: 'Final summary', created_at: '2026-08-01T09:39:00.000Z' },
    ],
  });

  assert.equal(turns.length, 3);
  assert.deepEqual(turns.map((turn) => turn.responses.map((response) => response.id)), [
    ['r1', 'r2'],
    ['r3'],
    ['r4', 'r5'],
  ]);
  assert.deepEqual(turns.map((turn) => turn.finalResponse), [
    'Auth starts in session.mjs',
    'Two stores: cookie and keychain',
    'Final summary',
  ]);
  assert.deepEqual(turns.map((turn) => turn.index), [0, 1, 2]);
  assert.equal(turns.every((turn) => turn.pending === false), true);
  assert.equal(sessionHistoryCountLabel(turns), '3 turns · 5 messages');
});

test('turn ids come from the prompt so expansion survives a refresh', () => {
  const prompts = threeTurnPrompts();
  const first = buildSessionTurns({ task, prompts, responses: [] });
  const second = buildSessionTurns({
    task,
    prompts,
    responses: [{ id: 'r1', text: 'Later message', created_at: '2026-08-01T09:31:00.000Z' }],
  });

  assert.deepEqual(first.map((turn) => turn.id), ['p1', 'p2', 'p3']);
  assert.deepEqual(second.map((turn) => turn.id), first.map((turn) => turn.id));
});

test('a response recorded before the first prompt opens the conversation', () => {
  const turns = buildSessionTurns({
    task,
    prompts: threeTurnPrompts(),
    responses: [{ id: 'early', text: 'Terminal banner', created_at: '2026-08-01T08:59:00.000Z' }],
  });

  assert.deepEqual(turns[0].responses.map((response) => response.id), ['early']);
  assert.equal(turns[1].responses.length, 0);
  assert.equal(turns[2].responses.length, 0);
});

test('an unusable timestamp on either side falls back to the newest turn', () => {
  const undated = buildSessionTurns({
    task,
    prompts: threeTurnPrompts(),
    responses: [{ id: 'no-time', text: 'Ambiguous message', created_at: null }],
  });
  assert.deepEqual(undated[2].responses.map((response) => response.id), ['no-time']);

  const untimedPrompts = buildSessionTurns({
    task,
    prompts: normalizeTaskPrompts({ id: 3 }, [
      { id: 'a', kind: 'original', text: 'First' },
      { id: 'b', kind: 'follow-up', text: 'Second' },
    ]),
    responses: [{ id: 'r', text: 'Answer', created_at: '2026-08-01T09:05:00.000Z' }],
  });
  assert.deepEqual(untimedPrompts[1].responses.map((response) => response.id), ['r']);
  assert.equal(untimedPrompts[0].responses.length, 0);
});

test('pending marks only the newest empty turn of a running task', () => {
  const prompts = threeTurnPrompts();
  const running = buildSessionTurns({
    task: { ...task, status: 'running', result: null },
    prompts,
    responses: [{ id: 'r1', text: 'Working', created_at: '2026-08-01T09:05:00.000Z' }],
  });
  assert.deepEqual(running.map((turn) => turn.pending), [false, false, true]);

  const idle = buildSessionTurns({
    task: { ...task, status: 'complete', result: null },
    prompts,
    responses: [{ id: 'r1', text: 'Working', created_at: '2026-08-01T09:05:00.000Z' }],
  });
  assert.deepEqual(idle.map((turn) => turn.pending), [false, false, false]);

  const answered = buildSessionTurns({
    task: { ...task, status: 'running' },
    prompts,
    responses: [{ id: 'r1', text: 'Done', created_at: '2026-08-01T09:35:00.000Z' }],
  });
  assert.deepEqual(answered.map((turn) => turn.pending), [false, false, false]);
});

test('an older backend without responses synthesizes the newest turn from the task row', () => {
  const fromResult = buildSessionTurns({
    task: { ...task, result: 'Final write-up' },
    prompts: threeTurnPrompts(),
  });
  assert.deepEqual(fromResult[2].responses, [
    { id: 'task-result', text: 'Final write-up', created_at: '2026-08-01T09:40:00.000Z' },
  ]);
  assert.equal(fromResult[2].finalResponse, 'Final write-up');
  assert.equal(fromResult[0].responses.length, 0);

  const fromError = buildSessionTurns({
    task: { ...task, result: null, error: 'Codex exited with code 1' },
    prompts: threeTurnPrompts(),
    responses: [],
  });
  assert.deepEqual(fromError[2].responses, [
    { id: 'task-error', text: 'Codex exited with code 1', created_at: '2026-08-01T09:40:00.000Z' },
  ]);

  const noFinishedAt = buildSessionTurns({
    task: { id: 4, prompt: 'Only ask', created_at: '2026-08-01T09:00:00.000Z', result: 'Done' },
    prompts: normalizeTaskPrompts({ id: 4, prompt: 'Only ask', created_at: '2026-08-01T09:00:00.000Z' }, []),
  });
  assert.deepEqual(noFinishedAt[0].responses.map((response) => response.created_at), ['2026-08-01T09:00:00.000Z']);
});

test('blank responses fall back and a promptless task returns no turns', () => {
  const blank = buildSessionTurns({
    task: { ...task, result: 'Recovered result' },
    prompts: threeTurnPrompts(),
    responses: [{ id: 'empty', text: '   ', created_at: '2026-08-01T09:05:00.000Z' }],
  });
  assert.deepEqual(blank[2].responses.map((response) => response.id), ['task-result']);

  assert.deepEqual(buildSessionTurns({ task: { id: 9 }, prompts: [], responses: [] }), []);
  assert.deepEqual(buildSessionTurns({}), []);
  assert.deepEqual(buildSessionTurns(), []);
  assert.equal(sessionHistoryCountLabel([]), '0 turns · 0 messages');
});

test('conversation text numbers every turn and keeps every message', () => {
  const turns = buildSessionTurns({
    task: { ...task, status: 'running' },
    prompts: threeTurnPrompts(),
    responses: [
      { id: 'r1', text: 'Reading the router', created_at: '2026-08-01T09:02:00.000Z' },
      { id: 'r2', text: 'Auth starts in session.mjs', created_at: '2026-08-01T09:06:00.000Z' },
    ],
  });

  assert.equal(sessionConversationText(turns, { responseLabel: 'Codex' }), [
    '01 · You',
    'Map the auth flow',
    '',
    '01 · Codex',
    'Reading the router',
    '',
    'Auth starts in session.mjs',
    '',
    '02 · You',
    'Now list the token stores',
    '',
    '02 · Codex',
    'No response recorded.',
    '',
    '03 · You',
    'Write it up',
    '',
    '03 · Codex',
    'Response pending.',
  ].join('\n'));

  assert.equal(sessionConversationText([]), '');
  assert.equal(sessionConversationText(undefined), '');
  assert.match(sessionConversationText(turns), /01 · Response/);
});

test('session state labels stay factual for every terminal state', () => {
  assert.equal(sessionStateLabel('open-idle').label, 'Terminal open');
  assert.match(sessionStateLabel('open-idle').hint, /waiting for the next turn/);
  assert.equal(sessionStateLabel('open-busy').label, 'Terminal busy');
  assert.match(sessionStateLabel('open-busy').hint, /working/);
  assert.equal(sessionStateLabel('closed').label, 'Terminal closed');
  assert.match(sessionStateLabel('closed').hint, /Continue session relaunches the saved conversation/);
  assert.equal(sessionStateLabel('pending').label, 'Terminal pending');
  assert.equal(sessionStateLabel('nonsense').label, 'Terminal state unknown');
});
