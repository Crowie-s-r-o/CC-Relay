import { taskRuntimeMilliseconds } from './task-time.js';

const PERIODS = new Set(['day', 'week', 'month']);
const FINISHED_STATUSES = new Set(['complete', 'failed', 'interrupted', 'cancelled']);

function normalizedProjectPath(path) {
  return String(path || '').replace(/[\\/]+$/, '').replaceAll('\\', '/');
}

/**
 * True when a task has reached a terminal state and can no longer produce work.
 * Shared so callers cannot drift from the set the history statistics already use.
 */
export function isFinishedTaskStatus(status) {
  return FINISHED_STATUSES.has(status);
}

export function tasksForScope(tasks, { projectPath = null } = {}) {
  if (!projectPath) return [];
  return tasks.filter((task) => normalizedProjectPath(task.repo_path) === normalizedProjectPath(projectPath));
}

export function prioritizeStarredTasks(tasks) {
  return (Array.isArray(tasks) ? tasks : [])
    .map((task, index) => ({ task, index }))
    .sort((left, right) => (
      Number(right.task?.starred === true) - Number(left.task?.starred === true)
      || left.index - right.index
    ))
    .map(({ task }) => task);
}

function operationalTaskRank(task, readyForReview) {
  if (task.status === 'running') return 0;
  if (task.status === 'complete' && readyForReview) return 1;
  if (task.status === 'open') return 2;
  if (task.status === 'queued') return 3;
  return 4;
}

/**
 * Order the operational queue without changing History or search results.
 * Completed tasks awaiting review stay directly below live work until the
 * operator opens them and the notification store acknowledges the review.
 */
export function sortOperationalTasks(tasks, { isReadyForReview = () => false } = {}) {
  return prioritizeStarredTasks([...tasks].sort((left, right) => {
    const leftRank = operationalTaskRank(left, isReadyForReview(left));
    const rightRank = operationalTaskRank(right, isReadyForReview(right));
    const rankDifference = leftRank - rightRank;
    if (rankDifference !== 0) return rankDifference;
    if (left.status === 'queued' && right.status === 'queued') {
      return left.position - right.position || left.id - right.id;
    }
    return right.id - left.id;
  }));
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
    if (FINISHED_STATUSES.has(task.status)) {
      runtimeMs += taskRuntimeMilliseconds(task, task.finished_at
        ? new Date(task.finished_at).getTime()
        : Date.now()) || 0;
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
