import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  formatElapsedDuration,
  taskDurationLabel,
  taskLifecycleDates,
  taskRuntimeMilliseconds,
} from '../public/task-time.js';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

test('task duration formats live and completed execution time', () => {
  const start = '2026-07-16T10:00:00.000Z';
  assert.equal(formatElapsedDuration(start, null, new Date('2026-07-16T10:03:07.000Z').getTime()), '3m 07s');
  assert.equal(formatElapsedDuration(start, '2026-07-16T12:04:00.000Z'), '2h 04m');
  assert.equal(formatElapsedDuration(start, '2026-07-17T12:00:00.000Z'), '1d 02h');
});

test('task duration labels distinguish running, finished, and waiting tasks', () => {
  const now = new Date('2026-07-16T10:00:12.000Z').getTime();
  assert.equal(taskDurationLabel({ status: 'running', started_at: '2026-07-16T10:00:00.000Z' }, now), 'Running 12s');
  assert.equal(taskDurationLabel({ status: 'open', started_at: '2026-07-16T10:00:00.000Z' }, now), 'Open 12s');
  assert.equal(taskDurationLabel({
    status: 'complete',
    started_at: '2026-07-16T10:00:00.000Z',
    finished_at: '2026-07-16T10:01:30.000Z',
  }, now), 'Took 1m 30s');
  assert.equal(taskDurationLabel({ status: 'queued', started_at: null }, now), 'Waiting to start');
});

test('task runtime sums finished turns and the active follow-up without idle gaps', () => {
  const now = new Date('2026-09-01T11:00:05.000Z').getTime();
  const running = {
    status: 'running',
    started_at: '2026-09-01T11:00:00.000Z',
    conversation_metrics: {
      attempt_count: 2,
      duration_ms: 10_000,
      active_attempt_started_at: '2026-09-01T11:00:00.000Z',
    },
  };
  assert.equal(taskRuntimeMilliseconds(running, now), 15_000);
  assert.equal(taskDurationLabel(running, now), 'Running 15s');

  const open = {
    ...running,
    status: 'open',
    conversation_metrics: {
      attempt_count: 2,
      duration_ms: 30_000,
      active_attempt_started_at: null,
    },
  };
  assert.equal(taskDurationLabel(open, new Date('2026-09-02T11:00:00.000Z').getTime()), 'Open 30s');
});

test('task lifecycle dates always expose started and completed fields', () => {
  assert.deepEqual(taskLifecycleDates({
    started_at: '2026-07-30T08:00:00.000Z',
    finished_at: '2026-07-30T08:05:00.000Z',
  }), [
    {
      key: 'started',
      label: 'Started',
      value: '2026-07-30T08:00:00.000Z',
      pendingLabel: 'Not started',
    },
    {
      key: 'completed',
      label: 'Completed',
      value: '2026-07-30T08:05:00.000Z',
      pendingLabel: 'Not completed',
    },
  ]);

  assert.deepEqual(
    taskLifecycleDates({ started_at: null, finished_at: null }).map(({ value, pendingLabel }) => ({ value, pendingLabel })),
    [
      { value: null, pendingLabel: 'Not started' },
      { value: null, pendingLabel: 'Not completed' },
    ],
  );
});

test('task cards and Task Activity both render lifecycle dates', () => {
  assert.ok(app.includes('<span class="task-footer-dates">${taskLifecycleDatesMarkup(task)}</span>'));
  assert.ok(app.includes('<span class="detail-lifecycle-dates">${taskLifecycleDatesMarkup(task, formatTime)}</span>'));
});
