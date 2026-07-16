function attachmentContext(task) {
  const attachments = task.attachments || [];
  if (attachments.length === 0) {
    return '';
  }
  return `\n\nReference images are attached to this planning brief. Use the Read tool to inspect every image before deciding the plan:\n${attachments
    .map((attachment, index) => `${index + 1}. ${attachment.name}: ${attachment.path}`)
    .join('\n')}`;
}

function attachmentPaths(task) {
  return (task.attachments || []).map((attachment) => attachment.path);
}

function authorPrompt(task) {
  return `You are the author in a two-agent implementation planning council.

Work in read-only plan mode. Inspect the repository and its instruction files when useful, but do not edit anything. Produce a decision-complete implementation plan in Markdown only. The plan must cover architecture, exact files or components, data flow, edge cases, migration and compatibility, tests, and verification. Resolve reasonable ambiguities yourself and call out only genuine product decisions.

Planning brief:
${task.prompt}${attachmentContext(task)}`;
}

function reviewerPrompt(task, draft) {
  return `You are the independent reviewer in a two-agent implementation planning council. Review the proposed plan adversarially and in read-only mode. Do not edit files.

Check the repository as needed. Find incorrect assumptions, missing execution paths, unsafe migrations, weak verification, unnecessary scope, and anything that would make implementation fail. Return concise Markdown with a verdict, findings ordered by severity, and exact changes the author should make. Do not rewrite the full plan.

Original brief:
${task.prompt}${attachmentContext(task)}

Claude draft:
${draft}`;
}

function revisionPrompt(task, draft, review) {
  return `You are the plan author returning after an independent Codex review. Work in read-only plan mode and do not edit files.

Revise the draft into the final decision-complete implementation plan. Address every valid review finding. If a finding is not applicable, resolve the underlying concern in the plan without discussing the conversation. Return only the final Markdown plan, ready for implementation.

Original brief:
${task.prompt}${attachmentContext(task)}

Your first draft:
${draft}

Codex review:
${review}`;
}

function createPlanRecord(task) {
  return {
    version: 1,
    status: 'drafting',
    brief: task.prompt,
    attachments: (task.attachments || []).map((attachment) => ({
      id: attachment.id,
      name: attachment.name,
      mimeType: attachment.mimeType,
      size: attachment.size,
      path: attachment.path,
    })),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    author: {
      provider: task.author_provider,
      model: task.author_model,
      effort: task.author_effort,
    },
    reviewer: {
      provider: task.reviewer_provider,
      model: task.reviewer_model,
      effort: task.reviewer_effort,
      threadId: task.thread_id,
      session: task.thread_name,
    },
    stages: [
      { id: 'draft', label: 'Claude draft', provider: 'claude', status: 'running' },
      { id: 'review', label: 'Codex review', provider: 'codex', status: 'pending' },
      { id: 'revision', label: 'Claude revision', provider: 'claude', status: 'pending' },
    ],
    draft: '',
    review: '',
    finalPlan: '',
    error: null,
  };
}

function setStage(plan, stageId, status) {
  const stage = plan.stages.find((item) => item.id === stageId);
  if (stage) {
    stage.status = status;
  }
  const runningStatus = {
    draft: 'drafting',
    review: 'reviewing',
    revision: 'revising',
  };
  plan.status = status === 'running' ? runningStatus[stageId] : plan.status;
  plan.updatedAt = new Date().toISOString();
}

export class PlanCouncilRunner {
  constructor({ claude, codex, artifacts }) {
    this.claude = claude;
    this.codex = codex;
    this.artifacts = artifacts;
    this.activeRunner = null;
  }

  event(callback, provider, phase, event) {
    callback({
      event: { ...event.event, provider, phase },
      message: event.message,
    });
  }

  stage(callback, plan, stageId, status, message) {
    setStage(plan, stageId, status);
    this.artifacts.writePlan(plan.taskId, plan);
    callback({
      event: { type: 'plan/stage', provider: 'plan', phase: stageId, status },
      message,
    });
  }

  async run(task, { onEvent, onStderr }) {
    const plan = createPlanRecord(task);
    plan.taskId = task.id;
    this.artifacts.writePlan(task.id, plan);
    try {
      this.activeRunner = this.claude;
      const draftResult = await this.claude.run(authorPrompt(task), {
        cwd: task.repo_path,
        model: task.author_model,
        effort: task.author_effort,
        attachmentPaths: attachmentPaths(task),
        onEvent: (event) => this.event(onEvent, 'claude', 'draft', event),
        onStderr,
      });
      plan.draft = draftResult.text;
      this.stage(onEvent, plan, 'draft', 'complete', 'Claude completed the first plan draft.');
      this.stage(onEvent, plan, 'review', 'running', 'Codex started reviewing the Claude draft.');

      this.activeRunner = this.codex;
      const reviewResult = await this.codex.run({
        ...task,
        prompt: reviewerPrompt(task, plan.draft),
        model: task.reviewer_model,
        effort: task.reviewer_effort,
        read_only: true,
      }, {
        onEvent: (event) => this.event(onEvent, 'codex', 'review', event),
        onStderr,
      });
      plan.review = reviewResult.finalResponse;
      this.stage(onEvent, plan, 'review', 'complete', 'Codex completed its independent review.');
      this.stage(onEvent, plan, 'revision', 'running', 'Claude started revising the plan from Codex feedback.');

      this.activeRunner = this.claude;
      const finalResult = await this.claude.run(
        revisionPrompt(task, plan.draft, plan.review),
        {
          cwd: task.repo_path,
          model: task.author_model,
          effort: task.author_effort,
          attachmentPaths: attachmentPaths(task),
          onEvent: (event) => this.event(onEvent, 'claude', 'revision', event),
          onStderr,
        },
      );
      plan.finalPlan = finalResult.text;
      setStage(plan, 'revision', 'complete');
      plan.status = 'complete';
      plan.completedAt = new Date().toISOString();
      plan.updatedAt = plan.completedAt;
      this.artifacts.writePlan(task.id, plan);
      onEvent({
        event: { type: 'plan/completed', provider: 'plan', phase: 'revision' },
        message: 'The two-agent plan council completed.',
      });
      return {
        finalResponse: plan.finalPlan,
        sessionId: reviewResult.sessionId,
        exitCode: 0,
      };
    } catch (error) {
      plan.status = error.cancelled ? 'cancelled' : 'failed';
      plan.error = error.message;
      plan.updatedAt = new Date().toISOString();
      const running = plan.stages.find((stage) => stage.status === 'running');
      if (running) {
        running.status = plan.status;
      }
      this.artifacts.writePlan(task.id, plan);
      throw error;
    } finally {
      this.activeRunner = null;
    }
  }

  cancel() {
    return this.activeRunner?.cancel() || false;
  }
}
