const WORKFLOW_MODES = new Set(['execute', 'turbo']);
const PROVIDERS = new Set(['codex', 'claude']);

function selectedValue(items, validValues, label) {
  const choices = [...items];
  const visuallySelected = choices.filter((item) => item.classList.contains('selected'));
  const ariaSelected = choices.filter((item) => item.getAttribute('aria-selected') === 'true');

  if (visuallySelected.length !== 1 || ariaSelected.length !== 1 || visuallySelected[0] !== ariaSelected[0]) {
    throw new Error(`${label} selection is out of sync. Select it again before adding the task.`);
  }

  const value = visuallySelected[0].dataset.mode || visuallySelected[0].dataset.provider;
  if (!validValues.has(value)) {
    throw new Error(`Choose a valid ${label.toLowerCase()} before adding the task.`);
  }
  return value;
}

export function selectedWorkflowMode(tabs) {
  return selectedValue(tabs, WORKFLOW_MODES, 'Workflow');
}

export function selectedExecutionProvider(tabs) {
  return selectedValue(tabs, PROVIDERS, 'Provider');
}

export function runningDirectTask(tasks, threadId) {
  return tasks.find((task) => (
    task.status === 'running'
    && task.mode === 'execute'
    && task.thread_id === threadId
  ));
}

export function idleExecutionThreadId({ threads, tasks, selectedThreadId, provider, routePath, sameProjectPath }) {
  const eligible = threads.filter((thread) => (
    thread.provider === provider
    && (!routePath || sameProjectPath(thread.cwd, routePath))
  ));
  const assignedThreadIds = new Set(tasks
    .filter((task) => (
      task.mode === 'execute'
      && task.provider === provider
      && ['queued', 'running'].includes(task.status)
    ))
    .map((task) => task.thread_id));
  const available = eligible.filter((thread) => (
    thread.status === 'idle' && !assignedThreadIds.has(thread.id)
  ));
  const selected = available.find((thread) => thread.id === selectedThreadId);
  return selected?.id || available[0]?.id || null;
}
