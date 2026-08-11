import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveSubmissionId, submissionIntentSignature } from '../public/submission-intent.js';

const composerApp = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

function composerIntent(overrides = {}) {
  return {
    mode: 'execute',
    councilRequested: false,
    provider: 'codex',
    threadId: 'thread-a',
    title: 'Release readiness',
    prompt: 'ship the reviewed plan',
    execution: { model: 'gpt-5.6-sol', effort: 'high' },
    planSettings: { enabled: false },
    turboSettings: { workerCount: 3 },
    attachments: [],
    ...overrides,
  };
}

/**
 * Model the browser across submit attempts: one pending intent is retained through a
 * failure and cleared on success, exactly as the submit handler does.
 */
function composerSession() {
  let pending = null;
  let minted = 0;
  const sent = [];
  return {
    submit(intent, { fails = false } = {}) {
      const signature = submissionIntentSignature(intent);
      const id = resolveSubmissionId(pending, signature, () => {
        minted += 1;
        return `uuid-${minted}`;
      });
      pending = { id, signature };
      sent.push(id);
      // Success clears the retained intent; an ambiguous failure keeps it.
      if (!fails) pending = null;
      return id;
    },
    // The composer drops the retained intent when a duplicate resolves to a finished task,
    // so the next submission of the same prompt is treated as new work.
    clearPendingIntent() { pending = null; },
    get sent() { return sent; },
    get minted() { return minted; },
  };
}

test('Ctrl+Enter, an ambiguous failure, and a plain Enter retry are one intent', () => {
  const session = composerSession();

  // The user presses Ctrl+Enter (Run now) and the response is lost.
  const first = session.submit(composerIntent(), { fails: true });
  // They press plain Enter to retry the very same prompt.
  const second = session.submit(composerIntent());

  assert.equal(second, first, 'a retry of the same prompt must reuse the submission UUID');
  assert.deepEqual(session.sent, ['uuid-1', 'uuid-1']);
  assert.equal(session.minted, 1, 'exactly one UUID may be minted for one intent');
});

test('runNow is not part of the intent in either direction', () => {
  // Whatever the caller does with runNow, it never reaches the signature, so a Run now
  // attempt and a normal attempt at the same prompt cannot diverge.
  assert.equal(
    submissionIntentSignature(composerIntent({ runNow: true })),
    submissionIntentSignature(composerIntent({ runNow: false })),
  );
  assert.doesNotMatch(submissionIntentSignature(composerIntent()), /runNow/);
  // The same holds for the routing preference, which is likewise not the work being sent.
  assert.equal(
    submissionIntentSignature(composerIntent({ preferIdleTerminal: true })),
    submissionIntentSignature(composerIntent()),
  );
});

test('a genuinely changed intent still receives a new UUID', () => {
  const changes = [
    { title: 'A different task name' },
    { prompt: 'a different prompt' },
    { provider: 'claude' },
    { threadId: 'thread-b' },
    { mode: 'turbo' },
    { councilRequested: true },
    { execution: { model: 'gpt-5.6-sol', effort: 'low' } },
    { planSettings: { enabled: true } },
    { turboSettings: { workerCount: 4 } },
    { keepTerminalOpen: true },
    { attachments: [{ id: 'img-1', name: 'shot.png', mimeType: 'image/png', size: 2048 }] },
  ];

  for (const change of changes) {
    const session = composerSession();
    const first = session.submit(composerIntent(), { fails: true });
    const second = session.submit(composerIntent(change), { fails: true });
    assert.notEqual(second, first, `changing ${Object.keys(change)[0]} must mint a new UUID`);
  }
});

test('two deliberate separate submissions cannot collide', () => {
  const session = composerSession();

  // Success clears the pending intent, so resending the identical prompt on purpose is
  // new work and receives its own UUID.
  const first = session.submit(composerIntent());
  const second = session.submit(composerIntent());

  assert.notEqual(second, first);
  assert.equal(session.minted, 2);
});

test('attachments contribute identity and metadata only, never image data', () => {
  const withData = composerIntent({
    attachments: [{ id: 'img-1', name: 'shot.png', mimeType: 'image/png', size: 2048, data: 'data:image/png;base64,AAAA' }],
  });
  const signature = submissionIntentSignature(withData);

  assert.match(signature, /img-1/);
  assert.match(signature, /shot\.png/);
  assert.doesNotMatch(signature, /base64/);
});

test('a duplicate resolving to a finished task frees the next submission', () => {
  // The reviewer's sequence: a lost response created task N, the user never retried, N ran
  // to completion, and much later the user deliberately resends the identical prompt.
  const session = composerSession();
  const first = session.submit(composerIntent(), { fails: true });

  // The server returns finished task N for the retained UUID. The composer must drop the
  // pending intent so the very next submission is genuinely new work.
  const resolvedToFinishedTask = true;
  if (resolvedToFinishedTask) session.clearPendingIntent();

  const second = session.submit(composerIntent());
  assert.notEqual(second, first, 'a resend after a finished duplicate must mint a new UUID');
  assert.equal(session.minted, 2);
});

test('a duplicate resolving to live work still reuses the intent', () => {
  // A duplicate that is queued or running is the same live task the user asked for, so the
  // intent is cleared by ordinary success rather than by the finished-task branch.
  const session = composerSession();
  const first = session.submit(composerIntent(), { fails: true });
  const second = session.submit(composerIntent());
  assert.equal(second, first);
});

test('the composer delegates submission identity to the shared module', () => {
  assert.match(composerApp, /import \{ resolveSubmissionId, submissionIntentSignature \} from '\.\/submission-intent\.js'/);
  assert.match(composerApp, /const submissionSignature = submissionIntentSignature\(\{/);
  assert.match(
    composerApp,
    /const submissionId = resolveSubmissionId\(\s+state\.pendingSubmission,\s+submissionSignature,\s+\(\) => window\.crypto\.randomUUID\(\),\s+\)/,
  );
  assert.match(composerApp, /state\.pendingSubmission = \{ id: submissionId, signature: submissionSignature \}/);

  // The handler must not smuggle runNow back into the intent.
  const signatureBlock = composerApp.slice(
    composerApp.indexOf('const submissionSignature = submissionIntentSignature'),
    composerApp.indexOf('state.pendingSubmission = { id: submissionId'),
  );
  assert.doesNotMatch(signatureBlock, /runNow/);
  assert.doesNotMatch(signatureBlock, /preferIdleTerminal/);
});
