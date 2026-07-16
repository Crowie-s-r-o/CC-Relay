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
  const result = await runner.run({
    id: 7,
    prompt: 'Build feature.',
    thread_id: 'planner',
    turbo: {
      plannerThreadId: 'planner', plannerModel: 'sol', plannerEffort: 'high',
      workerModel: 'luna', workerEffort: 'high',
      workers: [{ threadId: 'worker-a' }, { threadId: 'worker-b' }],
    },
  }, { onEvent() {}, onStderr() {} });
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
  await new TurboRunner({ codex }).run({
    id: 8,
    prompt: 'Execute DAG.',
    thread_id: 'planner',
    turbo: {
      plannerThreadId: 'planner', plannerModel: 'sol', plannerEffort: 'high',
      workerModel: 'luna', workerEffort: 'high',
      workers: [{ threadId: 'worker-a' }, { threadId: 'worker-b' }],
    },
  }, { onEvent() {}, onStderr() {} });
  assert.deepEqual([...finished].sort(), ['a', 'b', 'c']);
});
