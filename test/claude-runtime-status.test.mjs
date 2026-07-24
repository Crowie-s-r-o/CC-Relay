import assert from 'node:assert/strict';
import test from 'node:test';
import { ClaudeRuntimeStatus, readClaudeRuntimeStatus } from '../src/claude-runtime-status.mjs';

test('Claude status recognizes signed-in CLI output', () => {
  const status = readClaudeRuntimeStatus({
    run: (_command, args) => args[0] === '--version'
      ? '2.1.216 (Claude Code)\n'
      : JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', subscriptionType: 'max' }),
  });
  assert.deepEqual(status, {
    available: true,
    authenticated: true,
    version: '2.1.216 (Claude Code)',
    authMethod: 'claude.ai',
    subscriptionType: 'max',
    reason: null,
  });
});

test('Claude status preserves installed but signed-out JSON from exit code 1', () => {
  const status = readClaudeRuntimeStatus({
    run: (_command, args) => {
      if (args[0] === '--version') return '2.1.216 (Claude Code)\n';
      throw Object.assign(new Error('Command failed'), {
        stdout: JSON.stringify({ loggedIn: false, authMethod: 'none', apiProvider: 'firstParty' }),
      });
    },
  });
  assert.deepEqual(status, {
    available: true,
    authenticated: false,
    version: '2.1.216 (Claude Code)',
    authMethod: 'none',
    subscriptionType: null,
    reason: 'signed_out',
  });
});

test('Claude status probes the resolved absolute binary path', () => {
  const commands = [];
  readClaudeRuntimeStatus({
    command: '/Users/tester/.local/bin/claude',
    run: (command, args) => {
      commands.push(command);
      return args[0] === '--version'
        ? '2.1.218 (Claude Code)\n'
        : JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', subscriptionType: 'max' });
    },
  });
  assert.deepEqual(commands, ['/Users/tester/.local/bin/claude', '/Users/tester/.local/bin/claude']);
});

test('Claude runtime status passes its pinned command to the reader', () => {
  const seen = [];
  const runtime = new ClaudeRuntimeStatus({
    command: '/Users/tester/.local/bin/claude',
    read: ({ command } = {}) => {
      seen.push(command);
      return { available: true, authenticated: true };
    },
  });
  runtime.current();
  assert.deepEqual(seen, ['/Users/tester/.local/bin/claude']);
});

test('Claude status cache refreshes on expiry and explicit submission checks', () => {
  let timestamp = 1_000;
  let reads = 0;
  const runtime = new ClaudeRuntimeStatus({
    now: () => timestamp,
    cacheMs: 5_000,
    read: () => ({ available: true, authenticated: ++reads > 1 }),
  });
  assert.equal(runtime.current().authenticated, false);
  timestamp += 2_000;
  assert.equal(runtime.current().authenticated, false);
  assert.equal(reads, 1);
  assert.equal(runtime.current({ force: true }).authenticated, true);
  assert.equal(reads, 2);
});
