import assert from 'node:assert/strict';
import test from 'node:test';
import { ClaudeExecutionRunner } from '../src/claude-execution-runner.mjs';

function sessions({ session, stale = false }) {
  return {
    stale,
    readConnectedSession: async () => session,
  };
}

function runnerFor(registry, { now, idleDiscoveryStaleLimitMs = 60_000 } = {}) {
  return new ClaudeExecutionRunner({
    sessions: registry,
    wait: async () => {},
    now,
    idleDiscoveryStaleLimitMs,
  });
}

const busy = { id: 'session-a', cwd: '/tmp/alpha', rawStatus: 'busy' };
const idle = { id: 'session-a', cwd: '/tmp/alpha', rawStatus: 'idle' };

test('an idle session returns immediately', async () => {
  const runner = runnerFor(sessions({ session: idle }));
  const resolved = await runner.waitForIdle({ thread_id: 'session-a' }, { cancelRequested: false }, () => {});
  assert.equal(resolved.rawStatus, 'idle');
});

// The registry serves last-known-good during an outage, so a session cached as busy would be
// reported busy forever and the task would hang on "Waiting for the selected Claude session to
// become idle" with nothing ever typed.
test('persistent discovery staleness fails instead of waiting forever', async () => {
  let clock = 0;
  const registry = sessions({ session: busy, stale: true });
  const runner = runnerFor(registry, { now: () => { clock += 5_000; return clock; } });

  await assert.rejects(
    runner.waitForIdle({ thread_id: 'session-a' }, { cancelRequested: false }, () => {}),
    (error) => {
      assert.match(error.message, /could not read live Claude session state for 60 seconds/);
      assert.match(error.message, /typed nothing/, 'the user must know nothing was sent');
      assert.equal(error.retryable, false, 'a broken CLI must not be retried automatically');
      return true;
    },
  );
});

test('a busy session with healthy discovery is not treated as stale', async () => {
  let polls = 0;
  const registry = {
    stale: false,
    readConnectedSession: async () => {
      polls += 1;
      return polls < 4 ? busy : idle;
    },
  };
  let clock = 0;
  const runner = runnerFor(registry, { now: () => { clock += 100_000; return clock; } });

  const resolved = await runner.waitForIdle({ thread_id: 'session-a' }, { cancelRequested: false }, () => {});
  assert.equal(resolved.rawStatus, 'idle');
  assert.equal(polls, 4, 'healthy discovery must keep waiting however long the terminal is busy');
});

// A blip must not fail the task; only sustained staleness does.
test('staleness that recovers resets the deadline', async () => {
  let polls = 0;
  const registry = {
    stale: false,
    readConnectedSession: async () => {
      polls += 1;
      registry.stale = polls < 3;
      return polls < 5 ? busy : idle;
    },
  };
  let clock = 0;
  const runner = runnerFor(registry, { now: () => { clock += 40_000; return clock; } });

  const resolved = await runner.waitForIdle({ thread_id: 'session-a' }, { cancelRequested: false }, () => {});
  assert.equal(resolved.rawStatus, 'idle');
});

test('a genuinely closed session still fails with its own message', async () => {
  const runner = runnerFor(sessions({ session: null }));
  await assert.rejects(
    runner.waitForIdle({ thread_id: 'session-a' }, { cancelRequested: false }, () => {}),
    /no longer open/,
  );
});

test('cancellation still wins over the staleness deadline', async () => {
  const runner = runnerFor(sessions({ session: busy, stale: true }));
  await assert.rejects(
    runner.waitForIdle({ thread_id: 'session-a' }, { cancelRequested: true }, () => {}),
    (error) => {
      assert.equal(error.cancelled, true);
      return true;
    },
  );
});
