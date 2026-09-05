import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { ArtifactStore } from '../src/artifacts.mjs';
import { RelayDatabase } from '../src/database.mjs';
import {
  DisposableTerminalPool,
  disposableTerminalConfigurationRequirements,
  disposableTerminalRequirements,
  inspectClaudeConversation,
  inspectCodexConversation,
} from '../src/disposable-terminal-pool.mjs';
import { ProjectLauncher } from '../src/project-launcher.mjs';

const COUNCIL_CLAUDE_LAUNCH_SETTINGS = {
  model: 'opus',
  effort: 'max',
  permissionMode: 'plan',
  tools: ['Read', 'Glob', 'Grep', 'AskUserQuestion'],
  addDirectories: [],
};

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
  const bindings = [];
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
    confirmTaskTerminalBinding(launchId, taskId, threadId) {
      const task = database.getTask(taskId);
      assert.ok([task.thread_id, task.author_thread_id, task.turbo?.plannerThreadId,
        task.turbo?.executionThreadId, task.turbo?.councilThreadId].includes(threadId),
      'retire the startup target only after its conversation is saved on the task');
      bindings.push({ launchId, taskId, threadId });
    },
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
  return { directory, database, artifacts, project, pool, launches, closes, retentions, bindings };
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
    assert.deepEqual(context.bindings, [{ launchId: 'claude-launch-1', taskId: first.id, threadId: prepared.thread_id }]);
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

test('OpenCode uses a headless pool slot without launching a terminal', async () => {
  const context = setup();
  try {
    const task = context.database.createTask({
      title: 'Headless OpenCode task',
      prompt: 'Work',
      repoPath: context.directory,
      provider: 'opencode',
      terminalLifecycle: 'disposable',
      keepTerminalOpen: true,
      manualCompletion: true,
    });
    context.artifacts.initializeTask(task);

    const prepared = await context.pool.prepare(task);
    assert.equal(prepared.keep_terminal_open, false);
    assert.equal(prepared.manual_completion, false);
    assert.equal(prepared.thread_name, 'OpenCode headless session');
    assert.equal(prepared.thread_source, 'CC Relay managed headless runner');
    assert.deepEqual(context.launches, []);
    assert.deepEqual(context.pool.usage(context.directory), {
      codex: 0,
      claude: 0,
      opencode: 1,
    });
    assert.equal(context.pool.canRun({ ...task, id: task.id + 1 }), false);
    assert.deepEqual(await context.pool.release(task.id), { closed: 0, failed: 0 });
    assert.deepEqual(context.pool.usage(context.directory), {
      codex: 0,
      claude: 0,
      opencode: 0,
    });
  } finally {
    context.database.close();
    rmSync(context.directory, { recursive: true, force: true });
  }
});

test('retaining an OpenCode allocation defensively releases its headless pool slot', async () => {
  const context = setup();
  try {
    const task = context.database.createTask({
      title: 'Headless OpenCode retention guard',
      prompt: 'Work',
      repoPath: context.directory,
      provider: 'opencode',
      terminalLifecycle: 'disposable',
    });
    context.artifacts.initializeTask(task);

    await context.pool.prepare(task);
    assert.deepEqual(context.pool.usage(context.directory), {
      codex: 0,
      claude: 0,
      opencode: 1,
    });
    assert.deepEqual(await context.pool.retain(task.id), { retained: 0, failed: 0 });
    assert.deepEqual(context.pool.usage(context.directory), {
      codex: 0,
      claude: 0,
      opencode: 0,
    });
    assert.deepEqual(context.retentions, []);
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

test('direct and Plan council terminals receive their complete settings on the first launch', async () => {
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
    assert.deepEqual(context.launches[0].options, {
      resumeThreadId: null,
      codexLaunchSettings: { model: 'gpt-5.1-codex-max', effort: 'high' },
    });
    await context.pool.release(codexTask.id);

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
    assert.equal(context.bindings.filter(({ taskId }) => taskId === council.id).length, 2,
      'both council startup targets retire after the shared task assignment');
    assert.deepEqual(context.launches.slice(1).map(({ provider, options }) => ({ provider, options })), [
      {
        provider: 'claude',
        options: {
          resumeThreadId: null,
          claudeLaunchSettings: COUNCIL_CLAUDE_LAUNCH_SETTINGS,
        },
      },
      {
        provider: 'codex',
        options: {
          resumeThreadId: null,
          codexLaunchSettings: { model: 'gpt-5.1-codex-max', effort: 'high' },
        },
      },
    ]);
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
        options: {
          initializeThreadId: 'saved-empty-claude-author',
          claudeLaunchSettings: COUNCIL_CLAUDE_LAUNCH_SETTINGS,
        },
      },
      {
        provider: 'codex',
        options: {
          resumeThreadId: null,
          codexLaunchSettings: { model: 'gpt-test', effort: 'max' },
        },
      },
    ]);
    await context.pool.release(task.id);
  } finally {
    context.database.close();
    rmSync(context.directory, { recursive: true, force: true });
  }
});

test('a Plan council resume reads draft and review files and launches only a fresh revision author', async () => {
  const context = setup();
  try {
    const task = context.database.createTask({
      title: 'Resume final council revision',
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
          id: 'large-claude-draft-session',
          title: 'Large Claude draft session',
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
    for (const [stage, content] of [
      ['draft', '# Saved draft\n'],
      ['review', '# Saved review\n'],
    ]) {
      const stagePath = context.artifacts.planStagePath(task.id, stage, context.directory);
      mkdirSync(dirname(stagePath), { recursive: true });
      writeFileSync(stagePath, content, 'utf8');
    }

    assert.deepEqual(context.pool.requirements(task), { codex: 0, claude: 1, opencode: 0 });
    const prepared = await context.pool.prepare(task);

    assert.equal(prepared.author_thread_id, 'claude-thread-1');
    assert.equal(prepared.thread_id, 'saved-codex-reviewer');
    assert.deepEqual(context.launches.map(({ provider, options }) => ({ provider, options })), [
      {
        provider: 'claude',
        options: {
          resumeThreadId: null,
          claudeLaunchSettings: COUNCIL_CLAUDE_LAUNCH_SETTINGS,
        },
      },
    ]);
    assert.ok(context.database.listEvents(task.id).some(({ message }) => (
      message.includes('Saved draft.md and review.md were found')
    )));
    assert.deepEqual(await context.pool.release(task.id), { closed: 1, failed: 0 });
  } finally {
    context.database.close();
    rmSync(context.directory, { recursive: true, force: true });
  }
});

test('a Codex-first council resume launches only a fresh Codex revision author', async () => {
  const context = setup();
  try {
    const task = context.database.createTask({
      title: 'Resume Codex final revision',
      prompt: 'Plan it in the reverse order',
      repoPath: context.directory,
      thread: {
        id: 'large-codex-draft-session',
        title: 'Large Codex draft session',
        source: 'test terminal',
        cwd: context.directory,
      },
      provider: 'council',
      mode: 'plan',
      council: {
        authorProvider: 'codex',
        authorThread: {
          id: 'saved-claude-reviewer',
          title: 'Saved Claude reviewer',
          source: 'test terminal',
          cwd: context.directory,
        },
        authorModel: 'gpt-author',
        authorEffort: 'high',
        reviewerProvider: 'claude',
        reviewerModel: 'fable',
        reviewerEffort: 'max',
      },
      terminalLifecycle: 'disposable',
    });
    context.artifacts.initializeTask(task);
    for (const [stage, content] of [
      ['draft', '# Saved Codex draft\n'],
      ['review', '# Saved Claude review\n'],
    ]) {
      const stagePath = context.artifacts.planStagePath(task.id, stage, context.directory);
      mkdirSync(dirname(stagePath), { recursive: true });
      writeFileSync(stagePath, content, 'utf8');
    }

    assert.deepEqual(context.pool.requirements(task), { codex: 1, claude: 0, opencode: 0 });
    const prepared = await context.pool.prepare(task);

    assert.equal(prepared.thread_id, 'codex-thread-1');
    assert.equal(prepared.author_thread_id, 'saved-claude-reviewer');
    assert.deepEqual(context.launches.map(({ provider, options }) => ({ provider, options })), [
      {
        provider: 'codex',
        options: {
          resumeThreadId: null,
          codexLaunchSettings: { model: 'gpt-author', effort: 'high' },
        },
      },
    ]);
    assert.deepEqual(await context.pool.release(task.id), { closed: 1, failed: 0 });
  } finally {
    context.database.close();
    rmSync(context.directory, { recursive: true, force: true });
  }
});

test('a fully checkpointed council can repair final plan persistence without a provider terminal', async () => {
  const context = setup();
  try {
    const task = context.database.createTask({
      title: 'Repair final plan file',
      prompt: 'Plan it',
      repoPath: context.directory,
      provider: 'council',
      mode: 'plan',
      council: {
        authorProvider: 'claude',
        authorModel: 'opus',
        authorEffort: 'max',
        reviewerProvider: 'codex',
        reviewerModel: 'gpt-test',
        reviewerEffort: 'max',
      },
      terminalLifecycle: 'disposable',
    });
    context.artifacts.initializeTask(task);
    context.artifacts.writePlan(task.id, {
      taskId: task.id,
      brief: task.prompt,
      attachments: [],
      author: {
        provider: task.author_provider,
        model: task.author_model,
        effort: task.author_effort,
      },
      reviewer: {
        provider: task.reviewer_provider,
        model: task.reviewer_model,
        effort: task.reviewer_effort,
      },
      stages: [],
      status: 'complete',
      draft: '# Draft',
      review: '# Review',
      finalPlan: '# Final plan',
    }, { repoPath: context.directory });
    rmSync(context.artifacts.planPath(task.id, context.directory), { force: true });

    assert.deepEqual(context.pool.requirements(task), { codex: 0, claude: 0, opencode: 0 });
    assert.equal(context.pool.canRun(task), true);
    assert.equal(await context.pool.prepare(task), task);
    assert.deepEqual(context.launches, []);
    assert.ok(context.database.listEvents(task.id).some(({ message }) => (
      message.includes('without launching a terminal')
    )));
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

test('Turbo opens and closes its planner before creating one fresh execution session', async () => {
  const context = setup();
  try {
    context.database.updateProjectInstanceLimits(context.project.id, { codex: 4, claude: 1 });
    const task = context.database.createTask({
      title: 'Single executor Turbo',
      prompt: 'Plan and execute.',
      repoPath: context.directory,
      provider: 'codex',
      mode: 'turbo',
      terminalLifecycle: 'disposable',
      turbo: {
        plannerModel: 'sol',
        plannerEffort: 'max',
        workerModel: 'luna',
        workerEffort: 'medium',
        workerCount: 3,
        workers: [],
      },
    });
    context.artifacts.initializeTask(task);

    await context.pool.prepare(task);
    assert.equal(context.launches.length, 0, 'queue preparation must not pre-warm terminals');
    const planner = await context.pool.launchTurboStage(task, {
      role: 'planner',
      model: 'sol',
      effort: 'max',
    });
    assert.deepEqual(context.launches[0].options.codexLaunchSettings, { model: 'sol', effort: 'max' });
    await context.pool.finishTurboStage(task.id, planner, { retain: false });

    const executor = await context.pool.launchTurboStage(task, {
      role: 'worker',
      packageId: 'execution',
      slot: 1,
      model: 'luna',
      effort: 'medium',
    });
    assert.deepEqual(context.launches[1].options.codexLaunchSettings, { model: 'luna', effort: 'medium' });
    assert.notEqual(executor.threadId, planner.threadId);
    const stored = context.database.getTask(task.id);
    assert.equal(stored.thread_id, executor.threadId);
    assert.equal(stored.turbo.executionThreadId, executor.threadId);
    assert.deepEqual(context.bindings.map(({ threadId }) => threadId), [planner.threadId, executor.threadId]);
    await context.pool.finishTurboStage(task.id, executor, { retain: false });

    assert.deepEqual(context.closes, ['codex-launch-1', 'codex-launch-2']);
    assert.equal(context.pool.allocations.has(task.id), false);
  } finally {
    context.database.close();
    rmSync(context.directory, { recursive: true, force: true });
  }
});

test('a Turbo planning stage fails loudly when its exact terminal cannot be released', async () => {
  const context = setup();
  try {
    context.database.updateProjectInstanceLimits(context.project.id, { codex: 2, claude: 1 });
    const task = context.database.createTask({
      title: 'Planner cleanup failure',
      prompt: 'Plan this.',
      repoPath: context.directory,
      provider: 'codex',
      mode: 'turbo',
      terminalLifecycle: 'disposable',
      turbo: { workerCount: 1 },
    });
    context.artifacts.initializeTask(task);
    const planner = await context.pool.launchTurboStage(task, { role: 'planner' });
    context.pool.launcher.closeOwnedLaunch = async () => {
      throw new Error('window stayed open');
    };

    await assert.rejects(
      context.pool.finishTurboStage(task.id, planner, { retain: false, failOnError: true }),
      (error) => error.retryable === false && error.terminalCleanupFailed === true,
    );
    assert.equal(context.pool.allocations.has(task.id), true, 'ambiguous cleanup must remain counted');
  } finally {
    context.database.close();
    rmSync(context.directory, { recursive: true, force: true });
  }
});

test('a Turbo stage closes an exact native launch that never binds a conversation', async () => {
  const context = setup();
  try {
    context.database.updateProjectInstanceLimits(context.project.id, { codex: 2, claude: 1 });
    const task = context.database.createTask({
      title: 'Unbound planner',
      prompt: 'Plan this.',
      repoPath: context.directory,
      provider: 'codex',
      mode: 'turbo',
      terminalLifecycle: 'disposable',
      turbo: { workerCount: 1 },
    });
    context.artifacts.initializeTask(task);
    context.pool.coordinator.launch = async () => ({
      launchId: 'unbound-planner-launch',
      threadId: null,
      bindingError: 'planner never connected',
    });

    await assert.rejects(
      context.pool.launchTurboStage(task, { role: 'planner' }),
      /planner never connected/,
    );
    assert.deepEqual(context.closes, ['unbound-planner-launch']);
    assert.equal(context.pool.allocations.has(task.id), false);
  } finally {
    context.database.close();
    rmSync(context.directory, { recursive: true, force: true });
  }
});

test('a Turbo binding failure becomes non-retryable when its native window cannot close', async () => {
  const context = setup();
  try {
    context.database.updateProjectInstanceLimits(context.project.id, { codex: 2, claude: 1 });
    const task = context.database.createTask({
      title: 'Unclosable planner',
      prompt: 'Plan this.',
      repoPath: context.directory,
      provider: 'codex',
      mode: 'turbo',
      terminalLifecycle: 'disposable',
      turbo: { workerCount: 1 },
    });
    context.artifacts.initializeTask(task);
    context.pool.coordinator.launch = async () => ({
      launchId: 'unclosable-planner-launch',
      threadId: null,
      bindingError: 'planner never connected',
    });
    context.pool.launcher.closeOwnedLaunch = async () => {
      throw new Error('native window stayed open');
    };

    await assert.rejects(
      context.pool.launchTurboStage(task, { role: 'planner' }),
      (error) => error.retryable === false && error.terminalCleanupFailed === true,
    );
    assert.equal(context.pool.allocations.has(task.id), true);
    assert.equal(context.pool.pendingTurboLaunches.size, 0);
  } finally {
    context.database.close();
    rmSync(context.directory, { recursive: true, force: true });
  }
});

test('a Turbo stage closes its bound launch when assignment persistence fails', async () => {
  const context = setup();
  try {
    context.database.updateProjectInstanceLimits(context.project.id, { codex: 2, claude: 1 });
    const task = context.database.createTask({
      title: 'Planner persistence failure',
      prompt: 'Plan this.',
      repoPath: context.directory,
      provider: 'codex',
      mode: 'turbo',
      terminalLifecycle: 'disposable',
      turbo: { workerCount: 1 },
    });
    context.artifacts.initializeTask(task);
    const updateTask = context.database.updateTask.bind(context.database);
    context.database.updateTask = () => {
      throw new Error('database write failed');
    };

    await assert.rejects(
      context.pool.launchTurboStage(task, { role: 'planner' }),
      /database write failed/,
    );
    context.database.updateTask = updateTask;
    assert.deepEqual(context.closes, ['codex-launch-1']);
    assert.equal(context.pool.allocations.has(task.id), false);
  } finally {
    context.database.close();
    rmSync(context.directory, { recursive: true, force: true });
  }
});

test('a Turbo terminal slot is reserved while its native window is still binding', async () => {
  const context = setup();
  let finishLaunch;
  try {
    context.database.updateProjectInstanceLimits(context.project.id, { codex: 2, claude: 1 });
    const task = context.database.createTask({
      title: 'Binding planner',
      prompt: 'Plan this.',
      repoPath: context.directory,
      provider: 'codex',
      mode: 'turbo',
      terminalLifecycle: 'disposable',
      turbo: { workerCount: 1 },
    });
    const direct = context.database.createTask({
      title: 'Direct work',
      prompt: 'Work directly.',
      repoPath: context.directory,
      provider: 'codex',
      mode: 'execute',
      terminalLifecycle: 'disposable',
    });
    context.artifacts.initializeTask(task);
    context.artifacts.initializeTask(direct);
    context.pool.coordinator.launch = () => new Promise((resolve) => {
      finishLaunch = resolve;
    });

    const opening = context.pool.launchTurboStage(task, { role: 'planner' });
    assert.deepEqual(context.pool.projectStatus(context.directory).active, { codex: 1, claude: 0, opencode: 0 });
    assert.deepEqual(context.pool.projectStatus(context.directory, [task]).active, { codex: 1, claude: 0, opencode: 0 });
    assert.equal(context.pool.canRun(direct), true);
    assert.equal(context.pool.canRun(direct, [direct]), false);

    finishLaunch({
      launchId: 'binding-planner-launch',
      threadId: 'binding-planner-thread',
      thread: {
        id: 'binding-planner-thread',
        provider: 'codex',
        cwd: context.directory,
        title: 'Binding planner terminal',
        source: 'test',
      },
    });
    const planner = await opening;
    assert.equal(context.pool.pendingTurboLaunches.size, 0);
    await context.pool.finishTurboStage(task.id, planner, { retain: false });
  } finally {
    context.database.close();
    rmSync(context.directory, { recursive: true, force: true });
  }
});

test('Plan council reserves both providers while each Turbo execution reserves one Codex slot', () => {
  assert.deepEqual(disposableTerminalRequirements({
    terminal_lifecycle: 'disposable',
    mode: 'plan',
  }), { codex: 1, claude: 1, opencode: 0 });
  assert.deepEqual(disposableTerminalRequirements({
    terminal_lifecycle: 'disposable',
    mode: 'turbo',
    turbo: { workerCount: 3, council: { enabled: true } },
  }), { codex: 1, claude: 0, opencode: 0 });
  assert.deepEqual(disposableTerminalConfigurationRequirements({
    terminal_lifecycle: 'disposable',
    mode: 'turbo',
    turbo: { workerCount: 3, council: { enabled: true } },
  }), { codex: 4, claude: 1, opencode: 0 });
  assert.deepEqual(disposableTerminalConfigurationRequirements({
    terminal_lifecycle: 'disposable',
    mode: 'turbo',
    turbo: { workerCount: 2, councilEnabled: true },
  }), { codex: 3, claude: 1, opencode: 0 });
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
      opencode: 0,
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

test('a macOS terminal closed outside CC Relay decrements the Claude pool usage', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-disposable-macos-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  const artifacts = new ArtifactStore(join(directory, 'artifacts'));
  database.addProject({ path: directory, name: 'macOS pool project' });
  const launcher = new ProjectLauncher({
    platform: 'darwin',
    createId: () => 'closed-macos-launch',
    run: async (command, args) => {
      if (command === 'osascript' && args[1].includes('set launchedTab to do script')) {
        return { stdout: '619|true\n' };
      }
      if (command === 'osascript' && args[1].includes('__CC_RELAY_TERMINAL_WINDOW_MISSING__')) {
        return { stdout: '__CC_RELAY_TERMINAL_WINDOW_MISSING__\n' };
      }
      return { stdout: '' };
    },
  });
  const coordinator = {
    async launch(path, provider, layout, options) {
      const launched = await launcher.launch(path, provider, layout, options);
      const thread = {
        id: launched.expectedThreadId,
        provider,
        cwd: path,
        title: `${provider} terminal`,
        source: 'CC Relay managed terminal',
      };
      launcher.bindOwnedTerminal(launched.launchId, thread);
      return { ...launched, threadId: thread.id, thread };
    },
  };
  const pool = new DisposableTerminalPool({ database, artifacts, coordinator, launcher });
  try {
    const task = database.createTask({
      title: 'macOS Claude task',
      prompt: 'Work',
      repoPath: directory,
      provider: 'claude',
      terminalLifecycle: 'disposable',
      terminalLayout: { enabled: false, background: true },
    });
    artifacts.initializeTask(task);

    await pool.prepare(task);
    assert.deepEqual(pool.usage(directory), { codex: 0, claude: 1, opencode: 0 });
    assert.deepEqual(await pool.release(task.id), { closed: 1, failed: 0 });
    assert.deepEqual(pool.usage(directory), { codex: 0, claude: 0, opencode: 0 });
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

// End-to-end proof over a real ProjectLauncher: a Windows terminal the user closed by hand must
// still hand its project slot back, while any other native failure keeps the slot reserved.
function windowsPoolSetup(taskkill) {
  const directory = mkdtempSync(join(tmpdir(), 'relay-disposable-windows-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  const artifacts = new ArtifactStore(join(directory, 'artifacts'));
  database.addProject({ path: directory, name: 'Windows pool project' });
  let processId = 6100;
  const launcher = new ProjectLauncher({
    platform: 'win32',
    run: async (file) => {
      if (file === 'taskkill.exe') return taskkill();
      processId += 1;
      return { stdout: `${processId}\r\n` };
    },
  });
  const coordinator = {
    async launch(path, provider, layout, options) {
      const launched = await launcher.launch(path, provider, layout, options);
      const thread = {
        id: `${provider}-conversation`,
        provider,
        cwd: path,
        title: `${provider} terminal`,
        source: 'CC Relay managed terminal',
      };
      launcher.bindOwnedTerminal(launched.launchId, thread);
      return { ...launched, threadId: thread.id, thread };
    },
  };
  const pool = new DisposableTerminalPool({ database, artifacts, coordinator, launcher });
  return { directory, database, artifacts, launcher, pool };
}

test('a Windows terminal closed outside CC Relay releases its project pool slot', async () => {
  const context = windowsPoolSetup(() => {
    throw Object.assign(
      new Error('Command failed: taskkill.exe\nERROR: The process "6101" not found.\r\n'),
      { code: 128, stderr: 'ERROR: The process "6101" not found.\r\n' },
    );
  });
  try {
    const task = context.database.createTask({
      title: 'Windows codex task',
      prompt: 'Work',
      repoPath: context.directory,
      provider: 'codex',
      terminalLifecycle: 'disposable',
      terminalLayout: { enabled: false, background: true },
    });
    context.artifacts.initializeTask(task);

    await context.pool.prepare(task);
    assert.deepEqual(context.pool.usage(context.directory), { codex: 1, claude: 0, opencode: 0 });
    assert.deepEqual(await context.pool.release(task.id), { closed: 1, failed: 0 });
    assert.deepEqual(context.pool.usage(context.directory), { codex: 0, claude: 0, opencode: 0 });
  } finally {
    rmSync(context.directory, { recursive: true, force: true });
  }
});

test('a Windows terminal CC Relay could not terminate keeps its project pool slot reserved', async () => {
  const context = windowsPoolSetup(() => {
    throw Object.assign(
      new Error('Command failed: taskkill.exe\nERROR: The process "6101" could not be terminated.\r\nReason: Access is denied.\r\n'),
      { code: 1, stderr: 'Reason: Access is denied.\r\n' },
    );
  });
  try {
    const task = context.database.createTask({
      title: 'Windows codex task',
      prompt: 'Work',
      repoPath: context.directory,
      provider: 'codex',
      terminalLifecycle: 'disposable',
      terminalLayout: { enabled: false, background: true },
    });
    context.artifacts.initializeTask(task);

    await context.pool.prepare(task);
    assert.deepEqual(await context.pool.release(task.id), { closed: 0, failed: 1 });
    assert.deepEqual(context.pool.usage(context.directory), { codex: 1, claude: 0, opencode: 0 });
  } finally {
    rmSync(context.directory, { recursive: true, force: true });
  }
});


test('twenty provider slots persist and the twenty-first task waits independently per provider', () => {
  const context = setup();
  try {
    context.database.updateProjectInstanceLimits(context.project.id, { codex: 20, claude: 20, opencode: 20 });
    context.database.close();
    context.database = new RelayDatabase(join(context.directory, 'relay.sqlite'));
    context.pool.database = context.database;
    assert.deepEqual(context.pool.limits(context.directory), { codex: 20, claude: 20, opencode: 20 });
    for (const provider of ['codex', 'claude', 'opencode']) {
      const task = { id: 100, repo_path: context.directory, terminal_lifecycle: 'disposable', mode: 'execute', provider };
      const running = Array.from({ length: 20 }, (_, id) => ({ ...task, id: id + 1 }));
      assert.equal(context.pool.canRun(task, running.slice(0, 19)), true);
      assert.equal(context.pool.canRun(task, running), false);
      assert.equal(context.pool.canRun({ ...task, repo_path: '/another/project' }, running), true);
      const otherProvider = provider === 'codex' ? 'claude' : 'codex';
      assert.equal(context.pool.canRun({ ...task, provider: otherProvider }, running), true);
    }
    const turbo = { id: 101, repo_path: context.directory, terminal_lifecycle: 'disposable', mode: 'turbo', turbo: { workerCount: 19 } };
    assert.equal(context.pool.capacityIssue(turbo), '');
    assert.match(context.pool.capacityIssue({ ...turbo, turbo: { workerCount: 20 } }), /needs 21 Codex instances/);
  } finally {
    context.database.close();
    rmSync(context.directory, { recursive: true, force: true });
  }
});
