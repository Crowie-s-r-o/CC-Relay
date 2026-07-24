import assert from 'node:assert/strict';
import test from 'node:test';
import {
  TerminalRuntimeResolver,
  codexProcessIdFromLsof,
  normalizeTerminalTty,
  processTtysFromPs,
  singleTabTerminalForTty,
} from '../src/terminal-runtime-resolver.mjs';

test('runtime identity parsers require an exact Codex socket, process, TTY, and single-tab window', () => {
  const lsof = [
    'p800',
    'cnode',
    'n127.0.0.1:4769->127.0.0.1:54864',
    'p900',
    'ccodex',
    'n127.0.0.1:54864->127.0.0.1:4769',
  ].join('\n');
  assert.equal(codexProcessIdFromLsof(lsof, { clientPort: 54864, serverPort: 4769 }), 900);
  assert.equal(codexProcessIdFromLsof(`${lsof}\np901\nccodex\nn127.0.0.1:54864->127.0.0.1:4769`, {
    clientPort: 54864,
    serverPort: 4769,
  }), null);
  assert.equal(normalizeTerminalTty('ttys019'), '/dev/ttys019');
  assert.equal(normalizeTerminalTty('??'), null);
  assert.deepEqual(processTtysFromPs('900 ttys019\n901 ??\n'), new Map([[900, '/dev/ttys019']]));
  assert.deepEqual(singleTabTerminalForTty([
    { id: 101, tabs: [{ tty: '/dev/ttys019' }] },
  ], 'ttys019'), {
    terminalWindowId: 101,
    terminalTty: '/dev/ttys019',
  });
  assert.equal(singleTabTerminalForTty([
    { id: 101, tabs: [{ tty: '/dev/ttys019' }, { tty: '/dev/ttys020' }] },
  ], 'ttys019'), null);
});

test('macOS runtime recovery resolves exact Codex and Claude sessions without guessing by project', async () => {
  const calls = [];
  const resolver = new TerminalRuntimeResolver({
    platform: 'darwin',
    codexClientForThread: (threadId) => threadId === 'codex-one'
      ? { clientPort: 54864, serverPort: 4769 }
      : null,
    run: async (command, args) => {
      calls.push([command, args]);
      if (command === 'lsof') {
        return {
          stdout: [
            'p700',
            'cnode',
            'n127.0.0.1:4769->127.0.0.1:54864',
            'p900',
            'ccodex',
            'n127.0.0.1:54864->127.0.0.1:4769',
          ].join('\n'),
        };
      }
      if (command === 'ps') return { stdout: '900 ttys019\n901 ttys020\n' };
      if (command === 'osascript') {
        return { stdout: JSON.stringify([
          { id: 201, tabs: [{ tty: '/dev/ttys019' }] },
          { id: 202, tabs: [{ tty: '/dev/ttys020' }] },
        ]) };
      }
      throw new Error(`Unexpected command: ${command}`);
    },
  });
  const resolved = await resolver.resolve([
    { id: 'codex-one', provider: 'codex', cwd: '/work/shared' },
    {
      id: 'claude-one',
      provider: 'claude',
      cwd: '/work/shared',
      source: 'Claude interactive',
      pid: 901,
    },
  ]);

  assert.deepEqual(resolved, [
    {
      threadId: 'claude-one',
      provider: 'claude',
      path: '/work/shared',
      runtimeProcessId: 901,
      terminalWindowId: 202,
      terminalTty: '/dev/ttys020',
    },
    {
      threadId: 'codex-one',
      provider: 'codex',
      path: '/work/shared',
      runtimeProcessId: 900,
      terminalWindowId: 201,
      terminalTty: '/dev/ttys019',
    },
  ]);
  assert.equal(calls.filter(([command]) => command === 'lsof').length, 1);
  assert.equal(calls.filter(([command]) => command === 'osascript').length, 1);
});

test('runtime recovery refuses two sessions that resolve to the same native window', async () => {
  const resolver = new TerminalRuntimeResolver({
    platform: 'darwin',
    run: async (command) => {
      if (command === 'ps') return { stdout: '501 ttys030\n502 ttys030\n' };
      if (command === 'osascript') {
        return { stdout: JSON.stringify([
          { id: 301, tabs: [{ tty: '/dev/ttys030' }] },
        ]) };
      }
      return { stdout: '' };
    },
  });
  assert.deepEqual(await resolver.resolve([
    { id: 'claude-one', provider: 'claude', cwd: '/work', source: 'Claude interactive', pid: 501 },
    { id: 'claude-two', provider: 'claude', cwd: '/work', source: 'Claude interactive', pid: 502 },
  ]), []);
});
