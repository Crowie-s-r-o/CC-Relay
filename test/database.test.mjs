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
      continuedFromTaskId: first.id,
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
    assert.equal(second.continued_from_task_id, first.id);

    database.updateTask(first.id, { status: 'complete', result: 'Done' });
    assert.equal(database.getTask(first.id).result, 'Done');
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('database persists one unique submission ID per task', () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-submission-id-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  const submissionId = 'd9428888-122b-4c26-bc3f-61c1c6ab3710';
  try {
    const first = database.createTask({
      title: 'Only once',
      prompt: 'Create this once',
      thread: { id: 'thread-once', title: 'Once', source: 'cli', cwd: '/repo' },
      submissionId,
    });

    assert.equal(database.getTaskBySubmissionId(submissionId).id, first.id);
    assert.equal(Object.hasOwn(first, 'submission_id'), false);
    assert.throws(() => database.createTask({
      title: 'Duplicate',
      prompt: 'Create this twice',
      thread: { id: 'thread-twice', title: 'Twice', source: 'cli', cwd: '/repo' },
      submissionId,
    }), /UNIQUE constraint failed/);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('database edits only tasks that are still queued', () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-db-edit-queued-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  try {
    const queued = database.createTask({
      title: 'Original',
      prompt: 'Original prompt',
      thread: { id: 'queued-edit', title: 'Queued edit', source: 'cli', cwd: '/repo' },
    });
    const edited = database.updateQueuedTask(queued.id, {
      title: 'Updated',
      prompt: 'Updated prompt',
    });
    assert.equal(edited.title, 'Updated');
    assert.equal(edited.prompt, 'Updated prompt');

    database.updateTask(queued.id, { status: 'running' });
    assert.throws(
      () => database.updateQueuedTask(queued.id, { prompt: 'Too late' }),
      /still waiting in the queue/,
    );
    assert.equal(database.getTask(queued.id).prompt, 'Updated prompt');
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

test('database recovery preserves the no-queue marker for an interrupted same-session follow-up', () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-follow-up-recovery-'));
  const filePath = join(directory, 'relay.sqlite');
  const database = new RelayDatabase(filePath);
  const task = database.createTask({
    title: 'Existing task',
    prompt: 'Original prompt',
    thread: { id: 'thread-follow-up', title: 'Follow-up session', source: 'cli', cwd: '/repo' },
  });
  database.updateTask(task.id, { status: 'running' });
  database.addEvent(task.id, 'queue', 'Follow-up started immediately in the same terminal session.');
  database.close();

  const reopened = new RelayDatabase(filePath);
  try {
    assert.equal(reopened.recoverInterruptedTasks(), 1);
    assert.equal(reopened.getTask(task.id).status, 'interrupted');
    assert.match(reopened.getTask(task.id).error, /^Same-session follow-up interrupted:/);
    assert.match(reopened.listEvents(task.id).at(-1).message, /not queued/i);
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

    database.reorderQueuedTasks([third.id, first.id, second.id], [first.id, second.id, third.id]);
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

test('each project has independent queue positions and reorder validation', () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-project-queues-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  try {
    const alphaFirst = database.createTask({ title: 'Alpha first', prompt: 'One', thread: { id: 'a1', title: 'A1', source: 'cli', cwd: '/repo/alpha' } });
    const betaFirst = database.createTask({ title: 'Beta first', prompt: 'Two', thread: { id: 'b1', title: 'B1', source: 'cli', cwd: '/repo/beta' } });
    const alphaSecond = database.createTask({ title: 'Alpha second', prompt: 'Three', thread: { id: 'a2', title: 'A2', source: 'cli', cwd: '/repo/alpha' } });
    const betaSecond = database.createTask({ title: 'Beta second', prompt: 'Four', thread: { id: 'b2', title: 'B2', source: 'cli', cwd: '/repo/beta' } });

    assert.deepEqual([alphaFirst.position, betaFirst.position, alphaSecond.position, betaSecond.position], [1, 1, 2, 2]);
    database.reorderQueuedTasks(
      [alphaSecond.id, alphaFirst.id],
      [alphaFirst.id, alphaSecond.id],
      '/repo/alpha',
    );

    const alpha = database.listTasks().filter((task) => task.repo_path === '/repo/alpha');
    const beta = database.listTasks().filter((task) => task.repo_path === '/repo/beta');
    assert.deepEqual(alpha.map((task) => task.id), [alphaSecond.id, alphaFirst.id]);
    assert.deepEqual(beta.map((task) => task.id), [betaFirst.id, betaSecond.id]);
    assert.throws(
      () => database.reorderQueuedTasks([betaFirst.id, betaSecond.id], [betaFirst.id, betaSecond.id], '/repo/alpha'),
      /queue changed/i,
    );
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('database rejects stale reorder snapshots without changing positions', () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-reorder-stale-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  try {
    const first = database.createTask({ title: 'First', prompt: 'One', thread: { id: 'one', title: 'One', source: 'cli', cwd: '/repo' } });
    const second = database.createTask({ title: 'Second', prompt: 'Two', thread: { id: 'two', title: 'Two', source: 'cli', cwd: '/repo' } });
    const third = database.createTask({ title: 'Third', prompt: 'Three', thread: { id: 'three', title: 'Three', source: 'cli', cwd: '/repo' } });
    const expected = [first.id, second.id, third.id];

    database.reorderQueuedTasks([third.id, first.id, second.id], expected);
    const committed = database.listTasks().filter((task) => task.status === 'queued');
    const positionsBefore = new Map(committed.map((task) => [task.id, task.position]));

    assert.throws(
      () => database.reorderQueuedTasks([first.id, second.id, third.id], expected),
      /queue changed/i,
    );
    const positionsAfter = new Map(
      database.listTasks().filter((task) => task.status === 'queued').map((task) => [task.id, task.position]),
    );
    assert.deepEqual(positionsAfter, positionsBefore);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('database rejects a task leaving the queue and invalid permutations atomically', () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-reorder-invalid-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  try {
    const first = database.createTask({ title: 'First', prompt: 'One', thread: { id: 'one', title: 'One', source: 'cli', cwd: '/repo' } });
    const second = database.createTask({ title: 'Second', prompt: 'Two', thread: { id: 'two', title: 'Two', source: 'cli', cwd: '/repo' } });
    const third = database.createTask({ title: 'Third', prompt: 'Three', thread: { id: 'three', title: 'Three', source: 'cli', cwd: '/repo' } });
    const expected = [first.id, second.id, third.id];

    database.updateTask(second.id, { status: 'complete', result: 'Done' });
    assert.throws(
      () => database.reorderQueuedTasks([third.id, first.id], expected),
      /queue changed/i,
    );
    assert.deepEqual(
      database.listTasks().filter((task) => task.status === 'queued').map((task) => task.id),
      [first.id, third.id],
    );

    const positionsBefore = database.listTasks().filter((task) => task.status === 'queued')
      .map((task) => [task.id, task.position]);
    assert.throws(
      () => database.reorderQueuedTasks([first.id, first.id], [first.id, third.id]),
      /duplicate/i,
    );
    assert.throws(
      () => database.reorderQueuedTasks([first.id, 999999], [first.id, third.id]),
      /queue changed/i,
    );
    assert.deepEqual(
      database.listTasks().filter((task) => task.status === 'queued').map((task) => [task.id, task.position]),
      positionsBefore,
    );
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('database lists finished tasks newest first without disturbing queue order', () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-task-order-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  try {
    const oldest = database.createTask({
      title: 'Oldest finished',
      prompt: 'One',
      thread: { id: 'one', title: 'One', source: 'cli', cwd: '/repo' },
    });
    const queuedFirst = database.createTask({
      title: 'First queued',
      prompt: 'Two',
      thread: { id: 'two', title: 'Two', source: 'cli', cwd: '/repo' },
    });
    const newest = database.createTask({
      title: 'Newest finished',
      prompt: 'Three',
      thread: { id: 'three', title: 'Three', source: 'cli', cwd: '/repo' },
    });
    const queuedSecond = database.createTask({
      title: 'Second queued',
      prompt: 'Four',
      thread: { id: 'four', title: 'Four', source: 'cli', cwd: '/repo' },
    });

    database.updateTask(oldest.id, { status: 'complete', result: 'Done' });
    database.updateTask(newest.id, { status: 'failed', error: 'Failed' });

    assert.deepEqual(
      database.listTasks().map((task) => task.id),
      [queuedFirst.id, queuedSecond.id, newest.id, oldest.id],
    );
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('ordinary submissions append after queued work even when history has a larger position', () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-append-position-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  try {
    const waiting = database.createTask({
      title: 'Waiting',
      prompt: 'First',
      thread: { id: 'waiting', title: 'Waiting', source: 'cli', cwd: '/repo' },
    });
    const finished = database.createTask({
      title: 'Finished',
      prompt: 'Historical',
      thread: { id: 'finished', title: 'Finished', source: 'cli', cwd: '/repo' },
    });
    database.updateTask(finished.id, { status: 'complete', position: 40, result: 'Done' });

    const appended = database.createTask({
      title: 'Appended',
      prompt: 'Last',
      thread: { id: 'appended', title: 'Appended', source: 'cli', cwd: '/repo' },
    });
    assert.equal(appended.position, 41);
    assert.equal(database.nextQueuedTask().id, waiting.id);

    const priority = database.createTask({
      title: 'Priority',
      prompt: 'Now',
      thread: { id: 'priority', title: 'Priority', source: 'cli', cwd: '/repo' },
      priority: true,
    });
    assert.equal(priority.position, waiting.position - 1);
    assert.equal(database.nextQueuedTask().id, priority.id);
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

test('project pause state is isolated by workspace path', () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-project-pause-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  try {
    database.setProjectPaused('/repo/alpha', true);
    assert.equal(database.isProjectPaused('/repo/alpha'), true);
    assert.equal(database.isProjectPaused('/repo/beta'), false);
    assert.deepEqual(database.pausedProjectPaths(), ['/repo/alpha']);

    database.setProjectPaused('/repo/alpha', false);
    database.setProjectPaused('/repo/beta', true);
    assert.equal(database.isProjectPaused('/repo/alpha'), false);
    assert.equal(database.isProjectPaused('/repo/beta'), true);
    assert.deepEqual(database.pausedProjectPaths(), ['/repo/beta']);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
