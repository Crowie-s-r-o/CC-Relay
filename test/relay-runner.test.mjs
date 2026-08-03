import assert from 'node:assert/strict';
import test from 'node:test';
import { RelayRunner } from '../src/relay-runner.mjs';

test('CC Relay runner routes execution to the selected AI provider', async () => {
  const calls = [];
  const runner = new RelayRunner({
    codex: {
      async run() {
        calls.push('codex');
        return { finalResponse: 'Codex result' };
      },
    },
    claude: {
      async run() {
        calls.push('claude');
        return { finalResponse: 'Claude result' };
      },
    },
    planCouncil: {
      async run() {
        calls.push('plan');
        return { finalResponse: 'Plan result' };
      },
    },
    turbo: {
      async run() {
        calls.push('turbo');
        return { finalResponse: 'Turbo result' };
      },
    },
  });

  assert.equal((await runner.run({ mode: 'execute', provider: 'claude' })).finalResponse, 'Claude result');
  assert.equal((await runner.run({ mode: 'execute', provider: 'codex' })).finalResponse, 'Codex result');
  assert.equal((await runner.run({ mode: 'plan', provider: 'council' })).finalResponse, 'Plan result');
  assert.equal((await runner.run({ mode: 'turbo', provider: 'codex' })).finalResponse, 'Turbo result');
  assert.deepEqual(calls, ['claude', 'codex', 'plan', 'turbo']);
});

test('CC Relay runner exposes Turbo preparation separately and scopes cancellation', async () => {
  const calls = [];
  let release;
  const turbo = {
    async prepare(task) {
      calls.push(`prepare:${task.id}`);
      await new Promise((resolve) => { release = resolve; });
      return { status: 'ready' };
    },
    async run(task) { calls.push(`run:${task.id}`); return { finalResponse: 'done' }; },
    cancel(taskId) { calls.push(`cancel:${taskId}`); return true; },
  };
  const runner = new RelayRunner({ turbo });
  const preparation = runner.prepare({ id: 12, mode: 'turbo' }, {});
  assert.deepEqual(calls, ['prepare:12']);
  assert.equal(runner.cancel(12), true);
  release();
  await preparation;
  assert.deepEqual(calls, ['prepare:12', 'cancel:12']);
});
