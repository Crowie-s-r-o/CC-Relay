import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parallelClaudeRestartRequired,
  projectQueueRestartRequired,
} from '../public/project-queue-state.js';

test('an old global scheduler is identified only when another project blocks waiting work', () => {
  assert.equal(projectQueueRestartRequired({
    supported: false,
    queuedCount: 1,
    otherProjectRunning: true,
  }), true);

  assert.equal(projectQueueRestartRequired({
    supported: undefined,
    queuedCount: 2,
    otherProjectRunning: true,
  }), true);
});

test('upgraded, paused, idle, and locally running queues do not show a restart warning', () => {
  const base = { supported: false, queuedCount: 1, otherProjectRunning: true };
  assert.equal(projectQueueRestartRequired({ ...base, supported: true }), false);
  assert.equal(projectQueueRestartRequired({ ...base, paused: true }), false);
  assert.equal(projectQueueRestartRequired({ ...base, queuedCount: 0 }), false);
  assert.equal(projectQueueRestartRequired({ ...base, projectRunning: true }), false);
  assert.equal(projectQueueRestartRequired({ ...base, otherProjectRunning: false }), false);
});

test('an older backend identifies Claude work blocked behind another project session', () => {
  const queuedTasks = [{
    status: 'queued', mode: 'execute', provider: 'claude', thread_id: 'claude-project-two',
  }];
  const runningTasks = [{
    status: 'running', mode: 'execute', provider: 'claude', thread_id: 'claude-project-one',
  }];

  assert.equal(parallelClaudeRestartRequired({ queuedTasks, runningTasks }), true);
  assert.equal(parallelClaudeRestartRequired({ supported: false, queuedTasks, runningTasks }), true);
  assert.equal(parallelClaudeRestartRequired({ supported: true, queuedTasks, runningTasks }), false);
  assert.equal(parallelClaudeRestartRequired({ queuedTasks: [], runningTasks }), false);
  assert.equal(parallelClaudeRestartRequired({
    queuedTasks,
    runningTasks: [{ ...runningTasks[0], thread_id: 'claude-project-two' }],
  }), false);
});
