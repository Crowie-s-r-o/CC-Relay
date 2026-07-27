// Pure, DOM-free helpers for the Planner dependency board and plan runs.
//
// Everything here operates on plain proposal and run shapes so the wave
// computation, dependency editing guards, run presentation, and the
// never-clobber-user-edits decision can be unit tested without a browser.
//
// Companion to public/planner-state.js, which owns the v1 breakdown status
// machine and the flat proposal transforms.

// dev-1's frozen step vocabulary. `retrying` is work still in flight, not a
// failure, and `blocked` plus `failed` are derived on every reconcile pass
// rather than latched, so a task retry can move a step back out of them.
export const RUN_STEP_STATUSES = [
  'waiting', 'queued', 'running', 'retrying', 'complete', 'failed', 'cancelled', 'blocked',
];

/** Statuses that will not change again on their own. */
const SETTLED_STATUSES = ['complete', 'cancelled'];

export function plannerV2Capable(status) {
  return status?.capabilities?.plannerV2 === true;
}

/** Dependency ids declared by a proposal, normalized to unique strings. */
export function dependencyIds(proposal) {
  const raw = proposal && Array.isArray(proposal.dependsOn) ? proposal.dependsOn : [];
  const seen = new Set();
  const out = [];
  for (const value of raw) {
    if (value === null || value === undefined) continue;
    const id = String(value);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * Dependencies that actually point at another proposal in this list.
 * A self-reference or an id that no longer exists is ignored rather than
 * treated as permanently unmet, which would present the whole board as blocked.
 */
export function resolvedDependencies(proposal, proposals) {
  const known = new Set(proposals.map((item) => String(item.id)));
  const self = String(proposal.id);
  return dependencyIds(proposal).filter((id) => id !== self && known.has(id));
}

/**
 * Group proposals into execution waves. Wave 1 has no unmet dependencies,
 * wave 2 depends only on wave 1, and so on. Proposals caught in a dependency
 * cycle can never become runnable, so they are reported separately instead of
 * being folded into a final wave that would look dispatchable.
 */
export function computeWaves(proposals) {
  const list = Array.isArray(proposals) ? proposals : [];
  const deps = new Map(list.map((proposal) => [String(proposal.id), resolvedDependencies(proposal, list)]));
  const settled = new Set();
  const waves = [];
  let remaining = list.slice();
  while (remaining.length > 0) {
    const ready = remaining.filter((proposal) => (
      deps.get(String(proposal.id)).every((id) => settled.has(id))
    ));
    if (ready.length === 0) break;
    for (const proposal of ready) settled.add(String(proposal.id));
    waves.push(ready);
    remaining = remaining.filter((proposal) => !settled.has(String(proposal.id)));
  }
  return { waves, unresolvable: remaining };
}

/** Drop dependency ids that no longer point at an existing proposal. */
export function pruneDanglingDependencies(proposals) {
  const list = Array.isArray(proposals) ? proposals : [];
  const known = new Set(list.map((proposal) => String(proposal.id)));
  return list.map((proposal) => {
    const kept = dependencyIds(proposal).filter((id) => id !== String(proposal.id) && known.has(id));
    const current = dependencyIds(proposal);
    if (kept.length === current.length) return proposal;
    return { ...proposal, dependsOn: kept };
  });
}

/** True when `fromId` depends on `targetId` directly or through other steps. */
export function dependsOnTransitively(proposals, fromId, targetId) {
  const list = Array.isArray(proposals) ? proposals : [];
  const byId = new Map(list.map((proposal) => [String(proposal.id), proposal]));
  const start = byId.get(String(fromId));
  if (!start) return false;
  const seen = new Set();
  const stack = [...dependencyIds(start)];
  while (stack.length > 0) {
    const id = stack.pop();
    if (id === String(targetId)) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    const next = byId.get(id);
    if (next) stack.push(...dependencyIds(next));
  }
  return false;
}

/**
 * Add or remove one dependency edge. A self-reference and any edge that would
 * close a cycle are refused, so the board can never persist a graph the
 * backend would have to prune behind the user's back.
 */
export function toggleDependency(proposals, id, dependencyId) {
  const list = Array.isArray(proposals) ? proposals : [];
  const stepId = String(id);
  const depId = String(dependencyId);
  if (stepId === depId) return list;
  const target = list.find((proposal) => String(proposal.id) === stepId);
  if (!target) return list;
  if (!list.some((proposal) => String(proposal.id) === depId)) return list;
  const current = dependencyIds(target);
  const has = current.includes(depId);
  if (!has && dependsOnTransitively(list, depId, stepId)) return list;
  const next = has ? current.filter((value) => value !== depId) : [...current, depId];
  return list.map((proposal) => (
    String(proposal.id) === stepId ? { ...proposal, dependsOn: next } : proposal
  ));
}

/** The next unused `step-n` id, so manual steps stay readable and unique. */
export function nextProposalId(proposals) {
  const used = new Set((Array.isArray(proposals) ? proposals : []).map((proposal) => String(proposal.id)));
  let index = used.size + 1;
  while (used.has(`step-${index}`)) index += 1;
  return `step-${index}`;
}

/** Append one manually authored step. */
export function addProposal(proposals, draft = {}) {
  const list = Array.isArray(proposals) ? proposals : [];
  const id = draft.id ? String(draft.id) : nextProposalId(list);
  if (list.some((proposal) => String(proposal.id) === id)) return list;
  const known = new Set(list.map((proposal) => String(proposal.id)));
  const dependsOn = (Array.isArray(draft.dependsOn) ? draft.dependsOn : [])
    .map((value) => String(value))
    .filter((value) => known.has(value));
  return [...list, {
    id,
    title: typeof draft.title === 'string' ? draft.title : '',
    prompt: typeof draft.prompt === 'string' ? draft.prompt : '',
    dependsOn,
  }];
}

function formatList(values) {
  if (values.length === 0) return '';
  if (values.length === 1) return String(values[0]);
  return `${values.slice(0, -1).join(', ')} and ${values[values.length - 1]}`;
}

/**
 * Plain-text dependency sentence, always recomputed from the current position
 * of each dependency so reordering cannot leave a stale step number behind.
 */
export function dependencyLabel(proposal, proposals) {
  const list = Array.isArray(proposals) ? proposals : [];
  const numbers = resolvedDependencies(proposal, list)
    .map((id) => list.findIndex((item) => String(item.id) === id) + 1)
    .filter((number) => number > 0)
    .sort((a, b) => a - b);
  if (numbers.length === 0) return '';
  return `after step${numbers.length === 1 ? '' : 's'} ${formatList(numbers)}`;
}

export function runStepFor(run, proposalId) {
  const steps = run && Array.isArray(run.steps) ? run.steps : [];
  return steps.find((step) => String(step.proposalId) === String(proposalId)) || null;
}

export function planRunIsActive(run) {
  return Boolean(run) && run.status === 'running';
}

/** A run that still owns its steps, including one stopped with work in flight. */
export function planRunIsLive(run) {
  return Boolean(run) && ['running', 'stopped'].includes(run.status);
}

/**
 * Presentation for one step chip. `retrying` deliberately keeps the running
 * tone and its own state so it never reads as a failure: the task is still in
 * flight and the run remains running.
 *
 * Stop is latched, so a step still waiting when the user stopped the run will
 * never start. It reads as **Not started** rather than implying it is queued
 * behind its dependencies.
 */
export function stepStatusPresentation(status, runStatus) {
  if (status === 'waiting' && runStatus === 'stopped') {
    return { state: 'not-started', label: 'Not started', tone: 'neutral' };
  }
  switch (status) {
    case 'queued':
      return { state: 'queued', label: 'Queued', tone: 'queued' };
    case 'running':
      return { state: 'running', label: 'Running', tone: 'running' };
    case 'retrying':
      return { state: 'retrying', label: 'Retrying', tone: 'running' };
    case 'complete':
      return { state: 'complete', label: 'Complete', tone: 'success' };
    case 'failed':
      return { state: 'failed', label: 'Failed', tone: 'failed' };
    case 'cancelled':
      return { state: 'cancelled', label: 'Cancelled', tone: 'neutral' };
    case 'blocked':
      return { state: 'blocked', label: 'Blocked', tone: 'warning' };
    default:
      return { state: 'waiting', label: 'Waiting', tone: 'idle' };
  }
}

/** The step status for a proposal, falling back to waiting outside a run. */
export function proposalStatus(proposalId, run) {
  const step = runStepFor(run, proposalId);
  return step && RUN_STEP_STATUSES.includes(step.status) ? step.status : 'waiting';
}

/**
 * Editing guard. A step already handed to the queue is owned by the run, so its
 * text and dependencies stop being editable. A failed step stays editable so it
 * can be fixed and run again, and a completed step unlocks once its run ends.
 */
export function stepEditingLocked(proposalId, run) {
  if (!run) return false;
  const step = runStepFor(run, proposalId);
  if (!step) return false;
  if (['queued', 'running', 'retrying'].includes(step.status)) return true;
  return step.status === 'complete' && planRunIsLive(run);
}

/** Dependencies of a step that are not finished, failures named first. */
export function blockingSteps(proposal, proposals, run) {
  const list = Array.isArray(proposals) ? proposals : [];
  const rank = (status) => (status === 'failed' ? 0 : status === 'cancelled' ? 1 : 2);
  return resolvedDependencies(proposal, list)
    .map((id) => {
      const index = list.findIndex((item) => String(item.id) === id);
      return { id, number: index + 1, status: proposalStatus(id, run) };
    })
    .filter((entry) => entry.number > 0 && entry.status !== 'complete')
    .sort((a, b) => (rank(a.status) - rank(b.status)) || (a.number - b.number));
}

/** Why a blocked step cannot start, naming the failed dependency explicitly. */
export function blockedReasonLabel(proposal, proposals, run) {
  const blockers = blockingSteps(proposal, proposals, run);
  if (blockers.length === 0) return '';
  const failed = blockers.filter((entry) => entry.status === 'failed').map((entry) => entry.number);
  if (failed.length > 0) {
    return `Blocked by failed step${failed.length === 1 ? '' : 's'} ${formatList(failed)}`;
  }
  const cancelled = blockers.filter((entry) => entry.status === 'cancelled').map((entry) => entry.number);
  if (cancelled.length > 0) {
    return `Blocked by cancelled step${cancelled.length === 1 ? '' : 's'} ${formatList(cancelled)}`;
  }
  const waiting = blockers.map((entry) => entry.number);
  return `Waiting on step${waiting.length === 1 ? '' : 's'} ${formatList(waiting)}`;
}

/**
 * Counts plus the short sentence used by the plan library and the run bar.
 *
 * The steps array is preferred whenever it is present, because it is by
 * definition exactly the steps this run owns. A run started from a subset of
 * the plan must not be measured against the whole plan: that would understate
 * a partial run forever and never reach 100 percent. `run.counts` is used only
 * for the plan library summary, which carries counts without steps.
 */
export function runProgressSummary(run) {
  const counts = { total: 0, waiting: 0, queued: 0, running: 0, retrying: 0, complete: 0, failed: 0, cancelled: 0, blocked: 0 };
  const steps = run && Array.isArray(run.steps) ? run.steps : [];
  if (steps.length > 0) {
    counts.total = steps.length;
    for (const step of steps) {
      const status = RUN_STEP_STATUSES.includes(step.status) ? step.status : 'waiting';
      counts[status] += 1;
    }
  } else if (run && run.counts && typeof run.counts === 'object') {
    for (const key of Object.keys(counts)) {
      const value = Number(run.counts[key]);
      if (Number.isFinite(value) && value >= 0) counts[key] = value;
    }
  }
  const parts = [];
  if (counts.total > 0) parts.push(`${counts.complete} of ${counts.total} steps complete`);
  if (counts.failed > 0) parts.push(`${counts.failed} failed`);
  if (counts.retrying > 0) parts.push(`${counts.retrying} retrying`);
  if (counts.blocked > 0) parts.push(`${counts.blocked} blocked`);
  if (counts.cancelled > 0) parts.push(`${counts.cancelled} cancelled`);
  return { ...counts, label: parts.join(', ') };
}

/** Index of the first wave that still has unsettled work, or -1 when done. */
export function activeWaveIndex(waves, run) {
  const list = Array.isArray(waves) ? waves : [];
  for (let index = 0; index < list.length; index += 1) {
    if (list[index].some((proposal) => !SETTLED_STATUSES.includes(proposalStatus(proposal.id, run)))) return index;
  }
  return -1;
}

/** One short sentence for the run live region. Kept stable between changes. */
export function runAnnouncement(waves, run) {
  if (!run) return '';
  const progress = runProgressSummary(run);
  const active = activeWaveIndex(waves, run);
  const total = Array.isArray(waves) ? waves.length : 0;
  const stage = run.status === 'running' && active >= 0 && total > 0
    ? `Wave ${active + 1} of ${total}. `
    : '';
  const state = run.status === 'running'
    ? 'Plan run in progress'
    : run.status === 'stopped'
      ? 'Plan run stopped'
      : run.status === 'failed'
        ? 'Plan run failed'
        : 'Plan run complete';
  return `${stage}${state}. ${progress.label}.`.replace(/\s+/g, ' ').trim();
}

/**
 * Identity of everything the board markup is built from. When this is
 * unchanged, a background refresh must update chips in place instead of
 * replacing markup the user may be typing into.
 */
export function plannerBoardSignature(proposals, run, context = {}) {
  const list = Array.isArray(proposals) ? proposals : [];
  const shape = list.map((proposal) => `${proposal.id}>${dependencyIds(proposal).join('+')}`).join('|');
  return [
    context.attemptId === undefined || context.attemptId === null ? '' : String(context.attemptId),
    // The attempt status changes the whole board: a pending or failed attempt
    // renders the previous steps read-only with a banner and its own recovery
    // block, while the same attempt completing swaps in the new steps.
    context.attemptStatus === undefined || context.attemptStatus === null ? '' : String(context.attemptStatus),
    context.capable ? 'v2' : 'v1',
    run ? String(run.id) : 'norun',
    run ? String(run.status) : '',
    run && Array.isArray(run.steps) ? run.steps.length : 0,
    shape,
  ].join('~');
}

/** Presentation for the run banner itself. */
export function runStatusPresentation(run) {
  if (!run) return { state: 'idle', label: 'No run yet', tone: 'idle' };
  switch (run.status) {
    case 'running':
      return { state: 'running', label: 'Run in progress', tone: 'running' };
    case 'stopped':
      return { state: 'stopped', label: 'Run stopped', tone: 'neutral' };
    case 'failed':
      return { state: 'failed', label: 'Run failed', tone: 'failed' };
    case 'complete':
      return { state: 'complete', label: 'Run complete', tone: 'success' };
    default:
      return { state: 'idle', label: 'No run yet', tone: 'idle' };
  }
}

/**
 * Readable copy for a breakdown parse note, so a dependency the server pruned
 * is explained instead of silently disappearing from the board.
 */
export function breakdownNoteLabel(note, proposals) {
  if (!note) return '';
  const list = Array.isArray(proposals) ? proposals : [];
  const index = list.findIndex((proposal) => String(proposal.id) === String(note.proposalId));
  const step = index >= 0 ? `Step ${index + 1}` : 'A step';
  switch (note.code) {
    case 'unknown-dependency':
      return `${step} referenced a dependency Relay could not resolve, so it was dropped.`;
    case 'self-dependency':
      return `${step} depended on itself, so that dependency was dropped.`;
    case 'cycle-dropped':
      return `${step} formed a dependency cycle, so the closing dependency was dropped.`;
    default:
      return note.message ? String(note.message) : '';
  }
}

/**
 * The never-clobber-user-edits decision. A background refresh may replace the
 * local proposals only when nothing is unsaved and no save is in flight. A new
 * breakdown attempt is the one exception: a refinement legitimately replaces
 * the list, and the user was told their current steps were sent for revision.
 */
export function shouldAdoptServerProposals({ hasDirtyEdits, saveInFlight, localAttemptId, serverAttemptId } = {}) {
  const local = localAttemptId === undefined || localAttemptId === null ? null : String(localAttemptId);
  const server = serverAttemptId === undefined || serverAttemptId === null ? null : String(serverAttemptId);
  if (local !== null && server !== null && local !== server) return true;
  return !hasDirtyEdits && !saveInFlight;
}

function toIdSet(value) {
  if (value instanceof Set) return new Set([...value].map((id) => String(id)));
  return new Set((value || []).map((id) => String(id)));
}

/**
 * Which steps are checked when a breakdown attempt is first adopted.
 *
 * Two rules, both about never changing the user's intent behind their back:
 * a step the latest run already completed is not auto-selected, so pressing
 * Run plan can never silently repeat finished work; and a surviving step the
 * user had explicitly unchecked stays unchecked across a refinement. Genuinely
 * new steps, and the very first adoption of a plan, start selected.
 */
export function defaultRunSelection(proposals, run, previousSelection, { knownIds } = {}) {
  const previous = toIdSet(previousSelection);
  const known = toIdSet(knownIds);
  const next = new Set();
  for (const proposal of Array.isArray(proposals) ? proposals : []) {
    const id = String(proposal.id);
    if (proposalStatus(id, run) === 'complete') continue;
    if (known.has(id) && !previous.has(id)) continue;
    next.add(id);
  }
  return next;
}

/**
 * Steps of a previous run that are still in flight.
 *
 * Stop deliberately leaves queued and running tasks alone, so stop-then-run
 * again is exactly the path that would execute a step twice: the per-step
 * submission id is keyed on the run id, so a second run mints new tasks for
 * the same prompts and the queue's idempotency guard cannot collapse them.
 * The server refuses that with a 409; the board refuses it up front.
 */
export function drainingSteps(run) {
  const steps = run && Array.isArray(run.steps) ? run.steps : [];
  return steps.filter((step) => ['queued', 'running', 'retrying'].includes(step.status));
}

/**
 * How many steps are still in flight. The detail payload carries `steps`; the
 * plan library summary carries only `counts`. Both stay live during the drain,
 * so the number in the copy counts down on its own.
 */
export function drainingStepCount(run) {
  if (run && Array.isArray(run.steps) && run.steps.length > 0) return drainingSteps(run).length;
  const counts = run && run.counts && typeof run.counts === 'object' ? run.counts : null;
  if (!counts) return 0;
  return ['queued', 'running', 'retrying']
    .reduce((total, key) => total + (Number.isFinite(Number(counts[key])) ? Number(counts[key]) : 0), 0);
}

/** Why Run plan is unavailable, or an empty string when it can proceed. */
export function runStartBlockReason(run) {
  if (planRunIsActive(run)) return 'A plan run is already in progress.';
  const draining = drainingStepCount(run);
  if (draining === 0) return '';
  return `Waiting for ${draining} step${draining === 1 ? '' : 's'} from the previous run to finish. Cancel them from the queue or let them drain.`;
}

/**
 * Re-validate a selection against the run as it stands right now.
 *
 * Consent can go stale: a refinement can land mid-run and auto-select steps
 * that were merely in flight at adoption time, the run then completes them,
 * and a later Run plan would re-execute just-finished work. Dropping anything
 * the latest run has since completed keeps the press honest.
 */
export function runnableSelection(proposals, selectedIds, run) {
  const selected = toIdSet(selectedIds);
  const runnable = [];
  const dropped = [];
  for (const proposal of Array.isArray(proposals) ? proposals : []) {
    const id = String(proposal.id);
    if (!selected.has(id)) continue;
    if (proposalStatus(id, run) === 'complete') dropped.push(proposal);
    else runnable.push(proposal);
  }
  return { runnable, dropped };
}

/** Whether Run plan can proceed: a session, a selection, and no run in flight. */
export function canRunPlan({ hasSession, selectedCount, run, busy } = {}) {
  if (busy) return false;
  if (runStartBlockReason(run)) return false;
  return Boolean(hasSession) && Number(selectedCount) > 0;
}
