import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { ArtifactStore } from '../src/artifacts.mjs';
import { RelayDatabase } from '../src/database.mjs';
import { TaskQueue } from '../src/queue.mjs';
import { prioritizeStarredTasks, sortOperationalTasks } from '../public/task-history.js';
import { createQueueSnapshot, moveVisibleTask } from '../public/queue-reorder.js';

function thread(id, cwd = '/repo') {
  return { id, title: `Session ${id}`, source: 'test', cwd };
}

function queueContext(prefix) {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  const artifacts = new ArtifactStore(join(directory, 'tasks'));
  const queue = new TaskQueue({
    database,
    artifacts,
    runner: { run() {}, cancel() { return false; } },
  });
  queue.pause();
  return { directory, database, artifacts, queue };
}

test('task stars persist without changing queued dispatch priority', () => {
  const context = queueContext('relay-task-star-');
  try {
    const first = context.queue.enqueue({
      title: 'First in queue',
      prompt: 'Run first',
      thread: thread('first'),
    });
    const second = context.queue.enqueue({
      title: 'Keep visible',
      prompt: 'Run second',
      thread: thread('second'),
    });

    assert.equal(first.starred, false);
    const starred = context.queue.setStarred(second.id, true);
    assert.equal(starred.starred, true);
    assert.equal(starred.position, second.position);
    assert.equal(context.database.nextQueuedTask().id, first.id);
    assert.match(context.database.listEvents(second.id).at(-1).message, /moved to the top/i);

    context.database.close();
    const reopened = new RelayDatabase(join(context.directory, 'relay.sqlite'));
    try {
      assert.equal(reopened.getTask(second.id).starred, true);
    } finally {
      reopened.close();
    }
  } finally {
    try { context.database.close(); } catch {}
    rmSync(context.directory, { recursive: true, force: true });
  }
});

test('task title rename works after dispatch and rewrites only the canonical heading', () => {
  const context = queueContext('relay-task-title-');
  try {
    const task = context.queue.enqueue({
      title: 'Original title',
      prompt: 'Keep this complete task request unchanged.',
      thread: thread('rename'),
    });
    context.database.updateTask(task.id, { status: 'running' });
    const activeRename = context.queue.rename(task.id, 'Active task title');
    assert.equal(activeRename.status, 'running');

    context.database.updateTask(task.id, {
      status: 'complete',
      result: 'Saved result',
      finished_at: '2026-08-19T12:00:00.000Z',
    });

    const renamed = context.queue.rename(task.id, 'Release $& readiness');
    assert.equal(renamed.id, task.id);
    assert.equal(renamed.status, 'complete');
    assert.equal(renamed.prompt, task.prompt);
    assert.equal(renamed.result, 'Saved result');
    assert.match(context.database.listEvents(task.id).at(-1).message, /Task renamed from/);

    const markdown = readFileSync(join(context.artifacts.taskDirectory(task.id), 'task.md'), 'utf8');
    assert.match(markdown, /^# Release \$& readiness$/m);
    assert.match(markdown, /Keep this complete task request unchanged\./);
    assert.doesNotMatch(markdown, /^# Original title$/m);
  } finally {
    context.database.close();
    rmSync(context.directory, { recursive: true, force: true });
  }
});

test('planner breakdown titles remain owned by their linked plan step', () => {
  const context = queueContext('relay-breakdown-title-');
  try {
    const task = context.queue.enqueue({
      title: 'Linked step',
      prompt: 'Keep this linked title.',
      thread: thread('breakdown'),
      mode: 'breakdown',
    });
    assert.throws(
      () => context.queue.rename(task.id, 'Detached title'),
      /linked plan step/i,
    );
    assert.equal(context.database.getTask(task.id).title, 'Linked step');
  } finally {
    context.database.close();
    rmSync(context.directory, { recursive: true, force: true });
  }
});

test('legacy task databases add an unstarred column without changing existing rows', () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-task-star-migration-'));
  const file = join(directory, 'relay.sqlite');
  let database = new RelayDatabase(file);
  const task = database.createTask({
    title: 'Legacy task',
    prompt: 'Preserve me',
    thread: thread('legacy'),
  });
  database.close();

  const raw = new DatabaseSync(file);
  raw.exec('ALTER TABLE tasks DROP COLUMN starred');
  raw.close();

  database = new RelayDatabase(file);
  try {
    assert.equal(database.getTask(task.id).starred, false);
    assert.ok(database.database.prepare('PRAGMA table_info(tasks)').all().some((column) => (
      column.name === 'starred' && column.dflt_value === '0'
    )));
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('starred ordering is stable in operational, history, and search source orders', () => {
  const tasks = [
    { id: 1, status: 'running', starred: false },
    { id: 2, status: 'complete', starred: true },
    { id: 3, status: 'queued', position: 1, starred: true },
    { id: 4, status: 'queued', position: 2, starred: false },
    { id: 5, status: 'running', starred: true },
  ];

  assert.deepEqual(prioritizeStarredTasks(tasks).map((task) => task.id), [2, 3, 5, 1, 4]);
  assert.deepEqual(sortOperationalTasks(tasks).map((task) => task.id), [5, 3, 2, 1, 4]);
  assert.deepEqual(tasks.map((task) => task.id), [1, 2, 3, 4, 5]);
});

test('reordering one star group preserves tasks in the other group', () => {
  const snapshot = createQueueSnapshot([1, 2, 3, 4], [2, 4]);
  assert.deepEqual(moveVisibleTask(snapshot, 4, -1), [1, 4, 3, 2]);
});

test('task cards expose capability-gated star and inline rename controls', () => {
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const style = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');
  const server = readFileSync(new URL('../src/server.mjs', import.meta.url), 'utf8');
  const database = readFileSync(new URL('../src/database.mjs', import.meta.url), 'utf8');

  assert.match(server, /taskTitleRenaming:\s*true/);
  assert.match(server, /taskStarring:\s*true/);
  assert.match(server, /\^\\\/api\\\/tasks\\\/\\d\+\\\/title\$\/\.test\(pathname\)/);
  assert.match(server, /\^\\\/api\\\/tasks\\\/\\d\+\\\/star\$\/\.test\(pathname\)/);
  assert.match(database, /this\.ensureColumn\('starred', 'INTEGER NOT NULL DEFAULT 0'\)/);
  assert.match(app, /data-star-task/);
  assert.match(app, /aria-pressed="\$\{starred\}"/);
  assert.match(app, /data-task-title-input/);
  assert.match(app, /event\.key !== 'Escape'/);
  assert.match(app, /document\.activeElement\?\.closest\?\.\('\[data-task-title-form\]'\)/);
  assert.match(app, /createQueueSnapshot\(globalTaskIds, visibleTaskIds\)/);
  assert.match(style, /\.task-star-button\[aria-pressed="true"\]/);
  assert.match(style, /html\[data-theme="dark"\] \.task-star-button/);
  assert.match(style, /\.task-inline-rename input:focus-visible/);
  assert.match(style, /\.queue-starred-heading/);
});
