import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { ArtifactStore } from '../src/artifacts.mjs';
import { RelayDatabase } from '../src/database.mjs';
import { TaskQueue } from '../src/queue.mjs';
import {
  buildTaskDiffSummary,
  captureTaskDiffBaseline,
  clearTaskDiffCaches,
  maybeCaptureTaskDiffEnd,
} from '../src/task-diff.mjs';

const execFile = promisify(execFileCallback);

const missingConfig = join(tmpdir(), 'relay-task-diff-absent-gitconfig');
process.env.GIT_CONFIG_GLOBAL = missingConfig;
process.env.GIT_CONFIG_SYSTEM = missingConfig;

function waitFor(predicate, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - started > timeout) {
        clearInterval(timer);
        reject(new Error('Timed out waiting for queue state.'));
      }
    }, 10);
  });
}

async function gitAvailable() {
  try {
    await execFile('git', ['--version'], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

const gitSkip = (await gitAvailable()) ? false : 'git is not installed on this machine';

// The project lives beside the relay database, never inside it, so the diff of a fixture
// project holds only the files a task touched.
async function gitRepository(parent) {
  const root = join(parent, 'project');
  mkdirSync(root, { recursive: true });
  const environment = {
    ...process.env,
    GIT_AUTHOR_NAME: 'relay-test',
    GIT_AUTHOR_EMAIL: 'relay-test@example.invalid',
    GIT_COMMITTER_NAME: 'relay-test',
    GIT_COMMITTER_EMAIL: 'relay-test@example.invalid',
  };
  writeFileSync(join(root, 'tracked.txt'), 'first\nsecond\n');
  await execFile('git', ['init', '-q', '.'], { cwd: root, env: environment, timeout: 20_000 });
  await execFile('git', ['add', '-A'], { cwd: root, env: environment, timeout: 20_000 });
  await execFile('git', ['commit', '-q', '-m', 'fixture'], { cwd: root, env: environment, timeout: 20_000 });
  return root;
}

function thread(id, cwd) {
  return { id, title: `Session ${id}`, source: 'cli', cwd };
}

function context(directory) {
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  const artifacts = new ArtifactStore(join(directory, 'tasks'));
  return { database, artifacts };
}

test('a task start captures the baseline once and the diff goes live', { skip: gitSkip }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-diff-capture-'));
  const project = await gitRepository(directory);
  const { database, artifacts } = context(directory);
  const runner = {
    async run(task) {
      // The snapshot is started at begin and not awaited, so it races the provider's first
      // write. A real provider loses that race by a wide margin: it has to start a CLI and
      // wait for a model before it can touch a file. This fixture waits for the same reason,
      // so the assertions below describe ordering rather than machine speed.
      await waitFor(() => Boolean(database.getTask(task.id).diffState?.baseline));
      writeFileSync(join(project, 'tracked.txt'), 'first\nchanged by the task\n');
      writeFileSync(join(project, 'created.txt'), 'new file\n');
      return { finalResponse: `Finished ${task.title}`, sessionId: `session-${task.id}`, exitCode: 0 };
    },
    cancel() {
      return false;
    },
  };
  const queue = new TaskQueue({ database, artifacts, runner });

  try {
    clearTaskDiffCaches();
    const task = queue.enqueue({ title: 'Edit', prompt: 'Edit', thread: thread('relay-diff', project) });
    await waitFor(() => database.getTask(task.id).status === 'complete');
    // The capture is started at begin and not awaited, so it lands shortly after the status.
    await waitFor(() => Boolean(database.getTask(task.id).diffState?.baseline));

    const completed = database.getTask(task.id);
    assert.ok(completed.diffState, 'the row carries diff state after a start');
    assert.ok(completed.diffState.baseline.tree, 'the baseline holds a tree hash');
    assert.equal(completed.diffState.error, null);
    assert.equal(completed.diffState.end, null, 'the end tree is only captured by the change listener');

    // The queue reached a terminal status, which is what the server listener reacts to.
    assert.equal(await maybeCaptureTaskDiffEnd({ database, task: database.getTask(task.id) }), true);
    const frozen = database.getTask(task.id);
    assert.ok(frozen.diffState.end.tree);
    assert.notEqual(frozen.diffState.end.tree, frozen.diffState.baseline.tree);

    // Idempotent: a second change event for the same terminal task captures nothing new.
    assert.equal(await maybeCaptureTaskDiffEnd({ database, task: frozen }), false);
    assert.equal(database.getTask(task.id).diffState.end.at, frozen.diffState.end.at);

    clearTaskDiffCaches();
    const summary = await buildTaskDiffSummary({ database, task: database.getTask(task.id) });
    assert.equal(summary.available, true);
    assert.equal(summary.live, false);
    assert.deepEqual(summary.files.map((file) => file.path).sort(), ['created.txt', 'tracked.txt']);
  } finally {
    clearTaskDiffCaches();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a re-begin keeps the original baseline and clears the frozen end', { skip: gitSkip }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-diff-rebegin-'));
  const project = await gitRepository(directory);
  const { database, artifacts } = context(directory);
  // The queue starts the capture without awaiting it, so the test holds the promise the queue
  // fired and waits on that. This also proves the injection point the queue exposes.
  const captures = [];
  const queue = new TaskQueue({
    database,
    artifacts,
    runner: { run() {}, cancel() { return false; } },
    captureDiffBaseline: (options) => {
      const promise = captureTaskDiffBaseline(options);
      captures.push(promise);
      return promise;
    },
  });

  try {
    clearTaskDiffCaches();
    queue.pause();
    const task = queue.enqueue({ title: 'Repeat', prompt: 'Repeat', thread: thread('relay-rebegin', project) });

    queue.beginTask(database.getTask(task.id));
    await captures.at(-1);
    const first = database.getTask(task.id).diffState;
    assert.ok(first.baseline.tree);

    writeFileSync(join(project, 'tracked.txt'), 'first\nchanged once\n');
    database.updateTask(task.id, { status: 'complete', finished_at: new Date().toISOString() });
    clearTaskDiffCaches();
    assert.equal(await maybeCaptureTaskDiffEnd({ database, task: database.getTask(task.id) }), true);
    const frozen = database.getTask(task.id).diffState;
    assert.ok(frozen.end.tree);

    // A follow-up or a retry runs the same task again. The question the preview answers is
    // still "what did this task change", so the first baseline has to survive.
    writeFileSync(join(project, 'tracked.txt'), 'first\nchanged twice\n');
    clearTaskDiffCaches();
    queue.beginTask(database.getTask(task.id));
    await captures.at(-1);
    const second = database.getTask(task.id).diffState;
    assert.deepEqual(second.baseline, first.baseline, 'the original baseline is untouched');
    assert.equal(second.end, null, 're-begin puts the diff back on the live tree');
    assert.equal(database.getTask(task.id).status, 'running');
  } finally {
    clearTaskDiffCaches();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a project without git records the failure and still runs the task', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-diff-nogit-'));
  const { database, artifacts } = context(directory);
  const project = join(directory, 'project');
  const runner = {
    async run(task) {
      return { finalResponse: `Finished ${task.title}`, sessionId: `session-${task.id}`, exitCode: 0 };
    },
    cancel() {
      return false;
    },
  };
  const queue = new TaskQueue({ database, artifacts, runner });

  try {
    clearTaskDiffCaches();
    const task = queue.enqueue({ title: 'No git', prompt: 'Run', thread: thread('relay-nogit', project) });
    await waitFor(() => database.getTask(task.id).status === 'complete');
    await waitFor(() => Boolean(database.getTask(task.id).diffState?.error));

    const completed = database.getTask(task.id);
    assert.equal(completed.status, 'complete', 'a capture failure never blocks the task');
    assert.equal(completed.diffState.baseline, null);
    assert.equal(completed.diffState.error.code, 'not-a-git-repository');
    assert.ok(completed.diffState.error.at);

    // A capture failure must not add task events, which the rest of the suite asserts on.
    const messages = database.listEvents(task.id).map((event) => event.message);
    assert.equal(messages.some((message) => /diff|baseline|git/i.test(message)), false);

    const summary = await buildTaskDiffSummary({ database, task: completed });
    assert.equal(summary.available, false);
    assert.equal(summary.reason, 'not-a-git-repository');
    assert.deepEqual(summary.files, []);
    assert.equal(summary.totalAdditions, 0);
    assert.equal(summary.totalDeletions, 0);
    assert.equal(typeof summary.signature, 'string');
  } finally {
    clearTaskDiffCaches();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a task that never started and a legacy row both read as no diff state', () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-diff-legacy-'));
  const { database, artifacts } = context(directory);
  const queue = new TaskQueue({
    database,
    artifacts,
    runner: { run() {}, cancel() { return false; } },
  });

  try {
    queue.pause();
    const task = queue.enqueue({ title: 'Queued', prompt: 'Wait', thread: thread('relay-queued', directory) });
    assert.equal(database.getTask(task.id).diffState, null);

    // A row written before this column existed, and a row whose state cannot be parsed.
    database.updateTask(task.id, { diff_state_json: 'not json at all' });
    assert.equal(database.getTask(task.id).diffState, null);
    database.updateTask(task.id, { diff_state_json: JSON.stringify({ version: 1, root: null }) });
    assert.equal(database.getTask(task.id).diffState, null);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('the baseline capture never rejects and never touches a task it cannot find', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-diff-guard-'));
  const { database } = context(directory);

  try {
    clearTaskDiffCaches();
    assert.equal(await captureTaskDiffBaseline({ database, taskId: 4242 }), null);
    assert.equal(await captureTaskDiffBaseline({
      database: {
        getTask() {
          throw new Error('database is gone');
        },
        updateTask() {
          throw new Error('database is gone');
        },
      },
      taskId: 1,
    }), null);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('overlapping tasks in one project are counted for the shared tree warning', () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-diff-shared-'));
  const { database, artifacts } = context(directory);
  const queue = new TaskQueue({
    database,
    artifacts,
    runner: { run() {}, cancel() { return false; } },
  });

  try {
    queue.pause();
    const mine = queue.enqueue({ title: 'Mine', prompt: 'One', thread: thread('relay-mine', directory) });
    const neighbour = queue.enqueue({ title: 'Neighbour', prompt: 'Two', thread: thread('relay-neighbour', directory) });
    const elsewhere = queue.enqueue({ title: 'Elsewhere', prompt: 'Three', thread: thread('relay-elsewhere', join(directory, 'other')) });

    database.updateTask(mine.id, { status: 'complete', started_at: '2026-08-13T10:00:00.000Z', finished_at: '2026-08-13T11:00:00.000Z' });
    database.updateTask(neighbour.id, { status: 'complete', started_at: '2026-08-13T10:30:00.000Z', finished_at: '2026-08-13T10:45:00.000Z' });
    database.updateTask(elsewhere.id, { status: 'running', started_at: '2026-08-13T10:30:00.000Z', finished_at: null });

    assert.equal(database.countOverlappingRepoTasks(directory, {
      excludeTaskId: mine.id,
      from: '2026-08-13T10:00:00.000Z',
      to: '2026-08-13T11:00:00.000Z',
    }), 1, 'only the task that shared the window in the same project counts');

    assert.equal(database.countOverlappingRepoTasks(directory, {
      excludeTaskId: mine.id,
      from: '2026-08-13T12:00:00.000Z',
      to: '2026-08-13T13:00:00.000Z',
    }), 0, 'a task that finished before the window does not count');

    assert.equal(database.countOverlappingRepoTasks(directory, { excludeTaskId: null, from: '2026-08-13T10:00:00.000Z', to: '2026-08-13T11:00:00.000Z' }), 2);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
