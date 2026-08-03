import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ArtifactStore } from '../src/artifacts.mjs';
import { RelayDatabase } from '../src/database.mjs';
import { TaskQueue } from '../src/queue.mjs';
import {
  breakdownInProgress,
  breakdownUpdateForDeletedTask,
  breakdownUpdateForTask,
} from '../src/plan-breakdown.mjs';

function waitFor(predicate, timeout = 2000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - started > timeout) {
        clearInterval(timer);
        reject(new Error('Timed out waiting for the breakdown to settle.'));
      }
    }, 5);
  });
}

// Reproduce the exact server glue: reconcile a breakdown whenever its task changes.
function attachBreakdownSync(queue, database) {
  queue.on('changed', ({ taskId }) => {
    if (!taskId) return;
    const breakdown = database.breakdownForTask(taskId);
    if (!breakdown) return;
    const task = database.getTask(taskId);
    const changes = task
      ? breakdownUpdateForTask(task, breakdown)
      : breakdownUpdateForDeletedTask(breakdown);
    if (changes) database.updatePlanBreakdown(breakdown.id, changes);
  });
}

function harness(finalResponse) {
  const directory = mkdtempSync(join(tmpdir(), 'relay-breakdown-int-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  const artifacts = new ArtifactStore(join(directory, 'tasks'));
  const runner = {
    async run() { return { finalResponse, sessionId: 'relay-a-session', exitCode: 0 }; },
    cancel() { return false; },
  };
  const queue = new TaskQueue({ database, artifacts, runner });
  attachBreakdownSync(queue, database);
  return { directory, database, artifacts, queue };
}

async function runBreakdown(finalResponse) {
  const { directory, database, queue } = harness(finalResponse);
  try {
    const plan = database.createPlan({ repoPath: directory, name: 'Auth', content: 'Rework auth.' });
    // Mirror the server: create the row, enqueue, then link the task id synchronously.
    const breakdown = database.createPlanBreakdown({
      planId: plan.id,
      provider: 'codex',
      sessionId: 'relay-a',
      status: 'pending',
    });
    const task = queue.enqueue({
      title: `Plan breakdown · ${plan.name}`,
      prompt: 'Break the plan into tasks and return JSON.',
      thread: { id: 'relay-a', title: 'CC Relay 1', source: 'cli', cwd: directory },
      provider: 'codex',
      mode: 'breakdown',
      submissionId: '11111111-1111-4111-8111-111111111111',
    });
    database.updatePlanBreakdown(breakdown.id, { task_id: task.id });

    await waitFor(() => database.getTask(task.id).status === 'complete');
    return { database, breakdownId: breakdown.id, taskId: task.id, planId: plan.id };
  } finally {
    // The caller closes the database after asserting; defer the directory removal.
    rmSyncDeferred(directory);
  }
}

// Defer directory cleanup until process exit so post-run assertions can read it.
const pendingCleanup = [];
function rmSyncDeferred(directory) { pendingCleanup.push(directory); }
test.after(() => {
  for (const directory of pendingCleanup) rmSync(directory, { recursive: true, force: true });
});

test('a breakdown task runs through the queue and its parsed proposals land on the plan', async () => {
  const response = JSON.stringify({ tasks: [
    { title: 'First', prompt: 'Do the first thing' },
    { title: 'Second', prompt: 'Do the second thing' },
  ] });
  const { database, breakdownId, taskId } = await runBreakdown(response);
  try {
    const task = database.getTask(taskId);
    assert.equal(task.status, 'complete');
    const breakdown = database.getPlanBreakdown(breakdownId);
    assert.equal(breakdown.status, 'complete');
    assert.equal(breakdown.parsed, true);
    assert.equal(breakdown.proposals.length, 2);
    assert.deepEqual(breakdown.proposals.map((p) => p.title), ['First', 'Second']);
    assert.ok(breakdown.proposals.every((p) => typeof p.id === 'string' && p.id));
  } finally {
    database.close();
  }
});

test('an unparseable breakdown completes with the raw response surfaced and no proposals', async () => {
  const { database, breakdownId, taskId } = await runBreakdown('Sorry, I cannot produce JSON for that.');
  try {
    assert.equal(database.getTask(taskId).status, 'complete');
    const breakdown = database.getPlanBreakdown(breakdownId);
    assert.equal(breakdown.status, 'complete');
    assert.equal(breakdown.parsed, false);
    assert.deepEqual(breakdown.proposals, []);
    assert.match(breakdown.raw_response, /cannot produce JSON/);
  } finally {
    database.close();
  }
});

test('a failed breakdown scheduled for retry is still in progress (Finding 23)', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-breakdown-retry-'));
  rmSyncDeferred(directory);
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  const artifacts = new ArtifactStore(join(directory, 'tasks'));
  const runner = {
    async run() { throw new Error('Session dropped mid-turn.'); }, // retryable (no retryable:false)
    cancel() { return false; },
  };
  // A long retry delay keeps the task parked in the retry window for the assertion.
  const queue = new TaskQueue({ database, artifacts, runner, retryDelayMs: 60_000 });
  attachBreakdownSync(queue, database);
  try {
    const plan = database.createPlan({ repoPath: directory, name: 'Retry', content: 'brief' });
    const breakdown = database.createPlanBreakdown({ planId: plan.id, provider: 'codex', sessionId: 'relay-a', status: 'pending' });
    const task = queue.enqueue({
      title: 'Plan breakdown · Retry',
      prompt: 'Break the plan into tasks.',
      thread: { id: 'relay-a', title: 'CC Relay 1', source: 'cli', cwd: directory },
      provider: 'codex',
      mode: 'breakdown',
      submissionId: '22222222-2222-4222-8222-222222222222',
    });
    database.updatePlanBreakdown(breakdown.id, { task_id: task.id });

    await waitFor(() => database.getTask(task.id).status === 'failed');
    // The queue really scheduled an automatic retry: this is the window a second
    // POST /breakdown must be rejected in, even though the row now reads 'failed'.
    const retryScheduled = queue.pendingRetryTaskIds().has(task.id);
    assert.equal(retryScheduled, true);
    const row = database.getPlanBreakdown(breakdown.id);
    assert.equal(row.status, 'failed');
    assert.equal(
      breakdownInProgress(row, { retryScheduled, taskStatus: database.getTask(task.id).status }),
      true,
    );
  } finally {
    queue.clearAutoRetry?.(undefined);
    for (const id of queue.pendingRetryTaskIds()) queue.clearAutoRetry(id);
    database.close();
  }
});

test('deleting a queued breakdown task fails the breakdown instead of locking the plan (C2)', () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-breakdown-delete-'));
  rmSyncDeferred(directory);
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  const artifacts = new ArtifactStore(join(directory, 'tasks'));
  const runner = { run: () => new Promise(() => {}), cancel: () => false };
  const queue = new TaskQueue({ database, artifacts, runner });
  attachBreakdownSync(queue, database);
  try {
    // Nothing may dispatch: the task has to stay queued so it can be deleted.
    database.setPaused(true);
    const plan = database.createPlan({ repoPath: directory, name: 'Delete', content: 'brief' });
    const breakdown = database.createPlanBreakdown({ planId: plan.id, provider: 'codex', sessionId: 'relay-a', status: 'pending' });
    const task = queue.enqueue({
      title: 'Plan breakdown',
      prompt: 'Break the plan into tasks.',
      thread: { id: 'relay-a', title: 'CC Relay 1', source: 'cli', cwd: directory },
      provider: 'codex',
      mode: 'breakdown',
      submissionId: '33333333-3333-4333-8333-333333333333',
    });
    database.updatePlanBreakdown(breakdown.id, { task_id: task.id });
    assert.equal(breakdownInProgress(database.getPlanBreakdown(breakdown.id), { taskStatus: 'queued' }), true);

    // Users delete queued tasks freely, and a breakdown looks like any other queue card.
    assert.equal(queue.delete(task.id), true);

    const row = database.getPlanBreakdown(breakdown.id);
    assert.equal(row.status, 'failed', 'the breakdown does not stay pending forever');
    assert.match(row.error, /deleted before it finished/);
    // The plan is usable again: nothing reports work in progress.
    assert.equal(breakdownInProgress(row, { retryScheduled: false, taskStatus: null }), false);
  } finally {
    database.close();
  }
});

test('a breakdown that already settled is unaffected by its task being deleted', () => {
  const complete = breakdownUpdateForDeletedTask({ status: 'complete' });
  assert.equal(complete, null, 'completed proposals are never touched');
  assert.equal(breakdownUpdateForDeletedTask({ status: 'failed' }), null);
  assert.equal(breakdownUpdateForDeletedTask(null), null);
  const pending = breakdownUpdateForDeletedTask({ status: 'pending' });
  assert.equal(pending.status, 'failed');
  assert.equal(breakdownUpdateForDeletedTask({ status: 'running' }).status, 'failed');
});
