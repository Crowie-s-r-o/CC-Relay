import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ClaudeSessionRegistry,
  normalizeClaudeSessions,
} from '../src/claude-session-registry.mjs';

test('Claude session discovery exposes only live CLI sessions', () => {
  const sessions = normalizeClaudeSessions([
    {
      pid: 42,
      cwd: '/tmp/project',
      kind: 'interactive',
      startedAt: 100,
      sessionId: 'session-one',
      name: 'Checkout work',
      status: 'busy',
    },
    { cwd: '/tmp/missing-pid', sessionId: 'invalid' },
  ]);

  assert.deepEqual(sessions, [{
    id: 'session-one',
    provider: 'claude',
    sessionId: 'session-one',
    title: 'Checkout work',
    preview: 'interactive session currently working',
    cwd: '/tmp/project',
    source: 'Claude interactive',
    status: 'active',
    rawStatus: 'busy',
    pid: 42,
    connectedToRelay: true,
    updatedAt: 100,
  }]);
});

test('Claude session registry uses the official agents JSON command', async () => {
  const calls = [];
  const registry = new ClaudeSessionRegistry({
    runCommand: async (command, args) => {
      calls.push({ command, args });
      return JSON.stringify([{
        pid: 8,
        cwd: '/tmp/repo',
        kind: 'interactive',
        startedAt: 200,
        sessionId: 'session-two',
        name: 'Repo session',
        status: 'idle',
      }]);
    },
  });

  const sessions = await registry.listSessions();
  assert.deepEqual(calls, [{ command: 'claude', args: ['agents', '--json'] }]);
  assert.equal(sessions[0].id, 'session-two');
  assert.equal(sessions[0].status, 'idle');
});
