import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ClaudeSessionRegistry } from '../src/claude-session-registry.mjs';
import { RelayDatabase } from '../src/database.mjs';
import { AgentUpdateCache } from '../src/running-task-feed.mjs';

function sessionPayload(sessions) {
  return JSON.stringify(sessions.map((session) => ({
    sessionId: session.id,
    cwd: session.cwd,
    pid: session.pid,
    kind: 'interactive',
    name: session.name,
    status: session.status || 'idle',
    startedAt: 1,
  })));
}

function withDatabase(run) {
  const directory = mkdtempSync(join(tmpdir(), 'relay-add-reliability-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  try {
    return run(database);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

// The exact failure the user reported as "sometimes it is not possible to add a new task".
// One transient `claude agents --json` failure used to blank the cache, which made every live
// session disappear and turned POST /api/tasks into a hard rejection.
test('a transient discovery failure keeps the last known good session list', async () => {
  let fail = false;
  const registry = new ClaudeSessionRegistry({
    cacheMs: 0,
    runCommand: async () => {
      if (fail) throw Object.assign(new Error('spawn EAGAIN'), { code: 'EAGAIN' });
      return sessionPayload([{ id: 'session-a', cwd: '/tmp/alpha', pid: 11, name: 'Alpha' }]);
    },
  });

  assert.equal((await registry.listSessions()).length, 1);
  fail = true;
  const afterFailure = await registry.listSessions({ refresh: true });
  assert.equal(afterFailure.length, 1, 'a failed probe must not erase known sessions');
  assert.equal(afterFailure[0].id, 'session-a');
  assert.equal(registry.stale, true);
  assert.match(registry.lastError, /EAGAIN/);

  // The add path can still bind a task to that session while discovery is broken.
  assert.equal((await registry.findSession('session-a'))?.cwd, '/tmp/alpha');
  assert.equal(registry.knownSession('session-a')?.id, 'session-a');
});

// A probe that SUCCEEDS and omits a session is real evidence the session closed, so it must
// still be removed. Otherwise last-known-good would hide genuinely dead terminals forever.
test('a successful discovery still removes a session that actually closed', async () => {
  let sessions = [{ id: 'session-a', cwd: '/tmp/alpha', pid: 11, name: 'Alpha' }];
  const registry = new ClaudeSessionRegistry({
    cacheMs: 0,
    runCommand: async () => sessionPayload(sessions),
  });

  assert.equal((await registry.listSessions()).length, 1);
  sessions = [];
  assert.equal((await registry.listSessions({ refresh: true })).length, 0);
  assert.equal(registry.stale, false);
  assert.equal(await registry.findSession('session-a'), null);
  assert.equal(registry.knownSession('session-a'), null);
});

// The add path must not spawn a cold subprocess. findSession serves the warm cache;
// readConnectedSession stays forced because dispatch needs current truth.
test('add-path lookups reuse the cache while dispatch lookups force a probe', async () => {
  let probes = 0;
  const registry = new ClaudeSessionRegistry({
    cacheMs: 60_000,
    runCommand: async () => {
      probes += 1;
      return sessionPayload([{ id: 'session-a', cwd: '/tmp/alpha', pid: 11, name: 'Alpha' }]);
    },
  });

  await registry.listSessions();
  assert.equal(probes, 1);
  await registry.findSession('session-a');
  await registry.findSession('session-a');
  assert.equal(probes, 1, 'the add path must never force a cold probe');

  await registry.readConnectedSession('session-a');
  assert.equal(probes, 2, 'dispatch must see current truth');
});

test('concurrent discovery calls share a single probe', async () => {
  let probes = 0;
  const registry = new ClaudeSessionRegistry({
    cacheMs: 0,
    runCommand: async () => {
      probes += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return sessionPayload([{ id: 'session-a', cwd: '/tmp/alpha', pid: 11, name: 'Alpha' }]);
    },
  });

  await Promise.all([
    registry.listSessions({ refresh: true }),
    registry.listSessions({ refresh: true }),
    registry.listSessions({ refresh: true }),
  ]);
  assert.equal(probes, 1);
});

// Idle routing decides where to send work based on which sessions are IDLE. Last-known-good
// is right for the add path and wrong here: a cached `status` from before an outage is not
// evidence. The registry must therefore expose staleness so the caller can decline to route.
test('the registry reports staleness so callers can decline to act on cached state', async () => {
  let fail = false;
  const registry = new ClaudeSessionRegistry({
    cacheMs: 0,
    runCommand: async () => {
      if (fail) throw new Error('probe timed out');
      return sessionPayload([
        { id: 'session-a', cwd: '/tmp/alpha', pid: 11, name: 'Alpha', status: 'busy' },
        { id: 'session-b', cwd: '/tmp/alpha', pid: 12, name: 'Beta' },
      ]);
    },
  });

  await registry.listSessions({ refresh: true });
  assert.equal(registry.stale, false);

  fail = true;
  const stale = await registry.listSessions({ refresh: true });
  assert.equal(stale.length, 2, 'the sessions are still served for the add path');
  assert.equal(registry.stale, true, 'but the caller can tell the status fields are not current');

  fail = false;
  await registry.listSessions({ refresh: true });
  assert.equal(registry.stale, false, 'staleness clears once discovery recovers');
});

// Last resort binding for the add path: a session CC Relay has run before has a known workspace,
// so a discovery outage cannot cost the user their prompt.
test('a previously used session can still be resolved from task history', () => {
  withDatabase((database) => {
    assert.equal(database.latestTaskForThread('session-a'), null);
    database.createTask({
      title: 'First',
      prompt: 'First',
      thread: { id: 'session-a', cwd: '/tmp/alpha', title: 'Alpha', source: 'Claude interactive' },
      provider: 'claude',
    });
    const previous = database.latestTaskForThread('session-a');
    assert.equal(previous.repo_path, '/tmp/alpha');
    assert.equal(previous.thread_name, 'Alpha');
    assert.equal(previous.thread_source, 'Claude interactive');
    assert.equal(database.latestTaskForThread('never-seen'), null);
    assert.equal(database.latestTaskForThread(''), null);
  });
});

test('the idle routing preference persists on the task and defaults to off', () => {
  withDatabase((database) => {
    const plain = database.createTask({
      title: 'Plain',
      prompt: 'Plain',
      thread: { id: 'session-a', cwd: '/tmp/alpha', title: 'Alpha', source: 'Claude interactive' },
      provider: 'claude',
    });
    assert.equal(plain.prefer_idle_terminal, 0);

    const routed = database.createTask({
      title: 'Routed',
      prompt: 'Routed',
      thread: { id: 'session-a', cwd: '/tmp/alpha', title: 'Alpha', source: 'Claude interactive' },
      provider: 'claude',
      preferIdleTerminal: true,
    });
    assert.equal(routed.prefer_idle_terminal, 1);
    assert.equal(database.getTask(routed.id).prefer_idle_terminal, 1);
  });
});

// GET /api/status rebuilds this feed every two seconds. Re-reading a full event window per
// monitored task does not scale now that several tasks and terminal sessions can stay visible.
test('the task monitor only reads events appended since the last poll', () => {
  withDatabase((database) => {
    const task = database.createTask({
      title: 'Running',
      prompt: 'Running',
      thread: { id: 'session-a', cwd: '/tmp/alpha', title: 'Alpha', source: 'Claude interactive' },
      provider: 'claude',
    });
    database.updateTask(task.id, { status: 'running' });
    database.addEvent(task.id, 'queue', 'Task started.');
    database.addEvent(task.id, 'claude', 'First', { type: 'claude/message', provider: 'claude', text: 'First' });

    const reads = [];
    const cache = new AgentUpdateCache({
      latestEventId: (taskId) => database.latestEventId(taskId),
      listEventsSince: (taskId, sinceId, limit) => {
        reads.push(sinceId);
        return database.listEventsSince(taskId, sinceId, limit);
      },
    });

    const running = [database.getTask(task.id)];
    assert.equal(cache.feed(running)[0].latestAgentUpdate.text, 'First');
    assert.deepEqual(reads, [0]);

    // Nothing new: no event read at all, only the indexed MAX(id) lookup.
    assert.equal(cache.feed(running)[0].latestAgentUpdate.text, 'First');
    assert.equal(reads.length, 1, 'an unchanged task must not re-read its events');

    database.addEvent(task.id, 'claude', 'Second', { type: 'claude/message', provider: 'claude', text: 'Second' });
    assert.equal(cache.feed(running)[0].latestAgentUpdate.text, 'Second');
    assert.equal(reads.length, 2);
    assert.ok(reads[1] > 0, 'the second read must start after the events already seen');

    // A new event that carries no agent message must not drop the last known update.
    database.addEvent(task.id, 'queue', 'Still working.');
    assert.equal(cache.feed(running)[0].latestAgentUpdate.text, 'Second');
  });
});

test('the task monitor cache is bounded to tasks that remain visible', () => {
  withDatabase((database) => {
    const task = database.createTask({
      title: 'Running',
      prompt: 'Running',
      thread: { id: 'session-a', cwd: '/tmp/alpha', title: 'Alpha', source: 'Claude interactive' },
      provider: 'claude',
    });
    database.updateTask(task.id, { status: 'running' });
    database.addEvent(task.id, 'claude', 'Hello', { type: 'claude/message', provider: 'claude', text: 'Hello' });

    const cache = new AgentUpdateCache({
      latestEventId: (taskId) => database.latestEventId(taskId),
      listEventsSince: (taskId, sinceId, limit) => database.listEventsSince(taskId, sinceId, limit),
    });
    cache.feed([database.getTask(task.id)]);
    assert.equal(cache.entries.size, 1);

    database.updateTask(task.id, { status: 'complete' });
    assert.deepEqual(cache.feed([database.getTask(task.id)]), []);
    assert.equal(cache.entries.size, 0, 'finished tasks must not accumulate in the cache');
  });
});

test('the task monitor cache keeps an idle manual session until explicit completion', () => {
  withDatabase((database) => {
    const task = database.createTask({
      title: 'Terminal workspace',
      prompt: 'First command',
      repoPath: '/tmp/alpha',
      provider: 'codex',
      mode: 'execute',
      terminalLifecycle: 'disposable',
      keepTerminalOpen: true,
      manualCompletion: true,
    });
    database.updateTask(task.id, { status: 'running' });
    database.addEvent(task.id, 'codex', 'Finished turn', {
      item: { type: 'agentMessage', text: 'Finished turn' },
    });

    const cache = new AgentUpdateCache({
      latestEventId: (taskId) => database.latestEventId(taskId),
      listEventsSince: (taskId, sinceId, limit) => database.listEventsSince(taskId, sinceId, limit),
    });
    assert.equal(cache.feed([database.getTask(task.id)])[0].status, 'running');

    database.updateTask(task.id, { status: 'open', finished_at: null });
    const idle = cache.feed([database.getTask(task.id)]);
    assert.equal(idle[0].status, 'open');
    assert.equal(idle[0].latestAgentUpdate.text, 'Finished turn');
    assert.equal(cache.entries.size, 1);

    database.updateTask(task.id, { status: 'complete' });
    assert.deepEqual(cache.feed([database.getTask(task.id)]), []);
    assert.equal(cache.entries.size, 0);
  });
});

test('the task monitor clears cached token usage when a manual-session follow-up starts', () => {
  withDatabase((database) => {
    const task = database.createTask({
      title: 'Terminal workspace',
      prompt: 'First command',
      repoPath: '/tmp/alpha',
      provider: 'codex',
      mode: 'execute',
      terminalLifecycle: 'disposable',
      keepTerminalOpen: true,
      manualCompletion: true,
    });
    database.updateTask(task.id, {
      status: 'open',
      started_at: '2026-08-25T10:00:00.000Z',
    });
    database.addEvent(task.id, 'codex', 'Codex used tokens.', {
      type: 'provider/token-usage',
      provider: 'codex',
      source: 'native',
      cumulative: true,
      usage: { totalTokens: 300, inputTokens: 250, outputTokens: 50 },
    });

    const cache = new AgentUpdateCache({
      latestEventId: (taskId) => database.latestEventId(taskId),
      listEventsSince: (taskId, sinceId, limit) => database.listEventsSince(taskId, sinceId, limit),
    });
    assert.equal(cache.feed([database.getTask(task.id)])[0].latestTokenUsage.usage.totalTokens, 300);

    database.updateTask(task.id, { status: 'running' });
    database.addEvent(task.id, 'queue', 'Follow-up started.', {
      type: 'relay/task-attempt-started',
      provider: 'codex',
      attemptStartedAt: '2026-08-25T11:00:00.000Z',
    });
    assert.equal(cache.feed([database.getTask(task.id)])[0].latestTokenUsage, null);
  });
});
