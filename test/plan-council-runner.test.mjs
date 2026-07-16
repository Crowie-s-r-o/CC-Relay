import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ArtifactStore } from '../src/artifacts.mjs';
import { PlanCouncilRunner } from '../src/plan-council-runner.mjs';

test('plan council records Claude draft, Codex review, and Claude revision', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-plan-'));
  const artifacts = new ArtifactStore(directory);
  const claudePrompts = [];
  const codexTasks = [];
  const events = [];
  const claude = {
    async run(prompt, options) {
      claudePrompts.push({ prompt, options });
      options.onEvent({ event: { type: 'claude/started' }, message: 'Claude started.' });
      return {
        text: claudePrompts.length === 1 ? '# Draft\n\nFirst version.' : '# Final\n\nReviewed version.',
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
  const task = {
    id: 42,
    prompt: 'Plan a safe migration.',
    repo_path: '/tmp/repository',
    thread_id: 'thread-one',
    thread_name: 'Review terminal',
    author_provider: 'claude',
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

  try {
    const result = await runner.run(task, {
      onEvent: (event) => events.push(event),
      onStderr: () => {},
    });
    assert.equal(result.finalResponse, '# Final\n\nReviewed version.');
    assert.equal(claudePrompts.length, 2);
    assert.match(claudePrompts[1].prompt, /Fix verification/);
    assert.match(claudePrompts[0].prompt, /architecture\.png/);
    assert.deepEqual(claudePrompts[0].options.attachmentPaths, ['/tmp/relay-plan-images/01.png']);
    assert.deepEqual(claudePrompts[1].options.attachmentPaths, ['/tmp/relay-plan-images/01.png']);
    assert.equal(codexTasks.length, 1);
    assert.equal(codexTasks[0].read_only, true);
    assert.equal(codexTasks[0].model, 'gpt-test');
    assert.equal(codexTasks[0].attachments[0].name, 'architecture.png');
    assert.equal(events.some(({ event }) => event.provider === 'claude'), true);
    assert.equal(events.some(({ event }) => event.provider === 'codex'), true);

    const plan = artifacts.readPlan(task.id);
    assert.equal(plan.status, 'complete');
    assert.match(plan.draft, /First version/);
    assert.match(plan.review, /Fix verification/);
    assert.match(plan.finalPlan, /Reviewed version/);
    assert.equal(plan.attachments[0].name, 'architecture.png');
    const markdown = readFileSync(join(directory, '42', 'plan.md'), 'utf8');
    assert.match(markdown, /## Claude draft/);
    assert.match(markdown, /## Codex review/);
    assert.match(markdown, /## Reference images[\s\S]*architecture\.png/);
    assert.match(markdown, /## Final revised plan/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
