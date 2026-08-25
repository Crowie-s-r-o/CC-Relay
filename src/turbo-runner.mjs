function plannerPrompt(task, executionCount = 1) {
  const singleExecutor = executionCount === 1;
  const executionContract = singleExecutor
    ? 'one fresh Codex execution session. That executor owns the complete objective and may use internal sub-agents when useful, but CC Relay will not split this prompt across native terminals'
    : `${executionCount} Codex worker terminals. Split work into independently runnable packages for those workers`;
  const taskRequirement = singleExecutor
    ? 'The tasks array must contain at least one complete implementation step.'
    : `The tasks array must contain at least ${executionCount} complete implementation tasks.`;
  return `You are the planning-only coordinator for a turbo implementation run. Do not edit files or execute the implementation.

Inspect the repository and produce a machine-readable execution graph for ${executionContract}. Identify shared contracts up front, express ordering through dependsOn, and make every step independently actionable without asking questions.

Return only valid JSON with this exact shape and no Markdown fence:
{"version":1,"summary":"short coordination summary","sharedContext":"contracts and constraints the executor needs","tasks":[{"id":"stable-kebab-id","title":"task title","instructions":"complete scoped implementation instructions","dependsOn":["other-task-id"],"ownedPaths":["path or glob"],"verification":["command"]}]}

${taskRequirement} All dependency IDs must exist and the graph must be acyclic.${singleExecutor ? ' Mark work that can be delegated safely, but keep integration ownership with the single execution session.' : ''}

Task:
${task.prompt}`;
}

function codexReviewPrompt(task, draftPlan, executionCount = 1) {
  const executionStart = executionCount === 1 ? 'the executor starts' : 'workers start';
  const executionContract = executionCount === 1
    ? 'One execution session will own the complete graph and may delegate internally to sub-agents.'
    : `${executionCount} worker terminals will execute the graph, so it needs at least ${executionCount} independently actionable tasks.`;
  return `You are the Codex reviewer in a two-step Forward-planning Turbo council. Claude already produced the initial JSON graph. Inspect the repository independently, then correct the graph before ${executionStart}. Do not edit files or execute the implementation. Work in read-only mode.

Return only the complete corrected JSON object with the same version-1 schema. Preserve useful work, but fix missing dependencies, unsafe ownership overlap, incomplete verification, and coordination gaps. ${executionContract}

Original task:
${task.prompt}

Claude draft JSON:
${JSON.stringify(draftPlan, null, 2)}`;
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

function completePlanExecutionPrompt(task, plan) {
  const executionTasks = plan.tasks.map((item) => ({
    id: item.id,
    title: item.title,
    instructions: item.instructions,
    dependsOn: item.dependsOn,
    ownedPaths: item.ownedPaths,
    verification: item.verification,
  }));
  return `You are the sole execution coordinator for a Forward-planning Turbo task. Work directly in the current repository and own the complete implementation through final verification. CC Relay has intentionally assigned this plan to one fresh terminal session. Do not wait for or coordinate with other native terminals.

Use internal sub-agents when they materially help, especially for independent research, implementation, or review, but remain responsible for integration, resolving overlaps, running the complete verification, and one extra final verification pass.

Original task:
${task.prompt}

Planner summary:
${plan.summary || 'Complete the original objective according to the plan.'}

Shared context:
${plan.sharedContext || 'Preserve compatibility and verify the complete outcome.'}

Machine-readable execution plan:
${JSON.stringify({ version: plan.version || 1, tasks: executionTasks }, null, 2)}

Execute the entire plan, fix any issue found in the final verification pass, and return a concise result with files changed, checks run, and remaining concerns.`;
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
  constructor({ codex, artifacts = null, councilReviewer = null, terminalPool = null }) {
    this.codex = codex;
    this.artifacts = artifacts;
    this.councilReviewer = councilReviewer;
    this.terminalPool = terminalPool;
    this.activeChildren = new Map();
    this.preparations = new Map();
    this.councilParents = new Set();
    this.cancelledParents = new Set();
  }

  setTerminalPool(terminalPool) {
    this.terminalPool = terminalPool;
  }

  usesJustInTimeTerminals(task) {
    return Boolean(this.terminalPool?.supportsTurboStages?.(task));
  }

  workersFor(task) {
    const turbo = task?.turbo || {};
    if (!this.usesJustInTimeTerminals(task)) {
      return Array.isArray(turbo.workers) ? turbo.workers : [];
    }
    return [{
      slot: 1,
      threadId: null,
      title: 'Fresh execution session',
    }];
  }

  isCancelled(parentTaskId) {
    return this.cancelledParents.has(String(parentTaskId));
  }

  councilConfig(task) {
    const source = task?.turbo?.council || {};
    const enabled = source.enabled === true || task?.turbo?.councilEnabled === true;
    const order = Array.isArray(source.order) && source.order.length === 2
      ? [...source.order]
      : ['codex', 'claude'];
    const authorProvider = source.authorProvider || order[0];
    const reviewerProvider = source.reviewerProvider || order[1];
    const codexModel = authorProvider === 'codex' ? source.authorModel : source.reviewerModel;
    const codexEffort = authorProvider === 'codex' ? source.authorEffort : source.reviewerEffort;
    const claudeModel = authorProvider === 'claude' ? source.authorModel : source.reviewerModel;
    const claudeEffort = authorProvider === 'claude' ? source.authorEffort : source.reviewerEffort;
    return {
      enabled,
      order,
      authorProvider,
      authorModel: source.authorModel || (authorProvider === 'codex' ? task?.turbo?.plannerModel : task?.turbo?.councilReviewerModel) || null,
      authorEffort: source.authorEffort || (authorProvider === 'codex' ? task?.turbo?.plannerEffort : task?.turbo?.councilReviewerEffort) || null,
      reviewerProvider,
      reviewerModel: source.reviewerModel || (reviewerProvider === 'codex' ? task?.turbo?.plannerModel : task?.turbo?.councilReviewerModel) || null,
      reviewerEffort: source.reviewerEffort || (reviewerProvider === 'codex' ? task?.turbo?.plannerEffort : task?.turbo?.councilReviewerEffort) || null,
      codexModel: codexModel || task?.turbo?.plannerModel || null,
      codexEffort: codexEffort || task?.turbo?.plannerEffort || null,
      claudeModel: claudeModel || task?.turbo?.councilReviewerModel || null,
      claudeEffort: claudeEffort || task?.turbo?.councilReviewerEffort || null,
    };
  }

  councilMatches(plan, config) {
    if (!config.enabled) return !plan?.council?.enabled;
    return plan?.council?.enabled === true
      && plan.council.status === 'complete'
      && Array.isArray(plan.council.order)
      && plan.council.order.join(',') === config.order.join(',')
      && (plan.council.authorProvider || plan.council.order[0]) === config.authorProvider
      && (plan.council.authorModel || config.authorModel) === config.authorModel
      && (plan.council.authorEffort || config.authorEffort) === config.authorEffort
      && plan.council.reviewerProvider === config.reviewerProvider
      && plan.council.reviewerModel === config.reviewerModel
      && plan.council.reviewerEffort === config.reviewerEffort;
  }

  childrenFor(parentTaskId) {
    if (!this.activeChildren.has(parentTaskId)) this.activeChildren.set(parentTaskId, new Set());
    return this.activeChildren.get(parentTaskId);
  }

  trackChild(parentTaskId, childTaskId) {
    this.childrenFor(parentTaskId).add(childTaskId);
  }

  untrackChild(parentTaskId, childTaskId) {
    const children = this.activeChildren.get(parentTaskId);
    if (!children) return;
    children.delete(childTaskId);
    if (children.size === 0) this.activeChildren.delete(parentTaskId);
  }

  readyPlan(task) {
    const council = this.councilConfig(task);
    const workers = this.workersFor(task);
    const justInTime = this.usesJustInTimeTerminals(task);
    let plan;
    try {
      plan = this.artifacts?.readTurboPlan(task.id);
    } catch {
      return null;
    }
    if (!plan || plan.status !== 'ready' || !Array.isArray(plan.tasks) || plan.tasks.length < workers.length) return null;
    if (!this.councilMatches(plan, council)) return null;
    if (!Array.isArray(plan.workers) || plan.workers.length !== workers.length) return null;
    if (!justInTime
      && workers.some((worker, index) => plan.workers[index]?.threadId !== worker.threadId)) return null;
    try {
      const validated = parseTurboPlan(JSON.stringify(plan), workers.length);
      if (validated.tasks.some((item) => item.status && item.status !== 'pending')) return null;
      return {
        ...plan,
        workers: justInTime ? workers : plan.workers,
        tasks: validated.tasks.map((item) => ({
          ...item,
          status: 'pending',
          worker: null,
          workerThreadId: null,
          workerTitle: null,
          result: null,
          error: null,
        })),
      };
    } catch {
      return null;
    }
  }

  async prepare(task, { onEvent = () => {}, onStderr = () => {} } = {}) {
    const workers = this.workersFor(task);
    if (workers.length < 1) throw new Error('Turbo mode needs at least one execution target.');
    const existing = this.readyPlan(task);
    if (existing) return existing;
    if (this.preparations.has(task.id)) return this.preparations.get(task.id);

    const preparation = this.prepareNow(task, workers, { onEvent, onStderr });
    this.preparations.set(task.id, preparation);
    preparation.then(() => {
      if (this.preparations.get(task.id) === preparation) this.preparations.delete(task.id);
      this.cancelledParents.delete(String(task.id));
    }, () => {
      if (this.preparations.get(task.id) === preparation) this.preparations.delete(task.id);
      this.cancelledParents.delete(String(task.id));
    });
    return preparation;
  }

  async prepareNow(task, workers, { onEvent, onStderr }) {
    const turbo = task.turbo || {};
    const council = this.councilConfig(task);
    const justInTime = this.usesJustInTimeTerminals(task);
    const plannerTaskId = `${task.id}:planner`;
    const shell = {
      version: 1,
      status: 'planning',
      summary: '',
      sharedContext: '',
      planner: {
        threadId: turbo.plannerThreadId || task.thread_id,
        title: turbo.plannerThreadName || task.thread_name || null,
        model: turbo.plannerModel,
        effort: turbo.plannerEffort,
      },
      workers,
      tasks: [],
    };
    if (council.enabled) {
      shell.council = {
        enabled: true,
        order: council.order,
        authorProvider: council.authorProvider,
        authorModel: council.authorModel,
        authorEffort: council.authorEffort,
        reviewerProvider: council.reviewerProvider,
        reviewerModel: council.reviewerModel,
        reviewerEffort: council.reviewerEffort,
        status: 'pending',
      };
    }
    this.artifacts?.writeTurboPlan(task.id, shell);
    let currentPlan = shell;
    const attachmentPaths = (task.attachments || [])
      .map((attachment) => typeof attachment === 'string' ? attachment : attachment?.path)
      .filter(Boolean);
    const decoratePlan = (plan, status) => ({
      ...plan,
      status,
      planner: shell.planner,
      workers,
      tasks: plan.tasks.map((item) => ({
        ...item,
        status: 'pending',
        worker: null,
        workerThreadId: null,
        workerTitle: null,
        result: null,
        error: null,
      })),
    });
    const runCodexStage = async (prompt, message) => {
      this.trackChild(task.id, plannerTaskId);
      let allocation = null;
      try {
        if (justInTime) {
          allocation = await this.terminalPool.launchTurboStage(task, {
            provider: 'codex',
            role: 'planner',
            model: council.codexModel || turbo.plannerModel,
            effort: council.codexEffort || turbo.plannerEffort,
            resumeThreadId: turbo.plannerThreadId || task.thread_id || null,
            isCancelled: () => this.isCancelled(task.id),
          });
          shell.planner = {
            ...shell.planner,
            threadId: allocation.threadId,
            title: allocation.thread.title || 'Turbo planner',
          };
          currentPlan = { ...currentPlan, planner: shell.planner };
          this.artifacts?.writeTurboPlan(task.id, currentPlan);
        }
        const plannerThreadId = allocation?.threadId || turbo.plannerThreadId || task.thread_id;
        const plannerTitle = allocation?.thread?.title || turbo.plannerThreadName || task.thread_name;
        onEvent({
          event: {
            type: 'turbo/stage',
            provider: 'codex',
            phase: 'planner',
            status: 'running',
            threadId: plannerThreadId,
            threadTitle: plannerTitle || null,
          },
          message,
        });
        return await this.codex.run({
          ...task,
          id: plannerTaskId,
          prompt,
          thread_id: plannerThreadId,
          thread_name: plannerTitle,
          model: council.codexModel || turbo.plannerModel,
          effort: council.codexEffort || turbo.plannerEffort,
          read_only: true,
        }, {
          onEvent: ({ event, message: eventMessage }) => onEvent({ event: { ...event, phase: 'planner' }, message: eventMessage }),
          onStderr,
        });
      } finally {
        this.untrackChild(task.id, plannerTaskId);
        if (allocation) {
          await this.terminalPool.finishTurboStage(task.id, allocation, { failOnError: true });
        }
      }
    };
    const runClaudeStage = async (stage, draftPlan = null) => {
      const method = stage === 'author' ? this.councilReviewer?.draft : this.councilReviewer?.review || this.councilReviewer?.run;
      if (typeof method !== 'function') {
        throw new Error(`Turbo Plan council is enabled but no Claude graph ${stage === 'author' ? 'author' : 'reviewer'} is configured.`);
      }
      const phase = stage === 'author' ? 'council-author' : 'council-review';
      const model = stage === 'author' ? council.authorModel : council.reviewerModel;
      const effort = stage === 'author' ? council.authorEffort : council.reviewerEffort;
      let allocation = null;
      this.councilParents.add(task.id);
      try {
        let councilTask = task;
        if (justInTime && task.turbo?.councilTerminalExecution !== false) {
          allocation = await this.terminalPool.launchTurboStage(task, {
            provider: 'claude',
            role: 'council',
            model,
            effort,
            resumeThreadId: turbo.councilThreadId || null,
            isCancelled: () => this.isCancelled(task.id),
          });
          councilTask = {
            ...task,
            turbo: {
              ...turbo,
              councilThreadId: allocation.threadId,
              councilThreadName: allocation.thread.title,
              councilThreadSource: allocation.thread.source,
            },
          };
        }
        return await method.call(this.councilReviewer, {
          parentTaskId: task.id,
          task: councilTask,
          draftPlan,
          workerCount: workers.length,
          claudeModel: model,
          claudeEffort: effort,
          attachmentPaths,
          onEvent: ({ event, message }) => onEvent({
            event: { ...event, provider: 'claude', phase },
            message,
          }),
          onStderr,
        });
      } finally {
        this.councilParents.delete(task.id);
        if (allocation) {
          await this.terminalPool.finishTurboStage(task.id, allocation, { failOnError: true });
        }
      }
    };

    try {
      if (!council.enabled) {
        const plannerResult = await runCodexStage(
          plannerPrompt(task, workers.length),
          'Planner is designing the complete graph for one execution session.',
        );
        currentPlan = decoratePlan(parseTurboPlan(plannerResult.finalResponse, workers.length), 'ready');
        this.artifacts?.writeTurboPlan(task.id, currentPlan);
        onEvent({
          event: { type: 'turbo/stage', provider: 'plan', phase: 'ready', status: 'ready', plan: currentPlan },
          message: `Plan ready: ${currentPlan.tasks.length} steps are waiting for one fresh execution session.`,
        });
        return currentPlan;
      }

      if (council.authorProvider === 'codex') {
        const authorResult = await runCodexStage(
          plannerPrompt(task, workers.length),
          'Codex is authoring the complete graph for one execution session.',
        );
        currentPlan = decoratePlan(parseTurboPlan(authorResult.finalResponse, workers.length), 'reviewing');
        currentPlan.council = {
          ...shell.council,
          status: 'reviewing',
          author: { status: 'complete', provider: 'codex', model: council.authorModel, effort: council.authorEffort, completedAt: new Date().toISOString() },
          codex: { status: 'complete', model: council.authorModel, effort: council.authorEffort, completedAt: new Date().toISOString() },
        };
        this.artifacts?.writeTurboPlan(task.id, currentPlan);
        onEvent({
          event: { type: 'turbo/stage', provider: 'codex', phase: 'planner', status: 'complete', plan: currentPlan },
          message: 'Codex graph draft complete; planner CC Relay released for the next queued plan.',
        });
        onEvent({
          event: { type: 'turbo/stage', provider: 'claude', phase: 'council-review', status: 'running', plan: currentPlan },
          message: 'Claude is reviewing the Codex graph before worker execution.',
        });
        const authoredCouncil = currentPlan.council;
        const reviewResult = await runClaudeStage('review', currentPlan);
        currentPlan = decoratePlan(parseTurboPlan(reviewResult?.text || reviewResult?.finalResponse, workers.length), 'ready');
        currentPlan.council = {
          ...shell.council,
          status: 'complete',
          author: authoredCouncil.author,
          codex: { status: 'complete', model: council.authorModel, effort: council.authorEffort },
          review: { status: 'complete', provider: 'claude', model: council.reviewerModel, effort: council.reviewerEffort, sessionId: reviewResult?.sessionId || null },
          reviewedAt: new Date().toISOString(),
        };
      } else {
        onEvent({
          event: { type: 'turbo/stage', provider: 'claude', phase: 'council-author', status: 'running', plan: shell },
          message: 'Claude is authoring the complete graph for one execution session.',
        });
        const authorResult = await runClaudeStage('author');
        const authoredPlan = decoratePlan(parseTurboPlan(authorResult?.text || authorResult?.finalResponse, workers.length), 'reviewing');
        authoredPlan.council = {
          ...shell.council,
          status: 'reviewing',
          author: { status: 'complete', provider: 'claude', model: council.authorModel, effort: council.authorEffort, sessionId: authorResult?.sessionId || null, completedAt: new Date().toISOString() },
        };
        currentPlan = authoredPlan;
        this.artifacts?.writeTurboPlan(task.id, currentPlan);
        onEvent({
          event: { type: 'turbo/stage', provider: 'claude', phase: 'council-author', status: 'complete', plan: currentPlan },
          message: 'Claude graph draft complete; Codex will perform the independent review.',
        });
        const reviewResult = await runCodexStage(
          codexReviewPrompt(task, currentPlan, workers.length),
          'Codex is reviewing the Claude graph before worker execution.',
        );
        currentPlan = decoratePlan(parseTurboPlan(reviewResult.finalResponse, workers.length), 'ready');
        currentPlan.council = {
          ...shell.council,
          status: 'complete',
          author: authoredPlan.council.author,
          review: { status: 'complete', provider: 'codex', model: council.reviewerModel, effort: council.reviewerEffort, completedAt: new Date().toISOString() },
          codex: { status: 'complete', model: council.reviewerModel, effort: council.reviewerEffort, completedAt: new Date().toISOString() },
          reviewedAt: new Date().toISOString(),
        };
        onEvent({
          event: { type: 'turbo/stage', provider: 'codex', phase: 'planner', status: 'complete', plan: currentPlan },
          message: 'Codex graph review complete; planner CC Relay released.',
        });
      }

      this.artifacts?.writeTurboPlan(task.id, currentPlan);
      onEvent({
        event: { type: 'turbo/stage', provider: 'plan', phase: 'ready', status: 'ready', plan: currentPlan },
        message: `Plan ready after ${council.reviewerProvider === 'claude' ? 'Claude' : 'Codex'} review: ${currentPlan.tasks.length} steps are waiting for one fresh execution session.`,
      });
      return currentPlan;
    } catch (error) {
      currentPlan.status = 'failed';
      currentPlan.error = String(error?.message || error || 'Turbo planning failed').slice(0, 500);
      if (council.enabled) {
        currentPlan.council = {
          ...(currentPlan.council || shell.council),
          status: 'failed',
          error: currentPlan.error,
        };
      }
      this.artifacts?.writeTurboPlan(task.id, currentPlan);
      throw error;
    } finally {
      this.untrackChild(task.id, plannerTaskId);
    }
  }

  async runSingleExecutor(task, plan, { onEvent, onStderr }) {
    const turbo = task.turbo || {};
    const executionTaskId = `${task.id}:execution`;
    let allocation = null;
    this.trackChild(task.id, executionTaskId);
    try {
      plan.status = 'executing';
      this.artifacts?.writeTurboPlan(task.id, plan);
      allocation = await this.terminalPool.launchTurboStage(task, {
        provider: 'codex',
        role: 'worker',
        packageId: 'execution',
        slot: 1,
        model: turbo.workerModel,
        effort: turbo.workerEffort,
        resumeThreadId: null,
        isCancelled: () => this.isCancelled(task.id),
      });
      const workerTitle = allocation.thread.title || 'Turbo execution session';
      plan.workers = [{
        slot: 1,
        threadId: allocation.threadId,
        title: workerTitle,
      }];
      plan.tasks = plan.tasks.map((item) => ({
        ...item,
        status: 'running',
        worker: 1,
        workerThreadId: allocation.threadId,
        workerTitle,
        result: null,
        error: null,
      }));
      this.artifacts?.writeTurboPlan(task.id, plan);
      onEvent({
        event: {
          type: 'turbo/dispatch',
          provider: 'plan',
          phase: 'execution',
          worker: 1,
          workerThreadId: allocation.threadId,
          workerTitle,
          taskId: 'execution',
        },
        message: 'The complete forward plan was dispatched to one fresh execution session.',
      });
      const result = await this.codex.run({
        ...task,
        id: executionTaskId,
        prompt: completePlanExecutionPrompt(task, plan),
        thread_id: allocation.threadId,
        thread_name: workerTitle,
        model: turbo.workerModel,
        effort: turbo.workerEffort,
        read_only: false,
      }, {
        onEvent: ({ event, message }) => onEvent({
          event: { ...event, phase: 'execution', worker: 1 },
          message: `Executor: ${message}`,
        }),
        onStderr: (line) => onStderr(`Executor: ${line}`),
      });
      const finalResponse = result.finalResponse || 'Completed without a text response.';
      plan.tasks = plan.tasks.map((item) => ({ ...item, status: 'complete', result: null, error: null }));
      plan.status = 'complete';
      plan.execution = {
        threadId: allocation.threadId,
        title: workerTitle,
        model: turbo.workerModel,
        effort: turbo.workerEffort,
        completedAt: new Date().toISOString(),
      };
      this.artifacts?.writeTurboPlan(task.id, plan);
      onEvent({
        event: {
          type: 'turbo/stage',
          provider: 'plan',
          phase: 'complete',
          status: 'complete',
          workerThreadId: allocation.threadId,
          workerTitle,
        },
        message: 'The single Turbo execution session completed the full forward plan.',
      });
      return {
        finalResponse,
        sessionId: result.sessionId || allocation.threadId,
        exitCode: result.exitCode ?? 0,
      };
    } catch (error) {
      const message = String(error?.message || error || 'Turbo execution failed').slice(0, 500);
      plan.tasks = plan.tasks.map((item) => (
        item.status === 'running' ? { ...item, status: 'failed', error: message } : item
      ));
      plan.status = 'failed';
      plan.error = message;
      this.artifacts?.writeTurboPlan(task.id, plan);
      throw error;
    } finally {
      this.untrackChild(task.id, executionTaskId);
      if (allocation) await this.terminalPool.finishTurboStage(task.id, allocation);
    }
  }

  async run(task, { onEvent = () => {}, onStderr = () => {} } = {}) {
    this.cancelledParents.delete(String(task.id));
    const turbo = task.turbo || {};
    const workers = this.workersFor(task);
    const justInTime = this.usesJustInTimeTerminals(task);
    if (workers.length < 1) throw new Error('Turbo mode needs at least one execution target.');

    const plan = this.readyPlan(task) || await this.prepare(task, { onEvent, onStderr });
    if (justInTime) {
      try {
        return await this.runSingleExecutor(task, plan, { onEvent, onStderr });
      } finally {
        this.cancelledParents.delete(String(task.id));
      }
    }
    plan.status = 'executing';
    this.artifacts?.writeTurboPlan(task.id, plan);
    onEvent({
      event: { type: 'turbo/stage', provider: 'plan', phase: 'workers', status: 'running', plan },
      message: `Plan is executing: dispatching dependency-ready work across ${workers.length} terminals.`,
    });

    const pending = new Map(plan.tasks.map((item) => [item.id, item]));
    const completed = new Map();
    const availableWorkers = workers.map((worker, index) => ({ ...worker, index }));
    const active = new Map();
    const outcomes = [];

    const startWork = (worker, workPackage) => {
      const workerTaskId = `${task.id}:worker:${worker.index + 1}:${workPackage.id}`;
      this.trackChild(task.id, workerTaskId);
      pending.delete(workPackage.id);
      workPackage.status = 'running';
      workPackage.worker = worker.index + 1;
      workPackage.workerThreadId = worker.threadId;
      workPackage.workerTitle = worker.title || null;
      workPackage.error = null;
      this.artifacts?.writeTurboPlan(task.id, plan);
      onEvent({
        event: {
          type: 'turbo/dispatch', provider: 'plan', phase: `worker-${worker.index + 1}`,
          worker: worker.index + 1, workerThreadId: worker.threadId, workerTitle: worker.title || null,
          taskId: workPackage.id,
        },
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
      }).then((result) => ({ worker, workPackage, result })).catch((error) => {
        const message = String(error?.message || error || 'Worker failed').slice(0, 500);
        workPackage.status = 'failed';
        workPackage.error = message;
        this.artifacts?.writeTurboPlan(task.id, plan);
        onEvent({
          event: {
            type: 'turbo/taskFailed', provider: 'plan', phase: `worker-${worker.index + 1}`,
            worker: worker.index + 1,
            workerThreadId: worker.threadId,
            workerTitle: worker.title || null,
            taskId: workPackage.id,
          },
          message: `Worker ${worker.index + 1} failed ${workPackage.id}: ${message}`,
        });
        throw error;
      }).finally(() => this.untrackChild(task.id, workerTaskId));
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
        outcomes.push({
          worker: outcome.worker.index + 1,
          workerThreadId: outcome.worker.threadId,
          workerTitle: outcome.worker.title || null,
          id: outcome.workPackage.id,
          title: outcome.workPackage.title,
          result: outcome.result.finalResponse,
        });
        onEvent({
          event: {
            type: 'turbo/taskCompleted', provider: 'plan', phase: `worker-${outcome.worker.index + 1}`,
            worker: outcome.worker.index + 1, workerThreadId: outcome.worker.threadId,
            workerTitle: outcome.worker.title || null, taskId: outcome.workPackage.id,
          },
          message: `Worker ${outcome.worker.index + 1} completed ${outcome.workPackage.id}.`,
        });
      }
    }
    } catch (error) {
      this.cancel(task.id);
      await Promise.allSettled(active.values());
      plan.status = 'failed';
      plan.error = error.message;
      this.artifacts?.writeTurboPlan(task.id, plan);
      this.cancelledParents.delete(String(task.id));
      throw error;
    }

    onEvent({
      event: { type: 'turbo/stage', provider: 'plan', phase: 'complete', status: 'complete' },
      message: `All ${plan.tasks.length} turbo graph tasks completed across ${workers.length} terminals.`,
    });
    plan.status = 'complete';
    this.artifacts?.writeTurboPlan(task.id, plan);
    this.cancelledParents.delete(String(task.id));
    return {
      finalResponse: [`# Turbo execution complete`, '', plan.summary || '', '', ...outcomes.map(
        (outcome) => `## ${outcome.id}: ${outcome.title} (worker ${outcome.worker})\n\n${outcome.result || 'Completed without a text response.'}`,
      )].join('\n'),
      sessionId: task.thread_id,
      exitCode: 0,
    };
  }

  cancel(parentTaskId = null) {
    let cancelled = false;
    const parentIds = parentTaskId == null
      ? [...new Set([
          ...this.activeChildren.keys(),
          ...this.preparations.keys(),
          ...this.councilParents,
        ])]
      : [parentTaskId];
    for (const parentId of parentIds) {
      const ownsActiveWork = this.activeChildren.has(parentId)
        || this.preparations.has(parentId)
        || this.councilParents.has(parentId);
      if (ownsActiveWork) {
        this.cancelledParents.add(String(parentId));
        // A terminal may still be launching, before Codex has a cancellable turn. The latch is
        // enough to stop that launch safely, so cancellation was accepted even if cancel()
        // below reports that no provider turn exists yet.
        cancelled = true;
      }
      for (const taskId of this.activeChildren.get(parentId) || []) {
        cancelled = this.codex.cancel(taskId) || cancelled;
      }
    }
    if (this.councilReviewer && typeof this.councilReviewer.cancel === 'function') {
      const councilParents = parentTaskId == null ? [...this.councilParents] : [parentTaskId];
      for (const parentId of councilParents) {
        cancelled = this.councilReviewer.cancel(parentId) || cancelled;
      }
    }
    return cancelled;
  }
}
