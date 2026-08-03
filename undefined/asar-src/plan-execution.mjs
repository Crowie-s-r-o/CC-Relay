import { resolve } from 'node:path';

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function validatePlanExecution({ sourceTask, plan, thread, provider }) {
  if (!sourceTask || sourceTask.mode !== 'plan') {
    throw new Error('Only a Plan council task can be executed as a reviewed plan.');
  }
  if (sourceTask.status !== 'complete' || plan?.status !== 'complete') {
    throw new Error('The Plan council must complete before its plan can be executed.');
  }
  if (!text(plan.finalPlan)) {
    throw new Error('The completed Plan council does not contain a final plan.');
  }
  if (!thread || !['codex', 'claude'].includes(provider)) {
    throw new Error('Choose a connected CC Relay to execute the reviewed plan.');
  }
  if (!text(thread.cwd) || !text(sourceTask.repo_path)) {
    throw new Error('The reviewed plan and target CC Relay must identify their workspace.');
  }
  if (resolve(thread.cwd || '') !== resolve(sourceTask.repo_path || '')) {
    throw new Error('The reviewed plan can only run on a CC Relay in the same workspace.');
  }
  return text(plan.finalPlan);
}

export function buildPlanExecutionPrompt({ sourceTask, plan, planPath }) {
  const finalPlan = text(plan?.finalPlan);
  if (!finalPlan) {
    throw new Error('A final reviewed plan is required.');
  }
  return `Implement the reviewed plan below in the current repository.

Treat the original request and the final reviewed plan as the authoritative scope. Inspect the current repository before editing, follow every repository instruction file, reconcile harmless line-number drift, and stop for user input only if the repository now conflicts with a material product decision. Complete the implementation, run proportionate verification, and report the result.

The canonical plan is stored at:
${planPath}

<original-user-request>
${sourceTask.prompt}
</original-user-request>

<final-reviewed-plan>
${finalPlan}
</final-reviewed-plan>`;
}

export function planExecutionTitle(sourceTask) {
  const title = `Execute reviewed plan: ${text(sourceTask?.title) || `Task ${sourceTask?.id || ''}`}`.trim();
  return title.length > 80 ? `${title.slice(0, 77)}...` : title;
}
