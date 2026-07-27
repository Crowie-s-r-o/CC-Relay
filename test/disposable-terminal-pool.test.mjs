import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ArtifactStore } from '../src/artifacts.mjs';
import { RelayDatabase } from '../src/database.mjs';
import {
  DisposableTerminalPool,
  disposableTerminalRequirements,
} from '../src/disposable-terminal-pool.mjs';

function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'relay-disposable-pool-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  const artifacts = new ArtifactStore(join(directory, 'artifacts'));
  const project = database.addProject({ path: directory, name: 'Pool project' });
  const launches = [];
  const closes = [];
  let sequence = 0;
  const coordinator = {
    async launch(path, provider, layout, options) {
      sequence += 1;
      const threadId = options.resumeThreadId || `${provider}-thread-${sequence}`;
      launches.push({ path, provider, layout, options });
      return {
        launchId: `${provider}-launch-${sequence}`,
        threadId,
        thread: {
          id: threadId,
          provider,
          cwd: path,
          title: `${provider} ${sequence}`,
          source: 'test terminal',
        },
      };
    },
  };
  const launcher = {
    async closeOwnedTerminal(threadId) {
      closes.push(threadId);
    },
    async closeOwnedLaunch(launchId) {
      closes.push(launchId);
    },
  };
  const pool = new DisposableTerminalPool({
    database,
    artifacts,
    coordinator,
    launcher,
  });
  return { directory, database, artifacts, project, pool, launches, closes };
}

test('direct disposable tasks launch fresh, close, and later resume the saved conversation', async () => {
  const context = setup();
  try {
    const first = context.database.createTask({
      title: 'Fresh Claude task',
      prompt: 'Work',
      repoPath: context.directory,
      provider: 'claude',
      terminalLifecycle: 'disposable',
      terminalLayout: { enabled: false, background: true },
    });
    context.artifacts.initializeTask(first);

    const prepared = await context.pool.prepare(first);
    assert.equal(prepared.thread_id, 'claude-thread-1');
    assert.equal(context.launches[0].options.resumeThreadId, null);
    assert.deepEqual(context.launches[0].layout, { enabled: false, background: true });
    assert.deepEqual(await context.pool.release(first.id), { closed: 1, failed: 0 });
    assert.deepEqual(context.closes, ['claude-launch-1']);

    const continuation = context.database.createTask({
      title: 'Continue Claude task',
      prompt: 'Keep going',
      repoPath: context.directory,
      thread: {
        id: prepared.thread_id,
        title: prepared.thread_name,
        source: prepared.thread_source,
        cwd: context.directory,
      },
      provider: 'claude',
      continuedFromTaskId: first.id,
      terminalLifecycle: 'disposable',
    });
    context.artifacts.initializeTask(continuation);
    const resumed = await context.pool.prepare(continuation);
    assert.equal(resumed.thread_id, prepared.thread_id);
    assert.equal(context.launches[1].options.resumeThreadId, prepared.thread_id);
    await context.pool.release(continuation.id);
  } finally {
    context.database.close();
    rmSync(context.directory, { recursive: true, force: true });
  }
});

test('a rejected resumed binding is closed once and never marked for automatic retry', async () => {
  const context = setup();
  try {
    const task = context.database.createTask({
      title: 'Continue Codex task',
      prompt: 'Keep going',
      repoPath: context.directory,
      thread: {
        id: 'saved-codex-conversation',
        title: 'Saved Codex conversation',
        source: 'test terminal',
        cwd: context.directory,
      },
      provider: 'codex',
      continuedFromTaskId: 1,
      terminalLifecycle: 'disposable',
    });
    context.artifacts.initializeTask(task);
    context.pool.coordinator = {
      async launch() {
        return {
          launchId: 'rejected-resume-launch',
          connectionStatus: 'binding_rejected',
          bindingError: 'That connected session is already bound to another terminal launch.',
        };
      },
    };

    await assert.rejects(
      () => context.pool.prepare(task),
      (error) => {
        assert.match(error.message, /already bound/);
        assert.equal(error.retryable, false);
        return true;
      },
    );
    assert.deepEqual(context.closes, ['rejected-resume-launch']);
    assert.equal(context.pool.allocations.has(task.id), false);
  } finally {
    context.database.close();
    rmSync(context.directory, { recursive: true, force: true });
  }
});

test('Plan council and Turbo declare their complete provider slot requirements', () => {
  assert.deepEqual(disposableTerminalRequirements({
    terminal_lifecycle: 'disposable',
    mode: 'plan',
  }), { codex: 1, claude: 1 });
  assert.deepEqual(disposableTerminalRequirements({
    terminal_lifecycle: 'disposable',
    mode: 'turbo',
    turbo: { workerCount: 3, council: { enabled: true } },
  }), { codex: 4, claude: 1 });
});

test('project limits gate automatic tasks without counting another project', () => {
  const context = setup();
  try {
    context.database.updateProjectInstanceLimits(context.project.id, { codex: 2, claude: 1 });
    const task = {
      id: 10,
      repo_path: context.directory,
      terminal_lifecycle: 'disposable',
      mode: 'execute',
      provider: 'codex',
    };
    const another = { ...task, id: 11 };
    const otherProject = { ...task, id: 12, repo_path: '/another/project' };
    assert.equal(context.pool.canRun(task, []), true);
    assert.equal(context.pool.canRun(task, [another]), true);
    assert.equal(context.pool.canRun(task, [another, { ...another, id: 13 }]), false);
    assert.equal(context.pool.canRun(task, [otherProject]), true);

    const turbo = {
      ...task,
      id: 14,
      mode: 'turbo',
      turbo: { workerCount: 2 },
    };
    assert.match(context.pool.capacityIssue(turbo), /needs 3 Codex instances/);
  } finally {
    context.database.close();
    rmSync(context.directory, { recursive: true, force: true });
  }
});

test('partial fleet launch keeps the complete workflow requirement reserved', () => {
  const context = setup();
  try {
    context.database.updateProjectInstanceLimits(context.project.id, { codex: 1, claude: 1 });
    const council = context.database.createTask({
      title: 'Council',
      prompt: 'Plan it',
      repoPath: context.directory,
      provider: 'council',
      mode: 'plan',
      terminalLifecycle: 'disposable',
    });
    context.pool.allocations.set(council.id, [{
      provider: 'claude',
      repoPath: context.directory,
      launchId: 'partial-claude-launch',
      threadId: 'partial-claude-thread',
      thread: {
        id: 'partial-claude-thread',
        provider: 'claude',
        cwd: context.directory,
      },
    }]);
    const directCodex = {
      id: 200,
      repo_path: context.directory,
      terminal_lifecycle: 'disposable',
      mode: 'execute',
      provider: 'codex',
    };

    assert.deepEqual(context.pool.projectStatus(context.directory, [council]).active, {
      codex: 1,
      claude: 1,
    });
    assert.equal(context.pool.canRun(directCodex, [council]), false);
  } finally {
    context.database.close();
    rmSync(context.directory, { recursive: true, force: true });
  }
});

test('a retained launch still consumes capacity after its task row is deleted', () => {
  const context = setup();
  try {
    const finished = context.database.createTask({
      title: 'Cleanup failed',
      prompt: 'Work',
      repoPath: context.directory,
      provider: 'codex',
      terminalLifecycle: 'disposable',
    });
    context.pool.allocations.set(finished.id, [{
      provider: 'codex',
      repoPath: context.directory,
      launchId: 'retained-codex-launch',
      threadId: 'retained-codex-thread',
      thread: {
        id: 'retained-codex-thread',
        provider: 'codex',
        cwd: context.directory,
      },
    }]);
    context.database.deleteTask(finished.id);
    const fresh = {
      id: 201,
      repo_path: context.directory,
      terminal_lifecycle: 'disposable',
      mode: 'execute',
      provider: 'codex',
    };

    assert.equal(context.pool.canRun(fresh), false);
    assert.equal(context.pool.projectStatus(context.directory).active.codex, 1);
    context.database.updateProjectInstanceLimits(context.project.id, { codex: 2, claude: 1 });
    assert.equal(context.pool.canRun(fresh), true);
    assert.equal(context.pool.canRun({
      ...fresh,
      id: 202,
      thread_id: 'retained-codex-thread',
    }), false);
  } finally {
    context.database.close();
    rmSync(context.directory, { recursive: true, force: true });
  }
});

test('an unbound launch remains counted when exact cleanup fails', async () => {
  const context = setup();
  try {
    context.pool.coordinator.launch = async () => ({
      launchId: 'unbound-codex-launch',
      threadId: null,
    });
    context.pool.launcher.closeOwnedLaunch = async () => {
      throw new Error('native close failed');
    };
    const task = context.database.createTask({
      title: 'Binding timeout',
      prompt: 'Work',
      repoPath: context.directory,
      provider: 'codex',
      terminalLifecycle: 'disposable',
    });
    context.artifacts.initializeTask(task);

    await assert.rejects(context.pool.prepare(task), /did not connect to Relay in time/);
    assert.equal(context.pool.projectStatus(context.directory).active.codex, 1);
    assert.equal(context.pool.canRun({
      id: 203,
      repo_path: context.directory,
      terminal_lifecycle: 'disposable',
      mode: 'execute',
      provider: 'codex',
    }), false);
  } finally {
    context.database.close();
    rmSync(context.directory, { recursive: true, force: true });
  }
});
