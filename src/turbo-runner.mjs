function plannerPrompt(task, workerCount) {
  return `You are the planning-only coordinator for a turbo implementation run. Do not edit files or execute the implementation.

Inspect the repository and produce a machine-readable execution graph for up to ${workerCount} concurrent Codex workers sharing the same working tree. Split work finely enough to keep the workers busy. Assign disjoint file ownership wherever possible, identify shared contracts up front, and express every ordering requirement through dependsOn. Every task must be independently actionable without asking questions.

Return only valid JSON with this exact shape and no Markdown fence:
{"version":1,"summary":"short coordination summary","sharedContext":"contracts and constraints every worker needs","tasks":[{"id":"stable-kebab-id","title":"task title","instructions":"complete scoped implementation instructions","dependsOn":["other-task-id"],"ownedPaths":["path or glob"],"verification":["command"]}]}

The tasks array must contain at least ${workerCount} items. All dependency IDs must exist. The graph must be acyclic. Create at least ${workerCount} root tasks when the work can safely begin in parallel; when it cannot, encode the real dependency rather than inventing unsafe concurrency.

Task:
${task.prompt}`;
}

export function parseTurboPlan(text, workerCount) {
  const source = String(text || '').trim();
  const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] || source;
  const start = fenced.indexOf('{');
  const end = fenced.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('The planner did not return a JSON execution plan.');
  let plan;
  try {
    plan = JSON.parse(fenced.slice(start, end + 1));
  } catch (error) {
    throw new Error(`The planner returned invalid JSON: ${error.message}`);
  }
  if (!Array.isArray(plan.tasks) || plan.tasks.length < workerCount) {
    throw new Error(`The planner must return at least ${workerCount} executable tasks.`);
  }
  const ids = new Set();
  for (const [index, item] of plan.tasks.entries()) {
    if (!item || typeof item.id !== 'string' || !item.id.trim() || typeof item.title !== 'string' || typeof item.instructions !== 'string') {
      throw new Error(`Planner task ${index + 1} is incomplete.`);
    }
    if (ids.has(item.id)) throw new Error(`Planner task ID is duplicated: ${item.id}.`);
    ids.add(item.id);
    item.dependsOn = Array.isArray(item.dependsOn) ? item.dependsOn : [];
  }
  for (const item of plan.tasks) {
    for (const dependency of item.dependsOn) {
      if (!ids.has(dependency)) throw new Error(`Planner task ${item.id} has unknown dependency ${dependency}.`);
      if (dependency === item.id) throw new Error(`Planner task ${item.id} depends on itself.`);
    }
  }
  const remaining = new Map(plan.tasks.map((item) => [item.id, new Set(item.dependsOn)]));
  const resolved = new Set();
  while (remaining.size > 0) {
    const ready = [...remaining.values()].filter((dependencies) => [...dependencies].every((id) => resolved.has(id)));
    if (ready.length === 0) throw new Error('The planner returned a cyclic dependency graph.');
    for (const [id, dependencies] of [...remaining]) {
      if ([...dependencies].every((dependency) => resolved.has(dependency))) {
        remaining.delete(id);
        resolved.add(id);
      }
    }
  }
  return plan;
}

function workerPrompt(task, plan, workPackage, index, workerCount, completedDependencies) {
  const paths = Array.isArray(workPackage.ownedPaths) ? workPackage.ownedPaths.join(', ') : 'Use the package scope';
  const verification = Array.isArray(workPackage.verification) ? workPackage.verification.map((item) => `- ${item}`).join('\n') : '- Run relevant checks';
  return `You are worker ${index + 1} of ${workerCount} in a coordinated turbo implementation. Work directly in the current repository and complete only your assigned package. Other workers are editing the same working tree concurrently. Respect file ownership, do not undo unrelated changes, and do not wait for or message the other workers.

Original task:
${task.prompt}

Shared plan context:
${plan.sharedContext || plan.summary || 'Follow the assigned package and preserve compatibility.'}

Your package: ${workPackage.title}
${workPackage.instructions}

Completed prerequisites:
${completedDependencies.length ? completedDependencies.map((item) => `- ${item}`).join('\n') : '- None; this is a root task.'}

Owned paths:
${paths}

Verification:
${verification}

Implement the package, run its verification, and return a concise result including files changed, checks run, and any integration concern.`;
}

export class TurboRunner {
  constructor({ codex, artifacts = null }) {
    this.codex = codex;
    this.artifacts = artifacts;
    this.activeTaskIds = new Set();
  }

  async run(task, { onEvent, onStderr }) {
    const turbo = task.turbo || {};
    const workers = Array.isArray(turbo.workers) ? turbo.workers : [];
    if (workers.length < 1) throw new Error('Turbo mode needs at least one worker terminal.');

    const plannerTaskId = `${task.id}:planner`;
    this.activeTaskIds.add(plannerTaskId);
    onEvent({
      event: { type: 'turbo/stage', provider: 'plan', phase: 'planner', status: 'running' },
      message: `Planner is designing a dependency graph for ${workers.length} worker terminals.`,
    });
    let plannerResult;
    try {
      plannerResult = await this.codex.run({
        ...task,
        id: plannerTaskId,
        prompt: plannerPrompt(task, workers.length),
        thread_id: turbo.plannerThreadId || task.thread_id,
        model: turbo.plannerModel,
        effort: turbo.plannerEffort,
        read_only: true,
      }, {
        onEvent: ({ event, message }) => onEvent({ event: { ...event, phase: 'planner' }, message }),
        onStderr,
      });
    } finally {
      this.activeTaskIds.delete(plannerTaskId);
    }

    const plan = parseTurboPlan(plannerResult.finalResponse, workers.length);
    plan.status = 'executing';
    plan.planner = { threadId: turbo.plannerThreadId, model: turbo.plannerModel, effort: turbo.plannerEffort };
    plan.workers = workers;
    plan.tasks = plan.tasks.map((item) => ({ ...item, status: 'pending', worker: null, result: null }));
    this.artifacts?.writeTurboPlan(task.id, plan);
    onEvent({
      event: { type: 'turbo/stage', provider: 'plan', phase: 'workers', status: 'running', plan },
      message: `Planner completed ${plan.tasks.length} tasks. Relay is dispatching dependency-ready work across ${workers.length} terminals.`,
    });

    const pending = new Map(plan.tasks.map((item) => [item.id, item]));
    const completed = new Map();
    const availableWorkers = workers.map((worker, index) => ({ ...worker, index }));
    const active = new Map();
    const outcomes = [];

    const startWork = (worker, workPackage) => {
      const workerTaskId = `${task.id}:worker:${worker.index + 1}:${workPackage.id}`;
      this.activeTaskIds.add(workerTaskId);
      pending.delete(workPackage.id);
      workPackage.status = 'running';
      workPackage.worker = worker.index + 1;
      this.artifacts?.writeTurboPlan(task.id, plan);
      onEvent({
        event: { type: 'turbo/dispatch', provider: 'plan', phase: `worker-${worker.index + 1}`, worker: worker.index + 1, taskId: workPackage.id },
        message: `Dispatched ${workPackage.id} to worker ${worker.index + 1}.`,
      });
      const promise = this.codex.run({
        ...task,
        id: workerTaskId,
        prompt: workerPrompt(task, plan, workPackage, worker.index, workers.length, workPackage.dependsOn),
        thread_id: worker.threadId,
        thread_name: worker.title,
        model: turbo.workerModel,
        effort: turbo.workerEffort,
        read_only: false,
      }, {
        onEvent: ({ event, message }) => onEvent({
          event: { ...event, phase: `worker-${worker.index + 1}`, worker: worker.index + 1, graphTaskId: workPackage.id },
          message: `Worker ${worker.index + 1} [${workPackage.id}]: ${message}`,
        }),
        onStderr: (line) => onStderr(`Worker ${worker.index + 1} [${workPackage.id}]: ${line}`),
      }).then((result) => ({ worker, workPackage, result })).finally(() => this.activeTaskIds.delete(workerTaskId));
      active.set(worker.index, promise);
    };

    try {
    while (pending.size > 0 || active.size > 0) {
      let dispatched = false;
      for (const worker of [...availableWorkers]) {
        const ready = [...pending.values()].find((item) => item.dependsOn.every((id) => completed.has(id)));
        if (!ready) break;
        availableWorkers.splice(availableWorkers.indexOf(worker), 1);
        startWork(worker, ready);
        dispatched = true;
      }
      if (active.size === 0) {
        if (pending.size > 0) throw new Error('Turbo execution graph cannot make progress.');
        break;
      }
      if (!dispatched || availableWorkers.length === 0 || ![...pending.values()].some((item) => item.dependsOn.every((id) => completed.has(id)))) {
        const outcome = await Promise.race(active.values());
        active.delete(outcome.worker.index);
        availableWorkers.push(outcome.worker);
        completed.set(outcome.workPackage.id, outcome.result.finalResponse || 'Completed without a text response.');
        outcome.workPackage.status = 'complete';
        outcome.workPackage.result = outcome.result.finalResponse || '';
        this.artifacts?.writeTurboPlan(task.id, plan);
        outcomes.push({ worker: outcome.worker.index + 1, id: outcome.workPackage.id, title: outcome.workPackage.title, result: outcome.result.finalResponse });
        onEvent({
          event: { type: 'turbo/taskCompleted', provider: 'plan', phase: `worker-${outcome.worker.index + 1}`, worker: outcome.worker.index + 1, taskId: outcome.workPackage.id },
          message: `Worker ${outcome.worker.index + 1} completed ${outcome.workPackage.id}.`,
        });
      }
    }
    } catch (error) {
      this.cancel();
      await Promise.allSettled(active.values());
      plan.status = 'failed';
      plan.error = error.message;
      this.artifacts?.writeTurboPlan(task.id, plan);
      throw error;
    }

    onEvent({
      event: { type: 'turbo/stage', provider: 'plan', phase: 'complete', status: 'complete' },
      message: `All ${plan.tasks.length} turbo graph tasks completed across ${workers.length} terminals.`,
    });
    plan.status = 'complete';
    this.artifacts?.writeTurboPlan(task.id, plan);
    return {
      finalResponse: [`# Turbo execution complete`, '', plan.summary || '', '', ...outcomes.map(
        (outcome) => `## ${outcome.id}: ${outcome.title} (worker ${outcome.worker})\n\n${outcome.result || 'Completed without a text response.'}`,
      )].join('\n'),
      sessionId: task.thread_id,
      exitCode: 0,
    };
  }

  cancel() {
    let cancelled = false;
    for (const taskId of this.activeTaskIds) cancelled = this.codex.cancel(taskId) || cancelled;
    return cancelled;
  }
}
