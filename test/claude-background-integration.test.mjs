import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { ArtifactStore } from '../src/artifacts.mjs';
import { ClaudeExecutionRunner } from '../src/claude-execution-runner.mjs';
import { RelayDatabase } from '../src/database.mjs';
import { TaskQueue } from '../src/queue.mjs';

const SHIM = fileURLToPath(new URL(
  './fixtures/claude-headless-background-shim',
  import.meta.url,
));

function waitFor(predicate, timeout = 2000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - started > timeout) {
        clearInterval(timer);
        reject(new Error('Timed out waiting for the integration queue state.'));
      }
    }, 10);
  });
}

test('real headless child failure stays failed while the clean path completes', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-claude-background-integration-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  const artifacts = new ArtifactStore(join(directory, 'tasks'));
  database.addProject({ path: directory, name: 'Claude background integration' });
  const releases = [];
  const terminalPool = {
    canRun: () => true,
    projectStatus: () => ({
      limits: { codex: 1, claude: 1 },
      active: { codex: 0, claude: 0 },
    }),
    async prepare(task) {
      return database.updateTask(task.id, {
        thread_id: `shim-session-${task.id}`,
        thread_name: `Shim session ${task.id}`,
        thread_source: 'integration-shim',
      });
    },
    async release(taskId) {
      releases.push(taskId);
    },
  };
  const runner = new ClaudeExecutionRunner({
    command: SHIM,
    platform: 'linux',
    sessions: { readConnectedSession: async () => ({ rawStatus: 'idle' }) },
  });
  const queue = new TaskQueue({
    database,
    artifacts,
    runner,
    terminalPool,
    retryDelayMs: 10,
  });

  try {
    const pending = queue.enqueue({
      title: 'Pending shim',
      prompt: 'RELAY_SHIM_PENDING',
      repoPath: directory,
      provider: 'claude',
      mode: 'execute',
      terminalLifecycle: 'disposable',
    });
    await waitFor(() => database.getTask(pending.id).status === 'failed');
    await new Promise((resolve) => setTimeout(resolve, 30));

    assert.match(database.getTask(pending.id).error, /Continue session/);
    assert.equal(queue.pendingRetryTaskIds().has(pending.id), false);
    assert.equal(
      database.listEvents(pending.id).some((event) => event.message === 'Task completed.'),
      false,
    );
    assert.deepEqual(releases, [pending.id]);

    const clean = queue.enqueue({
      title: 'Clean shim',
      prompt: 'RELAY_SHIM_CLEAN',
      repoPath: directory,
      provider: 'claude',
      mode: 'execute',
      terminalLifecycle: 'disposable',
    });
    await waitFor(() => database.getTask(clean.id).status === 'complete');

    assert.equal(database.getTask(clean.id).result, 'Clean shim response.');
    assert.deepEqual(releases, [pending.id, clean.id]);
    assert.equal(
      database.listEvents(clean.id).some((event) => event.message === 'Task completed.'),
      true,
    );
  } finally {
    await queue.shutdown();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
