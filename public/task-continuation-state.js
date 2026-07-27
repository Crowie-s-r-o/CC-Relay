const DIRECT_PROVIDERS = new Set(['codex', 'claude']);

export function continuationPresentation({
  supportsDirectFollowUp,
  supportsTaskSteering,
  sessionConnected,
  resumableSession = false,
  busy,
  taskRunning,
  provider,
  submitting,
  prompt,
}) {
  const hasPrompt = Boolean(String(prompt || '').trim());
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
    if (provider === 'codex' && supportsTaskSteering) {
      return {
        state: 'steering',
        label: 'Updates current',
        buttonLabel: 'Update turn',
        hint: 'This message updates the active turn now. It will not create a queued task.',
        inputDisabled: false,
        sendDisabled: !hasPrompt,
      };
    }
    return {
      state: 'unavailable',
      label: 'Live update unavailable',
      buttonLabel: 'Update turn',
      hint: provider === 'claude'
        ? 'Claude live turn updates are not available yet. Wait for this turn to finish before continuing.'
        : 'Restart Relay to enable live updates for this running Codex turn.',
      inputDisabled: false,
      sendDisabled: true,
    };
  }
  if (!supportsDirectFollowUp) {
    return {
      state: 'unavailable',
      label: 'Restart required',
      buttonLabel: 'Send now',
      hint: 'Restart Relay to enable immediate same-session follow-ups. This message will never fall back to the task queue.',
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
      hint: 'Relay will queue a linked task, launch a disposable terminal when a slot is free, and resume this conversation.',
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

export function continuationSubmission(task, prompt, {
  supportsDirectFollowUp,
  supportsFollowUpAttachments,
  supportsTaskSteering,
  attachments = [],
} = {}) {
  const value = typeof prompt === 'string' ? prompt.trim() : '';
  if (!value) throw new Error('Write a follow-up before sending it.');
  if (attachments.length > 0 && !supportsFollowUpAttachments) {
    throw new Error('Restart Relay to add images to follow-up messages. Your message was not sent.');
  }
  if (task?.mode !== 'execute' || !DIRECT_PROVIDERS.has(task?.provider)) {
    throw new Error('Only direct Codex or Claude tasks can continue in one terminal session.');
  }
  if (typeof task.thread_id !== 'string' || !task.thread_id.trim()) {
    throw new Error('The original terminal session is unavailable.');
  }
  if (task.status === 'running') {
    if (task.provider !== 'codex' || !supportsTaskSteering) {
      throw new Error('This running turn cannot accept live updates.');
    }
    return {
      path: `/api/tasks/${task.id}/steer`,
      body: { prompt: value, ...(attachments.length > 0 ? { attachments } : {}) },
    };
  }
  if (!supportsDirectFollowUp) {
    throw new Error('Restart Relay to enable immediate same-session follow-ups. Your message was not queued.');
  }
  return {
    path: `/api/tasks/${task.id}/follow-up`,
    body: { prompt: value, ...(attachments.length > 0 ? { attachments } : {}) },
  };
}
