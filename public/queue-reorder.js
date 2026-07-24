function normalizeIds(ids) {
  return Array.isArray(ids) ? ids.map((id) => Number(id)) : [];
}

function sameMembers(left, right) {
  if (left.length !== right.length) return false;
  const expected = new Set(left);
  return right.every((id) => expected.has(id)) && expected.size === right.length;
}

export function queuedTaskIds(tasks) {
  return (Array.isArray(tasks) ? tasks : [])
    .filter((task) => task?.status === 'queued')
    .sort((left, right) => Number(left.position) - Number(right.position) || Number(left.id) - Number(right.id))
    .map((task) => Number(task.id))
    .filter((id) => Number.isInteger(id) && id > 0);
}

export function createQueueSnapshot(globalTaskIds, visibleTaskIds = globalTaskIds) {
  const globalIds = normalizeIds(globalTaskIds);
  const visibleIds = normalizeIds(visibleTaskIds);
  if (!sameMembers(visibleIds, globalIds) && visibleIds.some((id) => !globalIds.includes(id))) {
    throw new Error('Visible queued IDs must come from the global queued order.');
  }
  return Object.freeze({
    draggedId: null,
    expectedTaskIds: Object.freeze([...globalIds]),
    globalTaskIds: Object.freeze([...globalIds]),
    visibleTaskIds: Object.freeze([...visibleIds]),
    targetId: null,
    edge: null,
    submitted: false,
  });
}

export function mergeVisibleQueueOrder(snapshot, visibleTaskIds) {
  if (!snapshot || !Array.isArray(snapshot.globalTaskIds) || !Array.isArray(snapshot.visibleTaskIds)) {
    return null;
  }
  const nextVisible = normalizeIds(visibleTaskIds);
  if (!sameMembers(nextVisible, snapshot.visibleTaskIds)) return null;
  const visible = new Set(snapshot.visibleTaskIds);
  let index = 0;
  return snapshot.globalTaskIds.map((id) => visible.has(id) ? nextVisible[index++] : id);
}

export function moveVisibleTask(snapshot, taskId, direction) {
  if (!snapshot || !Number.isInteger(Number(taskId)) || !Number.isInteger(direction)) return null;
  const next = [...snapshot.visibleTaskIds];
  const from = next.indexOf(Number(taskId));
  const to = from + direction;
  if (from < 0 || to < 0 || to >= next.length) return null;
  [next[from], next[to]] = [next[to], next[from]];
  return mergeVisibleQueueOrder(snapshot, next);
}

export function dropVisibleTask(snapshot, draggedId, targetId, edge = 'before') {
  if (!snapshot || draggedId === targetId) return null;
  const next = snapshot.visibleTaskIds.filter((id) => id !== Number(draggedId));
  const targetIndex = next.indexOf(Number(targetId));
  if (targetIndex < 0 || !['before', 'after'].includes(edge)) return null;
  next.splice(targetIndex + (edge === 'after' ? 1 : 0), 0, Number(draggedId));
  return mergeVisibleQueueOrder(snapshot, next);
}

export function buildQueueReorderRequest(snapshot, taskIds) {
  if (!snapshot || !Array.isArray(taskIds)) return null;
  const normalized = normalizeIds(taskIds);
  const merged = sameMembers(normalized, snapshot.globalTaskIds)
    ? normalized
    : mergeVisibleQueueOrder(snapshot, normalized);
  if (!merged) return null;
  return {
    expectedTaskIds: [...snapshot.globalTaskIds],
    taskIds: merged,
  };
}

export const mergeQueueOrder = mergeVisibleQueueOrder;
export const moveQueuedTask = moveVisibleTask;
export const dropQueuedTask = dropVisibleTask;
