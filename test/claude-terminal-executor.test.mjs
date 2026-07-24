import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { ClaudeExecutionRunner } from '../src/claude-execution-runner.mjs';
import { ClaudeTerminalExecutor } from '../src/claude-terminal-executor.mjs';
import {
  assistantRecordText,
  bracketedPastePayload,
  createTranscriptReader,
  injectionPromptIssue,
  isTurnFinalAssistantRecord,
  mungeClaudeCwd,
  resolveClaudeTranscriptPath,
  sanitizeInjectedPrompt,
} from '../src/claude-transcript-tail.mjs';

const ESC = String.fromCharCode(27);
const NUL = String.fromCharCode(0);
const SESSION_ID = 'a1b2c3d4-0000-0000-0000-000000000000';
const WINDOW_ID = 4242;
const TTY = '/dev/ttys042';
const PID = 111;
const TERMINAL = { terminalWindowId: WINDOW_ID, terminalTty: TTY, runtimeProcessId: PID };

// ---- pure transcript helpers -------------------------------------------------

test('mungeClaudeCwd replaces every non-alphanumeric character with a dash', () => {
  assert.equal(mungeClaudeCwd('/Users/dev/WebstormProjects/relay'), '-Users-dev-WebstormProjects-relay');
  assert.equal(mungeClaudeCwd('/tmp/a.b_c'), '-tmp-a-b-c');
});

test('resolveClaudeTranscriptPath munges the realpath-resolved cwd', () => {
  const path = resolveClaudeTranscriptPath('/var/x', SESSION_ID, {
    home: '/home/dev',
    realpathSync: (value) => (value === '/var/x' ? '/private/var/x' : value),
    existsSync: (value) => value === `/home/dev/.claude/projects/-private-var-x/${SESSION_ID}.jsonl`,
    readdirSync: () => [],
  });
  assert.equal(path, `/home/dev/.claude/projects/-private-var-x/${SESSION_ID}.jsonl`);
});

test('resolveClaudeTranscriptPath falls back to a sessionId glob across project dirs', () => {
  const target = `/home/dev/.claude/projects/-elsewhere/${SESSION_ID}.jsonl`;
  const path = resolveClaudeTranscriptPath('/repo', SESSION_ID, {
    home: '/home/dev',
    realpathSync: (value) => value,
    existsSync: (value) => value === target,
    readdirSync: () => ['-repo', '-elsewhere'],
  });
  assert.equal(path, target);
});

test('sanitizeInjectedPrompt strips ESC so a prompt cannot break out of bracketed paste', () => {
  const dangerous = `plain ${ESC}[201~ text`;
  assert.equal(sanitizeInjectedPrompt(dangerous), 'plain [201~ text');
  const payload = bracketedPastePayload(dangerous);
  assert.equal(payload, `${ESC}[200~plain [201~ text${ESC}[201~`);
  assert.equal(payload.split(`${ESC}[200~`).length, 2);
  assert.equal(payload.split(`${ESC}[201~`).length, 2);
});

test('bracketedPastePayload preserves multiline text and special characters', () => {
  const payload = bracketedPastePayload('line one\nline "two" \\ done');
  assert.equal(payload, `${ESC}[200~line one\nline "two" \\ done${ESC}[201~`);
});

test('isTurnFinalAssistantRecord treats any non-tool_use stop reason as final', () => {
  assert.equal(isTurnFinalAssistantRecord({ type: 'assistant', message: { stop_reason: 'tool_use' } }), false);
  assert.equal(isTurnFinalAssistantRecord({ type: 'assistant', message: { stop_reason: 'end_turn' } }), true);
  assert.equal(isTurnFinalAssistantRecord({ type: 'assistant', message: { stop_reason: 'max_tokens' } }), true);
  assert.equal(isTurnFinalAssistantRecord({ type: 'user', message: {} }), false);
});

test('createTranscriptReader surfaces only records appended after the offset', () => {
  let content = Buffer.from(`${JSON.stringify({ type: 'startup' })}\n`);
  const source = { size: () => content.length, readFrom: (offset) => content.subarray(offset) };
  const reader = createTranscriptReader(source, content.length);
  assert.deepEqual(reader.poll(), []);
  content = Buffer.concat([content, Buffer.from(`${JSON.stringify({ type: 'assistant', message: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'hi' }] } })}\n`)]);
  const records = reader.poll();
  assert.equal(records.length, 1);
  assert.equal(assistantRecordText(records[0]), 'hi');
});

test('injectionPromptIssue rejects NUL bytes and oversized prompts, accepts normal prompts', () => {
  assert.match(injectionPromptIssue(`ok${NUL}bad`), /NUL/i);
  assert.match(injectionPromptIssue('x'.repeat(50), { maxBytes: 10 }), /larger than/i);
  assert.equal(injectionPromptIssue('a normal multiline\nprompt "here"'), null);
});

// ---- harness -----------------------------------------------------------------

function fakeTranscript({ present = true } = {}) {
  let content = Buffer.alloc(0);
  let exists = present;
  return {
    source: {
      path: '/fake/transcript.jsonl',
      size: () => (exists ? content.length : -1),
      readFrom: (offset) => content.subarray(offset),
    },
    append(record) { exists = true; content = Buffer.concat([content, Buffer.from(`${JSON.stringify(record)}\n`)]); },
    shrinkToZero() { content = Buffer.alloc(0); },
  };
}

// Each step drives one readConnectedSession call: its status, optional transcript records
// to append, and an optional mutate hook. status:null returns a missing session.
function sessionSteps(steps, fake) {
  let i = 0;
  return {
    readConnectedSession: async () => {
      const step = steps[Math.min(i, steps.length - 1)] || {};
      i += 1;
      if (step.append && fake) for (const record of step.append) fake.append(record);
      if (step.mutate) step.mutate();
      if (step.status === null) return null;
      const status = step.status || 'idle';
      return { id: SESSION_ID, source: 'Claude interactive', cwd: '/repo', rawStatus: status, pid: PID };
    },
  };
}

function mockClock() {
  let value = 0;
  return { now: () => value, wait: async (ms) => { value += ms; await Promise.resolve(); } };
}

const baseTask = {
  id: 7,
  thread_id: SESSION_ID,
  thread_name: 'relay-9',
  repo_path: '/repo',
  prompt: 'List the files.',
  provider: 'claude',
  attachments: [],
};

function collect() {
  const events = [];
  const stderr = [];
  return {
    onEvent: (event) => events.push(event),
    onStderr: (line) => stderr.push(line),
    events,
    stderr,
    types: () => events.map((entry) => entry.event.type),
  };
}

const assistant = (stop, blocks) => ({ type: 'assistant', message: { stop_reason: stop, content: blocks } });
const text = (value) => ({ type: 'text', text: value });
const thinking = (value) => ({ type: 'thinking', thinking: value });
const toolUse = (id, name, input) => ({ type: 'tool_use', id, name, input });
const userPrompt = (value) => ({ type: 'user', message: { content: [text(value)] } });
const toolResult = (id, value) => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: value }] } });

function makeExecutor(overrides = {}) {
  const injected = [];
  const cancels = [];
  const clock = mockClock();
  const executor = new ClaudeTerminalExecutor({
    inject: async (windowId, value) => injected.push({ windowId, value }),
    sendCancel: async (windowId) => cancels.push(windowId),
    now: clock.now,
    wait: clock.wait,
    pollMs: 1000,
    ...overrides,
  });
  return { executor, injected, cancels, clock };
}

// ---- executor behaviour ------------------------------------------------------

test('terminal turn mirrors the transcript and completes on a stable idle after a final record', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  const sessions = sessionSteps([
    { status: 'idle' },
    { status: 'busy', append: [userPrompt('List the files.'), assistant('tool_use', [toolUse('t1', 'Bash', { command: 'ls' })]), toolResult('t1', 'file.txt')] },
    { status: 'busy', append: [assistant('end_turn', [text('Listed the files.')])] },
    { status: 'idle' },
    { status: 'idle' },
  ], fake);
  const { executor, injected } = makeExecutor({ sessions, openTranscript: () => fake.source });
  const io = collect();
  const task = { ...baseTask, attachments: [{ name: 'bug.png', path: '/repo/.data/tasks/7/images/bug.png' }] };

  const outcome = await executor.runTurn(task, { cancelRequested: false }, { id: SESSION_ID }, TERMINAL, io);

  assert.equal(outcome.finalResponse, 'Listed the files.');
  assert.equal(outcome.sessionId, SESSION_ID);
  assert.equal(outcome.exitCode, 0);
  assert.equal(injected.length, 1);
  assert.equal(injected[0].windowId, WINDOW_ID);
  assert.match(injected[0].value, /List the files\./);
  assert.match(injected[0].value, /\/repo\/\.data\/tasks\/7\/images\/bug\.png/);
  const started = io.events.filter((entry) => entry.event.type === 'claude/started');
  assert.equal(started.length, 1);
  assert.equal(started[0].event.sessionMode, 'terminal');
  assert.equal(io.types().includes('claude/completed'), false);
  assert.equal(io.types().includes('item/started'), true);
  assert.equal(io.types().includes('item/completed'), true);
  assert.equal(io.events.some((e) => e.event.type === 'claude/message' && /Listed the files\./.test(e.message)), true);
});

test('Issue 1: a freshly launched terminal with no transcript still runs the first turn visibly', async () => {
  const fake = fakeTranscript({ present: false }); // transcript does not exist at readiness time
  const sessions = sessionSteps([
    { status: 'idle' }, // registered + idle is enough; transcript existence is not required
    { status: 'busy', append: [{ type: 'mode' }, userPrompt('List the files.'), assistant('end_turn', [text('First turn done.')])] },
    { status: 'idle' },
    { status: 'idle' },
  ], fake);
  const { executor, injected } = makeExecutor({ sessions, openTranscript: () => fake.source });
  const outcome = await executor.runTurn(baseTask, { cancelRequested: false }, { id: SESSION_ID }, TERMINAL, collect());
  assert.equal(outcome.finalResponse, 'First turn done.');
  assert.equal(injected.length, 1); // typed into the terminal even though no transcript existed yet
});

test('terminal turn completes when the model stops on a non-end_turn reason', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  const sessions = sessionSteps([
    { status: 'idle' },
    { status: 'busy', append: [assistant('max_tokens', [text('Truncated answer.')])] },
    { status: 'idle' },
    { status: 'idle' },
  ], fake);
  const { executor } = makeExecutor({ sessions, openTranscript: () => fake.source });
  const outcome = await executor.runTurn(baseTask, { cancelRequested: false }, { id: SESSION_ID }, TERMINAL, collect());
  assert.equal(outcome.finalResponse, 'Truncated answer.');
});

test('Issue 4: a thinking-only end_turn record does not finalize before the text record flushes', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  const sessions = sessionSteps([
    { status: 'idle' },
    { status: 'busy', append: [assistant('end_turn', [thinking('deciding')])] }, // sawFinal set, no text yet
    { status: 'idle', append: [assistant('end_turn', [text('Real answer.')])] }, // text flushes one poll later
    { status: 'idle' },
  ], fake);
  const { executor } = makeExecutor({ sessions, openTranscript: () => fake.source });
  const outcome = await executor.runTurn(baseTask, { cancelRequested: false }, { id: SESSION_ID }, TERMINAL, collect());
  assert.equal(outcome.finalResponse, 'Real answer.'); // not '' and not thrown
});

test('Issue 2b: a turn that ends with no final text fails non-retryably', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  const sessions = sessionSteps([
    { status: 'idle' },
    { status: 'busy', append: [assistant('end_turn', [thinking('only thinking')])] },
    { status: 'idle' },
    { status: 'idle' },
  ], fake);
  const { executor } = makeExecutor({ sessions, openTranscript: () => fake.source });
  await assert.rejects(
    () => executor.runTurn(baseTask, { cancelRequested: false }, { id: SESSION_ID }, TERMINAL, collect()),
    (error) => { assert.equal(error.retryable, false); assert.match(error.message, /without any final text/i); return true; },
  );
});

test('Issue 2a and 6: idle without a turn-final record fails non-retryably and does not complete on intermediate text', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  const sessions = sessionSteps([
    { status: 'idle' },
    { status: 'busy', append: [assistant('tool_use', [text('Let me look...'), toolUse('t1', 'Bash', { command: 'ls' })])] },
    { status: 'idle' }, { status: 'idle' }, { status: 'idle' }, { status: 'idle' }, { status: 'idle' },
  ], fake);
  const { executor, injected } = makeExecutor({ sessions, openTranscript: () => fake.source });
  await assert.rejects(
    () => executor.runTurn(baseTask, { cancelRequested: false }, { id: SESSION_ID }, TERMINAL, collect()),
    (error) => { assert.equal(error.retryable, false); assert.match(error.message, /without a final response/i); return true; },
  );
  assert.equal(injected.length, 1); // it did inject; it just refuses to auto-retype
});

test('Issue 2: no double execution when a prompt injects but never starts', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  const sessions = sessionSteps([{ status: 'idle' }], fake); // always idle, never busy, never grows
  const { executor, injected } = makeExecutor({ sessions, openTranscript: () => fake.source, submissionTimeoutMs: 3000 });
  await assert.rejects(
    () => executor.runTurn(baseTask, { cancelRequested: false }, { id: SESSION_ID }, TERMINAL, collect()),
    (error) => { assert.equal(error.retryable, false); assert.match(error.message, /unsubmitted text/i); return true; },
  );
  assert.equal(injected.length, 1);
});

test('Issue 2c: exceeding the turn ceiling fails non-retryably', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  const sessions = sessionSteps([{ status: 'idle' }, { status: 'busy' }], fake);
  const { executor } = makeExecutor({ sessions, openTranscript: () => fake.source, turnCeilingMs: 3000 });
  await assert.rejects(
    () => executor.runTurn(baseTask, { cancelRequested: false }, { id: SESSION_ID }, TERMINAL, collect()),
    (error) => { assert.equal(error.retryable, false); assert.match(error.message, /time limit/i); return true; },
  );
});

test('Issue 2d: a failed injection fails non-retryably because the prompt may already be running', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  const sessions = sessionSteps([{ status: 'idle' }], fake);
  const { executor } = makeExecutor({
    sessions,
    openTranscript: () => fake.source,
    inject: async () => { throw new Error('osascript timed out'); },
  });
  await assert.rejects(
    () => executor.runTurn(baseTask, { cancelRequested: false }, { id: SESSION_ID }, TERMINAL, collect()),
    (error) => { assert.equal(error.retryable, false); assert.match(error.message, /may already be running/i); return true; },
  );
});

test('Issue 5: a transcript that shrinks below the turn start fails non-retryably', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' }); // injectionOffset > 0
  const sessions = sessionSteps([
    { status: 'idle' },
    { status: 'busy', mutate: () => fake.shrinkToZero() }, // transcript truncated after injection
    { status: 'busy' },
  ], fake);
  const { executor } = makeExecutor({ sessions, openTranscript: () => fake.source });
  await assert.rejects(
    () => executor.runTurn(baseTask, { cancelRequested: false }, { id: SESSION_ID }, TERMINAL, collect()),
    (error) => { assert.equal(error.retryable, false); assert.match(error.message, /shrank/i); return true; },
  );
});

test('Issue 6: session gone with only intermediate text fails; session gone after a final record completes', async () => {
  const failFake = fakeTranscript();
  failFake.append({ type: 'mode' });
  const failSessions = sessionSteps([
    { status: 'idle' },
    { status: 'busy', append: [assistant('tool_use', [text('partial')])] },
    { status: null }, { status: null }, { status: null },
  ], failFake);
  const failExec = makeExecutor({ sessions: failSessions, openTranscript: () => failFake.source });
  await assert.rejects(
    () => failExec.executor.runTurn(baseTask, { cancelRequested: false }, { id: SESSION_ID }, TERMINAL, collect()),
    (error) => { assert.equal(error.retryable, false); assert.match(error.message, /closed before the turn produced a final/i); return true; },
  );

  const okFake = fakeTranscript();
  okFake.append({ type: 'mode' });
  const okSessions = sessionSteps([
    { status: 'idle' },
    { status: 'busy', append: [assistant('end_turn', [text('Done before close.')])] },
    { status: null }, { status: null }, { status: null },
  ], okFake);
  const okExec = makeExecutor({ sessions: okSessions, openTranscript: () => okFake.source });
  const outcome = await okExec.executor.runTurn(baseTask, { cancelRequested: false }, { id: SESSION_ID }, TERMINAL, collect());
  assert.equal(outcome.finalResponse, 'Done before close.');
});

test('Issue 9: a transient discovery miss is tolerated and the turn still completes', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  const sessions = sessionSteps([
    { status: 'idle' },
    { status: 'busy', append: [assistant('end_turn', [text('Done despite a blip.')])] },
    { status: null }, // single transient miss (< grace of 3)
    { status: 'idle' },
    { status: 'idle' },
  ], fake);
  const { executor } = makeExecutor({ sessions, openTranscript: () => fake.source });
  const outcome = await executor.runTurn(baseTask, { cancelRequested: false }, { id: SESSION_ID }, TERMINAL, collect());
  assert.equal(outcome.finalResponse, 'Done despite a blip.');
});

test('Issue 8: a prompt with a NUL byte is rejected non-retryably before typing', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  const sessions = sessionSteps([{ status: 'idle' }], fake);
  const { executor, injected } = makeExecutor({ sessions, openTranscript: () => fake.source });
  await assert.rejects(
    () => executor.runTurn({ ...baseTask, prompt: `bad${NUL}prompt` }, { cancelRequested: false }, { id: SESSION_ID }, TERMINAL, collect()),
    (error) => { assert.equal(error.retryable, false); assert.match(error.message, /NUL/i); return true; },
  );
  assert.equal(injected.length, 0);
});

test('Issue 8: an oversized prompt is rejected non-retryably before typing', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  const sessions = sessionSteps([{ status: 'idle' }], fake);
  const { executor, injected } = makeExecutor({ sessions, openTranscript: () => fake.source, maxPromptBytes: 20 });
  await assert.rejects(
    () => executor.runTurn({ ...baseTask, prompt: 'x'.repeat(200) }, { cancelRequested: false }, { id: SESSION_ID }, TERMINAL, collect()),
    (error) => { assert.equal(error.retryable, false); assert.match(error.message, /limit/i); return true; },
  );
  assert.equal(injected.length, 0);
});

test('readiness fails retryably when the session stays busy and never becomes free', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  const sessions = sessionSteps([{ status: 'busy' }], fake);
  const { executor, injected } = makeExecutor({ sessions, openTranscript: () => fake.source, readinessTimeoutMs: 4000 });
  await assert.rejects(
    () => executor.runTurn(baseTask, { cancelRequested: false }, { id: SESSION_ID }, TERMINAL, collect()),
    (error) => { assert.equal(error.retryable, true); assert.match(error.message, /stayed busy/i); return true; },
  );
  assert.equal(injected.length, 0);
});

test('readiness fails non-retryably when the session disappears before typing', async () => {
  const fake = fakeTranscript();
  const sessions = sessionSteps([{ status: null }], fake);
  const { executor, injected } = makeExecutor({ sessions, openTranscript: () => fake.source, readinessTimeoutMs: 10000 });
  await assert.rejects(
    () => executor.runTurn(baseTask, { cancelRequested: false }, { id: SESSION_ID }, TERMINAL, collect()),
    (error) => { assert.equal(error.retryable, false); assert.match(error.message, /disappeared before Relay could type/i); return true; },
  );
  assert.equal(injected.length, 0);
});

test('injection-time identity check aborts retryably on a recycled tty and never types', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  const sessions = sessionSteps([{ status: 'idle' }, { status: 'idle' }], fake);
  const { executor, injected } = makeExecutor({
    sessions,
    openTranscript: () => fake.source,
    resolveTerminal: async () => ({ terminalWindowId: 9999, terminalTty: '/dev/ttys999', runtimeProcessId: 222 }), // window/tty/pid changed
  });
  await assert.rejects(
    () => executor.runTurn(baseTask, { cancelRequested: false }, { id: SESSION_ID }, TERMINAL, collect()),
    (error) => { assert.equal(error.retryable, true); assert.match(error.message, /identity changed/i); return true; },
  );
  assert.equal(injected.length, 0); // nothing typed into the recycled window
});

test('injection-time identity check passes when the window still maps to the live pid', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  const sessions = sessionSteps([
    { status: 'idle' }, // ensureReady
    { status: 'idle' }, // verifyTerminalIdentity
    { status: 'busy', append: [assistant('end_turn', [text('Verified done.')])] },
    { status: 'idle' },
    { status: 'idle' },
  ], fake);
  const { executor, injected } = makeExecutor({
    sessions,
    openTranscript: () => fake.source,
    resolveTerminal: async () => ({ ...TERMINAL }), // still the same window/tty/pid
  });
  const outcome = await executor.runTurn(baseTask, { cancelRequested: false }, { id: SESSION_ID }, TERMINAL, collect());
  assert.equal(outcome.finalResponse, 'Verified done.');
  assert.equal(injected.length, 1);
});

test('Issue 10: a long turn heartbeat uses claude/progress, not claude/waiting', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  const sessions = sessionSteps([
    { status: 'idle' },
    { status: 'busy' }, { status: 'busy' }, { status: 'busy' },
    { status: 'busy', append: [assistant('end_turn', [text('Long turn done.')])] },
    { status: 'idle' }, { status: 'idle' },
  ], fake);
  const { executor } = makeExecutor({ sessions, openTranscript: () => fake.source, heartbeatMs: 1500 });
  const io = collect();
  const outcome = await executor.runTurn(baseTask, { cancelRequested: false }, { id: SESSION_ID }, TERMINAL, io);
  assert.equal(outcome.finalResponse, 'Long turn done.');
  assert.equal(io.events.some((e) => e.event.type === 'claude/progress' && /still working/i.test(e.message)), true);
  assert.equal(io.types().includes('claude/waiting'), false); // heartbeats are not warning-styled waiting events
});

test('cancellation stops the watcher, sends a best-effort interrupt, and rejects as cancelled', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  const active = { cancelRequested: false };
  const sessions = sessionSteps([
    { status: 'idle' },
    { status: 'busy' },
    { status: 'busy', mutate: () => { active.cancelRequested = true; } },
    { status: 'busy' },
  ], fake);
  const { executor, cancels } = makeExecutor({ sessions, openTranscript: () => fake.source });
  await assert.rejects(
    () => executor.runTurn(baseTask, active, { id: SESSION_ID }, TERMINAL, collect()),
    (error) => error.cancelled === true,
  );
  assert.deepEqual(cancels, [WINDOW_ID]);
});

// ---- runner routing / fallback ----------------------------------------------

function headlessRunner(overrides = {}) {
  const spawned = [];
  const runner = new ClaudeExecutionRunner({
    spawnProcess: (command, args) => {
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.stdin = new PassThrough();
      child.kill = () => true;
      spawned.push(args);
      queueMicrotask(() => {
        child.stdout.end(`${JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'Headless done.', session_id: SESSION_ID })}\n`);
        child.emit('close', 0, null);
      });
      return child;
    },
    sessions: { readConnectedSession: async () => ({ id: SESSION_ID, source: 'Claude interactive', cwd: '/repo', rawStatus: 'idle' }) },
    terminalExecutor: { runTurn: async () => { throw new Error('terminal path must not run'); } },
    ...overrides,
  });
  return { runner, spawned };
}

test('runner uses the headless path when the platform is not darwin', async () => {
  const { runner, spawned } = headlessRunner({ platform: 'linux', resolveTerminal: async () => ({ terminalWindowId: WINDOW_ID }) });
  const outcome = await runner.run({ ...baseTask }, collect());
  assert.equal(outcome.finalResponse, 'Headless done.');
  assert.equal(spawned.length, 1);
});

test('runner uses the headless path when no owned terminal resolves on darwin', async () => {
  const { runner, spawned } = headlessRunner({ platform: 'darwin', resolveTerminal: async () => null });
  const outcome = await runner.run({ ...baseTask }, collect());
  assert.equal(outcome.finalResponse, 'Headless done.');
  assert.equal(spawned.length, 1);
});

test('runner drives the terminal executor when an owned terminal resolves on darwin', async () => {
  const spawned = [];
  let terminalCalled = null;
  const runner = new ClaudeExecutionRunner({
    spawnProcess: () => { spawned.push(true); throw new Error('headless must not spawn'); },
    sessions: { readConnectedSession: async () => ({ id: SESSION_ID, source: 'Claude interactive', cwd: '/repo', rawStatus: 'idle', pid: PID }) },
    platform: 'darwin',
    resolveTerminal: async () => ({ ...TERMINAL }),
    terminalExecutor: {
      runTurn: async (task, active, session, terminal) => {
        terminalCalled = { taskId: task.id, windowId: terminal.terminalWindowId };
        return { finalResponse: 'Terminal done.', sessionId: SESSION_ID, reportedSessionId: SESSION_ID, exitCode: 0 };
      },
    },
  });
  const io = collect();
  const outcome = await runner.run({ ...baseTask }, io);
  assert.equal(outcome.finalResponse, 'Terminal done.');
  assert.deepEqual(terminalCalled, { taskId: baseTask.id, windowId: WINDOW_ID });
  assert.equal(spawned.length, 0);
  assert.equal(io.types().includes('claude/completed'), true);
});
