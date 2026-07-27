import assert from 'node:assert/strict';
import test from 'node:test';
import {
  blockingTerminalTask,
  taskUsesTerminal,
  terminalControlState,
} from '../src/terminal-control.mjs';

test('queued and running direct tasks protect their assigned terminal', () => {
  const queued = { id: 11, status: 'queued', thread_id: 'relay-one' };
  const running = { id: 12, status: 'running', thread_id: 'relay-one' };
  const complete = { id: 13, status: 'complete', thread_id: 'relay-one' };

  assert.equal(taskUsesTerminal(queued, 'relay-one'), true);
  assert.equal(taskUsesTerminal(complete, 'relay-one'), false);
  assert.equal(blockingTerminalTask([queued, complete, running], 'relay-one'), running);
  assert.deepEqual(terminalControlState([queued], 'relay-one', { launchId: 'launch-one' }), {
    owned: true,
    canClose: false,
    reason: 'Task #11 is queued on this terminal. Cancel or reassign it before closing the terminal.',
  });
});

test('Turbo planner and worker assignments protect every participating Relay', () => {
  const task = {
    id: 21,
    status: 'running',
    thread_id: 'planner',
    turbo: {
      plannerThreadId: 'planner',
      workers: [{ threadId: 'worker-one' }, { threadId: 'worker-two' }],
    },
  };

  assert.equal(taskUsesTerminal(task, 'planner'), true);
  assert.equal(taskUsesTerminal(task, 'worker-two'), true);
  assert.equal(taskUsesTerminal(task, 'unrelated'), false);
});

test('Plan council protects both its Claude author and Codex reviewer terminals', () => {
  const task = {
    id: 22,
    status: 'queued',
    mode: 'plan',
    thread_id: 'codex-reviewer',
    author_thread_id: 'claude-author',
  };

  assert.equal(taskUsesTerminal(task, 'codex-reviewer'), true);
  assert.equal(taskUsesTerminal(task, 'claude-author'), true);
  assert.equal(taskUsesTerminal(task, 'unrelated'), false);
});

test('only an idle terminal with verified native identity can close', () => {
  assert.deepEqual(terminalControlState([], 'relay-one', null), {
    owned: false,
    canClose: false,
    reason: 'Relay could not map this session to one unambiguous native terminal window.',
  });
  assert.deepEqual(terminalControlState([], 'relay-one', { launchId: 'launch-one' }), {
    owned: true,
    canClose: true,
    reason: null,
  });
  assert.deepEqual(terminalControlState([
    { id: 30, status: 'retrying', thread_id: 'relay-one' },
  ], 'relay-one', { launchId: 'launch-one' }), {
    owned: true,
    canClose: false,
    reason: 'Task #30 is scheduled to retry on this terminal. Wait for it to requeue, then cancel or reassign it before closing the terminal.',
  });
});
