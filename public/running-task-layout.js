const RUNNING_TASK_ROWS = new Set([1, 2, 3]);

export function runningTaskRailGroups(tasks = [], requestedRows = 1) {
  const candidateRows = Number(requestedRows);
  const rows = RUNNING_TASK_ROWS.has(candidateRows) ? candidateRows : 1;
  const primary = [];
  const extra = [];

  tasks.forEach((task, index) => {
    (index % rows === 0 ? primary : extra).push(task);
  });

  return { primary, extra };
}
