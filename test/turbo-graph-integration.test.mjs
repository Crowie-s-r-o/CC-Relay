import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ArtifactStore } from '../src/artifacts.mjs';
import { TurboRunner } from '../src/turbo-runner.mjs';
import { graphProgress, resolvePackageWorker } from '../public/turbo-graph.js';

const planText = JSON.stringify({
  version: 1,
  summary: 'Two independent dispatch packages',
  sharedContext: 'Use the assigned worker terminal.',
  tasks: [
    { id: 'alpha', title: 'Alpha package', instructions: 'Implement alpha.', dependsOn: [], ownedPaths: ['alpha.js'], verification: [] },
    { id: 'beta', title: 'Beta package', instructions: 'Implement beta.', dependsOn: [], ownedPaths: ['beta.js'], verification: [] },
  ],
});

function turboTask(id = 91) {
  return {
    id,
    title: 'Turbo integration fixture',
    prompt: 'Build the fixture.',
    mode: 'turbo',
    provider: 'codex',
    repo_path: process.cwd(),
    thread_id: 'planner-thread',
    thread_name: 'Planner history',
    turbo: {
      plannerThreadId: 'planner-thread',
      plannerModel: 'sol',
      plannerEffort: 'high',
      workerModel: 'luna',
      workerEffort: 'high',
      workers: [
        { threadId: 'worker-alpha', title: 'CC Relay Alpha history' },
        { threadId: 'worker-beta', title: 'CC Relay Beta history' },
      ],
    },
  };
}

function deferred() {
  let release;
  let released = false;
  const promise = new Promise((resolve) => {
    release = () => {
      if (released) return;
      released = true;
      resolve();
    };
  });
  return { promise, release };
}

function waitFor(predicate, timeout = 2000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - started > timeout) {
        clearInterval(timer);
        reject(new Error('Timed out waiting for persisted Turbo graph state.'));
      }
    }, 5);
  });
}

function fixture(directory, codex, id = 91) {
  const artifacts = new ArtifactStore(join(directory, 'tasks'));
  const task = turboTask(id);
  artifacts.initializeTask(task);
  return { artifacts, runner: new TurboRunner({ artifacts, codex }), task };
}

test('persists live and completed worker CC Relay assignments through graph progress', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-turbo-graph-'));
  const alpha = deferred();
  const beta = deferred();
  const codex = {
    async run(child) {
      if (String(child.id).endsWith(':planner')) return { finalResponse: planText };
      const gate = child.thread_id === 'worker-alpha' ? alpha : beta;
      await gate.promise;
      return { finalResponse: `Finished ${child.thread_id}` };
    },
    cancel() {
      alpha.release();
      beta.release();
      return true;
    },
  };
  const { artifacts, runner, task } = fixture(directory, codex);
  const execution = runner.run(task, { onEvent() {}, onStderr() {} });

  try {
    await waitFor(() => artifacts.readTurboPlan(task.id)?.tasks.every((item) => item.status === 'running'));
    let plan = artifacts.readTurboPlan(task.id);
    assert.deepEqual(graphProgress(plan), {
      total: 2, pending: 0, running: 2, complete: 0, failed: 0, percent: 0,
    });
    for (const item of plan.tasks) {
      const worker = resolvePackageWorker(item, plan);
      assert.equal(item.status, 'running');
      assert.equal(worker.threadId, item.workerThreadId);
      assert.equal(worker.title, item.workerTitle);
      assert.equal(worker.slot, item.worker);
    }

    alpha.release();
    await waitFor(() => artifacts.readTurboPlan(task.id)?.tasks.some((item) => item.status === 'complete'));
    plan = artifacts.readTurboPlan(task.id);
    assert.deepEqual(graphProgress(plan), {
      total: 2, pending: 0, running: 1, complete: 1, failed: 0, percent: 50,
    });
    const completed = plan.tasks.find((item) => item.status === 'complete');
    const active = plan.tasks.find((item) => item.status === 'running');
    assert.equal(resolvePackageWorker(completed, plan).threadId, completed.workerThreadId);
    assert.equal(resolvePackageWorker(completed, plan).title, completed.workerTitle);
    assert.equal(resolvePackageWorker(active, plan).threadId, active.workerThreadId);

    beta.release();
    await execution;
    plan = artifacts.readTurboPlan(task.id);
    assert.equal(plan.status, 'complete');
    assert.deepEqual(graphProgress(plan), {
      total: 2, pending: 0, running: 0, complete: 2, failed: 0, percent: 100,
    });
    for (const item of plan.tasks) {
      assert.equal(item.status, 'complete');
      assert.equal(resolvePackageWorker(item, plan).threadId, item.workerThreadId);
      assert.equal(resolvePackageWorker(item, plan).title, item.workerTitle);
    }
  } finally {
    alpha.release();
    beta.release();
    await execution.catch(() => {});
    rmSync(directory, { recursive: true, force: true });
  }
});

test('failed worker retains CC Relay attribution and contributes failed progress', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-turbo-graph-failed-'));
  const held = deferred();
  const codex = {
    async run(child) {
      if (String(child.id).endsWith(':planner')) return { finalResponse: planText };
      if (child.thread_id === 'worker-alpha') {
        await Promise.resolve();
        throw new Error('Alpha worker failed for fixture.');
      }
      await held.promise;
      return { finalResponse: 'Beta completed.' };
    },
    cancel() {
      held.release();
      return true;
    },
  };
  const { artifacts, runner, task } = fixture(directory, codex, 92);
  const execution = runner.run(task, { onEvent() {}, onStderr() {} });

  try {
    await assert.rejects(execution, /Alpha worker failed for fixture/);
    const plan = artifacts.readTurboPlan(task.id);
    const failed = plan.tasks.find((item) => item.status === 'failed');
    assert.ok(failed);
    assert.equal(failed.error, 'Alpha worker failed for fixture.');
    assert.deepEqual(resolvePackageWorker(failed, plan), {
      threadId: failed.workerThreadId,
      title: failed.workerTitle,
      slot: failed.worker,
    });
    const progress = graphProgress(plan);
    assert.equal(progress.failed, 1);
    assert.equal(progress.complete, 0);
    assert.equal(progress.percent, 50);
  } finally {
    held.release();
    await execution.catch(() => {});
    rmSync(directory, { recursive: true, force: true });
  }
});

test('disconnected worker history keeps its stored title without a fabricated CC Relay number', () => {
  const packageItem = {
    id: 'historical',
    status: 'complete',
    workerThreadId: 'closed-thread',
    workerTitle: 'Archived CC Relay session',
  };
  const resolved = resolvePackageWorker(packageItem, { workers: [] });
  assert.deepEqual(resolved, {
    threadId: 'closed-thread',
    title: 'Archived CC Relay session',
    slot: null,
  });
  assert.equal('relayNumber' in resolved, false);
});
