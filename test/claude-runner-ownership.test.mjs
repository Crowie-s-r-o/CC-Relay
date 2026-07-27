import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { ClaudeRunner } from '../src/claude-runner.mjs';

function fakeChild(killed) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.kill = () => { killed.push(child); return true; };
  return child;
}

function stageOptions(owner) {
  return {
    cwd: '/tmp/project',
    model: 'opus',
    effort: 'max',
    owner,
    onEvent: () => {},
    onStderr: () => {},
  };
}

function runnerWith(killed, children = []) {
  return new ClaudeRunner({
    spawnProcess: () => {
      const child = fakeChild(killed);
      children.push(child);
      return child;
    },
  });
}

// queue.planAhead() starts one forward-planning preparation per project, so more than one
// Claude plan stage can be in flight. A single shared slot made the second one fail.
test('Claude stages for different owners run at the same time', () => {
  const runner = runnerWith([]);
  const first = runner.run('First.', stageOptions(101));
  first.catch(() => {});
  const second = runner.run('Second.', stageOptions(202));
  second.catch(() => {});
  assert.equal(runner.stages.size, 2);
});

test('a second stage for the same owner is still refused', () => {
  const runner = runnerWith([]);
  runner.run('First.', stageOptions(101)).catch(() => {});
  assert.throws(
    () => runner.run('Again.', stageOptions(101)),
    /already has an active Relay plan stage/,
  );
});

// cancel() used to ignore its argument, so a stage timeout in one project's plan council
// stopped whichever Claude stage happened to be newest rather than its own.
test('cancel stops only the named owner stage', () => {
  const killed = [];
  const runner = runnerWith(killed);
  runner.run('First.', stageOptions(101)).catch(() => {});
  runner.run('Second.', stageOptions(202)).catch(() => {});
  const second = runner.stages.get('202');

  assert.equal(runner.cancel(101), true);
  assert.equal(killed.length, 1);
  assert.equal(runner.stages.get('101').cancelRequested, true);
  assert.equal(second.cancelRequested, false, 'the other project stage must be untouched');

  assert.equal(runner.cancel('missing-owner'), false);
  assert.equal(killed.length, 1);
});

test('cancel without an owner still stops every stage for shutdown', () => {
  const killed = [];
  const children = [];
  const runner = runnerWith(killed, children);
  runner.run('First.', stageOptions(101)).catch(() => {});
  runner.run('Second.', stageOptions(202)).catch(() => {});

  assert.equal(runner.cancel(), true);
  assert.equal(killed.length, 2, 'both stages receive SIGTERM');
  for (const stage of runner.stages.values()) {
    assert.equal(stage.cancelRequested, true);
  }

  // A stage is only released when its child actually closes, which is what lets the run
  // promise reject as cancelled rather than as a failure.
  for (const child of children) child.emit('close', null, 'SIGTERM');
  assert.equal(runner.stages.size, 0);
  assert.equal(runner.cancel(), false, 'nothing is left to cancel once every stage closed');
});

test('a finished stage releases its owner slot', () => {
  const children = [];
  const runner = runnerWith([], children);
  runner.run('First.', stageOptions(101)).catch(() => {});
  children[0].emit('close', 1, null);

  assert.equal(runner.stages.size, 0);
  assert.doesNotThrow(() => {
    runner.run('Retry.', stageOptions(101)).catch(() => {});
  });
});

test('an unnamed stage never collides with another unnamed stage', () => {
  const runner = runnerWith([]);
  runner.run('First.', { ...stageOptions(101), owner: null }).catch(() => {});
  assert.doesNotThrow(() => {
    runner.run('Second.', { ...stageOptions(202), owner: null }).catch(() => {});
  });
  assert.equal(runner.stages.size, 2);
});
