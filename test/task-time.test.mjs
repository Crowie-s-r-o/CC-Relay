import assert from 'node:assert/strict';
import test from 'node:test';
import { formatElapsedDuration, taskDurationLabel } from '../public/task-time.js';

test('task duration formats live and completed execution time', () => {
  const start = '2026-07-16T10:00:00.000Z';
  assert.equal(formatElapsedDuration(start, null, new Date('2026-07-16T10:03:07.000Z').getTime()), '3m 07s');
  assert.equal(formatElapsedDuration(start, '2026-07-16T12:04:00.000Z'), '2h 04m');
  assert.equal(formatElapsedDuration(start, '2026-07-17T12:00:00.000Z'), '1d 02h');
});

test('task duration labels distinguish running, finished, and waiting tasks', () => {
  const now = new Date('2026-07-16T10:00:12.000Z').getTime();
  assert.equal(taskDurationLabel({ status: 'running', started_at: '2026-07-16T10:00:00.000Z' }, now), 'Running 12s');
  assert.equal(taskDurationLabel({
    status: 'complete',
    started_at: '2026-07-16T10:00:00.000Z',
    finished_at: '2026-07-16T10:01:30.000Z',
  }, now), 'Took 1m 30s');
  assert.equal(taskDurationLabel({ status: 'queued', started_at: null }, now), 'Waiting to start');
});
