import { createHash } from 'node:crypto';
import { now } from './database.mjs';

export const RUN_STATUSES = ['running', 'stopped', 'complete', 'failed'];
export const STEP_STATUSES = [
  'waiting', 'queued', 'running', 'retrying', 'complete', 'failed', 'cancelled', 'blocked',
];

// A step that still owns live queue work. None of these is a failure, and none of them
// lets a dependent start.
const STEP_IN_FLIGHT = new Set(['queued', 'running', 'retrying']);
// A step that will never complete on its own. Dependents of these are blocked.
const STEP_FAILED = new Set(['failed', 'cancelled', 'blocked']);
// Runs that can still enqueue work. Everything else is inert.
const RUN_ACTIVE = new Set(['running']);

export function isStepInFlight(status) { return STEP_IN_FLIGHT.has(status); }
export function isStepFailure(status) { return STEP_FAILED.has(status); }
export function isRunActive(status) { return RUN_ACTIVE.has(status); }

/**
 * Deterministic submission id for one step of one run.
 *
 * This is the double-enqueue guard. The reconciler is re-entrant by design (a queue
 * `changed` event fires synchronously from inside `enqueue`, and the same run is also
 * reconciled on boot, on POST, and on read), so the id must be a pure function of
 * plan + run + proposal. Any repeated enqueue for the same step then collapses onto the
 * task the queue already created through its existing submission-id idempotency guard.
 *
 * Shaped as a version 4 UUID so it satisfies the same submission id format the rest of
 * CC Relay uses.
 */
export function planStepSubmissionId({ planId, runId, proposalId }) {
  const digest = createHash('sha256')
    .update(`relay-plan-step:${planId}:${runId}:${proposalId}`)
    .digest();
  const bytes = Uint8Array.prototype.slice.call(digest, 0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Buffer.from(bytes).toString('hex');
  return [
    hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20, 32),
  ].join('-');
}

/**
 * Map the live state of a step's queue task onto a step status.
 *
 * The automatic retry stays in charge of the task itself, so a failed task with a retry
 * already scheduled is `retrying`, not `failed`: it is still in flight and must not block
 * its dependents. Only a failure with nothing scheduled counts as a step failure. A task
 * row that has disappeared (the user deleted it) is a failure too, and deliberately not a
 * reason to enqueue the step again.
 */
export function stepStatusForTask(task, { retryScheduled = false } = {}) {
  if (!task) {
    return { status: 'failed', error: 'The task for this step no longer exists.' };
  }
  switch (task.status) {
    case 'complete':
      return { status: 'complete', error: null };
    case 'running':
      return { status: 'running', error: null };
    case 'queued':
      return { status: 'queued', error: null };
    case 'cancelled':
      return { status: 'cancelled', error: task.error || 'This step was cancelled.' };
    case 'failed':
    case 'interrupted':
      return retryScheduled
        ? { status: 'retrying', error: null }
        : { status: 'failed', error: task.error || 'This step failed.' };
    default:
      return { status: 'queued', error: null };
  }
}

/**
 * Recompute `blocked` from scratch across the whole step list.
 *
 * Blocked is derived, never latched: a step is blocked exactly while it has no task yet
 * and some dependency is currently failed, cancelled, or itself blocked. That is what lets
 * an ordinary task retry un-block a subtree with no extra bookkeeping. Propagation runs to
 * a fixpoint rather than in list order, because a valid dependency may point at a later
 * position.
 */
export function applyBlockedSteps(steps) {
  const byProposal = new Map(steps.map((step) => [step.proposalId, step]));
  for (let pass = 0; pass <= steps.length; pass += 1) {
    let changed = false;
    for (const step of steps) {
      if (step.taskId != null) continue;
      if (step.status !== 'waiting' && step.status !== 'blocked') continue;
      const blocked = step.dependsOn.some((proposalId) => {
        const dependency = byProposal.get(proposalId);
        return dependency ? STEP_FAILED.has(dependency.status) : false;
      });
      const next = blocked ? 'blocked' : 'waiting';
      if (next !== step.status) {
        step.status = next;
        changed = true;
      }
    }
    if (!changed) break;
  }
  return steps;
}

/** Steps whose dependencies have all completed and that have never been enqueued. */
export function readySteps(steps) {
  const byProposal = new Map(steps.map((step) => [step.proposalId, step]));
  return steps.filter((step) => step.status === 'waiting'
    && step.taskId == null
    && step.dependsOn.every((proposalId) => {
      const dependency = byProposal.get(proposalId);
      // A dependency outside this run cannot gate it; selection already pruned those.
      return !dependency || dependency.status === 'complete';
    }));
}

export function stepCounts(steps) {
  const counts = { total: steps.length };
  for (const status of STEP_STATUSES) counts[status] = 0;
  for (const step of steps) {
    if (counts[step.status] === undefined) counts[step.status] = 0;
    counts[step.status] += 1;
  }
  return counts;
}

/**
 * Derive a run status from its steps. `stopped` is the one latched status: it records user
 * intent, so it never derives back into running, complete, or failed. Everything else is
 * recomputed every pass, which is what lets a retried step move a `failed` run back to
 * `running`.
 */
export function runStatusFromSteps(steps, currentStatus = 'running') {
  if (currentStatus === 'stopped') return 'stopped';
  if (steps.length === 0) return 'complete';
  if (steps.some((step) => STEP_IN_FLIGHT.has(step.status) || step.status === 'waiting')) return 'running';
  if (steps.every((step) => step.status === 'complete')) return 'complete';
  return 'failed';
}

/**
 * The plan run engine.
 *
 * It is a reconciler, not a runner. It owns no processes and no scheduling: a step whose
 * dependencies are complete is enqueued as an ordinary `mode: 'execute'` task through the
 * same `queue.enqueue` path the composer uses, and everything after that (dispatch, idle
 * routing, automatic retry, cancellation, artifacts, Task Activity) is the queue's job.
 * Every pass recomputes the whole run from database state, so re-entry, a missed event, and
 * a restart all converge on the same answer.
 */
export class PlanRunCoordinator {
  constructor({ database, queue, diagnostic = () => {} }) {
    this.database = database;
    this.queue = queue;
    this.diagnostic = diagnostic;
    // `queue.enqueue` emits `changed` synchronously, which re-enters this reconciler
    // through the server's queue listener while the enqueue loop is still running. The
    // deterministic submission id already makes that harmless, but re-entry would still
    // duplicate work and confuse the run-status write, so one pass per run at a time.
    this.reconciling = new Set();
  }

  /**
   * The reason a new run cannot start right now, or null.
   *
   * Deliberately synchronous and re-checked inside `start()` rather than only in the route.
   * The route validates, then awaits the request body, the live session, and the model list;
   * two overlapping submissions can both clear those route-level checks before either one
   * writes anything. Since the guard sits next to the write it protects, the invariant
   * defends itself no matter how the route is called.
   */
  startConflict(planId) {
    const run = this.database.latestPlanRun(planId);
    if (run && run.status === 'running') {
      return 'This plan already has a run in progress. Stop it before starting another.';
    }
    const inFlight = this.stepsInFlight(planId);
    if (inFlight.length > 0) {
      return `The previous run still has ${inFlight.length} step${inFlight.length === 1 ? '' : 's'} in flight. Cancel ${inFlight.length === 1 ? 'it' : 'them'} or wait before starting a new run.`;
    }
    return null;
  }

  /**
   * Start a run over the selected proposals. Any earlier run of this plan that is not
   * complete is latched to `stopped` first, which preserves the invariant that at most one
   * run per plan is non-terminal even though `failed` is a derived status that can swing
   * back to `running` when the user retries a step.
   *
   * Throws a 409-carrying error when a run is already live or the previous run still has
   * steps in flight. Latching happens only after that check passes, so a refused start
   * leaves the existing run exactly as it was.
   */
  start({
    plan,
    breakdown = null,
    proposals,
    thread,
    sessionId = thread.id,
    provider,
    preferIdleTerminal = false,
    terminalLifecycle = 'persistent',
    keepTerminalOpen = false,
    terminalLayout = null,
    model = null,
    effort = null,
  }) {
    const conflict = this.startConflict(plan.id);
    if (conflict) {
      throw Object.assign(new Error(conflict), { statusCode: 409 });
    }
    for (const previous of this.database.planRunsForPlan(plan.id)) {
      if (previous.status !== 'complete') {
        this.database.updatePlanRun(previous.id, { status: 'stopped', finished_at: previous.finished_at || null });
      }
    }
    const run = this.database.createPlanRun({
      planId: plan.id,
      breakdownId: breakdown?.id ?? null,
      provider,
      sessionId,
      sessionLabel: thread.title || thread.id,
      sessionSource: thread.source || null,
      preferIdleTerminal,
      terminalLifecycle,
      keepTerminalOpen,
      terminalLayout,
      model,
      effort,
      status: 'running',
    });
    const selected = new Set(proposals.map((proposal) => proposal.id));
    proposals.forEach((proposal, index) => {
      this.database.createPlanRunStep({
        runId: run.id,
        proposalId: proposal.id,
        position: index + 1,
        title: proposal.title,
        prompt: proposal.prompt,
        // A dependency on a proposal the user did not select cannot gate this run.
        dependsOn: (proposal.dependsOn || []).filter((id) => id !== proposal.id && selected.has(id)),
      });
    });
    this.diagnostic('plan.run.started', {
      planId: plan.id,
      runId: run.id,
      steps: proposals.length,
      provider,
      threadId: thread.id,
      preferIdleTerminal,
      repoPath: plan.repo_path,
    });
    this.reconcile(run.id);
    return this.database.getPlanRun(run.id);
  }

  /**
   * Stop enqueuing further steps. Tasks that are already queued or running are left alone;
   * they remain individually cancellable through the ordinary task cancel. Idempotent: a
   * second stop on an already stopped run is a no-op, so a double click can never surface
   * a spurious error.
   */
  stop(planId) {
    const run = this.database.latestPlanRun(planId);
    if (!run) return null;
    if (run.status === 'stopped') return run;
    if (run.status !== 'running') return null;
    const stopped = this.database.updatePlanRun(run.id, { status: 'stopped', finished_at: now() });
    this.diagnostic('plan.run.stopped', { planId, runId: run.id });
    return stopped;
  }

  /**
   * Steps of the plan's latest run that still own live queue work.
   *
   * Starting a second run would mint new tasks for the same prompts, because the
   * deterministic submission id is keyed on the run id and so cannot collapse them. Stop
   * deliberately leaves in-flight tasks alone, so this is the check that stops the
   * stop-then-run-again path from executing a step twice.
   */
  stepsInFlight(planId) {
    const run = this.database.latestPlanRun(planId);
    if (!run) return [];
    const pendingRetries = this.queue.pendingRetryTaskIds();
    // Read the live task rather than the persisted step status. This has to be correct
    // without a preceding reconcile pass, because it guards a write.
    return this.database.planRunSteps(run.id).filter((step) => {
      if (step.task_id == null) return false;
      const task = this.database.getTask(step.task_id);
      const { status } = stepStatusForTask(task, { retryScheduled: pendingRetries.has(step.task_id) });
      return STEP_IN_FLIGHT.has(status);
    });
  }

  /** Best-effort cleanup when a plan is deleted: stop its runs and cancel queued steps. */
  release(planId) {
    for (const run of this.database.planRunsForPlan(planId)) {
      if (run.status === 'running') {
        this.database.updatePlanRun(run.id, { status: 'stopped' });
      }
      for (const step of this.database.planRunSteps(run.id)) {
        if (step.task_id == null) continue;
        const task = this.database.getTask(step.task_id);
        if (task?.status !== 'queued') continue;
        try { this.queue.cancel(step.task_id); } catch {}
      }
    }
  }

  reconcileForTask(taskId) {
    const step = this.database.planRunStepForTask(taskId);
    if (!step) return false;
    return this.reconcile(step.run_id);
  }

  /**
   * Repair every run that still holds unsettled steps. Used after a restart.
   *
   * Deliberately wider than `status = 'running'`: a stopped or failed run can still own
   * steps that were queued or running when CC Relay died, and their rows would otherwise stay
   * stale forever because no queue event will ever arrive for a task that no longer runs.
   */
  reconcileAll() {
    let changed = false;
    for (const run of this.database.unsettledPlanRuns()) {
      if (this.reconcile(run.id)) changed = true;
    }
    return changed;
  }

  needsReconcile(run) {
    if (!run) return false;
    if (isRunActive(run.status)) return true;
    return this.database.planRunSteps(run.id)
      .some((step) => STEP_IN_FLIGHT.has(step.status) || step.status === 'waiting');
  }

  reconcilePlan(planId) {
    const run = this.database.latestPlanRun(planId);
    if (!this.needsReconcile(run)) return false;
    return this.reconcile(run.id);
  }

  reconcile(runId) {
    if (this.reconciling.has(runId)) return false;
    this.reconciling.add(runId);
    try {
      return this.reconcileOnce(runId);
    } finally {
      this.reconciling.delete(runId);
    }
  }

  reconcileOnce(runId) {
    const run = this.database.getPlanRun(runId);
    if (!run) return false;
    const rows = this.database.planRunSteps(runId);
    if (rows.length === 0) return false;
    const pendingRetries = this.queue.pendingRetryTaskIds();
    let changed = false;

    const steps = rows.map((row) => {
      const step = {
        rowId: row.id,
        proposalId: row.proposal_id,
        position: row.position,
        title: row.title,
        prompt: row.prompt,
        dependsOn: row.dependsOn,
        taskId: row.task_id,
        status: row.status,
        error: row.error,
      };
      if (row.task_id != null) {
        const task = this.database.getTask(row.task_id);
        const resolved = stepStatusForTask(task, { retryScheduled: pendingRetries.has(row.task_id) });
        step.status = resolved.status;
        step.error = resolved.error;
      } else if (step.status !== 'waiting' && step.status !== 'blocked') {
        // A step with no task can only be waiting or blocked.
        step.status = 'waiting';
      }
      return step;
    });

    applyBlockedSteps(steps);
    for (const step of steps) {
      const blockedMessage = step.status === 'blocked'
        ? 'A step this one depends on did not finish.'
        : null;
      if (step.status === 'blocked') step.error = blockedMessage;
      if (step.status === 'waiting') step.error = null;
      const row = rows.find((candidate) => candidate.id === step.rowId);
      if (row.status !== step.status || (row.error || null) !== (step.error || null)) {
        this.database.updatePlanRunStep(step.rowId, { status: step.status, error: step.error || null });
        changed = true;
      }
    }

    let runError = run.error;
    if (isRunActive(run.status)) {
      for (const step of readySteps(steps)) {
        const outcome = this.enqueueStep(run, step);
        if (outcome.task) {
          // Read the status back off the task instead of assuming `queued`. A freshly
          // enqueued task is queued, but an adopted orphan can already be running or even
          // finished, and writing `queued` there would misreport it until the next pass.
          const resolved = stepStatusForTask(outcome.task, {
            retryScheduled: pendingRetries.has(outcome.task.id),
          });
          step.taskId = outcome.task.id;
          step.status = resolved.status;
          step.error = resolved.error;
          this.database.updatePlanRunStep(step.rowId, {
            task_id: outcome.task.id,
            status: resolved.status,
            error: resolved.error || null,
          });
          runError = null;
          changed = true;
        } else {
          // A transient enqueue refusal (a terminal closing, CC Relay stopping) must not fail
          // the step: it stays waiting and the next reconcile pass tries again.
          runError = outcome.error;
          changed = changed || (run.error || null) !== (outcome.error || null);
        }
      }
    }

    const nextStatus = runStatusFromSteps(steps, run.status);
    const runChanges = {};
    if (nextStatus !== run.status) {
      runChanges.status = nextStatus;
      if (nextStatus === 'complete' || nextStatus === 'failed') runChanges.finished_at = now();
      else if (nextStatus === 'running') runChanges.finished_at = null;
    }
    if ((runError || null) !== (run.error || null)) runChanges.error = runError || null;
    if (Object.keys(runChanges).length > 0) {
      this.database.updatePlanRun(run.id, runChanges);
      this.diagnostic('plan.run.reconciled', {
        planId: run.plan_id,
        runId: run.id,
        status: runChanges.status || run.status,
        counts: stepCounts(steps),
      });
      changed = true;
    }
    return changed;
  }

  enqueueStep(run, step) {
    const plan = this.database.getPlan(run.plan_id);
    if (!plan) return { task: null, error: 'The plan for this run no longer exists.' };
    const thread = {
      id: run.terminal_lifecycle === 'disposable' ? null : run.session_id,
      title: run.session_label || run.session_id,
      source: run.session_source || null,
      cwd: plan.repo_path,
    };
    const submissionId = planStepSubmissionId({
      planId: run.plan_id,
      runId: run.id,
      proposalId: step.proposalId,
    });
    // A task may already exist for this step when CC Relay died between the enqueue and the
    // task_id write. Adopt it rather than re-enqueuing, so the step is never announced twice.
    const claimed = this.database.getTaskBySubmissionId(submissionId);
    if (claimed) return { task: claimed, error: null };
    try {
      // The step snapshot, never the live proposal. The proposal can be edited mid-run,
      // and the queue's submission-id guard rejects a repeat submission whose prompt no
      // longer matches; reading the frozen snapshot keeps re-entry a pure no-op.
      const task = this.queue.enqueue({
        title: step.title,
        prompt: step.prompt,
        thread,
        provider: run.provider,
        mode: 'execute',
        model: run.model,
        effort: run.effort,
        preferIdleTerminal: run.prefer_idle_terminal,
        repoPath: plan.repo_path,
        terminalLifecycle: run.terminal_lifecycle,
        keepTerminalOpen: run.keep_terminal_open,
        terminalLayout: run.terminal_layout,
        submissionId,
      });
      this.database.addEvent(
        task.id,
        'queue',
        `Queued as step ${step.position} of the "${plan.name}" plan run.`,
      );
      this.diagnostic('plan.run.step.enqueued', {
        planId: run.plan_id,
        runId: run.id,
        proposalId: step.proposalId,
        taskId: task.id,
        position: step.position,
      });
      return { task, error: null };
    } catch (error) {
      this.diagnostic('plan.run.step.enqueue_failed', {
        planId: run.plan_id,
        runId: run.id,
        proposalId: step.proposalId,
        error: error.message,
      });
      return { task: null, error: error.message };
    }
  }

  /** Full run view for the API, including every step and the derived counts. */
  view(planId) {
    const run = this.database.latestPlanRun(planId);
    if (!run) return null;
    const steps = this.database.planRunSteps(run.id).map((row) => ({
      proposalId: row.proposal_id,
      title: row.title,
      position: row.position,
      dependsOn: row.dependsOn,
      taskId: row.task_id,
      status: row.status,
      error: row.error || null,
    }));
    return {
      id: run.id,
      planId: run.plan_id,
      breakdownId: run.breakdown_id,
      status: run.status,
      provider: run.provider,
      sessionId: run.session_id,
      sessionLabel: run.session_label,
      preferIdleTerminal: run.prefer_idle_terminal === true,
      terminalLifecycle: run.terminal_lifecycle,
      model: run.model,
      effort: run.effort,
      createdAt: run.created_at,
      updatedAt: run.updated_at,
      finishedAt: run.finished_at,
      error: run.error || null,
      counts: stepCounts(steps),
      steps,
    };
  }

  /** Light run summary for the plan list. */
  summary(planId) {
    const run = this.database.latestPlanRun(planId);
    if (!run) return null;
    const steps = this.database.planRunSteps(run.id).map((row) => ({ status: row.status }));
    return {
      id: run.id,
      status: run.status,
      counts: stepCounts(steps),
      updatedAt: run.updated_at,
    };
  }
}
