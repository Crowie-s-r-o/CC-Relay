import assert from 'node:assert/strict';
import test from 'node:test';
import { ProjectCompletionNotifications } from '../public/project-completion-notifications.js';

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}

function task(id, status, repoPath = '/work/alpha') {
  return { id, status, repo_path: repoPath };
}

test('first observation treats historical completed tasks as an acknowledged baseline', () => {
  const notifications = new ProjectCompletionNotifications(memoryStorage());
  notifications.observe([
    task(1, 'complete'),
    task(2, 'running'),
    task(3, 'complete', '/work/beta'),
  ]);

  assert.equal(notifications.count('/work/alpha'), 0);
  assert.equal(notifications.count('/work/beta'), 0);
});

test('a task completing outside the open Task Activity becomes a project notification', () => {
  const notifications = new ProjectCompletionNotifications(memoryStorage());
  notifications.observe([task(4, 'running'), task(8, 'queued', '/work/beta')]);
  notifications.observe([
    task(4, 'complete'),
    task(8, 'complete', '/work/beta'),
  ], {
    activeProjectPath: '/work/alpha',
    selectedTaskId: 99,
  });

  assert.equal(notifications.count('/work/alpha'), 1);
  assert.equal(notifications.latestTaskId('/work/alpha'), 4);
  assert.equal(notifications.count('/work/beta'), 1);
});

test('the task currently open in Task Activity is already checked when it completes', () => {
  const notifications = new ProjectCompletionNotifications(memoryStorage());
  notifications.observe([task(5, 'running')]);
  notifications.observe([task(5, 'complete')], {
    activeProjectPath: '/work/alpha/',
    selectedTaskId: 5,
  });

  assert.equal(notifications.count('/work/alpha'), 0);
});

test('opening a completed task acknowledges only that notification', () => {
  const notifications = new ProjectCompletionNotifications(memoryStorage());
  notifications.observe([task(6, 'running'), task(7, 'queued')]);
  notifications.observe([task(6, 'complete'), task(7, 'complete')]);

  assert.equal(notifications.count('/work/alpha'), 2);
  assert.equal(notifications.includes('/work/alpha', 6), true);
  assert.equal(notifications.includes('/work/alpha', 7), true);
  assert.equal(notifications.acknowledge(task(6, 'complete')), true);
  assert.equal(notifications.includes('/work/alpha', 6), false);
  assert.equal(notifications.count('/work/alpha'), 1);
  assert.equal(notifications.latestTaskId('/work/alpha'), 7);
});

test('acknowledging a project clears only that project and persists the change', () => {
  const storage = memoryStorage();
  const notifications = new ProjectCompletionNotifications(storage);
  notifications.observe([task(13, 'running'), task(14, 'queued'), task(15, 'running', '/work/beta')]);
  notifications.observe([task(13, 'complete'), task(14, 'complete'), task(15, 'complete', '/work/beta')]);

  assert.equal(notifications.acknowledgeProject('/work/alpha/'), 2);
  assert.equal(notifications.count('/work/alpha'), 0);
  assert.equal(notifications.count('/work/beta'), 1);

  const restored = new ProjectCompletionNotifications(storage);
  assert.equal(restored.count('/work/alpha'), 0);
  assert.equal(restored.includes('/work/beta', 15), true);
});

test('notifications and unfinished observations survive a page restart', () => {
  const storage = memoryStorage();
  const first = new ProjectCompletionNotifications(storage);
  first.observe([task(9, 'running'), task(10, 'queued', '/work/beta')]);
  first.observe([task(9, 'complete'), task(10, 'queued', '/work/beta')]);

  const second = new ProjectCompletionNotifications(storage);
  assert.equal(second.count('/work/alpha'), 1);
  second.observe([task(9, 'complete'), task(10, 'complete', '/work/beta')]);

  assert.equal(second.count('/work/alpha'), 1);
  assert.equal(second.count('/work/beta'), 1);
});

test('retrying or deleting a task removes its stale completion notification', () => {
  const notifications = new ProjectCompletionNotifications(memoryStorage());
  notifications.observe([task(11, 'running'), task(12, 'queued')]);
  notifications.observe([task(11, 'complete'), task(12, 'complete')]);
  notifications.observe([task(11, 'running')]);

  assert.equal(notifications.count('/work/alpha'), 0);
});
