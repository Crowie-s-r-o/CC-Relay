import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ArtifactStore } from '../src/artifacts.mjs';
import { RelayDatabase } from '../src/database.mjs';
import { TaskQueue } from '../src/queue.mjs';

// A Planner breakdown is planning work, but mechanically it is one turn on one session,
// exactly like direct execution. It used to schedule as an exclusive head, which froze its
// whole project and consumed the shared exclusive slot Plan council and Turbo depend on.
// These tests pin the new classification and, just as importantly, prove the exclusive
// barriers themselves did not move.

const cleanup = [];
test.after(() => {
  for (const directory of cleanup) rmSync(directory, { recursive: true, force: true });
});

function harness() {
  const directory = mkdtempSync(join(tmpdir(), 'relay-breakdown-sched-'));
  cleanup.push(directory);
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  const artifacts = new ArtifactStore(join(directory, 'tasks'));
  // Never dispatches: these tests inspect runnableTasks() directly.
  const runner = { run: () => new Promise(() => {}), cancel: () => false };
  const queue = new TaskQueue({ database, artifacts, runner });
  // Nothing may start on its own while the scheduling decision is under test.
  database.setPaused(true);
  return { directory, database, artifacts, queue };
}

function thread(id, cwd) {
  return { id, title: `Session ${id}`, source: 'cli', cwd };
}

function add(queue, { mode, provider = 'codex', threadId, cwd, title }) {
  return queue.enqueue({
    title,
    prompt: `Prompt for ${title}`,
    thread: thread(threadId, cwd),
    provider,
    mode,
    submissionId: undefined,
  });
}

// runnableTasks() reads the paused flag, so the decision is taken with pause lifted while
// nothing is ever actually dispatched.
function runnable(context) {
  context.database.setPaused(false);
  try {
    return context.queue.runnableTasks().map((task) => task.title);
  } finally {
    context.database.setPaused(true);
  }
}

test('a queued breakdown no longer blocks direct work behind it in the same project', () => {
  const context = harness();
  try {
    add(context.queue, { mode: 'breakdown', threadId: 'relay-a', cwd: context.directory, title: 'Breakdown' });
    add(context.queue, { mode: 'execute', threadId: 'relay-b', cwd: context.directory, title: 'Direct' });
    // Both are single-session work on different sessions, so both start.
    assert.deepEqual(runnable(context).sort(), ['Breakdown', 'Direct']);
  } finally {
    context.database.close();
  }
});

test('a running breakdown reserves its own session and only its own session', () => {
  const context = harness();
  try {
    const breakdown = add(context.queue, {
      mode: 'breakdown', threadId: 'relay-a', cwd: context.directory, title: 'Breakdown',
    });
    add(context.queue, { mode: 'execute', threadId: 'relay-a', cwd: context.directory, title: 'Same session' });
    add(context.queue, { mode: 'execute', threadId: 'relay-b', cwd: context.directory, title: 'Other session' });
    // Simulate the breakdown running.
    context.queue.activeTasks.set(breakdown.id, { ...breakdown, status: 'running' });
    context.database.updateTask(breakdown.id, { status: 'running' });

    assert.ok(context.queue.reservedThreadIds().has('relay-a'), 'a running breakdown holds its session');
    assert.deepEqual(runnable(context), ['Other session']);
  } finally {
    context.database.close();
  }
});

test('a running breakdown does not block an exclusive task in another project', () => {
  const context = harness();
  const other = mkdtempSync(join(tmpdir(), 'relay-breakdown-other-'));
  cleanup.push(other);
  try {
    const breakdown = add(context.queue, {
      mode: 'breakdown', threadId: 'relay-a', cwd: context.directory, title: 'Breakdown',
    });
    context.queue.activeTasks.set(breakdown.id, { ...breakdown, status: 'running' });
    context.database.updateTask(breakdown.id, { status: 'running' });
    context.queue.enqueue({
      title: 'Council',
      prompt: 'Plan it',
      thread: thread('relay-z', other),
      provider: 'council',
      mode: 'plan',
    });
    // The breakdown no longer takes the shared exclusive slot.
    assert.deepEqual(runnable(context), ['Council']);
  } finally {
    context.database.close();
  }
});

test('a Plan council in another project no longer holds a breakdown back', () => {
  const context = harness();
  const other = mkdtempSync(join(tmpdir(), 'relay-breakdown-council-'));
  cleanup.push(other);
  try {
    const council = context.queue.enqueue({
      title: 'Council',
      prompt: 'Plan it',
      thread: thread('relay-z', other),
      provider: 'council',
      mode: 'plan',
    });
    context.queue.activeTasks.set(council.id, { ...council, status: 'running' });
    context.database.updateTask(council.id, { status: 'running' });
    add(context.queue, { mode: 'breakdown', threadId: 'relay-a', cwd: context.directory, title: 'Breakdown' });
    // This is the restriction the reclassification removes: a breakdown is now ordinary
    // single-session work, so it starts beside a council in a different project exactly as
    // a direct Execute task always has.
    assert.deepEqual(runnable(context), ['Breakdown']);
  } finally {
    context.database.close();
  }
});

test('the shared exclusive slot still admits only one exclusive task across projects', () => {
  const context = harness();
  const other = mkdtempSync(join(tmpdir(), 'relay-breakdown-two-councils-'));
  cleanup.push(other);
  try {
    const council = context.queue.enqueue({
      title: 'First council',
      prompt: 'Plan it',
      thread: thread('relay-z', other),
      provider: 'council',
      mode: 'plan',
    });
    context.queue.activeTasks.set(council.id, { ...council, status: 'running' });
    context.database.updateTask(council.id, { status: 'running' });
    context.queue.enqueue({
      title: 'Second council',
      prompt: 'Plan it too',
      thread: thread('relay-y', context.directory),
      provider: 'council',
      mode: 'plan',
    });
    // Genuinely exclusive work is unchanged: the second council waits.
    assert.deepEqual(runnable(context), []);
  } finally {
    context.database.close();
  }
});

test('a running Plan council still blocks every task in its own project', () => {
  const context = harness();
  try {
    const council = context.queue.enqueue({
      title: 'Council',
      prompt: 'Plan it',
      thread: thread('relay-z', context.directory),
      provider: 'council',
      mode: 'plan',
    });
    context.queue.activeTasks.set(council.id, { ...council, status: 'running' });
    context.database.updateTask(council.id, { status: 'running' });
    add(context.queue, { mode: 'breakdown', threadId: 'relay-a', cwd: context.directory, title: 'Breakdown' });
    add(context.queue, { mode: 'execute', threadId: 'relay-b', cwd: context.directory, title: 'Direct' });
    assert.deepEqual(runnable(context), []);
  } finally {
    context.database.close();
  }
});

test('a queued Plan council is still an exclusive head that waits for its project to drain', () => {
  const context = harness();
  try {
    const direct = add(context.queue, {
      mode: 'execute', threadId: 'relay-b', cwd: context.directory, title: 'Direct',
    });
    context.queue.activeTasks.set(direct.id, { ...direct, status: 'running' });
    context.database.updateTask(direct.id, { status: 'running' });
    context.queue.enqueue({
      title: 'Council',
      prompt: 'Plan it',
      thread: thread('relay-z', context.directory),
      provider: 'council',
      mode: 'plan',
    });
    add(context.queue, { mode: 'breakdown', threadId: 'relay-a', cwd: context.directory, title: 'Breakdown' });
    // The council is the queued head, so nothing behind it starts while work is active.
    assert.deepEqual(runnable(context), []);
  } finally {
    context.database.close();
  }
});

test('forward planning will not start a turn on a session a breakdown is holding (S1)', () => {
  const context = harness();
  const other = mkdtempSync(join(tmpdir(), 'relay-breakdown-lookahead-'));
  cleanup.push(other);
  const prepared = [];
  context.queue.runner = {
    run: () => new Promise(() => {}),
    prepare: (task) => { prepared.push(task.id); return new Promise(() => {}); },
    cancel: () => false,
  };
  try {
    // A breakdown holds session relay-s in this project.
    const breakdown = add(context.queue, {
      mode: 'breakdown', threadId: 'relay-s', cwd: context.directory, title: 'Breakdown',
    });
    context.queue.activeTasks.set(breakdown.id, { ...breakdown, status: 'running' });
    context.database.updateTask(breakdown.id, { status: 'running' });

    // A Turbo task is executing in another project, which is what enables look-ahead.
    const executing = context.queue.enqueue({
      title: 'Executing turbo',
      prompt: 'run it',
      thread: thread('relay-p', other),
      provider: 'codex',
      mode: 'turbo',
      turbo: { plannerThreadId: 'relay-p', workers: [{ threadId: 'relay-w', title: 'Worker' }] },
    });
    context.queue.activeTasks.set(executing.id, { ...executing, status: 'running' });
    context.database.updateTask(executing.id, { status: 'running' });
    context.artifacts.writeTurboPlan(executing.id, {
      status: 'executing',
      workers: [{ threadId: 'relay-w', title: 'Worker' }],
    });

    // The queued Turbo task would plan ahead on relay-s, the breakdown's own session.
    context.queue.enqueue({
      title: 'Queued turbo',
      prompt: 'plan it',
      thread: thread('relay-s', other),
      provider: 'codex',
      mode: 'turbo',
      turbo: { plannerThreadId: 'relay-s', workers: [{ threadId: 'relay-w2', title: 'Worker 2' }] },
    });

    context.database.setPaused(false);
    context.queue.planAhead();
    context.database.setPaused(true);
    assert.deepEqual(prepared, [], 'look-ahead respects the reservation on relay-s');

    // With the breakdown finished, the same look-ahead is allowed.
    context.queue.activeTasks.delete(breakdown.id);
    context.database.updateTask(breakdown.id, { status: 'complete' });
    context.database.setPaused(false);
    context.queue.planAhead();
    context.database.setPaused(true);
    assert.equal(prepared.length, 1, 'the session is usable again once it is free');
  } finally {
    for (const taskId of context.queue.activePreparations.keys()) {
      context.queue.activePreparations.delete(taskId);
    }
    context.database.close();
  }
});

test('a breakdown and a plan-run step in the same project run side by side', () => {
  const context = harness();
  try {
    add(context.queue, { mode: 'breakdown', threadId: 'relay-a', cwd: context.directory, title: 'Breakdown' });
    add(context.queue, { mode: 'execute', threadId: 'relay-b', cwd: context.directory, title: 'Step one' });
    add(context.queue, { mode: 'execute', provider: 'claude', threadId: 'relay-c', cwd: context.directory, title: 'Step two' });
    assert.deepEqual(runnable(context).sort(), ['Breakdown', 'Step one', 'Step two']);
  } finally {
    context.database.close();
  }
});
