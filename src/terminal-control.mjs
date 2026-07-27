const ACTIVE_TASK_STATUSES = new Set(['queued', 'running', 'retrying']);

export function taskUsesTerminal(task, threadId) {
  if (!task || !threadId || !ACTIVE_TASK_STATUSES.has(task.status)) return false;
  if (task.thread_id === threadId) return true;
  if (task.author_thread_id === threadId) return true;
  const turbo = task.turbo || {};
  if (turbo.plannerThreadId === threadId || turbo.planner?.threadId === threadId) return true;
  return Array.isArray(turbo.workers)
    && turbo.workers.some((worker) => worker?.threadId === threadId);
}

export function blockingTerminalTask(tasks, threadId) {
  const matching = (tasks || []).filter((task) => taskUsesTerminal(task, threadId));
  return matching.find((task) => task.status === 'running') || matching[0] || null;
}

export function terminalControlState(tasks, threadId, ownedTerminal) {
  if (!ownedTerminal) {
    return {
      owned: false,
      canClose: false,
      reason: 'Relay could not map this session to one unambiguous native terminal window.',
    };
  }
  const blocker = blockingTerminalTask(tasks, threadId);
  if (blocker) {
    const reason = blocker.status === 'retrying'
      ? `Task #${blocker.id} is scheduled to retry on this terminal. Wait for it to requeue, then cancel or reassign it before closing the terminal.`
      : `Task #${blocker.id} is ${blocker.status} on this terminal. Cancel or reassign it before closing the terminal.`;
    return {
      owned: true,
      canClose: false,
      reason,
    };
  }
  return { owned: true, canClose: true, reason: null };
}
