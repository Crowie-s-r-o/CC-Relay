const GRAPH_SCHEMA = `
{
  "version": 1,
  "summary": "short coordination summary",
  "sharedContext": "contracts and constraints every worker needs",
  "tasks": [
    {
      "id": "stable-kebab-id",
      "title": "Task title",
      "instructions": "Complete the scoped implementation",
      "dependsOn": ["another-task-id"],
      "ownedPaths": ["path or glob"],
      "verification": ["command"]
    }
  ]
}`;

function attachmentPathsFor(task, attachmentPaths) {
  if (Array.isArray(attachmentPaths)) return attachmentPaths.filter((path) => typeof path === 'string' && path.trim());
  return (Array.isArray(task?.attachments) ? task.attachments : [])
    .map((attachment) => typeof attachment === 'string' ? attachment : attachment?.path)
    .filter((path) => typeof path === 'string' && path.trim());
}

function draftJson(draftPlan) {
  try {
    return JSON.stringify(draftPlan, null, 2);
  } catch (error) {
    throw new TypeError(`The Codex draft graph could not be serialized: ${error.message}`);
  }
}

export function buildTurboPlanCouncilDraftPrompt({ task = {}, workerCount, attachmentPaths } = {}) {
  const paths = attachmentPathsFor(task, attachmentPaths);
  const repository = task.repo_path || task.cwd || '(repository path not provided)';
  const objective = task.prompt || task.objective || '(original objective not provided)';
  const count = Number.isInteger(workerCount) && workerCount > 0 ? workerCount : 'the configured';
  return `You are the Claude author stage in a two-step Forward-planning Turbo council. You run first and must inspect the repository, then produce the initial execution graph for Codex to review. Do not edit files, run implementation commands, or delegate work. Work in read-only plan mode.

Return only the complete JSON object. Do not return commentary, Markdown, or a fenced code block. The graph must be safe for ${count} concurrent worker terminals sharing one working tree.

Original objective:
${objective}

Repository path:
${repository}

Reference attachment paths:
${paths.length ? paths.map((path) => `- ${path}`).join('\n') : '- None'}

Required worker count:
${count}

Required version-1 graph schema:
${GRAPH_SCHEMA}

Schema and safety requirements:
- Keep version exactly 1 and return summary, sharedContext, and tasks.
- Include at least ${count} executable tasks when the configured worker count is numeric.
- Every task needs a unique non-empty id, title, instructions, ownedPaths, and verification array.
- Every dependency must name an existing task, never itself, and the graph must be acyclic.
- Make dependencies explicit whenever workers share files or one task relies on another's output.
- Keep owned paths as disjoint as possible and include practical verification for every package.`;
}

/**
 * Build the fixed Codex-first, Claude-second Turbo graph review prompt.
 * Claude is deliberately asked for JSON only so the caller can validate the
 * returned graph with the same parser used for the original Codex plan.
 */
export function buildTurboPlanCouncilPrompt({
  task = {},
  draftPlan,
  codexDraftPlan,
  workerCount,
  attachmentPaths,
} = {}) {
  const draft = draftPlan ?? codexDraftPlan;
  const paths = attachmentPathsFor(task, attachmentPaths);
  const repository = task.repo_path || task.cwd || '(repository path not provided)';
  const objective = task.prompt || task.objective || '(original objective not provided)';
  const count = Number.isInteger(workerCount) && workerCount > 0 ? workerCount : 'the configured';
  return `You are the Claude review stage in the selected Codex-first Forward-planning Turbo council route. Codex has already produced the draft graph in step 01; you are step 02 and must independently inspect the repository before workers start. Do not edit files, run implementation commands, or delegate work. Work in read-only plan mode.

For this task, Codex authors and Claude reviews. Preserve useful work from the draft, but correct missing dependencies, unsafe or overlapping ownership, incomplete verification, and coordination gaps. The final graph must be complete, internally consistent, and safe for ${count} concurrent worker terminals sharing one working tree. Do not return commentary, Markdown, or a fenced code block. Return only the complete corrected JSON object.

Original objective:
${objective}

Repository path:
${repository}

Reference attachment paths:
${paths.length ? paths.map((path) => `- ${path}`).join('\n') : '- None'}

Required worker count:
${count}

Exact Codex draft JSON:
${draftJson(draft)}

Required version-1 graph schema:
${GRAPH_SCHEMA}

Schema and safety requirements:
- Keep version exactly 1 and return summary, sharedContext, and tasks.
- Include at least ${count} executable tasks when the configured worker count is numeric.
- Every task needs a unique non-empty id, title, instructions, ownedPaths, and verification array.
- Every dependency must name an existing task, never itself, and the graph must be acyclic.
- Make dependencies explicit whenever workers share files or one task relies on another's output.
- Keep owned paths as disjoint as possible and do not assign unsafe overlapping write ownership.
- Preserve the user's objective and include practical verification for every package.
- Return the full graph, even when the Codex draft already looks correct.`;
}

export const turboPlanCouncilPrompt = buildTurboPlanCouncilPrompt;
export const buildCouncilPrompt = buildTurboPlanCouncilPrompt;
export const buildTurboReviewPrompt = buildTurboPlanCouncilPrompt;
export const promptBuilder = buildTurboPlanCouncilPrompt;

export class TurboPlanCouncilError extends Error {
  constructor(message, { cancelled = false } = {}) {
    super(message);
    this.name = 'TurboPlanCouncilError';
    this.cancelled = cancelled;
  }
}

function cancelledError(parentTaskId) {
  return new TurboPlanCouncilError(
    `Turbo graph review for task ${parentTaskId} was cancelled.`,
    { cancelled: true },
  );
}

function parseReviewedGraph(result, workerCount) {
  const text = typeof result?.text === 'string'
    ? result.text.trim()
    : typeof result?.finalResponse === 'string'
      ? result.finalResponse.trim()
      : '';
  if (!text) {
    throw new TurboPlanCouncilError('Claude completed without a corrected Turbo graph.');
  }
  let plan;
  try {
    plan = JSON.parse(text);
  } catch (error) {
    throw new TurboPlanCouncilError(`Claude returned invalid Turbo graph JSON: ${error.message}`);
  }
  if (!plan || typeof plan !== 'object' || Array.isArray(plan) || plan.version !== 1 || !Array.isArray(plan.tasks)) {
    throw new TurboPlanCouncilError('Claude returned an incomplete version-1 Turbo graph.');
  }
  if (Number.isInteger(workerCount) && workerCount > 0 && plan.tasks.length < workerCount) {
    throw new TurboPlanCouncilError(`Claude returned fewer than ${workerCount} executable Turbo tasks.`);
  }
  const ids = new Set();
  const tasks = plan.tasks.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)
      || typeof item.id !== 'string' || !item.id.trim()
      || typeof item.title !== 'string' || !item.title.trim()
      || typeof item.instructions !== 'string' || !item.instructions.trim()) {
      throw new TurboPlanCouncilError(`Claude Turbo task ${index + 1} is incomplete.`);
    }
    if (ids.has(item.id)) throw new TurboPlanCouncilError(`Claude duplicated Turbo task ID: ${item.id}.`);
    ids.add(item.id);
    return {
      ...item,
      dependsOn: Array.isArray(item.dependsOn) ? item.dependsOn.map(String) : [],
      ownedPaths: Array.isArray(item.ownedPaths) ? item.ownedPaths : [],
      verification: Array.isArray(item.verification) ? item.verification : [],
    };
  });
  for (const item of tasks) {
    for (const dependency of item.dependsOn) {
      if (!ids.has(dependency)) throw new TurboPlanCouncilError(`Claude Turbo task ${item.id} has unknown dependency ${dependency}.`);
      if (dependency === item.id) throw new TurboPlanCouncilError(`Claude Turbo task ${item.id} depends on itself.`);
    }
  }
  const remaining = new Map(tasks.map((item) => [item.id, new Set(item.dependsOn)]));
  const resolved = new Set();
  while (remaining.size > 0) {
    const ready = [...remaining].filter(([, dependencies]) => [...dependencies].every((id) => resolved.has(id)));
    if (ready.length === 0) throw new TurboPlanCouncilError('Claude returned a cyclic Turbo dependency graph.');
    for (const [id, dependencies] of ready) {
      remaining.delete(id);
      resolved.add(id);
      dependencies.clear();
    }
  }
  return { text, plan: { ...plan, tasks } };
}

function normalizeRequest(input, task, draftPlan, workerCount, model, effort, onEvent, onStderr) {
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    return {
      parentTaskId: input.parentTaskId ?? input.taskId ?? input.task?.id,
      task: input.task || {},
      draftPlan: input.draftPlan ?? input.codexDraftPlan ?? input.plan,
      workerCount: input.workerCount,
      model: input.claudeModel ?? input.reviewerModel ?? input.model,
      effort: input.claudeEffort ?? input.reviewerEffort ?? input.effort,
      onEvent: input.onEvent,
      onStderr: input.onStderr,
      attachmentPaths: input.attachmentPaths,
      stage: 'review',
    };
  }
  return {
    parentTaskId: input,
    task: task || {},
    draftPlan,
    workerCount,
    model,
    effort,
    onEvent,
    onStderr,
    attachmentPaths: undefined,
    stage: 'review',
  };
}

function normalizeDraftRequest(input = {}) {
  return {
    parentTaskId: input.parentTaskId ?? input.taskId ?? input.task?.id,
    task: input.task || {},
    draftPlan: null,
    workerCount: input.workerCount,
    model: input.claudeModel ?? input.authorModel ?? input.model,
    effort: input.claudeEffort ?? input.authorEffort ?? input.effort,
    onEvent: input.onEvent,
    onStderr: input.onStderr,
    attachmentPaths: input.attachmentPaths,
    stage: 'draft',
  };
}

export class TurboPlanCouncilReviewer {
  constructor(options = {}) {
    const config = options || {};
    const injectedRunner = typeof config.run === 'function' ? config : null;
    const { claude, claudeRunner } = injectedRunner ? {} : config;
    this.claude = injectedRunner || claude || claudeRunner;
    if (!this.claude || typeof this.claude.run !== 'function') {
      throw new TypeError('TurboPlanCouncilReviewer needs an injected Claude runner.');
    }
    this.queue = [];
    this.active = null;
    this.draining = false;
  }

  review(input, task, draftPlan, workerCount, model, effort, onEvent, onStderr) {
    const request = normalizeRequest(input, task, draftPlan, workerCount, model, effort, onEvent, onStderr);
    return this.enqueue(request);
  }

  draft(input = {}) {
    return this.enqueue(normalizeDraftRequest(input));
  }

  enqueue(request) {
    if (request.parentTaskId == null) {
      return Promise.reject(new TurboPlanCouncilError('Turbo graph review needs a parent task ID.'));
    }
    const promise = new Promise((resolve, reject) => {
      this.queue.push({ ...request, resolve, reject, settled: false });
    });
    this.drain();
    return promise;
  }

  run(...args) {
    return this.review(...args);
  }

  drain() {
    if (this.draining || this.active || this.queue.length === 0) return;
    this.draining = true;
    const request = this.queue.shift();
    this.active = request;
    let started;
    try {
      const paths = attachmentPathsFor(request.task, request.attachmentPaths);
      const prompt = request.stage === 'draft'
        ? buildTurboPlanCouncilDraftPrompt({
          task: request.task,
          workerCount: request.workerCount,
          attachmentPaths: paths,
        })
        : buildTurboPlanCouncilPrompt({
          task: request.task,
          draftPlan: request.draftPlan,
          workerCount: request.workerCount,
          attachmentPaths: paths,
        });
      started = this.claude.run(prompt, {
        cwd: request.task.repo_path || request.task.cwd,
        model: request.model,
        effort: request.effort,
        attachmentPaths: paths,
        onEvent: request.onEvent || (() => {}),
        onStderr: request.onStderr || (() => {}),
      });
    } catch (error) {
      this.finish(request, error);
      return;
    }
    Promise.resolve(started).then(
      (result) => this.finish(request, null, result),
      (error) => this.finish(request, error),
    );
  }

  finish(request, error, result) {
    if (request.settled) return;
    request.settled = true;
    if (this.active === request) this.active = null;
    this.draining = false;
    if (error || request.cancelRequested) {
      request.reject(error || cancelledError(request.parentTaskId));
    } else {
      try {
        const parsed = parseReviewedGraph(result, request.workerCount);
        request.resolve({ ...result, text: parsed.text, finalResponse: parsed.text, plan: parsed.plan });
      } catch (parseError) {
        request.reject(parseError);
      }
    }
    queueMicrotask(() => this.drain());
  }

  cancel(parentTaskId = null) {
    let cancelled = false;
    const matches = (request) => parentTaskId == null || String(request.parentTaskId) === String(parentTaskId);
    const retained = [];
    for (const request of this.queue) {
      if (!matches(request)) {
        retained.push(request);
        continue;
      }
      request.settled = true;
      request.reject(cancelledError(request.parentTaskId));
      cancelled = true;
    }
    this.queue = retained;
    if (this.active && matches(this.active)) {
      try {
        const activeCancelled = this.claude.cancel();
        if (activeCancelled) {
          this.active.cancelRequested = true;
          cancelled = true;
        }
      } catch {
        // The active Claude runner remains the source of truth for its turn.
      }
    }
    if (!this.active) queueMicrotask(() => this.drain());
    return cancelled;
  }
}

export default TurboPlanCouncilReviewer;
