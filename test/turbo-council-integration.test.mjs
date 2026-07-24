import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ArtifactStore } from '../src/artifacts.mjs';
import { RelayDatabase } from '../src/database.mjs';
import { RelayRunner } from '../src/relay-runner.mjs';
import { TaskQueue } from '../src/queue.mjs';
import { TurboPlanCouncilReviewer } from '../src/turbo-plan-council.mjs';
import { TurboRunner } from '../src/turbo-runner.mjs';

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function draftPlan(title, reviewed = false) {
  const id = `${reviewed ? 'reviewed' : 'draft'}-${slug(title)}`;
  return {
    version: 1,
    summary: `${reviewed ? 'Reviewed' : 'Draft'} graph for ${title}`,
    sharedContext: 'Use only the assigned package.',
    tasks: [{
      id,
      title: `${reviewed ? 'Reviewed' : 'Draft'} package for ${title}`,
      instructions: `Implement the ${reviewed ? 'reviewed' : 'draft'} package for ${title}.`,
      dependsOn: [],
      ownedPaths: [`${slug(title)}.js`],
      verification: ['node --check package.js'],
    }],
  };
}

function objectiveFromPrompt(prompt) {
  return prompt.match(/Original objective:\n([^\n]+)/)?.[1]?.replace(/^Plan\s+/, '') || 'Unknown';
}

function thread(id, cwd) {
  return { id, title: `Session ${id}`, source: 'fake', cwd };
}

function turboInput(title, cwd, { council = true, plannerThread = 'planner-main', workerThread = `worker-${slug(title)}` } = {}) {
  return {
    title,
    prompt: `Plan ${title}`,
    mode: 'turbo',
    provider: 'codex',
    thread: thread(plannerThread, cwd),
    turbo: {
      plannerThreadId: plannerThread,
      plannerModel: 'sol',
      plannerEffort: 'high',
      workerModel: 'luna',
      workerEffort: 'high',
      workerCount: 1,
      workers: [{ threadId: workerThread, title: `Worker ${workerThread}` }],
      ...(council ? {
        council: {
          enabled: true,
          order: ['codex', 'claude'],
          reviewerProvider: 'claude',
          reviewerModel: 'sonnet',
          reviewerEffort: 'high',
        },
      } : {}),
    },
  };
}

function deferred() {
  let resolve;
  let reject;
  let settled = false;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = (value) => {
      if (settled) return;
      settled = true;
      resolvePromise(value);
    };
    reject = (error) => {
      if (settled) return;
      settled = true;
      rejectPromise(error);
    };
  });
  return {
    promise,
    resolve,
    reject,
    get settled() {
      return settled;
    },
  };
}

class FakeCodex {
  constructor({ holdCurrent = false } = {}) {
    this.holdCurrent = holdCurrent;
    this.currentGate = deferred();
    this.plannerOrder = [];
    this.workerStarts = [];
    this.cancelled = [];
  }

  async run(task) {
    if (String(task.id).endsWith(':planner')) {
      this.plannerOrder.push(task.title);
      return { finalResponse: JSON.stringify(draftPlan(task.title)), sessionId: `planner-${task.title}` };
    }
    this.workerStarts.push({ title: task.title, prompt: task.prompt, threadId: task.thread_id });
    if (this.holdCurrent && task.title === 'Current') {
      await this.currentGate.promise;
    }
    return { finalResponse: `Worker completed ${task.title}`, sessionId: task.thread_id, exitCode: 0 };
  }

  cancel(taskId) {
    this.cancelled.push(taskId);
    if (String(taskId).includes(':worker:')) {
      this.currentGate.resolve();
      return true;
    }
    return false;
  }

  releaseCurrent() {
    this.currentGate.resolve();
  }
}

class FakeClaude {
  constructor({ hold = true, invalidCount = 0 } = {}) {
    this.hold = hold;
    this.invalidCount = invalidCount;
    this.calls = 0;
    this.active = 0;
    this.maximumActive = 0;
    this.requests = [];
    this.pending = new Map();
  }

  run(prompt, options = {}) {
    const title = objectiveFromPrompt(prompt);
    const request = { title, prompt, options, gate: deferred() };
    this.calls += 1;
    this.requests.push(request);
    this.active += 1;
    this.maximumActive = Math.max(this.maximumActive, this.active);
    const output = this.calls <= this.invalidCount
      ? Promise.resolve({ text: 'not valid JSON' })
      : this.hold
        ? request.gate.promise.then(() => ({
          text: JSON.stringify(draftPlan(title, true)),
          sessionId: `review-${slug(title)}`,
        }))
        : Promise.resolve({
          text: JSON.stringify(draftPlan(title, true)),
          sessionId: `review-${slug(title)}`,
        });
    return output.finally(() => {
      this.active -= 1;
      this.pending.delete(title);
    });
  }

  release(title) {
    const request = this.requests.find((item) => item.title === title && !item.gate.settled);
    if (request) request.gate.resolve();
  }

  cancel() {
    const active = [...this.pending.values()][0]
      || this.requests.find((request) => request.title && this.active > 0);
    if (!active) return false;
    active.gate.reject(Object.assign(new Error('Claude review cancelled.'), { cancelled: true }));
    return true;
  }
}

function installPendingTracking(claude) {
  const originalRun = claude.run.bind(claude);
  claude.run = (...args) => {
    const result = originalRun(...args);
    const request = claude.requests.at(-1);
    if (request && claude.hold && claude.calls > claude.invalidCount) claude.pending.set(request.title, request);
    return result;
  };
  return claude;
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
        reject(new Error('Timed out waiting for Turbo council integration state.'));
      }
    }, 5);
  });
}

function createHarness(directory, { codex, claude, retryDelayMs = 20 } = {}) {
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  const artifacts = new ArtifactStore(join(directory, 'tasks'));
  const reviewer = new TurboPlanCouncilReviewer({ claude });
  const turbo = new TurboRunner({ codex, artifacts, councilReviewer: reviewer });
  const relay = new RelayRunner({ codex, turbo, claude: {}, planCouncil: {} });
  const queue = new TaskQueue({ database, artifacts, runner: relay, retryDelayMs });
  return { database, artifacts, reviewer, turbo, relay, queue };
}

function closeHarness(harness, directory) {
  return Promise.resolve(harness.queue?.shutdown())
    .finally(() => {
      harness.database.close();
      rmSync(directory, { recursive: true, force: true });
    });
}

test('Codex drafts ahead while Claude review stays serialized, and workers use corrected graphs', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-turbo-council-e2e-'));
  const codex = new FakeCodex({ holdCurrent: true });
  const claude = installPendingTracking(new FakeClaude({ hold: true }));
  const harness = createHarness(directory, { codex, claude });
  const { database, artifacts, queue } = harness;
  queue.pause();
  const current = queue.enqueue(turboInput('Current', directory, { council: false, workerThread: 'worker-current' }));
  const next = queue.enqueue(turboInput('Next', directory));
  const third = queue.enqueue(turboInput('Third', directory));
  const fourth = queue.enqueue(turboInput('Fourth', directory));
  const positions = new Map([current, next, third, fourth].map((task) => [task.title, task.position]));

  try {
    queue.resume();
    await waitFor(() => artifacts.readTurboPlan(current.id)?.status === 'executing');
    queue.schedule();
    await waitFor(() => (
      codex.plannerOrder.length === 4
      && claude.requests.length === 1
      && ['Next', 'Third', 'Fourth'].every((title) => {
        const task = database.listTasks().find((item) => item.title === title);
        return task && artifacts.readTurboPlan(task.id)?.status === 'reviewing';
      })
    ));

    assert.deepEqual(codex.plannerOrder, ['Current', 'Next', 'Third', 'Fourth']);
    assert.equal(claude.maximumActive, 1);
    assert.equal(database.getTask(current.id).status, 'running');
    assert.deepEqual(
      database.listTasks().sort((left, right) => left.id - right.id).map((task) => [task.title, task.position]),
      [...positions].sort((left, right) => left[1] - right[1]),
    );
    assert.deepEqual(codex.workerStarts.map((entry) => entry.title), ['Current']);

    for (const title of ['Next', 'Third', 'Fourth']) {
      const task = database.listTasks().find((item) => item.title === title);
      const plan = artifacts.readTurboPlan(task.id);
      assert.equal(plan.status, 'reviewing');
      const messages = database.listEvents(task.id).map((event) => event.message).join('\n');
      assert.match(messages, /Codex graph draft complete/);
      assert.match(messages, /Claude is reviewing the Codex graph/);
    }

    claude.release('Next');
    await waitFor(() => artifacts.readTurboPlan(next.id)?.status === 'ready');
    assert.deepEqual(codex.workerStarts.map((entry) => entry.title), ['Current']);
    await waitFor(() => claude.requests.some((request) => request.title === 'Third'));
    claude.release('Third');
    await waitFor(() => artifacts.readTurboPlan(third.id)?.status === 'ready');
    await waitFor(() => claude.requests.some((request) => request.title === 'Fourth'));
    claude.release('Fourth');
    await waitFor(() => artifacts.readTurboPlan(fourth.id)?.status === 'ready');

    for (const task of [next, third, fourth]) {
      assert.equal(database.getTask(task.id).status, 'queued');
      assert.equal(artifacts.readTurboPlan(task.id).council.status, 'complete');
    }
    codex.releaseCurrent();
    await waitFor(() => [current, next, third, fourth].every((task) => database.getTask(task.id).status === 'complete'));
    assert.deepEqual(codex.workerStarts.map((entry) => entry.title), ['Current', 'Next', 'Third', 'Fourth']);
    assert.ok(codex.workerStarts.slice(1).every((entry) => entry.prompt.includes('Reviewed package for')));
    assert.ok(codex.workerStarts.slice(1).every((entry) => !entry.prompt.includes('Draft package for')));
    assert.equal(claude.maximumActive, 1);

    for (const task of [next, third, fourth]) {
      const messages = database.listEvents(task.id).map((event) => event.message).join('\n');
      assert.match(messages, /Plan ready after Claude review/);
      assert.match(messages, /Dispatched reviewed-/);
      assert.match(messages, /completed reviewed-/);
    }
  } finally {
    codex.releaseCurrent();
    for (const request of claude.requests) request.gate.resolve();
    await closeHarness(harness, directory);
  }
});

test('disabled Turbo remains planner-to-ready compatible without a council reviewer', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-turbo-council-disabled-'));
  const codex = new FakeCodex();
  const artifacts = new ArtifactStore(join(directory, 'tasks'));
  const runner = new TurboRunner({ codex, artifacts });
  const task = turboInput('Disabled', directory, { council: false });
  artifacts.initializeTask(task);
  try {
    const prepared = await runner.prepare(task);
    assert.equal(prepared.status, 'ready');
    assert.equal(prepared.council, undefined);
    await runner.run(task);
    assert.equal(artifacts.readTurboPlan(task.id).status, 'complete');
    assert.deepEqual(codex.workerStarts.map((entry) => entry.title), ['Disabled']);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('invalid Claude review fails preparation before workers and queue retry succeeds', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-turbo-council-retry-'));
  const codex = new FakeCodex();
  const claude = installPendingTracking(new FakeClaude({ hold: false, invalidCount: 1 }));
  const harness = createHarness(directory, { codex, claude, retryDelayMs: 15 });
  const { database, artifacts, queue } = harness;
  queue.pause();
  const task = queue.enqueue(turboInput('Retry', directory));
  try {
    queue.resume();
    await waitFor(() => database.getTask(task.id)?.status === 'complete');
    assert.equal(claude.calls, 2);
    assert.equal(artifacts.readTurboPlan(task.id).status, 'complete');
    assert.ok(codex.workerStarts.some((entry) => entry.prompt.includes('Reviewed package for Retry')));
    const messages = database.listEvents(task.id).map((event) => event.message).join('\n');
    assert.match(messages, /Task failed/);
    assert.match(messages, /Automatic retry started/);
  } finally {
    await closeHarness(harness, directory);
  }
});

test('queued and active review cancellation stay scoped to their parent', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-turbo-council-cancel-'));
  const codex = new FakeCodex();
  const claude = installPendingTracking(new FakeClaude({ hold: true }));
  const artifacts = new ArtifactStore(join(directory, 'tasks'));
  const reviewer = new TurboPlanCouncilReviewer({ claude });
  const runner = new TurboRunner({ codex, artifacts, councilReviewer: reviewer });
  const first = turboInput('First review', directory);
  const second = turboInput('Second review', directory);
  first.id = 501;
  second.id = 502;
  artifacts.initializeTask(first);
  artifacts.initializeTask(second);
  try {
    const firstPreparation = runner.prepare(first);
    const secondPreparation = runner.prepare(second);
    await waitFor(() => claude.requests.length === 1 && artifacts.readTurboPlan(second.id)?.status === 'reviewing');
    assert.equal(runner.cancel(second.id), true);
    await assert.rejects(secondPreparation, (error) => error.cancelled === true);
    assert.equal(artifacts.readTurboPlan(first.id).status, 'reviewing');
    claude.release('First review');
    await firstPreparation;
    assert.equal(artifacts.readTurboPlan(first.id).status, 'ready');

    const active = turboInput('Active review', directory);
    active.id = 503;
    artifacts.initializeTask(active);
    const activePreparation = runner.prepare(active);
    await waitFor(() => claude.requests.some((request) => request.title === 'Active review'));
    assert.equal(runner.cancel(active.id), true);
    await assert.rejects(activePreparation, (error) => error.cancelled === true);
    assert.equal(artifacts.readTurboPlan(active.id).status, 'failed');
    assert.deepEqual(codex.workerStarts, []);
  } finally {
    for (const request of claude.requests) request.gate.resolve();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('queue shutdown cancels an active Claude review and interrupts the parent', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-turbo-council-shutdown-'));
  const codex = new FakeCodex();
  const claude = installPendingTracking(new FakeClaude({ hold: true }));
  const harness = createHarness(directory, { codex, claude });
  const { database, artifacts, queue } = harness;
  queue.pause();
  const task = queue.enqueue(turboInput('Shutdown', directory));
  try {
    queue.resume();
    await waitFor(() => artifacts.readTurboPlan(task.id)?.status === 'reviewing');
    await queue.shutdown();
    assert.equal(database.getTask(task.id).status, 'interrupted');
    assert.equal(artifacts.readTurboPlan(task.id).status, 'failed');
    assert.equal(queue.status().planningTaskIds.length, 0);
  } finally {
    for (const request of claude.requests) request.gate.resolve();
    await harness.queue.shutdown();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
