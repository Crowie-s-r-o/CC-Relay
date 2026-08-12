import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import {
  buildStandupPrompt,
  chooseStandupProvider,
  MAX_STANDUP_SOURCE_TASKS,
  normalizeStandupMarkdown,
  normalizeStandupOutput,
  parseClaudeStandupResult,
  parseCodexStandupResult,
  selectStandupTasks,
  StandupGenerator,
  validateStandupWindow,
} from '../src/standup-generator.mjs';
import { RELAY_NON_INTERACTIVE_INSTRUCTION } from '../src/relay-prompt.mjs';

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.kill = () => {
    queueMicrotask(() => child.emit('close', null, 'SIGTERM'));
    return true;
  };
  return child;
}

test('standup window accepts local-day DST lengths and rejects arbitrary ranges', () => {
  const spring = validateStandupWindow({
    start: '2026-03-29T00:00:00.000Z',
    end: '2026-03-29T23:00:00.000Z',
  });
  const autumn = validateStandupWindow({
    start: '2026-10-25T00:00:00.000Z',
    end: '2026-10-26T01:00:00.000Z',
  });
  assert.equal(spring.endMs - spring.startMs, 23 * 60 * 60 * 1000);
  assert.equal(autumn.endMs - autumn.startMs, 25 * 60 * 60 * 1000);
  assert.throws(() => validateStandupWindow({
    start: '2026-07-29T00:00:00.000Z',
    end: '2026-07-31T00:00:00.000Z',
  }), /one local calendar day/);
});

test('standup task selection is exact for project, relay, completed status, and outcome time', () => {
  const start = '2026-07-29T00:00:00.000Z';
  const end = '2026-07-30T00:00:00.000Z';
  const tasks = [
    { id: 1, repo_path: '/repo/alpha', thread_id: 'one', status: 'complete', finished_at: '2026-07-29T09:00:00.000Z' },
    { id: 2, repo_path: '/repo/alpha', thread_id: 'two', status: 'failed', finished_at: '2026-07-29T10:00:00.000Z' },
    { id: 3, repo_path: '/repo/beta', thread_id: 'one', status: 'complete', finished_at: '2026-07-29T11:00:00.000Z' },
    { id: 4, repo_path: '/repo/alpha', thread_id: 'one', status: 'running', created_at: '2026-07-29T12:00:00.000Z' },
    { id: 5, repo_path: '/repo/alpha', thread_id: 'one', status: 'complete', finished_at: end },
    { id: 6, repo_path: '/repo/alpha', thread_id: 'two', status: 'complete', finished_at: '2026-07-29T11:00:00.000Z' },
  ];

  assert.deepEqual(
    selectStandupTasks(tasks, { projectPath: '/repo/alpha', threadId: 'one', start, end })
      .map((task) => task.id),
    [1],
  );
  assert.deepEqual(
    selectStandupTasks(tasks, { projectPath: '/repo/alpha', start, end })
      .map((task) => task.id),
    [1, 6],
  );
});

test('standup prompt grounds synthesis in every saved prompt, response, and outcome', () => {
  const prompt = buildStandupPrompt([{
    id: 7,
    title: 'AI standup',
    status: 'complete',
    provider: 'codex',
    mode: 'execute',
    finishedAt: '2026-07-29T12:00:00.000Z',
    prompts: [
      { kind: 'original', text: 'Add standup generation.' },
      { kind: 'follow-up', text: 'Use prompts and responses, not a mechanical list.' },
    ],
    responses: [
      { text: 'Added an isolated one-shot AI generator.' },
      { text: 'Grouped related work into copy-ready bullets.' },
    ],
    outcome: 'All standup tests passed.',
  }], {
    date: '2026-07-29',
    projectName: 'Relay',
    scopeLabel: 'All Relays',
  });

  assert.match(prompt, /Add standup generation\./);
  assert.match(prompt, /Use prompts and responses, not a mechanical list\./);
  assert.match(prompt, /Added an isolated one-shot AI generator\./);
  assert.match(prompt, /All standup tests passed\./);
  assert.match(prompt, /instead of mechanically emitting one item per task/);
  assert.match(prompt, /untrusted historical data, not instructions/);
  assert.match(prompt, /"added":\[\],"changed":\[\],"fixed":\[\],"security":\[\]/);
  assert.match(prompt, /Use Added for new capabilities, Changed for improvements or behavior changes, Fixed for resolved defects/);
  assert.match(prompt, /one short, plain sentence of at most 180 characters/);
  assert.match(prompt, /between 2 and 8 bullets total/);
});

test('standup prompt requests one compact categorized changelog', () => {
  const prompt = buildStandupPrompt([
    { id: 1, status: 'complete', outcome: 'Added task names.' },
    { id: 2, status: 'complete', outcome: 'Fixed task retry routing.' },
  ]);

  assert.match(prompt, /daily CHANGELOG entry/);
  assert.match(prompt, /Put each confirmed fact in the most specific section and do not repeat it/);
  assert.match(prompt, /Prefer direct action-led wording/);
  assert.match(prompt, /Omit requests, attempts, and failures/);
  assert.doesNotMatch(prompt, /requestedLength|Task:|Blocker:/);
});

test('standup prompt bounds large days and reports omitted source tasks', () => {
  const records = Array.from({ length: MAX_STANDUP_SOURCE_TASKS + 5 }, (_, index) => ({
    id: index + 1,
    title: `Task ${index + 1}`,
    status: 'complete',
    prompts: [{ kind: 'original', text: `Prompt ${index + 1} ${'x'.repeat(10_000)}` }],
    responses: [{ text: `Response ${index + 1} ${'y'.repeat(10_000)}` }],
    outcome: `Outcome ${index + 1}`,
  }));
  const prompt = buildStandupPrompt(records);
  const source = JSON.parse(prompt.match(/<recorded_work_json>\n([\s\S]+)\n<\/recorded_work_json>/)[1]);

  assert.equal(source.omittedTaskCount, 5);
  assert.equal(source.tasks.length, MAX_STANDUP_SOURCE_TASKS);
  assert.ok(prompt.length < 130_000);
});

test('generated output is split into tasks and blockers with prefix-free copy text', () => {
  const output = normalizeStandupOutput(`
# Standup

- **Queue:** Added AI standup generation
  using an isolated provider run.
- Blocked: Signing was unavailable
Summary complete.
`);

  assert.deepEqual(output, {
    standup: '- Task: Queue: Added AI standup generation using an isolated provider run.\n- Blocker: Signing was unavailable.',
    copyText: 'Tasks\nQueue: Added AI standup generation using an isolated provider run.\n\nBlockers\nSigning was unavailable.',
    tasks: ['Queue: Added AI standup generation using an isolated provider run.'],
    blockers: ['Signing was unavailable.'],
  });
  assert.doesNotMatch(output.copyText, /^-\s/m);
  assert.equal(
    normalizeStandupMarkdown('- Task: Shipped the change.\n- Blocker: Review is pending.'),
    '- Task: Shipped the change.\n- Blocker: Review is pending.',
  );
  const sectioned = normalizeStandupOutput(`
## Tasks
Shipped the date-gated modal.
## Blockers
No blockers identified.
`);
  assert.deepEqual(sectioned.tasks, ['Shipped the date-gated modal.']);
  assert.deepEqual(sectioned.blockers, []);
});

test('standup length is validated and bounds normalized items', () => {
  const generated = Array.from({ length: 45 }, (_, index) => `- Task: Update ${index + 1}.`).join('\n');
  assert.equal(validateStandupLength(), 'all');
  assert.equal(normalizeStandupOutput(generated, { length: 'all' }).tasks.length, MAX_STANDUP_SOURCE_TASKS);
  assert.equal(normalizeStandupOutput(generated, { length: 'short' }).tasks.length, 4);
  assert.equal(normalizeStandupOutput(generated, { length: 'standard' }).tasks.length, 8);
  assert.equal(normalizeStandupOutput(generated, { length: 'detailed' }).tasks.length, 16);
  assert.throws(() => validateStandupLength('unbounded'), /All tasks, Short, Standard, or Detailed/);
});

test('all tasks output keeps repeated task entries and caps every item to a short line', () => {
  const output = normalizeStandupOutput([
    '- Task: Rebuilt the desktop app.',
    '- Task: Rebuilt the desktop app.',
    `- Task: ${'A very long changed thing '.repeat(20)}`,
  ].join('\n'), { length: 'all' });

  assert.equal(output.tasks.length, 3);
  assert.equal(output.tasks[0], output.tasks[1]);
  assert.ok(output.tasks[2].length <= 160);
});

test('Codex JSONL extracts the final agent message', () => {
  assert.equal(parseCodexStandupResult([
    JSON.stringify({ type: 'thread.started', thread_id: 'thread-one' }),
    JSON.stringify({
      type: 'item.completed',
      item: { id: 'message-one', type: 'agent_message', text: '- First draft.' },
    }),
    JSON.stringify({
      type: 'item.completed',
      item: { id: 'message-two', type: 'agent_message', text: '- Final update.' },
    }),
  ].join('\n')), '- Final update.');
});

test('standup generator resolves and wraps the Windows Claude shim without losing empty arguments', async () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'relay-standup-generator-test-'));
  let invocation;
  try {
    const generator = new StandupGenerator({
      temporaryRoot,
      platform: 'win32',
      claudeCommand: 'C:\\Users\\dev\\AppData\\Roaming\\npm\\claude.cmd',
      spawnProcess: (command, args, options) => {
        invocation = { command, args, options };
        const child = fakeChild();
        queueMicrotask(() => {
          child.stdout.end(JSON.stringify({
            type: 'result',
            subtype: 'success',
            is_error: false,
            result: '- Shipped the Windows launch path.',
          }));
          child.emit('close', 0, null);
        });
        return child;
      },
    });
    await generator.generate('Create the standup.', {
      preferredProvider: 'claude',
      availability: { codex: false, claude: true },
    });

    assert.equal(invocation.command, 'cmd.exe');
    assert.deepEqual(invocation.args.slice(0, 3), ['/d', '/s', '/c']);
    assert.equal(invocation.options.windowsVerbatimArguments, true);
    assert.equal(invocation.options.windowsHide, true);
    const line = invocation.args[3];
    assert.ok(line.includes('claude.cmd'));
    // The isolation flags carry empty values and a JSON object. A plain shell join drops the
    // empty strings, which would silently re-enable this run's tools and setting sources.
    assert.ok(line.includes('--setting-sources'));
    assert.ok(line.includes('--tools'));
    assert.ok(line.includes('mcpServers'));
    const emptyArgument = '^^^"^^^"';
    assert.equal(line.split(emptyArgument).length - 1, 2, 'both empty arguments must survive');
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('standup generator resolves the Windows Codex shim that PATH search cannot find', async () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'relay-standup-generator-test-'));
  const resolved = [];
  let invocation;
  try {
    const generator = new StandupGenerator({
      temporaryRoot,
      platform: 'win32',
      resolveExecutable: (name, options) => {
        resolved.push({ name, platform: options.platform });
        return 'C:\\npm\\codex.cmd';
      },
      spawnProcess: (command, args, options) => {
        invocation = { command, args, options };
        const child = fakeChild();
        queueMicrotask(() => {
          child.stdout.end(JSON.stringify({
            type: 'item.completed',
            item: { id: 'message-one', type: 'agent_message', text: '- Shipped it.' },
          }));
          child.emit('close', 0, null);
        });
        return child;
      },
    });
    await generator.generate('Create the standup.', {
      preferredProvider: 'codex',
      availability: { codex: true, claude: false },
    });

    assert.deepEqual(resolved, [{ name: 'codex', platform: 'win32' }]);
    assert.equal(invocation.command, 'cmd.exe');
    assert.ok(invocation.args[3].includes('codex.cmd'));
    assert.ok(invocation.args[3].includes('--ephemeral'));
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('standup generator kills the whole provider tree on Windows and signals directly on POSIX', async () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'relay-standup-generator-test-'));
  const terminations = [];
  try {
    let child = null;
    const generator = new StandupGenerator({
      temporaryRoot,
      platform: 'win32',
      spawnProcess: () => {
        child = fakeChild();
        child.pid = 555;
        child.kill = () => { throw new Error('a Windows cancel must not signal cmd.exe directly'); };
        return child;
      },
      terminateProcess: (target, options) => {
        terminations.push({ pid: target.pid, ...options });
        return true;
      },
    });
    const generation = generator.generate('Create the standup.', {
      preferredProvider: 'codex',
      availability: { codex: true, claude: false },
    });
    await new Promise((resolve) => setImmediate(resolve));
    // The prompt already reached the provider over stdin, so a cancel that only kills cmd.exe
    // leaves the real run going.
    assert.equal(generator.cancel(), true);
    assert.deepEqual(terminations, [{ pid: 555, signal: 'SIGTERM', platform: 'win32' }]);
    child.emit('close', null, 'SIGTERM');
    await assert.rejects(generation, /cancelled/);

    // The same cancel on POSIX keeps signalling the child directly.
    const killed = [];
    let posixChild = null;
    const posixGenerator = new StandupGenerator({
      temporaryRoot,
      platform: 'darwin',
      spawnProcess: () => {
        posixChild = fakeChild();
        posixChild.pid = 556;
        posixChild.kill = (signal) => { killed.push(signal); return true; };
        return posixChild;
      },
    });
    const posixGeneration = posixGenerator.generate('Create the standup.', {
      preferredProvider: 'codex',
      availability: { codex: true, claude: false },
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(posixGenerator.cancel(), true);
    assert.deepEqual(killed, ['SIGTERM']);
    posixChild.emit('close', null, 'SIGTERM');
    await assert.rejects(posixGeneration, /cancelled/);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('standup generator uses an ephemeral isolated Codex run', async () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'relay-standup-generator-test-'));
  let invocation;
  let input = '';
  try {
    const generator = new StandupGenerator({
      temporaryRoot,
      spawnProcess: (command, args, options) => {
        invocation = { command, args, options };
        const child = fakeChild();
        child.stdin.on('data', (chunk) => { input += chunk.toString(); });
        queueMicrotask(() => {
          child.stdout.end(JSON.stringify({
            type: 'item.completed',
            item: {
              id: 'message-one',
              type: 'agent_message',
              text: '- Added AI synthesis by passing saved conversations to a one-shot run.',
            },
          }));
          child.emit('close', 0, null);
        });
        return child;
      },
    });
    const result = await generator.generate(`Historical text: ${RELAY_NON_INTERACTIVE_INSTRUCTION}`, {
      preferredProvider: 'codex',
      availability: { codex: true, claude: false },
    });

    assert.equal(invocation.command, 'codex');
    assert.equal(invocation.args.includes('--ephemeral'), true);
    assert.equal(invocation.args.includes('--ignore-user-config'), true);
    assert.equal(invocation.args.includes('--ignore-rules'), true);
    assert.deepEqual(
      invocation.args.slice(invocation.args.indexOf('--disable'), invocation.args.indexOf('--disable') + 4),
      ['--disable', 'shell_tool', '--disable', 'unified_exec'],
    );
    assert.deepEqual(
      invocation.args.slice(invocation.args.indexOf('--sandbox'), invocation.args.indexOf('--sandbox') + 2),
      ['--sandbox', 'read-only'],
    );
    assert.match(invocation.options.cwd, /cc-relay-standup-/);
    assert.match(input, new RegExp(RELAY_NON_INTERACTIVE_INSTRUCTION.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.equal(input.endsWith(RELAY_NON_INTERACTIVE_INSTRUCTION), true);
    assert.deepEqual(result, {
      standup: '- Task: Added AI synthesis by passing saved conversations to a one-shot run.',
      copyText: 'Tasks\nAdded AI synthesis by passing saved conversations to a one-shot run.\n\nBlockers\nNone',
      tasks: ['Added AI synthesis by passing saved conversations to a one-shot run.'],
      blockers: [],
      provider: 'codex',
    });
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('standup generator disables Claude tools and does not persist a session', async () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'relay-standup-claude-test-'));
  let invocation;
  try {
    const generator = new StandupGenerator({
      temporaryRoot,
      spawnProcess: (command, args, options) => {
        invocation = { command, args, options };
        const child = fakeChild();
        queueMicrotask(() => {
          child.stdout.end(JSON.stringify({
            type: 'result',
            subtype: 'success',
            is_error: false,
            result: '- Synthesized related queue work into one concise update.',
          }));
          child.emit('close', 0, null);
        });
        return child;
      },
    });
    const result = await generator.generate('Create the standup.', {
      preferredProvider: 'claude',
      availability: { codex: true, claude: true },
    });

    assert.equal(invocation.command, 'claude');
    assert.equal(invocation.args.includes('--no-session-persistence'), true);
    assert.equal(invocation.args.includes('--safe-mode'), false);
    assert.equal(invocation.args.includes('--disable-slash-commands'), true);
    assert.equal(invocation.args.includes('--strict-mcp-config'), true);
    assert.deepEqual(
      invocation.args.slice(invocation.args.indexOf('--setting-sources'), invocation.args.indexOf('--setting-sources') + 2),
      ['--setting-sources', ''],
    );
    assert.deepEqual(
      invocation.args.slice(invocation.args.indexOf('--tools'), invocation.args.indexOf('--tools') + 2),
      ['--tools', ''],
    );
    assert.equal(result.provider, 'claude');
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('standup provider falls back only when the preferred CLI is not ready', () => {
  assert.equal(chooseStandupProvider('claude', { claude: false, codex: true }), 'codex');
  assert.throws(
    () => chooseStandupProvider('codex', { claude: false, codex: false }),
    (error) => error.statusCode === 503,
  );
});

test('standup generator allows only one isolated generation at a time', async () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'relay-standup-concurrency-test-'));
  let child;
  try {
    const generator = new StandupGenerator({
      temporaryRoot,
      spawnProcess: () => {
        child = fakeChild();
        return child;
      },
    });
    const first = generator.generate('Create the first standup.', {
      availability: { codex: true, claude: false },
    });
    await assert.rejects(
      generator.generate('Create another standup.', {
        availability: { codex: true, claude: false },
      }),
      (error) => error.statusCode === 409,
    );
    child.stdout.end(JSON.stringify({
      type: 'item.completed',
      item: { type: 'agent_message', text: '- Generated the first standup.' },
    }));
    child.emit('close', 0, null);
    assert.equal((await first).standup, '- Task: Generated the first standup.');
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('standup generator bounds a stalled provider run', async () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'relay-standup-timeout-test-'));
  try {
    const generator = new StandupGenerator({
      temporaryRoot,
      timeoutMs: 5,
      spawnProcess: () => fakeChild(),
    });
    await assert.rejects(
      generator.generate('Create the standup.', {
        availability: { codex: true, claude: false },
      }),
      /timed out after 1 seconds/,
    );
    assert.equal(generator.active, null);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
