import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ArtifactStore } from '../src/artifacts.mjs';
import { RelayDatabase } from '../src/database.mjs';
import { DisposableTerminalPool } from '../src/disposable-terminal-pool.mjs';
import { TaskQueue } from '../src/queue.mjs';

function harness({ codex = 3, claude = 1 } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'relay-council-capacity-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  const artifacts = new ArtifactStore(join(directory, 'tasks'));
  const project = database.addProject({ path: directory, name: 'Council capacity' });
  database.updateProjectInstanceLimits(project.id, { codex, claude });
  const terminalPool = new DisposableTerminalPool({
    database,
    artifacts,
    coordinator: {},
    launcher: {},
  });
  const queue = new TaskQueue({
    database,
    artifacts,
    terminalPool,
    runner: { run: () => new Promise(() => {}), cancel: () => false },
  });
  database.setPaused(true);
  return {
    directory,
    database,
    terminalPool,
    queue,
    close() {
      database.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

function addExecute(context, title, provider) {
  return context.queue.enqueue({
    title,
    prompt: `Execute ${title}`,
    repoPath: context.directory,
    provider,
    mode: 'execute',
    terminalLifecycle: 'disposable',
  });
}

function addCouncil(context, title = 'Plan council') {
  return addCouncilInProject(context, context.directory, title);
}

function addCouncilInProject(context, repoPath, title) {
  return context.queue.enqueue({
    title,
    prompt: `Plan ${title}`,
    repoPath,
    provider: 'council',
    mode: 'plan',
    terminalLifecycle: 'disposable',
  });
}

function markRunning(context, task) {
  const running = { ...task, status: 'running' };
  context.queue.activeTasks.set(task.id, running);
  context.database.updateTask(task.id, { status: 'running' });
  return running;
}

function runnableTitles(context) {
  context.database.setPaused(false);
  try {
    return context.queue.runnableTasks().map((task) => task.title);
  } finally {
    context.database.setPaused(true);
  }
}

test('a disposable Plan council starts beside one running Codex task when both provider limits fit', () => {
  const context = harness({ codex: 3, claude: 1 });
  try {
    const direct = markRunning(context, addExecute(context, 'Existing Codex task', 'codex'));
    addCouncil(context);

    assert.deepEqual(
      context.terminalPool.projectStatus(context.directory, [direct]).active,
      { codex: 1, claude: 0 },
    );
    assert.deepEqual(runnableTitles(context), ['Plan council']);
  } finally {
    context.close();
  }
});

test('a disposable Plan council still waits when either required provider is full', () => {
  const codexFull = harness({ codex: 1, claude: 1 });
  try {
    markRunning(codexFull, addExecute(codexFull, 'Only Codex slot', 'codex'));
    addCouncil(codexFull);
    assert.deepEqual(runnableTitles(codexFull), []);
  } finally {
    codexFull.close();
  }

  const claudeFull = harness({ codex: 3, claude: 1 });
  try {
    markRunning(claudeFull, addExecute(claudeFull, 'Only Claude slot', 'claude'));
    addCouncil(claudeFull);
    assert.deepEqual(runnableTitles(claudeFull), []);
  } finally {
    claudeFull.close();
  }
});

test('a running disposable Plan council leaves unused provider capacity available', () => {
  const context = harness({ codex: 3, claude: 1 });
  try {
    markRunning(context, addCouncil(context));
    addExecute(context, 'Spare Codex task', 'codex');
    addExecute(context, 'Blocked Claude task', 'claude');

    assert.deepEqual(runnableTitles(context), ['Spare Codex task']);
  } finally {
    context.close();
  }
});

test('one scheduling pass admits a disposable council and surrounding direct tasks when all fit', () => {
  const context = harness({ codex: 3, claude: 1 });
  try {
    addExecute(context, 'Codex before council', 'codex');
    addCouncil(context);
    addExecute(context, 'Codex after council', 'codex');

    assert.deepEqual(runnableTitles(context), [
      'Codex before council',
      'Plan council',
      'Codex after council',
    ]);
  } finally {
    context.close();
  }
});

test('disposable capacity sharing does not admit a second global council', () => {
  const context = harness({ codex: 3, claude: 1 });
  try {
    const otherDirectory = join(context.directory, 'other-project');
    mkdirSync(otherDirectory);
    const otherProject = context.database.addProject({
      path: otherDirectory,
      name: 'Other council project',
    });
    context.database.updateProjectInstanceLimits(otherProject.id, { codex: 3, claude: 1 });
    addCouncil(context, 'First council');
    addCouncilInProject(context, otherDirectory, 'Second council');

    assert.deepEqual(runnableTitles(context), ['First council']);
  } finally {
    context.close();
  }
});
