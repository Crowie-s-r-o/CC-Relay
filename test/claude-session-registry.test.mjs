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

test('Claude session registry invokes the resolved absolute binary path', async () => {
  const calls = [];
  const registry = new ClaudeSessionRegistry({
    resolveCommand: async () => '/Users/tester/.local/bin/claude',
    runCommand: async (command, args) => {
      calls.push({ command, args });
      return JSON.stringify([]);
    },
  });

  await registry.listSessions();
  assert.deepEqual(calls, [{ command: '/Users/tester/.local/bin/claude', args: ['agents', '--json'] }]);
});

test('Claude session registry re-resolves and retries after an unknown-option failure', async () => {
  const calls = [];
  const resolves = [];
  const registry = new ClaudeSessionRegistry({
    resolveCommand: async ({ refresh = false } = {}) => {
      resolves.push(refresh);
      return refresh ? '/Users/tester/.local/bin/claude' : '/opt/homebrew/bin/claude';
    },
    runCommand: async (command, args) => {
      calls.push({ command, args });
      if (command === '/opt/homebrew/bin/claude') {
        throw Object.assign(new Error('Command failed'), { stderr: "error: unknown option '--json'" });
      }
      return JSON.stringify([{
        pid: 9,
        cwd: '/tmp/repo',
        kind: 'interactive',
        startedAt: 300,
        sessionId: 'session-three',
        name: 'Recovered',
        status: 'idle',
      }]);
    },
  });

  const sessions = await registry.listSessions();
  assert.deepEqual(resolves, [false, true]);
  assert.deepEqual(calls.map((call) => call.command), [
    '/opt/homebrew/bin/claude',
    '/Users/tester/.local/bin/claude',
  ]);
  assert.equal(sessions[0].id, 'session-three');
  assert.equal(registry.lastError, null);
});

test('Claude session registry does not retry when the re-resolved binary is unchanged', async () => {
  let runs = 0;
  const registry = new ClaudeSessionRegistry({
    resolveCommand: async () => 'claude',
    runCommand: async () => {
      runs += 1;
      throw Object.assign(new Error('Command failed'), { stderr: "error: unknown option '--json'" });
    },
  });

  const sessions = await registry.listSessions();
  assert.deepEqual(sessions, []);
  assert.equal(runs, 1);
  assert.equal(registry.lastError, 'Command failed');
});

test('Claude session discovery runs the Windows shim through cmd.exe without flashing a console', async () => {
  const calls = [];
  const registry = new ClaudeSessionRegistry({
    platform: 'win32',
    resolveCommand: async () => 'C:\\Users\\dev\\AppData\\Roaming\\npm\\claude.cmd',
    runCommand: async (command, args, options) => {
      calls.push({ command, args, options });
      return JSON.stringify([]);
    },
  });

  await registry.listSessions();
  assert.equal(calls.length, 1);
  // A direct .cmd spawn fails on Windows, which used to make every discovery poll fail.
  assert.equal(calls[0].command, 'cmd.exe');
  assert.deepEqual(calls[0].args.slice(0, 3), ['/d', '/s', '/c']);
  assert.ok(calls[0].args[3].includes('claude.cmd'));
  assert.ok(calls[0].args[3].includes('agents'));
  assert.equal(calls[0].options.windowsVerbatimArguments, true);
  // This poll repeats every few seconds, so an unhidden console would flash that often.
  assert.equal(calls[0].options.windowsHide, true);
});

test('Claude session discovery keeps the POSIX invocation byte-identical', async () => {
  const calls = [];
  const registry = new ClaudeSessionRegistry({
    platform: 'darwin',
    resolveCommand: async () => '/Users/tester/.local/bin/claude',
    runCommand: async (command, args, options) => {
      calls.push({ command, args, options });
      return JSON.stringify([]);
    },
  });

  await registry.listSessions();
  assert.deepEqual(calls, [{
    command: '/Users/tester/.local/bin/claude',
    args: ['agents', '--json'],
    options: {},
  }]);
});

test('Claude session discovery deduplicates one session ID and keeps the interactive terminal', () => {
  const sessions = normalizeClaudeSessions([
    {
      pid: 100,
      cwd: '/tmp/project',
      kind: 'interactive',
      startedAt: 100,
      sessionId: 'shared-session',
      name: 'Visible terminal',
      status: 'idle',
    },
    {
      pid: 101,
      cwd: '/tmp/project',
      kind: 'background',
      startedAt: 200,
      sessionId: 'shared-session',
      name: 'Print child',
      status: 'busy',
    },
  ]);

  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].title, 'Visible terminal');
  assert.equal(sessions[0].source, 'Claude interactive');
  assert.equal(sessions[0].pid, 100);
});
