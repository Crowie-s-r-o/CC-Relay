export function projectQueueRestartRequired({
  supported,
  paused = false,
  queuedCount = 0,
  projectRunning = false,
  otherProjectRunning = false,
} = {}) {
  return supported !== true
    && paused !== true
    && Number(queuedCount) > 0
    && projectRunning !== true
    && otherProjectRunning === true;
}

function isDirectClaudeTask(task, statuses) {
  return statuses.includes(task?.status)
    && task?.mode === 'execute'
    && task?.provider === 'claude';
}

export function parallelClaudeRestartRequired({
  supported,
  queuedTasks = [],
  runningTasks = [],
} = {}) {
  if (supported === true) return false;
  const queuedClaude = queuedTasks.filter((task) => isDirectClaudeTask(task, ['queued']));
  const runningClaude = runningTasks.filter((task) => isDirectClaudeTask(task, ['running']));
  return queuedClaude.some((queued) => (
    runningClaude.some((running) => running.thread_id !== queued.thread_id)
  ));
}
