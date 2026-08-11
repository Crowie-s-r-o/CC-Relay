import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { RelayDatabase } from '../src/database.mjs';

async function occupyRelayPort() {
  const blocker = createServer();
  const outcome = new Promise((resolve) => {
    blocker.once('listening', () => resolve('listening'));
    blocker.once('error', () => resolve('occupied'));
  });
  blocker.listen(4768, '127.0.0.1');
  return await outcome === 'listening' ? blocker : null;
}

test('a duplicate server start does not recover or dispatch queued work before binding its port', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-startup-'));
  const blocker = await occupyRelayPort();
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  const task = database.createTask({
    title: 'Already running',
    prompt: 'Keep this task untouched.',
    thread: { id: 'relay-existing', title: 'CC Relay existing', source: 'test', cwd: directory },
  });
  database.updateTask(task.id, { status: 'running', started_at: '2026-07-17T10:00:00.000Z' });
  database.close();

  try {
    const child = spawn(process.execPath, [
      // fileURLToPath, never `.pathname`: on Windows the raw pathname is `/C:/...`, which node
      // cannot load, so the child would exit 1 for the wrong reason and pass this test blind.
      fileURLToPath(new URL('../src/server.mjs', import.meta.url)),
      '--relay-data-dir',
      directory,
      '--relay-config-dir',
      directory,
    ], { stdio: 'ignore' });
    const [exitCode] = await once(child, 'exit');
    assert.equal(exitCode, 1);

    const reopened = new RelayDatabase(join(directory, 'relay.sqlite'));
    assert.equal(reopened.getTask(task.id).status, 'running');
    assert.equal(
      reopened.listEvents(task.id).some((event) => event.message.includes('marked interrupted')),
      false,
    );
    reopened.close();
  } finally {
    if (blocker) await new Promise((resolve) => blocker.close(resolve));
    rmSync(directory, { recursive: true, force: true });
  }
});
