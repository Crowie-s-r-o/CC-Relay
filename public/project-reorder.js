function normalizedIds(ids) {
  if (!Array.isArray(ids)) return null;
  const normalized = ids.map((id) => Number(id));
  if (
    normalized.some((id) => !Number.isInteger(id) || id <= 0)
    || new Set(normalized).size !== normalized.length
  ) return null;
  return normalized;
}

function sameMembers(left, right) {
  if (left.length !== right.length) return false;
  const expected = new Set(left);
  return right.every((id) => expected.has(id));
}

export function projectOrderIds(projects) {
  return (Array.isArray(projects) ? projects : [])
    .map((project) => Number(project?.id))
    .filter((id) => Number.isInteger(id) && id > 0);
}

export function moveProjectInOrder(projectIds, projectId, direction) {
  const ids = normalizedIds(projectIds);
  const id = Number(projectId);
  if (!ids || !Number.isInteger(id) || ![-1, 1].includes(direction)) return null;
  const from = ids.indexOf(id);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= ids.length) return null;
  [ids[from], ids[to]] = [ids[to], ids[from]];
  return ids;
}

export function dropProjectInOrder(projectIds, draggedId, targetId, edge = 'before') {
  const ids = normalizedIds(projectIds);
  const dragged = Number(draggedId);
  const target = Number(targetId);
  if (
    !ids
    || dragged === target
    || !ids.includes(dragged)
    || !['before', 'after'].includes(edge)
  ) return null;
  const next = ids.filter((id) => id !== dragged);
  const targetIndex = next.indexOf(target);
  if (targetIndex < 0) return null;
  next.splice(targetIndex + (edge === 'after' ? 1 : 0), 0, dragged);
  return next;
}

export function buildProjectReorderRequest(expectedProjectIds, projectIds) {
  const expected = normalizedIds(expectedProjectIds);
  const next = normalizedIds(projectIds);
  if (!expected || !next || !sameMembers(expected, next)) return null;
  if (expected.every((id, index) => id === next[index])) return null;
  return { expectedProjectIds: expected, projectIds: next };
}
