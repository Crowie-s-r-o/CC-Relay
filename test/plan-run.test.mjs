import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyBlockedSteps,
  planStepSubmissionId,
  readySteps,
  runStatusFromSteps,
  stepCounts,
  stepStatusForTask,
} from '../src/plan-run.mjs';

function step(proposalId, { dependsOn = [], taskId = null, status = 'waiting' } = {}) {
  return { proposalId, dependsOn, taskId, status };
}

test('the per-step submission id is deterministic and uuid shaped', () => {
  const first = planStepSubmissionId({ planId: 3, runId: 7, proposalId: 'abc' });
  const second = planStepSubmissionId({ planId: 3, runId: 7, proposalId: 'abc' });
  assert.equal(first, second, 'the same step always produces the same id');
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('the submission id separates plan, run, and step', () => {
  const base = { planId: 1, runId: 1, proposalId: 'a' };
  const ids = new Set([
    planStepSubmissionId(base),
    planStepSubmissionId({ ...base, planId: 2 }),
    planStepSubmissionId({ ...base, runId: 2 }),
    planStepSubmissionId({ ...base, proposalId: 'b' }),
  ]);
  assert.equal(ids.size, 4, 'a different plan, run, or step is a different submission');
});

test('a failed task with an automatic retry scheduled is retrying, not failed', () => {
  const task = { status: 'failed', error: 'session dropped' };
  assert.deepEqual(stepStatusForTask(task, { retryScheduled: true }), { status: 'retrying', error: null });
  assert.deepEqual(
    stepStatusForTask(task, { retryScheduled: false }),
    { status: 'failed', error: 'session dropped' },
  );
});

test('step status maps every task state', () => {
  assert.equal(stepStatusForTask({ status: 'complete' }).status, 'complete');
  assert.equal(stepStatusForTask({ status: 'running' }).status, 'running');
  assert.equal(stepStatusForTask({ status: 'queued' }).status, 'queued');
  assert.equal(stepStatusForTask({ status: 'cancelled' }).status, 'cancelled');
  // A restart leaves interrupted tasks behind and never auto-retries them.
  assert.equal(stepStatusForTask({ status: 'interrupted' }).status, 'failed');
  // A deleted task row is a failure, never a reason to enqueue the step again.
  assert.equal(stepStatusForTask(null).status, 'failed');
});

test('blocked propagates transitively and only to steps that never started', () => {
  const steps = [
    step('a', { taskId: 1, status: 'failed' }),
    step('b', { dependsOn: ['a'] }),
    step('c', { dependsOn: ['b'] }),
    step('d', { dependsOn: ['a'], taskId: 2, status: 'running' }),
    step('e'),
  ];
  applyBlockedSteps(steps);
  assert.deepEqual(steps.map((item) => item.status), [
    'failed', 'blocked', 'blocked', 'running', 'waiting',
  ]);
});

test('blocked is derived, so clearing the failure un-blocks the subtree', () => {
  const steps = [
    step('a', { taskId: 1, status: 'failed' }),
    step('b', { dependsOn: ['a'] }),
    step('c', { dependsOn: ['b'] }),
  ];
  applyBlockedSteps(steps);
  assert.deepEqual(steps.map((item) => item.status), ['failed', 'blocked', 'blocked']);
  // The user retried the task; the reconciler recomputes from the live task state.
  steps[0].status = 'running';
  applyBlockedSteps(steps);
  assert.deepEqual(steps.map((item) => item.status), ['running', 'waiting', 'waiting']);
});

test('a cancelled step blocks its dependents like a failure', () => {
  const steps = [step('a', { taskId: 1, status: 'cancelled' }), step('b', { dependsOn: ['a'] })];
  applyBlockedSteps(steps);
  assert.equal(steps[1].status, 'blocked');
});

test('ready steps are the ones with every dependency complete and no task yet', () => {
  const steps = [
    step('a', { taskId: 1, status: 'complete' }),
    step('b', { dependsOn: ['a'] }),
    step('c', { dependsOn: ['a', 'b'] }),
    step('d', { dependsOn: ['a'], taskId: 2, status: 'queued' }),
  ];
  assert.deepEqual(readySteps(steps).map((item) => item.proposalId), ['b']);
});

test('a wave releases every independent step at once', () => {
  const steps = [
    step('root', { taskId: 1, status: 'complete' }),
    step('left', { dependsOn: ['root'] }),
    step('right', { dependsOn: ['root'] }),
  ];
  assert.deepEqual(readySteps(steps).map((item) => item.proposalId), ['left', 'right']);
});

test('run status derives from its steps', () => {
  assert.equal(runStatusFromSteps([step('a', { taskId: 1, status: 'complete' })]), 'complete');
  assert.equal(runStatusFromSteps([step('a')]), 'running');
  assert.equal(runStatusFromSteps([step('a', { taskId: 1, status: 'running' })]), 'running');
  // A retry is still in flight, so the run is not failed.
  assert.equal(runStatusFromSteps([step('a', { taskId: 1, status: 'retrying' })]), 'running');
  assert.equal(runStatusFromSteps([
    step('a', { taskId: 1, status: 'failed' }),
    step('b', { status: 'blocked' }),
  ]), 'failed');
  assert.equal(runStatusFromSteps([
    step('a', { taskId: 1, status: 'complete' }),
    step('b', { taskId: 2, status: 'cancelled' }),
  ]), 'failed');
});

test('stopped is latched and never derives back', () => {
  const finished = [step('a', { taskId: 1, status: 'complete' })];
  assert.equal(runStatusFromSteps(finished, 'stopped'), 'stopped');
  assert.equal(runStatusFromSteps([step('a', { taskId: 1, status: 'failed' })], 'stopped'), 'stopped');
  assert.equal(runStatusFromSteps([step('a')], 'stopped'), 'stopped');
});

test('a failed run derives back to running when a step is retried', () => {
  const steps = [
    step('a', { taskId: 1, status: 'failed' }),
    step('b', { dependsOn: ['a'], status: 'blocked' }),
  ];
  assert.equal(runStatusFromSteps(steps, 'failed'), 'failed');
  steps[0].status = 'queued';
  applyBlockedSteps(steps);
  assert.equal(runStatusFromSteps(steps, 'failed'), 'running');
});

test('counts cover every step status', () => {
  const counts = stepCounts([
    step('a', { taskId: 1, status: 'complete' }),
    step('b', { taskId: 2, status: 'running' }),
    step('c'),
  ]);
  assert.equal(counts.total, 3);
  assert.equal(counts.complete, 1);
  assert.equal(counts.running, 1);
  assert.equal(counts.waiting, 1);
  assert.equal(counts.blocked, 0);
  assert.equal(counts.retrying, 0);
  assert.equal(counts.cancelled, 0);
});
