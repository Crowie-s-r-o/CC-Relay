const DIRECT_PROVIDERS = new Set(['codex', 'claude']);

/**
 * Task-scoped follow-up image drafts with cancellable asynchronous merges.
 *
 * FileReader completes later than the click or paste that started it. A plain Map lets that
 * delayed completion restore images after Clear images has removed them. Serializing merges
 * also prevents two quick image selections from overwriting one another.
 */
export class ContinuationAttachmentDrafts {
  constructor() {
    this.values = new Map();
    this.generations = new Map();
    this.pendingMerges = new Map();
  }

  get(taskId) {
    return this.values.get(taskId);
  }

  set(taskId, attachments) {
    this.invalidate(taskId);
    this.values.set(taskId, attachments);
    return this;
  }

  delete(taskId) {
    const deleted = this.values.delete(taskId);
    this.invalidate(taskId);
    return deleted;
  }

  invalidate(taskId) {
    this.generations.set(taskId, this.generation(taskId) + 1);
  }

  generation(taskId) {
    return this.generations.get(taskId) || 0;
  }

  async merge(taskId, mergeAttachments) {
    const generation = this.generation(taskId);
    const previous = this.pendingMerges.get(taskId) || Promise.resolve();
    const pending = previous.catch(() => {}).then(async () => {
      if (this.generation(taskId) !== generation) {
        return { committed: false, result: null };
      }
      const result = await mergeAttachments(this.get(taskId) || []);
      if (this.generation(taskId) !== generation) {
        return { committed: false, result };
      }
      this.values.set(taskId, result.attachments);
      return { committed: true, result };
    });
    this.pendingMerges.set(taskId, pending);
    try {
      return await pending;
    } finally {
      if (this.pendingMerges.get(taskId) === pending) {
        this.pendingMerges.delete(taskId);
      }
    }
  }
}

export function continuationPresentation({
  supportsDirectFollowUp,
  supportsTaskSteering,
  supportsClaudeTaskSteering,
  supportsClaudeSteerOutbox = false,
  sessionConnected,
  resumableSession = false,
  busy,
  taskRunning,
  provider,
  submitting,
  pendingCount = 0,
  prompt,
}) {
  const hasPrompt = Boolean(String(prompt || '').trim());
  const steeringAvailable = taskRunning && (
    provider === 'codex'
      ? supportsTaskSteering
      : provider === 'claude' && supportsClaudeTaskSteering
  );
  const reliableClaudeSteering = steeringAvailable
    && provider === 'claude'
    && supportsClaudeSteerOutbox;
  if (reliableClaudeSteering) {
    const waiting = Math.max(0, Number(pendingCount) || 0);
    return {
      state: waiting > 0 ? 'sending' : 'steering',
      label: waiting > 0 ? `${waiting} sending` : 'Updates current',
      buttonLabel: 'Update turn',
      hint: waiting > 0
        ? `${waiting} update${waiting === 1 ? '' : 's'} being delivered. Keep typing and send the next one whenever it is ready.`
        : 'Updates are delivered in order. If Claude has a stable native draft, Relay sends it first instead of blocking this composer.',
      inputDisabled: false,
      sendDisabled: !hasPrompt,
    };
  }
  if (submitting) {
    return {
      state: 'sending',
      label: 'Sending now',
      buttonLabel: taskRunning ? 'Updating' : 'Starting',
      hint: taskRunning
        ? 'Updating the active turn now.'
        : 'Starting the next turn in this exact session now.',
      inputDisabled: true,
      sendDisabled: true,
    };
  }
  if (steeringAvailable) {
    return {
      state: 'steering',
      label: 'Updates current',
      buttonLabel: 'Update turn',
      hint: 'This message updates the active turn now. It will not create a queued task.',
      inputDisabled: false,
      sendDisabled: !hasPrompt,
    };
  }
  if (!sessionConnected && !resumableSession) {
    return {
      state: 'offline',
      label: 'Session offline',
      buttonLabel: taskRunning ? 'Update turn' : 'Send now',
      hint: 'Write your follow-up now. Reconnect the original terminal session before sending.',
      inputDisabled: false,
      sendDisabled: true,
    };
  }
  if (taskRunning) {
    return {
      state: 'unavailable',
      label: 'Live update unavailable',
      buttonLabel: 'Update turn',
      hint: provider === 'claude'
        ? 'Live updates are unavailable for this Claude turn. Restart CC Relay after updating the backend.'
        : 'Restart CC Relay to enable live updates for this running Codex turn.',
      inputDisabled: false,
      sendDisabled: true,
    };
  }
  if (!supportsDirectFollowUp) {
    return {
      state: 'unavailable',
      label: 'Restart required',
      buttonLabel: 'Send now',
      hint: 'Restart CC Relay to enable immediate same-session follow-ups. This message will never fall back to the task queue.',
      inputDisabled: false,
      sendDisabled: true,
    };
  }
  if (busy) {
    if (resumableSession) {
      return {
        state: 'unavailable',
        label: 'Conversation busy',
        buttonLabel: 'Resume session',
        hint: 'This conversation already has queued or running work. Continue after that task ends.',
        inputDisabled: false,
        sendDisabled: true,
      };
    }
    return {
      state: 'unavailable',
      label: 'Terminal busy',
      buttonLabel: 'Send now',
      hint: 'Finish or cancel the work using this terminal, then send again. Follow-ups are never queued.',
      inputDisabled: false,
      sendDisabled: true,
    };
  }
  if (resumableSession) {
    return {
      state: 'ready',
      label: 'Resume available',
      buttonLabel: 'Resume session',
      hint: 'CC Relay will relaunch this saved conversation in the current task. No new task will be created.',
      inputDisabled: false,
      sendDisabled: !hasPrompt,
    };
  }
  return {
    state: 'ready',
    label: 'Sends now',
    buttonLabel: 'Send now',
    hint: 'Enter starts the next turn in this exact session immediately. Shift+Enter adds a new line. No task is created.',
    inputDisabled: false,
    sendDisabled: !hasPrompt,
  };
}

const UNCONFIRMED_DRAFT = 'delivered-unconfirmed';

/**
 * A draft CC Relay handed to a provider terminal without confirming it.
 *
 * It stays in the per-task draft map so the words survive, and it is marked so rehydration
 * can tell it apart from text the user still means to send. The distinction is the whole
 * point: an unconfirmed message must never flow back into the textarea, because that is
 * exactly the resurrection the composer clear exists to prevent.
 */
export function unconfirmedDraft(text) {
  return { kind: UNCONFIRMED_DRAFT, text: typeof text === 'string' ? text : '' };
}

export function isUnconfirmedDraft(entry) {
  return Boolean(entry) && typeof entry === 'object' && entry.kind === UNCONFIRMED_DRAFT;
}

/** What the textarea shows for a stored draft. An unconfirmed one contributes nothing. */
export function draftInputValue(entry) {
  if (isUnconfirmedDraft(entry)) return '';
  return typeof entry === 'string' ? entry : '';
}

/** Select the oldest failed send only when it cannot replace newer task-scoped work. */
export function continuationRetryRestore({
  draft = '',
  attachments = [],
  waiting = [],
} = {}) {
  const retries = Array.isArray(waiting) ? waiting : [];
  if (
    draftInputValue(draft).trim()
    || (Array.isArray(attachments) && attachments.length > 0)
    || retries.length === 0
  ) {
    return { entry: null, waiting: [...retries] };
  }
  return {
    entry: retries[0],
    waiting: retries.slice(1),
  };
}

/** The retained words, or an empty string when there is nothing held for recovery. */
export function unconfirmedDraftText(entry) {
  return isUnconfirmedDraft(entry) ? entry.text : '';
}

function promptExcerpt(text, limit = 72) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (value.length <= limit) return value;
  return `${value.slice(0, limit - 3).trimEnd()}...`;
}

/**
 * The composer outcome for one submitted follow-up.
 *
 * Delivery has three states, not two. A live update that CC Relay typed into the provider
 * terminal but could not confirm is NOT a failure the user should retype. The executor
 * deliberately refuses to send that message again, so leaving the text in the composer
 * invites exactly the duplicate turn the no-queue contract exists to prevent. Uncertain
 * delivery therefore clears the composer like a confirmed send and says plainly what
 * happened.
 *
 * It still returns the text. One uncertain branch fires when injection itself throws, which
 * can mean nothing was typed at all, so the words cannot only live in a terminal CC Relay
 * failed to reach. They are retained out of the textarea and shown in the notice instead.
 *
 * Only a failure that provably delivered nothing keeps the draft for a retry.
 */
export function continuationDispatchOutcome({
  ok = false,
  steered = false,
  followUpStarted = false,
  resumedDisposableSession = false,
  deliveryUncertain = false,
  message = '',
  prompt = '',
} = {}) {
  if (ok && steered) {
    return {
      delivered: true,
      clearComposer: true,
      retainText: false,
      text: '',
      refresh: true,
      kind: 'success',
      message: 'Update delivered to the active turn.',
      detail: 'Update delivered to the active turn.',
    };
  }
  if (ok && followUpStarted) {
    const notice = resumedDisposableSession
      ? 'Follow-up started in this task. CC Relay resumed its saved session and created no new task.'
      : 'Follow-up started in this same terminal session. No queue task was created.';
    return {
      delivered: true,
      clearComposer: true,
      retainText: false,
      text: '',
      refresh: true,
      kind: 'success',
      message: notice,
      detail: notice,
    };
  }
  if (ok) {
    const notice = 'CC Relay did not confirm a direct same-session follow-up. Your message was not queued.';
    return {
      delivered: false,
      clearComposer: false,
      retainText: false,
      text: '',
      refresh: false,
      kind: 'error',
      message: notice,
      detail: notice,
    };
  }
  if (deliveryUncertain) {
    const lead = 'Typed into the terminal, delivery unconfirmed. CC Relay did not send it again.';
    const excerpt = promptExcerpt(prompt);
    const account = message || 'CC Relay typed this update into the terminal but could not confirm delivery. It was not sent again.';
    return {
      delivered: false,
      clearComposer: true,
      // Held out of the textarea, not thrown away.
      retainText: true,
      text: typeof prompt === 'string' ? prompt : '',
      refresh: true,
      kind: 'warning',
      /*
       * The status line is one truncated row, so the lead carries the whole meaning, the
       * excerpt puts the user's own words where the notice appears, and the title keeps the
       * provider's exact account beside the complete message.
       */
      message: excerpt ? `${lead} Your text: ${excerpt}` : lead,
      detail: excerpt ? `${account}\n\nYour message:\n${prompt}` : account,
    };
  }
  const notice = message || 'CC Relay could not send this follow-up.';
  return {
    delivered: false,
    clearComposer: false,
    retainText: false,
    text: '',
    refresh: false,
    kind: 'error',
    message: notice,
    detail: notice,
  };
}

export function continuationSubmission(task, prompt, {
  supportsDirectFollowUp,
  supportsFollowUpAttachments,
  supportsTaskSteering,
  supportsClaudeTaskSteering,
  supportsClaudeSteerOutbox = false,
  attachments = [],
} = {}) {
  const value = typeof prompt === 'string' ? prompt.trim() : '';
  if (!value) throw new Error('Write a follow-up before sending it.');
  if (attachments.length > 0 && !supportsFollowUpAttachments) {
    throw new Error('Restart CC Relay to add images to follow-up messages. Your message was not sent.');
  }
  if (task?.mode !== 'execute' || !DIRECT_PROVIDERS.has(task?.provider)) {
    throw new Error('Only direct Codex or Claude tasks can continue in one terminal session.');
  }
  if (typeof task.thread_id !== 'string' || !task.thread_id.trim()) {
    throw new Error('The original terminal session is unavailable.');
  }
  if (task.status === 'running') {
    const steeringAvailable = task.provider === 'codex'
      ? supportsTaskSteering
      : task.provider === 'claude' && supportsClaudeTaskSteering;
    if (!steeringAvailable) {
      throw new Error('This running turn cannot accept live updates.');
    }
    return {
      path: `/api/tasks/${task.id}/steer`,
      body: {
        prompt: value,
        ...(attachments.length > 0 ? { attachments } : {}),
        ...(task.provider === 'claude' && supportsClaudeSteerOutbox
          ? { flushComposer: true }
          : {}),
      },
    };
  }
  if (!supportsDirectFollowUp) {
    throw new Error('Restart CC Relay to enable immediate same-session follow-ups. Your message was not queued.');
  }
  return {
    path: `/api/tasks/${task.id}/follow-up`,
    body: { prompt: value, ...(attachments.length > 0 ? { attachments } : {}) },
  };
}
