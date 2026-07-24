import assert from 'node:assert/strict';
import test from 'node:test';
import { TerminalLaunchCoordinator } from '../src/terminal-launch-coordinator.mjs';

test('concurrent native launches stay serialized until each new session is bound', async () => {
  const calls = [];
  const launches = [
    { launchId: 'launch-one', provider: 'codex', path: '/work/project' },
    { launchId: 'launch-two', provider: 'codex', path: '/work/project' },
  ];
  let visibleCount = 0;
  const launcher = {
    async launch() {
      const launched = launches.shift();
      calls.push(`launch:${launched.launchId}`);
      visibleCount += 1;
      return launched;
    },
    bindOwnedTerminal(launchId, thread) {
      calls.push(`bind:${launchId}:${thread.id}`);
    },
  };
  let observations = 0;
  const coordinator = new TerminalLaunchCoordinator({
    launcher,
    pollMs: 0,
    delay: async () => {},
    listSessions: async () => {
      observations += 1;
      if (visibleCount === 0) return [];
      const sessions = [{ id: 'thread-one', launchId: 'launch-one', provider: 'codex', cwd: '/work/project' }];
      if (visibleCount > 1) sessions.push({ id: 'thread-two', launchId: 'launch-two', provider: 'codex', cwd: '/work/project' });
      return sessions;
    },
  });

  const [first, second] = await Promise.all([
    coordinator.launch('/work/project', 'codex'),
    coordinator.launch('/work/project', 'codex'),
  ]);

  assert.equal(first.threadId, 'thread-one');
  assert.equal(second.threadId, 'thread-two');
  assert.deepEqual(calls, [
    'launch:launch-one',
    'bind:launch-one:thread-one',
    'launch:launch-two',
    'bind:launch-two:thread-two',
  ]);
  assert.ok(observations >= 4);
});

test('a missing native handle or unreliable initial discovery skips automatic binding', async () => {
  const bound = [];
  const released = [];
  const withoutHandle = new TerminalLaunchCoordinator({
    launcher: {
      launch: async () => ({ launchId: null, provider: 'claude', path: '/work/project' }),
      bindOwnedTerminal: (...args) => bound.push(args),
    },
    listSessions: async () => [],
  });
  assert.equal((await withoutHandle.launch('/work/project', 'claude')).threadId, undefined);

  let clock = 0;
  const unreliable = new TerminalLaunchCoordinator({
    launcher: {
      launch: async () => ({ launchId: 'launch-one', provider: 'claude', path: '/work/project' }),
      bindOwnedTerminal: (...args) => bound.push(args),
      releaseLaunchReservation: (launchId) => released.push(launchId),
    },
    listSessions: async () => { throw new Error('discovery unavailable'); },
    now: () => clock,
    timeoutMs: 5,
    pollMs: 5,
    delay: async (milliseconds) => { clock += milliseconds; },
  });
  assert.deepEqual(await unreliable.launch('/work/project', 'claude'), {
    launchId: 'launch-one',
    provider: 'claude',
    path: '/work/project',
    connectionStatus: 'timed_out',
  });
  assert.deepEqual(bound, []);
  assert.deepEqual(released, ['launch-one']);
});

test('Claude binding uses the launch UUID and ignores another new session in the same project', async () => {
  const bound = [];
  const coordinator = new TerminalLaunchCoordinator({
    launcher: {
      launch: async () => ({ launchId: 'launch-claude', provider: 'claude', path: '/work/project' }),
      bindOwnedTerminal: (launchId, thread) => bound.push([launchId, thread.id]),
    },
    pollMs: 0,
    delay: async () => {},
    listSessions: async () => [
      { id: 'manual-session', provider: 'claude', cwd: '/work/project' },
      { id: 'launch-claude', provider: 'claude', cwd: '/work/project' },
    ],
  });

  const launched = await coordinator.launch('/work/project', 'claude');
  assert.equal(launched.threadId, 'launch-claude');
  assert.deepEqual(bound, [['launch-claude', 'launch-claude']]);
});
