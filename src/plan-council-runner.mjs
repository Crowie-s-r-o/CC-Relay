const STAGES = [
  { id: 'draft', label: 'Claude draft', provider: 'claude', runningStatus: 'drafting' },
  { id: 'review', label: 'Codex review', provider: 'codex', runningStatus: 'reviewing' },
  { id: 'revision', label: 'Claude revision', provider: 'claude', runningStatus: 'revising' },
];

function attachmentContext(task) {
  const attachments = task.attachments || [];
  if (attachments.length === 0) {
    return '';
  }
  return `\n\nReference images are attached to this planning brief. Inspect every image before deciding the plan:\n${attachments
    .map((attachment, index) => `${index + 1}. ${attachment.name}: ${attachment.path}`)
    .join('\n')}`;
}

export function authorPrompt(task) {
  return `You are the author in a two-agent implementation planning council.

Work in read-only plan mode. Inspect the repository and its instruction files when useful, but do not edit anything. Produce a decision-complete implementation plan in Markdown only. The plan must cover architecture, exact files or components, data flow, edge cases, migration and compatibility, tests, and verification. Resolve reasonable ambiguities yourself and call out only genuine product decisions.

<original-user-brief>
${task.prompt}
</original-user-brief>${attachmentContext(task)}`;
}

export function reviewerPrompt(task, draft) {
  return `You are the independent reviewer in a two-agent implementation planning council. Review the first author's proposed plan adversarially and in read-only mode. Do not edit files.

Inspect the repository as needed. Find incorrect assumptions, missing execution paths, unsafe migrations, weak verification, unnecessary scope, and anything that would make implementation fail. Return concise Markdown with a verdict, findings ordered by severity, and exact changes the author should make. Do not rewrite the full plan.

<original-user-brief>
${task.prompt}
</original-user-brief>${attachmentContext(task)}

<first-author-draft>
${draft}
</first-author-draft>`;
}

export function revisionPrompt(task, draft, review) {
  return `You are the original plan author returning after an independent review. Work in read-only plan mode and do not edit files.

Revise your first draft into one final, decision-complete implementation plan. Resolve every material review finding. If a finding is not applicable, still resolve the underlying risk in the plan without discussing the council conversation. Return only the final Markdown plan, ready for another agent to execute. Do not include the draft, review transcript, preamble, or commentary about this revision.

<original-user-brief>
${task.prompt}
</original-user-brief>${attachmentContext(task)}

<your-first-draft>
${draft}
</your-first-draft>

<independent-review>
${review}
</independent-review>`;
}

export class PlanCouncilError extends Error {
  constructor(message, { stage = null, cancelled = false, exitCode = null, cause = null } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'PlanCouncilError';
    this.stage = stage;
    this.cancelled = cancelled;
    this.exitCode = exitCode;
    this.retryable = false;
  }
}

function storedAttachments(task) {
  return (task.attachments || []).map((attachment) => ({
    id: attachment.id,
    name: attachment.name,
    mimeType: attachment.mimeType,
    size: attachment.size,
    path: attachment.path,
  }));
}

function createPlanRecord(task, artifactPath) {
  const timestamp = new Date().toISOString();
  return {
    version: 2,
    taskId: task.id,
    status: 'drafting',
    brief: task.prompt,
    attachments: storedAttachments(task),
    artifactPath,
    createdAt: timestamp,
    updatedAt: timestamp,
    completedAt: null,
    failedStage: null,
    author: {
      provider: task.author_provider,
      model: task.author_model,
      effort: task.author_effort,
      threadId: task.author_thread_id,
      session: task.author_thread_name,
    },
    reviewer: {
      provider: task.reviewer_provider,
      model: task.reviewer_model,
      effort: task.reviewer_effort,
      threadId: task.thread_id,
      session: task.thread_name,
    },
    stages: STAGES.map((stage) => ({
      id: stage.id,
      label: stage.label,
      provider: stage.provider,
      status: 'pending',
      attempts: 0,
      startedAt: null,
      completedAt: null,
      error: null,
    })),
    draft: '',
    review: '',
    finalPlan: '',
    error: null,
  };
}

function sameAttachments(left = [], right = []) {
  return left.length === right.length && left.every((attachment, index) => (
    attachment.path === right[index]?.path
    && attachment.name === right[index]?.name
  ));
}

function planMatchesTask(plan, task) {
  return plan?.taskId === task.id
    && plan.brief === task.prompt
    && plan.author?.provider === task.author_provider
    && plan.author?.model === task.author_model
    && plan.author?.effort === task.author_effort
    && plan.reviewer?.provider === task.reviewer_provider
    && plan.reviewer?.model === task.reviewer_model
    && plan.reviewer?.effort === task.reviewer_effort
    && sameAttachments(plan.attachments, storedAttachments(task));
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function stageOutput(plan, stageId) {
  if (stageId === 'draft') return text(plan.draft);
  if (stageId === 'review') return text(plan.review);
  return text(plan.finalPlan);
}

function normalizePlan(plan, task, artifactPath) {
  const normalized = {
    ...plan,
    version: 2,
    taskId: task.id,
    artifactPath,
    attachments: storedAttachments(task),
    completedAt: plan.completedAt || null,
    failedStage: plan.failedStage || null,
    draft: text(plan.draft),
    review: text(plan.review),
    finalPlan: text(plan.finalPlan),
  };

  if (!normalized.draft) {
    normalized.review = '';
    normalized.finalPlan = '';
  } else if (!normalized.review) {
    normalized.finalPlan = '';
  }

  const previousStages = new Map((plan.stages || []).map((stage) => [stage.id, stage]));
  normalized.stages = STAGES.map((definition) => {
    const previous = previousStages.get(definition.id) || {};
    const complete = Boolean(stageOutput(normalized, definition.id));
    return {
      id: definition.id,
      label: definition.label,
      provider: definition.provider,
      status: complete ? 'complete' : 'pending',
      attempts: Number.isInteger(previous.attempts) ? previous.attempts : 0,
      startedAt: previous.startedAt || null,
      completedAt: complete ? previous.completedAt || normalized.updatedAt || null : null,
      error: null,
    };
  });

  const complete = normalized.stages.every((stage) => stage.status === 'complete');
  normalized.status = complete
    ? 'complete'
    : STAGES.find((definition) => !stageOutput(normalized, definition.id))?.runningStatus || 'drafting';
  normalized.completedAt = complete ? normalized.completedAt || normalized.updatedAt || new Date().toISOString() : null;
  normalized.error = null;
  normalized.failedStage = null;
  normalized.reviewer = {
    ...normalized.reviewer,
    threadId: task.thread_id,
    session: task.thread_name,
  };
  normalized.author = {
    ...normalized.author,
    threadId: task.author_thread_id,
    session: task.author_thread_name,
  };
  return normalized;
}

function claudeStageTask(task, prompt) {
  if (!task.author_thread_id) {
    throw new Error(
      'Plan council needs a connected Claude author terminal. Choose a Claude Relay in this workspace and retry.',
    );
  }
  return {
    ...task,
    prompt,
    provider: 'claude',
    thread_id: task.author_thread_id,
    thread_name: task.author_thread_name || task.author_thread_id,
    thread_source: task.author_thread_source || 'Claude interactive',
    model: task.author_model,
    effort: task.author_effort,
    require_terminal: true,
    terminal_permission_mode: 'plan',
    terminal_tools: ['Read', 'Glob', 'Grep', 'AskUserQuestion'],
  };
}

function requireStageText(value, stageId, provider) {
  const result = text(value);
  if (!result) {
    throw new PlanCouncilError(`${provider} completed the ${stageId} stage without a text response.`, { stage: stageId });
  }
  return result;
}

function wrapStageError(error, stageId) {
  if (error instanceof PlanCouncilError) {
    error.retryable = false;
    return error;
  }
  const label = STAGES.find((stage) => stage.id === stageId)?.label || 'Plan council stage';
  return new PlanCouncilError(`${label} failed: ${error?.message || 'Unknown provider error.'}`, {
    stage: stageId,
    cancelled: error?.cancelled === true,
    exitCode: error?.exitCode ?? null,
    cause: error,
  });
}

export class PlanCouncilRunner {
  constructor({
    claude,
    codex,
    artifacts,
    terminalExecution = true,
    heartbeatMs = 30_000,
    stageTimeoutMs = 60 * 60_000,
  }) {
    this.claude = claude;
    this.codex = codex;
    this.artifacts = artifacts;
    this.terminalExecution = terminalExecution;
    this.heartbeatMs = heartbeatMs;
    this.stageTimeoutMs = stageTimeoutMs;
    this.activeRunner = null;
    this.activeTaskId = null;
    this.activeStageId = null;
  }

  monitorStage(promise, callback, stageId) {
    const definition = STAGES.find((stage) => stage.id === stageId);
    const startedAt = Date.now();
    const heartbeat = this.heartbeatMs > 0 ? setInterval(() => {
      try {
        callback({
          event: {
            type: 'plan/heartbeat',
            provider: definition?.provider || 'plan',
            phase: stageId,
            elapsedMs: Date.now() - startedAt,
          },
          message: `${definition?.label || 'Plan council stage'} is still running.`,
        });
      } catch {}
    }, this.heartbeatMs) : null;
    heartbeat?.unref?.();

    let timeout = null;
    const timeoutPromise = this.stageTimeoutMs > 0
      ? new Promise((_, reject) => {
        timeout = setTimeout(() => {
          this.activeRunner?.cancel(this.activeTaskId);
          reject(new PlanCouncilError(
            `${definition?.label || 'Plan council stage'} exceeded the ${Math.max(1, Math.round(this.stageTimeoutMs / 60_000))}-minute safety limit and was stopped. Retry to resume from the last completed checkpoint.`,
            { stage: stageId },
          ));
        }, this.stageTimeoutMs);
        timeout.unref?.();
      })
      : new Promise(() => {});

    return Promise.race([promise, timeoutPromise]).finally(() => {
      if (heartbeat) clearInterval(heartbeat);
      if (timeout) clearTimeout(timeout);
    });
  }

  providerEvent(callback, provider, phase, update) {
    callback({
      event: { ...(update?.event || {}), provider, phase },
      message: update?.message || `${provider} updated the ${phase} stage.`,
    });
  }

  runClaudeStage(task, prompt, phase, onEvent, onStderr) {
    const callbacks = {
      onEvent: (event) => this.providerEvent(onEvent, 'claude', phase, event),
      onStderr,
    };
    if (this.terminalExecution) {
      return this.claude.run(claudeStageTask(task, prompt), callbacks);
    }
    return this.claude.run(prompt, {
      cwd: task.repo_path,
      model: task.author_model,
      effort: task.author_effort,
      attachmentPaths: (task.attachments || []).map((attachment) => attachment.path),
      owner: task.id,
      ...callbacks,
    });
  }

  persist(task, plan) {
    plan.updatedAt = new Date().toISOString();
    plan.artifactPath = this.artifacts.planPath(plan.taskId, task.repo_path);
    this.artifacts.writePlan(plan.taskId, plan, { repoPath: task.repo_path });
  }

  announceStage(callback, task, plan, stageId, status, message) {
    const stage = plan.stages.find((item) => item.id === stageId);
    const definition = STAGES.find((item) => item.id === stageId);
    const timestamp = new Date().toISOString();
    if (stage) {
      stage.status = status;
      stage.error = null;
      if (status === 'running') {
        stage.attempts = Number(stage.attempts || 0) + 1;
        stage.startedAt = timestamp;
        stage.completedAt = null;
      } else if (status === 'complete') {
        stage.completedAt = timestamp;
      }
    }
    if (status === 'running') {
      plan.status = definition?.runningStatus || plan.status;
      plan.error = null;
      plan.failedStage = null;
    }
    this.persist(task, plan);
    callback({
      event: { type: 'plan/stage', provider: 'plan', phase: stageId, status },
      message,
    });
  }

  loadPlan(task) {
    const artifactPath = this.artifacts.planPath(task.id, task.repo_path);
    const stored = this.artifacts.readPlan(task.id);
    if (!stored || !planMatchesTask(stored, task)) {
      return { plan: createPlanRecord(task, artifactPath), resumedStages: [] };
    }
    const plan = normalizePlan(stored, task, artifactPath);
    return {
      plan,
      resumedStages: plan.stages.filter((stage) => stage.status === 'complete').map((stage) => stage.id),
    };
  }

  async run(task, { onEvent = () => {}, onStderr = () => {} } = {}) {
    if (this.activeTaskId !== null) {
      throw new PlanCouncilError('Another Plan council is already running.');
    }

    const { plan, resumedStages } = this.loadPlan(task);
    this.activeTaskId = task.id;
    try {
      this.persist(task, plan);
      if (resumedStages.length > 0 && resumedStages.length < STAGES.length) {
        onEvent({
          event: {
            type: 'plan/resumed',
            provider: 'plan',
            phase: STAGES.find((stage) => !resumedStages.includes(stage.id))?.id || 'revision',
            resumedStages,
          },
          message: `Plan council resumed with ${resumedStages.length} completed stage${resumedStages.length === 1 ? '' : 's'} preserved.`,
        });
      }

      if (!plan.draft) {
        this.activeStageId = 'draft';
        this.activeRunner = this.claude;
        this.announceStage(onEvent, task, plan, 'draft', 'running', 'Claude started the first plan draft.');
        const draftResult = await this.monitorStage(
          this.runClaudeStage(task, authorPrompt(task), 'draft', onEvent, onStderr),
          onEvent,
          'draft',
        );
        plan.draft = requireStageText(
          draftResult?.finalResponse ?? draftResult?.text,
          'draft',
          'Claude',
        );
        if (task.author_thread_id) {
          plan.author.threadId = draftResult?.sessionId || task.author_thread_id;
        }
        this.announceStage(onEvent, task, plan, 'draft', 'complete', 'Claude completed the first plan draft.');
        this.activeStageId = null;
        this.activeRunner = null;
      }

      if (!plan.review) {
        this.activeStageId = 'review';
        this.activeRunner = this.codex;
        this.announceStage(onEvent, task, plan, 'review', 'running', 'Codex started reviewing the Claude draft.');
        const reviewResult = await this.monitorStage(this.codex.run({
          ...task,
          prompt: reviewerPrompt(task, plan.draft),
          model: task.reviewer_model,
          effort: task.reviewer_effort,
          read_only: true,
        }, {
          onEvent: (event) => this.providerEvent(onEvent, 'codex', 'review', event),
          onStderr,
        }), onEvent, 'review');
        plan.review = requireStageText(
          reviewResult?.finalResponse ?? reviewResult?.text,
          'review',
          'Codex',
        );
        plan.reviewer.threadId = reviewResult?.sessionId || task.thread_id;
        this.announceStage(onEvent, task, plan, 'review', 'complete', 'Codex completed its independent review.');
        this.activeStageId = null;
        this.activeRunner = null;
      }

      if (!plan.finalPlan) {
        this.activeStageId = 'revision';
        this.activeRunner = this.claude;
        this.announceStage(onEvent, task, plan, 'revision', 'running', 'Claude started revising the plan from Codex feedback.');
        const finalResult = await this.monitorStage(
          this.runClaudeStage(
            task,
            revisionPrompt(task, plan.draft, plan.review),
            'revision',
            onEvent,
            onStderr,
          ),
          onEvent,
          'revision',
        );
        plan.finalPlan = requireStageText(
          finalResult?.finalResponse ?? finalResult?.text,
          'revision',
          'Claude',
        );
        if (task.author_thread_id) {
          plan.author.threadId = finalResult?.sessionId || task.author_thread_id;
        }
        this.announceStage(onEvent, task, plan, 'revision', 'complete', 'Claude completed the final reviewed plan.');
        this.activeStageId = null;
        this.activeRunner = null;
      }

      plan.status = 'complete';
      plan.error = null;
      plan.failedStage = null;
      plan.completedAt = plan.completedAt || new Date().toISOString();
      this.persist(task, plan);
      onEvent({
        event: {
          type: 'plan/completed',
          provider: 'plan',
          phase: 'revision',
          artifactPath: plan.artifactPath,
        },
        message: `The reviewed plan was saved to ${plan.artifactPath}.`,
      });
      return {
        finalResponse: plan.finalPlan,
        sessionId: plan.reviewer.threadId || task.thread_id,
        exitCode: 0,
        artifactPath: plan.artifactPath,
      };
    } catch (error) {
      if (!this.activeStageId) {
        throw error;
      }
      const failure = wrapStageError(error, this.activeStageId);
      const stage = plan.stages.find((item) => item.id === failure.stage && item.status === 'running');
      plan.status = failure.cancelled ? 'cancelled' : 'failed';
      plan.error = failure.message;
      plan.failedStage = failure.stage;
      if (stage) {
        stage.status = plan.status;
        stage.error = failure.message;
      }
      this.persist(task, plan);
      throw failure;
    } finally {
      this.activeRunner = null;
      this.activeTaskId = null;
      this.activeStageId = null;
    }
  }

  cancel(taskId = null) {
    if (taskId !== null && String(taskId) !== String(this.activeTaskId)) {
      return false;
    }
    return this.activeRunner?.cancel(this.activeTaskId) || false;
  }
}
