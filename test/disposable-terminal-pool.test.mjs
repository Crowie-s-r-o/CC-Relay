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
  inspectClaudeConversation,
  inspectCodexConversation,
} from '../src/disposable-terminal-pool.mjs';

function setup({
  claudeConversationState = () => 'present',
  codexConversationState = () => 'present',
} = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'relay-disposable-pool-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  const artifacts = new ArtifactStore(join(directory, 'artifacts'));
  const project = database.addProject({ path: directory, name: 'Pool project' });
  const launches = [];
  const closes = [];
  const retentions = [];
  let sequence = 0;
  const coordinator = {
    async launch(path, provider, layout, options) {
      sequence += 1;
      const threadId = options.resumeThreadId
        || options.initializeThreadId
        || `${provider}-thread-${sequence}`;
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
    retainOwnedLaunch(launchId) {
      retentions.push(launchId);
    },
  };
  const pool = new DisposableTerminalPool({
    database,
    artifacts,
    coordinator,
    launcher,
    claudeConversationState,
    codexConversationState,
  });
  return { directory, database, artifacts, project, pool, launches, closes, retentions };
}

test('Claude conversation inspection distinguishes a transcript, absence, and unreadable state', () => {
  const resolveTranscriptPath = () => '/fake/transcript.jsonl';
  assert.equal(inspectClaudeConversation('/repo', 'session', {
    resolveTranscriptPath,
    stat: () => ({ size: 12 }),
  }), 'present');
  assert.equal(inspectClaudeConversation('/repo', 'session', {
    resolveTranscriptPath,
    stat: () => ({ size: 0 }),
  }), 'missing');
  assert.equal(inspectClaudeConversation('/repo', 'session', {
    resolveTranscriptPath,
    stat: () => {
      throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    },
  }), 'missing');
  assert.equal(inspectClaudeConversation('/repo', 'session', {
    resolveTranscriptPath,
    stat: () => {
      throw Object.assign(new Error('unreadable'), { code: 'EACCES' });
    },
  }), 'unknown');
});

test('Codex conversation inspection distinguishes a rollout, absence, and unreadable state', () => {
  assert.equal(inspectCodexConversation('thread', {
    findRollouts: () => ['/fake/rollout.jsonl'],
    stat: () => ({ size: 12 }),
  }), 'present');
  assert.equal(inspectCodexConversation('thread', {
    findRollouts: () => ['/fake/rollout.jsonl'],
    stat: () => ({ size: 0 }),
  }), 'missing');
  assert.equal(inspectCodexConversation('thread', {
    findRollouts: () => [],
  }), 'missing');
  assert.equal(inspectCodexConversation('thread', {
    findRollouts: () => {
      throw Object.assign(new Error('unreadable'), { code: 'EACCES' });
    },
  }), 'unknown');

  const visited = [];
  assert.equal(inspectCodexConversation('thread', {
    codexHome: '/custom/codex-home',
    readDirectory: (path) => {
      visited.push(path);
      return [];
    },
  }), 'missing');
  assert.deepEqual(visited, [
    '/custom/codex-home/sessions',
    '/custom/codex-home/archived_sessions',
  ]);
});

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

test('a direct Claude retry initializes its saved UUID when the first attempt created no transcript', async () => {
  const context = setup({ claudeConversationState: () => 'missing' });
  try {
    const task = context.database.createTask({
      title: 'Retry fresh Claude task',
      prompt: 'Work',
      repoPath: context.directory,
      thread: {
        id: 'saved-empty-claude-session',
        title: 'Saved empty Claude session',
        source: 'test terminal',
        cwd: context.directory,
      },
      provider: 'claude',
      terminalLifecycle: 'disposable',
    });
    context.artifacts.initializeTask(task);

    const prepared = await context.pool.prepare(task);
    assert.equal(prepared.thread_id, 'saved-empty-claude-session');
    assert.deepEqual(context.launches[0].options, {
      initializeThreadId: 'saved-empty-claude-session',
    });
    assert.match(
      context.database.listEvents(task.id).at(-2).message,
      /no conversation transcript/,
    );
    await context.pool.release(task.id);
  } finally {
    context.database.close();
    rmSync(context.directory, { recursive: true, force: true });
  }
});

// The whole point of the change: the terminal a user watches opens already configured, so the
// executor has nothing to restart. Both the fresh and the resumed session argument carry it.
test('a direct Claude task puts its model and effort on the first launch command', async () => {
  const context = setup();
  try {
    const task = context.database.createTask({
      title: 'Configured Claude task',
      prompt: 'Work',
      repoPath: context.directory,
      provider: 'claude',
      model: 'opus',
      effort: 'max',
      terminalLifecycle: 'disposable',
    });
    context.artifacts.initializeTask(task);

    const prepared = await context.pool.prepare(task);
    assert.deepEqual(context.launches[0].options, {
      resumeThreadId: null,
      claudeLaunchSettings: { model: 'opus', effort: 'max' },
    });
    await context.pool.release(task.id);

    const continuation = context.database.createTask({
      title: 'Continue configured Claude task',
      prompt: 'Keep going',
      repoPath: context.directory,
      thread: {
        id: prepared.thread_id,
        title: prepared.thread_name,
        source: prepared.thread_source,
        cwd: context.directory,
      },
      provider: 'claude',
      model: 'opus',
      effort: 'max',
      continuedFromTaskId: task.id,
      terminalLifecycle: 'disposable',
    });
    context.artifacts.initializeTask(continuation);
    await context.pool.prepare(continuation);
    assert.deepEqual(context.launches[1].options, {
      resumeThreadId: prepared.thread_id,
      claudeLaunchSettings: { model: 'opus', effort: 'max' },
    });
    await context.pool.release(continuation.id);
  } finally {
    context.database.close();
    rmSync(context.directory, { recursive: true, force: true });
  }
});

test('a Codex task and a Plan council keep launching without Claude launch settings', async () => {
  const context = setup();
  try {
    const codexTask = context.database.createTask({
      title: 'Codex task',
      prompt: 'Work',
      repoPath: context.directory,
      provider: 'codex',
      model: 'gpt-5.1-codex-max',
      effort: 'high',
      terminalLifecycle: 'disposable',
    });
    context.artifacts.initializeTask(codexTask);
    await context.pool.prepare(codexTask);
    assert.deepEqual(context.launches[0].options, { resumeThreadId: null });
    await context.pool.release(codexTask.id);

    // The council's Claude stage synthesizes plan mode and a tool allowlist at run time, so the
    // pool deliberately launches it plain and leaves the executor's restart in charge.
    const council = context.database.createTask({
      title: 'Council',
      prompt: 'Plan it',
      repoPath: context.directory,
      provider: 'council',
      mode: 'plan',
      council: {
        authorProvider: 'claude',
        authorModel: 'opus',
        authorEffort: 'max',
        reviewerProvider: 'codex',
        reviewerModel: 'gpt-5.1-codex-max',
        reviewerEffort: 'high',
      },
      terminalLifecycle: 'disposable',
    });
    context.artifacts.initializeTask(council);
    await context.pool.prepare(council);
    for (const launch of context.launches.slice(1)) {
      assert.equal(launch.options.claudeLaunchSettings, undefined);
    }
    await context.pool.release(council.id);
  } finally {
    context.database.close();
    rmSync(context.directory, { recursive: true, force: true });
  }
});

test('a Plan council retry replaces both provider sessions when neither created a conversation', async () => {
  const context = setup({
    claudeConversationState: () => 'missing',
    codexConversationState: () => 'missing',
  });
  try {
    const task = context.database.createTask({
      title: 'Retry council',
      prompt: 'Plan it',
      repoPath: context.directory,
      thread: {
        id: 'saved-codex-reviewer',
        title: 'Saved Codex reviewer',
        source: 'test terminal',
        cwd: context.directory,
      },
      provider: 'council',
      mode: 'plan',
      council: {
        authorProvider: 'claude',
        authorThread: {
          id: 'saved-empty-claude-author',
          title: 'Saved empty Claude author',
          source: 'test terminal',
          cwd: context.directory,
        },
        authorModel: 'opus',
        authorEffort: 'max',
        reviewerProvider: 'codex',
        reviewerModel: 'gpt-test',
        reviewerEffort: 'max',
      },
      terminalLifecycle: 'disposable',
    });
    context.artifacts.initializeTask(task);

    const prepared = await context.pool.prepare(task);
    assert.equal(prepared.author_thread_id, 'saved-empty-claude-author');
    assert.equal(prepared.thread_id, 'codex-thread-2');
    assert.deepEqual(context.launches.map(({ provider, options }) => ({ provider, options })), [
      {
        provider: 'claude',
        options: { initializeThreadId: 'saved-empty-claude-author' },
      },
      {
        provider: 'codex',
        options: { resumeThreadId: null },
      },
    ]);
    await context.pool.release(task.id);
  } finally {
    context.database.close();
    rmSync(context.directory, { recursive: true, force: true });
  }
});

test('an explicit Claude continuation never initializes a missing conversation as blank context', async () => {
  const context = setup({ claudeConversationState: () => 'missing' });
  try {
    const task = context.database.createTask({
      title: 'Continue Claude task',
      prompt: 'Keep going',
      repoPath: context.directory,
      thread: {
        id: 'missing-claude-conversation',
        title: 'Missing Claude conversation',
        source: 'test terminal',
        cwd: context.directory,
      },
      provider: 'claude',
      terminalLifecycle: 'disposable',
    });
    context.artifacts.initializeTask(task);

    await context.pool.prepare({ ...task, sessionFollowUp: true });
    assert.deepEqual(context.launches[0].options, {
      resumeThreadId: 'missing-claude-conversation',
    });
    await context.pool.release(task.id);
  } finally {
    context.database.close();
    rmSync(context.directory, { recursive: true, force: true });
  }
});

test('an explicit Codex continuation never replaces a missing conversation with blank context', async () => {
  const context = setup({ codexConversationState: () => 'missing' });
  try {
    const task = context.database.createTask({
      title: 'Continue Codex task',
      prompt: 'Keep going',
      repoPath: context.directory,
      thread: {
        id: 'missing-codex-conversation',
        title: 'Missing Codex conversation',
        source: 'test terminal',
        cwd: context.directory,
      },
      provider: 'codex',
      terminalLifecycle: 'disposable',
    });
    context.artifacts.initializeTask(task);

    await context.pool.prepare({ ...task, sessionFollowUp: true });
    assert.deepEqual(context.launches[0].options, {
      resumeThreadId: 'missing-codex-conversation',
    });
    await context.pool.release(task.id);
  } finally {
    context.database.close();
    rmSync(context.directory, { recursive: true, force: true });
  }
});

test('a Claude retry keeps the resume path when transcript inspection is inconclusive', async () => {
  const context = setup({ claudeConversationState: () => 'unknown' });
  try {
    const task = context.database.createTask({
      title: 'Retry uncertain Claude task',
      prompt: 'Work',
      repoPath: context.directory,
      thread: {
        id: 'uncertain-claude-conversation',
        title: 'Uncertain Claude conversation',
        source: 'test terminal',
        cwd: context.directory,
      },
      provider: 'claude',
      terminalLifecycle: 'disposable',
    });
    context.artifacts.initializeTask(task);

    await context.pool.prepare(task);
    assert.deepEqual(context.launches[0].options, {
      resumeThreadId: 'uncertain-claude-conversation',
    });
    await context.pool.release(task.id);
  } finally {
    context.database.close();
    rmSync(context.directory, { recursive: true, force: true });
  }
});

test('a retained task promotes its exact launch and releases pool capacity without closing it', async () => {
  const context = setup();
  try {
    const task = context.database.createTask({
      title: 'Retained Codex task',
      prompt: 'Stay open',
      repoPath: context.directory,
      provider: 'codex',
      terminalLifecycle: 'disposable',
      keepTerminalOpen: true,
    });
    context.artifacts.initializeTask(task);

    await context.pool.prepare(task);
    assert.equal(context.pool.projectStatus(context.directory).active.codex, 1);
    assert.deepEqual(await context.pool.retain(task.id), { retained: 1, failed: 0 });
    assert.deepEqual(context.retentions, ['codex-launch-1']);
    assert.deepEqual(context.closes, []);
    assert.equal(context.pool.projectStatus(context.directory).active.codex, 0);
    assert.match(
      context.database.listEvents(task.id).at(-1).message,
      /kept open for more work/,
    );
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

test('a launch with no exact native target is never reported as a closed terminal', async () => {
  const context = setup();
  const diagnostics = [];
  context.pool.diagnostic = (event, payload) => diagnostics.push({ event, payload });
  try {
    // A native launch that captured neither a window handle nor a conversation has nothing
    // exact to close. Closing it by a null conversation ID used to match whichever owned
    // launch was still binding, and counting it closed overstated the cleanup in the queue.
    context.pool.coordinator.launch = async () => ({ launchId: null, threadId: null });
    const task = context.database.createTask({
      title: 'Handle-less launch',
      prompt: 'Work',
      repoPath: context.directory,
      provider: 'claude',
      terminalLifecycle: 'disposable',
    });
    context.artifacts.initializeTask(task);

    await assert.rejects(context.pool.prepare(task), /did not connect to CC Relay in time/);
    assert.deepEqual(context.closes, []);
    assert.equal(context.pool.allocations.has(task.id), false);
    assert.equal(
      diagnostics.some((entry) => entry.event === 'terminal.pool.cleanup_skipped'),
      true,
    );
    const events = context.database.listEvents(task.id).map((event) => event.message);
    assert.equal(events.some((message) => /terminal instances? closed/.test(message)), false);
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

    await assert.rejects(context.pool.prepare(task), /did not connect to CC Relay in time/);
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
