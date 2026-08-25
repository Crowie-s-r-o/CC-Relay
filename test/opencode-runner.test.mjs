import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import {
  OpenCodeRunner,
  openCodeRunArguments,
  openCodeSessionSnapshot,
} from '../src/opencode-runner.mjs';

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.pid = 12345;
  child.kill = () => true;
  return child;
}

test('OpenCode runner streams native messages and cumulative token usage', async () => {
  const child = fakeChild();
  const calls = [];
  const events = [];
  const runner = new OpenCodeRunner({
    command: '/bin/opencode',
    platform: 'darwin',
    spawnProcess: (command, args, options) => {
      calls.push({ command, args, options });
      return child;
    },
  });
  const task = {
    id: 7,
    repo_path: '/repo',
    prompt: 'Implement it',
    provider: 'opencode',
    model: 'anthropic/claude-sonnet-4',
    effort: null,
    attachments: [{ path: '/repo/reference.png' }],
  };
  const completion = runner.run(task, {
    onEvent: (event) => events.push(event),
    onStderr: () => {},
  });
  child.stdout.write(`${JSON.stringify({ type: 'step_start', sessionID: 'session-7', part: {} })}\n`);
  child.stdout.write(`${JSON.stringify({ type: 'step_finish', sessionID: 'session-7', part: { tokens: { input: 100, output: 20, reasoning: 5, cache: { read: 30, write: 4 } } } })}\n`);
  child.stdout.write(`${JSON.stringify({ type: 'step_finish', sessionID: 'session-7', part: { tokens: { input: 40, output: 10, reasoning: 2, cache: { read: 8, write: 1 } } } })}\n`);
  child.stdout.write(`${JSON.stringify({ type: 'text', sessionID: 'session-7', part: { text: 'Finished work.' } })}\n`);
  child.stdout.end();
  child.stderr.end();
  child.emit('close', 0, null);
  const outcome = await completion;

  assert.equal(outcome.finalResponse, 'Finished work.');
  assert.equal(outcome.sessionId, 'session-7');
  assert.equal(calls[0].command, '/bin/opencode');
  assert.deepEqual(calls[0].args.slice(0, 7), [
    'run', '--format', 'json', '--auto', '--dir', '/repo', '--model',
  ]);
  assert.ok(calls[0].args.includes('anthropic/claude-sonnet-4'));
  assert.ok(calls[0].args.includes('/repo/reference.png'));
  assert.match(calls[0].args.at(-1), /Implement it/);
  const usageEvents = events.filter((entry) => entry.event.type === 'provider/token-usage');
  const sessionEvent = events.find((entry) => entry.event.type === 'opencode/session');
  assert.equal(sessionEvent.event.sessionId, 'session-7');
  assert.equal(usageEvents.length, 2);
  assert.equal(usageEvents[0].event.usage.totalTokens, 159);
  assert.equal(usageEvents[1].event.usage.totalTokens, 220);
  assert.equal(usageEvents[1].event.source, 'native');
});

test('OpenCode run arguments resume the native session and omit the default model', () => {
  const args = openCodeRunArguments({
    repo_path: '/repo',
    thread_id: 'session-9',
    model: 'default',
    prompt: 'Continue',
    attachments: [],
  });
  assert.deepEqual(args.slice(0, 8), [
    'run', '--format', 'json', '--auto', '--dir', '/repo', '--session', 'session-9',
  ]);
  assert.equal(args.includes('--model'), false);
});

test('OpenCode runner cancellation terminates its process group', async () => {
  const child = fakeChild();
  let terminated = false;
  const runner = new OpenCodeRunner({
    spawnProcess: () => child,
    terminateProcess: () => {
      terminated = true;
      return true;
    },
  });
  const completion = runner.run({
    id: 8,
    repo_path: '/repo',
    prompt: 'Wait',
    attachments: [],
  }, { onEvent: () => {}, onStderr: () => {} });
  assert.equal(runner.cancel(8), true);
  child.emit('close', null, 'SIGTERM');
  await assert.rejects(completion, (error) => error.cancelled === true);
  assert.equal(terminated, true);
});

test('OpenCode runner terminates a newline-free stderr record above its limit', async () => {
  const child = fakeChild();
  const stderr = [];
  let terminated = false;
  const runner = new OpenCodeRunner({
    spawnProcess: () => child,
    terminateProcess: () => {
      terminated = true;
      return true;
    },
  });
  const completion = runner.run({
    id: 9,
    repo_path: '/repo',
    prompt: 'Bound stderr',
    attachments: [],
  }, { onEvent: () => {}, onStderr: (value) => stderr.push(value) });

  child.stderr.write('x'.repeat((256 * 1024) + 1));
  child.emit('close', null, 'SIGTERM');

  await assert.rejects(completion, /stderr that exceeded CC Relay limits/);
  assert.equal(terminated, true);
  assert.deepEqual(stderr, ['OpenCode emitted stderr that exceeded CC Relay limits.']);
});

test('OpenCode runner terminates a complete stream record above its limit', async () => {
  const child = fakeChild();
  const stderr = [];
  let terminated = false;
  const runner = new OpenCodeRunner({
    spawnProcess: () => child,
    terminateProcess: () => {
      terminated = true;
      return true;
    },
  });
  const completion = runner.run({
    id: 12,
    repo_path: '/repo',
    prompt: 'Bound stdout',
    attachments: [],
  }, { onEvent: () => {}, onStderr: (value) => stderr.push(value) });

  child.stdout.write(`${'x'.repeat((4 * 1024 * 1024) + 1)}\n`);
  child.emit('close', null, 'SIGTERM');

  await assert.rejects(completion, /event that exceeded CC Relay limits/);
  assert.equal(terminated, true);
  assert.deepEqual(stderr, ['OpenCode emitted an event that exceeded CC Relay limits.']);
});

test('OpenCode runner rejects a stream that changes the requested session', async () => {
  const child = fakeChild();
  const events = [];
  let terminated = false;
  const runner = new OpenCodeRunner({
    spawnProcess: () => child,
    terminateProcess: () => {
      terminated = true;
      return true;
    },
  });
  const completion = runner.run({
    id: 11,
    repo_path: '/repo',
    thread_id: 'expected-session',
    prompt: 'Resume safely',
    attachments: [],
  }, { onEvent: (event) => events.push(event), onStderr: () => {} });

  child.stdout.write(`${JSON.stringify({
    type: 'step_start',
    sessionID: 'different-session',
    part: {},
  })}\n`);
  child.emit('close', 0, null);

  await assert.rejects(completion, /reported session different-session.*expected expected-session/);
  assert.equal(terminated, true);
  assert.equal(events.filter((entry) => entry.event.type === 'error').length, 1);
});

test('OpenCode reconciles a missing final stream event from its native session export', async () => {
  const child = fakeChild();
  const events = [];
  const exports = [];
  const runner = new OpenCodeRunner({
    spawnProcess: () => child,
    now: () => 1_000,
    readSession: async (options) => {
      exports.push(options);
      return {
        messages: [{
          info: {
            id: 'message-10',
            role: 'assistant',
            time: { created: 1_100 },
          },
          parts: [
            { id: 'text-10', type: 'text', text: 'Recovered response.' },
            {
              id: 'finish-10',
              type: 'step-finish',
              tokens: {
                total: 159,
                input: 100,
                output: 20,
                reasoning: 5,
                cache: { read: 30, write: 4 },
              },
            },
          ],
        }],
      };
    },
  });
  const completion = runner.run({
    id: 10,
    repo_path: '/repo',
    prompt: 'Recover stats',
    attachments: [],
  }, { onEvent: (event) => events.push(event), onStderr: () => {} });
  child.stdout.write(`${JSON.stringify({
    type: 'step_start',
    sessionID: 'session-10',
    part: { id: 'start-10', messageID: 'message-10' },
  })}\n`);
  child.stdout.end();
  child.stderr.end();
  child.emit('close', 0, null);
  const outcome = await completion;

  assert.equal(outcome.finalResponse, 'Recovered response.');
  assert.equal(outcome.sessionId, 'session-10');
  assert.equal(exports.length, 1);
  assert.equal(exports[0].sessionId, 'session-10');
  const usage = events.find((entry) => entry.event.type === 'provider/token-usage');
  assert.equal(usage.event.usage.totalTokens, 159);
  assert.equal(usage.event.reconciledFrom, 'session-export');
  const response = events.find((entry) => entry.event.type === 'opencode/message');
  assert.equal(response.event.text, 'Recovered response.');
  assert.equal(response.event.reconciledFrom, 'session-export');
});

test('OpenCode session snapshots isolate this run and prefer step-finish usage', () => {
  const snapshot = openCodeSessionSnapshot({
    messages: [
      {
        info: {
          id: 'old-message',
          role: 'assistant',
          time: { created: 500 },
          tokens: { total: 9_999 },
        },
        parts: [{ type: 'text', text: 'Old response.' }],
      },
      {
        info: {
          id: 'current-message',
          role: 'assistant',
          time: { created: 1_500 },
          tokens: { total: 9_999 },
        },
        parts: [
          { type: 'text', text: 'Current response.' },
          { id: 'finish-current', type: 'step-finish', tokens: { total: 120 } },
        ],
      },
    ],
  }, { messageIds: ['current-message'], startedAt: 1_000 });

  assert.equal(snapshot.usage.totalTokens, 120);
  assert.equal(snapshot.finalResponse, 'Current response.');
});
