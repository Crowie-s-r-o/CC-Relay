const LABELS = {
  awaiting: 'Forward plan',
  planning: 'Planning ahead',
  reviewing: 'Council review',
  ready: 'Plan ready',
  executing: 'Workers running',
  complete: 'Plan complete',
  failed: 'Plan failed',
};

function planStatus(task) {
  return String(task?.turboPlanSummary?.status || task?.turboPlan?.status || '').toLowerCase();
}

/** Return the presentation phase for a Turbo parent task without touching the DOM. */
export function turboPlanPhase(task) {
  if (task?.mode !== 'turbo') return null;
  const status = String(task.status || '').toLowerCase();
  const persisted = planStatus(task);
  if (status === 'running' && (!persisted || persisted === 'planning')) return 'planning';
  if (status === 'running' && persisted === 'reviewing') return 'reviewing';
  if (status === 'running') return persisted === 'failed' ? 'failed' : 'executing';
  if (status === 'complete') return 'complete';
  if (['failed', 'interrupted', 'cancelled'].includes(status) || persisted === 'failed') return 'failed';
  if (status === 'queued' && persisted === 'planning') return 'planning';
  if (status === 'queued' && persisted === 'reviewing') return 'reviewing';
  if (status === 'queued' && persisted === 'ready') return 'ready';
  if (status === 'queued' && persisted === 'complete') return 'complete';
  return 'awaiting';
}

export function turboPlanMarker(task) {
  const phase = turboPlanPhase(task);
  if (!phase) return null;
  const runningPlanning = phase === 'planning' && String(task?.status || '').toLowerCase() === 'running';
  return { phase, label: runningPlanning ? 'Planning graph' : LABELS[phase] };
}

export function turboWaitingCopy(task) {
  const marker = turboPlanMarker(task);
  if (!marker) return '';
  const councilOrder = task?.turbo?.council?.order || ['codex', 'claude'];
  const providerName = (provider) => provider === 'claude' ? 'Claude' : 'Codex';
  if (marker.phase === 'ready') return 'Plan ready. CC Relay will skip planning and start workers when this task reaches the front of the queue.';
  if (marker.phase === 'planning') {
    if (task?.turbo?.council?.enabled) {
      return `${providerName(councilOrder[0])} is building the first dependency graph before ${providerName(councilOrder[1])} reviews it.`;
    }
    return String(task?.status || '').toLowerCase() === 'running'
      ? 'The planner is building the dependency graph before workers start.'
      : 'CC Relay is planning this task ahead of its execution position.';
  }
  if (marker.phase === 'reviewing') return `${providerName(councilOrder[1])} is reviewing the ${providerName(councilOrder[0])} graph before workers can start.`;
  if (marker.phase === 'executing') return 'Workers are executing the prepared dependency graph.';
  if (marker.phase === 'complete') return 'Turbo workers completed the dependency graph.';
  if (marker.phase === 'failed') return 'Turbo planning or worker execution needs attention.';
  return 'The planner will produce a dependency graph before workers start.';
}
