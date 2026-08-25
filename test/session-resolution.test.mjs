import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolveSubmissionThread,
  SESSION_NEVER_SEEN,
  submissionSessionProvider,
} from '../src/session-resolution.mjs';

function deps({ live = null, known = null, previous = null, throws = null } = {}) {
  const errors = [];
  return {
    errors,
    options: {
      findSession: async () => {
        if (throws) throw throws;
        return live;
      },
      knownSession: () => known,
      latestTaskForThread: () => previous,
      onDiscoveryError: (error) => errors.push(error.message),
    },
  };
}

// Plan council and Turbo always drive a Codex terminal. Direct OpenCode work uses its
// own headless provider identity and never reaches terminal-session resolution.
test('session provider follows the workflow, not just the provider field', () => {
  assert.equal(submissionSessionProvider('execute', 'claude'), 'claude');
  assert.equal(submissionSessionProvider('execute', 'codex'), 'codex');
  assert.equal(submissionSessionProvider('execute', 'opencode'), 'opencode');
  assert.equal(submissionSessionProvider('plan', 'council'), 'codex');
  assert.equal(submissionSessionProvider('turbo', 'codex'), 'codex');
  assert.equal(submissionSessionProvider('plan', 'claude'), 'codex');
});

test('a live session resolves directly', async () => {
  const { options } = deps({ live: { id: 'session-a', cwd: '/tmp/alpha', title: 'Alpha', source: 'cli' } });
  const resolved = await resolveSubmissionThread('claude', 'session-a', options);
  assert.equal(resolved.source, 'live');
  assert.equal(resolved.live, true);
  assert.equal(resolved.thread.cwd, '/tmp/alpha');
});

// The exact regression that made adding a task fail: discovery is momentarily unusable, but
// the session is genuinely open and the task must still be accepted.
test('a discovery outage falls back to the last known good entry', async () => {
  const { options, errors } = deps({
    throws: new Error('spawn EAGAIN'),
    known: { id: 'session-a', cwd: '/tmp/alpha', title: 'Alpha', source: 'Claude interactive' },
  });
  const resolved = await resolveSubmissionThread('claude', 'session-a', options);
  assert.equal(resolved.source, 'last-known-good');
  assert.equal(resolved.live, false);
  assert.equal(resolved.thread.cwd, '/tmp/alpha');
  assert.deepEqual(errors, ['spawn EAGAIN']);
});

test('a session missing from the registry still resolves from task history', async () => {
  const { options } = deps({
    previous: { repo_path: '/tmp/alpha', thread_name: 'Alpha', thread_source: 'Claude interactive' },
  });
  const resolved = await resolveSubmissionThread('claude', 'session-a', options);
  assert.equal(resolved.source, 'task-history');
  assert.equal(resolved.live, false);
  assert.deepEqual(resolved.thread, {
    id: 'session-a',
    cwd: '/tmp/alpha',
    title: 'Alpha',
    source: 'Claude interactive',
    status: 'unknown',
  });
});

test('task history without a workspace is not usable and falls through', async () => {
  const { options } = deps({ previous: { repo_path: '', thread_name: 'Alpha' } });
  const resolved = await resolveSubmissionThread('claude', 'session-a', options);
  assert.equal(resolved.thread, null);
  assert.equal(resolved.source, 'unknown');
});

test('history fallback supplies a provider-appropriate default source', async () => {
  const claude = await resolveSubmissionThread('claude', 'session-a', deps({
    previous: { repo_path: '/tmp/alpha', thread_name: null, thread_source: null },
  }).options);
  assert.equal(claude.thread.source, 'Claude session');
  assert.equal(claude.thread.title, 'session-a', 'the id stands in for a missing name');

  const codex = await resolveSubmissionThread('codex', 'thread-a', deps({
    previous: { repo_path: '/tmp/alpha', thread_name: null, thread_source: null },
  }).options);
  assert.equal(codex.thread.source, 'Codex terminal');
});

// The only remaining rejection: nothing anywhere knows this session.
test('a session CC Relay has never seen anywhere is rejected', async () => {
  const { options } = deps();
  const resolved = await resolveSubmissionThread('claude', 'session-a', options);
  assert.equal(resolved.thread, null);
  assert.equal(resolved.source, 'unknown');
  assert.match(SESSION_NEVER_SEEN.claude, /never seen that Claude Code session/);
  assert.match(SESSION_NEVER_SEEN.codex, /never seen that terminal/);
  assert.match(SESSION_NEVER_SEEN.opencode, /automatic headless execution/);
});

test('a live hit never consults the fallbacks', async () => {
  let knownCalls = 0;
  let historyCalls = 0;
  const resolved = await resolveSubmissionThread('codex', 'thread-a', {
    findSession: async () => ({ id: 'thread-a', cwd: '/tmp/alpha', title: 'Alpha', source: 'cli' }),
    knownSession: () => { knownCalls += 1; return null; },
    latestTaskForThread: () => { historyCalls += 1; return null; },
  });
  assert.equal(resolved.source, 'live');
  assert.equal(knownCalls, 0);
  assert.equal(historyCalls, 0);
});
