import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activityBuckets,
  periodRange,
  shiftPeriod,
  sortOperationalTasks,
  taskHistoryStats,
  tasksForScope,
  tasksInPeriod,
  tasksReadyForReview,
} from '../public/task-history.js';
import { ProjectCompletionNotifications } from '../public/project-completion-notifications.js';

function localIso(year, month, day, hour = 12) {
  return new Date(year, month, day, hour).toISOString();
}

test('review view includes only unread completions in the exact project across all dates', () => {
  const tasks = [
    { id: 1, status: 'complete', repo_path: '/work/alpha/', ready_for_review: true, starred: true, created_at: localIso(2025, 0, 1) },
    { id: 2, status: 'complete', repo_path: '/work/alpha', ready_for_review: false },
    { id: 3, status: 'complete', repo_path: '/work/alpha/nested', ready_for_review: true },
    { id: 4, status: 'complete', repo_path: '/work/beta', ready_for_review: true },
    ...['queued', 'running', 'failed', 'cancelled', 'interrupted', 'open'].map((status, index) => ({
      id: index + 5, status, repo_path: '/work/alpha', ready_for_review: true, position: index,
    })),
    { id: 11, status: 'complete', repo_path: '/work/alpha', ready_for_review: true },
    { id: 12, status: 'complete', repo_path: '/work/alpha', ready_for_review: true },
  ];
  const original = structuredClone(tasks);
  const notifications = new ProjectCompletionNotifications();
  notifications.observe(tasks);
  const scoped = tasksForScope(tasks, { projectPath: '/work/alpha' });
  const options = { isReadyForReview: task => notifications.includes(task.repo_path, task.id) };
  assert.deepEqual(tasksReadyForReview(scoped, options).map(task => task.id), [1, 12, 11]);
  assert.equal(notifications.count('/work/alpha'), 3);
  notifications.acknowledge(tasks[0]);
  assert.deepEqual(tasksReadyForReview(scoped, options).map(task => task.id), [12, 11]);
  notifications.acknowledgeProject('/work/alpha');
  assert.deepEqual(tasksReadyForReview(scoped, options), []);
  assert.equal(notifications.count('/work/beta'), 1);
  assert.deepEqual(tasksReadyForReview([], options), []);
  assert.deepEqual(tasksReadyForReview(scoped), []);
  assert.deepEqual(tasks, original, 'Review filtering never changes queue positions or task rows');
});

test('task history periods use local calendar boundaries', () => {
  const anchor = new Date(2026, 6, 16, 12);
  const week = periodRange('week', anchor);
  assert.equal(week.start.getDay(), 1);
  assert.equal(week.start.getDate(), 13);
  assert.equal(week.end.getDate(), 20);
  assert.equal(shiftPeriod('month', anchor, -1).getMonth(), 5);

  const tasks = [
    { created_at: localIso(2026, 6, 13) },
    { created_at: localIso(2026, 6, 19) },
    { created_at: localIso(2026, 6, 20) },
  ];
  assert.equal(tasksInPeriod(tasks, 'week', anchor).length, 2);
});

test('task history statistics count terminal outcomes and recorded runtime', () => {
  const tasks = [
    { status: 'complete', started_at: localIso(2026, 6, 16, 10), finished_at: localIso(2026, 6, 16, 11) },
    { status: 'failed', started_at: localIso(2026, 6, 16, 12), finished_at: localIso(2026, 6, 16, 12) },
    { status: 'running', started_at: localIso(2026, 6, 16, 13), finished_at: null },
  ];
  assert.deepEqual(taskHistoryStats(tasks), {
    total: 3,
    successful: 1,
    finished: 2,
    successRate: 50,
    runtimeMs: 3_600_000,
  });
});

test('task history activity buckets reflect the selected granularity', () => {
  const anchor = new Date(2026, 6, 16, 12);
  const tasks = [
    { created_at: localIso(2026, 6, 16, 1) },
    { created_at: localIso(2026, 6, 16, 5) },
    { created_at: localIso(2026, 6, 16, 5) },
  ];
  assert.deepEqual(activityBuckets(tasks, 'day', anchor).map(({ count }) => count), [1, 2, 0, 0, 0, 0]);
  assert.equal(activityBuckets(tasks, 'week', anchor).length, 7);
  assert.equal(activityBuckets(tasks, 'month', anchor).length, 31);
});

test('task scope always includes every relay in the selected project', () => {
  const tasks = [
    { id: 1, repo_path: '/work/alpha', thread_id: 'relay-1' },
    { id: 2, repo_path: '/work/alpha/', thread_id: 'relay-2' },
    { id: 3, repo_path: '/work/beta', thread_id: 'relay-1' },
  ];

  assert.deepEqual(
    tasksForScope(tasks, { projectPath: '/work/alpha' }).map((task) => task.id),
    [1, 2],
  );
  assert.deepEqual(
    tasksForScope(tasks, { projectPath: '/work/beta' }).map((task) => task.id),
    [3],
  );
  assert.deepEqual(
    tasksForScope(tasks, { projectPath: '/work/alpha', taskScope: 'relay', threadId: 'relay-1' }).map((task) => task.id),
    [1, 2],
  );
  assert.deepEqual(tasksForScope(tasks, { projectPath: null }), []);
});

test('operational tasks put review-ready completions directly after running work', () => {
  const tasks = [
    { id: 12, status: 'complete' },
    { id: 3, status: 'queued', position: 2 },
    { id: 8, status: 'complete' },
    { id: 5, status: 'running' },
    { id: 4, status: 'queued', position: 1 },
    { id: 9, status: 'open' },
    { id: 6, status: 'complete' },
    { id: 11, status: 'running' },
  ];
  const readyTaskIds = new Set([6, 8]);

  assert.deepEqual(
    sortOperationalTasks(tasks, {
      isReadyForReview: (task) => readyTaskIds.has(task.id),
    }).map((task) => task.id),
    [11, 5, 8, 6, 9, 4, 3, 12],
  );
  assert.deepEqual(tasks.map((task) => task.id), [12, 3, 8, 5, 4, 9, 6, 11]);

  readyTaskIds.delete(8);
  assert.deepEqual(
    sortOperationalTasks(tasks, {
      isReadyForReview: (task) => readyTaskIds.has(task.id),
    }).map((task) => task.id),
    [11, 5, 6, 9, 4, 3, 12, 8],
  );
});
