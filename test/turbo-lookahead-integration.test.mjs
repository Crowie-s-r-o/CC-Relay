import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ArtifactStore } from '../src/artifacts.mjs';
import { RelayDatabase } from '../src/database.mjs';
import { TaskQueue } from '../src/queue.mjs';
import { RelayRunner } from '../src/relay-runner.mjs';
import { TurboRunner } from '../src/turbo-runner.mjs';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function waitFor(predicate, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - started > timeout) {
        clearInterval(timer);
        reject(new Error('Timed out waiting for Turbo look-ahead state.'));
      }
    }, 5);
  });
}

function thread(id, cwd) {
  return { id, title: id, source: 'integration-test', cwd };
}

function turboInput(title, cwd) {
  return {
    title,
    prompt: `Implement ${title}.`,
    provider: 'codex',
    mode: 'turbo',
    thread: thread('planner', cwd),
    turbo: {
      plannerThreadId: 'planner',
      plannerModel: 'sol',
      plannerEffort: 'high',
      workerModel: 'luna',
      workerEffort: 'high',
      workers: [{ threadId: 'worker', title: 'Worker' }],
    },
  };
}

function planResponse(parentId) {
  return JSON.stringify({
    version: 1,
    summary: `Prepared parent ${parentId}`,
    sharedContext: 'Use the shared integration-test contract.',
    tasks: [{
      id: `step-${parentId}`,
      title: `Step ${parentId}`,
      instructions: `Implement parent ${parentId}.`,
      dependsOn: [],
      ownedPaths: [`src/parent-${parentId}.mjs`],
      verification: ['node --test'],
    }],
  });
}

function setup(codex) {
  const directory = mkdtempSync(join(tmpdir(), 'relay-turbo-lookahead-integration-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  const artifacts = new ArtifactStore(join(directory, 'tasks'));
  const turbo = new TurboRunner({ codex, artifacts });
  const runner = new RelayRunner({ codex, turbo });
  const queue = new TaskQueue({ database, artifacts, runner });
  return { directory, database, artifacts, queue };
}

function cleanup({ directory, database, queue }) {
  database.close();
  rmSync(directory, { recursive: true, force: true });
  return queue;
}

test('real queue prepares three Turbo parents serially while the first workers execute', async () => {
  const plannerGates = new Map();
  const workerGate = deferred();
  const plannerCalls = [];
  const workerCalls = [];
  let activePlanners = 0;
  let peakPlanners = 0;
  let setupState;
  const codex = {
    async run(task) {
      const parentId = Number(String(task.id).split(':')[0]);
      if (String(task.id).endsWith(':planner')) {
        plannerCalls.push({ parentId, threadId: task.thread_id });
        assert.notEqual(task.thread_id, 'worker');
        activePlanners += 1;
        peakPlanners = Math.max(peakPlanners, activePlanners);
        if (parentId > 1) {
          const gate = deferred();
          plannerGates.set(parentId, gate);
          await gate.promise;
        }
        activePlanners -= 1;
        return { finalResponse: planResponse(parentId) };
      }
      workerCalls.push(parentId);
      if (parentId === 1) await workerGate.promise;
      return { finalResponse: `Completed parent ${parentId}`, sessionId: `worker-${parentId}`, exitCode: 0 };
    },
    cancel(taskId) {
      const parentId = Number(String(taskId).split(':')[0]);
      plannerGates.get(parentId)?.reject(Object.assign(new Error('Cancelled'), { cancelled: true }));
      return true;
    },
  };
  setupState = setup(codex);
  const { queue, database, artifacts } = setupState;
  try {
    const first = queue.enqueue(turboInput('First', setupState.directory));
    const second = queue.enqueue(turboInput('Second', setupState.directory));
    const third = queue.enqueue(turboInput('Third', setupState.directory));

    await waitFor(() => database.getTask(first.id).status === 'running');
    queue.schedule();
    await waitFor(() => plannerGates.has(second.id));
    assert.deepEqual(queue.status().planningTaskIds, [second.id]);
    assert.equal(artifacts.readTurboPlan(second.id).status, 'planning');
    assert.equal(database.getTask(second.id).status, 'queued');
    assert.equal(database.getTask(third.id).status, 'queued');

    plannerGates.get(second.id).resolve();
    await waitFor(() => plannerGates.has(third.id));
    await waitFor(() => artifacts.readTurboPlan(second.id)?.status === 'ready');
    assert.equal(database.getTask(second.id).status, 'queued');
    assert.deepEqual(queue.status().planningTaskIds, [third.id]);

    plannerGates.get(third.id).resolve();
    await waitFor(() => artifacts.readTurboPlan(third.id)?.status === 'ready');
    assert.equal(database.getTask(third.id).status, 'queued');
    assert.equal(peakPlanners, 1);
    assert.deepEqual(plannerCalls.map((call) => call.parentId), [first.id, second.id, third.id]);
    assert.deepEqual(workerCalls, [first.id]);
    assert.match(database.listEvents(second.id).map((event) => event.message).join('\n'), /Forward plan ready/);
    assert.match(database.listEvents(third.id).map((event) => event.message).join('\n'), /Forward plan ready/);

    workerGate.resolve();
    await waitFor(() => database.getTask(third.id).status === 'complete');
    assert.deepEqual(workerCalls, [first.id, second.id, third.id]);
    assert.equal(artifacts.readTurboPlan(first.id).status, 'complete');
    assert.equal(artifacts.readTurboPlan(second.id).status, 'complete');
    assert.equal(artifacts.readTurboPlan(third.id).status, 'complete');
  } finally {
    workerGate.resolve();
    for (const gate of plannerGates.values()) gate.resolve();
    await queue.shutdown();
    cleanup(setupState);
  }
});

test('cancelling a queued look-ahead task cancels only its planner child', async () => {
  const plannerGate = deferred();
  const workerGate = deferred();
  const cancelled = [];
  let setupState;
  const codex = {
    async run(task) {
      const parentId = Number(String(task.id).split(':')[0]);
      if (String(task.id).endsWith(':planner')) {
        if (parentId === 2) await plannerGate.promise;
        return { finalResponse: planResponse(parentId) };
      }
      if (parentId === 1) await workerGate.promise;
      return { finalResponse: `Completed parent ${parentId}`, exitCode: 0 };
    },
    cancel(taskId) {
      cancelled.push(taskId);
      if (taskId === '2:planner') plannerGate.reject(Object.assign(new Error('Cancelled'), { cancelled: true }));
      return true;
    },
  };
  setupState = setup(codex);
  const { queue, database } = setupState;
  try {
    const first = queue.enqueue(turboInput('First', setupState.directory));
    const second = queue.enqueue(turboInput('Second', setupState.directory));
    await waitFor(() => database.getTask(first.id).status === 'running');
    queue.schedule();
    await waitFor(() => queue.status().planningTaskIds.includes(second.id));
    queue.cancel(second.id);
    assert.equal(database.getTask(second.id).status, 'cancelled');
    assert.deepEqual(cancelled, ['2:planner']);
    assert.equal(database.getTask(first.id).status, 'running');
    workerGate.resolve();
    await waitFor(() => database.getTask(first.id).status === 'complete');
  } finally {
    workerGate.resolve();
    plannerGate.resolve();
    await queue.shutdown();
    cleanup(setupState);
  }
});

test('a stale planning artifact is replanned before Turbo execution', async () => {
  const plannerCalls = [];
  const workerGate = deferred();
  let setupState;
  const codex = {
    async run(task) {
      const parentId = Number(String(task.id).split(':')[0]);
      if (String(task.id).endsWith(':planner')) {
        plannerCalls.push(parentId);
        return { finalResponse: planResponse(parentId) };
      }
      if (parentId === 1) await workerGate.promise;
      return { finalResponse: `Completed parent ${parentId}`, exitCode: 0 };
    },
    cancel() { return true; },
  };
  setupState = setup(codex);
  const { queue, database, artifacts } = setupState;
  try {
    const first = queue.enqueue(turboInput('First', setupState.directory));
    const second = queue.enqueue(turboInput('Second', setupState.directory));
    artifacts.writeTurboPlan(second.id, {
      version: 1,
      status: 'planning',
      planner: { threadId: 'planner' },
      workers: second.turbo.workers,
      tasks: [],
    });
    await waitFor(() => database.getTask(first.id).status === 'running');
    queue.schedule();
    await waitFor(() => artifacts.readTurboPlan(second.id)?.status === 'ready');
    assert.equal(database.getTask(second.id).status, 'queued');
    assert.deepEqual(plannerCalls, [first.id, second.id]);
    workerGate.resolve();
    await waitFor(() => database.getTask(second.id).status === 'complete');
  } finally {
    workerGate.resolve();
    await queue.shutdown();
    cleanup(setupState);
  }
});
