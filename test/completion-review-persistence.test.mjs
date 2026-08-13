import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { RelayDatabase } from '../src/database.mjs';

function createTask(database, title, repoPath = '/repo/alpha') {
  return database.createTask({
    title,
    prompt: title,
    thread: { id: `thread-${title}`, title, source: 'test', cwd: repoPath },
  });
}

test('completion review state survives database reopen and resets only for a new completion', () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-completion-review-'));
  const file = join(directory, 'relay.sqlite');
  let database = new RelayDatabase(file);
  try {
    const first = createTask(database, 'first');
    database.updateTask(first.id, { status: 'running' });
    assert.equal(database.updateTask(first.id, {
      status: 'complete',
      finished_at: '2026-08-13T10:00:00.000Z',
    }).ready_for_review, true);

    database.close();
    database = new RelayDatabase(file);
    assert.equal(database.getTask(first.id).ready_for_review, true);

    assert.deepEqual(database.markTaskReviewed(first.id), {
      reviewed: true,
      task: database.getTask(first.id),
    });
    assert.equal(database.getTask(first.id).ready_for_review, false);

    database.updateTask(first.id, { status: 'complete', result: 'Same completion, later artifact write' });
    assert.equal(database.getTask(first.id).ready_for_review, false);

    database.updateTask(first.id, { status: 'running' });
    assert.equal(database.updateTask(first.id, {
      status: 'complete',
      finished_at: '2026-08-13T11:00:00.000Z',
    }).ready_for_review, true);

    const second = createTask(database, 'second');
    const other = createTask(database, 'other', '/repo/beta');
    database.updateTask(second.id, {
      status: 'complete',
      finished_at: '2026-08-13T11:05:00.000Z',
    });
    database.updateTask(other.id, {
      status: 'complete',
      finished_at: '2026-08-13T11:10:00.000Z',
    });
    assert.equal(database.markProjectTasksReviewed('/repo/alpha', [
      { taskId: first.id, finishedAt: '2026-08-13T11:00:00.000Z' },
      { taskId: second.id, finishedAt: '2026-08-13T11:05:00.000Z' },
    ]), 2);
    assert.equal(database.getTask(first.id).ready_for_review, false);
    assert.equal(database.getTask(second.id).ready_for_review, false);
    assert.equal(database.getTask(other.id).ready_for_review, true);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a late review request cannot clear a newer completion of the same task', () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-completion-review-race-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  try {
    const task = createTask(database, 'raced');
    database.updateTask(task.id, { status: 'running', finished_at: null });
    database.updateTask(task.id, {
      status: 'complete',
      finished_at: '2026-08-13T12:00:00.000Z',
    });
    const staleReview = {
      taskId: task.id,
      finishedAt: '2026-08-13T12:00:00.000Z',
    };

    database.updateTask(task.id, { status: 'running', finished_at: null });
    database.updateTask(task.id, {
      status: 'complete',
      finished_at: '2026-08-13T12:01:00.000Z',
    });

    assert.equal(database.markTaskReviewed(task.id, staleReview.finishedAt).reviewed, false);
    assert.equal(database.markProjectTasksReviewed('/repo/alpha', [staleReview]), 0);
    assert.equal(database.getTask(task.id).ready_for_review, true);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('schema upgrade baselines legacy completions and imports old local unread IDs once', () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-completion-review-migration-'));
  const file = join(directory, 'relay.sqlite');
  let database = new RelayDatabase(file);
  let legacyUnread;
  let legacyReviewed;
  try {
    legacyUnread = createTask(database, 'legacy-unread');
    legacyReviewed = createTask(database, 'legacy-reviewed');
    database.updateTask(legacyUnread.id, { status: 'complete' });
    database.updateTask(legacyReviewed.id, { status: 'complete' });
    database.close();

    const raw = new DatabaseSync(file);
    raw.exec('ALTER TABLE tasks DROP COLUMN completion_reviewed');
    raw.close();

    database = new RelayDatabase(file);
    assert.equal(database.getTask(legacyUnread.id).ready_for_review, false);
    assert.equal(database.getTask(legacyReviewed.id).ready_for_review, false);

    assert.deepEqual(database.migrateCompletionReviews([legacyUnread.id]), {
      migrated: true,
      restored: 1,
    });
    assert.equal(database.getTask(legacyUnread.id).ready_for_review, true);
    assert.equal(database.getTask(legacyReviewed.id).ready_for_review, false);

    database.markTaskReviewed(legacyUnread.id);
    assert.deepEqual(database.migrateCompletionReviews([legacyUnread.id, legacyReviewed.id]), {
      migrated: false,
      restored: 0,
    });
    assert.equal(database.getTask(legacyUnread.id).ready_for_review, false);
    assert.equal(database.getTask(legacyReviewed.id).ready_for_review, false);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('completion review API and renderer use durable task state before the first task load', () => {
  const server = readFileSync(new URL('../src/server.mjs', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

  assert.match(server, /pathname === '\/api\/tasks\/completion-reviews\/migrate'/);
  assert.match(server, /pathname === '\/api\/tasks\/review-project'/);
  assert.match(server, /\^\\\/api\\\/tasks\\\/\\d\+\\\/review\$\/\.test\(pathname\)/);
  assert.match(app, /pendingReviewMigrationTaskIds\(\)/);
  assert.match(app, /const rendererStateReady = Promise\.all\(\[uiPreferencesReady, completionReviewsReady\]\)/);
  assert.match(app, /rendererStateReady\.then\(\(\) => load\(\)\)/);
  assert.match(app, /api\(`\/api\/tasks\/\$\{task\.id\}\/review`/);
  assert.match(app, /api\('\/api\/tasks\/review-project'/);
});
