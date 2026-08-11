import assert from 'node:assert/strict';
import test from 'node:test';
import { ClaudeRuntimeStatus, isConfidentlyUnavailable, readClaudeRuntimeStatus } from '../src/claude-runtime-status.mjs';

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

test('Claude status probes the Windows shim through cmd.exe instead of reporting it missing', () => {
  const invocations = [];
  const status = readClaudeRuntimeStatus({
    platform: 'win32',
    command: 'C:\\Users\\dev\\AppData\\Roaming\\npm\\claude.cmd',
    run: (command, args, options) => {
      invocations.push({ command, args, options });
      return args[3].includes('--version')
        ? '2.1.218 (Claude Code)\n'
        : JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', subscriptionType: 'max' });
    },
  });

  // A direct .cmd probe fails on Windows, which reported an installed Claude as unavailable
  // and blocked every readiness gate in the interface.
  assert.equal(status.available, true);
  assert.equal(status.authenticated, true);
  assert.equal(invocations.length, 2);
  for (const invocation of invocations) {
    assert.equal(invocation.command, 'cmd.exe');
    assert.ok(invocation.args[3].includes('claude.cmd'));
    assert.equal(invocation.options.windowsVerbatimArguments, true);
    assert.equal(invocation.options.windowsHide, true);
  }
  // The auth probe keeps its own stdio override alongside the platform options.
  assert.deepEqual(invocations[1].options.stdio, ['ignore', 'pipe', 'pipe']);
});

test('Claude status distinguishes a missing executable from a transient probe failure', () => {
  const missing = readClaudeRuntimeStatus({
    run: () => {
      throw Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' });
    },
  });
  const transient = readClaudeRuntimeStatus({
    run: () => {
      throw Object.assign(new Error('Claude version probe timed out'), { code: 'ETIMEDOUT' });
    },
  });

  assert.equal(missing.available, false);
  assert.equal(missing.reason, 'not_installed');
  assert.equal(transient.available, false);
  assert.equal(transient.reason, 'probe_failed');
});

test('Claude runtime status passes its pinned command to the reader', async () => {
  const seen = [];
  const runtime = new ClaudeRuntimeStatus({
    command: '/Users/tester/.local/bin/claude',
    read: ({ command } = {}) => {
      seen.push(command);
      return { available: true, authenticated: true };
    },
  });
  await runtime.refresh();
  assert.deepEqual(seen, ['/Users/tester/.local/bin/claude']);
});

// current() must never spawn a process. It used to run two synchronous Claude CLI probes,
// which blocked the whole event loop and delayed every request including POST /api/tasks.
test('Claude status reads never probe from the request path', () => {
  let reads = 0;
  const runtime = new ClaudeRuntimeStatus({ read: () => { reads += 1; return { available: true, authenticated: true }; } });
  const status = runtime.current();
  assert.equal(reads, 0);
  assert.equal(status.pending, true);
  assert.equal(status.available, false);
  assert.equal(status.authenticated, false);
});

test('Claude status cache refreshes on expiry and explicit force', async () => {
  let timestamp = 1_000;
  let reads = 0;
  const runtime = new ClaudeRuntimeStatus({
    now: () => timestamp,
    cacheMs: 5_000,
    read: () => ({ available: true, authenticated: ++reads > 1 }),
  });
  assert.equal((await runtime.refresh()).authenticated, false);
  timestamp += 2_000;
  assert.equal((await runtime.refresh()).authenticated, false);
  assert.equal(reads, 1);
  assert.equal((await runtime.refresh({ force: true })).authenticated, true);
  assert.equal(reads, 2);
  assert.equal(runtime.current().authenticated, true);
});

test('Claude status refresh survives a probe that throws and keeps the last known value', async () => {
  let fail = false;
  const runtime = new ClaudeRuntimeStatus({
    cacheMs: 0,
    read: () => {
      if (fail) throw new Error('spawn EAGAIN');
      return { available: true, authenticated: true, version: '2.1.0' };
    },
  });
  await runtime.refresh({ force: true });
  fail = true;
  await runtime.refresh({ force: true });
  assert.equal(runtime.current().authenticated, true);
  assert.equal(runtime.current().version, '2.1.0');
});

test('concurrent refreshes share one probe', async () => {
  let reads = 0;
  const runtime = new ClaudeRuntimeStatus({
    cacheMs: 0,
    read: async () => { reads += 1; return { available: true, authenticated: true }; },
  });
  await Promise.all([runtime.refresh(), runtime.refresh(), runtime.refresh()]);
  assert.equal(reads, 1);
});

// Only a completed probe reporting a signed-out CLI may block a task add. Pending or errored
// status must not, or a transient blip costs the user their prompt.
test('only a completed signed-out probe is a confident negative', () => {
  assert.equal(isConfidentlyUnavailable({ pending: true, available: false, authenticated: false }), false);
  assert.equal(isConfidentlyUnavailable({ available: false, authenticated: false, error: 'timed out' }), false);
  assert.equal(isConfidentlyUnavailable({ available: true, authenticated: false, error: 'boom' }), false);
  assert.equal(isConfidentlyUnavailable({ available: true, authenticated: false, reason: 'signed_out' }), true);
  assert.equal(isConfidentlyUnavailable({ available: true, authenticated: true }), false);
});
