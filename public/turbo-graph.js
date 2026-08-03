const GRAPH_STATES = new Set(['pending', 'running', 'complete', 'failed']);

function normalizedText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizedWorkerNumber(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function graphPackages(plan) {
  if (Array.isArray(plan)) return plan;
  return Array.isArray(plan?.tasks) ? plan.tasks : [];
}

function completedSet(value) {
  if (value instanceof Set) return new Set([...value].map((id) => String(id)));
  if (value instanceof Map) return new Set([...value.keys()].map((id) => String(id)));
  if (Array.isArray(value)) {
    return new Set(value.map((item) => (item && typeof item === 'object' ? item.id : item)).filter((id) => id != null).map(String));
  }
  return new Set();
}

/** Normalize one planner package without mutating the persisted graph. */
export function normalizeTurboPackage(packageItem) {
  if (!packageItem || typeof packageItem !== 'object' || Array.isArray(packageItem)) {
    return { id: '', status: 'pending', dependsOn: [] };
  }
  const status = String(packageItem.status || 'pending').toLowerCase();
  const dependsOn = Array.isArray(packageItem.dependsOn)
    ? packageItem.dependsOn.filter((id) => id != null).map(String)
    : [];
  return {
    ...packageItem,
    id: packageItem.id == null ? '' : String(packageItem.id),
    status: GRAPH_STATES.has(status) ? status : 'pending',
    dependsOn,
  };
}

export const normalizeGraphPackage = normalizeTurboPackage;

/** Return aggregate graph counts and terminal progress as an integer percentage. */
export function graphProgress(plan) {
  const counts = { total: 0, pending: 0, running: 0, complete: 0, failed: 0 };
  for (const packageItem of graphPackages(plan)) {
    const state = normalizeTurboPackage(packageItem).status;
    counts.total += 1;
    counts[state] += 1;
  }
  counts.percent = counts.total === 0
    ? 0
    : Math.round(((counts.complete + counts.failed) / counts.total) * 100);
  return counts;
}

export const calculateGraphProgress = graphProgress;

/** Return user-facing progress state without presenting an empty graph as 0 / 0 complete. */
export function graphProgressPresentation(plan, taskStatus = '') {
  const progress = graphProgress(plan);
  const planStatus = String(plan?.status || '').toLowerCase();
  const parentStatus = String(
    taskStatus && typeof taskStatus === 'object' ? taskStatus.status : taskStatus,
  ).toLowerCase();
  const preparing = progress.total === 0 && (
    ['planning', 'reviewing'].includes(planStatus)
    || (parentStatus === 'running' && !['complete', 'failed'].includes(planStatus))
  );

  if (preparing) {
    const reviewing = planStatus === 'reviewing';
    return {
      state: reviewing ? 'reviewing' : 'planning',
      label: reviewing ? 'Reviewing dependency graph' : 'Planning dependency graph',
      ariaLabel: reviewing
        ? 'Turbo dependency graph review in progress'
        : 'Turbo dependency graph planning in progress',
      indeterminate: true,
      progress,
    };
  }

  if (progress.total === 0) {
    return {
      state: 'empty',
      label: 'No graph packages yet',
      ariaLabel: 'Turbo dependency graph has no packages yet',
      indeterminate: false,
      progress,
    };
  }

  return {
    state: 'progress',
    label: `${progress.complete} / ${progress.total} complete`,
    ariaLabel: `Turbo graph progress: ${progress.complete} of ${progress.total} complete`,
    indeterminate: false,
    progress,
  };
}

/** Return whether a pending package can run from the supplied completed IDs. */
export function pendingPackageState(packageItem, completedPackageIds = []) {
  const normalized = normalizeTurboPackage(packageItem);
  if (normalized.status !== 'pending') return normalized.status;
  const completed = completedSet(completedPackageIds);
  return normalized.dependsOn.every((dependency) => completed.has(dependency)) ? 'ready' : 'blocked';
}

export function isPendingPackageReady(packageItem, completedPackageIds = []) {
  return pendingPackageState(packageItem, completedPackageIds) === 'ready';
}

export const dependencyState = pendingPackageState;

function workerEntries(plan) {
  const source = Array.isArray(plan?.workers) ? plan.workers : Array.isArray(plan) ? plan : [];
  return source.map((worker, index) => ({
    threadId: normalizedText(worker?.threadId ?? worker?.id),
    title: normalizedText(worker?.title ?? worker?.name),
    slot: index + 1,
  }));
}

/** Resolve a graph package to its stored worker identity without guessing a CC Relay number. */
export function resolvePackageWorker(packageItem, plan = null) {
  const item = packageItem && typeof packageItem === 'object' ? packageItem : {};
  const workers = workerEntries(plan);
  const numericWorker = normalizedWorkerNumber(item.worker);
  const threadId = normalizedText(item.workerThreadId);
  const storedTitle = normalizedText(item.workerTitle);

  if (threadId) {
    const matching = workers.find((worker) => worker.threadId === threadId);
    return {
      threadId,
      title: storedTitle || matching?.title || null,
      slot: matching?.slot || numericWorker || null,
    };
  }

  if (storedTitle) {
    const matching = workers.find((worker) => worker.title === storedTitle);
    if (matching) return matching;
    return { threadId: null, title: storedTitle, slot: numericWorker };
  }

  if (numericWorker) {
    const matching = workers[numericWorker - 1];
    if (matching) return matching;
    return { threadId: null, title: `Worker ${numericWorker}`, slot: numericWorker };
  }

  return null;
}

export const resolveTurboWorker = resolvePackageWorker;

function manifestDescriptor(role, slot, threadId, title) {
  return { role, slot, threadId: normalizedText(threadId), title: normalizedText(title) };
}

/** Return the planner plus ordered worker descriptors for a Turbo parent task. */
export function turboParentManifest(task) {
  const turbo = task?.turbo && typeof task.turbo === 'object' ? task.turbo : {};
  const planner = manifestDescriptor(
    'planner',
    0,
    turbo.plannerThreadId || task?.thread_id,
    turbo.plannerTitle || turbo.plannerThreadTitle || task?.thread_name,
  );
  const workers = (Array.isArray(turbo.workers) ? turbo.workers : []).map((worker, index) => manifestDescriptor(
    'worker',
    index + 1,
    worker?.threadId,
    worker?.title || worker?.name,
  ));
  return { planner, workers };
}

export const parentManifest = turboParentManifest;
