import assert from 'node:assert/strict';
import test from 'node:test';

import { runningTaskRailGroups } from '../public/running-task-layout.js';

const tasks = Array.from({ length: 9 }, (_, index) => ({ id: index + 1 }));

test('one running-task row keeps every task in the primary header rail', () => {
  const groups = runningTaskRailGroups(tasks, 1);

  assert.deepEqual(groups.primary.map((task) => task.id), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(groups.extra, []);
});

test('two running-task rows send every second task to the full-width rail', () => {
  const groups = runningTaskRailGroups(tasks, 2);

  assert.deepEqual(groups.primary.map((task) => task.id), [1, 3, 5, 7, 9]);
  assert.deepEqual(groups.extra.map((task) => task.id), [2, 4, 6, 8]);
});

test('three running-task rows retain column-first ordering across both rails', () => {
  const groups = runningTaskRailGroups(tasks, 3);

  assert.deepEqual(groups.primary.map((task) => task.id), [1, 4, 7]);
  assert.deepEqual(groups.extra.map((task) => task.id), [2, 3, 5, 6, 8, 9]);
});

test('unsupported row counts fall back to one row', () => {
  assert.deepEqual(runningTaskRailGroups(tasks, 4).extra, []);
});
