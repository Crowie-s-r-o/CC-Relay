import assert from 'node:assert/strict';
import test from 'node:test';
import { RelayRunner } from '../src/relay-runner.mjs';

test('Relay runner routes execution to the selected AI provider', async () => {
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
