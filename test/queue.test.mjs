import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ArtifactStore } from '../src/artifacts.mjs';
import { RelayDatabase } from '../src/database.mjs';
import { TaskQueue } from '../src/queue.mjs';

function waitFor(predicate, timeout = 2000) {
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

function thread(id, cwd) {
  return { id, title: `Session ${id}`, source: 'cli', cwd };
}

test('queue never runs more than one task at a time', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-queue-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  const artifacts = new ArtifactStore(join(directory, 'tasks'));
  let active = 0;
  let maximumActive = 0;
  const order = [];
  const runner = {
    async run(task, { onEvent }) {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      order.push(task.title);
      onEvent({
        event: { type: 'turn/started', threadId: task.thread_id, turn: { id: `turn-${task.id}` } },
        message: 'Started',
      });
      await new Promise((resolve) => setTimeout(resolve, 30));
      active -= 1;
      return { finalResponse: `Finished ${task.title}`, sessionId: `session-${task.id}`, exitCode: 0 };
    },
    cancel() {
      return false;
    },
  };
  const queue = new TaskQueue({ database, artifacts, runner });

  try {
    queue.pause();
    const first = queue.enqueue({ title: 'First', prompt: 'One', thread: thread('one', directory) });
    const second = queue.enqueue({ title: 'Second', prompt: 'Two', thread: thread('two', directory) });
    queue.resume();

    await waitFor(() => database.getTask(second.id).status === 'complete');
    assert.equal(database.getTask(first.id).status, 'complete');
    assert.equal(maximumActive, 1);
    assert.deepEqual(order, ['First', 'Second']);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('priority submission runs before tasks that are still waiting', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-queue-priority-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  const artifacts = new ArtifactStore(join(directory, 'tasks'));
  const order = [];
  const runner = {
    async run(task) {
      order.push(task.title);
      return { finalResponse: task.title, sessionId: task.thread_id, exitCode: 0 };
    },
    cancel() { return false; },
  };
  const queue = new TaskQueue({ database, artifacts, runner });
  try {
    queue.pause();
    const first = queue.enqueue({ title: 'First', prompt: 'One', thread: thread('one', directory) });
    const second = queue.enqueue({ title: 'Second', prompt: 'Two', thread: thread('two', directory) });
    const urgent = queue.enqueue({ title: 'Urgent', prompt: 'Now', thread: thread('urgent', directory), runNow: true });
    assert.equal(database.nextQueuedTask().id, urgent.id);
    queue.resume();
    await waitFor(() => database.getTask(second.id).status === 'complete');
    assert.deepEqual(order, ['Urgent', 'First', 'Second']);
    assert.equal(database.listEvents(urgent.id).some((event) => /ahead of waiting tasks/.test(event.message)), true);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('queue executes waiting tasks in the reordered sequence', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-queue-reorder-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  const artifacts = new ArtifactStore(join(directory, 'tasks'));
  const order = [];
  const runner = {
    async run(task) {
      order.push(task.title);
      return { finalResponse: task.title, sessionId: `session-${task.id}`, exitCode: 0 };
    },
    cancel() { return false; },
  };
  const queue = new TaskQueue({ database, artifacts, runner });

  try {
    queue.pause();
    const first = queue.enqueue({ title: 'First', prompt: 'One', thread: thread('one', directory) });
    const second = queue.enqueue({ title: 'Second', prompt: 'Two', thread: thread('two', directory) });
    const third = queue.enqueue({ title: 'Third', prompt: 'Three', thread: thread('three', directory) });
    queue.reorder([third.id, first.id, second.id]);
    queue.resume();

    await waitFor(() => database.getTask(second.id).status === 'complete');
    assert.deepEqual(order, ['Third', 'First', 'Second']);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('queue cancellation and retry work before a task starts', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-retry-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  const artifacts = new ArtifactStore(join(directory, 'tasks'));
  const runner = {
    async run(task) {
      return { finalResponse: `Finished ${task.title}`, sessionId: 'retry-session', exitCode: 0 };
    },
    cancel() {
      return false;
    },
  };
  const queue = new TaskQueue({ database, artifacts, runner });

  try {
    queue.pause();
    const task = queue.enqueue({ title: 'Retry me', prompt: 'Work', thread: thread('retry', directory) });
    queue.cancel(task.id);
    assert.equal(database.getTask(task.id).status, 'cancelled');

    queue.retry(task.id);
    assert.equal(database.getTask(task.id).status, 'queued');
    queue.resume();
    await waitFor(() => database.getTask(task.id).status === 'complete');
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('failed tasks automatically retry after the configured wait', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-auto-retry-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  const artifacts = new ArtifactStore(join(directory, 'tasks'));
  let attempts = 0;
  const runner = {
    async run() {
      attempts += 1;
      if (attempts === 1) throw new Error('Temporary failure.');
      return { finalResponse: 'Recovered', sessionId: 'retry-session', exitCode: 0 };
    },
    cancel() { return false; },
  };
  const queue = new TaskQueue({ database, artifacts, runner, retryDelayMs: 30 });

  try {
    const task = queue.enqueue({ title: 'Recover', prompt: 'Work', thread: thread('recover', directory) });
    await waitFor(() => database.getTask(task.id).status === 'failed');
    assert.equal(attempts, 1);
    assert.match(database.listEvents(task.id).at(-1).message, /Retrying automatically/);
    await waitFor(() => database.getTask(task.id).status === 'complete');
    assert.equal(attempts, 2);
    assert.equal(database.getTask(task.id).result, 'Recovered');
    assert.match(
      database.listEvents(task.id).map((event) => event.message).join('\n'),
      /Automatic retry started/,
    );
  } finally {
    await queue.shutdown();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('deleting a task removes its stored artifacts', () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-delete-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  const artifacts = new ArtifactStore(join(directory, 'tasks'));
  const queue = new TaskQueue({
    database,
    artifacts,
    runner: { run() {}, cancel() { return false; } },
  });

  try {
    queue.pause();
    const task = queue.enqueue({ title: 'Delete me', prompt: 'Work', thread: thread('delete', directory) });
    assert.equal(existsSync(artifacts.taskDirectory(task.id)), true);
    assert.equal(queue.delete(task.id), true);
    assert.equal(database.getTask(task.id), null);
    assert.equal(existsSync(artifacts.taskDirectory(task.id)), false);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('queue persists image attachments before scheduling a task', () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-attachment-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  const artifacts = new ArtifactStore(join(directory, 'tasks'));
  const queue = new TaskQueue({
    database,
    artifacts,
    runner: { run() {}, cancel() { return false; } },
  });

  try {
    queue.pause();
    const task = queue.enqueue({
      title: 'Inspect image',
      prompt: 'Review the screenshot.',
      thread: thread('image', directory),
      attachments: [{
        name: 'screen.png',
        mimeType: 'image/png',
        extension: 'png',
        data: Buffer.from('89504e470d0a1a0a00000000', 'hex'),
      }],
    });
    assert.equal(task.attachments.length, 1);
    assert.equal(task.attachments[0].name, 'screen.png');
    assert.equal(existsSync(task.attachments[0].path), true);
    assert.match(
      readFileSync(join(artifacts.taskDirectory(task.id), 'task.md'), 'utf8'),
      /Reference images[\s\S]*screen\.png/,
    );
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('queue marks an active task interrupted during shutdown', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-shutdown-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  const artifacts = new ArtifactStore(join(directory, 'tasks'));
  let rejectRun;
  const runner = {
    run() {
      return new Promise((resolve, reject) => {
        rejectRun = reject;
      });
    },
    cancel() {
      const error = new Error('Task cancelled.');
      error.cancelled = true;
      rejectRun(error);
      return true;
    },
  };
  const queue = new TaskQueue({ database, artifacts, runner });

  try {
    const task = queue.enqueue({ title: 'Stop me', prompt: 'Work', thread: thread('stop', directory) });
    await waitFor(() => database.getTask(task.id).status === 'running');
    await queue.shutdown();
    assert.equal(database.getTask(task.id).status, 'interrupted');
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
