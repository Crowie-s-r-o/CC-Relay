import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { RelayDatabase } from '../src/database.mjs';
import { TerminalHistorySync } from '../src/terminal-history.mjs';
import { withRelayNonInteractiveInstruction } from '../src/relay-prompt.mjs';
import { buildStandupPrompt, selectStandupTasks } from '../src/standup-generator.mjs';
import { tasksForStandupDays } from '../public/standup-summary.js';

const THREAD = '00000000-1111-4222-8333-444444444444';
const FIRST = '2026-09-01T09:00:00.000Z';
const FIRST_END = '2026-09-01T09:05:00.000Z';
const NEXT = '2026-09-02T10:00:00.000Z';
const NEXT_END = '2026-09-02T10:03:00.000Z';
const jsonl = (records) => records.map((record) => JSON.stringify(record)).join('\n') + '\n';

function setup(t, provider = 'codex') {
  const home = mkdtempSync(join(tmpdir(), 'relay-terminal-history-'));
  const repo = join(home, 'project');
  mkdirSync(repo);
  const database = new RelayDatabase(join(home, 'relay.sqlite'));
  const task = database.createTask({
    prompt: 'Build the view.', title: 'View', provider,
    thread: { id: THREAD, cwd: repo, title: 'Task session', source: 'cli' },
  });
  database.database.prepare('UPDATE tasks SET created_at = ? WHERE id = ?').run(FIRST, task.id);
  database.beginTaskAttempt(task.id, {
    attemptStartedAt: FIRST, changes: { status: 'running', started_at: FIRST },
  });
  database.completeTaskAttempt(task.id, {
    attemptStartedAt: FIRST, attemptFinishedAt: FIRST_END,
    changes: { status: 'complete', finished_at: FIRST_END, result: 'Built the view.' },
  });
  const path = provider === 'codex'
    ? join(home, '.codex', 'sessions', '2026', '09', '02', `rollout-2026-09-02T10-00-00-${THREAD}.jsonl`)
    : join(home, '.claude', 'projects', 'project', `${THREAD}.jsonl`);
  mkdirSync(dirname(path), { recursive: true });
  const diagnostics = [];
  const changes = [];
  const sync = new TerminalHistorySync({ database, home, diagnostic: (...args) => diagnostics.push(args), changed: (id) => changes.push(id) });
  t.after(async () => { await sync.stop(); database.close(); rmSync(home, { recursive: true, force: true }); });
  const write = (records) => writeFileSync(path, jsonl(records));
  const append = (records) => appendFileSync(path, jsonl(records));
  const meta = { type: 'session_meta', timestamp: FIRST, payload: { id: THREAD, cwd: repo, source: 'cli' } };
  const claude = (type, at, id, content, extra = {}) => ({
    type, timestamp: at, uuid: id, sessionId: THREAD, cwd: repo,
    message: { role: type, content, ...(type === 'assistant' ? { stop_reason: 'end_turn' } : {}) },
    ...extra,
  });
  return { home, repo, path, database, task, sync, diagnostics, changes, write, append, meta, claude };
}

function codexTurn(id, start, end, prompt, answer, outcome = 'task_complete') {
  return [
    { type: 'event_msg', timestamp: start, payload: { type: 'task_started', turn_id: id } },
    { type: 'response_item', timestamp: start, payload: { type: 'message', role: 'user', id: `${id}-user`, content: [{ type: 'input_text', text: prompt }] } },
    ...(answer ? [{ type: 'response_item', timestamp: end, payload: { type: 'message', role: 'assistant', phase: 'final_answer', id: `${id}-answer`, content: [{ type: 'output_text', text: answer }] } }] : []),
    ...(end ? [{ type: 'event_msg', timestamp: end, payload: { type: outcome, turn_id: id, last_agent_message: answer } }] : []),
  ];
}

test('native Codex follow-ups reach history, search and both Standup date filters without mutating tasks', async (t) => {
  const f = setup(t);
  const before = f.database.getTask(f.task.id);
  f.write([
    f.meta,
    ...codexTurn('first', FIRST, FIRST_END, withRelayNonInteractiveInstruction('Build the view.'), 'Built the view.'),
    ...codexTurn('followup', NEXT, NEXT_END, 'Fix terminal capture.', 'Fixed terminal follow-up capture.'),
  ]);
  await f.sync.sync();
  assert.deepEqual(f.diagnostics, []);
  assert.deepEqual(f.database.getTask(f.task.id), before);
  assert.equal(f.database.listTasks().length, 1);
  assert.equal(f.database.conversationMetricsMap(f.task.id).get(f.task.id).attempt_count, 1);
  assert.deepEqual(f.database.listTaskPrompts(f.task.id).map((item) => item.text), ['Build the view.', 'Fix terminal capture.']);
  const responses = f.database.listTaskResponses(f.task.id);
  assert.deepEqual(responses.map((item) => item.text), ['Built the view.', 'Fixed terminal follow-up capture.']);
  assert.equal(responses[1].created_at, NEXT_END);
  const executions = f.database.taskAttemptsMap(f.task.id).get(f.task.id);
  assert.equal(executions.length, 2);
  assert.deepEqual(executions[1], { started_at: NEXT, finished_at: NEXT_END, duration_ms: 180_000, outcome: 'complete', source: 'terminal' });
  const selected = selectStandupTasks([{ ...before, executions }], { projectPath: f.repo, start: '2026-09-02T00:00:00Z', end: '2026-09-03T00:00:00Z' });
  assert.equal(selected.length, 1);
  assert.equal(tasksForStandupDays([{ ...before, execution_starts: [FIRST, NEXT] }], new Date(NEXT)).length, 1);
  const prompt = buildStandupPrompt([{ ...before, executions, prompts: f.database.listTaskPrompts(f.task.id), responses }]);
  assert.match(prompt, /Fix terminal capture/);
  assert.match(prompt, /Fixed terminal follow-up capture/);
  assert.ok(f.database.listTaskSearchDocuments(f.repo)[0].commands.includes('Fix terminal capture.'));
});

test('incremental sync, duplicate native events, concurrent calls, restart and file replacement are idempotent', async (t) => {
  const f = setup(t);
  const records = [f.meta, ...codexTurn('native', NEXT, NEXT_END, 'Polish the result.', 'Polished.')];
  records.splice(3, 0, { type: 'event_msg', timestamp: NEXT, payload: { type: 'user_message', message: 'Polish the result.' } });
  f.write(records);
  await Promise.all([f.sync.sync(), f.sync.sync(), f.sync.sync()]);
  const before = [f.database.listTaskPrompts(f.task.id), f.database.listTaskResponses(f.task.id), f.database.taskAttemptsMap(f.task.id)];
  await f.sync.sync();
  const replay = new TerminalHistorySync({ database: f.database, home: f.home });
  await replay.sync();
  await replay.stop();
  rmSync(f.path);
  f.write(records);
  await f.sync.sync();
  assert.deepEqual([f.database.listTaskPrompts(f.task.id), f.database.listTaskResponses(f.task.id), f.database.taskAttemptsMap(f.task.id)], before);
  assert.equal(before[0].length, 2);
  assert.equal(before[1].length, 2);
});

test('partial UTF-8 JSONL and oversized tool rows never lose the next follow-up', async (t) => {
  const f = setup(t);
  f.write([f.meta]);
  const records = codexTurn('partial', NEXT, NEXT_END, 'Correct café display.', 'Corrected café display.');
  const bytes = Buffer.from(jsonl(records));
  const cut = bytes.indexOf(Buffer.from('é')) + 1;
  appendFileSync(f.path, bytes.subarray(0, cut));
  await f.sync.sync();
  assert.equal(f.database.listTaskPrompts(f.task.id).length, 1);
  appendFileSync(f.path, bytes.subarray(cut));
  appendFileSync(f.path, JSON.stringify({ type: 'tool', text: 'x'.repeat(2 * 1024 * 1024) }) + '\n');
  f.append(codexTurn('next', '2026-09-03T10:00:00Z', '2026-09-03T10:02:00Z', 'Check again.', 'Checked again.'));
  await f.sync.sync();
  assert.deepEqual(f.database.listTaskPrompts(f.task.id).map((item) => item.text), ['Build the view.', 'Correct café display.', 'Check again.']);
  assert.deepEqual(f.diagnostics, []);
});

test('Relay follow-up receipts and native steering share their original execution attempt', async (t) => {
  const f = setup(t);
  f.database.beginTaskAttempt(f.task.id, { attemptStartedAt: NEXT, changes: { status: 'running', started_at: NEXT, finished_at: null } });
  const event = f.database.addEvent(f.task.id, 'codex', 'Relay follow-up', { type: 'item/completed', item: { type: 'userMessage', id: 'relay-follow-up-1', content: [{ type: 'text', text: 'Change\tthe label.' }] } });
  f.database.database.prepare('UPDATE events SET created_at = ? WHERE id = ?').run(NEXT, event.id);
  f.write([f.meta, ...codexTurn('relay-next', NEXT, NEXT_END, withRelayNonInteractiveInstruction('Change    the label.'), 'Changed the label.')]);
  f.append(codexTurn('steer', '2026-09-02T10:04:00Z', '2026-09-02T10:05:00Z', 'Use a shorter label.', 'Shortened the label.'));
  await f.sync.sync();
  assert.equal(f.database.taskAttemptsMap(f.task.id).get(f.task.id).length, 2);
  assert.deepEqual(f.database.listTaskPrompts(f.task.id).map((item) => item.text), ['Build the view.', 'Change\tthe label.', 'Use a shorter label.']);
  f.database.completeTaskAttempt(f.task.id, { attemptStartedAt: NEXT, attemptFinishedAt: '2026-09-02T10:06:00Z', changes: { status: 'complete', finished_at: '2026-09-02T10:06:00Z' } });
  assert.equal(f.database.taskAttemptsMap(f.task.id).get(f.task.id).length, 2);
});

test('identical prompts on later terminal days remain separate follow-ups and crossing midnight uses start time', async (t) => {
  const f = setup(t);
  f.write([f.meta, ...codexTurn('repeat', '2026-09-02T23:59:00Z', '2026-09-03T00:02:00Z', 'Build the view.', 'Rebuilt with the new inputs.')]);
  await f.sync.sync();
  assert.equal(f.database.listTaskPrompts(f.task.id).length, 2);
  const task = { ...f.database.getTask(f.task.id), executions: f.database.taskAttemptsMap(f.task.id).get(f.task.id) };
  assert.equal(selectStandupTasks([task], { projectPath: f.repo, start: '2026-09-02T00:00:00Z', end: '2026-09-03T00:00:00Z' }).length, 1);
  assert.equal(selectStandupTasks([task], { projectPath: f.repo, start: '2026-09-03T00:00:00Z', end: '2026-09-04T00:00:00Z' }).length, 0);
});

test('unknown, unfinished and cancelled Codex turns never count as completed Standup work', async (t) => {
  const f = setup(t);
  f.write([f.meta, ...codexTurn('cancel', NEXT, NEXT_END, 'Try a fix.', 'Incomplete.', 'turn_aborted'), ...codexTurn('pending', '2026-09-03T10:00:00Z', null, 'Try again.', '')]);
  await f.sync.sync();
  const executions = f.database.taskAttemptsMap(f.task.id).get(f.task.id);
  assert.deepEqual(executions.map((entry) => entry.outcome), ['complete', 'cancelled', null]);
  assert.equal(selectStandupTasks([{ ...f.task, executions }], { projectPath: f.repo, start: '2026-09-02T00:00:00Z', end: '2026-09-04T00:00:00Z' }).length, 0);
});

test('foreign session, foreign workspace, pre-task history and context-only Codex turns are excluded', async (t) => {
  const f = setup(t);
  f.write([{ ...f.meta, payload: { ...f.meta.payload, id: 'foreign' } }, ...codexTurn('foreign', NEXT, NEXT_END, 'Secret.', 'Secret result.')]);
  await f.sync.sync();
  assert.equal(f.database.listTaskPrompts(f.task.id).length, 1);
  f.write([f.meta,
    ...codexTurn('old', '2026-08-31T09:00:00Z', '2026-08-31T09:01:00Z', 'Old work.', 'Old result.'),
    ...codexTurn('context', NEXT, NEXT_END, '<environment_context>metadata</environment_context>', 'Automatic continuation.'),
    ...codexTurn('wrong-cwd', '2026-09-03T09:00:00Z', '2026-09-03T09:01:00Z', 'Foreign project.', 'Wrong project.'),
  ].flatMap((record) => record.payload?.turn_id === 'wrong-cwd' && record.payload?.type === 'task_started'
    ? [record, { type: 'turn_context', timestamp: record.timestamp, payload: { cwd: '/synthetic/foreign' } }] : [record]));
  f.sync.readers.clear();
  await f.sync.sync();
  assert.equal(f.database.listTaskPrompts(f.task.id).length, 1);
  assert.equal(f.database.taskAttemptsMap(f.task.id).get(f.task.id).length, 1);
});

test('legacy shared conversations attribute a terminal turn to only the most recent task owner', async (t) => {
  const f = setup(t);
  const other = f.database.createTask({ title: 'Next task', prompt: 'Other work.', provider: 'codex', thread: { id: THREAD, cwd: f.repo, source: 'cli' } });
  f.database.beginTaskAttempt(other.id, { attemptStartedAt: '2026-09-02T09:00:00Z', changes: { status: 'running', started_at: '2026-09-02T09:00:00Z' } });
  f.database.completeTaskAttempt(other.id, { attemptFinishedAt: '2026-09-02T09:05:00Z', changes: { status: 'complete', finished_at: '2026-09-02T09:05:00Z' } });
  f.write([f.meta, ...codexTurn('native', NEXT, NEXT_END, 'Follow the latest task.', 'Followed it.')]);
  await f.sync.sync();
  assert.equal(f.database.listTaskPrompts(f.task.id).length, 1);
  assert.equal(f.database.listTaskPrompts(other.id).length, 2);
});

test('Claude terminal prompts and explicit final answers are captured after the Relay watcher has stopped', async (t) => {
  const f = setup(t, 'claude');
  f.write([
    f.claude('user', FIRST, 'original', withRelayNonInteractiveInstruction('Build the view.')),
    f.claude('assistant', FIRST_END, 'original-answer', [{ type: 'text', text: 'Built the view.' }]),
    f.claude('user', NEXT, 'next', [{ type: 'text', text: 'Fix Claude capture.' }]),
    f.claude('assistant', NEXT_END, 'next-answer', [{ type: 'text', text: 'Fixed Claude capture.' }]),
  ]);
  await f.sync.sync();
  assert.deepEqual(f.database.listTaskPrompts(f.task.id).map((item) => item.text), ['Build the view.', 'Fix Claude capture.']);
  assert.equal(f.database.listTaskResponses(f.task.id).at(-1).text, 'Fixed Claude capture.');
  assert.equal(f.database.taskAttemptsMap(f.task.id).get(f.task.id)[1].started_at, NEXT);
  assert.equal(f.database.taskAttemptsMap(f.task.id).get(f.task.id)[1].outcome, 'complete');
  assert.deepEqual(f.diagnostics, []);
});

test('Claude ignores tool results, compaction, queued drafts, sidechains, bookkeeping, errors and unfinished output', async (t) => {
  const f = setup(t, 'claude');
  f.write([
    f.claude('user', NEXT, 'foreign', 'Other session.', { sessionId: 'foreign' }),
    f.claude('user', NEXT, 'agent', 'Agent work.', { isSidechain: true }),
    f.claude('user', NEXT, 'compact', 'Summary.', { isCompactSummary: true }),
    f.claude('user', NEXT, 'meta', 'Metadata.', { isMeta: true }),
    f.claude('user', NEXT, 'tool', [{ type: 'tool_result', content: 'Tool output.' }]),
    f.claude('user', NEXT, 'bookkeeping', '<command-name>/compact</command-name>'),
    f.claude('user', NEXT, 'notice', '<task-notification>Agent done.</task-notification>'),
    { type: 'queue-operation', operation: 'enqueue', timestamp: NEXT, sessionId: THREAD, content: 'An unsubmitted draft.' },
    f.claude('user', NEXT, 'real', 'Real work.'),
    f.claude('assistant', NEXT_END, 'error', [{ type: 'text', text: 'API Error.' }], { isApiErrorMessage: true }),
    f.claude('user', '2026-09-03T10:00:00Z', 'pending', 'Pending work.'),
    f.claude('assistant', '2026-09-03T10:01:00Z', 'stream', [], { message: { stop_reason: null, content: [{ type: 'text', text: 'Working...' }] } }),
  ]);
  await f.sync.sync();
  assert.deepEqual(f.database.listTaskPrompts(f.task.id).map((item) => item.text), ['Build the view.', 'Real work.', 'Pending work.']);
  assert.deepEqual(f.database.taskAttemptsMap(f.task.id).get(f.task.id).map((entry) => entry.outcome), ['complete', 'failed', null]);
  assert.ok(!f.database.listTaskResponses(f.task.id).some((item) => item.text === 'API Error.'));
});

test('history survives database reopen and deletion cascades through the imported ledger', async (t) => {
  const f = setup(t);
  f.write([f.meta, ...codexTurn('persist', NEXT, NEXT_END, 'Persist this follow-up.', 'Persisted.')]);
  await f.sync.sync();
  const reopened = new RelayDatabase(join(f.home, 'relay.sqlite'));
  try {
    assert.equal(reopened.listTaskPrompts(f.task.id).at(-1).text, 'Persist this follow-up.');
    assert.equal(reopened.taskAttemptsMap(f.task.id).get(f.task.id).length, 2);
    reopened.deleteTask(f.task.id);
    assert.equal(reopened.database.prepare('SELECT COUNT(*) AS count FROM terminal_history_messages').get().count, 0);
    assert.equal(reopened.database.prepare('SELECT COUNT(*) AS count FROM terminal_history_turns').get().count, 0);
  } finally { reopened.close(); }
});

test('task lists and both Standup endpoints synchronize provider persistence before source selection', () => {
  const server = readFileSync(new URL('../src/server.mjs', import.meta.url), 'utf8');
  for (const route of ['/api/tasks', '/api/standup/generate', '/api/standup/follow-up']) {
    const start = server.indexOf(`pathname === '${route}'`);
    const body = server.slice(start, server.indexOf('\n      return;', start));
    assert.match(body, /await terminalHistory\.sync\(/u);
    if (route.startsWith('/api/standup/')) {
      assert.match(body, /await terminalHistory\.sync\(\{ refreshPaths: true \}\)/u);
      assert.ok(body.indexOf('await terminalHistory.sync(') < body.indexOf('standupSourceFromRequest(body)'));
    }
  }
  assert.match(server, /await terminalHistory\.stop\(\)/u);
});

test('terminal-only prompts and completions advance the summary revision used by selected detail refresh', async (t) => {
  const f = setup(t);
  const before = f.database.listTaskSummaries()[0];
  f.write([f.meta, ...codexTurn('live', NEXT, null, 'Native input.', '')]);
  await f.sync.sync();
  const running = f.database.listTaskSummaries()[0];
  assert.equal(running.latest_event_id, before.latest_event_id);
  assert.ok(running.terminal_history_revision > before.terminal_history_revision);
  f.append([{ type: 'event_msg', timestamp: NEXT_END, payload: { type: 'task_complete', turn_id: 'live', last_agent_message: 'Captured.' } }]);
  await f.sync.sync();
  assert.ok(f.database.listTaskSummaries()[0].terminal_history_revision > running.terminal_history_revision);
});

test('Claude queued terminal messages use proven consumption time rather than their earlier enqueue date', async (t) => {
  const f = setup(t, 'claude');
  f.write([
    f.claude('user', FIRST, 'original', withRelayNonInteractiveInstruction('Build the view.')),
    f.claude('assistant', FIRST_END, 'original-response', [{ type: 'text', text: 'Built the view.' }]),
    { type: 'queue-operation', operation: 'enqueue', sessionId: THREAD, timestamp: '2026-09-01T23:59:00Z', content: 'Consume tomorrow.' },
    { type: 'queue-operation', operation: 'remove', sessionId: THREAD, timestamp: NEXT, content: 'Consume tomorrow.' },
    { type: 'attachment', uuid: 'consumed', sessionId: THREAD, timestamp: '2026-09-01T23:59:00Z', attachment: { type: 'queued_command', prompt: 'Consume tomorrow.', origin: { kind: 'human' } } },
    f.claude('assistant', NEXT_END, 'consumed-response', [{ type: 'text', text: 'Consumed on the next day.' }]),
  ]);
  await f.sync.sync();
  assert.equal(f.database.listTaskPrompts(f.task.id).at(-1).text, 'Consume tomorrow.');
  assert.equal(f.database.listTaskPrompts(f.task.id).at(-1).created_at, NEXT);
  assert.equal(f.database.taskAttemptsMap(f.task.id).get(f.task.id).at(-1).started_at, NEXT);
});

test('Claude requires a fresh final after background agents finish', async (t) => {
  const f = setup(t, 'claude');
  f.write([
    f.claude('user', NEXT, 'background', 'Check with a worker.'),
    f.claude('user', NEXT, 'background-result', [{ type: 'tool_result', tool_use_id: 'tool-worker', content: 'Worker launched.' }], { toolUseResult: { isAsync: true, agentId: 'worker' } }),
    f.claude('assistant', NEXT_END, 'interim', [{ type: 'text', text: 'The worker is checking.' }]),
  ]);
  await f.sync.sync();
  assert.equal(f.database.taskAttemptsMap(f.task.id).get(f.task.id).at(-1).outcome, null);
  f.append([{ type: 'queue-operation', operation: 'enqueue', timestamp: '2026-09-02T10:04:00Z', sessionId: THREAD, content: '<task-notification><task-id>worker</task-id><tool-use-id>tool-worker</tool-use-id><status>completed</status><summary>Checked.</summary></task-notification>' }]);
  await f.sync.sync();
  assert.equal(f.database.taskAttemptsMap(f.task.id).get(f.task.id).at(-1).outcome, null);
  f.append([f.claude('assistant', '2026-09-02T10:05:00Z', 'consolidated', [{ type: 'text', text: 'Verified the worker result.' }])]);
  await f.sync.sync();
  assert.equal(f.database.taskAttemptsMap(f.task.id).get(f.task.id).at(-1).outcome, 'complete');
});

test('Claude positive pending counts invalidate interim completion and API Error finals remain failed', async (t) => {
  const f = setup(t, 'claude');
  f.write([
    f.claude('user', NEXT, 'pending-count', 'Wait for verification.'),
    f.claude('assistant', NEXT_END, 'interim', [{ type: 'text', text: 'An interim result.' }]),
    f.claude('system', NEXT_END, 'pending-count-event', [], { subtype: 'turn_duration', pendingBackgroundAgentCount: 1 }),
  ]);
  await f.sync.sync();
  assert.equal(f.database.taskAttemptsMap(f.task.id).get(f.task.id).at(-1).outcome, null);
  f.append([
    f.claude('system', '2026-09-02T10:04:00Z', 'zero-count-event', [], { subtype: 'turn_duration', pendingBackgroundAgentCount: 0 }),
    f.claude('assistant', '2026-09-02T10:05:00Z', 'api-error', [{ type: 'text', text: 'API Error: overloaded.' }]),
  ]);
  await f.sync.sync();
  assert.equal(f.database.taskAttemptsMap(f.task.id).get(f.task.id).at(-1).outcome, 'failed');
});

for (const provider of ['codex', 'claude']) {
  test(`${provider} image-only terminal follow-ups keep their own execution boundary`, async (t) => {
    const f = setup(t, provider);
    if (provider === 'codex') {
      const turn = codexTurn('image', NEXT, NEXT_END, '', 'Corrected the screenshot issue.');
      turn[1].payload.content = [{ type: 'input_image', image_url: 'data:image/png;base64,synthetic' }];
      f.write([f.meta, ...turn]);
    } else {
      f.write([
        f.claude('user', NEXT, 'image', [{ type: 'image', source: { type: 'base64', data: 'synthetic' } }]),
        f.claude('assistant', NEXT_END, 'answer', [{ type: 'text', text: 'Corrected the screenshot issue.' }]),
      ]);
    }
    await f.sync.sync();
    assert.equal(f.database.listTaskPrompts(f.task.id).at(-1).text, '[Image attachment]');
    assert.equal(f.database.taskAttemptsMap(f.task.id).get(f.task.id).at(-1).outcome, 'complete');
  });
}

test('Standup bounds prioritize the selected terminal day over more recent unrelated follow-ups', () => {
  const later = Array.from({ length: 20 }, (_, i) => ({ text: `Later conversation ${i}`, created_at: '2026-09-04T10:00:00Z', execution_started_at: '2026-09-04T09:00:00Z' }));
  const prompt = buildStandupPrompt([{
    id: 1, status: 'complete',
    executions: [{ started_at: NEXT, finished_at: NEXT_END, outcome: 'complete', selectedForRange: true, source: 'terminal' }],
    prompts: [{ kind: 'original', text: 'Original.', created_at: FIRST }, { text: 'Selected native request.', created_at: NEXT, execution_started_at: NEXT, source: 'terminal' }, ...later],
    responses: [{ text: 'Confirmed selected native fix.', created_at: NEXT_END, execution_started_at: NEXT, source: 'terminal' }, ...later],
  }]);
  assert.match(prompt, /Selected native request/);
  assert.match(prompt, /Confirmed selected native fix/);
  assert.match(prompt, /"source": "terminal"/);
  assert.match(prompt, /"executionStartedAt": "2026-09-02T10:00:00.000Z"/);
});

test('Standup path refresh discovers a transcript created after a cached directory scan', async (t) => {
  const f = setup(t);
  await f.sync.sync();
  f.write([f.meta, ...codexTurn('new-file', NEXT, NEXT_END, 'A newly saved follow-up.', 'New work saved.')]);
  await f.sync.sync({ refreshPaths: true });
  assert.equal(f.database.listTaskPrompts(f.task.id).at(-1).text, 'A newly saved follow-up.');
});

test('repeated terminal results remain dated evidence for each separate execution', async (t) => {
  const f = setup(t);
  f.write([f.meta,
    ...codexTurn('one', NEXT, NEXT_END, 'Rebuild with current inputs.', 'Built the view.'),
    ...codexTurn('two', '2026-09-03T10:00:00Z', '2026-09-03T10:02:00Z', 'Rebuild again.', 'Built the view.'),
  ]);
  await f.sync.sync();
  assert.deepEqual(f.database.listTaskResponses(f.task.id).map((item) => item.created_at), [FIRST_END, NEXT_END, '2026-09-03T10:02:00.000Z']);
});

test('a terminal turn starting exactly at the preceding attempt finish is its own execution', async (t) => {
  const f = setup(t);
  f.write([f.meta, ...codexTurn('boundary', FIRST_END, '2026-09-01T09:06:00Z', 'Build the view.', 'Built again.')]);
  await f.sync.sync();
  assert.equal(f.database.listTaskPrompts(f.task.id).length, 2);
  assert.equal(f.database.taskAttemptsMap(f.task.id).get(f.task.id).length, 2);
});

test('completed Turbo executor sessions capture native follow-ups while excluding workflow and planner prompts', async (t) => {
  const f = setup(t);
  f.database.updateTask(f.task.id, { mode: 'turbo', terminal_lifecycle: 'disposable', turbo_json: JSON.stringify({ executionThreadId: THREAD }) });
  f.write([f.meta,
    ...codexTurn('workflow', FIRST, FIRST_END, 'Internal execution graph.', 'Executed graph.'),
    ...codexTurn('followup', NEXT, NEXT_END, 'Refine the executor result.', 'Refined result.'),
  ]);
  await f.sync.sync();
  assert.deepEqual(f.database.listTaskPrompts(f.task.id).map((item) => item.text), ['Build the view.', 'Refine the executor result.']);
  assert.equal(f.database.taskAttemptsMap(f.task.id).get(f.task.id).length, 2);
  f.database.updateTask(f.task.id, { turbo_json: JSON.stringify({ executionThreadId: 'different-executor' }) });
  assert.deepEqual(f.database.terminalHistoryTasks(), []);
});
