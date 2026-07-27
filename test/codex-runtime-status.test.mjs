import assert from 'node:assert/strict';
import test from 'node:test';
import { readCodexRuntimeStatus } from '../src/codex-runtime-status.mjs';

test('Codex status reports an installed and signed-in CLI', async () => {
  const status = await readCodexRuntimeStatus({
    run: async (_command, args) => ({
      stdout: args[0] === '--version' ? 'codex-cli 1.2.3\n' : 'Logged in using ChatGPT\n',
    }),
  });

  assert.deepEqual(status, {
    available: true,
    authenticated: true,
    version: 'codex-cli 1.2.3',
    reason: null,
    pending: false,
  });
});

test('Codex status keeps an installed but signed-out CLI available', async () => {
  const status = await readCodexRuntimeStatus({
    run: async (_command, args) => {
      if (args[0] === '--version') return { stdout: 'codex-cli 1.2.3\n' };
      throw Object.assign(new Error('Command failed'), { stderr: 'Not logged in' });
    },
  });

  assert.equal(status.available, true);
  assert.equal(status.authenticated, false);
  assert.equal(status.version, 'codex-cli 1.2.3');
  assert.equal(status.reason, 'signed_out');
});

test('Codex status reports a missing executable only when the version probe fails', async () => {
  const status = await readCodexRuntimeStatus({
    run: async () => {
      throw Object.assign(new Error('spawn codex ENOENT'), { code: 'ENOENT' });
    },
  });

  assert.equal(status.available, false);
  assert.equal(status.authenticated, false);
  assert.equal(status.version, null);
  assert.equal(status.reason, 'not_installed');
});

test('Codex status does not call a transient version probe failure not installed', async () => {
  const status = await readCodexRuntimeStatus({
    run: async () => {
      throw Object.assign(new Error('Codex version probe timed out'), { code: 'ETIMEDOUT' });
    },
  });

  assert.equal(status.available, false);
  assert.equal(status.reason, 'probe_failed');
});
