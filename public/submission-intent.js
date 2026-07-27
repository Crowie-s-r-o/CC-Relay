/**
 * Submission intent identity for the composer.
 *
 * The submission UUID identifies the INTENT: the prompt and the routing that will carry
 * it. It deliberately excludes `runNow`, which is a queue-position hint rather than part
 * of the work being sent.
 *
 * Ctrl+Enter, an ambiguous failure, and a plain Enter retry are the SAME intent and must
 * reuse one UUID. Minting a fresh one there is exactly the duplicate-task hazard the
 * guard exists to prevent: if the first POST actually landed and only its response was
 * lost, a second UUID creates a second row for work the user asked for once.
 *
 * This cannot collide two deliberate separate submissions, because the pending intent is
 * retained only through ambiguous failures and is cleared on success.
 */

function attachmentIdentity(attachments) {
  // Metadata only. Copying up to 20 MB of base64 image data into a signature would make
  // every submission proportional to its attachments.
  return (Array.isArray(attachments) ? attachments : []).map(({
    id = null,
    name = null,
    mimeType = null,
    size = null,
  } = {}) => ({ id, name, mimeType, size }));
}

export function submissionIntentSignature({
  mode = null,
  councilRequested = false,
  provider = null,
  threadId = null,
  prompt = '',
  execution = null,
  planSettings = null,
  turboSettings = null,
  attachments = [],
} = {}) {
  return JSON.stringify({
    mode,
    councilRequested,
    provider,
    threadId,
    prompt,
    execution,
    planSettings,
    turboSettings,
    attachments: attachmentIdentity(attachments),
  });
}

/**
 * Return the UUID for this signature: the retained one when the intent is unchanged since
 * an earlier failed attempt, otherwise a freshly minted one.
 */
export function resolveSubmissionId(pending, signature, mintId) {
  return pending && pending.id && pending.signature === signature
    ? pending.id
    : mintId();
}
