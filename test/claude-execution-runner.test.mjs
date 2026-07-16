import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import {
  ClaudeExecutionRunner,
  consumeClaudeStreamMessage,
} from '../src/claude-execution-runner.mjs';

test('Claude stream events pair tool use with its result', () => {
  const context = { cwd: '/tmp/repo', tools: new Map(), finalResponse: '', sessionId: 'one', error: null };
  const started = consumeClaudeStreamMessage({
    type: 'assistant',
    message: {
      content: [{ type: 'tool_use', id: 'tool-one', name: 'Bash', input: { command: 'npm test' } }],
    },
  }, context);
  const completed = consumeClaudeStreamMessage({
    type: 'user',
    message: {
      content: [{ type: 'tool_result', tool_use_id: 'tool-one', content: 'Tests passed' }],
    },
  }, context);

  assert.equal(started[0].event.type, 'item/started');
  assert.equal(started[0].event.item.command, 'npm test');
  assert.equal(completed[0].event.type, 'item/completed');
  assert.equal(completed[0].event.item.aggregatedOutput, 'Tests passed');
  assert.equal(completed[0].event.item.exitCode, 0);
});

test('Claude execution resumes a live session through the subscription CLI', async () => {
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
      child.stdout.write(`${JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Implemented the task.' }] },
      })}\n`);
      child.stdout.end(`${JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'Implemented the task.',
        session_id: 'claude-session',
      })}\n`);
      child.emit('close', 0, null);
    });
    return child;
  };
  const runner = new ClaudeExecutionRunner({
    spawnProcess,
    sessions: { readConnectedSession: async () => ({ rawStatus: 'idle' }) },
  });
  const events = [];
  const result = await runner.run({
    thread_id: 'claude-session',
    thread_name: 'Checkout work',
    repo_path: '/tmp/repo',
    prompt: 'Fix checkout.',
    provider: 'claude',
    model: 'opus',
    effort: 'max',
    attachments: [{ name: 'bug.png', path: '/tmp/images/bug.png' }],
  }, {
    onEvent: (event) => events.push(event),
    onStderr: () => {},
  });

  assert.equal(invocation.command, 'claude');
  assert.equal(invocation.options.cwd, '/tmp/repo');
  assert.deepEqual(
    invocation.args.slice(invocation.args.indexOf('--resume'), invocation.args.indexOf('--resume') + 2),
    ['--resume', 'claude-session'],
  );
  assert.deepEqual(
    invocation.args.slice(invocation.args.indexOf('--permission-mode'), invocation.args.indexOf('--permission-mode') + 2),
    ['--permission-mode', 'auto'],
  );
  assert.equal(invocation.args.includes('--no-session-persistence'), false);
  assert.deepEqual(
    invocation.args.slice(invocation.args.indexOf('--add-dir'), invocation.args.indexOf('--add-dir') + 2),
    ['--add-dir', '/tmp/images'],
  );
  assert.match(input, /Fix checkout/);
  assert.match(input, /bug\.png/);
  assert.equal(result.finalResponse, 'Implemented the task.');
  assert.equal(events.some((event) => event.event.type === 'claude/started'), true);
  assert.equal(events.some((event) => event.event.type === 'claude/completed'), true);
});
