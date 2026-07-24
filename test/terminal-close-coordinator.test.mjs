import assert from 'node:assert/strict';
import test from 'node:test';
import { TerminalCloseCoordinator } from '../src/terminal-close-coordinator.mjs';

function ownedTerminal() {
  return { launchId: 'launch-one', threadId: 'relay-one', provider: 'codex', path: '/work/project' };
}

test('terminal close reserves the thread, verifies the live session, and releases afterward', async () => {
  const closing = new Set();
  let releaseClose;
  const closeGate = new Promise((resolve) => { releaseClose = resolve; });
  let releases = 0;
  const coordinator = new TerminalCloseCoordinator({
    closingThreadIds: closing,
    launcher: {
      terminalForThread: () => ownedTerminal(),
      closeOwnedTerminal: async (threadId) => {
        assert.equal(closing.has(threadId), true);
        await closeGate;
        return { threadId };
      },
    },
    listTasks: () => [],
    readSession: async () => ({ id: 'relay-one', provider: 'codex', cwd: '/work/project' }),
    onReleased: () => { releases += 1; },
  });

  const close = coordinator.close('relay-one');
  await Promise.resolve();
  assert.equal(closing.has('relay-one'), true);
  assert.deepEqual(coordinator.controlState('relay-one'), {
    owned: true, canClose: false, reason: 'That terminal is already closing.',
  });
  await assert.rejects(() => coordinator.close('relay-one'), /already closing/);
  releaseClose();
  assert.deepEqual(await close, { threadId: 'relay-one' });
  assert.equal(closing.has('relay-one'), false);
  assert.equal(releases, 1);
});

test('terminal close refuses unowned, disconnected, and task-protected sessions', async () => {
  const base = {
    listTasks: () => [],
    readSession: async () => ({ id: 'relay-one', provider: 'codex', cwd: '/work/project' }),
    launcher: {
      terminalForThread: () => null,
      closeOwnedTerminal: async () => assert.fail('close must not run'),
    },
  };
  await assert.rejects(() => new TerminalCloseCoordinator(base).close('relay-one'), /could not verify an exact native terminal/);

  base.launcher.terminalForThread = () => ownedTerminal();
  base.readSession = async () => null;
  await assert.rejects(() => new TerminalCloseCoordinator(base).close('relay-one'), /no longer connected/);

  base.readSession = async () => ({ id: 'relay-one', provider: 'codex', cwd: '/work/project' });
  base.listTasks = () => [{ id: 44, status: 'queued', thread_id: 'relay-one' }];
  await assert.rejects(() => new TerminalCloseCoordinator(base).close('relay-one'), /Task #44 is queued/);
});

test('a failed close always releases the terminal reservation', async () => {
  const closing = new Set();
  let releases = 0;
  const coordinator = new TerminalCloseCoordinator({
    closingThreadIds: closing,
    launcher: {
      terminalForThread: () => ownedTerminal(),
      closeOwnedTerminal: async () => { throw new Error('native close failed'); },
    },
    listTasks: () => [],
    readSession: async () => ({ id: 'relay-one', provider: 'codex', cwd: '/work/project' }),
    onReleased: () => { releases += 1; },
  });

  await assert.rejects(() => coordinator.close('relay-one'), /native close failed/);
  assert.equal(closing.size, 0);
  assert.equal(releases, 1);
});

test('terminal close revalidates recovered runtime identity before native close', async () => {
  let nativeCloseCalled = false;
  const coordinator = new TerminalCloseCoordinator({
    launcher: {
      terminalForThread: () => ownedTerminal(),
      verifyTerminalForThread: async () => false,
      closeOwnedTerminal: async () => { nativeCloseCalled = true; },
    },
    listTasks: () => [],
    readSession: async () => ({ id: 'relay-one', provider: 'codex', cwd: '/work/project' }),
  });

  await assert.rejects(() => coordinator.close('relay-one'), /process or native window changed/);
  assert.equal(nativeCloseCalled, false);
});
