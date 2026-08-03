// Which provider registry owns the primary session a submission names. Plan council keeps
// its Codex terminal in thread_id for both selectable orders; the legacy authorThreadId field
// keeps its Claude terminal. The persisted role fields decide which provider authors.
export function submissionSessionProvider(mode, provider) {
  return mode === 'plan' || mode === 'turbo' || provider === 'codex' ? 'codex' : 'claude';
}

export const SESSION_NEVER_SEEN = {
  claude: 'CC Relay has never seen that Claude Code session. Refresh the session list.',
  codex: 'CC Relay has never seen that terminal on its shared Codex server. Refresh the session list.',
};

// Task add must never wait on a cold provider probe and must never fail because discovery
// happened to be mid-refresh. Resolution order:
//   1. the warm live cache for that provider (no forced subprocess, no N round trips),
//   2. the registry's last known good entry, if the cache lookup itself failed,
//   3. the workspace this exact session used on a previous task.
// Only a session CC Relay has never seen at all is rejected, because then there is genuinely
// nothing to bind the task to. Anything resolved from step 2 or 3 is re-resolved against live
// state at dispatch, and fails there with a task-level message if it really is gone. That is
// the whole point: a transient discovery blip must cost a retry inside a queued task, never
// the user's prompt at submission time.
export async function resolveSubmissionThread(sessionProvider, threadId, {
  findSession,
  knownSession,
  latestTaskForThread,
  onDiscoveryError = () => {},
}) {
  let live = null;
  try {
    live = await findSession(threadId);
  } catch (error) {
    onDiscoveryError(error);
  }
  if (live) return { thread: live, live: true, source: 'live' };

  const known = knownSession(threadId);
  if (known) return { thread: known, live: false, source: 'last-known-good' };

  const previous = latestTaskForThread(threadId);
  if (previous?.repo_path) {
    return {
      thread: {
        id: threadId,
        cwd: previous.repo_path,
        title: previous.thread_name || threadId,
        source: previous.thread_source
          || (sessionProvider === 'claude' ? 'Claude session' : 'Codex terminal'),
        status: 'unknown',
      },
      live: false,
      source: 'task-history',
    };
  }

  return { thread: null, live: false, source: 'unknown' };
}
