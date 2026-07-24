import { resolve } from 'node:path';

export function buildSessionFollowUp({ sourceTask, prompt, thread, execution, attachments = [] }) {
  if (!sourceTask) throw new Error('Task not found.');
  if (sourceTask.mode !== 'execute' || !['codex', 'claude'].includes(sourceTask.provider)) {
    throw new Error('Only direct Codex or Claude tasks can continue in one terminal session.');
  }
  const normalizedPrompt = typeof prompt === 'string' ? prompt.trim() : '';
  if (!normalizedPrompt) throw new Error('Write a follow-up before sending it.');
  if (!thread || thread.id !== sourceTask.thread_id) {
    throw new Error('The original terminal session is not connected.');
  }
  if (
    typeof thread.cwd !== 'string'
    || typeof sourceTask.repo_path !== 'string'
    || resolve(thread.cwd) !== resolve(sourceTask.repo_path)
  ) {
    throw new Error('The original session is connected to a different workspace and cannot continue this task.');
  }
  return {
    ...sourceTask,
    prompt: normalizedPrompt,
    model: execution.model,
    effort: execution.effort,
    attachments,
    sessionFollowUp: true,
  };
}
