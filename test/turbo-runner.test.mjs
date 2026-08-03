import assert from 'node:assert/strict';
import test from 'node:test';
import { parseTurboPlan, TurboRunner } from '../src/turbo-runner.mjs';

const planText = JSON.stringify({
  summary: 'Parallel plan',
  sharedContext: 'Keep the API stable.',
  tasks: [
    { id: 'api', title: 'API', instructions: 'Implement API.', dependsOn: [], ownedPaths: ['src/api.js'], verification: ['npm test'] },
    { id: 'ui', title: 'UI', instructions: 'Implement UI.', dependsOn: [], ownedPaths: ['public/app.js'], verification: ['npm test'] },
  ],
});

function turboTask(id = 7) {
  return {
    id,
    prompt: 'Build feature.',
    thread_id: 'planner',
    turbo: {
      plannerThreadId: 'planner', plannerModel: 'sol', plannerEffort: 'high',
      workerModel: 'luna', workerEffort: 'high',
      workers: [{ threadId: 'worker-a', title: 'CC Relay A' }, { threadId: 'worker-b', title: 'CC Relay B' }],
    },
  };
}

function councilTurboTask(id = 7) {
  const task = turboTask(id);
  task.attachments = [{ path: `/tmp/tasks/${id}/attachments/01.png` }];
  task.turbo.council = {
    enabled: true,
    order: ['codex', 'claude'],
    reviewerProvider: 'claude',
    reviewerModel: 'sonnet',
    reviewerEffort: 'high',
  };
  return task;
}

const correctedPlanText = JSON.stringify({
  version: 1,
  summary: 'Claude corrected graph',
  sharedContext: 'Reviewed shared context.',
  tasks: [
    { id: 'api', title: 'Reviewed API', instructions: 'Implement the reviewed API.', dependsOn: [], ownedPaths: ['src/api.js'], verification: ['npm test'] },
    { id: 'ui', title: 'Reviewed UI', instructions: 'Implement the reviewed UI.', dependsOn: [], ownedPaths: ['public/app.js'], verification: ['npm test'] },
  ],
});

function memoryArtifacts() {
  const plans = new Map();
  return {
    plans,
    writeTurboPlan(id, plan) { plans.set(id, structuredClone(plan)); },
    readTurboPlan(id) { return plans.has(id) ? structuredClone(plans.get(id)) : null; },
  };
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
        reject(new Error('Timed out waiting for Turbo runner state.'));
      }
    }, 5);
  });
}

test('turbo plan parser requires the configured package count', () => {
  assert.equal(parseTurboPlan(planText, 2).tasks.length, 2);
  assert.throws(() => parseTurboPlan(planText, 3), /at least 3/);
});

test('turbo runner plans once then starts workers concurrently', async () => {
  const calls = [];
  let activeWorkers = 0;
  let peakWorkers = 0;
  const codex = {
    async run(task) {
      calls.push(task);
      if (String(task.id).endsWith(':planner')) return { finalResponse: planText };
      activeWorkers += 1;
      peakWorkers = Math.max(peakWorkers, activeWorkers);
      await new Promise((resolve) => setImmediate(resolve));
      activeWorkers -= 1;
      return { finalResponse: `Finished ${task.thread_id}` };
    },
    cancel() { return true; },
  };
  const runner = new TurboRunner({ codex });
  const result = await runner.run(turboTask(), { onEvent() {}, onStderr() {} });
  assert.equal(calls.length, 3);
  assert.equal(calls[0].read_only, true);
  assert.equal(calls[1].model, 'luna');
  assert.equal(peakWorkers, 2);
  assert.match(result.finalResponse, /worker 2/);
});

test('turbo runner waits for graph dependencies before dispatch', async () => {
  const dependencyPlan = JSON.stringify({
    version: 1,
    summary: 'DAG plan',
    tasks: [
      { id: 'a', title: 'A', instructions: 'A', dependsOn: [] },
      { id: 'b', title: 'B', instructions: 'B', dependsOn: [] },
      { id: 'c', title: 'C', instructions: 'C', dependsOn: ['a', 'b'] },
    ],
  });
  const finished = new Set();
  const codex = {
    async run(task) {
      if (String(task.id).endsWith(':planner')) return { finalResponse: dependencyPlan };
      const graphId = String(task.id).split(':').at(-1);
      if (graphId === 'c') assert.deepEqual([...finished].sort(), ['a', 'b']);
      await new Promise((resolve) => setImmediate(resolve));
      finished.add(graphId);
      return { finalResponse: graphId };
    },
    cancel() { return true; },
  };
  await new TurboRunner({ codex }).run({ ...turboTask(8), prompt: 'Execute DAG.' }, { onEvent() {}, onStderr() {} });
  assert.deepEqual([...finished].sort(), ['a', 'b', 'c']);
});

test('turbo runner reuses a persisted ready plan without planning again', async () => {
  const artifacts = memoryArtifacts();
  const persisted = JSON.parse(planText);
  persisted.status = 'ready';
  persisted.planner = { threadId: 'planner', model: 'sol', effort: 'high' };
  persisted.workers = turboTask().turbo.workers;
  persisted.tasks = persisted.tasks.map((item) => ({ ...item, status: 'pending', worker: null, result: null }));
  artifacts.writeTurboPlan(7, persisted);
  const calls = [];
  const runner = new TurboRunner({
    artifacts,
    codex: { async run(task) { calls.push(task); return { finalResponse: 'done' }; }, cancel() { return true; } },
  });
  await runner.run(turboTask(), { onEvent() {}, onStderr() {} });
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => !String(call.id).endsWith(':planner')));
  assert.equal(artifacts.readTurboPlan(7).status, 'complete');
});

test('turbo preparation deduplicates concurrent planner turns', async () => {
  const artifacts = memoryArtifacts();
  let plannerCalls = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const runner = new TurboRunner({
    artifacts,
    codex: {
      async run(task) {
        if (String(task.id).endsWith(':planner')) {
          plannerCalls += 1;
          await gate;
          return { finalResponse: planText };
        }
        return { finalResponse: 'done' };
      },
      cancel() { return true; },
    },
  });
  const first = runner.prepare(turboTask(), { onEvent() {}, onStderr() {} });
  const second = runner.prepare(turboTask(), { onEvent() {}, onStderr() {} });
  release();
  const [left, right] = await Promise.all([first, second]);
  assert.equal(plannerCalls, 1);
  assert.equal(left.status, 'ready');
  assert.equal(right.status, 'ready');
});

test('turbo preparation persists planning, ready, and failed lifecycle states', async () => {
  const artifacts = memoryArtifacts();
  const events = [];
  const runner = new TurboRunner({
    artifacts,
    codex: { async run() { return { finalResponse: planText }; }, cancel() { return true; } },
  });
  await runner.prepare(turboTask(), { onEvent: (entry) => events.push(entry), onStderr() {} });
  assert.equal(events[0].event.status, 'running');
  assert.equal(events.at(-1).event.status, 'ready');
  assert.equal(artifacts.readTurboPlan(7).status, 'ready');

  const failureArtifacts = memoryArtifacts();
  const failing = new TurboRunner({
    artifacts: failureArtifacts,
    codex: { async run() { throw new Error('planner unavailable'); }, cancel() { return true; } },
  });
  await assert.rejects(() => failing.prepare(turboTask(), { onEvent() {}, onStderr() {} }), /planner unavailable/);
  assert.equal(failureArtifacts.readTurboPlan(7).status, 'failed');
});

test('turbo cancellation is scoped to one parent task', async () => {
  const calls = [];
  const runner = new TurboRunner({
    codex: {
      async run(task) { await new Promise(() => {}); },
      cancel(taskId) { calls.push(taskId); return true; },
    },
  });
  runner.trackChild(1, '1:planner');
  runner.trackChild(1, '1:worker:1:a');
  runner.trackChild(2, '2:planner');
  assert.equal(runner.cancel(1), true);
  assert.deepEqual(calls.sort(), ['1:planner', '1:worker:1:a']);
  calls.length = 0;
  runner.cancel();
  assert.deepEqual(calls.sort(), ['1:planner', '1:worker:1:a', '2:planner']);
});

test('turbo graph packages retain exact CC Relay attribution while workers run and finish', async () => {
  const artifacts = memoryArtifacts();
  const workerGate = new Promise((resolve) => { globalThis.releaseTurboWorker = resolve; });
  const events = [];
  const codex = {
    async run(task) {
      if (String(task.id).endsWith(':planner')) return { finalResponse: planText };
      if (task.thread_id === 'worker-a') await workerGate;
      return { finalResponse: `Finished ${task.thread_id}` };
    },
    cancel() { globalThis.releaseTurboWorker?.(); return true; },
  };
  const runner = new TurboRunner({ codex, artifacts });
  const execution = runner.run(turboTask(), { onEvent: (entry) => events.push(entry), onStderr() {} });
  try {
    await waitFor(() => artifacts.readTurboPlan(7)?.tasks.some((item) => item.status === 'running'));
    const running = artifacts.readTurboPlan(7).tasks.find((item) => item.status === 'running');
    assert.equal(running.workerThreadId, 'worker-a');
    assert.equal(running.workerTitle, 'CC Relay A');
    assert.ok(events.some(({ event }) => event.type === 'turbo/dispatch' && event.workerThreadId === 'worker-a'));
    globalThis.releaseTurboWorker();
    await execution;
    const completed = artifacts.readTurboPlan(7).tasks.find((item) => item.id === 'api');
    assert.equal(completed.status, 'complete');
    assert.equal(completed.workerThreadId, 'worker-a');
    assert.equal(completed.workerTitle, 'CC Relay A');
    assert.ok(events.some(({ event }) => event.type === 'turbo/taskCompleted' && event.workerThreadId === 'worker-a'));
  } finally {
    globalThis.releaseTurboWorker?.();
    delete globalThis.releaseTurboWorker;
    await execution.catch(() => {});
  }
});

test('ready-plan reuse clears stale CC Relay assignment before dispatch', async () => {
  const artifacts = memoryArtifacts();
  const persisted = JSON.parse(planText);
  persisted.status = 'ready';
  persisted.planner = { threadId: 'planner', model: 'sol', effort: 'high' };
  persisted.workers = turboTask().turbo.workers;
  persisted.tasks = persisted.tasks.map((item) => ({
    ...item,
    status: 'pending',
    worker: 9,
    workerThreadId: 'stale-thread',
    workerTitle: 'Stale CC Relay',
    result: 'stale result',
  }));
  artifacts.writeTurboPlan(7, persisted);
  const stagePlans = [];
  const gate = new Promise((resolve) => { globalThis.releaseReadyWorker = resolve; });
  const runner = new TurboRunner({
    artifacts,
    codex: {
      async run(task) {
        if (task.thread_id === 'worker-a') await gate;
        return { finalResponse: 'done' };
      },
      cancel() { globalThis.releaseReadyWorker?.(); return true; },
    },
  });
  const execution = runner.run(turboTask(), { onEvent: ({ event }) => { if (event.phase === 'workers') stagePlans.push(structuredClone(event.plan)); }, onStderr() {} });
  try {
    await waitFor(() => stagePlans.length > 0);
    assert.ok(stagePlans[0].tasks.every((item) => item.worker === null && item.workerThreadId === null && item.workerTitle === null));
    globalThis.releaseReadyWorker();
    await execution;
  } finally {
    globalThis.releaseReadyWorker?.();
    delete globalThis.releaseReadyWorker;
    await execution.catch(() => {});
  }
});

test('worker rejection persists a failed graph package and emits attribution', async () => {
  const artifacts = memoryArtifacts();
  const cancelled = [];
  const heldWorker = new Promise((resolve) => { globalThis.releaseFailedWorker = resolve; });
  const events = [];
  const failurePlan = JSON.stringify({
    summary: 'Failure plan',
    tasks: [
      { id: 'api', title: 'API', instructions: 'API', dependsOn: [] },
      { id: 'ui', title: 'UI', instructions: 'UI', dependsOn: ['api'] },
    ],
  });
  const codex = {
    async run(task) {
      if (String(task.id).endsWith(':planner')) return { finalResponse: failurePlan };
      if (task.thread_id === 'worker-a') throw new Error('worker A broke');
      await heldWorker;
      return { finalResponse: 'worker B finished' };
    },
    cancel(taskId) {
      cancelled.push(taskId);
      globalThis.releaseFailedWorker?.();
      return true;
    },
  };
  const runner = new TurboRunner({ codex, artifacts });
  await assert.rejects(() => runner.run(turboTask(), { onEvent: (entry) => events.push(entry), onStderr() {} }), /worker A broke/);
  const failed = artifacts.readTurboPlan(7).tasks.find((item) => item.id === 'api');
  assert.equal(failed.status, 'failed');
  assert.equal(failed.error, 'worker A broke');
  assert.equal(failed.workerThreadId, 'worker-a');
  assert.ok(events.some(({ event }) => event.type === 'turbo/taskFailed'
    && event.workerThreadId === 'worker-a' && event.taskId === 'api'));
  assert.deepEqual(cancelled, []);
  assert.equal(artifacts.readTurboPlan(7).tasks.find((item) => item.id === 'ui').status, 'pending');
  globalThis.releaseFailedWorker?.();
});

test('enabled Turbo council runs Codex draft before Claude correction and executes the corrected graph', async () => {
  const artifacts = memoryArtifacts();
  const calls = [];
  const events = [];
  const council = {
    async review(request) {
      calls.push({ type: 'claude', request });
      request.onEvent({ event: { type: 'claude/completed' }, message: 'reviewed' });
      return { text: correctedPlanText, sessionId: 'claude-session' };
    },
    cancel() { return true; },
  };
  const codex = {
    async run(task) {
      calls.push({ type: 'codex', task });
      if (String(task.id).endsWith(':planner')) return { finalResponse: planText };
      return { finalResponse: `worker ${task.thread_id}` };
    },
    cancel() { return true; },
  };
  const runner = new TurboRunner({ codex, artifacts, councilReviewer: council });
  const result = await runner.run(councilTurboTask(), { onEvent: (entry) => events.push(entry), onStderr() {} });
  assert.deepEqual(calls.map((call) => call.type), ['codex', 'claude', 'codex', 'codex']);
  assert.equal(calls[1].request.claudeModel, 'sonnet');
  assert.equal(calls[1].request.claudeEffort, 'high');
  assert.deepEqual(calls[1].request.attachmentPaths, ['/tmp/tasks/7/attachments/01.png']);
  assert.match(result.finalResponse, /Reviewed API/);
  assert.ok(events.some(({ event }) => event.phase === 'planner' && event.status === 'complete'));
  assert.ok(events.some(({ event }) => event.provider === 'claude' && event.phase === 'council-review'));
  const persisted = artifacts.readTurboPlan(7);
  assert.equal(persisted.status, 'complete');
  assert.equal(persisted.summary, 'Claude corrected graph');
  assert.equal(persisted.council.status, 'complete');
  assert.equal(persisted.council.codex.status, 'complete');
  assert.equal(persisted.council.review.status, 'complete');
});

test('selectable council order runs Claude author before Codex correction', async () => {
  const artifacts = memoryArtifacts();
  const calls = [];
  const task = turboTask(17);
  task.turbo.council = {
    enabled: true,
    order: ['claude', 'codex'],
    authorProvider: 'claude',
    authorModel: 'sonnet',
    authorEffort: 'high',
    reviewerProvider: 'codex',
    reviewerModel: 'sol',
    reviewerEffort: 'high',
  };
  const council = {
    async draft(request) {
      calls.push({ type: 'claude-author', request });
      return { text: planText, sessionId: 'claude-author-session' };
    },
    cancel() { return true; },
  };
  const codex = {
    async run(child) {
      if (String(child.id).endsWith(':planner')) {
        calls.push({ type: 'codex-review', child });
        assert.match(child.prompt, /Claude draft JSON/);
        return { finalResponse: correctedPlanText };
      }
      calls.push({ type: 'worker', child });
      return { finalResponse: `completed ${child.thread_id}` };
    },
    cancel() { return true; },
  };
  const runner = new TurboRunner({ codex, artifacts, councilReviewer: council });
  const result = await runner.run(task, { onEvent() {}, onStderr() {} });
  assert.deepEqual(calls.map((call) => call.type), ['claude-author', 'codex-review', 'worker', 'worker']);
  assert.equal(calls[0].request.claudeModel, 'sonnet');
  assert.match(result.finalResponse, /Reviewed API/);
  const persisted = artifacts.readTurboPlan(17);
  assert.deepEqual(persisted.council.order, ['claude', 'codex']);
  assert.equal(persisted.council.author.provider, 'claude');
  assert.equal(persisted.council.review.provider, 'codex');
});

test('enabled Turbo council persists reviewing state while Claude is active and releases the planner child', async () => {
  const artifacts = memoryArtifacts();
  let releaseReview;
  let rejectReview;
  const cancelled = [];
  const council = {
    async review(request) {
      request.onEvent({ event: { type: 'claude/started' }, message: 'started' });
      await new Promise((resolve, reject) => {
        releaseReview = resolve;
        rejectReview = reject;
      });
      return { text: correctedPlanText };
    },
    cancel(parentTaskId) {
      cancelled.push(parentTaskId);
      rejectReview?.(Object.assign(new Error('cancelled'), { cancelled: true }));
      return true;
    },
  };
  const codex = {
    async run(task) {
      if (String(task.id).endsWith(':planner')) return { finalResponse: planText };
      return { finalResponse: 'done' };
    },
    cancel(taskId) { cancelled.push(`codex:${taskId}`); return true; },
  };
  const runner = new TurboRunner({ codex, artifacts, councilReviewer: council });
  const preparation = runner.prepare(councilTurboTask(), { onEvent() {}, onStderr() {} });
  await waitFor(() => artifacts.readTurboPlan(7)?.status === 'reviewing');
  assert.equal(artifacts.readTurboPlan(7).council.status, 'reviewing');
  assert.equal(runner.activeChildren.has(7), false);
  assert.equal(runner.cancel(7), true);
  assert.deepEqual(cancelled, [7]);
  releaseReview();
  await assert.rejects(preparation, /./);
});

test('invalid Claude correction fails preparation and never starts workers', async () => {
  const artifacts = memoryArtifacts();
  let workers = 0;
  const runner = new TurboRunner({
    artifacts,
    codex: {
      async run(task) {
        if (String(task.id).endsWith(':planner')) return { finalResponse: planText };
        workers += 1;
        return { finalResponse: 'should not run' };
      },
      cancel() { return true; },
    },
    councilReviewer: {
      async review() { return { text: '{not valid json' }; },
      cancel() { return true; },
    },
  });
  await assert.rejects(() => runner.prepare(councilTurboTask()), /JSON execution plan/);
  assert.equal(workers, 0);
  const failed = artifacts.readTurboPlan(7);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.council.status, 'failed');
});

test('ready Turbo council plans require matching reviewer configuration', () => {
  const artifacts = memoryArtifacts();
  const task = councilTurboTask();
  const persisted = JSON.parse(correctedPlanText);
  persisted.status = 'ready';
  persisted.planner = { threadId: 'planner', model: 'sol', effort: 'high' };
  persisted.workers = task.turbo.workers;
  persisted.council = {
    enabled: true,
    order: ['codex', 'claude'],
    reviewerProvider: 'claude',
    reviewerModel: 'sonnet',
    reviewerEffort: 'high',
    status: 'complete',
  };
  persisted.tasks = persisted.tasks.map((item) => ({ ...item, status: 'pending', worker: null }));
  artifacts.writeTurboPlan(7, persisted);
  const runner = new TurboRunner({ artifacts, codex: { run() {}, cancel() { return true; } } });
  assert.equal(runner.readyPlan(task).status, 'ready');
  const mismatched = councilTurboTask();
  mismatched.turbo.council.reviewerModel = 'opus';
  assert.equal(runner.readyPlan(mismatched), null);
  const disabled = turboTask();
  assert.equal(runner.readyPlan(disabled), null);
});
