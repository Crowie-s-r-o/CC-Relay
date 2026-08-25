import test from 'node:test';
import assert from 'node:assert/strict';
import {
  graphProgress,
  graphProgressPresentation,
  isPendingPackageReady,
  normalizeTurboPackage,
  pendingPackageState,
  resolvePackageWorker,
  turboParentManifest,
} from '../public/turbo-graph.js';

test('normalizes malformed and unknown graph package states to pending', () => {
  assert.deepEqual(normalizeTurboPackage(null), { id: '', status: 'pending', dependsOn: [] });
  assert.deepEqual(normalizeTurboPackage({ id: 7, status: 'RUNNING', dependsOn: [1, 'two'] }), {
    id: '7', status: 'running', dependsOn: ['1', 'two'],
  });
  assert.equal(normalizeTurboPackage({ id: 'x', status: 'waiting' }).status, 'pending');
});

test('calculates mixed graph progress with failed nodes as terminal progress', () => {
  assert.deepEqual(graphProgress({ tasks: [
    { id: 'a', status: 'complete' },
    { id: 'b', status: 'running' },
    { id: 'c', status: 'pending' },
    { id: 'd', status: 'failed' },
    { id: 'e', status: 'unknown' },
  ] }), {
    total: 5, pending: 2, running: 1, complete: 1, failed: 1, percent: 40,
  });
  assert.deepEqual(graphProgress({ status: 'planning', tasks: [] }), {
    total: 0, pending: 0, running: 0, complete: 0, failed: 0, percent: 0,
  });
  assert.equal(graphProgress(null).percent, 0);
});

test('presents an empty active graph as planning instead of 0 / 0 complete', () => {
  assert.deepEqual(graphProgressPresentation({ status: 'planning', tasks: [] }, 'running'), {
    state: 'planning',
    label: 'Planning dependency graph',
    ariaLabel: 'Turbo dependency graph planning in progress',
    indeterminate: true,
    progress: { total: 0, pending: 0, running: 0, complete: 0, failed: 0, percent: 0 },
  });
  assert.equal(graphProgressPresentation(null, 'running').indeterminate, true);
  assert.equal(graphProgressPresentation(null, 'queued').label, 'No graph packages yet');
  assert.equal(graphProgressPresentation({ status: 'executing', tasks: [{ id: 'a', status: 'running' }] }, 'running').label, '0 / 1 complete');
});

test('identifies ready and blocked pending packages from completed dependencies', () => {
  const ready = { id: 'ready', status: 'pending', dependsOn: [] };
  const blocked = { id: 'blocked', status: 'pending', dependsOn: ['one', 'two'] };
  assert.equal(pendingPackageState(ready), 'ready');
  assert.equal(isPendingPackageReady(ready), true);
  assert.equal(pendingPackageState(blocked, new Set(['one'])), 'blocked');
  assert.equal(pendingPackageState(blocked, ['one', 'two']), 'ready');
  assert.equal(pendingPackageState({ status: 'complete' }, []), 'complete');
});

test('resolves direct worker thread and title attribution before plan fallbacks', () => {
  const plan = { workers: [
    { threadId: 'relay-a', title: 'Historical A' },
    { threadId: 'relay-b', title: 'Historical B' },
  ] };
  assert.deepEqual(resolvePackageWorker({ workerThreadId: 'relay-b', workerTitle: 'Stored B' }, plan), {
    threadId: 'relay-b', title: 'Stored B', slot: 2,
  });
  assert.deepEqual(resolvePackageWorker({ workerTitle: 'Historical A' }, plan), {
    threadId: 'relay-a', title: 'Historical A', slot: 1,
  });
  assert.deepEqual(resolvePackageWorker({ worker: 2 }, plan), {
    threadId: 'relay-b', title: 'Historical B', slot: 2,
  });
});

test('keeps disconnected worker titles neutral and falls back to Worker n', () => {
  assert.deepEqual(resolvePackageWorker({ workerThreadId: 'closed', workerTitle: 'Closed session' }), {
    threadId: 'closed', title: 'Closed session', slot: null,
  });
  assert.deepEqual(resolvePackageWorker({ worker: 3 }), {
    threadId: null, title: 'Worker 3', slot: 3,
  });
  assert.equal(resolvePackageWorker({ id: 'unassigned' }), null);
});

test('returns planner and ordered worker descriptors without live CC Relay styling', () => {
  assert.deepEqual(turboParentManifest({
    thread_id: 'planner-thread',
    thread_name: 'Planner history',
    turbo: {
      plannerThreadId: 'planner-thread',
      workers: [
        { threadId: 'worker-a', title: 'Stored A' },
        { threadId: 'worker-b', title: 'Stored B' },
      ],
    },
  }), {
    planner: { role: 'planner', slot: 0, threadId: 'planner-thread', title: 'Planner history' },
    workers: [
      { role: 'worker', slot: 1, threadId: 'worker-a', title: 'Stored A' },
      { role: 'worker', slot: 2, threadId: 'worker-b', title: 'Stored B' },
    ],
  });
  assert.deepEqual(turboParentManifest(null), {
    planner: { role: 'planner', slot: 0, threadId: null, title: null },
    workers: [],
  });
  assert.deepEqual(turboParentManifest({
    thread_id: 'executor-thread',
    thread_name: 'Executor history',
    turbo: {
      plannerThreadId: 'planner-thread',
      plannerThreadName: 'Planner history',
      executionThreadId: 'executor-thread',
    },
  }).planner, {
    role: 'planner', slot: 0, threadId: 'planner-thread', title: 'Planner history',
  });
});
