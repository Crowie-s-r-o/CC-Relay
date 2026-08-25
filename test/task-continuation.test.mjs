import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSessionFollowUp, isTurboExecutionSession } from '../src/task-continuation.mjs';

const sourceTask = {
  id: 42,
  mode: 'execute',
  provider: 'codex',
  thread_id: 'relay-one',
  repo_path: '/repo/project',
};
const thread = { id: 'relay-one', title: 'CC Relay 1', source: 'cli', cwd: '/repo/project' };

test('follow-up reuses the source task and exact session without building a queue task', () => {
  const continuation = buildSessionFollowUp({
    sourceTask,
    prompt: '  Check the remaining edge case.  ',
    thread,
    execution: { model: 'sol', effort: 'xhigh' },
  });
  assert.deepEqual(continuation, {
    ...sourceTask,
    prompt: 'Check the remaining edge case.',
    model: 'sol',
    effort: 'xhigh',
    attachments: [],
    sessionFollowUp: true,
  });
  assert.equal(continuation.id, sourceTask.id);
  assert.equal('continuedFromTaskId' in continuation, false);
});

test('continuation keeps logs larger than the fresh-task prompt limit', () => {
  const prompt = `Inspect this log:\n${'log entry\n'.repeat(20_000)}`;
  const continuation = buildSessionFollowUp({
    sourceTask,
    prompt,
    thread,
    execution: { model: 'sol', effort: 'xhigh' },
  });

  assert.ok(prompt.length > 12_000);
  assert.equal(continuation.prompt, prompt.trim());
});

test('continuation rejects multi-provider tasks and mismatched sessions', () => {
  assert.throws(() => buildSessionFollowUp({
    sourceTask,
    prompt: '   ',
    thread,
    execution: {},
  }), /Write a follow-up/);
  assert.throws(() => buildSessionFollowUp({
    sourceTask: { ...sourceTask, mode: 'plan', provider: 'council' },
    prompt: 'Continue',
    thread,
    execution: {},
  }), /Only direct tasks and completed Turbo execution sessions/);
  assert.throws(() => buildSessionFollowUp({
    sourceTask,
    prompt: 'Continue',
    thread: { ...thread, id: 'another-relay' },
    execution: {},
  }), /original terminal session is not connected/i);
  assert.throws(() => buildSessionFollowUp({
    sourceTask,
    prompt: 'Continue',
    thread: { ...thread, cwd: '/repo/other' },
    execution: {},
  }), /different workspace/i);
  assert.throws(() => buildSessionFollowUp({
    sourceTask,
    prompt: 'Continue',
    thread: { ...thread, cwd: undefined },
    execution: {},
  }), /different workspace/i);
});

test('completed Turbo work resumes its single execution session as a direct turn', () => {
  const turboTask = {
    ...sourceTask,
    mode: 'turbo',
    terminal_lifecycle: 'disposable',
    turbo: {
      executionThreadId: 'relay-one',
      workerModel: 'luna',
      workerEffort: 'medium',
    },
  };
  const continuation = buildSessionFollowUp({
    sourceTask: turboTask,
    prompt: 'Recheck the integration.',
    thread,
    execution: { model: 'luna', effort: 'medium' },
  });

  assert.equal(isTurboExecutionSession(turboTask), true);
  assert.equal(continuation.id, turboTask.id);
  assert.equal(continuation.mode, 'execute');
  assert.equal(continuation.provider, 'codex');
  assert.equal(continuation.thread_id, 'relay-one');
  assert.equal(continuation.model, 'luna');
  assert.equal(continuation.effort, 'medium');
  assert.equal(continuation.sessionFollowUp, true);
});

test('continuation accepts a Windows case-variant workspace and still rejects a different one', () => {
  const windowsTask = { ...sourceTask, repo_path: 'C:\\Repo\\Project' };
  const windowsThread = { ...thread, cwd: 'c:\\repo\\project' };

  // The exact shape of the guard this replaces. `claude agents --json` and the Codex app-server
  // report whatever case the shell recorded, so the verbatim comparison rejects the very
  // terminal the task is bound to.
  assert.notEqual(windowsThread.cwd, windowsTask.repo_path);
  const continuation = buildSessionFollowUp({
    sourceTask: windowsTask,
    prompt: 'Continue',
    thread: windowsThread,
    execution: { model: 'sol', effort: 'high' },
    platform: 'win32',
  });
  assert.equal(continuation.sessionFollowUp, true);
  assert.equal(continuation.repo_path, 'C:\\Repo\\Project');

  // Case folding must not turn a genuinely different workspace into a match on Windows.
  assert.throws(() => buildSessionFollowUp({
    sourceTask: windowsTask,
    prompt: 'Continue',
    thread: { ...thread, cwd: 'c:\\repo\\other' },
    execution: {},
    platform: 'win32',
  }), /different workspace/i);
  // A missing cwd stays a workspace mismatch on Windows, not a resolve() TypeError.
  assert.throws(() => buildSessionFollowUp({
    sourceTask: windowsTask,
    prompt: 'Continue',
    thread: { ...thread, cwd: undefined },
    execution: {},
    platform: 'win32',
  }), /different workspace/i);
});

test('continuation keeps the exact posix comparison, where case is significant', () => {
  // Same two paths the win32 case accepts, decided on posix: still a mismatch.
  assert.throws(() => buildSessionFollowUp({
    sourceTask: { ...sourceTask, repo_path: '/repo/Project' },
    prompt: 'Continue',
    thread: { ...thread, cwd: '/repo/project' },
    execution: {},
    platform: 'darwin',
  }), /different workspace/i);
  assert.throws(() => buildSessionFollowUp({
    sourceTask: { ...sourceTask, repo_path: '/repo/project' },
    prompt: 'Continue',
    thread: { ...thread, cwd: '/repo/PROJECT' },
    execution: {},
    platform: 'linux',
  }), /different workspace/i);
  // And an exact posix match is still accepted.
  assert.equal(
    buildSessionFollowUp({
      sourceTask,
      prompt: 'Continue',
      thread,
      execution: { model: 'sol', effort: 'high' },
      platform: 'darwin',
    }).sessionFollowUp,
    true,
  );
});

test('continuation carries only the decoded images for the new turn', () => {
  const attachments = [{
    name: 'follow-up.png',
    mimeType: 'image/png',
    extension: 'png',
    data: Buffer.from('follow-up image'),
  }];
  const continuation = buildSessionFollowUp({
    sourceTask: { ...sourceTask, attachments: [{ id: 'image-1', path: '/old/image.png' }] },
    prompt: 'Inspect the new screenshot.',
    thread,
    execution: { model: 'sol', effort: 'high' },
    attachments,
  });
  assert.equal(continuation.attachments, attachments);
  assert.equal(continuation.attachments.length, 1);
});
