import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

// The shipped JXA source is executed here against a fake Terminal application. Terminal.app
// answers null for the tabs of a window it cannot describe, and the former one-expression
// inventory called .map() on that null. One such window aborted the whole script, so every
// exact-terminal identity failed at once. Task 39's Plan council revision died that way on
// 2026-07-30 three milliseconds after terminal.recovery.native_inspection_failed.
// The evaluated body is this repository's own committed source, never test input or any
// value derived from one, so running it here carries no injection surface.
function evaluateTerminalInventory(windows, { running = true } = {}) {
  const source = readFileSync(new URL('../src/terminal-runtime-resolver.mjs', import.meta.url), 'utf8');
  const script = source.match(/const DARWIN_TERMINAL_INVENTORY = `([\s\S]*?)`;/)?.[1];
  assert.ok(script, 'the macOS Terminal inventory script must stay readable from source');
  assert.equal(/window\.tabs\(\)\.map/.test(script), false);
  const evaluate = new Function('Application', `${script}\nreturn terminalInventory();`);
  return evaluate(() => ({
    running: () => running,
    windows: () => windows,
  }));
}

test('the macOS Terminal inventory survives a window whose tabs cannot be read', () => {
  const unreadableWindow = { id: () => 900, tabs: () => null };
  const throwingWindow = {
    id: () => 901,
    tabs: () => { throw new Error('Terminal cannot describe this window.'); },
  };
  const namedWindow = { id: () => 902, tabs: () => [{ tty: () => '/dev/ttys019' }] };
  assert.deepEqual(
    evaluateTerminalInventory([unreadableWindow, throwingWindow, namedWindow]),
    [
      { id: 900, tabs: [] },
      { id: 901, tabs: [] },
      { id: 902, tabs: [{ tty: '/dev/ttys019' }] },
    ],
  );
  assert.deepEqual(evaluateTerminalInventory([namedWindow], { running: false }), []);
});

test('an unreadable tab still occupies its position so a multi-tab window stays unclosable', () => {
  const inventory = evaluateTerminalInventory([{
    id: () => 903,
    tabs: () => [
      { tty: () => { throw new Error('Terminal cannot read this tab.'); } },
      { tty: () => '/dev/ttys021' },
    ],
  }]);
  assert.deepEqual(inventory, [{ id: 903, tabs: [{ tty: null }, { tty: '/dev/ttys021' }] }]);
  // Dropping the unreadable tab would make this look like a single-tab window and authorize
  // closing a window that still holds unrelated work.
  assert.equal(singleTabTerminalForTty(inventory, 'ttys021'), null);
});

test('one unreadable Terminal window does not hide every other exact session', async () => {
  const resolver = new TerminalRuntimeResolver({
    platform: 'darwin',
    run: async (command) => {
      if (command === 'ps') return { stdout: '901 ttys040\n' };
      if (command === 'osascript') {
        return { stdout: JSON.stringify([
          { id: 401, tabs: null },
          { id: 402, tabs: [{ tty: '/dev/ttys040' }] },
        ]) };
      }
      return { stdout: '' };
    },
  });
  assert.deepEqual(await resolver.resolve([
    { id: 'claude-one', provider: 'claude', cwd: '/work', source: 'Claude interactive', pid: 901 },
  ]), [{
    threadId: 'claude-one',
    provider: 'claude',
    path: '/work',
    runtimeProcessId: 901,
    terminalWindowId: 402,
    terminalTty: '/dev/ttys040',
  }]);
});
