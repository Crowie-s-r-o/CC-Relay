import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ArtifactStore } from '../src/artifacts.mjs';
import { RelayDatabase } from '../src/database.mjs';
import { TaskQueue } from '../src/queue.mjs';
import { PlanRunCoordinator, planStepSubmissionId } from '../src/plan-run.mjs';

function waitFor(predicate, message = 'plan run state', timeout = 3000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - started > timeout) {
        clearInterval(timer);
        reject(new Error(`Timed out waiting for ${message}.`));
      }
    }, 5);
  });
}

// A runner whose outcome per prompt the test controls, so a step can succeed, fail
// permanently, or fail transiently into the queue's automatic retry.
class ScriptedRunner {
  constructor() {
    this.outcomes = new Map();
    this.startedPrompts = [];
  }

  fail(prompt, { retryable = false, message = 'step failed' } = {}) {
    this.outcomes.set(prompt, { error: message, retryable });
  }

  succeed(prompt) {
    this.outcomes.delete(prompt);
  }

  async run(task) {
    this.startedPrompts.push(task.prompt);
    const outcome = this.outcomes.get(task.prompt);
    if (outcome) {
      const error = new Error(outcome.error);
      error.retryable = outcome.retryable;
      throw error;
    }
    return { finalResponse: `done: ${task.prompt}`, sessionId: 'session', exitCode: 0 };
  }

  cancel() { return false; }
}

const cleanup = [];
test.after(() => {
  for (const directory of cleanup) rmSync(directory, { recursive: true, force: true });
});

function harness({ paused = false, retryDelayMs = 5000, reentrant = false, idleSessions = null } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'relay-plan-run-'));
  cleanup.push(directory);
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  const artifacts = new ArtifactStore(join(directory, 'tasks'));
  const runner = new ScriptedRunner();
  const queue = new TaskQueue({
    database,
    artifacts,
    runner,
    retryDelayMs,
    listIdleSessions: idleSessions
      ? async () => idleSessions.map((session) => ({ ...session, cwd: directory }))
      : null,
  });
  const planRuns = new PlanRunCoordinator({ database, queue });
  // The exact server glue: plan runs reconcile off the queue change signal.
  queue.on('changed', ({ taskId }) => {
    if (taskId) planRuns.reconcileForTask(taskId);
  });
  if (reentrant) {
    // Deliberately hostile: a second listener re-enters the reconciler for the whole run
    // while the first pass may still be inside its enqueue loop.
    queue.on('changed', () => {
      for (const run of database.activePlanRuns()) planRuns.reconcile(run.id);
    });
  }
  if (paused) database.setPaused(true);
  return { directory, database, artifacts, queue, runner, planRuns };
}

function startRun(context, { dependsOn = {}, titles = ['A', 'B', 'C'], preferIdleTerminal = true } = {}) {
  const { database, planRuns, directory } = context;
  const plan = database.createPlan({ repoPath: directory, name: 'Auth', content: 'brief' });
  const proposals = titles.map((title) => ({
    id: `step-${title.toLowerCase()}`,
    title,
    prompt: `Do ${title}`,
    dependsOn: (dependsOn[title] || []).map((name) => `step-${name.toLowerCase()}`),
  }));
  const run = planRuns.start({
    plan,
    proposals,
    thread: { id: 'relay-a', title: 'CC Relay 1', source: 'cli', cwd: directory },
    provider: 'codex',
    preferIdleTerminal,
    model: 'sol',
    effort: 'high',
  });
  return { plan, run, proposals };
}

function stepsByTitle(context, planId) {
  const view = context.planRuns.view(planId);
  return new Map(view.steps.map((step) => [step.title, step]));
}

function completeTask(context, taskId) {
  context.database.updateTask(taskId, { status: 'complete', result: 'ok', error: null });
  context.queue.changed(taskId);
}

test('a run enqueues only the steps whose dependencies are satisfied', () => {
  const context = harness({ paused: true });
  const { plan } = startRun(context, { dependsOn: { B: ['A'], C: ['A'] } });
  try {
    // Wave one is exactly the root step.
    const tasks = context.database.listTasks();
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].title, 'A');
    const steps = stepsByTitle(context, plan.id);
    assert.equal(steps.get('A').status, 'queued');
    assert.equal(steps.get('B').status, 'waiting');
    assert.equal(steps.get('C').status, 'waiting');
    assert.equal(context.planRuns.view(plan.id).status, 'running');
  } finally {
    context.database.close();
  }
});

test('an automatic plan run gives each released step a disposable provider slot', () => {
  const context = harness({ paused: true });
  try {
    const plan = context.database.createPlan({
      repoPath: context.directory,
      name: 'Automatic run',
      content: 'brief',
    });
    context.planRuns.start({
      plan,
      proposals: [{ id: 'step-a', title: 'A', prompt: 'Do A', dependsOn: [] }],
      thread: {
        id: null,
        title: 'Automatic Codex instance',
        source: 'CC Relay managed terminal pool',
        cwd: context.directory,
      },
      sessionId: 'automatic:codex',
      provider: 'codex',
      terminalLifecycle: 'disposable',
      keepTerminalOpen: true,
      terminalLayout: { enabled: false, background: true },
      model: 'sol',
      effort: 'high',
    });

    const run = context.database.latestPlanRun(plan.id);
    const [task] = context.database.listTasks();
    assert.equal(run.session_id, 'automatic:codex');
    assert.equal(run.terminal_lifecycle, 'disposable');
    assert.equal(run.keep_terminal_open, true);
    assert.deepEqual(run.terminal_layout, { enabled: false, background: true });
    assert.equal(task.thread_id, null);
    assert.equal(task.repo_path, context.directory);
    assert.equal(task.terminal_lifecycle, 'disposable');
    assert.equal(task.keep_terminal_open, true);
    assert.deepEqual(task.terminal_layout, { enabled: false, background: true });
  } finally {
    context.database.close();
  }
});

test('completing a step releases every dependent in one wave and carries idle routing', () => {
  const context = harness({ paused: true });
  const { plan } = startRun(context, { dependsOn: { B: ['A'], C: ['A'] } });
  try {
    const [rootTask] = context.database.listTasks();
    completeTask(context, rootTask.id);

    const tasks = context.database.listTasks();
    assert.equal(tasks.length, 3, 'both dependents were released at once');
    const released = tasks.filter((task) => task.title !== 'A');
    assert.deepEqual(released.map((task) => task.title).sort(), ['B', 'C']);
    // Independent steps must be able to fan out across idle same-workspace sessions.
    assert.ok(released.every((task) => task.prefer_idle_terminal === 1));
    assert.ok(released.every((task) => task.mode === 'execute' && task.provider === 'codex'));
    assert.ok(released.every((task) => task.model === 'sol' && task.effort === 'high'));
    const steps = stepsByTitle(context, plan.id);
    assert.equal(steps.get('A').status, 'complete');
    assert.equal(steps.get('B').status, 'queued');
    assert.equal(steps.get('C').status, 'queued');
  } finally {
    context.database.close();
  }
});

test('a chain releases one step at a time', () => {
  const context = harness({ paused: true });
  const { plan } = startRun(context, { dependsOn: { B: ['A'], C: ['B'] } });
  try {
    const titles = () => context.database.listTasks().map((task) => task.title).sort();
    assert.deepEqual(titles(), ['A']);
    completeTask(context, context.database.listTasks()[0].id);
    assert.deepEqual(titles(), ['A', 'B']);
    const second = context.database.listTasks().find((task) => task.title === 'B');
    completeTask(context, second.id);
    assert.deepEqual(titles(), ['A', 'B', 'C']);
    assert.equal(stepsByTitle(context, plan.id).get('C').status, 'queued');
  } finally {
    context.database.close();
  }
});

test('repeated and re-entrant reconciles never double-enqueue a step', () => {
  const context = harness({ paused: true, reentrant: true });
  const { plan, run } = startRun(context, { dependsOn: { B: ['A'], C: ['A'] } });
  try {
    for (let attempt = 0; attempt < 5; attempt += 1) context.planRuns.reconcile(run.id);
    assert.equal(context.database.listTasks().length, 1);

    completeTask(context, context.database.listTasks()[0].id);
    for (let attempt = 0; attempt < 5; attempt += 1) context.planRuns.reconcile(run.id);
    context.planRuns.reconcileAll();

    const tasks = context.database.listTasks();
    assert.equal(tasks.length, 3, 'exactly one task per step');
    assert.equal(new Set(tasks.map((task) => task.title)).size, 3);
    // Every step task carries its deterministic submission id, which is what makes the
    // queue's existing idempotency guard collapse a repeated enqueue onto one task.
    for (const step of context.planRuns.view(plan.id).steps) {
      const claimed = context.database.getTaskBySubmissionId(
        planStepSubmissionId({ planId: plan.id, runId: run.id, proposalId: step.proposalId }),
      );
      assert.equal(claimed?.id, step.taskId);
    }
  } finally {
    context.database.close();
  }
});

test('a step whose task row was deleted fails instead of being enqueued again', () => {
  const context = harness({ paused: true });
  const { plan, run } = startRun(context, { dependsOn: { B: ['A'] }, titles: ['A', 'B'] });
  try {
    const [rootTask] = context.database.listTasks();
    context.database.deleteTask(rootTask.id);
    context.planRuns.reconcile(run.id);

    assert.equal(context.database.listTasks().length, 0, 'the deleted task is not resurrected');
    const steps = stepsByTitle(context, plan.id);
    assert.equal(steps.get('A').status, 'failed');
    assert.equal(steps.get('B').status, 'blocked');
    assert.equal(context.planRuns.view(plan.id).status, 'failed');
  } finally {
    context.database.close();
  }
});

test('a failed step blocks its transitive dependents and fails the run', async () => {
  const context = harness();
  const { plan } = startRun(context, { dependsOn: { B: ['A'], C: ['B'] } });
  try {
    context.runner.fail('Do A', { retryable: false });
    await waitFor(() => context.planRuns.view(plan.id).status === 'failed', 'the run to fail');
    const steps = stepsByTitle(context, plan.id);
    assert.equal(steps.get('A').status, 'failed');
    assert.equal(steps.get('B').status, 'blocked');
    assert.equal(steps.get('C').status, 'blocked');
    assert.equal(context.database.listTasks().length, 1, 'nothing downstream was enqueued');
    const counts = context.planRuns.view(plan.id).counts;
    assert.equal(counts.failed, 1);
    assert.equal(counts.blocked, 2);
  } finally {
    context.database.close();
  }
});

test('a failure with an automatic retry scheduled reads as retrying, not failed', async () => {
  const context = harness({ retryDelayMs: 60_000 });
  const { plan } = startRun(context, { dependsOn: { B: ['A'] }, titles: ['A', 'B'] });
  try {
    context.runner.fail('Do A', { retryable: true, message: 'session dropped mid-turn' });
    await waitFor(
      () => context.queue.pendingRetryTaskIds().size === 1,
      'the automatic retry to be scheduled',
    );
    context.planRuns.reconcileAll();
    const steps = stepsByTitle(context, plan.id);
    assert.equal(steps.get('A').status, 'retrying');
    // The queue owns the retry, so the dependent waits rather than blocking.
    assert.equal(steps.get('B').status, 'waiting');
    assert.equal(context.planRuns.view(plan.id).status, 'running');
  } finally {
    for (const taskId of context.queue.pendingRetryTaskIds()) context.queue.clearAutoRetry(taskId);
    context.database.close();
  }
});

test('retrying a failed step re-arms it and un-blocks its dependents', async () => {
  const context = harness();
  const { plan } = startRun(context, { dependsOn: { B: ['A'], C: ['B'] } });
  try {
    context.runner.fail('Do A', { retryable: false });
    await waitFor(() => context.planRuns.view(plan.id).status === 'failed', 'the run to fail');
    const failedStep = stepsByTitle(context, plan.id).get('A');

    context.runner.succeed('Do A');
    context.queue.retry(failedStep.taskId);

    await waitFor(() => context.planRuns.view(plan.id).status === 'complete', 'the run to recover');
    const steps = stepsByTitle(context, plan.id);
    assert.deepEqual(
      ['A', 'B', 'C'].map((title) => steps.get(title).status),
      ['complete', 'complete', 'complete'],
    );
    assert.equal(context.database.listTasks().length, 3);
  } finally {
    context.database.close();
  }
});

test('a run drives every step to completion through the ordinary queue', async () => {
  const context = harness();
  const { plan } = startRun(context, { dependsOn: { B: ['A'], C: ['A'] } });
  try {
    await waitFor(() => context.planRuns.view(plan.id).status === 'complete', 'the run to complete');
    const view = context.planRuns.view(plan.id);
    assert.equal(view.counts.complete, 3);
    assert.equal(view.finishedAt !== null, true);
    // The root always ran first; the two dependents ran after it.
    assert.equal(context.runner.startedPrompts[0], 'Do A');
    assert.deepEqual(context.runner.startedPrompts.slice(1).sort(), ['Do B', 'Do C']);
    assert.ok(context.database.listTasks().every((task) => task.status === 'complete'));
  } finally {
    context.database.close();
  }
});

test('two independent steps really land on two different idle sessions', async () => {
  // The mandate's headline claim: independent steps run at the same time. Only dispatch-time
  // idle routing can do that, and it is inert unless the queue has listIdleSessions, so this
  // is the one test that proves fan-out rather than the persisted flag.
  const held = new Map();
  const context = harness({
    idleSessions: [
      { id: 'relay-a', title: 'CC Relay 1', source: 'cli', status: 'idle' },
      { id: 'relay-b', title: 'CC Relay 2', source: 'cli', status: 'idle' },
    ],
  });
  // Hold both dependent steps open so their concurrency is observable.
  context.runner.run = (task) => new Promise((resolve) => {
    held.set(task.title, () => resolve({ finalResponse: 'ok', sessionId: 'session', exitCode: 0 }));
  });
  const { plan } = startRun(context, { dependsOn: { B: ['A'], C: ['A'] } });
  try {
    await waitFor(() => held.has('A'), 'the root step to start');
    held.get('A')();

    await waitFor(
      () => context.database.listTasks().filter((task) => task.status === 'running').length === 2,
      'both dependent steps to run at once',
    );
    const running = context.database.listTasks().filter((task) => task.status === 'running');
    assert.deepEqual(running.map((task) => task.title).sort(), ['B', 'C']);
    assert.equal(
      new Set(running.map((task) => task.thread_id)).size,
      2,
      'the two independent steps hold two different sessions',
    );
    assert.equal(context.planRuns.view(plan.id).counts.running, 2);
  } finally {
    for (const release of held.values()) release();
    context.database.close();
  }
});

test('two overlapping run submissions mint exactly one set of tasks (C4)', () => {
  const context = harness({ paused: true });
  try {
    const plan = context.database.createPlan({ repoPath: context.directory, name: 'Race', content: '' });
    const proposals = [
      { id: 'step-a', title: 'A', prompt: 'Do A', dependsOn: [] },
      { id: 'step-b', title: 'B', prompt: 'Do B', dependsOn: [] },
    ];
    const request = () => ({
      plan,
      proposals,
      thread: { id: 'relay-a', title: 'CC Relay 1', source: 'cli', cwd: context.directory },
      provider: 'codex',
    });

    // Both submissions cleared the route's early guard before either one wrote anything,
    // which is exactly what the awaits on the request body, the live session, and the model
    // list make possible. The guard inside start() is what decides.
    const first = context.planRuns.start(request());
    assert.throws(
      () => context.planRuns.start(request()),
      (error) => error.statusCode === 409 && /already has a run in progress/.test(error.message),
      'the second submission is refused with a conflict',
    );

    assert.equal(context.database.listTasks().length, 2, 'one task per step, not two sets');
    assert.deepEqual(context.database.listTasks().map((task) => task.title).sort(), ['A', 'B']);
    assert.deepEqual(context.database.planRunsForPlan(plan.id).map((run) => run.id), [first.id]);
    assert.equal(context.database.getPlanRun(first.id).status, 'running', 'the live run was not latched');
  } finally {
    context.database.close();
  }
});

test('a refused start leaves the previous run untouched', () => {
  const context = harness({ paused: true });
  const { plan, run } = startRun(context, { dependsOn: { B: ['A'] }, titles: ['A', 'B'] });
  try {
    context.planRuns.stop(plan.id);
    assert.throws(
      () => context.planRuns.start({
        plan,
        proposals: [{ id: 'step-a', title: 'A', prompt: 'Do A', dependsOn: [] }],
        thread: { id: 'relay-a', title: 'CC Relay 1', source: 'cli', cwd: context.directory },
        provider: 'codex',
      }),
      (error) => error.statusCode === 409 && /still has 1 step in flight/.test(error.message),
    );
    // No second run row, and the stopped run keeps its steps and its task.
    assert.deepEqual(context.database.planRunsForPlan(plan.id).map((item) => item.id), [run.id]);
    assert.equal(context.database.listTasks().length, 1);
    assert.equal(context.planRuns.view(plan.id).status, 'stopped');
  } finally {
    context.database.close();
  }
});

test('the in-flight check reads live task state, not the stored step row', () => {
  const context = harness({ paused: true });
  const { plan, run } = startRun(context, { titles: ['A'] });
  try {
    const [task] = context.database.listTasks();
    // A stale step row claims the step finished while its task is still queued.
    context.database.updatePlanRunStep(context.database.planRunSteps(run.id)[0].id, { status: 'complete' });
    assert.deepEqual(context.planRuns.stepsInFlight(plan.id).map((step) => step.title), ['A']);

    context.database.updateTask(task.id, { status: 'complete', result: 'ok' });
    assert.deepEqual(context.planRuns.stepsInFlight(plan.id), []);
  } finally {
    context.database.close();
  }
});

test('a new run is refused while the stopped run still has steps in flight', () => {
  const context = harness({ paused: true });
  const { plan } = startRun(context, { dependsOn: { B: ['A'] }, titles: ['A', 'B'] });
  try {
    context.planRuns.stop(plan.id);
    // Stop leaves the queued step alone, so a second run would mint a second task for the
    // same prompt: its submission id is keyed on the run id and cannot collapse them.
    assert.deepEqual(context.planRuns.stepsInFlight(plan.id).map((step) => step.title), ['A']);

    // Cancelling the leftover step clears the way.
    const [task] = context.database.listTasks();
    context.queue.cancel(task.id);
    context.planRuns.reconcilePlan(plan.id);
    assert.deepEqual(context.planRuns.stepsInFlight(plan.id), []);
  } finally {
    context.database.close();
  }
});

test('a finished run reports nothing in flight', async () => {
  const context = harness();
  const { plan } = startRun(context, { dependsOn: { B: ['A'] }, titles: ['A', 'B'] });
  try {
    await waitFor(() => context.planRuns.view(plan.id).status === 'complete', 'the run to finish');
    assert.deepEqual(context.planRuns.stepsInFlight(plan.id), []);
  } finally {
    context.database.close();
  }
});

test('deleting a plan releases every run, not only the latest', () => {
  const context = harness({ paused: true });
  const { plan, run } = startRun(context, { titles: ['A'] });
  try {
    const firstTask = context.database.listTasks()[0];
    // The reachable path to a latched run owning live work: its step failed, the user
    // started a new run, and only then retried the old task from Task Activity.
    context.database.updateTask(firstTask.id, { status: 'failed', error: 'step failed' });
    context.planRuns.reconcile(run.id);
    assert.equal(context.database.getPlanRun(run.id).status, 'failed');

    context.planRuns.start({
      plan,
      proposals: [{ id: 'step-z', title: 'Z', prompt: 'Do Z', dependsOn: [] }],
      thread: { id: 'relay-a', title: 'CC Relay 1', source: 'cli', cwd: context.directory },
      provider: 'codex',
    });
    const secondTask = context.database.listTasks().find((task) => task.title === 'Z');
    context.queue.retry(firstTask.id);
    assert.equal(context.database.getTask(firstTask.id).status, 'queued');

    context.planRuns.release(plan.id);
    // The older latched run's queued step must not survive the delete unowned.
    assert.equal(context.database.getTask(firstTask.id).status, 'cancelled');
    assert.equal(context.database.getTask(secondTask.id).status, 'cancelled');
  } finally {
    context.database.close();
  }
});

test('stop enqueues nothing further, leaves running work alone, and stays stopped', () => {
  const context = harness({ paused: true });
  const { plan, run } = startRun(context, { dependsOn: { B: ['A'], C: ['A'] } });
  try {
    const [rootTask] = context.database.listTasks();
    const stopped = context.planRuns.stop(plan.id);
    assert.equal(stopped.status, 'stopped');

    // The already-queued step is untouched and still individually cancellable.
    assert.equal(context.database.getTask(rootTask.id).status, 'queued');
    completeTask(context, rootTask.id);

    assert.equal(context.database.listTasks().length, 1, 'no further steps were enqueued');
    const view = context.planRuns.view(plan.id);
    assert.equal(view.status, 'stopped', 'stopped is latched, not derived');
    // Counts still track the drain.
    assert.equal(view.counts.complete, 1);
    assert.equal(view.counts.waiting, 2);

    // Idempotent: a second stop during the drain is a no-op, never an error.
    assert.equal(context.planRuns.stop(plan.id).status, 'stopped');
    context.planRuns.reconcile(run.id);
    assert.equal(context.planRuns.view(plan.id).status, 'stopped');
  } finally {
    context.database.close();
  }
});

test('stop reports nothing to stop when the plan never ran', () => {
  const context = harness({ paused: true });
  try {
    const plan = context.database.createPlan({ repoPath: context.directory, name: 'Empty', content: '' });
    assert.equal(context.planRuns.stop(plan.id), null);
  } finally {
    context.database.close();
  }
});

test('starting a new run latches the previous one so only one is ever active', () => {
  const context = harness({ paused: true });
  const { plan, run } = startRun(context, { dependsOn: { B: ['A'] }, titles: ['A', 'B'] });
  try {
    // Drain the previous run first: a new run is refused while it still owns live work.
    const [firstTask] = context.database.listTasks();
    context.queue.cancel(firstTask.id);
    context.planRuns.reconcile(run.id);

    const second = context.planRuns.start({
      plan,
      proposals: [{ id: 'step-a', title: 'A', prompt: 'Do A', dependsOn: [] }],
      thread: { id: 'relay-a', title: 'CC Relay 1', source: 'cli', cwd: context.directory },
      provider: 'codex',
    });
    assert.notEqual(second.id, run.id);
    assert.equal(context.database.getPlanRun(run.id).status, 'stopped');
    assert.equal(context.database.activePlanRuns().length, 1);
    assert.equal(context.planRuns.view(plan.id).id, second.id, 'the latest run is the one returned');
  } finally {
    context.database.close();
  }
});

test('after a restart an interrupted step fails and blocks its dependents', () => {
  const first = harness({ paused: true });
  const { plan, run } = startRun(first, { dependsOn: { B: ['A'], C: ['B'] } });
  const [rootTask] = first.database.listTasks();
  // CC Relay was running this step when it stopped.
  first.database.updateTask(rootTask.id, { status: 'running' });
  first.database.close();

  // A fresh process over the same data directory.
  const database = new RelayDatabase(join(first.directory, 'relay.sqlite'));
  const artifacts = new ArtifactStore(join(first.directory, 'tasks'));
  const runner = new ScriptedRunner();
  const queue = new TaskQueue({ database, artifacts, runner });
  const planRuns = new PlanRunCoordinator({ database, queue });
  try {
    database.setPaused(true);
    const recovered = database.recoverInterruptedTasks();
    assert.equal(recovered, 1);
    assert.equal(database.getTask(rootTask.id).status, 'interrupted');

    planRuns.reconcileAll();
    const steps = new Map(planRuns.view(plan.id).steps.map((step) => [step.title, step]));
    assert.equal(steps.get('A').status, 'failed');
    assert.equal(steps.get('B').status, 'blocked');
    assert.equal(steps.get('C').status, 'blocked');
    assert.equal(database.getPlanRun(run.id).status, 'failed');
    assert.equal(database.listTasks().length, 1, 'reconciliation enqueued nothing new');
  } finally {
    database.close();
  }
});

test('after a restart a completed step releases the next wave', () => {
  const first = harness({ paused: true });
  const { plan } = startRun(first, { dependsOn: { B: ['A'], C: ['A'] } });
  const [rootTask] = first.database.listTasks();
  // The step finished, but CC Relay stopped before the run could react to it.
  first.database.updateTask(rootTask.id, { status: 'complete', result: 'ok' });
  first.database.close();

  const database = new RelayDatabase(join(first.directory, 'relay.sqlite'));
  const artifacts = new ArtifactStore(join(first.directory, 'tasks'));
  const queue = new TaskQueue({ database, artifacts, runner: new ScriptedRunner() });
  const planRuns = new PlanRunCoordinator({ database, queue });
  try {
    database.setPaused(true);
    database.recoverInterruptedTasks();
    planRuns.reconcileAll();
    assert.deepEqual(
      database.listTasks().map((task) => task.title).sort(),
      ['A', 'B', 'C'],
      'the missed wave is repaired on boot',
    );
    assert.equal(planRuns.view(plan.id).status, 'running');
  } finally {
    database.close();
  }
});

test('a stopped run enqueues nothing when it is reconciled after a restart', () => {
  const first = harness({ paused: true });
  const { plan } = startRun(first, { dependsOn: { B: ['A'] }, titles: ['A', 'B'] });
  first.planRuns.stop(plan.id);
  const [rootTask] = first.database.listTasks();
  first.database.updateTask(rootTask.id, { status: 'complete', result: 'ok' });
  first.database.close();

  const database = new RelayDatabase(join(first.directory, 'relay.sqlite'));
  const artifacts = new ArtifactStore(join(first.directory, 'tasks'));
  const queue = new TaskQueue({ database, artifacts, runner: new ScriptedRunner() });
  const planRuns = new PlanRunCoordinator({ database, queue });
  try {
    database.setPaused(true);
    planRuns.reconcileAll();
    assert.equal(database.listTasks().length, 1);
    assert.equal(planRuns.view(plan.id).status, 'stopped');
  } finally {
    database.close();
  }
});

test('a step that was enqueued but never linked is adopted, not enqueued twice', () => {
  const context = harness({ paused: true });
  const { plan, run } = startRun(context, { titles: ['A'] });
  try {
    const [task] = context.database.listTasks();
    // Reproduce a crash between queue.enqueue and the task_id write.
    const [row] = context.database.planRunSteps(run.id);
    context.database.updatePlanRunStep(row.id, { task_id: null, status: 'waiting' });

    context.planRuns.reconcile(run.id);
    assert.equal(context.database.listTasks().length, 1, 'the orphaned task is adopted');
    assert.equal(context.planRuns.view(plan.id).steps[0].taskId, task.id);
  } finally {
    context.database.close();
  }
});

test('a restart repairs steps left in flight by a run that is not running', () => {
  const first = harness({ paused: true });
  const { plan } = startRun(first, { dependsOn: { B: ['A'], C: ['A'] } });
  const [rootTask] = first.database.listTasks();
  first.database.updateTask(rootTask.id, { status: 'running' });
  // The user stopped the run while its first step was still executing.
  first.planRuns.stop(plan.id);
  first.database.close();

  const database = new RelayDatabase(join(first.directory, 'relay.sqlite'));
  const artifacts = new ArtifactStore(join(first.directory, 'tasks'));
  const queue = new TaskQueue({ database, artifacts, runner: new ScriptedRunner() });
  const planRuns = new PlanRunCoordinator({ database, queue });
  try {
    database.setPaused(true);
    database.recoverInterruptedTasks();
    // A stopped run is skipped by the active-run query, so reconciliation has to find it
    // through its unsettled steps or the step row stays stale forever.
    planRuns.reconcileAll();
    const view = planRuns.view(plan.id);
    assert.equal(view.status, 'stopped');
    assert.equal(view.steps.find((step) => step.title === 'A').status, 'failed');
    assert.equal(view.steps.find((step) => step.title === 'B').status, 'blocked');
    assert.equal(database.listTasks().length, 1);
  } finally {
    database.close();
  }
});

test('a dependency on an unselected proposal is pruned when the run starts', () => {
  const context = harness({ paused: true });
  try {
    const plan = context.database.createPlan({ repoPath: context.directory, name: 'Partial', content: '' });
    // The user selected only the second step, whose dependency was left out.
    const run = context.planRuns.start({
      plan,
      proposals: [{ id: 'b', title: 'B', prompt: 'Do B', dependsOn: ['a'] }],
      thread: { id: 'relay-a', title: 'CC Relay 1', source: 'cli', cwd: context.directory },
      provider: 'codex',
    });
    const [step] = context.database.planRunSteps(run.id);
    assert.deepEqual(step.dependsOn, [], 'a dependency outside the run cannot gate it');
    assert.equal(context.database.listTasks().length, 1, 'the step still starts');
  } finally {
    context.database.close();
  }
});

test('the run view reports the shape the interface renders', () => {
  const context = harness({ paused: true });
  const { plan } = startRun(context, { dependsOn: { B: ['A'], C: ['A'] } });
  try {
    const view = context.planRuns.view(plan.id);
    assert.equal(view.planId, plan.id);
    assert.equal(view.status, 'running');
    assert.equal(view.provider, 'codex');
    assert.equal(view.sessionId, 'relay-a');
    assert.equal(view.preferIdleTerminal, true);
    assert.equal(view.counts.total, 3);
    assert.equal(view.steps.length, 3);
    const [first] = view.steps;
    assert.deepEqual(Object.keys(first).sort(), [
      'dependsOn', 'error', 'position', 'proposalId', 'status', 'taskId', 'title',
    ]);
    assert.deepEqual(view.steps.map((step) => step.position), [1, 2, 3]);
    assert.deepEqual(view.steps[1].dependsOn, ['step-a']);
    const summary = context.planRuns.summary(plan.id);
    assert.deepEqual(Object.keys(summary).sort(), ['counts', 'id', 'status', 'updatedAt']);
  } finally {
    context.database.close();
  }
});
