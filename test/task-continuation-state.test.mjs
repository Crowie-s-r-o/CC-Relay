import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  continuationDispatchOutcome,
  continuationPresentation,
  continuationRetryRestore,
  continuationSubmission,
  draftInputValue,
  unconfirmedDraft,
  unconfirmedDraftText,
} from '../public/task-continuation-state.js';

const composerApp = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const server = readFileSync(new URL('../src/server.mjs', import.meta.url), 'utf8');

/** The draft-map branch submitTaskContinuation runs, modelled once for every test below. */
function applyDispatch(drafts, taskId, outcome) {
  if (!outcome.clearComposer) return drafts;
  if (outcome.retainText) drafts.set(taskId, unconfirmedDraft(outcome.text));
  else drafts.delete(taskId);
  return drafts;
}

/**
 * The composer as the dispatch path leaves it: the visible textarea, the raw per-task draft,
 * and what a later task-switch render would put back. `rehydrated` is the one that reproduces
 * the original bug if it ever carries text the user already sent.
 */
function composerAfterDispatch(outcome, { taskId = 42, text = 'Also update the README.' } = {}) {
  const drafts = applyDispatch(new Map([[taskId, text]]), taskId, outcome);
  const stored = drafts.get(taskId) ?? null;
  return {
    stored,
    input: outcome.clearComposer ? '' : text,
    rehydrated: draftInputValue(stored),
  };
}

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

test('a finished disposable task can resume inside the same task while its terminal is closed', () => {
  assert.deepEqual(continuationPresentation({
    supportsDirectFollowUp: true,
    sessionConnected: false,
    resumableSession: true,
    busy: false,
    taskRunning: false,
    provider: 'claude',
    submitting: false,
    prompt: 'Continue here',
  }), {
    state: 'ready',
    label: 'Resume available',
    buttonLabel: 'Resume session',
    hint: 'CC Relay will relaunch this saved conversation in the current task. No new task will be created.',
    inputDisabled: false,
    sendDisabled: false,
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
  }), /Restart CC Relay to add images/);
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

test('a running Claude task sends a live update through the same no-queue route', () => {
  const runningTask = {
    ...sourceTask,
    provider: 'claude',
    status: 'running',
  };
  assert.deepEqual(continuationPresentation({
    supportsDirectFollowUp: true,
    supportsTaskSteering: true,
    supportsClaudeTaskSteering: true,
    sessionConnected: true,
    busy: true,
    taskRunning: true,
    provider: 'claude',
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
    supportsClaudeTaskSteering: true,
  }), {
    path: '/api/tasks/42/steer',
    body: { prompt: 'Correct the current work' },
  });
});

test('the Claude live outbox never locks the composer behind an earlier send', () => {
  const runningTask = {
    ...sourceTask,
    provider: 'claude',
    status: 'running',
  };
  const presentation = continuationPresentation({
    supportsDirectFollowUp: true,
    supportsClaudeTaskSteering: true,
    supportsClaudeSteerOutbox: true,
    sessionConnected: true,
    busy: true,
    taskRunning: true,
    provider: 'claude',
    submitting: true,
    pendingCount: 2,
    prompt: 'Send another update now',
  });

  assert.deepEqual(presentation, {
    state: 'sending',
    label: '2 sending',
    buttonLabel: 'Update turn',
    hint: '2 updates being delivered. Keep typing and send the next one whenever it is ready.',
    inputDisabled: false,
    sendDisabled: false,
  });
  assert.deepEqual(continuationSubmission(runningTask, 'Send another update now', {
    supportsClaudeTaskSteering: true,
    supportsClaudeSteerOutbox: true,
  }), {
    path: '/api/tasks/42/steer',
    body: {
      prompt: 'Send another update now',
      flushComposer: true,
    },
  });
});

test('the reliable Claude outbox stays capability gated for mixed versions', () => {
  const runningTask = {
    ...sourceTask,
    provider: 'claude',
    status: 'running',
  };
  assert.deepEqual(continuationSubmission(runningTask, 'Use the legacy safe path', {
    supportsClaudeTaskSteering: true,
    supportsClaudeSteerOutbox: false,
  }), {
    path: '/api/tasks/42/steer',
    body: { prompt: 'Use the legacy safe path' },
  });
});

test('failed outbox sends restore in order without replacing newer task work', () => {
  const first = { prompt: 'First failed update', attachments: [] };
  const second = { prompt: 'Second failed update', attachments: [{ name: 'proof.png' }] };

  assert.deepEqual(continuationRetryRestore({
    draft: 'Newer text still being edited',
    waiting: [first, second],
  }), {
    entry: null,
    waiting: [first, second],
  });
  assert.deepEqual(continuationRetryRestore({
    attachments: [{ name: 'newer.png' }],
    waiting: [first, second],
  }), {
    entry: null,
    waiting: [first, second],
  });
  assert.deepEqual(continuationRetryRestore({
    draft: '',
    attachments: [],
    waiting: [first, second],
  }), {
    entry: first,
    waiting: [second],
  });
});

test('a running Claude task remains steerable during a transient session-list miss', () => {
  assert.equal(continuationPresentation({
    supportsDirectFollowUp: true,
    supportsClaudeTaskSteering: true,
    sessionConnected: false,
    busy: true,
    taskRunning: true,
    provider: 'claude',
    submitting: false,
    prompt: 'Keep going with this correction',
  }).state, 'steering');
});

test('an older backend never lets running Claude fall back to queueing', () => {
  const presentation = continuationPresentation({
    supportsDirectFollowUp: true,
    supportsTaskSteering: true,
    supportsClaudeTaskSteering: false,
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
  assert.match(presentation.hint, /Restart CC Relay/);
  assert.throws(() => continuationSubmission({
    ...sourceTask,
    provider: 'claude',
    status: 'running',
  }, 'Correct the current work', {
    supportsDirectFollowUp: true,
    supportsTaskSteering: true,
    supportsClaudeTaskSteering: false,
  }), /cannot accept live updates/);
});

test('continuation submission rejects empty or non-direct task state', () => {
  assert.throws(() => continuationSubmission(sourceTask, '   '), /Write a follow-up/);
  assert.throws(() => continuationSubmission({ ...sourceTask, mode: 'turbo' }, 'Continue'), /Only direct/);
  assert.throws(() => continuationSubmission({ ...sourceTask, thread_id: '' }, 'Continue'), /session is unavailable/);
});

test('a confirmed live update empties the composer and its persisted draft', () => {
  const outcome = continuationDispatchOutcome({ ok: true, steered: true, task: { id: 42 } });

  assert.equal(outcome.delivered, true);
  assert.equal(outcome.clearComposer, true);
  assert.equal(outcome.kind, 'success');
  assert.equal(outcome.message, 'Update delivered to the active turn.');
  // Nothing may survive the two-second refresh and reappear as unsent text.
  assert.deepEqual(composerAfterDispatch(outcome), { stored: null, input: '', rehydrated: '' });
});

test('a started follow-up empties the composer for both fresh and resumed sessions', () => {
  const sameTerminal = continuationDispatchOutcome({ ok: true, followUpStarted: true });
  const resumed = continuationDispatchOutcome({
    ok: true,
    followUpStarted: true,
    resumedDisposableSession: true,
  });

  assert.deepEqual(composerAfterDispatch(sameTerminal), { stored: null, input: '', rehydrated: '' });
  assert.deepEqual(composerAfterDispatch(resumed), { stored: null, input: '', rehydrated: '' });
  assert.match(sameTerminal.message, /No queue task was created/);
  assert.match(resumed.message, /resumed its saved session and created no new task/);
});

/*
 * The reported bug. Claude live updates were rejected with deliveryUncertain after CC Relay
 * had already typed them into the terminal, so the text stayed in the composer and read as a
 * failed send. Retyping it is the one thing that must not happen: the executor refuses to
 * send that message a second time precisely because it may already have landed.
 */
test('an unconfirmed delivery clears the composer instead of inviting a duplicate turn', () => {
  const outcome = continuationDispatchOutcome({
    ok: false,
    deliveryUncertain: true,
    prompt: 'Also update the README.',
    message: 'CC Relay typed the live update into the relay-20 terminal but did not receive exact delivery evidence within 25 seconds. The message may still be queued in Claude, so it was not sent again.',
  });

  assert.equal(outcome.clearComposer, true);
  assert.equal(outcome.kind, 'warning');
  assert.equal(outcome.delivered, false);
  // The single status row is truncated, so the lead carries the meaning by itself.
  assert.match(outcome.message, /delivery unconfirmed/i);
  assert.match(outcome.message, /did not send it again/i);
  assert.match(outcome.detail, /did not receive exact delivery evidence/);
});

/*
 * One uncertain branch fires when injection itself throws, which can mean nothing was typed.
 * The words then exist nowhere the user can reach, so they are retained out of the textarea:
 * recoverable, and still unable to come back as unsent text.
 */
test('an unconfirmed delivery keeps the text recoverable without rehydrating the textarea', () => {
  const outcome = continuationDispatchOutcome({
    ok: false,
    deliveryUncertain: true,
    prompt: 'Also update the README.',
    message: 'CC Relay could not confirm it typed the live update into the relay-20 terminal.',
  });
  const after = composerAfterDispatch(outcome);

  assert.equal(outcome.retainText, true);
  assert.equal(outcome.text, 'Also update the README.');
  assert.equal(after.input, '');
  // The load-bearing assertion: a later task switch must never put these words back.
  assert.equal(after.rehydrated, '');
  assert.equal(unconfirmedDraftText(after.stored), 'Also update the README.');
  // The words are visible where the amber notice appears, in full on the element title.
  assert.match(after.stored.kind, /^delivered-unconfirmed$/);
  assert.match(outcome.message, /Your text: Also update the README\./);
  assert.match(outcome.detail, /Your message:\nAlso update the README\./);
});

test('a long unconfirmed message is excerpted in the row and complete in the title', () => {
  const prompt = `Rewrite the retry backoff so it ${'and stops hammering the provider '.repeat(6)}finally settles.`;
  const outcome = continuationDispatchOutcome({ ok: false, deliveryUncertain: true, prompt });
  const longer = continuationDispatchOutcome({
    ok: false,
    deliveryUncertain: true,
    prompt: `${prompt}${' plus a great deal more.'.repeat(40)}`,
  });

  // The row is one truncated line, so its length must not track the message length at all.
  assert.equal(outcome.message.length, longer.message.length);
  assert.ok(outcome.message.length < prompt.length);
  assert.match(outcome.message, /Your text: Rewrite the retry backoff/);
  assert.match(outcome.message, /\.\.\.$/);
  assert.ok(outcome.detail.includes(prompt), 'the complete message survives on the title');
  assert.equal(outcome.text, prompt);
});

test('an excerpted notice collapses newlines so the status row stays one line', () => {
  const prompt = 'First line.\n\nSecond line.\n\tThird line.';
  const outcome = continuationDispatchOutcome({ ok: false, deliveryUncertain: true, prompt });

  assert.match(outcome.message, /Your text: First line\. Second line\. Third line\.$/);
  assert.equal(outcome.message.includes('\n'), false);
  // The title keeps the real formatting, and the retained copy is byte-exact.
  assert.ok(outcome.detail.includes(prompt));
  assert.equal(outcome.text, prompt);
});

test('a later confirmed send clears the copy an unconfirmed one retained', () => {
  const taskId = 42;
  const drafts = new Map();

  applyDispatch(drafts, taskId, continuationDispatchOutcome({
    ok: false,
    deliveryUncertain: true,
    prompt: 'First attempt.',
  }));
  assert.equal(unconfirmedDraftText(drafts.get(taskId)), 'First attempt.');

  applyDispatch(drafts, taskId, continuationDispatchOutcome({
    ok: true,
    steered: true,
    prompt: 'Second attempt.',
  }));
  assert.equal(drafts.has(taskId), false);
  assert.equal(draftInputValue(drafts.get(taskId)), '');
  assert.equal(unconfirmedDraftText(drafts.get(taskId)), '');
});

test('typing replaces a retained copy with an ordinary editable draft', () => {
  const taskId = 42;
  const drafts = new Map();
  applyDispatch(drafts, taskId, continuationDispatchOutcome({
    ok: false,
    deliveryUncertain: true,
    prompt: 'First attempt.',
  }));

  // What the input listener does: a plain string, which rehydrates normally again.
  drafts.set(taskId, 'A different follow-up.');
  assert.equal(draftInputValue(drafts.get(taskId)), 'A different follow-up.');
  assert.equal(unconfirmedDraftText(drafts.get(taskId)), '');
});

test('a sticky warning never suppresses the next dispatch outcome', () => {
  const dispatchStart = composerApp.indexOf('async function dispatchTaskContinuation');
  const dispatch = composerApp.slice(dispatchStart, composerApp.indexOf('async function deleteTask', dispatchStart));

  // Stickiness guards only the hint write inside the render, never a new outcome.
  assert.match(dispatch, /elements\.continuationMessage\.dataset\.kind = outcome\.kind/);
  assert.doesNotMatch(dispatch, /includes\(elements\.continuationMessage\.dataset\.kind\)/);
  // Typing also drops the notice, so it cannot outlive the user's attention to it.
  assert.match(
    composerApp,
    /continuationInput\.addEventListener\('input'[\s\S]{0,240}?continuationMessage\.dataset\.kind = 'hint'/,
  );
  assert.equal(continuationDispatchOutcome({ ok: true, steered: true }).kind, 'success');
  assert.equal(continuationDispatchOutcome({ ok: false, deliveryUncertain: true }).kind, 'warning');
});

test('a failure that delivered nothing keeps the draft so the user can retry', () => {
  const outcome = continuationDispatchOutcome({
    ok: false,
    deliveryUncertain: false,
    message: 'The Claude composer already contains unsent text. CC Relay did not overwrite or submit it.',
  });

  assert.equal(outcome.clearComposer, false);
  assert.equal(outcome.kind, 'error');
  assert.equal(outcome.refresh, false);
  assert.deepEqual(composerAfterDispatch(outcome), {
    stored: 'Also update the README.',
    input: 'Also update the README.',
    rehydrated: 'Also update the README.',
  });
  assert.equal(outcome.message, 'The Claude composer already contains unsent text. CC Relay did not overwrite or submit it.');
});

test('a response that confirms nothing keeps the draft and never reads as delivered', () => {
  const outcome = continuationDispatchOutcome({ ok: true, task: { id: 42 } });

  assert.equal(outcome.delivered, false);
  assert.equal(outcome.clearComposer, false);
  assert.equal(outcome.kind, 'error');
  assert.match(outcome.message, /did not confirm a direct same-session follow-up/);
  assert.deepEqual(composerAfterDispatch(outcome), {
    stored: 'Also update the README.',
    input: 'Also update the README.',
    rehydrated: 'Also update the README.',
  });
});

test('the continuation dispatch path clears exactly what the outcome decides', () => {
  const dispatchStart = composerApp.indexOf('async function dispatchTaskContinuation');
  const dispatchEnd = composerApp.indexOf('async function deleteTask', dispatchStart);
  const dispatch = composerApp.slice(dispatchStart, dispatchEnd);

  assert.ok(dispatchStart >= 0 && dispatchEnd > dispatchStart);
  // prompt after the spread, so no response field can shadow what the user actually sent.
  assert.match(dispatch, /outcome = continuationDispatchOutcome\(\{ ok: true, \.\.\.body, prompt \}\)/);
  assert.match(dispatch, /state\.continuationDrafts\.set\(sourceTask\.id, unconfirmedDraft\(outcome\.text\)\)/);
  assert.match(composerApp, /elements\.continuationInput\.value = draftInputValue\(state\.continuationDrafts\.get\(task\.id\)\)/);
  assert.match(dispatch, /deliveryUncertain: error\.deliveryUncertain === true/);
  assert.match(dispatch, /if \(outcome\.clearComposer\) \{/);
  assert.match(dispatch, /state\.continuationDrafts\.delete\(sourceTask\.id\)/);
  assert.match(dispatch, /elements\.continuationInput\.value = ''/);
  assert.match(dispatch, /elements\.continuationMessage\.dataset\.kind = outcome\.kind/);
  // The composer must never be emptied for a task the user switched to mid-request.
  assert.match(dispatch, /if \(state\.selectedTaskForEvents\?\.id === sourceTask\.id\) \{\s*elements\.continuationInput\.value = ''/);
});

test('the Claude outbox captures each send without waiting or clearing newer typing', () => {
  const submitStart = composerApp.indexOf('async function submitTaskContinuation');
  const submitEnd = composerApp.indexOf('async function deleteTask', submitStart);
  const submit = composerApp.slice(submitStart, submitEnd);
  const outboxStart = submit.indexOf('if (outbox) {');
  const outboxEnd = submit.indexOf('\n  state.continuationDrafts.set(', outboxStart);
  const outbox = submit.slice(outboxStart, outboxEnd);
  const dispatchStart = composerApp.indexOf('async function dispatchTaskContinuation');
  const dispatchEnd = composerApp.indexOf('\n  state.continuationSubmitting = false;', dispatchStart);
  const outboxOutcome = composerApp.slice(dispatchStart, dispatchEnd);

  assert.ok(outboxStart >= 0 && outboxEnd > outboxStart);
  assert.match(outbox, /state\.continuationDrafts\.delete\(sourceTask\.id\)/);
  assert.match(outbox, /state\.continuationAttachments\.delete\(sourceTask\.id\)/);
  assert.match(outbox, /elements\.continuationInput\.value = ''/);
  assert.match(outbox, /adjustContinuationSteerPending\(sourceTask\.id, 1\)/);
  assert.match(outbox, /const operation = dispatchTaskContinuation\(sourceTask, prompt, request/);
  assert.match(outbox, /operation\.catch\(\(\) => \{\}\)/);
  assert.doesNotMatch(outbox, /await dispatchTaskContinuation/);
  assert.match(outboxOutcome, /adjustContinuationSteerPending\(sourceTask\.id, -1\)/);
  assert.match(outboxOutcome, /retainContinuationRetry\(sourceTask\.id/);
  assert.doesNotMatch(outboxOutcome, /continuationInput\.value = ''/);
  assert.match(composerApp, /const retryRestored = restoreContinuationRetry\(task\.id\)/);
  assert.match(composerApp, /retryRestored\s*\|\| taskChanged/);
});

test('an unconfirmed delivery notice survives the periodic refresh and reaches the client', () => {
  // Without warning in the sticky list the next render replaces the notice with a hint.
  assert.match(composerApp, /\['error', 'success', 'warning'\]\.includes\(elements\.continuationMessage\.dataset\.kind\)/);
  assert.match(composerApp, /if \(body\.deliveryUncertain === true\) failure\.deliveryUncertain = true/);
  assert.match(server, /function sendError\(response, statusCode, message, extra = \{\}\)/);
  assert.match(server, /error\.deliveryUncertain === true \? \{ deliveryUncertain: true \} : \{\}/);
});
