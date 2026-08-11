import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ArtifactStore } from '../src/artifacts.mjs';
import { RelayDatabase } from '../src/database.mjs';
import { TaskQueue } from '../src/queue.mjs';

function waitFor(predicate, timeout = 2000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - started > timeout) {
        clearInterval(timer);
        reject(new Error('Timed out waiting for queue state.'));
      }
    }, 10);
  });
}

function thread(id, cwd) {
  return { id, title: `Session ${id}`, source: 'cli', cwd };
}

function turboInput(title, plannerThread, workerThread, cwd) {
  return {
    title,
    prompt: `Plan ${title}`,
    mode: 'turbo',
    provider: 'codex',
    thread: thread(plannerThread, cwd),
    turbo: {
      plannerThreadId: plannerThread,
      plannerModel: 'sol',
      plannerEffort: 'high',
      workerModel: 'luna',
      workerEffort: 'high',
      workers: [{ threadId: workerThread, title: `Worker ${workerThread}` }],
    },
  };
}

function councilTurboInput(title, plannerThread, workerThread, cwd) {
  const input = turboInput(title, plannerThread, workerThread, cwd);
  input.turbo.council = {
    enabled: true,
    order: ['codex', 'claude'],
    reviewerProvider: 'claude',
    reviewerModel: 'sonnet',
    reviewerEffort: 'high',
  };
  return input;
}

function readyTurboPlan(task, workerThread) {
  return {
    version: 1,
    status: 'ready',
    summary: task.title,
    planner: { threadId: task.turbo.plannerThreadId, model: 'sol', effort: 'high' },
    workers: [{ threadId: workerThread, title: `Worker ${workerThread}` }],
    tasks: [{ id: 'step', title: 'Step', instructions: 'Do it', dependsOn: [], status: 'pending', worker: null, result: null }],
  };
}

function directInput(title, threadId, cwd) {
  return {
    title,
    prompt: `Execute ${title}`,
    mode: 'execute',
    provider: 'codex',
    thread: thread(threadId, cwd),
  };
}

function planInput(title, threadId, cwd) {
  return {
    title,
    prompt: `Plan ${title}`,
    mode: 'plan',
    provider: 'council',
    thread: thread(threadId, cwd),
    council: {
      authorProvider: 'claude',
      authorModel: 'opus',
      authorEffort: 'max',
      reviewerProvider: 'codex',
      reviewerModel: 'gpt-test',
      reviewerEffort: 'high',
    },
  };
}

function claudeInput(title, threadId, cwd) {
  return {
    title,
    prompt: `Execute ${title}`,
    mode: 'execute',
    provider: 'claude',
    thread: thread(threadId, cwd),
  };
}

function executingTurboPlan(task) {
  const plan = readyTurboPlan(task, task.turbo.workers[0].threadId);
  plan.status = 'executing';
  return plan;
}

test('queue treats repeated submission IDs as one task', () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-idempotent-queue-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  const artifacts = new ArtifactStore(join(directory, 'tasks'));
  const queue = new TaskQueue({ database, artifacts, runner: { run() {}, cancel() { return false; } } });
  const submissionId = 'a8098c1a-f86e-4f65-9f45-0e46bb286b71';
  try {
    queue.pause();
    const input = { ...directInput('Only once', 'relay-once', directory), submissionId };
    const first = queue.enqueue(input);
    const repeated = queue.enqueue(input);

    assert.equal(repeated.id, first.id);
    assert.equal(database.listTasks().length, 1);
    assert.equal(database.listEvents(first.id).filter((event) => event.message === 'Task added to the queue.').length, 1);
    assert.equal(queue.enqueue({ ...input, thread: thread('another-idle-relay', directory) }).id, first.id);
    assert.throws(
      () => queue.enqueue({ ...input, prompt: 'Different work' }),
      /submission ID was already used for different work/,
    );
    assert.throws(
      () => queue.enqueue({ ...input, title: 'A different name' }),
      /submission ID was already used for different work/,
    );
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('queue runs different Codex terminals concurrently', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-queue-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  const artifacts = new ArtifactStore(join(directory, 'tasks'));
  let active = 0;
  let maximumActive = 0;
  const order = [];
  const runner = {
    async run(task, { onEvent }) {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      order.push(task.title);
      onEvent({
        event: { type: 'turn/started', threadId: task.thread_id, turn: { id: `turn-${task.id}` } },
        message: 'Started',
      });
      await new Promise((resolve) => setTimeout(resolve, 30));
      active -= 1;
      return { finalResponse: `Finished ${task.title}`, sessionId: `session-${task.id}`, exitCode: 0 };
    },
    cancel() {
      return false;
    },
  };
  const queue = new TaskQueue({ database, artifacts, runner });

  try {
    queue.pause();
    const first = queue.enqueue({ title: 'First', prompt: 'One', thread: thread('one', directory) });
    const second = queue.enqueue({ title: 'Second', prompt: 'Two', thread: thread('two', directory) });
    queue.resume();

    await waitFor(() => database.getTask(second.id).status === 'complete');
    assert.equal(database.getTask(first.id).status, 'complete');
    assert.equal(maximumActive, 2);
    assert.deepEqual(order, ['First', 'Second']);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a finished-task follow-up starts immediately in the same task row and session', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-direct-follow-up-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  const artifacts = new ArtifactStore(join(directory, 'tasks'));
  let releaseFollowUp;
  const followUpGate = new Promise((resolve) => { releaseFollowUp = resolve; });
  const received = [];
  const runner = {
    async run(task) {
      received.push(task);
      await followUpGate;
      return { finalResponse: 'Follow-up result', sessionId: task.thread_id, exitCode: 0 };
    },
    cancel() { return false; },
  };
  const queue = new TaskQueue({ database, artifacts, runner });

  try {
    queue.pause();
    const source = queue.enqueue({
      ...directInput('Original work', 'same-relay', directory),
      attachments: [{
        name: 'original.png',
        mimeType: 'image/png',
        extension: 'png',
        data: Buffer.from('original image'),
      }],
    });
    database.updateTask(source.id, {
      status: 'complete',
      started_at: '2026-07-21T10:00:00.000Z',
      finished_at: '2026-07-21T10:01:00.000Z',
      result: 'Original result',
    });
    artifacts.writeResult(source.id, 'Original result');
    const taskCount = database.listTasks().length;
    const runtimeTask = {
      ...database.getTask(source.id),
      prompt: 'Inspect the remaining edge case.',
      attachments: [{
        name: 'follow-up.png',
        mimeType: 'image/png',
        extension: 'png',
        data: Buffer.from('follow-up image'),
      }],
      sessionFollowUp: true,
    };

    const started = queue.startFollowUp(runtimeTask);
    assert.equal(started.id, source.id);
    assert.equal(started.status, 'running');
    assert.equal(database.listTasks().length, taskCount);
    assert.equal(database.getTask(source.id).prompt, 'Execute Original work');
    assert.equal(received.length, 1);
    assert.equal(received[0].thread_id, 'same-relay');
    assert.equal(received[0].prompt, 'Inspect the remaining edge case.');
    assert.equal(received[0].sessionFollowUp, true);
    assert.equal(received[0].attachments.length, 1);
    assert.equal(received[0].attachments[0].id, 'image-2');
    assert.equal(readFileSync(received[0].attachments[0].path, 'utf8'), 'follow-up image');
    assert.deepEqual(database.getTask(source.id).attachments.map((attachment) => attachment.id), ['image-1', 'image-2']);
    const userMessage = database.listEvents(source.id).find((event) => event.payload?.item?.type === 'userMessage');
    assert.equal(userMessage?.payload.item.content[0].text, 'Inspect the remaining edge case.');
    assert.equal(userMessage?.payload.item.content[1].path, received[0].attachments[0].path);

    releaseFollowUp();
    await waitFor(() => database.getTask(source.id).status === 'complete');
    assert.equal(database.getTask(source.id).result, 'Follow-up result');
    assert.equal(database.listTasks().length, taskCount);
  } finally {
    releaseFollowUp();
    await queue.shutdown();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a closed disposable conversation resumes in the same task row', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-disposable-follow-up-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  const artifacts = new ArtifactStore(join(directory, 'tasks'));
  const prepared = [];
  const received = [];
  const released = [];
  const terminalPool = {
    canRun(task, activeTasks) {
      assert.equal(task.thread_id, 'saved-conversation');
      assert.deepEqual(activeTasks, []);
      return true;
    },
    async prepare(task) {
      prepared.push(task);
      return database.updateTask(task.id, {
        thread_id: task.thread_id,
        thread_name: 'Resumed conversation',
        thread_source: 'test pool',
      });
    },
    async release(taskId) {
      released.push(taskId);
    },
  };
  const runner = {
    async run(task) {
      received.push(task);
      return { finalResponse: 'Resumed result', sessionId: task.thread_id, exitCode: 0 };
    },
    cancel() { return false; },
  };
  const queue = new TaskQueue({ database, artifacts, runner, terminalPool });

  try {
    queue.pause();
    const source = queue.enqueue({
      ...directInput('Original work', 'saved-conversation', directory),
      terminalLifecycle: 'disposable',
    });
    database.updateTask(source.id, {
      status: 'complete',
      started_at: '2026-07-28T10:00:00.000Z',
      finished_at: '2026-07-28T10:01:00.000Z',
      result: 'Original result',
    });
    const taskCount = database.listTasks().length;

    const started = queue.startFollowUp({
      ...database.getTask(source.id),
      prompt: 'Continue the saved conversation.',
      attachments: [],
      sessionFollowUp: true,
    }, { resumeDisposable: true });

    assert.equal(started.id, source.id);
    assert.equal(started.status, 'running');
    assert.equal(database.listTasks().length, taskCount);
    await waitFor(() => database.getTask(source.id).status === 'complete');
    assert.equal(prepared.length, 1);
    assert.equal(prepared[0].id, source.id);
    assert.equal(prepared[0].thread_id, 'saved-conversation');
    assert.equal(received.length, 1);
    assert.equal(received[0].id, source.id);
    assert.equal(received[0].prompt, 'Continue the saved conversation.');
    assert.equal(received[0].sessionFollowUp, true);
    assert.equal(database.getTask(source.id).prompt, 'Execute Original work');
    assert.equal(database.getTask(source.id).result, 'Resumed result');
    assert.deepEqual(released, [source.id]);
    assert.equal(database.listTasks().length, taskCount);
  } finally {
    await queue.shutdown();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a disposable follow-up rejects a full terminal pool without changing its task', () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-disposable-follow-up-capacity-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  const artifacts = new ArtifactStore(join(directory, 'tasks'));
  const terminalPool = {
    canRun: () => false,
  };
  const queue = new TaskQueue({
    database,
    artifacts,
    terminalPool,
    runner: { run() {}, cancel() { return false; } },
  });

  try {
    queue.pause();
    const source = queue.enqueue({
      ...directInput('Original work', 'saved-conversation', directory),
      terminalLifecycle: 'disposable',
    });
    database.updateTask(source.id, {
      status: 'complete',
      finished_at: '2026-07-28T10:01:00.000Z',
      result: 'Original result',
    });
    const beforeEvents = database.listEvents(source.id).length;

    assert.throws(() => queue.startFollowUp({
      ...database.getTask(source.id),
      prompt: 'Continue when there is capacity.',
      attachments: [],
      sessionFollowUp: true,
    }, { resumeDisposable: true }), /No terminal slot is free.*not queued/);
    assert.equal(database.getTask(source.id).status, 'complete');
    assert.equal(database.getTask(source.id).result, 'Original result');
    assert.equal(database.listTasks().length, 1);
    assert.equal(database.listEvents(source.id).length, beforeEvents);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('staged follow-up images can be discarded without removing earlier task images', () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-follow-up-image-rollback-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  const artifacts = new ArtifactStore(join(directory, 'tasks'));
  const queue = new TaskQueue({ database, artifacts, runner: { run() {}, cancel() { return false; } } });
  try {
    queue.pause();
    const source = queue.enqueue({
      ...directInput('Original work', 'same-relay', directory),
      attachments: [{ name: 'original.png', mimeType: 'image/png', extension: 'png', data: Buffer.from('original') }],
    });
    const [staged] = queue.stageTaskAttachments(source.id, [
      { name: 'follow-up.png', mimeType: 'image/png', extension: 'png', data: Buffer.from('follow-up') },
    ]);
    assert.equal(staged.id, 'image-2');
    assert.equal(existsSync(staged.path), true);

    queue.discardTaskAttachments(source.id, [staged]);

    assert.equal(existsSync(staged.path), false);
    assert.deepEqual(database.getTask(source.id).attachments.map((attachment) => attachment.id), ['image-1']);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a same-session follow-up is rejected instead of queued when that thread has waiting work', () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-follow-up-conflict-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  const artifacts = new ArtifactStore(join(directory, 'tasks'));
  let runCount = 0;
  const runner = {
    async run(task) {
      runCount += 1;
      return { finalResponse: task.title, sessionId: task.thread_id, exitCode: 0 };
    },
    cancel() { return false; },
  };
  const queue = new TaskQueue({ database, artifacts, runner });

  try {
    queue.pause();
    const source = queue.enqueue(directInput('Finished work', 'shared-relay', directory));
    database.updateTask(source.id, { status: 'complete', finished_at: '2026-07-21T10:00:00.000Z' });
    queue.enqueue(directInput('Waiting work', 'shared-relay', directory));
    const taskCount = database.listTasks().length;

    assert.throws(() => queue.startFollowUp({
      ...database.getTask(source.id),
      prompt: 'Do this now.',
      attachments: [],
      sessionFollowUp: true,
    }), /active or queued work.*not queued/i);
    assert.equal(database.listTasks().length, taskCount);
    assert.equal(database.getTask(source.id).status, 'complete');
    assert.equal(runCount, 0);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a failed immediate follow-up never enters the automatic retry queue', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-follow-up-no-retry-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  const artifacts = new ArtifactStore(join(directory, 'tasks'));
  let runCount = 0;
  const runner = {
    async run() {
      runCount += 1;
      throw new Error('Provider rejected the immediate turn.');
    },
    cancel() { return false; },
  };
  const queue = new TaskQueue({ database, artifacts, runner, retryDelayMs: 20 });

  try {
    queue.pause();
    const source = queue.enqueue(directInput('Finished work', 'same-relay', directory));
    database.updateTask(source.id, {
      status: 'complete',
      finished_at: '2026-07-21T10:00:00.000Z',
      result: 'Previous successful result',
    });
    const taskCount = database.listTasks().length;

    queue.startFollowUp({
      ...database.getTask(source.id),
      prompt: 'Try the next turn.',
      attachments: [],
      sessionFollowUp: true,
    });
    await waitFor(() => database.getTask(source.id).status === 'failed');
    await new Promise((resolve) => setTimeout(resolve, 60));

    assert.equal(database.getTask(source.id).status, 'failed');
    assert.equal(database.getTask(source.id).result, 'Previous successful result');
    assert.match(database.getTask(source.id).error, /^Same-session follow-up failed:/);
    assert.equal(database.listTasks().length, taskCount);
    assert.equal(runCount, 1);
    assert.match(database.listEvents(source.id).at(-1).message, /not queued/i);
    assert.throws(() => queue.retry(source.id), /Continue session.*cannot be placed in the task queue/i);
    assert.equal(database.getTask(source.id).status, 'failed');
  } finally {
    await queue.shutdown();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('queue dispatches newly enqueued work while another terminal is running', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-queue-live-dispatch-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  const artifacts = new ArtifactStore(join(directory, 'tasks'));
  let releaseFirst;
  const firstBlocked = new Promise((resolve) => { releaseFirst = resolve; });
  const started = [];
  const runner = {
    async run(task) {
      started.push(task.thread_id);
      if (task.thread_id === 'one') await firstBlocked;
      return { finalResponse: task.title, sessionId: task.thread_id, exitCode: 0 };
    },
    cancel() { return false; },
  };
  const queue = new TaskQueue({ database, artifacts, runner });

  try {
    const first = queue.enqueue({ title: 'First', prompt: 'One', thread: thread('one', directory) });
    await waitFor(() => database.getTask(first.id).status === 'running');
    const second = queue.enqueue({ title: 'Second', prompt: 'Two', thread: thread('two', directory) });

    await waitFor(() => database.getTask(second.id).status === 'complete');
    assert.equal(database.getTask(first.id).status, 'running');
    assert.deepEqual(started, ['one', 'two']);
    releaseFirst();
    await waitFor(() => database.getTask(first.id).status === 'complete');
  } finally {
    releaseFirst();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a running direct Claude task does not queue direct Codex work', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-claude-codex-concurrency-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  const artifacts = new ArtifactStore(join(directory, 'tasks'));
  let releaseClaude;
  const claudeGate = new Promise((resolve) => { releaseClaude = resolve; });
  const started = [];
  const runner = {
    async run(task) {
      started.push(task.provider);
      if (task.provider === 'claude') await claudeGate;
      return { finalResponse: task.title, sessionId: task.thread_id, exitCode: 0 };
    },
    cancel() {
      releaseClaude();
      return true;
    },
  };
  const queue = new TaskQueue({ database, artifacts, runner });

  try {
    const claude = queue.enqueue(claudeInput('Claude work', 'claude-session', directory));
    await waitFor(() => database.getTask(claude.id).status === 'running');

    const codex = queue.enqueue(directInput('Codex work', 'codex-relay', directory));
    await waitFor(() => database.getTask(codex.id).status === 'complete');

    assert.equal(database.getTask(claude.id).status, 'running');
    assert.deepEqual(started, ['claude', 'codex']);
    releaseClaude();
    await waitFor(() => database.getTask(claude.id).status === 'complete');
  } finally {
    releaseClaude();
    await queue.shutdown();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('direct Claude tasks run concurrently across different sessions', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-claude-concurrent-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  const artifacts = new ArtifactStore(join(directory, 'tasks'));
  let activeClaude = 0;
  let maximumActiveClaude = 0;
  const runner = {
    async run(task) {
      activeClaude += 1;
      maximumActiveClaude = Math.max(maximumActiveClaude, activeClaude);
      await new Promise((resolve) => setTimeout(resolve, 20));
      activeClaude -= 1;
      return { finalResponse: task.title, sessionId: task.thread_id, exitCode: 0 };
    },
    cancel() { return false; },
  };
  const queue = new TaskQueue({ database, artifacts, runner });

  try {
    queue.pause();
    const first = queue.enqueue(claudeInput('First Claude', 'claude-one', directory));
    const second = queue.enqueue(claudeInput('Second Claude', 'claude-two', directory));
    queue.resume();

    await waitFor(() => database.getTask(second.id).status === 'complete');
    assert.equal(database.getTask(first.id).status, 'complete');
    assert.equal(maximumActiveClaude, 2);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('Codex and Claude sessions run simultaneously across an arbitrary project set', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-many-project-concurrency-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  const artifacts = new ArtifactStore(join(directory, 'tasks'));
  let releaseAll;
  const gate = new Promise((resolve) => { releaseAll = resolve; });
  const started = [];
  const runner = {
    async run(task) {
      started.push(`${task.provider}:${task.repo_path}`);
      await gate;
      return { finalResponse: task.title, sessionId: task.thread_id, exitCode: 0 };
    },
    cancel() {
      releaseAll();
      return true;
    },
  };
  const queue = new TaskQueue({ database, artifacts, runner });

  try {
    queue.pause();
    const projectPaths = Array.from({ length: 12 }, (_, index) => `/repo/project-${index + 1}`);
    const tasks = projectPaths.flatMap((repoPath, index) => [
      queue.enqueue(directInput(`Codex ${index + 1}`, `codex-${index + 1}`, repoPath)),
      queue.enqueue(claudeInput(`Claude ${index + 1}`, `claude-${index + 1}`, repoPath)),
    ]);
    queue.resume();

    await waitFor(() => queue.status().activeTaskIds.length === tasks.length);
    assert.equal(tasks.every((task) => database.getTask(task.id).status === 'running'), true);
    assert.deepEqual(new Set(started), new Set(projectPaths.flatMap((repoPath) => [
      `codex:${repoPath}`,
      `claude:${repoPath}`,
    ])));

    releaseAll();
    await waitFor(() => tasks.every((task) => database.getTask(task.id).status === 'complete'));
  } finally {
    releaseAll();
    await queue.shutdown();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('direct Claude tasks remain sequential on the same session', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-claude-same-session-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  const artifacts = new ArtifactStore(join(directory, 'tasks'));
  let activeClaude = 0;
  let maximumActiveClaude = 0;
  const runner = {
    async run(task) {
      activeClaude += 1;
      maximumActiveClaude = Math.max(maximumActiveClaude, activeClaude);
      await new Promise((resolve) => setTimeout(resolve, 20));
      activeClaude -= 1;
      return { finalResponse: task.title, sessionId: task.thread_id, exitCode: 0 };
    },
    cancel() { return false; },
  };
  const queue = new TaskQueue({ database, artifacts, runner });

  try {
    queue.pause();
    const first = queue.enqueue(claudeInput('First Claude', 'claude-shared', directory));
    const second = queue.enqueue(claudeInput('Second Claude', 'claude-shared', directory));
    queue.resume();

    await waitFor(() => database.getTask(second.id).status === 'complete');
    assert.equal(database.getTask(first.id).status, 'complete');
    assert.equal(maximumActiveClaude, 1);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a Claude follow-up can run while another Claude session is active', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-claude-follow-up-concurrent-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  const artifacts = new ArtifactStore(join(directory, 'tasks'));
  let releaseActive;
  const activeGate = new Promise((resolve) => { releaseActive = resolve; });
  const started = [];
  const runner = {
    async run(task) {
      started.push(task.thread_id);
      if (task.thread_id === 'claude-active') await activeGate;
      return { finalResponse: task.title, sessionId: task.thread_id, exitCode: 0 };
    },
    cancel() { return false; },
  };
  const queue = new TaskQueue({ database, artifacts, runner });

  try {
    queue.pause();
    const active = queue.enqueue(claudeInput('Active Claude', 'claude-active', directory));
    const source = queue.enqueue(claudeInput('Finished Claude', 'claude-follow-up', directory));
    database.updateTask(source.id, {
      status: 'complete',
      finished_at: '2026-07-21T10:00:00.000Z',
      result: 'Original result',
    });
    queue.resume();
    await waitFor(() => database.getTask(active.id).status === 'running');

    queue.startFollowUp({
      ...database.getTask(source.id),
      prompt: 'Continue independently.',
      attachments: [],
      sessionFollowUp: true,
    });
    await waitFor(() => database.getTask(source.id).status === 'complete' && started.includes('claude-follow-up'));
    assert.deepEqual(started, ['claude-active', 'claude-follow-up']);
    assert.equal(database.getTask(active.id).status, 'running');

    releaseActive();
    await waitFor(() => database.getTask(active.id).status === 'complete');
  } finally {
    releaseActive();
    await queue.shutdown();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('pausing one project leaves another project queue runnable', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-project-pause-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  const artifacts = new ArtifactStore(join(directory, 'tasks'));
  const order = [];
  const runner = {
    async run(task) {
      order.push(task.title);
      return { finalResponse: task.title, sessionId: task.thread_id, exitCode: 0 };
    },
    cancel() { return false; },
  };
  const queue = new TaskQueue({ database, artifacts, runner });
  try {
    queue.pause('/repo/alpha');
    const alpha = queue.enqueue(directInput('Alpha', 'alpha-relay', '/repo/alpha'));
    const beta = queue.enqueue(directInput('Beta', 'beta-relay', '/repo/beta'));

    await waitFor(() => database.getTask(beta.id).status === 'complete');
    assert.equal(database.getTask(alpha.id).status, 'queued');
    assert.deepEqual(order, ['Beta']);
    assert.equal(queue.status('/repo/alpha').paused, true);
    assert.equal(queue.status('/repo/beta').paused, false);

    queue.resume('/repo/alpha');
    await waitFor(() => database.getTask(alpha.id).status === 'complete');
    assert.deepEqual(order, ['Beta', 'Alpha']);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a Plan council in one project does not block direct Codex work in another project', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-project-council-isolation-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  const artifacts = new ArtifactStore(join(directory, 'tasks'));
  let releaseCouncil;
  const councilGate = new Promise((resolve) => { releaseCouncil = resolve; });
  const started = [];
  const runner = {
    async run(task) {
      started.push(task.title);
      if (task.mode === 'plan') await councilGate;
      return { finalResponse: task.title, sessionId: task.thread_id, exitCode: 0 };
    },
    cancel() {
      releaseCouncil();
      return true;
    },
  };
  const queue = new TaskQueue({ database, artifacts, runner });

  try {
    const council = queue.enqueue({
      title: 'Agreau council',
      prompt: 'Plan Agreau',
      mode: 'plan',
      provider: 'council',
      thread: thread('agreau-reviewer', '/repo/agreau'),
    });
    await waitFor(() => database.getTask(council.id).status === 'running');

    const direct = queue.enqueue(directInput('CC Relay implementation', 'relay-worker', '/repo/relay'));
    await waitFor(() => database.getTask(direct.id).status === 'complete');

    assert.equal(database.getTask(council.id).status, 'running');
    assert.deepEqual(started, ['Agreau council', 'CC Relay implementation']);
    releaseCouncil();
    await waitFor(() => database.getTask(council.id).status === 'complete');
  } finally {
    releaseCouncil();
    await queue.shutdown();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a project Plan council can start while direct Codex work runs in another project', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-project-council-concurrency-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  const artifacts = new ArtifactStore(join(directory, 'tasks'));
  let releaseDirect;
  let releaseCouncil;
  const directGate = new Promise((resolve) => { releaseDirect = resolve; });
  const councilGate = new Promise((resolve) => { releaseCouncil = resolve; });
  const runner = {
    async run(task) {
      if (task.mode === 'plan') await councilGate;
      else await directGate;
      return { finalResponse: task.title, sessionId: task.thread_id, exitCode: 0 };
    },
    cancel() {
      releaseDirect();
      releaseCouncil();
      return true;
    },
  };
  const queue = new TaskQueue({ database, artifacts, runner });

  try {
    const direct = queue.enqueue(directInput('CC Relay implementation', 'relay-worker', '/repo/relay'));
    await waitFor(() => database.getTask(direct.id).status === 'running');
    const council = queue.enqueue({
      title: 'Agreau council',
      prompt: 'Plan Agreau',
      mode: 'plan',
      provider: 'council',
      thread: thread('agreau-reviewer', '/repo/agreau'),
    });

    await waitFor(() => database.getTask(council.id).status === 'running');
    assert.equal(database.getTask(direct.id).status, 'running');
    assert.deepEqual(new Set(queue.status().activeTaskIds), new Set([direct.id, council.id]));
    releaseCouncil();
    releaseDirect();
    await waitFor(() => database.getTask(council.id).status === 'complete'
      && database.getTask(direct.id).status === 'complete');
  } finally {
    releaseDirect();
    releaseCouncil();
    await queue.shutdown();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('queue keeps tasks for one Codex terminal sequential', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-queue-one-terminal-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  const artifacts = new ArtifactStore(join(directory, 'tasks'));
  let active = 0;
  let maximumActive = 0;
  const runner = {
    async run(task) {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 20));
      active -= 1;
      return { finalResponse: task.title, sessionId: task.thread_id, exitCode: 0 };
    },
    cancel() { return false; },
  };
  const queue = new TaskQueue({ database, artifacts, runner });
  try {
    queue.pause();
    const first = queue.enqueue({ title: 'First', prompt: 'One', thread: thread('one', directory) });
    const second = queue.enqueue({ title: 'Second', prompt: 'Two', thread: thread('one', directory) });
    queue.resume();
    await waitFor(() => database.getTask(second.id).status === 'complete');
    assert.equal(database.getTask(first.id).status, 'complete');
    assert.equal(maximumActive, 1);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('queued tasks can be assigned to another terminal', () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-queue-assign-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  const artifacts = new ArtifactStore(join(directory, 'tasks'));
  const queue = new TaskQueue({
    database,
    artifacts,
    runner: { run() {}, cancel() { return false; } },
  });
  try {
    queue.pause();
    const task = queue.enqueue({ title: 'Move me', prompt: 'Work', thread: thread('one', directory) });
    const assigned = queue.assign(task.id, thread('two', directory));
    assert.equal(assigned.thread_id, 'two');
    assert.equal(assigned.thread_name, 'Session two');
    assert.match(readFileSync(join(directory, 'tasks', String(task.id), 'task.md'), 'utf8'), /Thread: `two`/);
    assert.equal(database.listEvents(task.id).at(-1).message, 'Task assigned to Session two.');
    database.updateTask(task.id, { status: 'running' });
    assert.throws(() => queue.assign(task.id, thread('three', directory)), /Only queued tasks/);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('priority submission runs before tasks that are still waiting', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-queue-priority-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  const artifacts = new ArtifactStore(join(directory, 'tasks'));
  const order = [];
  const runner = {
    async run(task) {
      order.push(task.title);
      return { finalResponse: task.title, sessionId: task.thread_id, exitCode: 0 };
    },
    cancel() { return false; },
  };
  const queue = new TaskQueue({ database, artifacts, runner });
  try {
    queue.pause();
    const first = queue.enqueue({ title: 'First', prompt: 'One', thread: thread('one', directory) });
    const second = queue.enqueue({ title: 'Second', prompt: 'Two', thread: thread('two', directory) });
    const urgent = queue.enqueue({ title: 'Urgent', prompt: 'Now', thread: thread('urgent', directory), runNow: true });
    assert.equal(database.nextQueuedTask().id, urgent.id);
    queue.resume();
    await waitFor(() => database.getTask(second.id).status === 'complete');
    assert.deepEqual(order, ['Urgent', 'First', 'Second']);
    assert.equal(database.listEvents(urgent.id).some((event) => /ahead of waiting tasks/.test(event.message)), true);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('queue executes waiting tasks in the reordered sequence', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-queue-reorder-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  const artifacts = new ArtifactStore(join(directory, 'tasks'));
  const order = [];
  const runner = {
    async run(task) {
      order.push(task.title);
      return { finalResponse: task.title, sessionId: `session-${task.id}`, exitCode: 0 };
    },
    cancel() { return false; },
  };
  const queue = new TaskQueue({ database, artifacts, runner });

  try {
    queue.pause();
    const first = queue.enqueue({ title: 'First', prompt: 'One', thread: thread('one', directory) });
    const second = queue.enqueue({ title: 'Second', prompt: 'Two', thread: thread('two', directory) });
    const third = queue.enqueue({ title: 'Third', prompt: 'Three', thread: thread('three', directory) });
    queue.reorder([third.id, first.id, second.id], [first.id, second.id, third.id]);
    queue.resume();

    await waitFor(() => database.getTask(second.id).status === 'complete');
    assert.deepEqual(order, ['Third', 'First', 'Second']);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('queue cancellation and retry work before a task starts', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-retry-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  const artifacts = new ArtifactStore(join(directory, 'tasks'));
  const runner = {
    async run(task) {
      return { finalResponse: `Finished ${task.title}`, sessionId: 'retry-session', exitCode: 0 };
    },
    cancel() {
      return false;
    },
  };
  const queue = new TaskQueue({ database, artifacts, runner });

  try {
    queue.pause();
    const task = queue.enqueue({ title: 'Retry me', prompt: 'Work', thread: thread('retry', directory) });
    queue.cancel(task.id);
    assert.equal(database.getTask(task.id).status, 'cancelled');

    queue.retry(task.id);
    assert.equal(database.getTask(task.id).status, 'queued');
    queue.resume();
    await waitFor(() => database.getTask(task.id).status === 'complete');
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('retry appends after existing queued work and preserves the smallest next position', () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-retry-position-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  const artifacts = new ArtifactStore(join(directory, 'tasks'));
  const queue = new TaskQueue({
    database,
    artifacts,
    runner: { run() {}, cancel() { return false; } },
  });

  try {
    queue.pause();
    const first = queue.enqueue({ title: 'First', prompt: 'First', thread: thread('first', directory) });
    const failed = queue.enqueue({ title: 'Retry later', prompt: 'Retry', thread: thread('failed', directory) });
    const third = queue.enqueue({ title: 'Third', prompt: 'Third', thread: thread('third', directory) });
    database.updateTask(failed.id, { status: 'failed', error: 'Temporary failure.' });

    const retried = queue.retry(failed.id);
    assert.ok(retried.position > third.position);
    assert.ok(first.position < third.position);
    assert.equal(database.nextQueuedTask().id, first.id);
    assert.deepEqual(
      database.listTasks().filter((task) => task.status === 'queued').map((task) => task.id),
      [first.id, third.id, failed.id],
    );
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('manual retry can change executor, model, and effort for an automatic Execute task', () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-retry-execution-settings-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  const artifacts = new ArtifactStore(join(directory, 'tasks'));
  const queue = new TaskQueue({
    database,
    artifacts,
    runner: { run() {}, cancel() { return false; } },
  });

  try {
    queue.pause();
    const task = queue.enqueue({
      ...directInput('Retry elsewhere', 'saved-codex-thread', directory),
      terminalLifecycle: 'disposable',
      model: 'gpt-test',
      effort: 'high',
      continuedFromTaskId: 41,
    });
    database.updateTask(task.id, {
      status: 'failed',
      session_id: 'saved-codex-thread',
      result: 'Stale result',
      error: 'Codex failed.',
    });

    const retried = queue.retry(task.id, {
      execution: { provider: 'claude', model: 'sonnet', effort: 'max' },
    });
    assert.equal(retried.status, 'queued');
    assert.equal(retried.provider, 'claude');
    assert.equal(retried.model, 'sonnet');
    assert.equal(retried.effort, 'max');
    assert.equal(retried.thread_id, null);
    assert.equal(retried.thread_name, null);
    assert.equal(retried.thread_source, null);
    assert.equal(retried.session_id, null);
    assert.equal(retried.continued_from_task_id, null);
    assert.equal(retried.result, null);
    assert.equal(retried.error, null);
    const events = database.listEvents(task.id).map((event) => event.message).join('\n');
    assert.match(events, /Retry executor changed from Codex to Claude/);
    assert.match(events, /fresh Claude conversation/);
    const markdown = readFileSync(join(artifacts.taskDirectory(task.id), 'task.md'), 'utf8');
    assert.match(markdown, /Provider: claude/);
    assert.match(markdown, /Model: sonnet/);
    assert.match(markdown, /Effort: max/);
    assert.doesNotMatch(markdown, /Continues task:/);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('manual retry can change effort without discarding the same-provider conversation', () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-retry-effort-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  const artifacts = new ArtifactStore(join(directory, 'tasks'));
  const queue = new TaskQueue({
    database,
    artifacts,
    runner: { run() {}, cancel() { return false; } },
  });

  try {
    queue.pause();
    const task = queue.enqueue({
      ...directInput('Retry with more effort', 'same-codex-thread', directory),
      terminalLifecycle: 'disposable',
      model: 'gpt-test',
      effort: 'medium',
    });
    database.updateTask(task.id, { status: 'interrupted', error: 'Restarted.' });
    const retried = queue.retry(task.id, {
      execution: { provider: 'codex', model: 'gpt-test', effort: 'xhigh' },
    });
    assert.equal(retried.provider, 'codex');
    assert.equal(retried.effort, 'xhigh');
    assert.equal(retried.thread_id, 'same-codex-thread');
    assert.match(
      database.listEvents(task.id).map((event) => event.message).join('\n'),
      /Retry execution settings changed to Codex \/ gpt-test \/ xhigh/,
    );
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('retry execution changes reject workflow-owned and automatic retry paths', () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-retry-settings-guard-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  const artifacts = new ArtifactStore(join(directory, 'tasks'));
  const queue = new TaskQueue({
    database,
    artifacts,
    runner: { run() {}, cancel() { return false; } },
  });

  try {
    queue.pause();
    const plan = queue.enqueue(planInput('Owned route', 'plan-reviewer', directory));
    database.updateTask(plan.id, { status: 'failed', error: 'Review failed.' });
    assert.throws(
      () => queue.retry(plan.id, {
        execution: { provider: 'claude', model: 'sonnet', effort: 'high' },
      }),
      /Only automatic Execute tasks/,
    );

    const direct = queue.enqueue({
      ...directInput('Automatic guard', 'automatic-guard', directory),
      terminalLifecycle: 'disposable',
    });
    database.updateTask(direct.id, { status: 'failed', error: 'Transient.' });
    assert.throws(
      () => queue.retry(direct.id, {
        automatic: true,
        execution: { provider: 'codex', model: null, effort: 'high' },
      }),
      /Automatic retries cannot change executor or effort/,
    );
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('failed tasks automatically retry after the configured wait', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-auto-retry-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  const artifacts = new ArtifactStore(join(directory, 'tasks'));
  let attempts = 0;
  const runner = {
    async run() {
      attempts += 1;
      if (attempts === 1) throw new Error('Temporary failure.');
      return { finalResponse: 'Recovered', sessionId: 'retry-session', exitCode: 0 };
    },
    cancel() { return false; },
  };
  const queue = new TaskQueue({ database, artifacts, runner, retryDelayMs: 30 });

  try {
    const task = queue.enqueue({ title: 'Recover', prompt: 'Work', thread: thread('recover', directory) });
    await waitFor(() => database.getTask(task.id).status === 'failed');
    assert.equal(attempts, 1);
    assert.match(database.listEvents(task.id).at(-1).message, /Retrying automatically/);
    await waitFor(() => database.getTask(task.id).status === 'complete');
    assert.equal(attempts, 2);
    assert.equal(database.getTask(task.id).result, 'Recovered');
    assert.match(
      database.listEvents(task.id).map((event) => event.message).join('\n'),
      /Automatic retry started/,
    );
  } finally {
    await queue.shutdown();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('automatic retries stop after the configured safety limit', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-auto-retry-limit-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  const artifacts = new ArtifactStore(join(directory, 'tasks'));
  let attempts = 0;
  const runner = {
    async run() {
      attempts += 1;
      throw new Error('Persistent failure.');
    },
    cancel() { return false; },
  };
  const queue = new TaskQueue({
    database,
    artifacts,
    runner,
    retryDelayMs: 15,
    maxAutomaticRetries: 2,
  });

  try {
    const task = queue.enqueue({ title: 'Bound retries', prompt: 'Work', thread: thread('bounded', directory) });
    await waitFor(() => (
      attempts === 3
      && database.getTask(task.id).status === 'failed'
      && !queue.pendingRetryTaskIds().has(task.id)
    ));
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(attempts, 3);
    assert.match(database.listEvents(task.id).at(-1).message, /after 2 automatic retries/i);
  } finally {
    await queue.shutdown();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('non-retryable session failures wait for manual retry', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-manual-retry-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  const artifacts = new ArtifactStore(join(directory, 'tasks'));
  let attempts = 0;
  const runner = {
    run: async () => {
      attempts += 1;
      const error = new Error('Selected terminal is not resumable.');
      error.retryable = false;
      throw error;
    },
    cancel: () => false,
  };
  const queue = new TaskQueue({ database, artifacts, runner, retryDelayMs: 20 });
  try {
    const task = queue.enqueue({ title: 'Needs terminal', prompt: 'Work', thread: thread('closed', directory) });
    queue.start();
    await waitFor(() => database.getTask(task.id).status === 'failed');
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(attempts, 1);
    assert.match(database.listEvents(task.id).at(-1).message, /retry it manually/i);
  } finally {
    await queue.shutdown();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('Plan council failures never enter the automatic retry loop', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-plan-manual-resume-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  const artifacts = new ArtifactStore(join(directory, 'tasks'));
  let attempts = 0;
  const queue = new TaskQueue({
    database,
    artifacts,
    retryDelayMs: 20,
    runner: {
      async run() {
        attempts += 1;
        throw new Error('Claude authentication expired.');
      },
      cancel() { return false; },
    },
  });

  try {
    const task = queue.enqueue(planInput('No usage loop', 'reviewer', directory));
    await waitFor(() => database.getTask(task.id).status === 'failed');
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(attempts, 1);
    assert.equal(queue.pendingRetryTaskIds().has(task.id), false);
    assert.match(database.listEvents(task.id).at(-1).message, /saved checkpoints/);
  } finally {
    await queue.shutdown();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('manual Plan council retry preserves completed stage checkpoints', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-plan-checkpoint-retry-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  const artifacts = new ArtifactStore(join(directory, 'tasks'));
  const queue = new TaskQueue({
    database,
    artifacts,
    runner: { run() {}, cancel() { return false; } },
  });

  try {
    queue.pause(directory);
    const task = queue.enqueue(planInput('Keep draft', 'reviewer', directory));
    artifacts.writePlan(task.id, {
      version: 2,
      taskId: task.id,
      status: 'failed',
      author: { provider: 'claude', model: 'opus', effort: 'max' },
      reviewer: { provider: 'codex', model: 'gpt-test', effort: 'high' },
      stages: [
        { id: 'draft', label: 'Claude draft', status: 'complete' },
        { id: 'review', label: 'Codex review', status: 'failed' },
        { id: 'revision', label: 'Claude revision', status: 'pending' },
      ],
      draft: '# Saved draft',
      review: '',
      finalPlan: '',
    });
    database.updateTask(task.id, { status: 'failed', error: 'Reviewer disconnected.' });
    artifacts.writeError(task.id, 'Reviewer disconnected.');

    queue.retry(task.id);
    assert.equal(database.getTask(task.id).status, 'queued');
    assert.equal(artifacts.readPlan(task.id).draft, '# Saved draft');
    assert.equal(existsSync(join(artifacts.taskDirectory(task.id), 'error.txt')), false);
  } finally {
    await queue.shutdown();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('completed Plan council stores one canonical Markdown plan without a duplicate result file', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-plan-single-artifact-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  const artifacts = new ArtifactStore(join(directory, 'tasks'));
  const queue = new TaskQueue({
    database,
    artifacts,
    runner: {
      async run(task) {
        artifacts.writeResult(task.id, 'Stale duplicate result.');
        artifacts.writePlan(task.id, {
          version: 2,
          taskId: task.id,
          status: 'complete',
          finalPlan: '# Only final plan',
          stages: [],
        }, { repoPath: task.repo_path });
        return { finalResponse: '# Only final plan', sessionId: task.thread_id, exitCode: 0 };
      },
      cancel() { return false; },
    },
  });

  try {
    const task = queue.enqueue(planInput('Single artifact', 'reviewer', directory));
    await waitFor(() => database.getTask(task.id).status === 'complete');
    assert.equal(
      readFileSync(artifacts.planPath(task.id, task.repo_path), 'utf8'),
      '# Only final plan\n',
    );
    assert.equal(existsSync(artifacts.planPath(task.id)), false);
    assert.equal(existsSync(join(artifacts.taskDirectory(task.id), 'result.md')), false);
  } finally {
    await queue.shutdown();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('deleting a task removes its stored artifacts', () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-delete-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  const artifacts = new ArtifactStore(join(directory, 'tasks'));
  const queue = new TaskQueue({
    database,
    artifacts,
    runner: { run() {}, cancel() { return false; } },
  });

  try {
    queue.pause();
    const task = queue.enqueue({ title: 'Delete me', prompt: 'Work', thread: thread('delete', directory) });
    assert.equal(existsSync(artifacts.taskDirectory(task.id)), true);
    assert.equal(queue.delete(task.id), true);
    assert.equal(database.getTask(task.id), null);
    assert.equal(existsSync(artifacts.taskDirectory(task.id)), false);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('queued task request can be edited without changing routing, order, or attachments', () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-edit-queued-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  const artifacts = new ArtifactStore(join(directory, 'tasks'));
  const queue = new TaskQueue({
    database,
    artifacts,
    runner: { run() {}, cancel() { return false; } },
  });

  try {
    queue.pause();
    const task = queue.enqueue({
      title: 'Original request',
      prompt: 'Original prompt',
      thread: thread('edit', directory),
      provider: 'codex',
      model: 'gpt-test',
      effort: 'high',
      attachments: [{
        name: 'reference.png',
        mimeType: 'image/png',
        extension: 'png',
        data: Buffer.from('89504e470d0a1a0a00000000', 'hex'),
      }],
    });

    const edited = queue.edit(task.id, {
      title: 'Updated request',
      prompt: 'Updated prompt with clearer requirements.',
    });

    assert.equal(edited.title, 'Updated request');
    assert.equal(edited.prompt, 'Updated prompt with clearer requirements.');
    assert.equal(edited.position, task.position);
    assert.equal(edited.thread_id, task.thread_id);
    assert.equal(edited.model, task.model);
    assert.equal(edited.effort, task.effort);
    assert.equal(edited.attachments.length, 1);
    const markdown = readFileSync(join(artifacts.taskDirectory(task.id), 'task.md'), 'utf8');
    assert.match(markdown, /# Updated request/);
    assert.match(markdown, /Updated prompt with clearer requirements\./);
    assert.doesNotMatch(markdown, /Original prompt/);
    assert.match(markdown, /Reference images[\s\S]*reference\.png/);
    assert.match(database.listEvents(task.id).at(-1).message, /request edited before execution/i);

    const renamed = queue.edit(task.id, {
      title: 'Release readiness review',
      prompt: edited.prompt,
    });
    assert.equal(renamed.title, 'Release readiness review');
    assert.equal(renamed.prompt, edited.prompt);
    assert.equal(renamed.position, task.position);
    assert.match(database.listEvents(task.id).at(-1).message, /renamed from "Updated request" to "Release readiness review"/i);
    assert.match(
      readFileSync(join(artifacts.taskDirectory(task.id), 'task.md'), 'utf8'),
      /# Release readiness review/,
    );

    database.updateTask(task.id, { status: 'running' });
    assert.throws(
      () => queue.edit(task.id, { title: 'Too late', prompt: 'Do not save' }),
      /still waiting in the queue/,
    );
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('automatic queued Execute tasks can switch between Claude and Codex before dispatch', () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-switch-queued-provider-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  const artifacts = new ArtifactStore(join(directory, 'tasks'));
  const queue = new TaskQueue({
    database,
    artifacts,
    runner: { run() {}, cancel() { return false; } },
  });

  try {
    queue.pause();
    const task = queue.enqueue({
      title: 'Switch provider',
      prompt: 'Run this with the selected provider.',
      thread: thread('saved-claude-conversation', directory),
      provider: 'claude',
      model: 'opus',
      effort: 'high',
      terminalLifecycle: 'disposable',
      continuedFromTaskId: 41,
      attachments: [{
        name: 'switch-reference.png',
        mimeType: 'image/png',
        extension: 'png',
        data: Buffer.from('89504e470d0a1a0a00000000', 'hex'),
      }],
    });
    database.updateTask(task.id, { session_id: 'saved-claude-conversation' });

    const codexTask = queue.edit(task.id, {
      title: task.title,
      prompt: task.prompt,
      provider: 'codex',
      model: 'gpt-test',
      effort: 'xhigh',
    });

    assert.equal(codexTask.provider, 'codex');
    assert.equal(codexTask.model, 'gpt-test');
    assert.equal(codexTask.effort, 'xhigh');
    assert.equal(codexTask.thread_id, null);
    assert.equal(codexTask.thread_name, null);
    assert.equal(codexTask.thread_source, null);
    assert.equal(codexTask.session_id, null);
    assert.equal(codexTask.continued_from_task_id, null);
    assert.equal(codexTask.position, task.position);
    assert.equal(codexTask.attachments.length, 1);
    assert.match(database.listEvents(task.id).at(-1).message, /switched from Claude to Codex/i);
    let markdown = readFileSync(join(artifacts.taskDirectory(task.id), 'task.md'), 'utf8');
    assert.match(markdown, /Provider: codex/);
    assert.match(markdown, /Model: gpt-test/);
    assert.match(markdown, /switch-reference\.png/);
    assert.doesNotMatch(markdown, /Continues task:/);

    const claudeTask = queue.edit(task.id, {
      title: task.title,
      prompt: task.prompt,
      provider: 'claude',
      model: 'sonnet',
      effort: 'max',
    });
    assert.equal(claudeTask.provider, 'claude');
    assert.equal(claudeTask.model, 'sonnet');
    assert.equal(claudeTask.effort, 'max');
    assert.match(database.listEvents(task.id).at(-1).message, /switched from Codex to Claude/i);
    markdown = readFileSync(join(artifacts.taskDirectory(task.id), 'task.md'), 'utf8');
    assert.match(markdown, /Provider: claude/);
    assert.match(markdown, /Model: sonnet/);

    const legacy = queue.enqueue({
      ...directInput('Legacy pinned task', 'legacy-provider-switch', directory),
      model: 'gpt-test',
      effort: 'high',
    });
    assert.throws(
      () => queue.edit(legacy.id, {
        title: legacy.title,
        prompt: legacy.prompt,
        provider: 'claude',
        model: 'sonnet',
        effort: 'high',
      }),
      /Only automatic queued Execute tasks/,
    );
    assert.equal(database.getTask(legacy.id).provider, 'codex');
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('queue persists image attachments before scheduling a task', () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-attachment-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  const artifacts = new ArtifactStore(join(directory, 'tasks'));
  const queue = new TaskQueue({
    database,
    artifacts,
    runner: { run() {}, cancel() { return false; } },
  });

  try {
    queue.pause();
    const task = queue.enqueue({
      title: 'Inspect image',
      prompt: 'Review the screenshot.',
      thread: thread('image', directory),
      attachments: [{
        name: 'screen.png',
        mimeType: 'image/png',
        extension: 'png',
        data: Buffer.from('89504e470d0a1a0a00000000', 'hex'),
      }],
    });
    assert.equal(task.attachments.length, 1);
    assert.equal(task.attachments[0].name, 'screen.png');
    assert.equal(existsSync(task.attachments[0].path), true);
    assert.match(
      readFileSync(join(artifacts.taskDirectory(task.id), 'task.md'), 'utf8'),
      /Reference images[\s\S]*screen\.png/,
    );
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('queue marks an active task interrupted during shutdown', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-shutdown-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  const artifacts = new ArtifactStore(join(directory, 'tasks'));
  let rejectRun;
  const runner = {
    run() {
      return new Promise((resolve, reject) => {
        rejectRun = reject;
      });
    },
    cancel() {
      const error = new Error('Task cancelled.');
      error.cancelled = true;
      rejectRun(error);
      return true;
    },
  };
  const queue = new TaskQueue({ database, artifacts, runner });

  try {
    const task = queue.enqueue({ title: 'Stop me', prompt: 'Work', thread: thread('stop', directory) });
    await waitFor(() => database.getTask(task.id).status === 'running');
    await queue.shutdown();
    assert.equal(database.getTask(task.id).status, 'interrupted');
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('queue prepares the next Turbo task while current workers execute', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-lookahead-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  const artifacts = new ArtifactStore(join(directory, 'tasks'));
  let releaseCurrent;
  const currentBlocked = new Promise((resolve) => { releaseCurrent = resolve; });
  const prepared = [];
  const runner = {
    async run(task, { onEvent }) {
      const plan = readyTurboPlan(task, task.turbo.workers[0].threadId);
      plan.status = 'executing';
      artifacts.writeTurboPlan(task.id, plan);
      onEvent({ event: { type: 'turbo/stage', phase: 'workers', provider: 'plan' }, message: 'Workers running.' });
      if (task.title === 'Current') await currentBlocked;
      return { finalResponse: task.title, sessionId: task.thread_id, exitCode: 0 };
    },
    async prepare(task) {
      prepared.push(task.id);
      const plan = readyTurboPlan(task, task.turbo.workers[0].threadId);
      artifacts.writeTurboPlan(task.id, plan);
      return plan;
    },
    cancel() { return true; },
  };
  const queue = new TaskQueue({ database, artifacts, runner });
  try {
    const current = queue.enqueue(turboInput('Current', 'planner-current', 'worker-current', directory));
    const next = queue.enqueue(turboInput('Next', 'planner-next', 'worker-next', directory));
    await waitFor(() => prepared.includes(next.id));
    assert.equal(database.getTask(current.id).status, 'running');
    assert.equal(database.getTask(next.id).status, 'queued');
    assert.deepEqual(queue.status().planningTaskIds, []);
    assert.match(database.listEvents(next.id).map((event) => event.message).join('\n'), /Forward plan ready/);
    releaseCurrent();
    await waitFor(() => database.getTask(next.id).status === 'complete');
  } finally {
    releaseCurrent();
    await queue.shutdown();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('queue releases a council planner for the next draft while Claude reviews remain serialized', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-council-lookahead-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  const artifacts = new ArtifactStore(join(directory, 'tasks'));
  let releaseCurrent;
  const prepared = [];
  const executionOrder = [];
  const reviewReleases = new Map();
  const reviewQueue = [];
  let activeReviews = 0;
  let maximumReviews = 0;
  const pumpReview = () => {
    if (activeReviews > 0 || reviewQueue.length === 0) return;
    const next = reviewQueue.shift();
    activeReviews += 1;
    maximumReviews = Math.max(maximumReviews, activeReviews);
    next.start();
  };
  const runner = {
    async run(task, { onEvent }) {
      executionOrder.push(task.title);
      const plan = readyTurboPlan(task, task.turbo.workers[0].threadId);
      plan.status = 'executing';
      artifacts.writeTurboPlan(task.id, plan);
      onEvent({ event: { type: 'turbo/stage', phase: 'workers', provider: 'plan' }, message: 'Workers running.' });
      if (task.title === 'Current') {
        await new Promise((resolve) => { releaseCurrent = resolve; });
      }
      return { finalResponse: task.title, sessionId: task.thread_id, exitCode: 0 };
    },
    async prepare(task, callbacks) {
      prepared.push(task.title);
      const plan = readyTurboPlan(task, task.turbo.workers[0].threadId);
      plan.council = {
        enabled: true,
        order: ['codex', 'claude'],
        reviewerProvider: 'claude',
        reviewerModel: 'sonnet',
        reviewerEffort: 'high',
        status: 'queued',
      };
      callbacks.onEvent({
        event: { type: 'turbo/stage', phase: 'planner', status: 'running' },
        message: 'Codex planning.',
      });
      callbacks.onEvent({
        event: { type: 'turbo/stage', phase: 'planner', status: 'complete', plan },
        message: 'Codex planner released.',
      });
      await new Promise((resolve) => {
        reviewQueue.push({
          start: () => {
            callbacks.onEvent({
              event: { type: 'turbo/stage', phase: 'council-review', status: 'running', plan },
              message: 'Claude reviewing.',
            });
            reviewReleases.set(task.title, () => {
              activeReviews -= 1;
              resolve(plan);
              pumpReview();
            });
          },
        });
        pumpReview();
      });
      artifacts.writeTurboPlan(task.id, plan);
      return plan;
    },
    cancel(taskId) {
      const title = database.getTask(taskId)?.title;
      reviewReleases.get(title)?.();
      return true;
    },
  };
  const queue = new TaskQueue({ database, artifacts, runner });

  try {
    const current = queue.enqueue(turboInput('Current', 'planner-current', 'worker-current', directory));
    const next = queue.enqueue(councilTurboInput('Next', 'planner-lookahead', 'worker-next', directory));
    const third = queue.enqueue(councilTurboInput('Third', 'planner-lookahead', 'worker-third', directory));
    await waitFor(() => prepared.length === 2);
    assert.deepEqual(prepared, ['Next', 'Third']);
    assert.equal(database.getTask(next.id).status, 'queued');
    assert.equal(database.getTask(third.id).status, 'queued');
    assert.deepEqual(queue.status().reviewingTaskIds, [next.id]);
    assert.equal(maximumReviews, 1);
    assert.deepEqual(executionOrder, ['Current']);

    reviewReleases.get('Next')();
    await waitFor(() => artifacts.readTurboPlan(next.id)?.status === 'ready');
    await waitFor(() => queue.status().reviewingTaskIds.includes(third.id));
    reviewReleases.get('Third')();
    await waitFor(() => artifacts.readTurboPlan(third.id)?.status === 'ready');
    assert.equal(database.getTask(next.id).status, 'queued');
    assert.equal(database.getTask(third.id).status, 'queued');
    assert.equal(maximumReviews, 1);

    releaseCurrent();
    await waitFor(() => database.getTask(third.id).status === 'complete');
    assert.deepEqual(executionOrder, ['Current', 'Next', 'Third']);
  } finally {
    releaseCurrent?.();
    for (const release of reviewReleases.values()) release();
    await queue.shutdown();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('queue cancellation of a waiting council review leaves another parent review untouched', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-council-cancel-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  const artifacts = new ArtifactStore(join(directory, 'tasks'));
  const cancelled = [];
  const releaseCurrent = [];
  const reviews = new Map();
  let activeReviewId = null;
  const startNextReview = () => {
    if (activeReviewId != null) return;
    const next = [...reviews.values()].find((entry) => !entry.started);
    if (!next) return;
    next.started = true;
    activeReviewId = next.task.id;
    next.callbacks.onEvent({
      event: { type: 'turbo/stage', phase: 'council-review', status: 'running', plan: next.plan },
      message: 'Claude reviewing.',
    });
  };
  const runner = {
    async run(task, { onEvent }) {
      const plan = readyTurboPlan(task, task.turbo.workers[0].threadId);
      plan.status = 'executing';
      artifacts.writeTurboPlan(task.id, plan);
      onEvent({ event: { type: 'turbo/stage', phase: 'workers', provider: 'plan' }, message: 'Workers running.' });
      await new Promise((resolve) => releaseCurrent.push(resolve));
      return { finalResponse: task.title, sessionId: task.thread_id, exitCode: 0 };
    },
    async prepare(task, callbacks) {
      const plan = readyTurboPlan(task, task.turbo.workers[0].threadId);
      plan.council = { enabled: true, order: ['codex', 'claude'], reviewerProvider: 'claude', reviewerModel: 'sonnet', reviewerEffort: 'high', status: 'queued' };
      callbacks.onEvent({ event: { type: 'turbo/stage', phase: 'planner', status: 'complete', plan }, message: 'Planner released.' });
      await new Promise((resolve, reject) => {
        reviews.set(task.id, { task, callbacks, plan, resolve, reject, started: false });
        startNextReview();
      });
      return plan;
    },
    cancel(taskId) {
      cancelled.push(taskId);
      const review = reviews.get(taskId);
      review?.reject(Object.assign(new Error('review cancelled'), { cancelled: true }));
      if (activeReviewId === taskId) activeReviewId = null;
      reviews.delete(taskId);
      startNextReview();
      return true;
    },
  };
  const queue = new TaskQueue({ database, artifacts, runner });
  try {
    const current = queue.enqueue(turboInput('Current', 'planner-current', 'worker-current', directory));
    const first = queue.enqueue(councilTurboInput('First review', 'planner-lookahead', 'worker-first', directory));
    const second = queue.enqueue(councilTurboInput('Second review', 'planner-lookahead', 'worker-second', directory));
    await waitFor(() => queue.status().reviewingTaskIds.length === 1
      && queue.status().planningTaskIds.includes(second.id));
    queue.cancel(second.id);
    assert.equal(database.getTask(second.id).status, 'cancelled');
    assert.deepEqual(cancelled, [second.id]);
    assert.equal(database.getTask(current.id).status, 'running');
    assert.equal(database.getTask(first.id).status, 'queued');
    releaseCurrent.forEach((release) => release());
  } finally {
    releaseCurrent.forEach((release) => release());
    await queue.shutdown();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a direct task on a newly added CC Relay runs while Turbo workers remain active', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-turbo-direct-free-relay-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  const artifacts = new ArtifactStore(join(directory, 'tasks'));
  let releaseTurbo;
  const turboGate = new Promise((resolve) => { releaseTurbo = resolve; });
  const started = [];
  const runner = {
    async run(task, { onEvent }) {
      started.push(task.title);
      if (task.mode === 'turbo') {
        artifacts.writeTurboPlan(task.id, executingTurboPlan(task));
        onEvent({ event: { type: 'turbo/stage', phase: 'workers', provider: 'plan' }, message: 'Workers running.' });
        await turboGate;
      }
      return { finalResponse: task.title, sessionId: task.thread_id, exitCode: 0 };
    },
    cancel() {
      releaseTurbo();
      return true;
    },
  };
  const queue = new TaskQueue({ database, artifacts, runner });
  try {
    const turbo = queue.enqueue(turboInput('Turbo', 'planner-turbo', 'worker-turbo', directory));
    await waitFor(() => database.getTask(turbo.id).status === 'running');
    const direct = queue.enqueue(directInput('New CC Relay work', 'worker-new-relay', directory));
    await waitFor(() => database.getTask(direct.id).status === 'complete');
    assert.equal(database.getTask(turbo.id).status, 'running');
    assert.deepEqual(started, ['Turbo', 'New CC Relay work']);
    releaseTurbo();
    await waitFor(() => database.getTask(turbo.id).status === 'complete');
  } finally {
    releaseTurbo();
    await queue.shutdown();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('direct work can pass a queued forward-planned Turbo entry while Turbo is executing', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-turbo-direct-queued-barrier-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  const artifacts = new ArtifactStore(join(directory, 'tasks'));
  let releaseTurbo;
  const turboGate = new Promise((resolve) => { releaseTurbo = resolve; });
  const started = [];
  const prepared = [];
  const runner = {
    async run(task, { onEvent }) {
      started.push(task.title);
      if (task.mode === 'turbo') {
        artifacts.writeTurboPlan(task.id, executingTurboPlan(task));
        onEvent({ event: { type: 'turbo/stage', phase: 'workers', provider: 'plan' }, message: 'Workers running.' });
        if (task.title === 'Current Turbo') await turboGate;
      }
      return { finalResponse: task.title, sessionId: task.thread_id, exitCode: 0 };
    },
    async prepare(task) {
      prepared.push(task.title);
      const plan = readyTurboPlan(task, task.turbo.workers[0].threadId);
      artifacts.writeTurboPlan(task.id, plan);
      return plan;
    },
    cancel() {
      releaseTurbo();
      return true;
    },
  };
  const queue = new TaskQueue({ database, artifacts, runner });
  try {
    const current = queue.enqueue(turboInput('Current Turbo', 'planner-current', 'worker-current', directory));
    await waitFor(() => database.getTask(current.id).status === 'running');
    const queuedTurbo = queue.enqueue(turboInput('Queued Turbo', 'planner-queued', 'worker-queued', directory));
    const direct = queue.enqueue(directInput('Direct after Turbo', 'worker-new', directory));
    await waitFor(() => database.getTask(direct.id).status === 'complete');
    assert.deepEqual(prepared, ['Queued Turbo']);
    assert.equal(database.getTask(queuedTurbo.id).status, 'queued');
    assert.deepEqual(started, ['Current Turbo', 'Direct after Turbo']);
    releaseTurbo();
    await waitFor(() => database.getTask(current.id).status === 'complete');
  } finally {
    releaseTurbo();
    await queue.shutdown();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('direct tasks targeting Turbo workers or busy look-ahead planners remain queued', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-turbo-direct-reserved-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  const artifacts = new ArtifactStore(join(directory, 'tasks'));
  let releaseTurbo;
  let releasePreparation;
  const turboGate = new Promise((resolve) => { releaseTurbo = resolve; });
  const preparationGate = new Promise((resolve) => { releasePreparation = resolve; });
  const started = [];
  const runner = {
    async run(task, { onEvent }) {
      started.push(task.title);
      if (task.mode === 'turbo') {
        artifacts.writeTurboPlan(task.id, executingTurboPlan(task));
        onEvent({ event: { type: 'turbo/stage', phase: 'workers', provider: 'plan' }, message: 'Workers running.' });
        await turboGate;
      }
      return { finalResponse: task.title, sessionId: task.thread_id, exitCode: 0 };
    },
    async prepare(task) {
      await preparationGate;
      const plan = readyTurboPlan(task, task.turbo.workers[0].threadId);
      artifacts.writeTurboPlan(task.id, plan);
      return plan;
    },
    cancel() {
      releaseTurbo();
      releasePreparation();
      return true;
    },
  };
  const queue = new TaskQueue({ database, artifacts, runner });
  try {
    const current = queue.enqueue(turboInput('Current Turbo', 'planner-current', 'worker-turbo', directory));
    await waitFor(() => database.getTask(current.id).status === 'running');
    const lookahead = queue.enqueue(turboInput('Lookahead Turbo', 'planner-busy', 'worker-lookahead', directory));
    await waitFor(() => queue.status().planningTaskIds.includes(lookahead.id));
    const workerTarget = queue.enqueue(directInput('Targets worker', 'worker-turbo', directory));
    const plannerTarget = queue.enqueue(directInput('Targets planner', 'planner-busy', directory));
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(database.getTask(workerTarget.id).status, 'queued');
    assert.equal(database.getTask(plannerTarget.id).status, 'queued');
    assert.deepEqual(started, ['Current Turbo']);
  } finally {
    releaseTurbo();
    releasePreparation();
    await queue.shutdown();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('normal exclusive FIFO barriers return after Turbo completes', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-turbo-direct-exclusive-barrier-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  const artifacts = new ArtifactStore(join(directory, 'tasks'));
  let releaseTurbo;
  let releasePlan;
  const turboGate = new Promise((resolve) => { releaseTurbo = resolve; });
  const planGate = new Promise((resolve) => { releasePlan = resolve; });
  const started = [];
  const runner = {
    async run(task, { onEvent }) {
      started.push(task.title);
      if (task.mode === 'turbo') {
        artifacts.writeTurboPlan(task.id, executingTurboPlan(task));
        onEvent({ event: { type: 'turbo/stage', phase: 'workers', provider: 'plan' }, message: 'Workers running.' });
        await turboGate;
      }
      if (task.mode === 'plan') await planGate;
      return { finalResponse: task.title, sessionId: task.thread_id, exitCode: 0 };
    },
    cancel() {
      releaseTurbo();
      releasePlan();
      return true;
    },
  };
  const queue = new TaskQueue({ database, artifacts, runner });
  try {
    const turbo = queue.enqueue(turboInput('Current Turbo', 'planner-current', 'worker-current', directory));
    await waitFor(() => database.getTask(turbo.id).status === 'running');
    const exclusive = queue.enqueue({ title: 'Plan council barrier', prompt: 'Review this', mode: 'plan', provider: 'council', thread: thread('planner-review', directory) });
    const directDuringTurbo = queue.enqueue(directInput('Direct during Turbo', 'worker-free', directory));
    await waitFor(() => database.getTask(directDuringTurbo.id).status === 'complete');
    assert.equal(database.getTask(exclusive.id).status, 'queued');
    releaseTurbo();
    await waitFor(() => database.getTask(exclusive.id).status === 'running');
    const directAfterTurbo = queue.enqueue(directInput('Direct after exclusive', 'worker-after', directory));
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(database.getTask(directAfterTurbo.id).status, 'queued');
    assert.deepEqual(started, ['Current Turbo', 'Direct during Turbo', 'Plan council barrier']);
    releasePlan();
    await waitFor(() => database.getTask(directAfterTurbo.id).status === 'complete');
  } finally {
    releaseTurbo();
    releasePlan();
    await queue.shutdown();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a terminal reserved for closing rejects new, retried, and reassigned work', () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-terminal-closing-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  const artifacts = new ArtifactStore(join(directory, 'tasks'));
  const unavailable = new Set(['closing-relay']);
  const queue = new TaskQueue({
    database,
    artifacts,
    runner: { run: async () => ({ finalResponse: '', exitCode: 0 }) },
    isThreadAvailable: (threadId) => !unavailable.has(threadId),
  });
  try {
    assert.throws(
      () => queue.enqueue(directInput('Cannot enqueue', 'closing-relay', directory)),
      /terminal is closing/,
    );
    assert.throws(
      () => queue.enqueue(turboInput('Cannot plan', 'planner', 'closing-relay', directory)),
      /terminal is closing/,
    );

    const failed = database.createTask(directInput('Cannot retry', 'closing-relay', directory));
    database.updateTask(failed.id, { status: 'failed' });
    assert.throws(() => queue.retry(failed.id), /terminal is closing/);

    const queued = database.createTask(directInput('Cannot assign', 'safe-relay', directory));
    assert.throws(
      () => queue.assign(queued.id, thread('closing-relay', directory)),
      /terminal is closing/,
    );
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('automatic tasks without a preselected thread launch through the pool and release it after outcome', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-automatic-queue-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  const artifacts = new ArtifactStore(join(directory, 'tasks'));
  database.addProject({ path: directory, name: 'Automatic queue' });
  const lifecycle = [];
  const terminalPool = {
    canRun: () => true,
    projectStatus: () => ({
      limits: { codex: 1, claude: 1 },
      active: { codex: 0, claude: 0 },
    }),
    async prepare(task) {
      lifecycle.push(`prepare:${task.id}`);
      const updated = database.updateTask(task.id, {
        thread_id: 'automatic-codex-thread',
        thread_name: 'Automatic Codex',
        thread_source: 'test',
      });
      artifacts.updateTaskAssignment(updated);
      return updated;
    },
    async release(taskId) {
      lifecycle.push(`release:${taskId}`);
    },
  };
  const runner = {
    async run(task) {
      lifecycle.push(`run:${task.thread_id}`);
      return { sessionId: task.thread_id, finalResponse: 'done', exitCode: 0 };
    },
    cancel() {
      return false;
    },
  };
  const queue = new TaskQueue({ database, artifacts, runner, terminalPool });
  try {
    const task = queue.enqueue({
      title: 'Automatic task',
      prompt: 'Run without a selected CC Relay',
      repoPath: directory,
      provider: 'codex',
      mode: 'execute',
      terminalLifecycle: 'disposable',
    });
    await waitFor(() => database.getTask(task.id).status === 'complete');
    assert.deepEqual(lifecycle, [
      `prepare:${task.id}`,
      'run:automatic-codex-thread',
      `release:${task.id}`,
    ]);
    assert.equal(database.getTask(task.id).thread_id, 'automatic-codex-thread');
  } finally {
    await queue.shutdown();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a background-termination failure never completes or enters automatic retry', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-background-termination-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  const artifacts = new ArtifactStore(join(directory, 'tasks'));
  database.addProject({ path: directory, name: 'Background termination' });
  const lifecycle = [];
  let attempts = 0;
  const terminalPool = {
    canRun: () => true,
    projectStatus: () => ({
      limits: { codex: 1, claude: 1 },
      active: { codex: 0, claude: 0 },
    }),
    async prepare(task) {
      lifecycle.push(`prepare:${task.id}`);
      return database.updateTask(task.id, {
        thread_id: 'claude-background-termination',
        thread_name: 'Claude background termination',
        thread_source: 'test',
      });
    },
    async release(taskId) {
      lifecycle.push(`release:${taskId}`);
    },
  };
  const guidance = 'Claude ended this run while 4 pending background agents still working. Review the workspace, then use Continue session with a follow-up telling Claude what to audit and finish.';
  const runner = {
    async run() {
      attempts += 1;
      const error = new Error(guidance);
      error.retryable = false;
      error.exitCode = 0;
      throw error;
    },
    cancel() {
      return false;
    },
  };
  const queue = new TaskQueue({
    database,
    artifacts,
    runner,
    terminalPool,
    retryDelayMs: 10,
  });
  try {
    const task = queue.enqueue({
      title: 'Do not replay partial work',
      prompt: 'Implement everything',
      repoPath: directory,
      provider: 'claude',
      mode: 'execute',
      terminalLifecycle: 'disposable',
    });
    await waitFor(() => database.getTask(task.id).status === 'failed');
    await new Promise((resolve) => setTimeout(resolve, 30));

    const stored = database.getTask(task.id);
    const events = database.listEvents(task.id);
    assert.equal(stored.status, 'failed');
    assert.equal(stored.error, guidance);
    assert.equal(attempts, 1);
    assert.equal(queue.pendingRetryTaskIds().has(task.id), false);
    assert.deepEqual(lifecycle, [`prepare:${task.id}`, `release:${task.id}`]);
    assert.equal(events.some((event) => event.message === 'Task completed.'), false);
    assert.equal(events.some((event) => /Retrying automatically/.test(event.message)), false);
    assert.match(events.at(-1).message, /needs attention/i);
    assert.match(stored.error, /Continue session/);
  } finally {
    await queue.shutdown();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('automatic tasks retain their prepared terminal when the task opted in', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-retained-queue-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  const artifacts = new ArtifactStore(join(directory, 'tasks'));
  database.addProject({ path: directory, name: 'Retained queue' });
  const lifecycle = [];
  const terminalPool = {
    canRun: () => true,
    projectStatus: () => ({
      limits: { codex: 1, claude: 1 },
      active: { codex: 0, claude: 0 },
    }),
    async prepare(task) {
      lifecycle.push(`prepare:${task.id}`);
      return database.updateTask(task.id, {
        thread_id: 'retained-codex-thread',
        thread_name: 'Retained Codex',
        thread_source: 'test',
      });
    },
    async retain(taskId) {
      lifecycle.push(`retain:${taskId}`);
    },
    async release(taskId) {
      lifecycle.push(`release:${taskId}`);
    },
  };
  const runner = {
    async run(task) {
      lifecycle.push(`run:${task.thread_id}`);
      return { sessionId: task.thread_id, finalResponse: 'done', exitCode: 0 };
    },
    cancel() {
      return false;
    },
  };
  const queue = new TaskQueue({ database, artifacts, runner, terminalPool });
  try {
    const task = queue.enqueue({
      title: 'Retained automatic task',
      prompt: 'Keep this terminal',
      repoPath: directory,
      provider: 'codex',
      mode: 'execute',
      terminalLifecycle: 'disposable',
      keepTerminalOpen: true,
    });
    await waitFor(() => database.getTask(task.id).status === 'complete');
    assert.deepEqual(lifecycle, [
      `prepare:${task.id}`,
      'run:retained-codex-thread',
      `retain:${task.id}`,
    ]);
    assert.equal(database.getTask(task.id).keep_terminal_open, true);
  } finally {
    await queue.shutdown();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('manual terminal sessions stay open across turns and complete only on explicit finish', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-manual-session-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  const artifacts = new ArtifactStore(join(directory, 'tasks'));
  database.addProject({ path: directory, name: 'Manual sessions' });
  const lifecycle = [];
  const prompts = [];
  let responseNumber = 0;
  const terminalPool = {
    canRun: () => true,
    projectStatus: () => ({
      limits: { codex: 1, claude: 1 },
      active: { codex: 0, claude: 0 },
    }),
    async prepare(task) {
      lifecycle.push(`prepare:${task.id}`);
      return database.updateTask(task.id, {
        thread_id: 'manual-session-thread',
        thread_name: 'Manual session terminal',
        thread_source: 'test',
      });
    },
    async retain(taskId) {
      lifecycle.push(`retain:${taskId}`);
    },
    async release(taskId) {
      lifecycle.push(`release:${taskId}`);
    },
  };
  const runner = {
    async run(task) {
      prompts.push(task.prompt);
      responseNumber += 1;
      return {
        sessionId: task.thread_id,
        finalResponse: `response ${responseNumber}`,
        exitCode: 0,
      };
    },
    cancel() {
      return false;
    },
  };
  const queue = new TaskQueue({ database, artifacts, runner, terminalPool });
  try {
    const task = queue.enqueue({
      title: 'Persistent terminal workspace',
      prompt: 'First command',
      repoPath: directory,
      provider: 'codex',
      mode: 'execute',
      terminalLifecycle: 'disposable',
      keepTerminalOpen: true,
      manualCompletion: true,
    });
    await waitFor(() => database.getTask(task.id).status === 'open');
    const firstStartedAt = database.getTask(task.id).started_at;
    assert.equal(database.getTask(task.id).manual_completion, true);
    assert.equal(database.getTask(task.id).finished_at, null);
    assert.deepEqual(lifecycle, [`prepare:${task.id}`, `retain:${task.id}`]);

    for (const prompt of ['Second command', 'Third command']) {
      const source = database.getTask(task.id);
      const started = queue.startFollowUp({ ...source, prompt, attachments: [] });
      assert.equal(started.status, 'running');
      await waitFor(() => database.getTask(task.id).status === 'open');
    }

    const open = database.getTask(task.id);
    assert.equal(open.started_at, firstStartedAt, 'follow-up turns preserve the session start time');
    assert.equal(open.finished_at, null);
    assert.equal(open.result, 'response 3');
    assert.deepEqual(prompts, ['First command', 'Second command', 'Third command']);
    assert.equal(database.listTaskPrompts(task.id).length, 3);
    assert.deepEqual(lifecycle, [`prepare:${task.id}`, `retain:${task.id}`]);

    const completed = queue.completeSession(task.id);
    assert.equal(completed.status, 'complete');
    assert.ok(completed.finished_at);
    assert.deepEqual(lifecycle, [`prepare:${task.id}`, `retain:${task.id}`], 'manual completion does not close the retained terminal');
    assert.throws(() => queue.completeSession(task.id), /current session turn/);
    assert.throws(
      () => queue.startFollowUp({ ...completed, prompt: 'Too late', attachments: [] }),
      /complete and cannot accept more messages/,
    );
    assert.match(database.listEvents(task.id).at(-1).message, /completed manually/i);
  } finally {
    await queue.shutdown();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a failed manual session turn returns to open without an automatic retry', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-manual-session-failure-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  const artifacts = new ArtifactStore(join(directory, 'tasks'));
  database.addProject({ path: directory, name: 'Manual session failure' });
  const lifecycle = [];
  let attempts = 0;
  const terminalPool = {
    canRun: () => true,
    projectStatus: () => ({
      limits: { codex: 1, claude: 1 },
      active: { codex: 0, claude: 0 },
    }),
    async prepare(task) {
      lifecycle.push(`prepare:${task.id}`);
      return database.updateTask(task.id, {
        thread_id: 'failed-manual-session',
        thread_name: 'Failed manual session',
        thread_source: 'test',
      });
    },
    async retain(taskId) {
      lifecycle.push(`retain:${taskId}`);
    },
    async release(taskId) {
      lifecycle.push(`release:${taskId}`);
    },
  };
  const runner = {
    async run() {
      attempts += 1;
      throw new Error('command failed');
    },
    cancel() {
      return false;
    },
  };
  const queue = new TaskQueue({
    database,
    artifacts,
    runner,
    terminalPool,
    retryDelayMs: 5,
    maxAutomaticRetries: 3,
  });
  try {
    const task = queue.enqueue({
      title: 'Correct the next command',
      prompt: 'Fail once',
      repoPath: directory,
      provider: 'codex',
      mode: 'execute',
      terminalLifecycle: 'disposable',
      keepTerminalOpen: true,
      manualCompletion: true,
    });
    await waitFor(() => database.getTask(task.id).status === 'open');
    await new Promise((resolve) => setTimeout(resolve, 20));

    const open = database.getTask(task.id);
    assert.equal(open.finished_at, null);
    assert.equal(attempts, 1);
    assert.match(open.error, /command failed/);
    assert.deepEqual(lifecycle, [`prepare:${task.id}`, `retain:${task.id}`]);
    assert.match(database.listEvents(task.id).at(-1).message, /session remains open/i);
  } finally {
    await queue.shutdown();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a running automatic task can latch terminal retention before its final outcome', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-live-retention-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  const artifacts = new ArtifactStore(join(directory, 'tasks'));
  database.addProject({ path: directory, name: 'Live retention' });
  const lifecycle = [];
  let finishRun = null;
  let announceRun;
  const runStarted = new Promise((resolve) => { announceRun = resolve; });
  const terminalPool = {
    canRun: () => true,
    projectStatus: () => ({
      limits: { codex: 1, claude: 1 },
      active: { codex: 0, claude: 0 },
    }),
    async prepare(task) {
      lifecycle.push(`prepare:${task.id}`);
      return database.updateTask(task.id, {
        thread_id: 'live-retention-thread',
        thread_name: 'Live retention terminal',
        thread_source: 'test',
      });
    },
    async retain(taskId) {
      lifecycle.push(`retain:${taskId}`);
    },
    async release(taskId) {
      lifecycle.push(`release:${taskId}`);
    },
  };
  const finalOutcome = {
    sessionId: 'live-retention-thread',
    finalResponse: 'done',
    exitCode: 0,
  };
  const runner = {
    run() {
      announceRun();
      return new Promise((resolve) => { finishRun = resolve; });
    },
    cancel() {
      finishRun?.(finalOutcome);
      return true;
    },
  };
  const queue = new TaskQueue({ database, artifacts, runner, terminalPool });
  try {
    const task = queue.enqueue({
      title: 'Protect this live terminal',
      prompt: 'Keep working until released',
      repoPath: directory,
      provider: 'codex',
      mode: 'execute',
      terminalLifecycle: 'disposable',
    });
    await runStarted;
    assert.equal(database.getTask(task.id).keep_terminal_open, false);

    const protectedTask = queue.keepTerminalOpen(task.id);
    assert.equal(protectedTask.keep_terminal_open, true);
    assert.equal(queue.keepTerminalOpen(task.id).keep_terminal_open, true, 'the latch is idempotent');
    assert.equal(
      database.listEvents(task.id).filter((event) => event.message.startsWith('Automatic close stopped.')).length,
      1,
    );

    finishRun(finalOutcome);
    await waitFor(() => database.getTask(task.id).status === 'complete' && lifecycle.includes(`retain:${task.id}`));
    assert.deepEqual(lifecycle, [
      `prepare:${task.id}`,
      `retain:${task.id}`,
    ]);
    assert.equal(database.getTask(task.id).keep_terminal_open, true);
    assert.throws(() => queue.keepTerminalOpen(task.id), /Only a running task/);
  } finally {
    finishRun?.(finalOutcome);
    await queue.shutdown();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a live retention latch promotes the prepared terminal before queue shutdown cancels the run', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-live-retention-shutdown-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  const artifacts = new ArtifactStore(join(directory, 'tasks'));
  database.addProject({ path: directory, name: 'Live retention shutdown' });
  const lifecycle = [];
  let rejectRun = null;
  let announceRun;
  let retained = false;
  const runStarted = new Promise((resolve) => { announceRun = resolve; });
  const terminalPool = {
    canRun: () => true,
    projectStatus: () => ({
      limits: { codex: 1, claude: 1 },
      active: { codex: 0, claude: 0 },
    }),
    async prepare(task) {
      lifecycle.push(`prepare:${task.id}`);
      return database.updateTask(task.id, {
        thread_id: 'live-retention-shutdown-thread',
        thread_name: 'Live retention shutdown terminal',
        thread_source: 'test',
      });
    },
    async retain(taskId) {
      if (retained) return;
      retained = true;
      lifecycle.push(`retain:${taskId}`);
    },
    async release(taskId) {
      lifecycle.push(`release:${taskId}`);
    },
  };
  const runner = {
    run() {
      announceRun();
      return new Promise((resolve, reject) => { rejectRun = reject; });
    },
    cancel(taskId) {
      lifecycle.push(`cancel:${taskId}`);
      rejectRun?.(Object.assign(new Error('shutdown'), { cancelled: true }));
      return true;
    },
  };
  const queue = new TaskQueue({ database, artifacts, runner, terminalPool });
  try {
    const task = queue.enqueue({
      title: 'Protect before shutdown',
      prompt: 'Keep this terminal through shutdown',
      repoPath: directory,
      provider: 'codex',
      mode: 'execute',
      terminalLifecycle: 'disposable',
    });
    await runStarted;
    queue.keepTerminalOpen(task.id);
    await queue.shutdown();

    assert.deepEqual(lifecycle, [
      `prepare:${task.id}`,
      `retain:${task.id}`,
      `cancel:${task.id}`,
    ]);
    assert.equal(database.getTask(task.id).status, 'interrupted');
    assert.equal(database.getTask(task.id).keep_terminal_open, true);
  } finally {
    await queue.shutdown();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('retained tasks close retry attempts and retain only the final failed session', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-retained-retry-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  const artifacts = new ArtifactStore(join(directory, 'tasks'));
  database.addProject({ path: directory, name: 'Retained retries' });
  const lifecycle = [];
  let attempt = 0;
  const terminalPool = {
    canRun: () => true,
    projectStatus: () => ({
      limits: { codex: 1, claude: 1 },
      active: { codex: 0, claude: 0 },
    }),
    async prepare(task) {
      attempt += 1;
      lifecycle.push(`prepare:${attempt}`);
      return database.updateTask(task.id, {
        thread_id: `retained-retry-thread-${attempt}`,
        thread_name: `Retained retry ${attempt}`,
        thread_source: 'test',
      });
    },
    async retain() {
      lifecycle.push(`retain:${attempt}`);
    },
    async release() {
      lifecycle.push(`release:${attempt}`);
    },
  };
  const runner = {
    async run() {
      lifecycle.push(`run:${attempt}`);
      throw new Error(`attempt ${attempt} failed`);
    },
    cancel() {
      return false;
    },
  };
  const queue = new TaskQueue({
    database,
    artifacts,
    runner,
    terminalPool,
    retryDelayMs: 5,
    maxAutomaticRetries: 1,
  });
  try {
    const task = queue.enqueue({
      title: 'Retained retry task',
      prompt: 'Fail twice',
      repoPath: directory,
      provider: 'codex',
      mode: 'execute',
      terminalLifecycle: 'disposable',
      keepTerminalOpen: true,
    });
    await waitFor(() => lifecycle.includes('retain:2'));
    assert.equal(database.getTask(task.id).status, 'failed');
    assert.deepEqual(lifecycle, [
      'prepare:1',
      'run:1',
      'release:1',
      'prepare:2',
      'run:2',
      'retain:2',
    ]);
  } finally {
    await queue.shutdown();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a manual retry can reuse an idle retained direct terminal without preparing a new one', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-retained-live-retry-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  const artifacts = new ArtifactStore(join(directory, 'tasks'));
  const calls = [];
  const terminalPool = {
    canRun: () => true,
    projectStatus: () => ({
      limits: { codex: 1, claude: 1 },
      active: { codex: 0, claude: 0 },
    }),
    async prepare() {
      calls.push('prepare');
      throw new Error('should not prepare');
    },
  };
  const runner = {
    async run(task) {
      calls.push(`run:${task.thread_id}`);
      return { sessionId: task.thread_id, finalResponse: 'recovered', exitCode: 0 };
    },
    cancel() {
      return false;
    },
  };
  const queue = new TaskQueue({ database, artifacts, runner, terminalPool });
  try {
    const task = database.createTask({
      title: 'Retry retained terminal',
      prompt: 'Try again',
      repoPath: directory,
      thread: {
        id: 'retained-live-thread',
        title: 'Retained live terminal',
        source: 'test',
        cwd: directory,
      },
      provider: 'codex',
      mode: 'execute',
      terminalLifecycle: 'disposable',
      keepTerminalOpen: true,
    });
    artifacts.initializeTask(task);
    database.updateTask(task.id, { status: 'failed', error: 'first attempt failed' });

    const retrying = queue.retry(task.id, { reuseRetainedTerminal: true });
    assert.equal(retrying.status, 'running');
    await waitFor(() => database.getTask(task.id).status === 'complete');
    assert.deepEqual(calls, ['run:retained-live-thread']);
  } finally {
    await queue.shutdown();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a saved disposable conversation can have only one queued or running continuation', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-automatic-conversation-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  const artifacts = new ArtifactStore(join(directory, 'tasks'));
  database.setPaused(true);
  const terminalPool = {
    canRun: () => true,
    projectStatus: () => ({
      limits: { codex: 4, claude: 4 },
      active: { codex: 0, claude: 0 },
    }),
  };
  const queue = new TaskQueue({
    database,
    artifacts,
    terminalPool,
    runner: { run: async () => ({ finalResponse: 'done', exitCode: 0 }), cancel: () => false },
  });
  const input = {
    title: 'Continue conversation',
    prompt: 'Continue',
    repoPath: directory,
    thread: { ...thread('saved-conversation', directory), provider: 'codex' },
    provider: 'codex',
    mode: 'execute',
    terminalLifecycle: 'disposable',
  };
  try {
    const first = queue.enqueue(input);
    assert.throws(
      () => queue.enqueue({ ...input, title: 'Duplicate continuation', prompt: 'Also continue' }),
      /conversation already has queued or running work/,
    );

    const legacyDuplicate = database.createTask({
      ...input,
      title: 'Persisted duplicate',
      prompt: 'Recovered duplicate',
    });
    database.setPaused(false);
    assert.deepEqual(
      queue.runnableTasks().map((task) => task.id),
      [first.id],
      'the scheduler serializes duplicate resume rows already present in the database',
    );
    database.setPaused(true);

    database.updateTask(legacyDuplicate.id, { status: 'failed', error: 'retry me' });
    assert.throws(
      () => queue.retry(legacyDuplicate.id),
      /conversation already has queued or running work/,
    );
  } finally {
    await queue.shutdown();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
