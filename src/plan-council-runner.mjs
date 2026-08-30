const STAGE_IDS = Object.freeze(['draft', 'review', 'revision']);
// Stages with their own durable Markdown file beside the canonical plan.md. The final
// revision is excluded: it is written as plan.md by the canonical plan writer.
const STAGE_FILE_FIELDS = Object.freeze(['draft', 'review']);

function providerName(provider) {
  return provider === 'codex' ? 'Codex' : 'Claude';
}

function stageDefinitions(task) {
  const authorProvider = task.author_provider === 'codex' ? 'codex' : 'claude';
  const reviewerProvider = task.reviewer_provider === 'claude' ? 'claude' : 'codex';
  return [
    {
      id: 'draft',
      label: `${providerName(authorProvider)} draft`,
      provider: authorProvider,
      runningStatus: 'drafting',
    },
    {
      id: 'review',
      label: `${providerName(reviewerProvider)} review`,
      provider: reviewerProvider,
      runningStatus: 'reviewing',
    },
    {
      id: 'revision',
      label: `${providerName(authorProvider)} revision`,
      provider: authorProvider,
      runningStatus: 'revising',
    },
  ];
}

function roleSettings(task, role) {
  const prefix = role === 'reviewer' ? 'reviewer' : 'author';
  return {
    provider: task[`${prefix}_provider`],
    model: task[`${prefix}_model`],
    effort: task[`${prefix}_effort`],
  };
}

export function planCouncilProviderSettings(task, provider) {
  const authorProvider = task.author_provider === 'codex' ? 'codex' : 'claude';
  const role = authorProvider === provider ? 'author' : 'reviewer';
  return { ...roleSettings(task, role), provider };
}

function providerThread(task, provider) {
  return provider === 'claude'
    ? {
      id: task.author_thread_id,
      name: task.author_thread_name,
      source: task.author_thread_source,
    }
    : {
      id: task.thread_id,
      name: task.thread_name,
      source: task.thread_source,
    };
}

export function claudeCouncilLaunchTask(
  task,
  settings = planCouncilProviderSettings(task, 'claude'),
) {
  return {
    ...task,
    provider: 'claude',
    model: settings.model,
    effort: settings.effort,
    require_terminal: true,
    terminal_permission_mode: 'plan',
    terminal_tools: ['Read', 'Glob', 'Grep', 'AskUserQuestion'],
  };
}

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
  const definitions = stageDefinitions(task);
  const authorThread = providerThread(task, task.author_provider);
  const reviewerThread = providerThread(task, task.reviewer_provider);
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
      threadId: authorThread.id,
      session: authorThread.name,
    },
    reviewer: {
      provider: task.reviewer_provider,
      model: task.reviewer_model,
      effort: task.reviewer_effort,
      threadId: reviewerThread.id,
      session: reviewerThread.name,
    },
    stages: definitions.map((stage) => ({
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
  const definitions = stageDefinitions(task);
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
  normalized.stages = definitions.map((definition) => {
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
    : definitions.find((definition) => !stageOutput(normalized, definition.id))?.runningStatus || 'drafting';
  normalized.completedAt = complete ? normalized.completedAt || normalized.updatedAt || new Date().toISOString() : null;
  normalized.error = null;
  normalized.failedStage = null;
  const reviewerThread = providerThread(task, task.reviewer_provider);
  normalized.reviewer = {
    ...normalized.reviewer,
    threadId: reviewerThread.id,
    session: reviewerThread.name,
  };
  const authorThread = providerThread(task, task.author_provider);
  normalized.author = {
    ...normalized.author,
    threadId: authorThread.id,
    session: authorThread.name,
  };
  return normalized;
}

// Fill missing checkpoint text from the matching project-local stage file. Existing checkpoint
// text always wins, and restoration happens before stage status normalization.
function restoreStageFileOutputs(task, plan, artifacts) {
  const restored = { ...plan };
  for (const stage of STAGE_FILE_FIELDS) {
    if (text(restored[stage])) continue;
    const saved = artifacts.readPlanStage(task.id, stage, task.repo_path);
    if (saved) restored[stage] = saved;
  }
  return restored;
}

export function inspectPlanCouncilCheckpoint(task, artifacts) {
  const artifactPath = artifacts.planPath(task.id, task.repo_path);
  const stored = artifacts.readPlan(task.id);
  if (stored && !planMatchesTask(stored, task)) {
    const plan = createPlanRecord(task, artifactPath);
    return { plan, resumedStages: [], pendingStages: [...plan.stages] };
  }
  const source = restoreStageFileOutputs(
    task,
    stored || createPlanRecord(task, artifactPath),
    artifacts,
  );
  const plan = normalizePlan(source, task, artifactPath);
  return {
    plan,
    resumedStages: plan.stages
      .filter((stage) => stage.status === 'complete')
      .map((stage) => stage.id),
    pendingStages: plan.stages.filter((stage) => stage.status !== 'complete'),
  };
}

function claudeStageTask(task, prompt, settings) {
  const thread = providerThread(task, 'claude');
  if (!thread.id) {
    throw new Error(
      'Plan council needs a connected Claude council terminal. Choose a Claude CC Relay in this workspace and retry.',
    );
  }
  return {
    ...claudeCouncilLaunchTask(task, settings),
    prompt,
    thread_id: thread.id,
    thread_name: thread.name || thread.id,
    thread_source: thread.source || 'Claude interactive',
  };
}

function requireStageText(value, stageId, provider) {
  const result = text(value);
  if (!result) {
    throw new PlanCouncilError(`${provider} completed the ${stageId} stage without a text response.`, { stage: stageId });
  }
  return result;
}

function wrapStageError(error, stageId, task) {
  if (error instanceof PlanCouncilError) {
    error.retryable = false;
    return error;
  }
  const label = stageDefinitions(task).find((stage) => stage.id === stageId)?.label || 'Plan council stage';
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

  monitorStage(promise, callback, stageId, task) {
    const definition = stageDefinitions(task).find((stage) => stage.id === stageId);
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

  runClaudeStage(task, prompt, settings, phase, onEvent, onStderr) {
    const callbacks = {
      onEvent: (event) => this.providerEvent(onEvent, 'claude', phase, event),
      onStderr,
    };
    if (this.terminalExecution) {
      return this.claude.run(claudeStageTask(task, prompt, settings), callbacks);
    }
    return this.claude.run(prompt, {
      cwd: task.repo_path,
      model: settings.model,
      effort: settings.effort,
      attachmentPaths: (task.attachments || []).map((attachment) => attachment.path),
      owner: task.id,
      ...callbacks,
    });
  }

  runProviderStage(task, prompt, role, phase, onEvent, onStderr) {
    const settings = roleSettings(task, role);
    const runner = settings.provider === 'claude' ? this.claude : this.codex;
    this.activeRunner = runner;
    if (settings.provider === 'claude') {
      return this.runClaudeStage(task, prompt, settings, phase, onEvent, onStderr);
    }
    const thread = providerThread(task, 'codex');
    return this.codex.run({
      ...task,
      prompt,
      provider: 'codex',
      thread_id: thread.id,
      thread_name: thread.name || thread.id,
      thread_source: thread.source || 'Codex terminal',
      model: settings.model,
      effort: settings.effort,
      read_only: true,
    }, {
      onEvent: (event) => this.providerEvent(onEvent, 'codex', phase, event),
      onStderr,
    });
  }

  persist(task, plan) {
    plan.updatedAt = new Date().toISOString();
    plan.artifactPath = this.artifacts.planPath(plan.taskId, task.repo_path);
    this.artifacts.writePlan(plan.taskId, plan, { repoPath: task.repo_path });
  }

  announceStage(callback, task, plan, stageId, status, message) {
    const stage = plan.stages.find((item) => item.id === stageId);
    const definition = stageDefinitions(task).find((item) => item.id === stageId);
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
    return inspectPlanCouncilCheckpoint(task, this.artifacts);
  }

  async run(task, { onEvent = () => {}, onStderr = () => {} } = {}) {
    if (this.activeTaskId !== null) {
      throw new PlanCouncilError('Another Plan council is already running.');
    }

    const { plan, resumedStages } = this.loadPlan(task);
    const definitions = stageDefinitions(task);
    const author = roleSettings(task, 'author');
    const reviewer = roleSettings(task, 'reviewer');
    const authorName = providerName(author.provider);
    const reviewerName = providerName(reviewer.provider);
    this.activeTaskId = task.id;
    try {
      this.persist(task, plan);
      if (resumedStages.length > 0 && resumedStages.length < STAGE_IDS.length) {
        onEvent({
          event: {
            type: 'plan/resumed',
            provider: 'plan',
            phase: definitions.find((stage) => !resumedStages.includes(stage.id))?.id || 'revision',
            resumedStages,
          },
          message: `Plan council resumed with ${resumedStages.length} completed stage${resumedStages.length === 1 ? '' : 's'} preserved.`,
        });
      }

      if (!plan.draft) {
        this.activeStageId = 'draft';
        this.announceStage(onEvent, task, plan, 'draft', 'running', `${authorName} started the first plan draft.`);
        const draftResult = await this.monitorStage(
          this.runProviderStage(task, authorPrompt(task), 'author', 'draft', onEvent, onStderr),
          onEvent,
          'draft',
          task,
        );
        plan.draft = requireStageText(
          draftResult?.finalResponse ?? draftResult?.text,
          'draft',
          authorName,
        );
        plan.author.threadId = draftResult?.sessionId
          || providerThread(task, author.provider).id;
        this.announceStage(onEvent, task, plan, 'draft', 'complete', `${authorName} completed the first plan draft.`);
        this.activeStageId = null;
        this.activeRunner = null;
      }

      if (!plan.review) {
        this.activeStageId = 'review';
        this.announceStage(
          onEvent,
          task,
          plan,
          'review',
          'running',
          `${reviewerName} started reviewing the ${authorName} draft.`,
        );
        const reviewResult = await this.monitorStage(
          this.runProviderStage(
            task,
            reviewerPrompt(task, plan.draft),
            'reviewer',
            'review',
            onEvent,
            onStderr,
          ),
          onEvent,
          'review',
          task,
        );
        plan.review = requireStageText(
          reviewResult?.finalResponse ?? reviewResult?.text,
          'review',
          reviewerName,
        );
        plan.reviewer.threadId = reviewResult?.sessionId
          || providerThread(task, reviewer.provider).id;
        this.announceStage(onEvent, task, plan, 'review', 'complete', `${reviewerName} completed its independent review.`);
        this.activeStageId = null;
        this.activeRunner = null;
      }

      if (!plan.finalPlan) {
        this.activeStageId = 'revision';
        this.announceStage(
          onEvent,
          task,
          plan,
          'revision',
          'running',
          `${authorName} started revising the plan from ${reviewerName} feedback.`,
        );
        const finalResult = await this.monitorStage(
          this.runProviderStage(
            task,
            revisionPrompt(task, plan.draft, plan.review),
            'author',
            'revision',
            onEvent,
            onStderr,
          ),
          onEvent,
          'revision',
          task,
        );
        plan.finalPlan = requireStageText(
          finalResult?.finalResponse ?? finalResult?.text,
          'revision',
          authorName,
        );
        plan.author.threadId = finalResult?.sessionId
          || providerThread(task, author.provider).id;
        this.announceStage(onEvent, task, plan, 'revision', 'complete', `${authorName} completed the final reviewed plan.`);
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
      const failure = wrapStageError(error, this.activeStageId, task);
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
