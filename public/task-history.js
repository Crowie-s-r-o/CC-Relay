const PERIODS = new Set(['day', 'week', 'month']);
const FINISHED_STATUSES = new Set(['complete', 'failed', 'interrupted', 'cancelled']);

function normalizedProjectPath(path) {
  return String(path || '').replace(/[\\/]+$/, '').replaceAll('\\', '/');
}

export function tasksForScope(tasks, { projectPath = null, taskScope = 'workspace', threadId = null } = {}) {
  if (!projectPath) return [];
  const projectTasks = tasks.filter((task) => normalizedProjectPath(task.repo_path) === normalizedProjectPath(projectPath));
  return taskScope === 'relay' && threadId
    ? projectTasks.filter((task) => task.thread_id === threadId)
    : projectTasks;
}

function validPeriod(period) {
  return PERIODS.has(period) ? period : 'week';
}

export function periodRange(period, anchor = new Date()) {
  const normalized = validPeriod(period);
  const start = new Date(anchor);
  start.setHours(0, 0, 0, 0);
  if (normalized === 'week') {
    const mondayOffset = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - mondayOffset);
  } else if (normalized === 'month') {
    start.setDate(1);
  }
  const end = new Date(start);
  if (normalized === 'day') end.setDate(end.getDate() + 1);
  if (normalized === 'week') end.setDate(end.getDate() + 7);
  if (normalized === 'month') end.setMonth(end.getMonth() + 1);
  return { start, end };
}

export function shiftPeriod(period, anchor, amount) {
  const date = new Date(anchor);
  const normalized = validPeriod(period);
  if (normalized === 'day') date.setDate(date.getDate() + amount);
  if (normalized === 'week') date.setDate(date.getDate() + (amount * 7));
  if (normalized === 'month') date.setMonth(date.getMonth() + amount);
  return date;
}

export function tasksInPeriod(tasks, period, anchor = new Date()) {
  const { start, end } = periodRange(period, anchor);
  return tasks.filter((task) => {
    const created = new Date(task.created_at || 0).getTime();
    return Number.isFinite(created) && created >= start.getTime() && created < end.getTime();
  });
}

export function taskHistoryStats(tasks) {
  let runtimeMs = 0;
  let successful = 0;
  let finished = 0;
  for (const task of tasks) {
    if (FINISHED_STATUSES.has(task.status)) finished += 1;
    if (task.status === 'complete') successful += 1;
    const started = new Date(task.started_at || 0).getTime();
    const ended = new Date(task.finished_at || 0).getTime();
    if (task.started_at && task.finished_at && Number.isFinite(started) && Number.isFinite(ended)) {
      runtimeMs += Math.max(0, ended - started);
    }
  }
  return {
    total: tasks.length,
    successful,
    finished,
    successRate: finished ? Math.round((successful / finished) * 100) : null,
    runtimeMs,
  };
}

export function activityBuckets(tasks, period, anchor = new Date()) {
  const normalized = validPeriod(period);
  const { start, end } = periodRange(normalized, anchor);
  const bucketCount = normalized === 'day'
    ? 6
    : normalized === 'week' ? 7 : Math.round((end - start) / 86_400_000);
  const buckets = Array.from({ length: bucketCount }, (_, index) => {
    const bucketStart = new Date(start);
    if (normalized === 'day') bucketStart.setHours(index * 4);
    else bucketStart.setDate(start.getDate() + index);
    const bucketEnd = new Date(bucketStart);
    if (normalized === 'day') bucketEnd.setHours(bucketEnd.getHours() + 4);
    else bucketEnd.setDate(bucketEnd.getDate() + 1);
    return { start: bucketStart, end: bucketEnd, count: 0 };
  });
  for (const task of tasks) {
    const created = new Date(task.created_at || 0).getTime();
    const bucket = buckets.find(({ start: bucketStart, end: bucketEnd }) => (
      created >= bucketStart.getTime() && created < bucketEnd.getTime()
    ));
    if (bucket) bucket.count += 1;
  }
  return buckets;
}
