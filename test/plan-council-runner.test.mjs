import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ArtifactStore } from '../src/artifacts.mjs';
import { PlanCouncilError, PlanCouncilRunner } from '../src/plan-council-runner.mjs';

function planTask(id = 42, repoPath = '/tmp/repository') {
  return {
    id,
    prompt: 'Plan a safe migration.',
    repo_path: repoPath,
    thread_id: 'thread-one',
    thread_name: 'Review terminal',
    author_provider: 'claude',
    author_thread_id: 'claude-author',
    author_thread_name: 'Claude author terminal',
    author_thread_source: 'Claude interactive',
    author_model: 'opus',
    author_effort: 'max',
    reviewer_provider: 'codex',
    reviewer_model: 'gpt-test',
    reviewer_effort: 'high',
    attachments: [{
      id: 'image-1',
      name: 'architecture.png',
      mimeType: 'image/png',
      size: 100,
      fileName: '01.png',
      path: '/tmp/relay-plan-images/01.png',
    }],
  };
}

test('plan council records Claude draft, Codex review, and Claude revision', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-plan-'));
  const artifacts = new ArtifactStore(directory);
  const claudePrompts = [];
  const codexTasks = [];
  const events = [];
  const claude = {
    async run(stageTask, options) {
      claudePrompts.push({ prompt: stageTask.prompt, task: stageTask, options });
      options.onEvent({ event: { type: 'claude/started' }, message: 'Claude started.' });
      return {
        finalResponse: claudePrompts.length === 1 ? '# Draft\n\nFirst version.' : '# Final\n\nReviewed version.',
        sessionId: `claude-${claudePrompts.length}`,
        model: 'claude-opus-test',
      };
    },
    cancel() { return true; },
  };
  const codex = {
    async run(task, options) {
      codexTasks.push(task);
      options.onEvent({ event: { type: 'turn/started' }, message: 'Codex started.' });
      return { finalResponse: '## Review\n\nFix verification.', sessionId: 'codex-thread', exitCode: 0 };
    },
    cancel() { return true; },
  };
  const runner = new PlanCouncilRunner({ claude, codex, artifacts });
  const task = planTask(42, join(directory, 'project'));

  try {
    const result = await runner.run(task, {
      onEvent: (event) => events.push(event),
      onStderr: () => {},
    });
    assert.equal(result.finalResponse, '# Final\n\nReviewed version.');
    assert.equal(claudePrompts.length, 2);
    assert.match(claudePrompts[1].prompt, /Fix verification/);
    assert.match(claudePrompts[0].prompt, /architecture\.png/);
    assert.equal(claudePrompts[0].task.thread_id, 'claude-author');
    assert.equal(claudePrompts[0].task.thread_name, 'Claude author terminal');
    assert.equal(claudePrompts[0].task.require_terminal, true);
    assert.equal(claudePrompts[0].task.terminal_permission_mode, 'plan');
    assert.deepEqual(
      claudePrompts[0].task.terminal_tools,
      ['Read', 'Glob', 'Grep', 'AskUserQuestion'],
    );
    assert.equal(claudePrompts[0].task.attachments[0].path, '/tmp/relay-plan-images/01.png');
    assert.equal(codexTasks.length, 1);
    assert.equal(codexTasks[0].read_only, true);
    assert.equal(codexTasks[0].model, 'gpt-test');
    assert.equal(codexTasks[0].attachments[0].name, 'architecture.png');
    assert.match(codexTasks[0].prompt, /Plan a safe migration\./);
    assert.match(codexTasks[0].prompt, /First version\./);
    assert.match(claudePrompts[1].prompt, /Plan a safe migration\./);
    assert.match(claudePrompts[1].prompt, /First version\./);
    assert.match(claudePrompts[1].prompt, /Fix verification\./);
    assert.equal(events.some(({ event }) => event.provider === 'claude'), true);
    assert.equal(events.some(({ event }) => event.provider === 'codex'), true);

    const plan = artifacts.readPlan(task.id);
    assert.equal(plan.status, 'complete');
    assert.match(plan.draft, /First version/);
    assert.match(plan.review, /Fix verification/);
    assert.match(plan.finalPlan, /Reviewed version/);
    assert.equal(plan.attachments[0].name, 'architecture.png');
    const projectPlanPath = join(task.repo_path, '.data', 'tasks', '42', 'plan.md');
    assert.equal(plan.artifactPath, projectPlanPath);
    assert.deepEqual(plan.stages.map(({ status }) => status), ['complete', 'complete', 'complete']);
    const markdown = readFileSync(projectPlanPath, 'utf8');
    assert.equal(markdown, '# Final\n\nReviewed version.\n');
    assert.doesNotMatch(markdown, /First version|Fix verification|Original brief/);
    assert.equal(existsSync(artifacts.planPath(task.id)), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('plan council can run Codex author, Claude review, and Codex revision', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-plan-codex-first-'));
  const artifacts = new ArtifactStore(directory);
  const task = {
    ...planTask(44, join(directory, 'project')),
    author_provider: 'codex',
    author_model: 'gpt-author',
    author_effort: 'high',
    reviewer_provider: 'claude',
    reviewer_model: 'sonnet',
    reviewer_effort: 'max',
  };
  const calls = [];
  const runner = new PlanCouncilRunner({
    artifacts,
    codex: {
      async run(stageTask) {
        calls.push({ provider: 'codex', task: stageTask });
        return {
          finalResponse: calls.length === 1 ? '# Codex draft' : '# Codex final',
          sessionId: 'thread-one',
        };
      },
      cancel() { return true; },
    },
    claude: {
      async run(stageTask) {
        calls.push({ provider: 'claude', task: stageTask });
        return { finalResponse: 'Claude review finding.', sessionId: 'claude-author' };
      },
      cancel() { return true; },
    },
  });

  try {
    const result = await runner.run(task, { onEvent: () => {}, onStderr: () => {} });
    assert.equal(result.finalResponse, '# Codex final');
    assert.deepEqual(calls.map((call) => call.provider), ['codex', 'claude', 'codex']);
    assert.equal(calls[0].task.model, 'gpt-author');
    assert.equal(calls[0].task.read_only, true);
    assert.equal(calls[0].task.thread_id, 'thread-one');
    assert.equal(calls[1].task.model, 'sonnet');
    assert.equal(calls[1].task.effort, 'max');
    assert.equal(calls[1].task.thread_id, 'claude-author');
    assert.match(calls[1].task.prompt, /Codex draft/);
    assert.equal(calls[2].task.model, 'gpt-author');
    assert.match(calls[2].task.prompt, /Claude review finding/);

    const plan = artifacts.readPlan(task.id);
    assert.deepEqual(
      plan.stages.map(({ provider, label }) => ({ provider, label })),
      [
        { provider: 'codex', label: 'Codex draft' },
        { provider: 'claude', label: 'Claude review' },
        { provider: 'codex', label: 'Codex revision' },
      ],
    );
    assert.equal(plan.author.provider, 'codex');
    assert.equal(plan.reviewer.provider, 'claude');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('project-scoped plan writes replace the legacy CC Relay-local artifact', () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-plan-location-'));
  const artifacts = new ArtifactStore(join(directory, 'relay-data', 'tasks'));
  const repoPath = join(directory, 'project');
  const taskId = 43;
  const plan = {
    version: 2,
    taskId,
    status: 'complete',
    finalPlan: '# Project plan',
    stages: [],
  };

  try {
    artifacts.writePlan(taskId, plan);
    const legacyPath = artifacts.planPath(taskId);
    assert.equal(existsSync(legacyPath), true);

    artifacts.writePlan(taskId, plan, { repoPath });
    const projectPath = artifacts.planPath(taskId, repoPath);
    assert.equal(readFileSync(projectPath, 'utf8'), '# Project plan\n');
    assert.equal(existsSync(legacyPath), false);
    assert.equal(artifacts.readPlan(taskId).artifactPath, projectPath);

    artifacts.deleteTask(taskId, { repoPath });
    assert.equal(existsSync(projectPath), false);
    assert.equal(existsSync(artifacts.taskDirectory(taskId)), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('plan council resumes at review without paying for the saved author stage again', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-plan-resume-review-'));
  const artifacts = new ArtifactStore(directory);
  const task = planTask(51, join(directory, 'project'));
  let claudeCalls = 0;
  let codexCalls = 0;
  let reviewerAvailable = false;
  const events = [];
  const runner = new PlanCouncilRunner({
    artifacts,
    claude: {
      async run() {
        claudeCalls += 1;
        return { finalResponse: claudeCalls === 1 ? '# Durable draft' : '# Final after resume' };
      },
      cancel() { return true; },
    },
    codex: {
      async run(reviewTask) {
        codexCalls += 1;
        assert.match(reviewTask.prompt, /Plan a safe migration\./);
        assert.match(reviewTask.prompt, /Durable draft/);
        if (!reviewerAvailable) throw new Error('Review CC Relay disconnected.');
        return { finalResponse: 'Reconnect-safe review.', sessionId: 'thread-two' };
      },
      cancel() { return true; },
    },
  });

  try {
    await assert.rejects(
      runner.run(task, { onEvent: (event) => events.push(event), onStderr: () => {} }),
      (error) => {
        assert.equal(error instanceof PlanCouncilError, true);
        assert.equal(error.stage, 'review');
        assert.equal(error.retryable, false);
        assert.match(error.message, /Review CC Relay disconnected/);
        return true;
      },
    );
    assert.equal(claudeCalls, 1);
    assert.equal(codexCalls, 1);
    assert.equal(artifacts.readPlan(task.id).draft, '# Durable draft');
    assert.equal(artifacts.readPlan(task.id).failedStage, 'review');
    assert.equal(existsSync(artifacts.planPath(task.id, task.repo_path)), false);

    reviewerAvailable = true;
    const result = await runner.run(task, {
      onEvent: (event) => events.push(event),
      onStderr: () => {},
    });
    assert.equal(result.finalResponse, '# Final after resume');
    assert.equal(claudeCalls, 2);
    assert.equal(codexCalls, 2);
    assert.equal(events.some(({ event }) => event.type === 'plan/resumed' && event.resumedStages.includes('draft')), true);
    assert.equal(
      readFileSync(artifacts.planPath(task.id, task.repo_path), 'utf8'),
      '# Final after resume\n',
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('plan council resumes only the final revision after a revision failure', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-plan-resume-revision-'));
  const artifacts = new ArtifactStore(directory);
  const task = planTask(52, join(directory, 'project'));
  let claudeCalls = 0;
  let codexCalls = 0;
  const runner = new PlanCouncilRunner({
    artifacts,
    claude: {
      async run(stageTask) {
        claudeCalls += 1;
        if (claudeCalls === 1) return { finalResponse: '# Draft checkpoint' };
        assert.match(stageTask.prompt, /Review checkpoint/);
        if (claudeCalls === 2) throw new Error('Temporary author failure.');
        return { finalResponse: '# Recovered final plan' };
      },
      cancel() { return true; },
    },
    codex: {
      async run() {
        codexCalls += 1;
        return { finalResponse: 'Review checkpoint.', sessionId: 'thread-one' };
      },
      cancel() { return true; },
    },
  });

  try {
    await assert.rejects(
      runner.run(task, { onEvent: () => {}, onStderr: () => {} }),
      /Claude revision failed: Temporary author failure/,
    );
    assert.equal(codexCalls, 1);
    assert.equal(artifacts.readPlan(task.id).review, 'Review checkpoint.');

    const result = await runner.run(task, { onEvent: () => {}, onStderr: () => {} });
    assert.equal(result.finalResponse, '# Recovered final plan');
    assert.equal(claudeCalls, 3);
    assert.equal(codexCalls, 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('plan council rejects an empty reviewer response and never creates a misleading plan file', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-plan-empty-review-'));
  const artifacts = new ArtifactStore(directory);
  const task = planTask(53, join(directory, 'project'));
  const runner = new PlanCouncilRunner({
    artifacts,
    claude: { async run() { return { finalResponse: '# Draft' }; }, cancel() { return true; } },
    codex: { async run() { return { finalResponse: '   ' }; }, cancel() { return true; } },
  });

  try {
    await assert.rejects(
      runner.run(task, { onEvent: () => {}, onStderr: () => {} }),
      /Codex completed the review stage without a text response/,
    );
    assert.equal(artifacts.readPlan(task.id).status, 'failed');
    assert.equal(existsSync(artifacts.planPath(task.id, task.repo_path)), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('non-macOS compatibility keeps the isolated headless Claude council runner', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-plan-headless-'));
  const artifacts = new ArtifactStore(directory);
  const task = {
    ...planTask(55, join(directory, 'project')),
    author_thread_id: null,
    author_thread_name: null,
    author_thread_source: null,
  };
  const calls = [];
  const runner = new PlanCouncilRunner({
    artifacts,
    terminalExecution: false,
    claude: {
      async run(prompt, options) {
        calls.push({ prompt, options });
        return { text: calls.length === 1 ? '# Headless draft' : '# Headless final' };
      },
      cancel() { return true; },
    },
    codex: {
      async run() {
        return { finalResponse: 'Headless review.', sessionId: 'thread-one' };
      },
      cancel() { return true; },
    },
  });

  try {
    const result = await runner.run(task, { onEvent: () => {}, onStderr: () => {} });
    assert.equal(result.finalResponse, '# Headless final');
    assert.equal(typeof calls[0].prompt, 'string');
    assert.equal(calls[0].options.owner, task.id);
    assert.deepEqual(calls[0].options.attachmentPaths, ['/tmp/relay-plan-images/01.png']);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

// One council that saves its draft and then fails in review. Every stage-file recovery
// test resumes from exactly this state, which is also the state task 84 was left in.
async function councilStoppedAfterDraft(artifacts, task, replies) {
  const calls = { claude: 0, codex: 0, reviewPrompts: [] };
  let reviewerAvailable = false;
  const runner = new PlanCouncilRunner({
    artifacts,
    claude: {
      async run() {
        calls.claude += 1;
        return { finalResponse: replies[calls.claude - 1] };
      },
      cancel() { return true; },
    },
    codex: {
      async run(reviewTask) {
        calls.codex += 1;
        calls.reviewPrompts.push(reviewTask.prompt);
        if (!reviewerAvailable) throw new Error('Review CC Relay disconnected.');
        return { finalResponse: 'Reconnect-safe review.', sessionId: 'thread-two' };
      },
      cancel() { return true; },
    },
  });
  await assert.rejects(
    runner.run(task, { onEvent: () => {}, onStderr: () => {} }),
    /Review CC Relay disconnected/,
  );
  return { runner, calls, allowReviewer() { reviewerAvailable = true; } };
}

test('plan council writes a durable Markdown file as each stage completes', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-plan-stage-files-'));
  const artifacts = new ArtifactStore(directory);
  const task = planTask(60, join(directory, 'project'));
  const draftPath = artifacts.planStagePath(task.id, 'draft', task.repo_path);
  const reviewPath = artifacts.planStagePath(task.id, 'review', task.repo_path);
  const planPath = artifacts.planPath(task.id, task.repo_path);
  let claudeCalls = 0;
  const observed = {};
  const runner = new PlanCouncilRunner({
    artifacts,
    claude: {
      async run() {
        claudeCalls += 1;
        if (claudeCalls === 2) {
          // The reviewer finished, so both earlier stages must already be on disk.
          observed.atRevision = {
            draft: existsSync(draftPath),
            review: existsSync(reviewPath),
            plan: existsSync(planPath),
          };
        }
        return { finalResponse: claudeCalls === 1 ? '# Draft\n\nFirst version.' : '# Final\n\nReviewed version.' };
      },
      cancel() { return true; },
    },
    codex: {
      async run() {
        // The author finished, so only the draft file may exist at this point.
        observed.atReview = {
          draft: existsSync(draftPath),
          review: existsSync(reviewPath),
          plan: existsSync(planPath),
        };
        return { finalResponse: '## Review\n\nFix verification.', sessionId: 'thread-two' };
      },
      cancel() { return true; },
    },
  });

  try {
    await runner.run(task, { onEvent: () => {}, onStderr: () => {} });
    assert.deepEqual(observed.atReview, { draft: true, review: false, plan: false });
    assert.deepEqual(observed.atRevision, { draft: true, review: true, plan: false });

    assert.equal(readFileSync(draftPath, 'utf8'), '# Draft\n\nFirst version.\n');
    assert.equal(readFileSync(reviewPath, 'utf8'), '## Review\n\nFix verification.\n');
    assert.equal(readFileSync(planPath, 'utf8'), '# Final\n\nReviewed version.\n');
    assert.equal(join(task.repo_path, '.data', 'tasks', '60', 'draft.md'), draftPath);

    const plan = artifacts.readPlan(task.id);
    assert.deepEqual(plan.stageArtifacts, { draft: draftPath, review: reviewPath });
    assert.equal(existsSync(artifacts.planStagePath(task.id, 'draft')), false);
    assert.equal(existsSync(artifacts.planStagePath(task.id, 'review')), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('plan council resumes from its stage files when the checkpoint record is corrupt', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-plan-corrupt-checkpoint-'));
  const artifacts = new ArtifactStore(directory);
  const task = planTask(61, join(directory, 'project'));

  try {
    const first = await councilStoppedAfterDraft(artifacts, task, ['# Durable draft', '# Final after resume']);
    assert.equal(
      readFileSync(artifacts.planStagePath(task.id, 'draft', task.repo_path), 'utf8'),
      '# Durable draft\n',
    );

    writeFileSync(join(artifacts.taskDirectory(task.id), 'plan.json'), '{ "taskId": 61, tru', 'utf8');
    assert.equal(artifacts.readPlan(task.id), null);

    first.allowReviewer();
    const events = [];
    const result = await first.runner.run(task, { onEvent: (event) => events.push(event), onStderr: () => {} });
    assert.equal(result.finalResponse, '# Final after resume');
    // Two Claude calls total: the original draft and the revision. The draft was restored
    // from draft.md instead of being paid for a second time.
    assert.equal(first.calls.claude, 2);
    assert.match(first.calls.reviewPrompts[1], /Durable draft/);
    assert.equal(
      events.some(({ event }) => event.type === 'plan/resumed' && event.resumedStages.includes('draft')),
      true,
    );
    assert.equal(artifacts.readPlan(task.id).draft, '# Durable draft');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('plan council restores a stage whose checkpoint field is empty from its stage file', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-plan-empty-field-'));
  const artifacts = new ArtifactStore(directory);
  const task = planTask(62, join(directory, 'project'));

  try {
    const first = await councilStoppedAfterDraft(artifacts, task, ['# Durable draft', '# Final after resume']);
    // Write the record directly so the empty field survives: the normal writer would
    // remove the stage file alongside it.
    const recordPath = join(artifacts.taskDirectory(task.id), 'plan.json');
    const record = JSON.parse(readFileSync(recordPath, 'utf8'));
    writeFileSync(recordPath, `${JSON.stringify({ ...record, draft: '' }, null, 2)}\n`, 'utf8');
    assert.equal(artifacts.readPlan(task.id).draft, '');

    first.allowReviewer();
    const result = await first.runner.run(task, { onEvent: () => {}, onStderr: () => {} });
    assert.equal(result.finalResponse, '# Final after resume');
    assert.equal(first.calls.claude, 2);
    assert.match(first.calls.reviewPrompts[1], /Durable draft/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('plan council backfills a missing stage file from the checkpoint record on resume', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-plan-backfill-'));
  const artifacts = new ArtifactStore(directory);
  const task = planTask(63, join(directory, 'project'));
  const draftPath = artifacts.planStagePath(task.id, 'draft', task.repo_path);

  try {
    const first = await councilStoppedAfterDraft(artifacts, task, ['# Durable draft', '# Final after resume']);
    rmSync(draftPath, { force: true });
    assert.equal(existsSync(draftPath), false);
    assert.equal(artifacts.readPlan(task.id).draft, '# Durable draft');

    first.allowReviewer();
    await first.runner.run(task, { onEvent: () => {}, onStderr: () => {} });
    assert.equal(readFileSync(draftPath, 'utf8'), '# Durable draft\n');
    assert.equal(
      readFileSync(artifacts.planStagePath(task.id, 'review', task.repo_path), 'utf8'),
      'Reconnect-safe review.\n',
    );
    assert.equal(first.calls.claude, 2);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a changed brief never resumes from the previous request stage files', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-plan-changed-brief-'));
  const artifacts = new ArtifactStore(directory);
  const task = planTask(64, join(directory, 'project'));
  const draftPath = artifacts.planStagePath(task.id, 'draft', task.repo_path);

  try {
    const first = await councilStoppedAfterDraft(
      artifacts,
      task,
      ['# Draft for the first brief', '# Draft for the second brief', '# Final for the second brief'],
    );
    assert.equal(readFileSync(draftPath, 'utf8'), '# Draft for the first brief\n');

    first.allowReviewer();
    const edited = { ...task, prompt: 'Plan a different migration.' };
    const result = await first.runner.run(edited, { onEvent: () => {}, onStderr: () => {} });
    assert.equal(result.finalResponse, '# Final for the second brief');
    // Three Claude calls: the discarded first draft, a fresh draft for the new brief, and
    // the revision. The stale draft.md described the previous request.
    assert.equal(first.calls.claude, 3);
    assert.match(first.calls.reviewPrompts[1], /Draft for the second brief/);
    assert.doesNotMatch(first.calls.reviewPrompts[1], /Draft for the first brief/);
    assert.equal(readFileSync(draftPath, 'utf8'), '# Draft for the second brief\n');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('the checkpoint is persisted before any stage file', () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-plan-persist-order-'));
  const observed = [];
  class OrderedArtifactStore extends ArtifactStore {
    writePlanStages(taskId, plan, repoPath) {
      observed.push(existsSync(join(this.taskDirectory(taskId), 'plan.json')));
      return super.writePlanStages(taskId, plan, repoPath);
    }
  }
  const artifacts = new OrderedArtifactStore(join(directory, 'relay-data', 'tasks'));

  try {
    artifacts.writePlan(66, {
      version: 2,
      taskId: 66,
      status: 'reviewing',
      draft: '# Saved draft',
      review: '',
      finalPlan: '',
      stages: [],
    }, { repoPath: join(directory, 'project') });

    // The checkpoint already existed when the project-side writes began, so a project
    // folder that refuses them can never cost the stage its saved text.
    assert.deepEqual(observed, [true]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a disowned stage file is removed before the checkpoint that disowns it', () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-plan-discard-order-'));
  // Each phase records the draft the checkpoint still held when it ran, which is what
  // separates "before the checkpoint" from "after" it deterministically.
  const observed = {};
  class PhaseOrderArtifactStore extends ArtifactStore {
    removePlanStages(taskId, targets, repoPath) {
      observed.atRemoval = this.readPlan(taskId)?.draft ?? null;
      return super.removePlanStages(taskId, targets, repoPath);
    }

    writePlanStages(taskId, plan, repoPath) {
      observed.atWrite = this.readPlan(taskId)?.draft ?? null;
      return super.writePlanStages(taskId, plan, repoPath);
    }
  }
  const artifacts = new PhaseOrderArtifactStore(join(directory, 'relay-data', 'tasks'));
  const repoPath = join(directory, 'project');
  const taskId = 69;
  const draftPath = artifacts.planStagePath(taskId, 'draft', repoPath);
  const record = (draft) => ({
    version: 2,
    taskId,
    status: 'drafting',
    draft,
    review: '',
    finalPlan: '',
    stages: [],
  });

  try {
    artifacts.writePlan(taskId, record('# Stale draft'), { repoPath });
    assert.equal(readFileSync(draftPath, 'utf8'), '# Stale draft\n');

    // The discard shape: a record that no longer owns the draft. A hard process death
    // between the checkpoint and the deletion would otherwise leave a stale draft.md
    // beside a fresh matching record, and the next resume would restore it.
    artifacts.writePlan(taskId, record(''), { repoPath });
    assert.equal(observed.atRemoval, '# Stale draft');
    assert.equal(observed.atWrite, '');
    assert.equal(existsSync(draftPath), false);
    assert.equal(artifacts.readPlan(taskId).draft, '');

    // Earned text still lands after the checkpoint, so a refused write cannot cost it.
    artifacts.writePlan(taskId, record('# Fresh draft'), { repoPath });
    assert.equal(observed.atRemoval, '');
    assert.equal(observed.atWrite, '# Fresh draft');
    assert.equal(readFileSync(draftPath, 'utf8'), '# Fresh draft\n');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a project folder that refuses a stage file still keeps the checkpoint', () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-plan-refused-stage-'));
  const artifacts = new ArtifactStore(join(directory, 'relay-data', 'tasks'));
  const repoPath = join(directory, 'project');
  const taskId = 67;
  const draftPath = artifacts.planStagePath(taskId, 'draft', repoPath);
  const reviewPath = artifacts.planStagePath(taskId, 'review', repoPath);
  const plan = {
    version: 2,
    taskId,
    status: 'revising',
    draft: '# Saved draft',
    review: 'Saved review.',
    finalPlan: '',
    stages: [],
  };
  // Occupy the draft file name with a directory, which refuses every write to it.
  mkdirSync(draftPath, { recursive: true });

  try {
    artifacts.writePlan(taskId, plan, { repoPath });
    const stored = artifacts.readPlan(taskId);
    assert.equal(stored.draft, '# Saved draft');
    assert.equal(stored.review, 'Saved review.');
    // The record reports what exists, so the panel cannot advertise a missing file.
    assert.equal(stored.stageArtifacts.draft, null);
    assert.equal(stored.stageArtifacts.review, reviewPath);
    assert.equal(readFileSync(reviewPath, 'utf8'), 'Saved review.\n');

    rmSync(draftPath, { recursive: true, force: true });
    artifacts.writePlan(taskId, plan, { repoPath });
    assert.equal(readFileSync(draftPath, 'utf8'), '# Saved draft\n');
    assert.equal(artifacts.readPlan(taskId).stageArtifacts.draft, draftPath);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a council whose stage file cannot be written still completes and saves its plan', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-plan-refused-stage-run-'));
  const artifacts = new ArtifactStore(directory);
  const task = planTask(68, join(directory, 'project'));
  const draftPath = artifacts.planStagePath(task.id, 'draft', task.repo_path);
  mkdirSync(draftPath, { recursive: true });
  let claudeCalls = 0;
  const runner = new PlanCouncilRunner({
    artifacts,
    claude: {
      async run() {
        claudeCalls += 1;
        return { finalResponse: claudeCalls === 1 ? '# Draft that cannot be filed' : '# Final plan' };
      },
      cancel() { return true; },
    },
    codex: {
      async run() {
        return { finalResponse: 'Review that can be filed.', sessionId: 'thread-two' };
      },
      cancel() { return true; },
    },
  });

  try {
    // A refused stage file is not a stage failure. Before stage files existed, this same
    // project folder could not fail a draft either.
    const result = await runner.run(task, { onEvent: () => {}, onStderr: () => {} });
    assert.equal(result.finalResponse, '# Final plan');
    const plan = artifacts.readPlan(task.id);
    assert.equal(plan.status, 'complete');
    assert.equal(plan.draft, '# Draft that cannot be filed');
    assert.equal(plan.stageArtifacts.draft, null);
    assert.equal(
      readFileSync(artifacts.planStagePath(task.id, 'review', task.repo_path), 'utf8'),
      'Review that can be filed.\n',
    );
    assert.equal(readFileSync(artifacts.planPath(task.id, task.repo_path), 'utf8'), '# Final plan\n');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('discarding a plan removes its stage files and a preserved plan keeps them', () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-plan-stage-cleanup-'));
  const artifacts = new ArtifactStore(join(directory, 'relay-data', 'tasks'));
  const repoPath = join(directory, 'project');
  const taskId = 65;
  const draftPath = artifacts.planStagePath(taskId, 'draft', repoPath);
  const reviewPath = artifacts.planStagePath(taskId, 'review', repoPath);
  const plan = {
    version: 2,
    taskId,
    status: 'reviewing',
    draft: '# Saved draft',
    review: 'Saved review.',
    finalPlan: '',
    stages: [],
  };

  try {
    artifacts.writePlan(taskId, plan, { repoPath });
    assert.equal(readFileSync(draftPath, 'utf8'), '# Saved draft\n');
    assert.equal(readFileSync(reviewPath, 'utf8'), 'Saved review.\n');

    artifacts.clearOutcome(taskId, { preservePlan: true, repoPath });
    assert.equal(existsSync(draftPath), true);
    assert.equal(existsSync(reviewPath), true);

    artifacts.clearOutcome(taskId, { repoPath });
    assert.equal(existsSync(draftPath), false);
    assert.equal(existsSync(reviewPath), false);

    artifacts.writePlan(taskId, plan, { repoPath });
    artifacts.deleteTask(taskId, { repoPath });
    assert.equal(existsSync(draftPath), false);
    assert.equal(existsSync(reviewPath), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('plan council emits liveness heartbeats and stops a stage that exceeds its safety limit', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-plan-timeout-'));
  const artifacts = new ArtifactStore(directory);
  const task = planTask(54, join(directory, 'project'));
  const events = [];
  let cancellations = 0;
  let cancelledTaskId = null;
  const runner = new PlanCouncilRunner({
    artifacts,
    heartbeatMs: 5,
    stageTimeoutMs: 20,
    claude: {
      run() { return new Promise(() => {}); },
      cancel(taskId) { cancellations += 1; cancelledTaskId = taskId; return true; },
    },
    codex: { async run() { throw new Error('Reviewer should not run.'); }, cancel() { return true; } },
  });

  try {
    await assert.rejects(
      runner.run(task, { onEvent: (event) => events.push(event), onStderr: () => {} }),
      /safety limit/,
    );
    assert.equal(cancellations, 1);
    assert.equal(cancelledTaskId, task.id);
    assert.equal(events.some(({ event }) => event.type === 'plan/heartbeat' && event.phase === 'draft'), true);
    assert.equal(artifacts.readPlan(task.id).failedStage, 'draft');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
