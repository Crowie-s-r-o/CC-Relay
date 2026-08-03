import assert from 'node:assert/strict';
import test from 'node:test';
import {
  blockingTerminalTask,
  retainedSessionTaskForThread,
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

test('Turbo planner and worker assignments protect every participating CC Relay', () => {
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
    reason: 'CC Relay could not map this session to one unambiguous native terminal window.',
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

test('a retained session task claims its terminal close regardless of task status', () => {
  const finished = {
    id: 41,
    status: 'complete',
    thread_id: 'retained-one',
    keep_terminal_open: true,
    terminal_lifecycle: 'disposable',
  };
  const running = { ...finished, id: 42, status: 'running' };
  const queued = { ...finished, id: 43, status: 'queued' };

  assert.equal(retainedSessionTaskForThread([finished], 'retained-one'), finished);
  assert.equal(retainedSessionTaskForThread([running], 'retained-one'), running);
  assert.equal(retainedSessionTaskForThread([queued], 'retained-one'), queued);
});

test('the newest retained session task wins when a terminal served several turns', () => {
  const base = {
    thread_id: 'retained-one',
    keep_terminal_open: true,
    terminal_lifecycle: 'disposable',
    status: 'complete',
  };
  const tasks = [
    { ...base, id: 7 },
    { ...base, id: 19 },
    { ...base, id: 12 },
  ];

  assert.equal(retainedSessionTaskForThread(tasks, 'retained-one').id, 19);
});

test('only a disposable task that kept its own terminal open counts as the retained session', () => {
  const retained = {
    id: 51,
    status: 'complete',
    thread_id: 'retained-one',
    keep_terminal_open: true,
    terminal_lifecycle: 'disposable',
  };

  assert.equal(retainedSessionTaskForThread([retained], 'retained-two'), null);
  assert.equal(
    retainedSessionTaskForThread([{ ...retained, keep_terminal_open: false }], 'retained-one'),
    null,
  );
  assert.equal(
    retainedSessionTaskForThread([{ ...retained, terminal_lifecycle: 'persistent' }], 'retained-one'),
    null,
  );
  assert.equal(
    retainedSessionTaskForThread([{ ...retained, thread_id: null, author_thread_id: 'retained-one' }], 'retained-one'),
    null,
  );
  assert.equal(retainedSessionTaskForThread([retained], ''), null);
  assert.equal(retainedSessionTaskForThread(null, 'retained-one'), null);
});
