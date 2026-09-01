export function formatDurationMilliseconds(milliseconds) {
  const parsed = Number(milliseconds);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  const seconds = Math.max(0, Math.floor(parsed / 1000));
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d ${String(hours % 24).padStart(2, '0')}h`;
}

export function formatElapsedDuration(startedAt, finishedAt = null, now = Date.now()) {
  const start = new Date(startedAt || 0).getTime();
  if (!startedAt || !Number.isFinite(start)) {
    return null;
  }
  const parsedEnd = finishedAt ? new Date(finishedAt).getTime() : Number(now);
  const end = Number.isFinite(parsedEnd) ? parsedEnd : Number(now);
  return formatDurationMilliseconds(Math.max(0, end - start));
}

export function taskRuntimeMilliseconds(task, now = Date.now()) {
  const metrics = task?.conversation_metrics;
  const attemptCount = Number(metrics?.attempt_count);
  const recordedDuration = Number(metrics?.duration_ms);
  if (
    metrics
    && Number.isFinite(attemptCount)
    && attemptCount > 0
    && Number.isFinite(recordedDuration)
    && recordedDuration >= 0
  ) {
    const activeStartedAt = metrics.active_attempt_started_at;
    const activeStart = activeStartedAt ? new Date(activeStartedAt).getTime() : 0;
    const currentTime = Number(now);
    const activeDuration = task?.status === 'running'
      && Number.isFinite(activeStart)
      && activeStart > 0
      && Number.isFinite(currentTime)
      ? Math.max(0, currentTime - activeStart)
      : 0;
    return recordedDuration + activeDuration;
  }

  const startedAt = new Date(task?.started_at || 0).getTime();
  if (!task?.started_at || !Number.isFinite(startedAt)) return null;
  const parsedEnd = task?.finished_at ? new Date(task.finished_at).getTime() : Number(now);
  const endedAt = Number.isFinite(parsedEnd) ? parsedEnd : Number(now);
  return Math.max(0, endedAt - startedAt);
}

export function formatTaskDuration(task, now = Date.now()) {
  const runtime = taskRuntimeMilliseconds(task, now);
  return runtime === null ? null : formatDurationMilliseconds(runtime);
}

export function taskDurationLabel(task, now = Date.now()) {
  const duration = formatTaskDuration(task, now);
  if (!duration) {
    return task?.status === 'queued' ? 'Waiting to start' : 'Not started';
  }
  if (task.status === 'running') {
    return `Running ${duration}`;
  }
  if (task.status === 'open') {
    return `Open ${duration}`;
  }
  return `Took ${duration}`;
}

export function taskLifecycleDates(task) {
  return [
    {
      key: 'started',
      label: 'Started',
      value: task?.started_at || null,
      pendingLabel: 'Not started',
    },
    {
      key: 'completed',
      label: 'Completed',
      value: task?.finished_at || null,
      pendingLabel: 'Not completed',
    },
  ];
}
