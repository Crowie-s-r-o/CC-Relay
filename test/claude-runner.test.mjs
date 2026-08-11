import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { ClaudeRunner, claudeFailureMessage, parseClaudeResult } from '../src/claude-runner.mjs';
import { RELAY_NON_INTERACTIVE_INSTRUCTION } from '../src/relay-prompt.mjs';

test('Claude runner spawns the resolved absolute binary path', () => {
  let invocation;
  const spawnProcess = (command, args, options) => {
    invocation = { command, args, options };
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new PassThrough();
    child.kill = () => true;
    return child;
  };
  const runner = new ClaudeRunner({ command: '/Users/tester/.local/bin/claude', spawnProcess });
  runner.run('Plan.', { cwd: '/tmp/project', model: 'opus', effort: 'max', onEvent: () => {}, onStderr: () => {} });
  assert.equal(invocation.command, '/Users/tester/.local/bin/claude');
});

test('Claude runner launches the Windows shim through cmd.exe and cancels its whole tree', () => {
  const invocations = [];
  const terminations = [];
  const spawnProcess = (command, args, options) => {
    invocations.push({ command, args, options });
    const child = new EventEmitter();
    child.pid = 1234;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new PassThrough();
    child.kill = () => { throw new Error('a Windows cancel must not signal cmd.exe directly'); };
    return child;
  };
  const runner = new ClaudeRunner({
    command: 'C:\\Users\\dev\\AppData\\Roaming\\npm\\claude.cmd',
    platform: 'win32',
    spawnProcess,
    terminateProcess: (child, options) => {
      terminations.push({ pid: child.pid, ...options });
      return true;
    },
  });
  runner.run('Plan.', {
    cwd: 'C:\\work\\app',
    model: 'opus',
    effort: 'max',
    owner: 'task-1',
    onEvent: () => {},
    onStderr: () => {},
  });

  assert.equal(invocations[0].command, 'cmd.exe');
  assert.deepEqual(invocations[0].args.slice(0, 3), ['/d', '/s', '/c']);
  assert.ok(invocations[0].args[3].includes('claude.cmd'));
  assert.ok(invocations[0].args[3].includes('--safe-mode'));
  assert.equal(invocations[0].options.windowsVerbatimArguments, true);
  assert.equal(invocations[0].options.windowsHide, true);
  assert.equal(invocations[0].options.cwd, 'C:\\work\\app');

  // Killing cmd.exe would leave Claude running against the user's workspace.
  assert.equal(runner.cancel('task-1'), true);
  assert.deepEqual(terminations, [{ pid: 1234, signal: 'SIGTERM', platform: 'win32' }]);
});

test('Claude runner cancel still signals the child directly on POSIX', () => {
  const killed = [];
  const spawnProcess = () => {
    const child = new EventEmitter();
    child.pid = 99;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new PassThrough();
    child.kill = (signal) => { killed.push(signal); return true; };
    return child;
  };
  const runner = new ClaudeRunner({ spawnProcess, platform: 'darwin' });
  runner.run('Plan.', {
    cwd: '/tmp/project',
    model: 'opus',
    effort: 'max',
    owner: 'task-2',
    onEvent: () => {},
    onStderr: () => {},
  });
  assert.equal(runner.cancel('task-2'), true);
  assert.deepEqual(killed, ['SIGTERM']);
});

test('Claude JSON output extracts only the final result', () => {
  const output = JSON.stringify([
    { type: 'system', subtype: 'init', session_id: 'session-one' },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'Drafting' }] } },
    {
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: '# Final plan',
      session_id: 'session-one',
      modelUsage: { 'claude-opus-test': {} },
    },
  ]);

  assert.deepEqual(parseClaudeResult(output), {
    text: '# Final plan',
    sessionId: 'session-one',
    model: 'claude-opus-test',
  });
});

test('Claude JSON output rejects failed result messages', () => {
  assert.throws(() => parseClaudeResult(JSON.stringify({
    type: 'result',
    subtype: 'error_during_execution',
    is_error: true,
    result: 'Model unavailable',
  })), /Model unavailable/);
});

test('Claude failure output preserves the actionable provider message', () => {
  const output = JSON.stringify([
    { type: 'assistant', error: 'authentication_failed', message: { content: [{ type: 'text', text: 'OAuth expired.' }] } },
    { type: 'result', subtype: 'success', is_error: true, result: 'OAuth session expired and could not be refreshed' },
  ]);
  assert.equal(claudeFailureMessage(output), 'OAuth session expired and could not be refreshed');
});

test('Claude runner uses subscription CLI in safe read-only plan mode with Fable', async () => {
  let invocation;
  let input = '';
  const spawnProcess = (command, args, options) => {
    invocation = { command, args, options };
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new PassThrough();
    child.stdin.on('data', (chunk) => { input += chunk.toString(); });
    child.kill = () => true;
    queueMicrotask(() => {
      child.stdout.end(JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: '# Plan',
        session_id: 'session-plan',
      }));
      child.emit('close', 0, null);
    });
    return child;
  };
  const runner = new ClaudeRunner({ spawnProcess });
  const events = [];
  const result = await runner.run('Inspect and plan.', {
    cwd: '/tmp/project',
    model: 'fable',
    effort: 'max',
    attachmentPaths: ['/tmp/relay-images/one.png', '/tmp/relay-images/two.jpg'],
    onEvent: (event) => events.push(event),
    onStderr: () => {},
  });

  assert.equal(invocation.command, 'claude');
  assert.equal(invocation.options.cwd, '/tmp/project');
  assert.deepEqual(invocation.options.stdio, ['pipe', 'pipe', 'pipe']);
  assert.equal(invocation.args.includes('--safe-mode'), true);
  assert.equal(invocation.args.includes('--no-session-persistence'), true);
  assert.deepEqual(
    invocation.args.slice(invocation.args.indexOf('--permission-mode'), invocation.args.indexOf('--permission-mode') + 2),
    ['--permission-mode', 'plan'],
  );
  assert.deepEqual(
    invocation.args.slice(invocation.args.indexOf('--model'), invocation.args.indexOf('--model') + 2),
    ['--model', 'fable'],
  );
  assert.deepEqual(
    invocation.args.slice(invocation.args.indexOf('--effort'), invocation.args.indexOf('--effort') + 2),
    ['--effort', 'max'],
  );
  assert.deepEqual(
    invocation.args.slice(invocation.args.indexOf('--add-dir'), invocation.args.indexOf('--add-dir') + 2),
    ['--add-dir', '/tmp/relay-images'],
  );
  assert.equal(input, `Inspect and plan.\n\n${RELAY_NON_INTERACTIVE_INSTRUCTION}`);
  assert.equal(result.text, '# Plan');
  assert.equal(events.length, 2);
});

test('Claude runner reports JSON errors from nonzero exits and marks them non-retryable', async () => {
  const spawnProcess = () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new PassThrough();
    child.kill = () => true;
    queueMicrotask(() => {
      child.stdout.end(JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: true,
        result: 'OAuth session expired and could not be refreshed',
      }));
      child.emit('close', 1, null);
    });
    return child;
  };
  const runner = new ClaudeRunner({ spawnProcess });
  await assert.rejects(
    runner.run('Plan this.', {
      cwd: '/tmp/project',
      model: 'opus',
      effort: 'max',
      onEvent: () => {},
      onStderr: () => {},
    }),
    (error) => {
      assert.equal(error.message, 'OAuth session expired and could not be refreshed');
      assert.equal(error.exitCode, 1);
      assert.equal(error.retryable, false);
      return true;
    },
  );
});
