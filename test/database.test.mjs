import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { RelayDatabase } from '../src/database.mjs';
import { withRelayNonInteractiveInstruction } from '../src/relay-prompt.mjs';

test('database persists tasks in queue order and records events', () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-db-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  try {
    const first = database.createTask({
      title: 'First',
      prompt: 'One',
      thread: { id: 'thread-one', title: 'First session', source: 'cli', cwd: '/repo/one' },
      provider: 'codex',
      model: 'gpt-test',
      effort: 'high',
    });
    const second = database.createTask({
      title: 'Second',
      prompt: 'Two',
      thread: { id: 'thread-two', title: 'Second session', source: 'vscode', cwd: '/repo/two' },
      provider: 'council',
      mode: 'plan',
      council: {
        authorProvider: 'claude',
        authorThread: {
          id: 'claude-author',
          title: 'Claude author terminal',
          source: 'Claude interactive',
          cwd: '/repo/two',
        },
        authorModel: 'opus',
        authorEffort: 'max',
        reviewerProvider: 'codex',
        reviewerModel: 'gpt-test',
        reviewerEffort: 'high',
      },
      continuedFromTaskId: first.id,
    });

    assert.equal(database.nextQueuedTask().id, first.id);
    assert.deepEqual(database.listTasks().map((task) => task.id), [first.id, second.id]);
    assert.equal(database.listEvents(first.id)[0].message, 'Task added to the queue.');
    assert.equal(first.thread_id, 'thread-one');
    assert.equal(first.thread_name, 'First session');
    assert.equal(first.provider, 'codex');
    assert.equal(first.model, 'gpt-test');
    assert.equal(first.effort, 'high');
    assert.equal(second.mode, 'plan');
    assert.equal(second.author_provider, 'claude');
    assert.equal(second.author_thread_id, 'claude-author');
    assert.equal(second.author_thread_name, 'Claude author terminal');
    assert.equal(second.author_thread_source, 'Claude interactive');
    assert.equal(second.author_model, 'opus');
    assert.equal(second.author_effort, 'max');
    assert.equal(second.reviewer_provider, 'codex');
    assert.equal(second.reviewer_model, 'gpt-test');
    assert.equal(second.reviewer_effort, 'high');
    assert.equal(second.continued_from_task_id, first.id);
    assert.equal(database.latestTaskForThread('claude-author').thread_id, 'claude-author');
    assert.equal(database.latestTaskForThread('claude-author').thread_name, 'Claude author terminal');

    database.updateTask(first.id, { status: 'complete', result: 'Done' });
    assert.equal(database.getTask(first.id).result, 'Done');
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('database persists one unique submission ID per task', () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-submission-id-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  const submissionId = 'd9428888-122b-4c26-bc3f-61c1c6ab3710';
  try {
    const first = database.createTask({
      title: 'Only once',
      prompt: 'Create this once',
      thread: { id: 'thread-once', title: 'Once', source: 'cli', cwd: '/repo' },
      submissionId,
    });

    assert.equal(database.getTaskBySubmissionId(submissionId).id, first.id);
    assert.equal(Object.hasOwn(first, 'submission_id'), false);
    assert.throws(() => database.createTask({
      title: 'Duplicate',
      prompt: 'Create this twice',
      thread: { id: 'thread-twice', title: 'Twice', source: 'cli', cwd: '/repo' },
      submissionId,
    }), /UNIQUE constraint failed/);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('database returns every prompt even when the console event window is full', () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-prompt-history-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  try {
    const task = database.createTask({
      title: 'Prompt history',
      prompt: 'Original request',
      thread: { id: 'prompt-history', title: 'Prompt history', source: 'cli', cwd: '/repo' },
    });
    database.addEvent(task.id, 'codex', 'First follow-up', {
      type: 'item/completed',
      item: {
        id: `relay-follow-up-${task.id}-1`,
        type: 'userMessage',
        content: [{ type: 'text', text: 'First follow-up' }],
      },
    });
    const steeredItem = {
      id: 'provider-prompt-2',
      clientId: `relay-steer-${task.id}-1`,
      type: 'userMessage',
      content: [{
        type: 'text',
        text: withRelayNonInteractiveInstruction('Second follow-up'),
      }],
    };
    database.addEvent(task.id, 'codex', 'Second follow-up started', {
      type: 'item/started',
      item: steeredItem,
    });
    database.addEvent(task.id, 'codex', 'Second follow-up completed', {
      type: 'item/completed',
      item: steeredItem,
    });
    for (let index = 0; index < 510; index += 1) {
      database.addEvent(task.id, 'codex', `Noise ${index}`);
    }

    assert.equal(database.listEvents(task.id).length, 500);
    assert.deepEqual(
      database.listTaskPrompts(task.id).map(({ kind, text }) => ({ kind, text })),
      [
        { kind: 'original', text: 'Original request' },
        { kind: 'follow-up', text: 'First follow-up' },
        { kind: 'follow-up', text: 'Second follow-up' },
      ],
    );
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('database returns recorded assistant responses with the latest result as a fallback', () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-response-history-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  try {
    const task = database.createTask({
      title: 'Response history',
      prompt: 'Original request',
      thread: { id: 'response-history', title: 'Response history', source: 'cli', cwd: '/repo' },
    });
    database.addEvent(task.id, 'result', 'First response', {
      type: 'item/completed',
      item: {
        id: 'agent-one',
        type: 'agentMessage',
        text: 'First response',
      },
    });
    database.addEvent(task.id, 'result', 'Duplicate response', {
      type: 'item/completed',
      item: {
        id: 'agent-two',
        type: 'agent_message',
        text: 'First response',
      },
    });
    database.addEvent(task.id, 'claude', 'Second response', {
      type: 'claude/message',
      text: 'Second response',
    });
    database.addEvent(task.id, 'opencode', 'Third response', {
      type: 'opencode/message',
      text: 'Third response',
    });
    database.updateTask(task.id, {
      status: 'complete',
      result: 'Latest result without a matching event',
      finished_at: '2026-07-29T12:00:00.000Z',
    });

    assert.deepEqual(
      database.listTaskResponses(task.id).map(({ text }) => text),
      [
        'First response',
        'Second response',
        'Third response',
        'Latest result without a matching event',
      ],
    );
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('database does not repeat the stored result when a recorded response already carries it', () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-response-dedupe-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  try {
    const task = database.createTask({
      title: 'Session turns',
      prompt: 'First turn',
      thread: { id: 'response-dedupe', title: 'Session turns', source: 'cli', cwd: '/repo' },
    });
    database.addEvent(task.id, 'result', 'First turn answer', {
      type: 'item/completed',
      item: { id: 'agent-one', type: 'agentMessage', text: 'First turn answer' },
    });
    database.addEvent(task.id, 'claude', 'Second turn answer', {
      type: 'claude/message',
      text: 'Second turn answer',
    });
    database.updateTask(task.id, {
      status: 'complete',
      result: 'Second turn answer',
      finished_at: '2026-07-29T12:00:00.000Z',
    });

    assert.deepEqual(
      database.listTaskResponses(task.id).map(({ text }) => text),
      ['First turn answer', 'Second turn answer'],
    );
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('database edits only tasks that are still queued', () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-db-edit-queued-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  try {
    const queued = database.createTask({
      title: 'Original',
      prompt: 'Original prompt',
      thread: { id: 'queued-edit', title: 'Queued edit', source: 'cli', cwd: '/repo' },
    });
    const edited = database.updateQueuedTask(queued.id, {
      title: 'Updated',
      prompt: 'Updated prompt',
      provider: 'claude',
      model: 'sonnet',
      effort: 'high',
      thread_id: null,
      thread_name: null,
      thread_source: null,
    });
    assert.equal(edited.title, 'Updated');
    assert.equal(edited.prompt, 'Updated prompt');
    assert.equal(edited.provider, 'claude');
    assert.equal(edited.model, 'sonnet');
    assert.equal(edited.effort, 'high');
    assert.equal(edited.thread_id, null);

    database.updateTask(queued.id, { status: 'running' });
    assert.throws(
      () => database.updateQueuedTask(queued.id, { prompt: 'Too late', provider: 'codex' }),
      /still waiting in the queue/,
    );
    assert.equal(database.getTask(queued.id).prompt, 'Updated prompt');
    assert.equal(database.getTask(queued.id).provider, 'claude');
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('database applies retry settings only to retryable task outcomes', () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-db-retry-settings-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  try {
    const task = database.createTask({
      title: 'Retry with Claude',
      prompt: 'Try the other executor',
      thread: { id: 'old-codex-thread', title: 'Old Codex', source: 'cli', cwd: '/repo' },
      provider: 'codex',
      model: 'gpt-test',
      effort: 'high',
      terminalLifecycle: 'disposable',
    });
    database.updateTask(task.id, { status: 'failed', error: 'Provider failed.' });
    const retried = database.updateRetryableTask(task.id, {
      status: 'queued',
      provider: 'claude',
      model: 'sonnet',
      effort: 'max',
      thread_id: null,
      thread_name: null,
      thread_source: null,
      session_id: null,
      error: null,
    });
    assert.equal(retried.status, 'queued');
    assert.equal(retried.provider, 'claude');
    assert.equal(retried.model, 'sonnet');
    assert.equal(retried.effort, 'max');
    assert.equal(retried.thread_id, null);

    assert.throws(
      () => database.updateRetryableTask(task.id, { effort: 'low' }),
      /Only failed, cancelled, or interrupted tasks/,
    );
    assert.equal(database.getTask(task.id).effort, 'max');
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('database marks active tasks interrupted after restart', () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-recovery-'));
  const filePath = join(directory, 'relay.sqlite');
  const database = new RelayDatabase(filePath);
  const task = database.createTask({
    title: 'Running',
    prompt: 'Work',
    thread: { id: 'thread-running', title: 'Running session', source: 'cli', cwd: '/repo' },
  });
  database.updateTask(task.id, { status: 'running' });
  database.close();

  const reopened = new RelayDatabase(filePath);
  try {
    assert.equal(reopened.recoverInterruptedTasks(), 1);
    assert.equal(reopened.getTask(task.id).status, 'interrupted');
  } finally {
    reopened.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('database recovery keeps a manually completed terminal session open after an interrupted turn', () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-manual-session-recovery-'));
  const filePath = join(directory, 'relay.sqlite');
  const database = new RelayDatabase(filePath);
  const task = database.createTask({
    title: 'Persistent terminal workspace',
    prompt: 'Long running command',
    repoPath: '/repo',
    provider: 'codex',
    mode: 'execute',
    terminalLifecycle: 'disposable',
    keepTerminalOpen: true,
    manualCompletion: true,
  });
  database.updateTask(task.id, { status: 'running', started_at: '2026-08-04T10:00:00.000Z' });
  database.close();

  const reopened = new RelayDatabase(filePath);
  try {
    assert.equal(reopened.recoverInterruptedTasks(), 1);
    const recovered = reopened.getTask(task.id);
    assert.equal(recovered.status, 'open');
    assert.equal(recovered.manual_completion, true);
    assert.equal(recovered.finished_at, null);
    assert.match(recovered.error, /stopped while this task was running/i);
    assert.match(reopened.listEvents(task.id).at(-1).message, /session remains open/i);
  } finally {
    reopened.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('database recovery preserves the no-queue marker for an interrupted same-session follow-up', () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-follow-up-recovery-'));
  const filePath = join(directory, 'relay.sqlite');
  const database = new RelayDatabase(filePath);
  const task = database.createTask({
    title: 'Existing task',
    prompt: 'Original prompt',
    thread: { id: 'thread-follow-up', title: 'Follow-up session', source: 'cli', cwd: '/repo' },
  });
  database.updateTask(task.id, { status: 'running' });
  database.addEvent(task.id, 'queue', 'Follow-up started immediately in the same terminal session.');
  database.close();

  const reopened = new RelayDatabase(filePath);
  try {
    assert.equal(reopened.recoverInterruptedTasks(), 1);
    assert.equal(reopened.getTask(task.id).status, 'interrupted');
    assert.match(reopened.getTask(task.id).error, /^Same-session follow-up interrupted:/);
    assert.match(reopened.listEvents(task.id).at(-1).message, /not queued/i);
  } finally {
    reopened.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('database reorders only the complete queued task set', () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-reorder-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  try {
    const first = database.createTask({
      title: 'First',
      prompt: 'One',
      thread: { id: 'one', title: 'One', source: 'cli', cwd: '/repo' },
    });
    const second = database.createTask({
      title: 'Second',
      prompt: 'Two',
      thread: { id: 'two', title: 'Two', source: 'cli', cwd: '/repo' },
    });
    const third = database.createTask({
      title: 'Third',
      prompt: 'Three',
      thread: { id: 'three', title: 'Three', source: 'cli', cwd: '/repo' },
    });

    database.reorderQueuedTasks([third.id, first.id, second.id], [first.id, second.id, third.id]);
    assert.deepEqual(database.listTasks().map((task) => task.id), [third.id, first.id, second.id]);
    assert.equal(database.nextQueuedTask().id, third.id);
    assert.match(database.listEvents(third.id).at(-1).message, /queue position 1/);
    assert.throws(
      () => database.reorderQueuedTasks([first.id, second.id]),
      /queue changed/,
    );
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('each project has independent queue positions and reorder validation', () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-project-queues-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  try {
    const alphaFirst = database.createTask({ title: 'Alpha first', prompt: 'One', thread: { id: 'a1', title: 'A1', source: 'cli', cwd: '/repo/alpha' } });
    const betaFirst = database.createTask({ title: 'Beta first', prompt: 'Two', thread: { id: 'b1', title: 'B1', source: 'cli', cwd: '/repo/beta' } });
    const alphaSecond = database.createTask({ title: 'Alpha second', prompt: 'Three', thread: { id: 'a2', title: 'A2', source: 'cli', cwd: '/repo/alpha' } });
    const betaSecond = database.createTask({ title: 'Beta second', prompt: 'Four', thread: { id: 'b2', title: 'B2', source: 'cli', cwd: '/repo/beta' } });

    assert.deepEqual([alphaFirst.position, betaFirst.position, alphaSecond.position, betaSecond.position], [1, 1, 2, 2]);
    database.reorderQueuedTasks(
      [alphaSecond.id, alphaFirst.id],
      [alphaFirst.id, alphaSecond.id],
      '/repo/alpha',
    );

    const alpha = database.listTasks().filter((task) => task.repo_path === '/repo/alpha');
    const beta = database.listTasks().filter((task) => task.repo_path === '/repo/beta');
    assert.deepEqual(alpha.map((task) => task.id), [alphaSecond.id, alphaFirst.id]);
    assert.deepEqual(beta.map((task) => task.id), [betaFirst.id, betaSecond.id]);
    assert.throws(
      () => database.reorderQueuedTasks([betaFirst.id, betaSecond.id], [betaFirst.id, betaSecond.id], '/repo/alpha'),
      /queue changed/i,
    );
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('database rejects stale reorder snapshots without changing positions', () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-reorder-stale-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  try {
    const first = database.createTask({ title: 'First', prompt: 'One', thread: { id: 'one', title: 'One', source: 'cli', cwd: '/repo' } });
    const second = database.createTask({ title: 'Second', prompt: 'Two', thread: { id: 'two', title: 'Two', source: 'cli', cwd: '/repo' } });
    const third = database.createTask({ title: 'Third', prompt: 'Three', thread: { id: 'three', title: 'Three', source: 'cli', cwd: '/repo' } });
    const expected = [first.id, second.id, third.id];

    database.reorderQueuedTasks([third.id, first.id, second.id], expected);
    const committed = database.listTasks().filter((task) => task.status === 'queued');
    const positionsBefore = new Map(committed.map((task) => [task.id, task.position]));

    assert.throws(
      () => database.reorderQueuedTasks([first.id, second.id, third.id], expected),
      /queue changed/i,
    );
    const positionsAfter = new Map(
      database.listTasks().filter((task) => task.status === 'queued').map((task) => [task.id, task.position]),
    );
    assert.deepEqual(positionsAfter, positionsBefore);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('database rejects a task leaving the queue and invalid permutations atomically', () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-reorder-invalid-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  try {
    const first = database.createTask({ title: 'First', prompt: 'One', thread: { id: 'one', title: 'One', source: 'cli', cwd: '/repo' } });
    const second = database.createTask({ title: 'Second', prompt: 'Two', thread: { id: 'two', title: 'Two', source: 'cli', cwd: '/repo' } });
    const third = database.createTask({ title: 'Third', prompt: 'Three', thread: { id: 'three', title: 'Three', source: 'cli', cwd: '/repo' } });
    const expected = [first.id, second.id, third.id];

    database.updateTask(second.id, { status: 'complete', result: 'Done' });
    assert.throws(
      () => database.reorderQueuedTasks([third.id, first.id], expected),
      /queue changed/i,
    );
    assert.deepEqual(
      database.listTasks().filter((task) => task.status === 'queued').map((task) => task.id),
      [first.id, third.id],
    );

    const positionsBefore = database.listTasks().filter((task) => task.status === 'queued')
      .map((task) => [task.id, task.position]);
    assert.throws(
      () => database.reorderQueuedTasks([first.id, first.id], [first.id, third.id]),
      /duplicate/i,
    );
    assert.throws(
      () => database.reorderQueuedTasks([first.id, 999999], [first.id, third.id]),
      /queue changed/i,
    );
    assert.deepEqual(
      database.listTasks().filter((task) => task.status === 'queued').map((task) => [task.id, task.position]),
      positionsBefore,
    );
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('database lists finished tasks newest first without disturbing queue order', () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-task-order-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  try {
    const oldest = database.createTask({
      title: 'Oldest finished',
      prompt: 'One',
      thread: { id: 'one', title: 'One', source: 'cli', cwd: '/repo' },
    });
    const queuedFirst = database.createTask({
      title: 'First queued',
      prompt: 'Two',
      thread: { id: 'two', title: 'Two', source: 'cli', cwd: '/repo' },
    });
    const newest = database.createTask({
      title: 'Newest finished',
      prompt: 'Three',
      thread: { id: 'three', title: 'Three', source: 'cli', cwd: '/repo' },
    });
    const queuedSecond = database.createTask({
      title: 'Second queued',
      prompt: 'Four',
      thread: { id: 'four', title: 'Four', source: 'cli', cwd: '/repo' },
    });

    database.updateTask(oldest.id, { status: 'complete', result: 'Done' });
    database.updateTask(newest.id, { status: 'failed', error: 'Failed' });

    assert.deepEqual(
      database.listTasks().map((task) => task.id),
      [queuedFirst.id, queuedSecond.id, newest.id, oldest.id],
    );
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('ordinary submissions append after queued work even when history has a larger position', () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-append-position-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  try {
    const waiting = database.createTask({
      title: 'Waiting',
      prompt: 'First',
      thread: { id: 'waiting', title: 'Waiting', source: 'cli', cwd: '/repo' },
    });
    const finished = database.createTask({
      title: 'Finished',
      prompt: 'Historical',
      thread: { id: 'finished', title: 'Finished', source: 'cli', cwd: '/repo' },
    });
    database.updateTask(finished.id, { status: 'complete', position: 40, result: 'Done' });

    const appended = database.createTask({
      title: 'Appended',
      prompt: 'Last',
      thread: { id: 'appended', title: 'Appended', source: 'cli', cwd: '/repo' },
    });
    assert.equal(appended.position, 41);
    assert.equal(database.nextQueuedTask().id, waiting.id);

    const priority = database.createTask({
      title: 'Priority',
      prompt: 'Now',
      thread: { id: 'priority', title: 'Priority', source: 'cli', cwd: '/repo' },
      priority: true,
    });
    assert.equal(priority.position, waiting.position - 1);
    assert.equal(database.nextQueuedTask().id, priority.id);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('database persists, deduplicates, launches, and removes pinned projects', () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-projects-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  try {
    const first = database.addProject({ path: '/repo/one', name: 'one' });
    const duplicate = database.addProject({ path: '/repo/one', name: 'renamed' });
    const second = database.addProject({ path: '/repo/two', name: 'two' });
    assert.equal(duplicate.id, first.id);
    assert.equal(first.max_codex_instances, 1);
    assert.equal(first.max_claude_instances, 1);
    assert.equal(first.max_opencode_instances, 1);
    assert.equal(first.keep_terminal_open, false);
    assert.equal(first.prefer_idle_terminal, false);
    assert.equal(first.terminal_layout, null);
    assert.equal(first.color, null);
    assert.equal(first.standup_custom_prompt, '');
    assert.equal(database.updateProjectColor(first.id, '#f04fc3').color, '#f04fc3');
    assert.equal(database.updateProjectColor(first.id, null).color, null);
    const prompted = database.updateProjectStandupCustomPrompt(
      first.id,
      'Focus on customer-visible changes.',
    );
    assert.equal(prompted.standup_custom_prompt, 'Focus on customer-visible changes.');
    assert.equal(database.getProject(second.id).standup_custom_prompt, '');
    const resized = database.updateProjectInstanceLimits(first.id, {
      codex: 4,
      claude: 2,
      opencode: 3,
    });
    assert.equal(resized.max_codex_instances, 4);
    assert.equal(resized.max_claude_instances, 2);
    assert.equal(resized.max_opencode_instances, 3);
    const configured = database.updateProjectTerminalSettings(first.id, {
      keepTerminalOpen: false,
      preferIdleTerminal: true,
      terminalLayout: {
        enabled: true,
        columns: 2,
        rows: 4,
        display: 1,
        background: false,
      },
    });
    assert.equal(configured.keep_terminal_open, false);
    assert.equal(configured.prefer_idle_terminal, true);
    assert.deepEqual(configured.terminal_layout, {
      enabled: true,
      columns: 2,
      rows: 4,
      display: 1,
      background: false,
    });
    assert.equal(database.getProject(second.id).keep_terminal_open, false);
    assert.equal(database.getProject(second.id).prefer_idle_terminal, false);
    assert.equal(database.getProject(second.id).terminal_layout, null);
    const sharedLayout = {
      enabled: false,
      columns: 4,
      rows: 2,
      display: 0,
      background: true,
    };
    const updatedProjects = database.updateAllProjectTerminalLayouts(sharedLayout);
    assert.deepEqual(updatedProjects.map((project) => project.terminal_layout), [sharedLayout, sharedLayout]);
    assert.equal(database.getProject(first.id).prefer_idle_terminal, true);
    assert.equal(database.getProject(second.id).keep_terminal_open, false);
    assert.equal(database.getProjectByPath('/repo/one').id, first.id);
    assert.deepEqual(database.listProjects().map((project) => project.id), [first.id, second.id]);
    assert.ok(database.markProjectLaunched(first.id).last_launched_at);
    assert.equal(database.deleteProject(first.id), true);
    assert.deepEqual(database.listProjects().map((project) => project.id), [second.id]);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('project pause state is isolated by workspace path', () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-project-pause-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  try {
    database.setProjectPaused('/repo/alpha', true);
    assert.equal(database.isProjectPaused('/repo/alpha'), true);
    assert.equal(database.isProjectPaused('/repo/beta'), false);
    assert.deepEqual(database.pausedProjectPaths(), ['/repo/alpha']);

    database.setProjectPaused('/repo/alpha', false);
    database.setProjectPaused('/repo/beta', true);
    assert.equal(database.isProjectPaused('/repo/alpha'), false);
    assert.equal(database.isProjectPaused('/repo/beta'), true);
    assert.deepEqual(database.pausedProjectPaths(), ['/repo/beta']);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
