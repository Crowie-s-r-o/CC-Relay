import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { RelayDatabase } from '../src/database.mjs';

test('database persists tasks in queue order and records events', () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-db-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  try {
    const first = database.createTask({
      title: 'First',
      prompt: 'One',
      thread: { id: 'thread-one', title: 'First session', source: 'cli', cwd: '/repo/one' },
      provider: 'codex',
      model: 'gpt-test',
      effort: 'high',
    });
    const second = database.createTask({
      title: 'Second',
      prompt: 'Two',
      thread: { id: 'thread-two', title: 'Second session', source: 'vscode', cwd: '/repo/two' },
      provider: 'council',
      mode: 'plan',
      council: {
        authorProvider: 'claude',
        authorModel: 'opus',
        authorEffort: 'max',
        reviewerProvider: 'codex',
        reviewerModel: 'gpt-test',
        reviewerEffort: 'high',
      },
    });

    assert.equal(database.nextQueuedTask().id, first.id);
    assert.deepEqual(database.listTasks().map((task) => task.id), [first.id, second.id]);
    assert.equal(database.listEvents(first.id)[0].message, 'Task added to the queue.');
    assert.equal(first.thread_id, 'thread-one');
    assert.equal(first.thread_name, 'First session');
    assert.equal(first.provider, 'codex');
    assert.equal(first.model, 'gpt-test');
    assert.equal(first.effort, 'high');
    assert.equal(second.mode, 'plan');
    assert.equal(second.author_provider, 'claude');
    assert.equal(second.author_model, 'opus');
    assert.equal(second.author_effort, 'max');
    assert.equal(second.reviewer_provider, 'codex');
    assert.equal(second.reviewer_model, 'gpt-test');
    assert.equal(second.reviewer_effort, 'high');

    database.updateTask(first.id, { status: 'complete', result: 'Done' });
    assert.equal(database.getTask(first.id).result, 'Done');
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('database marks active tasks interrupted after restart', () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-recovery-'));
  const filePath = join(directory, 'relay.sqlite');
  const database = new RelayDatabase(filePath);
  const task = database.createTask({
    title: 'Running',
    prompt: 'Work',
    thread: { id: 'thread-running', title: 'Running session', source: 'cli', cwd: '/repo' },
  });
  database.updateTask(task.id, { status: 'running' });
  database.close();

  const reopened = new RelayDatabase(filePath);
  try {
    assert.equal(reopened.recoverInterruptedTasks(), 1);
    assert.equal(reopened.getTask(task.id).status, 'interrupted');
  } finally {
    reopened.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('database reorders only the complete queued task set', () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-reorder-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  try {
    const first = database.createTask({
      title: 'First',
      prompt: 'One',
      thread: { id: 'one', title: 'One', source: 'cli', cwd: '/repo' },
    });
    const second = database.createTask({
      title: 'Second',
      prompt: 'Two',
      thread: { id: 'two', title: 'Two', source: 'cli', cwd: '/repo' },
    });
    const third = database.createTask({
      title: 'Third',
      prompt: 'Three',
      thread: { id: 'three', title: 'Three', source: 'cli', cwd: '/repo' },
    });

    database.reorderQueuedTasks([third.id, first.id, second.id]);
    assert.deepEqual(database.listTasks().map((task) => task.id), [third.id, first.id, second.id]);
    assert.equal(database.nextQueuedTask().id, third.id);
    assert.match(database.listEvents(third.id).at(-1).message, /queue position 1/);
    assert.throws(
      () => database.reorderQueuedTasks([first.id, second.id]),
      /queue changed/,
    );
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('database persists, deduplicates, launches, and removes pinned projects', () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-projects-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  try {
    const first = database.addProject({ path: '/repo/one', name: 'one' });
    const duplicate = database.addProject({ path: '/repo/one', name: 'renamed' });
    const second = database.addProject({ path: '/repo/two', name: 'two' });
    assert.equal(duplicate.id, first.id);
    assert.deepEqual(database.listProjects().map((project) => project.id), [first.id, second.id]);
    assert.ok(database.markProjectLaunched(first.id).last_launched_at);
    assert.equal(database.deleteProject(first.id), true);
    assert.deepEqual(database.listProjects().map((project) => project.id), [second.id]);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
