import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildPlanExecutionPrompt,
  planExecutionTitle,
  validatePlanExecution,
} from '../src/plan-execution.mjs';

function fixture() {
  return {
    sourceTask: {
      id: 19,
      title: 'Reviewed migration',
      prompt: 'Move the data safely.',
      repo_path: '/tmp/project',
      mode: 'plan',
      status: 'complete',
    },
    plan: {
      status: 'complete',
      finalPlan: '# Migration plan\n\n1. Add compatibility.\n2. Verify rollback.',
    },
    thread: { id: 'relay-one', cwd: '/tmp/project' },
  };
}

test('reviewed plan execution includes the original request and canonical final plan', () => {
  const input = fixture();
  const finalPlan = validatePlanExecution({ ...input, provider: 'codex' });
  assert.equal(finalPlan, input.plan.finalPlan);
  const prompt = buildPlanExecutionPrompt({
    sourceTask: input.sourceTask,
    plan: input.plan,
    planPath: '/tmp/relay/tasks/19/plan.md',
  });
  assert.match(prompt, /Move the data safely\./);
  assert.match(prompt, /Add compatibility/);
  assert.match(prompt, /Verify rollback/);
  assert.match(prompt, /\/tmp\/relay\/tasks\/19\/plan\.md/);
  assert.equal(planExecutionTitle(input.sourceTask), 'Execute reviewed plan: Reviewed migration');
});

test('reviewed plan execution accepts either direct provider in the same workspace', () => {
  const input = fixture();
  assert.equal(validatePlanExecution({ ...input, provider: 'codex' }), input.plan.finalPlan);
  assert.equal(validatePlanExecution({ ...input, provider: 'claude' }), input.plan.finalPlan);
});

test('reviewed plan execution rejects incomplete plans and cross-workspace Relays', () => {
  const input = fixture();
  assert.throws(
    () => validatePlanExecution({ ...input, plan: { ...input.plan, status: 'reviewing' }, provider: 'codex' }),
    /must complete/,
  );
  assert.throws(
    () => validatePlanExecution({ ...input, thread: { cwd: '/tmp/other' }, provider: 'codex' }),
    /same workspace/,
  );
  assert.throws(
    () => validatePlanExecution({ ...input, plan: { ...input.plan, finalPlan: '' }, provider: 'codex' }),
    /does not contain a final plan/,
  );
});
