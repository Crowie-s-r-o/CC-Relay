import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OpenCodeRuntimeStatus,
  parseOpenCodeModels,
  readOpenCodeRuntimeStatus,
  resolveOpenCodeCommand,
} from '../src/opencode-runtime-status.mjs';

test('OpenCode model output becomes an account model catalog', () => {
  assert.deepEqual(parseOpenCodeModels('\u001b[32manthropic/claude-sonnet-4\u001b[0m\nopenrouter/meta/llama-4\nopenai/gpt-5\nanthropic/claude-sonnet-4\nnoise'), [
    {
      model: 'anthropic/claude-sonnet-4',
      displayName: 'anthropic/claude-sonnet-4',
      description: 'OpenCode model anthropic/claude-sonnet-4.',
      isDefault: false,
      defaultReasoningEffort: null,
      supportedReasoningEfforts: [],
    },
    {
      model: 'openrouter/meta/llama-4',
      displayName: 'openrouter/meta/llama-4',
      description: 'OpenCode model openrouter/meta/llama-4.',
      isDefault: false,
      defaultReasoningEffort: null,
      supportedReasoningEfforts: [],
    },
    {
      model: 'openai/gpt-5',
      displayName: 'openai/gpt-5',
      description: 'OpenCode model openai/gpt-5.',
      isDefault: false,
      defaultReasoningEffort: null,
      supportedReasoningEfforts: [],
    },
  ]);
});

test('OpenCode runtime uses version and native model probes', async () => {
  const calls = [];
  const status = await readOpenCodeRuntimeStatus({
    command: '/bin/opencode',
    run: async (command, args) => {
      calls.push([command, args]);
      return args[0] === '--version'
        ? { stdout: '1.2.3\n' }
        : { stdout: 'anthropic/claude-sonnet-4\n' };
    },
  });
  assert.equal(status.available, true);
  assert.equal(status.authenticated, true);
  assert.equal(status.models[0].model, 'default');
  assert.equal(status.models[1].model, 'anthropic/claude-sonnet-4');
  assert.deepEqual(calls.map((call) => call[1]), [['--version'], ['models']]);
});

test('OpenCode runtime cache is read only until refreshed', async () => {
  let reads = 0;
  const runtime = new OpenCodeRuntimeStatus({
    command: 'opencode',
    read: async () => {
      reads += 1;
      return { available: true, authenticated: true, version: '1', models: [] };
    },
  });
  assert.equal(runtime.current().pending, true);
  assert.equal(reads, 0);
  await runtime.refresh();
  assert.equal(runtime.current().available, true);
  assert.equal(reads, 1);
});

test('OpenCode command resolution includes its native install directory', () => {
  const command = resolveOpenCodeCommand({
    home: '/users/test',
    env: { PATH: '/usr/bin' },
    platform: 'darwin',
    fileExists: (path) => path === '/users/test/.opencode/bin/opencode',
  });
  assert.equal(command, '/users/test/.opencode/bin/opencode');
});

test('OpenCode runtime re-resolves an installation that appears after startup', async () => {
  const commands = ['/missing/opencode', '/installed/opencode'];
  const reads = [];
  const runtime = new OpenCodeRuntimeStatus({
    resolveCommand: () => commands.shift() || '/installed/opencode',
    read: async ({ command }) => {
      reads.push(command);
      return command === '/installed/opencode'
        ? { available: true, authenticated: true, version: '2', models: [] }
        : { available: false, authenticated: false, reason: 'not_installed', models: [] };
    },
  });
  await runtime.refresh({ force: true });
  await runtime.refresh({ force: true });
  assert.deepEqual(reads, ['/missing/opencode', '/installed/opencode']);
});
