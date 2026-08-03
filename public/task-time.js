export function formatElapsedDuration(startedAt, finishedAt = null, now = Date.now()) {
  const start = new Date(startedAt || 0).getTime();
  if (!startedAt || !Number.isFinite(start)) {
    return null;
  }
  const parsedEnd = finishedAt ? new Date(finishedAt).getTime() : Number(now);
  const end = Number.isFinite(parsedEnd) ? parsedEnd : Number(now);
  const seconds = Math.max(0, Math.floor((end - start) / 1000));
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

export function taskDurationLabel(task, now = Date.now()) {
  const duration = formatElapsedDuration(task?.started_at, task?.finished_at, now);
  if (!duration) {
    return task?.status === 'queued' ? 'Waiting to start' : 'Not started';
  }
  if (task.status === 'running') {
    return `Running ${duration}`;
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
