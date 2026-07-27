import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
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

test('project-scoped plan writes replace the legacy Relay-local artifact', () => {
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
        if (!reviewerAvailable) throw new Error('Review Relay disconnected.');
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
        assert.match(error.message, /Review Relay disconnected/);
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
