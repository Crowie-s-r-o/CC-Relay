import assert from 'node:assert/strict';
import test from 'node:test';
import {
  continuationPresentation,
  continuationSubmission,
} from '../public/task-continuation-state.js';

const sourceTask = {
  id: 42,
  mode: 'execute',
  provider: 'codex',
  thread_id: 'relay-one',
  model: 'gpt-test',
  effort: 'xhigh',
  status: 'complete',
};

test('continuation drafts stay editable while their session is offline', () => {
  assert.deepEqual(continuationPresentation({
    supportsDirectFollowUp: true,
    sessionConnected: false,
    busy: false,
    submitting: false,
    prompt: 'Continue here',
  }), {
    state: 'offline',
    label: 'Session offline',
    buttonLabel: 'Send now',
    hint: 'Write your follow-up now. Reconnect the original terminal session before sending.',
    inputDisabled: false,
    sendDisabled: true,
  });
});

test('an older backend never falls back to creating a queue task', () => {
  const presentation = continuationPresentation({
    supportsDirectFollowUp: false,
    sessionConnected: true,
    busy: false,
    submitting: false,
    prompt: 'Continue here',
  });
  assert.equal(presentation.inputDisabled, false);
  assert.equal(presentation.sendDisabled, true);
  assert.equal(presentation.state, 'unavailable');
  assert.match(presentation.hint, /never fall back to the task queue/);
  assert.throws(() => continuationSubmission(sourceTask, 'Continue here', {
    supportsDirectFollowUp: false,
  }), /not queued/);
});

test('a busy terminal disables submission instead of promising queued delivery', () => {
  const presentation = continuationPresentation({
    supportsDirectFollowUp: true,
    sessionConnected: true,
    busy: true,
    taskRunning: false,
    submitting: false,
    prompt: 'Continue here',
  });
  assert.equal(presentation.state, 'unavailable');
  assert.equal(presentation.label, 'Terminal busy');
  assert.equal(presentation.inputDisabled, false);
  assert.equal(presentation.sendDisabled, true);
  assert.match(presentation.hint, /never queued/);
});

test('an idle finished task starts a direct next turn and disables editing only while sending', () => {
  assert.deepEqual(continuationSubmission(sourceTask, 'Continue here', {
    supportsDirectFollowUp: true,
  }), {
    path: '/api/tasks/42/follow-up',
    body: { prompt: 'Continue here' },
  });
  const sending = continuationPresentation({
    supportsDirectFollowUp: true,
    sessionConnected: true,
    busy: false,
    submitting: true,
    prompt: 'Continue here',
  });
  assert.equal(sending.inputDisabled, true);
  assert.equal(sending.sendDisabled, true);
});

test('follow-up images are included only when the backend advertises support', () => {
  const attachments = [{ name: 'screen.png', mimeType: 'image/png', data: 'data:image/png;base64,abc' }];
  assert.deepEqual(continuationSubmission(sourceTask, 'Inspect this screenshot', {
    supportsDirectFollowUp: true,
    supportsFollowUpAttachments: true,
    attachments,
  }), {
    path: '/api/tasks/42/follow-up',
    body: { prompt: 'Inspect this screenshot', attachments },
  });
  assert.throws(() => continuationSubmission(sourceTask, 'Inspect this screenshot', {
    supportsDirectFollowUp: true,
    supportsFollowUpAttachments: false,
    attachments,
  }), /Restart Relay to add images/);
});

test('a running Codex task steers its active turn without creating a queued task', () => {
  const runningTask = { ...sourceTask, status: 'running' };
  assert.deepEqual(continuationPresentation({
    supportsDirectFollowUp: true,
    supportsTaskSteering: true,
    sessionConnected: true,
    busy: true,
    taskRunning: true,
    provider: 'codex',
    submitting: false,
    prompt: 'Correct the current work',
  }), {
    state: 'steering',
    label: 'Updates current',
    buttonLabel: 'Update turn',
    hint: 'This message updates the active turn now. It will not create a queued task.',
    inputDisabled: false,
    sendDisabled: false,
  });
  assert.deepEqual(continuationSubmission(runningTask, 'Correct the current work', {
    supportsDirectFollowUp: true,
    supportsTaskSteering: true,
  }), {
    path: '/api/tasks/42/steer',
    body: { prompt: 'Correct the current work' },
  });
});

test('running Codex steering carries follow-up images in the same request', () => {
  const attachments = [{ name: 'screen.webp', mimeType: 'image/webp', data: 'data:image/webp;base64,abc' }];
  assert.deepEqual(continuationSubmission({ ...sourceTask, status: 'running' }, 'Use this image', {
    supportsDirectFollowUp: true,
    supportsFollowUpAttachments: true,
    supportsTaskSteering: true,
    attachments,
  }), {
    path: '/api/tasks/42/steer',
    body: { prompt: 'Use this image', attachments },
  });
});

test('running tasks never fall back to queueing when live updates are unavailable', () => {
  const presentation = continuationPresentation({
    supportsDirectFollowUp: true,
    supportsTaskSteering: false,
    sessionConnected: true,
    busy: true,
    taskRunning: true,
    provider: 'claude',
    submitting: false,
    prompt: 'Correct the current work',
  });
  assert.equal(presentation.state, 'unavailable');
  assert.equal(presentation.inputDisabled, false);
  assert.equal(presentation.sendDisabled, true);
  assert.match(presentation.hint, /Wait for this turn to finish/);
  assert.throws(() => continuationSubmission({
    ...sourceTask,
    provider: 'claude',
    status: 'running',
  }, 'Correct the current work', {
    supportsDirectFollowUp: true,
    supportsTaskSteering: false,
  }), /cannot accept live updates/);
});

test('continuation submission rejects empty or non-direct task state', () => {
  assert.throws(() => continuationSubmission(sourceTask, '   '), /Write a follow-up/);
  assert.throws(() => continuationSubmission({ ...sourceTask, mode: 'turbo' }, 'Continue'), /Only direct/);
  assert.throws(() => continuationSubmission({ ...sourceTask, thread_id: '' }, 'Continue'), /session is unavailable/);
});
