import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ArtifactStore } from '../src/artifacts.mjs';
import { RelayDatabase } from '../src/database.mjs';
import { TaskQueue } from '../src/queue.mjs';

function waitFor(predicate, timeout = 2000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - started > timeout) {
        clearInterval(timer);
        reject(new Error('Timed out waiting for queue state.'));
      }
    }, 10);
  });
}

function session(id, cwd, status = 'idle') {
  return { id, title: `Session ${id}`, source: 'cli', cwd, status };
}

function directInput(title, threadId, cwd, preferIdleTerminal = false) {
  return {
    title,
    prompt: `Execute ${title}`,
    mode: 'execute',
    provider: 'claude',
    thread: session(threadId, cwd),
    preferIdleTerminal,
  };
}

function councilInput(title, authorThreadId, reviewerThreadId, cwd) {
  return {
    title,
    prompt: `Plan ${title}`,
    mode: 'plan',
    provider: 'council',
    thread: session(reviewerThreadId, cwd),
    council: {
      authorProvider: 'claude',
      authorThread: session(authorThreadId, cwd),
      authorModel: 'fable',
      authorEffort: 'max',
      reviewerProvider: 'codex',
      reviewerModel: 'gpt-5.6-sol',
      reviewerEffort: 'high',
    },
  };
}

function harness({ listIdleSessions, run } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'relay-idle-routing-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  const artifacts = new ArtifactStore(join(directory, 'tasks'));
  const dispatched = [];
  const runner = {
    async run(task) {
      dispatched.push({
        id: task.id,
        threadId: task.thread_id,
        authorThreadId: task.author_thread_id,
      });
      if (run) await run(task);
      return { finalResponse: task.title, sessionId: task.thread_id, exitCode: 0 };
    },
    async prepare() { return null; },
    cancel() { return true; },
  };
  const queue = new TaskQueue({
    database,
    artifacts,
    runner,
    listIdleSessions,
    dispatchWait: async () => new Promise((resolve) => setTimeout(resolve, 1)),
  });
  return {
    database,
    artifacts,
    queue,
    dispatched,
    cleanup: async () => {
      await queue.shutdown();
      database.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

test('a task without the preference stays queued for its selected busy Claude session', async () => {
  let called = 0;
  let selectedStatus = 'active';
  const context = harness({
    listIdleSessions: async () => {
      called += 1;
      return [session('busy-one', '/tmp/alpha', selectedStatus), session('free-one', '/tmp/alpha')];
    },
  });
  try {
    const task = context.queue.enqueue(directInput('Pinned', 'busy-one', '/tmp/alpha'));
    await waitFor(() => context.queue.dispatchGuards.has(task.id));
    await new Promise((resolve) => setTimeout(resolve, 10));
    const waiting = context.database.getTask(task.id);
    assert.equal(waiting.status, 'queued');
    assert.equal(waiting.started_at, null);
    assert.equal(context.dispatched.length, 0);
    assert.deepEqual(context.queue.status().activeTaskIds, []);
    const waitingEvents = context.database.listEvents(task.id)
      .filter((event) => /remains queued and nothing has been sent/.test(event.message));
    assert.equal(waitingEvents.length, 1, 'busy polling must not spam the task activity');

    selectedStatus = 'idle';
    await waitFor(() => context.database.getTask(task.id).status === 'complete');
    assert.equal(context.dispatched[0].threadId, 'busy-one');
    assert.ok(called >= 2, 'CC Relay must recheck the selected session before starting');
  } finally {
    await context.cleanup();
  }
});

test('Plan council stays queued until its selected Claude council terminal is idle', async () => {
  let authorStatus = 'active';
  const context = harness({
    listIdleSessions: async (task) => {
      assert.equal(task.provider, 'claude');
      assert.equal(task.thread_id, 'claude-author');
      return [session('claude-author', '/tmp/alpha', authorStatus)];
    },
  });
  try {
    const task = context.queue.enqueue(
      councilInput('Visible council', 'claude-author', 'codex-reviewer', '/tmp/alpha'),
    );
    await waitFor(() => context.queue.dispatchGuards.has(task.id));
    await new Promise((resolve) => setTimeout(resolve, 10));
    const waiting = context.database.getTask(task.id);
    assert.equal(waiting.status, 'queued');
    assert.equal(waiting.started_at, null);
    assert.equal(context.dispatched.length, 0);
    assert.equal(
      context.database.listEvents(task.id)
        .some((event) => /Plan council Claude session/.test(event.message)),
      true,
    );

    authorStatus = 'idle';
    await waitFor(() => context.database.getTask(task.id).status === 'complete');
    assert.deepEqual(context.dispatched[0], {
      id: task.id,
      threadId: 'codex-reviewer',
      authorThreadId: 'claude-author',
    });
  } finally {
    await context.cleanup();
  }
});

test('the selected session wins when it is free', async () => {
  const context = harness({
    listIdleSessions: async () => [session('chosen', '/tmp/alpha'), session('other', '/tmp/alpha')],
  });
  try {
    const task = context.queue.enqueue(directInput('Chosen', 'chosen', '/tmp/alpha', true));
    await waitFor(() => context.database.getTask(task.id).status === 'complete');
    assert.equal(context.dispatched[0].threadId, 'chosen');
    assert.equal(context.database.getTask(task.id).thread_id, 'chosen');
  } finally {
    await context.cleanup();
  }
});

test('a busy selected session reroutes to a free session in the same workspace', async () => {
  const context = harness({
    listIdleSessions: async () => [
      session('chosen', '/tmp/alpha', 'active'),
      session('free-one', '/tmp/alpha'),
    ],
  });
  try {
    const task = context.queue.enqueue(directInput('Rerouted', 'chosen', '/tmp/alpha', true));
    await waitFor(() => context.database.getTask(task.id).status === 'complete');
    assert.equal(context.dispatched[0].threadId, 'free-one', 'the runner must receive the routed session');

    const stored = context.database.getTask(task.id);
    assert.equal(stored.thread_id, 'free-one');
    assert.equal(stored.thread_name, 'Session free-one');
    assert.equal(stored.repo_path, '/tmp/alpha', 'routing must never change the workspace');
    assert.match(
      context.database.listEvents(task.id).map((event) => event.message).join('\n'),
      /idle routing moved this task to Session free-one/,
    );
  } finally {
    await context.cleanup();
  }
});

test('a task stays put when no free session exists', async () => {
  let selectedStatus = 'active';
  const context = harness({
    listIdleSessions: async () => [
      session('chosen', '/tmp/alpha', selectedStatus),
      session('also-busy', '/tmp/alpha', 'active'),
    ],
  });
  try {
    const task = context.queue.enqueue(directInput('Waiting', 'chosen', '/tmp/alpha', true));
    await waitFor(() => context.queue.dispatchGuards.has(task.id));
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(context.database.getTask(task.id).status, 'queued');
    assert.equal(context.dispatched.length, 0);

    selectedStatus = 'idle';
    await waitFor(() => context.database.getTask(task.id).status === 'complete');
    assert.equal(context.dispatched[0].threadId, 'chosen');
  } finally {
    await context.cleanup();
  }
});

test('routing never leaves the workspace even when another project is idle', async () => {
  let selectedStatus = 'active';
  const context = harness({
    // The server filters candidates by workspace before the queue sees them, so an empty
    // candidate list is exactly what a lone busy session in its own project produces.
    listIdleSessions: async (task) => [session('chosen', '/tmp/alpha', selectedStatus)]
      .filter((candidate) => candidate.cwd === task.repo_path),
  });
  try {
    const task = context.queue.enqueue(directInput('Isolated', 'chosen', '/tmp/alpha', true));
    await waitFor(() => context.queue.dispatchGuards.has(task.id));
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(context.database.getTask(task.id).status, 'queued');

    selectedStatus = 'idle';
    await waitFor(() => context.database.getTask(task.id).status === 'complete');
    assert.equal(context.dispatched[0].threadId, 'chosen');
    assert.equal(context.database.getTask(task.id).repo_path, '/tmp/alpha');
  } finally {
    await context.cleanup();
  }
});

test('two tasks routing at the same moment never claim the same session', async () => {
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  const context = harness({
    listIdleSessions: async () => {
      // Force both dispatches to be in flight together before either one selects.
      await Promise.resolve();
      return [
        session('busy-a', '/tmp/alpha', 'active'),
        session('busy-b', '/tmp/alpha', 'active'),
        session('free-one', '/tmp/alpha'),
        session('free-two', '/tmp/alpha'),
      ];
    },
    run: () => blocked,
  });
  try {
    const first = context.queue.enqueue(directInput('First', 'busy-a', '/tmp/alpha', true));
    const second = context.queue.enqueue(directInput('Second', 'busy-b', '/tmp/alpha', true));
    await waitFor(() => context.dispatched.length === 2);

    const threads = context.dispatched.map((entry) => entry.threadId);
    assert.equal(new Set(threads).size, 2, `two dispatches shared a session: ${threads.join(', ')}`);
    for (const threadId of threads) {
      assert.ok(['free-one', 'free-two'].includes(threadId), `unexpected destination ${threadId}`);
    }
    release();
    await waitFor(() => context.database.getTask(first.id).status === 'complete'
      && context.database.getTask(second.id).status === 'complete');
  } finally {
    release();
    await context.cleanup();
  }
});

test('routing skips a session another queued task already owns', async () => {
  const context = harness({
    listIdleSessions: async () => [
      session('chosen', '/tmp/alpha', 'active'),
      session('claimed', '/tmp/alpha'),
      session('free-one', '/tmp/alpha'),
    ],
    run: async (task) => { if (task.title === 'Rerouted') await new Promise((resolve) => setTimeout(resolve, 20)); },
  });
  try {
    // A queued task already targets "claimed", so routing must not double-book it.
    context.database.createTask({
      title: 'Reserved',
      prompt: 'Reserved',
      thread: session('claimed', '/tmp/alpha'),
      provider: 'claude',
      mode: 'execute',
    });
    const task = context.queue.enqueue(directInput('Rerouted', 'chosen', '/tmp/alpha', true));
    await waitFor(() => context.dispatched.some((entry) => entry.id === task.id));
    const dispatch = context.dispatched.find((entry) => entry.id === task.id);
    assert.equal(dispatch.threadId, 'free-one');
  } finally {
    await context.cleanup();
  }
});

// A busy Claude session must leave the task queued. Cancelling that unsent task follows the
// normal queued path and never needs to reach a provider runner.
test('a task can be cancelled while waiting for a Claude dispatch destination', async () => {
  let releaseCandidates;
  const candidatesBlocked = new Promise((resolve) => { releaseCandidates = resolve; });
  const context = harness({
    listIdleSessions: async () => {
      await candidatesBlocked;
      return [session('chosen', '/tmp/alpha', 'active'), session('free-one', '/tmp/alpha')];
    },
  });
  try {
    const task = context.queue.enqueue(directInput('Cancelled', 'chosen', '/tmp/alpha', true));
    await waitFor(() => context.queue.dispatchGuards.has(task.id));

    assert.doesNotThrow(() => context.queue.cancel(task.id), 'cancel must not reject a routing task');
    releaseCandidates();

    await waitFor(() => context.database.getTask(task.id).status === 'cancelled');
    const stored = context.database.getTask(task.id);
    assert.match(stored.error, /cancelled before it started/i);
    assert.equal(context.dispatched.length, 0, 'a cancelled task must never reach the runner');
    assert.equal(context.queue.dispatchGuards.size, 0, 'the guard must always be released');
  } finally {
    releaseCandidates();
    await context.cleanup();
  }
});

test('a busy queued Claude task can be reassigned before anything is sent', async () => {
  const context = harness({
    listIdleSessions: async () => [
      session('busy-one', '/tmp/alpha', 'active'),
      session('free-one', '/tmp/alpha'),
    ],
  });
  try {
    const task = context.queue.enqueue(directInput('Reassign', 'busy-one', '/tmp/alpha'));
    await waitFor(() => context.queue.dispatchGuards.has(task.id));
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(context.database.getTask(task.id).status, 'queued');
    assert.equal(context.dispatched.length, 0);

    context.queue.assign(task.id, session('free-one', '/tmp/alpha'));
    await waitFor(() => context.database.getTask(task.id).status === 'complete');
    assert.equal(context.dispatched[0].threadId, 'free-one');
  } finally {
    await context.cleanup();
  }
});

test('the dispatch guard is released even when routing throws', async () => {
  const context = harness({
    listIdleSessions: async () => { throw new Error('discovery exploded'); },
  });
  try {
    const task = context.queue.enqueue(directInput('Resilient', 'chosen', '/tmp/alpha', true));
    await waitFor(() => context.database.getTask(task.id).status === 'complete');
    assert.equal(context.queue.dispatchGuards.size, 0);
  } finally {
    await context.cleanup();
  }
});

test('a discovery failure during routing leaves the task on its selected session', async () => {
  const context = harness({
    listIdleSessions: async () => { throw new Error('discovery exploded'); },
  });
  try {
    const task = context.queue.enqueue(directInput('Resilient', 'chosen', '/tmp/alpha', true));
    await waitFor(() => context.database.getTask(task.id).status === 'complete');
    assert.equal(context.dispatched[0].threadId, 'chosen');
  } finally {
    await context.cleanup();
  }
});

// Turbo look-ahead depends on runner.run() writing its plan synchronously during dispatch,
// because schedule() calls runNext() and planAhead() in the same tick. Guard the gate that
// keeps non-routing dispatches await-free.
test('dispatch stays synchronous for tasks that are not routing', async () => {
  const context = harness({ listIdleSessions: async () => [session('free-one', '/tmp/alpha')] });
  try {
    const task = context.database.createTask({
      title: 'Plain',
      prompt: 'Plain',
      thread: session('chosen', '/tmp/alpha'),
      provider: 'claude',
      mode: 'execute',
    });
    assert.equal(context.queue.shouldRouteIdle(context.database.getTask(task.id)), false);

    const routed = context.database.createTask({
      title: 'Routed',
      prompt: 'Routed',
      thread: session('chosen', '/tmp/alpha'),
      provider: 'claude',
      mode: 'execute',
      preferIdleTerminal: true,
    });
    assert.equal(context.queue.shouldRouteIdle(context.database.getTask(routed.id)), true);

    // Plan council and Turbo occupy their sessions for a whole run and never reroute.
    const council = context.database.createTask({
      title: 'Council',
      prompt: 'Council',
      thread: session('chosen', '/tmp/alpha'),
      provider: 'council',
      mode: 'plan',
      preferIdleTerminal: true,
    });
    assert.equal(context.queue.shouldRouteIdle(context.database.getTask(council.id)), false);
  } finally {
    await context.cleanup();
  }
});
