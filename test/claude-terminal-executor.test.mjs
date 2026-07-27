import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { ClaudeExecutionRunner } from '../src/claude-execution-runner.mjs';
import {
  ClaudeTerminalExecutor,
  claudeTerminalRelaunchCommand,
} from '../src/claude-terminal-executor.mjs';
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

test('Claude terminal relaunch commands pin settings and preserve the same session', () => {
  assert.equal(
    claudeTerminalRelaunchCommand({
      command: '/Applications/Claude Code/claude',
      sessionId: SESSION_ID,
      resumed: true,
      model: 'opus',
      effort: 'max',
    }),
    `'/Applications/Claude Code/claude' --dangerously-skip-permissions --resume '${SESSION_ID}' --model 'opus' --effort 'max'`,
  );
  assert.equal(
    claudeTerminalRelaunchCommand({
      sessionId: SESSION_ID,
      resumed: false,
      effort: 'high',
    }),
    `'claude' --dangerously-skip-permissions --session-id '${SESSION_ID}' --effort 'high'`,
  );
  assert.equal(
    claudeTerminalRelaunchCommand({
      sessionId: SESSION_ID,
      resumed: true,
      model: 'fable',
      effort: 'max',
      permissionMode: 'plan',
      tools: ['Read', 'Glob', 'Grep', 'AskUserQuestion'],
      addDirectories: ['/tmp/relay-plan-images'],
    }),
    `'claude' --permission-mode 'plan' --resume '${SESSION_ID}' --model 'fable' --effort 'max' --tools 'Read,Glob,Grep,AskUserQuestion' --add-dir '/tmp/relay-plan-images'`,
  );
});

// ---- harness -----------------------------------------------------------------

function fakeTranscript({ present = true } = {}) {
  let content = Buffer.alloc(0);
  let created = present;
  // A transient FS failure makes statSync throw, so both size() and existsSync report failure
  // at the same instant. The fake mirrors that coupling: while statFails is armed, size()
  // returns -1 AND exists() returns false, exactly as production would during the failure the
  // Issue 14 guard must survive without trusting a concurrent existence check.
  let statFails = 0;
  return {
    source: {
      path: '/fake/transcript.jsonl',
      exists: () => (statFails > 0 ? false : created),
      size: () => {
        if (statFails > 0) { statFails -= 1; return -1; }
        return created ? content.length : -1;
      },
      readFrom: (offset) => content.subarray(offset),
    },
    append(record) { created = true; content = Buffer.concat([content, Buffer.from(`${JSON.stringify(record)}\n`)]); },
    appendRaw(value) { created = true; content = Buffer.concat([content, Buffer.from(value)]); },
    shrinkToZero() { content = Buffer.alloc(0); },
    failStat(count = Infinity) { statFails = count; },
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
  const submitted = [];
  const cancels = [];
  const clock = mockClock();
  const executor = new ClaudeTerminalExecutor({
    inject: async (windowId, value) => injected.push({ windowId, value }),
    submit: async (windowId) => submitted.push(windowId),
    sendCancel: async (windowId) => cancels.push(windowId),
    now: clock.now,
    wait: clock.wait,
    pollMs: 1000,
    ...overrides,
  });
  return { executor, injected, submitted, cancels, clock };
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
  const { executor, injected, submitted } = makeExecutor({ sessions, openTranscript: () => fake.source });
  const io = collect();
  const task = { ...baseTask, attachments: [{ name: 'bug.png', path: '/repo/.data/tasks/7/images/bug.png' }] };

  const outcome = await executor.runTurn(task, { cancelRequested: false }, { id: SESSION_ID }, TERMINAL, io);

  assert.equal(outcome.finalResponse, 'Listed the files.');
  assert.equal(outcome.sessionId, SESSION_ID);
  assert.equal(outcome.exitCode, 0);
  assert.equal(injected.length, 1);
  assert.equal(submitted.length, 0);
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

test('terminal task restarts the same session with selected model and effort before typing', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  const actions = [];
  let read = 0;
  const sessions = {
    readConnectedSession: async () => {
      read += 1;
      if (read <= 2) {
        return {
          id: SESSION_ID,
          source: 'Claude interactive',
          cwd: '/repo',
          rawStatus: 'idle',
          pid: PID,
        };
      }
      if (read === 5) {
        fake.append(userPrompt('List the files.'));
        fake.append(assistant('end_turn', [text('Configured terminal done.')]));
        return {
          id: SESSION_ID,
          source: 'Claude interactive',
          cwd: '/repo',
          rawStatus: 'busy',
          pid: 222,
        };
      }
      return {
        id: SESSION_ID,
        source: 'Claude interactive',
        cwd: '/repo',
        rawStatus: 'idle',
        pid: 222,
      };
    },
  };
  let terminated = false;
  const clock = mockClock();
  const injected = [];
  const relaunched = [];
  const executor = new ClaudeTerminalExecutor({
    command: '/opt/claude/bin/claude',
    sessions,
    resolveTerminal: async (current) => ({
      terminalWindowId: WINDOW_ID,
      terminalTty: TTY,
      runtimeProcessId: current.pid,
    }),
    terminateProcess: async (pid) => {
      actions.push(`terminate:${pid}`);
      terminated = true;
    },
    isProcessAlive: async () => !terminated,
    relaunch: async (windowId, command) => {
      actions.push(`relaunch:${windowId}`);
      relaunched.push(command);
    },
    inject: async (windowId, value) => {
      actions.push(`inject:${windowId}`);
      injected.push(value);
    },
    now: clock.now,
    wait: clock.wait,
    pollMs: 1000,
    restartPollMs: 100,
    relaunchSettleMs: 10,
    openTranscript: () => fake.source,
  });
  const io = collect();

  const outcome = await executor.runTurn(
    { ...baseTask, model: 'opus', effort: 'max' },
    { cancelRequested: false },
    { id: SESSION_ID },
    TERMINAL,
    io,
  );

  assert.equal(outcome.finalResponse, 'Configured terminal done.');
  assert.deepEqual(actions.slice(0, 3), [
    `terminate:${PID}`,
    `relaunch:${WINDOW_ID}`,
    `inject:${WINDOW_ID}`,
  ]);
  assert.equal(relaunched.length, 1);
  assert.match(relaunched[0], /--resume/);
  assert.match(relaunched[0], /--model 'opus'/);
  assert.match(relaunched[0], /--effort 'max'/);
  assert.equal(injected.length, 1);
  const started = io.events.find((entry) => entry.event.type === 'claude/started');
  assert.equal(started.event.model, 'opus');
  assert.equal(started.event.effort, 'max');
  assert.equal(io.events.some((entry) => /terminal is ready with opus at max effort/i.test(entry.message)), true);
});

test('a cancellation during settings restart restores Claude but never types the prompt', async () => {
  const fake = fakeTranscript();
  const active = { cancelRequested: false };
  let terminated = false;
  let reads = 0;
  const sessions = {
    readConnectedSession: async () => {
      reads += 1;
      return {
        id: SESSION_ID,
        source: 'Claude interactive',
        cwd: '/repo',
        rawStatus: 'idle',
        pid: reads <= 2 ? PID : 222,
      };
    },
  };
  const relaunched = [];
  const { executor, injected } = makeExecutor({
    sessions,
    openTranscript: () => fake.source,
    resolveTerminal: async (current) => ({
      terminalWindowId: WINDOW_ID,
      terminalTty: TTY,
      runtimeProcessId: current.pid,
    }),
    terminateProcess: async () => {
      terminated = true;
      active.cancelRequested = true;
    },
    isProcessAlive: async () => !terminated,
    relaunch: async (windowId, command) => relaunched.push({ windowId, command }),
    restartPollMs: 100,
    relaunchSettleMs: 10,
  });

  await assert.rejects(
    () => executor.runTurn(
      { ...baseTask, model: 'opus', effort: 'max' },
      active,
      { id: SESSION_ID },
      TERMINAL,
      collect(),
    ),
    (error) => error.cancelled === true,
  );

  assert.equal(relaunched.length, 1);
  assert.equal(injected.length, 0);
});

test('a settings relaunch failure never sends the launch command twice or types the prompt', async () => {
  const fake = fakeTranscript();
  const sessions = sessionSteps([{ status: 'idle' }, { status: 'idle' }], fake);
  let terminated = false;
  let relaunches = 0;
  const { executor, injected } = makeExecutor({
    sessions,
    openTranscript: () => fake.source,
    resolveTerminal: async () => ({ ...TERMINAL }),
    terminateProcess: async () => { terminated = true; },
    isProcessAlive: async () => !terminated,
    relaunch: async () => {
      relaunches += 1;
      throw new Error('Apple Event timed out');
    },
    restartPollMs: 100,
    relaunchSettleMs: 10,
  });

  await assert.rejects(
    () => executor.runTurn(
      { ...baseTask, model: 'opus', effort: 'max' },
      { cancelRequested: false },
      { id: SESSION_ID },
      TERMINAL,
      collect(),
    ),
    (error) => {
      assert.equal(error.retryable, false);
      assert.match(error.message, /may already have run/i);
      return true;
    },
  );

  assert.equal(relaunches, 1);
  assert.equal(injected.length, 0);
});

test('a Claude process that does not exit blocks relaunch and prompt injection', async () => {
  const fake = fakeTranscript();
  const sessions = sessionSteps([{ status: 'idle' }, { status: 'idle' }], fake);
  let relaunches = 0;
  const { executor, injected } = makeExecutor({
    sessions,
    openTranscript: () => fake.source,
    resolveTerminal: async () => ({ ...TERMINAL }),
    terminateProcess: async () => {},
    isProcessAlive: async () => true,
    relaunch: async () => { relaunches += 1; },
    processExitTimeoutMs: 500,
    restartPollMs: 100,
  });

  await assert.rejects(
    () => executor.runTurn(
      { ...baseTask, model: 'opus', effort: 'max' },
      { cancelRequested: false },
      { id: SESSION_ID },
      TERMINAL,
      collect(),
    ),
    (error) => {
      assert.equal(error.retryable, false);
      assert.match(error.message, /did not exit/i);
      return true;
    },
  );

  assert.equal(relaunches, 0);
  assert.equal(injected.length, 0);
});

test('a terminal that becomes busy at the settings identity check is never stopped', async () => {
  const fake = fakeTranscript();
  const sessions = sessionSteps([
    { status: 'idle' },
    { status: 'busy' },
  ], fake);
  let terminations = 0;
  const { executor, injected } = makeExecutor({
    sessions,
    openTranscript: () => fake.source,
    resolveTerminal: async () => ({ ...TERMINAL }),
    terminateProcess: async () => { terminations += 1; },
  });

  await assert.rejects(
    () => executor.runTurn(
      { ...baseTask, model: 'opus', effort: 'max' },
      { cancelRequested: false },
      { id: SESSION_ID },
      TERMINAL,
      collect(),
    ),
    (error) => {
      assert.equal(error.retryable, true);
      assert.match(error.message, /became busy/i);
      return true;
    },
  );

  assert.equal(terminations, 0);
  assert.equal(injected.length, 0);
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

test('an idle interactive question keeps the task running until the terminal answer resumes the turn', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  const sessions = sessionSteps([
    { status: 'idle' },
    { status: 'busy', append: [assistant('tool_use', [text('Let me look...'), toolUse('t1', 'Bash', { command: 'ls' })])] },
    // Claude reports idle while AskUserQuestion is visible, but does not flush that
    // tool-use record to the transcript until the user answers in the terminal.
    { status: 'idle' },
    { status: 'idle' },
    { status: 'idle' },
    { status: 'idle' },
    { status: 'idle' },
    {
      status: 'busy',
      append: [
        assistant('tool_use', [toolUse('q1', 'AskUserQuestion', {
          questions: [{ question: 'What should I review?', options: [{ label: 'Whole app' }] }],
        })]),
        toolResult('q1', 'Whole app'),
      ],
    },
    { status: 'busy', append: [assistant('end_turn', [text('Review complete.')])] },
    { status: 'idle' },
    { status: 'idle' },
  ], fake);
  const { executor, injected } = makeExecutor({ sessions, openTranscript: () => fake.source });
  const io = collect();

  const outcome = await executor.runTurn(
    baseTask,
    { cancelRequested: false },
    { id: SESSION_ID },
    TERMINAL,
    io,
  );

  assert.equal(outcome.finalResponse, 'Review complete.');
  assert.equal(injected.length, 1);
  assert.equal(io.events.filter((entry) => entry.event.type === 'claude/input-required').length, 1);
  assert.equal(io.events.filter((entry) => entry.event.type === 'claude/input-resumed').length, 1);
  assert.equal(io.events.some((entry) => (
    entry.event.type === 'item/started'
    && entry.event.item?.tool === 'AskUserQuestion'
  )), true);
  assert.equal(io.events.some((entry) => (
    entry.event.type === 'item/completed'
    && entry.event.item?.tool === 'AskUserQuestion'
  )), true);
});

test('an unanswered interactive pause still stops at the inactivity ceiling', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  const sessions = sessionSteps([
    { status: 'idle' },
    { status: 'busy', append: [assistant('tool_use', [text('I need a choice.')])] },
    { status: 'idle' },
  ], fake);
  const { executor } = makeExecutor({
    sessions,
    openTranscript: () => fake.source,
    inactivityCeilingMs: 8000,
  });
  const io = collect();

  // The pause itself is inactivity: idle status, no new records, no transcript growth. An
  // abandoned question therefore still releases the task and session within the same bound.
  await assert.rejects(
    () => executor.runTurn(baseTask, { cancelRequested: false }, { id: SESSION_ID }, TERMINAL, io),
    (error) => {
      assert.equal(error.retryable, false);
      assert.match(error.message, /no activity/i);
      return true;
    },
  );

  assert.equal(io.events.filter((entry) => entry.event.type === 'claude/input-required').length, 1);
});

test('Issue 2: no double execution when a prompt injects but never starts', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  const sessions = sessionSteps([{ status: 'idle' }], fake); // always idle, never busy, never grows
  const { executor, injected, submitted } = makeExecutor({ sessions, openTranscript: () => fake.source, submissionTimeoutMs: 3000 });
  await assert.rejects(
    () => executor.runTurn(baseTask, { cancelRequested: false }, { id: SESSION_ID }, TERMINAL, collect()),
    (error) => {
      assert.equal(error.retryable, false);
      assert.match(error.message, /separate submit action/i);
      assert.match(error.message, /unsubmitted text/i);
      return true;
    },
  );
  assert.equal(injected.length, 1);
  assert.deepEqual(submitted, [WINDOW_ID]);
});

test('a stalled large paste receives one guarded submit action and then completes', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  const sessions = sessionSteps([
    { status: 'idle' }, // readiness
    { status: 'idle' }, // paste is visible but not submitted
    { status: 'idle' },
    { status: 'idle' }, // submit nudge threshold reached
    { status: 'idle' }, // final pre-submit status check
    { status: 'busy', append: [userPrompt('List the files.'), assistant('end_turn', [text('Submitted after the nudge.')])] },
    { status: 'idle' },
    { status: 'idle' },
  ], fake);
  const { executor, injected, submitted } = makeExecutor({
    sessions,
    openTranscript: () => fake.source,
    submissionTimeoutMs: 6000,
  });
  const io = collect();

  const outcome = await executor.runTurn(baseTask, { cancelRequested: false }, { id: SESSION_ID }, TERMINAL, io);

  assert.equal(outcome.finalResponse, 'Submitted after the nudge.');
  assert.equal(injected.length, 1);
  assert.deepEqual(submitted, [WINDOW_ID]);
  assert.equal(
    io.events.some((entry) => /sent one separate submit action/i.test(entry.message)),
    true,
  );
});

test('a delayed turn that starts during the submit guard never receives the extra action', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  const sessions = sessionSteps([{ status: 'idle' }], fake);
  let resolution = 0;
  const { executor, submitted } = makeExecutor({
    sessions,
    openTranscript: () => fake.source,
    resolveTerminal: async () => {
      resolution += 1;
      if (resolution === 2) {
        fake.append(userPrompt('List the files.'));
        fake.append(assistant('end_turn', [text('The original submit started late.')]));
      }
      return { ...TERMINAL };
    },
    submissionTimeoutMs: 6000,
  });

  const outcome = await executor.runTurn(
    baseTask,
    { cancelRequested: false },
    { id: SESSION_ID },
    TERMINAL,
    collect(),
  );

  assert.equal(outcome.finalResponse, 'The original submit started late.');
  assert.equal(submitted.length, 0);
});

test('partial transcript growth during the submit guard suppresses the extra action', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  const finalLine = `${JSON.stringify(assistant('end_turn', [text('Started while the record was partial.')]))}\n`;
  const splitAt = Math.floor(finalLine.length / 2);
  let resolution = 0;
  const sessions = sessionSteps([
    { status: 'idle' },
    { status: 'idle' },
    { status: 'idle' },
    { status: 'idle' },
    { status: 'idle' },
    { status: 'idle' },
    { status: 'idle', mutate: () => fake.appendRaw(finalLine.slice(splitAt)) },
    { status: 'idle' },
  ], fake);
  const { executor, submitted } = makeExecutor({
    sessions,
    openTranscript: () => fake.source,
    resolveTerminal: async () => {
      resolution += 1;
      if (resolution === 2) fake.appendRaw(finalLine.slice(0, splitAt));
      return { ...TERMINAL };
    },
    submissionTimeoutMs: 6000,
  });

  const outcome = await executor.runTurn(
    baseTask,
    { cancelRequested: false },
    { id: SESSION_ID },
    TERMINAL,
    collect(),
  );

  assert.equal(outcome.finalResponse, 'Started while the record was partial.');
  assert.equal(submitted.length, 0);
});

test('a stalled paste is not submitted when the exact terminal identity changes', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  const sessions = sessionSteps([{ status: 'idle' }], fake);
  let resolution = 0;
  const { executor, injected, submitted } = makeExecutor({
    sessions,
    openTranscript: () => fake.source,
    resolveTerminal: async () => {
      resolution += 1;
      return resolution === 1
        ? { ...TERMINAL }
        : { terminalWindowId: 9999, terminalTty: '/dev/ttys999', runtimeProcessId: 222 };
    },
    submissionTimeoutMs: 6000,
  });

  await assert.rejects(
    () => executor.runTurn(baseTask, { cancelRequested: false }, { id: SESSION_ID }, TERMINAL, collect()),
    (error) => {
      assert.equal(error.retryable, false);
      assert.match(error.message, /pasted the prompt/i);
      assert.match(error.message, /could not safely re-verify/i);
      return true;
    },
  );
  assert.equal(injected.length, 1);
  assert.equal(submitted.length, 0);
});

test('cancellation during the final submit guard never sends the extra action', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  const active = { cancelRequested: false };
  const sessions = sessionSteps([
    { status: 'idle' },
    { status: 'idle' },
    { status: 'idle' },
    { status: 'idle' },
    { status: 'idle', mutate: () => { active.cancelRequested = true; } },
  ], fake);
  const { executor, submitted, cancels } = makeExecutor({
    sessions,
    openTranscript: () => fake.source,
    submissionTimeoutMs: 6000,
  });

  await assert.rejects(
    () => executor.runTurn(baseTask, active, { id: SESSION_ID }, TERMINAL, collect()),
    (error) => error.cancelled === true,
  );

  assert.equal(submitted.length, 0);
  assert.deepEqual(cancels, [WINDOW_ID]);
});

test('a failed separate submit action never retries a pasted prompt', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  const sessions = sessionSteps([{ status: 'idle' }], fake);
  const { executor, injected } = makeExecutor({
    sessions,
    openTranscript: () => fake.source,
    submit: async () => { throw new Error('submit Apple Event timed out'); },
    submissionTimeoutMs: 6000,
  });

  await assert.rejects(
    () => executor.runTurn(baseTask, { cancelRequested: false }, { id: SESSION_ID }, TERMINAL, collect()),
    (error) => {
      assert.equal(error.retryable, false);
      assert.match(error.message, /could not confirm the separate submit action/i);
      assert.match(error.message, /may now be running/i);
      return true;
    },
  );
  assert.equal(injected.length, 1);
});

test('Issue 2c: a started turn that goes completely silent fails non-retryably at the inactivity ceiling', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  const sessions = sessionSteps([
    { status: 'idle' }, // readiness
    { status: 'busy' }, // the turn starts
    { status: 'busy' },
    { status: 'idle' }, // then nothing at all: no final record, no growth, no busy status
  ], fake);
  const { executor } = makeExecutor({ sessions, openTranscript: () => fake.source, inactivityCeilingMs: 3000 });
  await assert.rejects(
    () => executor.runTurn(baseTask, { cancelRequested: false }, { id: SESSION_ID }, TERMINAL, collect()),
    (error) => { assert.equal(error.retryable, false); assert.match(error.message, /no activity/i); return true; },
  );
});

test('task 320: a turn that stays busy far past the ceiling keeps running and completes', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  // Task 320 failed at 45m11s while its Claude session was driving a team of sub-agents: busy
  // discovery status was the only live signal for the whole run, and no parent transcript record
  // was written. Elapsed time alone must never end a turn in that state.
  const longBusyRun = Array.from({ length: 30 }, () => ({ status: 'busy' }));
  const sessions = sessionSteps([
    { status: 'idle' }, // readiness
    ...longBusyRun,
    { status: 'busy', append: [assistant('end_turn', [text('Long run complete.')])] },
    { status: 'idle' },
    { status: 'idle' },
  ], fake);
  const { executor, clock } = makeExecutor({
    sessions,
    openTranscript: () => fake.source,
    inactivityCeilingMs: 3000,
  });
  const io = collect();

  const outcome = await executor.runTurn(baseTask, { cancelRequested: false }, { id: SESSION_ID }, TERMINAL, io);

  assert.equal(outcome.finalResponse, 'Long run complete.');
  assert.ok(clock.now() > 20_000, `expected the turn to outlive the ceiling, ran ${clock.now()}ms`);
  assert.equal(io.events.some((entry) => /no activity/i.test(entry.message || '')), false);
});

test('the inactivity window restarts from the last observed activity, not from the turn start', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  let clock = null;
  let lastBusyAt = -1;
  const busyPhase = Array.from({ length: 6 }, () => ({
    status: 'busy',
    mutate: () => { lastBusyAt = clock.now(); },
  }));
  const sessions = sessionSteps([
    { status: 'idle' }, // readiness
    ...busyPhase,
    { status: 'idle' }, // inert trailing step: it repeats, so it must not record activity
  ], fake);
  const harness = makeExecutor({
    sessions,
    openTranscript: () => fake.source,
    inactivityCeilingMs: 3000,
  });
  clock = harness.clock;

  await assert.rejects(
    () => harness.executor.runTurn(baseTask, { cancelRequested: false }, { id: SESSION_ID }, TERMINAL, collect()),
    (error) => { assert.equal(error.retryable, false); assert.match(error.message, /no activity/i); return true; },
  );

  // The busy phase alone already outlived the ceiling without failing.
  assert.ok(lastBusyAt > 3000, `expected the busy phase to outlive the ceiling, ended at ${lastBusyAt}ms`);
  // Failure comes a full window after the last activity, checked one poll late at the loop top.
  const silence = clock.now() - lastBusyAt;
  assert.ok(silence >= 3000, `expected a full inactivity window, saw ${silence}ms`);
  assert.ok(silence <= 3000 + 2000, `expected failure soon after the window, saw ${silence}ms`);
});

test('the legacy turnCeilingMs option still configures the inactivity ceiling', () => {
  assert.equal(makeExecutor().executor.inactivityCeilingMs, 45 * 60 * 1_000);
  assert.equal(makeExecutor({ turnCeilingMs: 3000 }).executor.inactivityCeilingMs, 3000);
  assert.equal(
    makeExecutor({ turnCeilingMs: 3000, inactivityCeilingMs: 9000 }).executor.inactivityCeilingMs,
    9000,
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

test('Issue 14: an established session whose stat stays negative fails retryably and never types', async () => {
  const fake = fakeTranscript(); // established: a transcript already exists at task start
  fake.append(assistant('end_turn', [text('STALE earlier response.')])); // stale history at offset 0
  const sessions = sessionSteps([
    // The FS starts failing after the start-time existence check. From here size() AND exists()
    // both report failure together, exactly as production would during a transient stat error.
    { status: 'idle', mutate: () => fake.failStat(Infinity) },
    { status: 'idle' },
  ], fake);
  const { executor, injected } = makeExecutor({
    sessions, openTranscript: () => fake.source, statRetryAttempts: 3, statRetryDelayMs: 10,
  });
  await assert.rejects(
    () => executor.runTurn(baseTask, { cancelRequested: false }, { id: SESSION_ID }, TERMINAL, collect()),
    (error) => { assert.equal(error.retryable, true); assert.match(error.message, /transcript/i); return true; },
  );
  // Pre-injection: nothing typed, so the stale end_turn is never replayed as this turn's result.
  assert.equal(injected.length, 0);
});

test('Issue 14: a cancel during the bounded re-stat aborts as cancelled, never a retryable failure', async () => {
  const fake = fakeTranscript();
  fake.append(assistant('end_turn', [text('STALE earlier response.')]));
  const active = { cancelRequested: false };
  const sessions = sessionSteps([
    // Arm the transient stat failure AND request cancellation between the start-time existence
    // check and the offset read, so the re-stat loop is what observes the cancel.
    { status: 'idle', mutate: () => { fake.failStat(Infinity); active.cancelRequested = true; } },
    { status: 'idle' },
  ], fake);
  const { executor, injected } = makeExecutor({
    sessions, openTranscript: () => fake.source, statRetryAttempts: 3, statRetryDelayMs: 10,
  });
  await assert.rejects(
    () => executor.runTurn(baseTask, active, { id: SESSION_ID }, TERMINAL, collect()),
    // cancelled (queue marks it cancelled and never auto-retries), not the retryable stat error.
    (error) => { assert.equal(error.cancelled, true); return true; },
  );
  assert.equal(injected.length, 0);
});

test('Issue 18: a cancel during the final re-stat wait aborts as cancelled, not the retryable stat error', async () => {
  const fake = fakeTranscript();
  fake.append(assistant('end_turn', [text('STALE earlier response.')]));
  const active = { cancelRequested: false };
  const sessions = sessionSteps([
    { status: 'idle', mutate: () => fake.failStat(Infinity) }, // arm the transient failure after the start-time check
    { status: 'idle' },
  ], fake);
  let waits = 0;
  const { executor, injected } = makeExecutor({
    sessions,
    openTranscript: () => fake.source,
    statRetryAttempts: 3,
    statRetryDelayMs: 10,
    // The cancel lands during the LAST re-stat wait, so the loop-top check never sees it and
    // only the guard before the retryable throw can catch it.
    wait: async () => { waits += 1; if (waits >= 3) active.cancelRequested = true; },
  });
  await assert.rejects(
    () => executor.runTurn(baseTask, active, { id: SESSION_ID }, TERMINAL, collect()),
    (error) => {
      assert.equal(error.cancelled, true); // queue marks it cancelled and never auto-retries
      assert.doesNotMatch(error.message, /replaying an earlier response/i); // not the retryable stat error
      return true;
    },
  );
  assert.equal(injected.length, 0);
});

test('Issue 18: a cancel during the final readiness poll aborts as cancelled, not the retryable stayed-busy error', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  const active = { cancelRequested: false };
  const sessions = sessionSteps([
    { status: 'busy' },
    { status: 'busy' },
    // The cancel lands on the final poll before the deadline expires, after that iteration's
    // loop-top cancel check has already passed.
    { status: 'busy', mutate: () => { active.cancelRequested = true; } },
  ], fake);
  const { executor, injected } = makeExecutor({
    sessions,
    openTranscript: () => fake.source,
    readinessTimeoutMs: 3000,
    pollMs: 1000,
  });
  await assert.rejects(
    () => executor.runTurn(baseTask, active, { id: SESSION_ID }, TERMINAL, collect()),
    (error) => {
      assert.equal(error.cancelled, true);
      assert.doesNotMatch(error.message, /stayed busy/i); // not the retryable stayed-busy error
      return true;
    },
  );
  assert.equal(injected.length, 0);
});

test('Issue 14: an established session recovers the real offset after a transient stat blip and does not replay history', async () => {
  const fake = fakeTranscript();
  fake.append(assistant('end_turn', [text('STALE earlier response.')])); // stale history
  const sessions = sessionSteps([
    { status: 'idle', mutate: () => fake.failStat(1) }, // one transient failure at offset time, then recovers
    { status: 'busy', append: [assistant('end_turn', [text('Fresh answer.')])] },
    { status: 'idle' },
    { status: 'idle' },
  ], fake);
  const { executor, injected } = makeExecutor({
    sessions, openTranscript: () => fake.source, statRetryAttempts: 3, statRetryDelayMs: 10,
  });
  const outcome = await executor.runTurn(baseTask, { cancelRequested: false }, { id: SESSION_ID }, TERMINAL, collect());
  assert.equal(outcome.finalResponse, 'Fresh answer.'); // recovered offset skipped the stale record
  assert.equal(injected.length, 1);
});

test('Issue 14: a fresh session with no transcript still injects from offset 0 despite a negative stat', async () => {
  const fake = fakeTranscript({ present: false }); // no transcript at task start: genuinely fresh
  const sessions = sessionSteps([
    { status: 'idle' },
    { status: 'busy', append: [assistant('end_turn', [text('First turn done.')])] },
    { status: 'idle' },
    { status: 'idle' },
  ], fake);
  const { executor, injected } = makeExecutor({
    sessions, openTranscript: () => fake.source, statRetryAttempts: 3, statRetryDelayMs: 10,
  });
  const outcome = await executor.runTurn(baseTask, { cancelRequested: false }, { id: SESSION_ID }, TERMINAL, collect());
  assert.equal(outcome.finalResponse, 'First turn done.'); // offset 0, no re-stat, no retryable failure
  assert.equal(injected.length, 1);
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

test('Issue 16: an identity-recheck resolution flake fails retryably with a re-verify message, not a mismatch claim', async () => {
  const fake = fakeTranscript();
  fake.append({ type: 'mode' });
  const sessions = sessionSteps([{ status: 'idle' }, { status: 'idle' }], fake);
  const { executor, injected } = makeExecutor({
    sessions,
    openTranscript: () => fake.source,
    resolveTerminal: async () => { throw new Error('osascript transient resolution failure'); },
  });
  await assert.rejects(
    () => executor.runTurn(baseTask, { cancelRequested: false }, { id: SESSION_ID }, TERMINAL, collect()),
    (error) => {
      assert.equal(error.retryable, true); // self-heals: a re-run re-resolves the terminal
      assert.match(error.message, /could not re-verify/i);
      assert.doesNotMatch(error.message, /reused by another session/i); // a flake has not proven a mismatch
      return true;
    },
  );
  assert.equal(injected.length, 0); // pre-injection: nothing typed
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

test('runner gives the default terminal executor the pinned Claude binary', () => {
  const runner = new ClaudeExecutionRunner({
    command: '/opt/claude/bin/claude',
    sessions: { readConnectedSession: async () => null },
  });
  assert.equal(runner.terminalExecutor.command, '/opt/claude/bin/claude');
});

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

test('a terminal-required council stage never falls back to headless', async () => {
  const { runner, spawned } = headlessRunner({
    platform: 'darwin',
    resolveTerminal: async () => null,
  });
  await assert.rejects(
    runner.run({ ...baseTask, require_terminal: true }, collect()),
    /did not run Claude headlessly/,
  );
  assert.equal(spawned.length, 0);
});

test('an oversized terminal-required council stage fails before injection or headless execution', async () => {
  const { runner, spawned } = headlessRunner({
    platform: 'darwin',
    resolveTerminal: async () => ({ ...TERMINAL }),
    terminalExecutor: {
      maxPromptBytes: 20,
      runTurn: async () => { throw new Error('terminal path must not run'); },
    },
  });
  await assert.rejects(
    runner.run({ ...baseTask, prompt: 'x'.repeat(500), require_terminal: true }, collect()),
    /stage was not run headlessly/,
  );
  assert.equal(spawned.length, 0);
});

test('Issue 15: an oversize prompt on an owned darwin terminal runs headless exactly once, with no injection', async () => {
  const spawned = [];
  let terminalCalls = 0;
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
    sessions: { readConnectedSession: async () => ({ id: SESSION_ID, source: 'Claude interactive', cwd: '/repo', rawStatus: 'idle', pid: PID }) },
    platform: 'darwin',
    resolveTerminal: async () => ({ ...TERMINAL }), // an owned terminal DOES resolve
    // A real executor would enforce this limit; the mock records whether it was called at all.
    terminalExecutor: {
      maxPromptBytes: 20,
      runTurn: async () => { terminalCalls += 1; throw new Error('the terminal path must not run for an oversize prompt'); },
    },
  });
  const io = collect();
  const outcome = await runner.run({ ...baseTask, prompt: 'x'.repeat(500) }, io);
  assert.equal(outcome.finalResponse, 'Headless done.');
  assert.equal(spawned.length, 1); // headless ran exactly once, no double execution
  assert.equal(terminalCalls, 0); // no injection attempted
  assert.equal(
    io.events.some((e) => /headless/i.test(e.message) && /(byte|larger|limit)/i.test(e.message)),
    true, // the fallback notice explains why this task runs headless
  );
});

test('Issue 15: a NUL-bearing prompt on an owned darwin terminal also falls back to headless', async () => {
  const spawned = [];
  let terminalCalls = 0;
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
    sessions: { readConnectedSession: async () => ({ id: SESSION_ID, source: 'Claude interactive', cwd: '/repo', rawStatus: 'idle', pid: PID }) },
    platform: 'darwin',
    resolveTerminal: async () => ({ ...TERMINAL }),
    terminalExecutor: {
      maxPromptBytes: 100_000,
      runTurn: async () => { terminalCalls += 1; throw new Error('the terminal path must not run for a NUL prompt'); },
    },
  });
  const io = collect();
  const outcome = await runner.run({ ...baseTask, prompt: `bad${NUL}prompt` }, io);
  assert.equal(outcome.finalResponse, 'Headless done.');
  assert.equal(spawned.length, 1);
  assert.equal(terminalCalls, 0);
  assert.equal(io.events.some((e) => /headless/i.test(e.message) && /NUL/i.test(e.message)), true);
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
