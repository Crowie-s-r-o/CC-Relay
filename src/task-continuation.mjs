import { sameWorkspacePath } from './claude-execution-runner.mjs';

export function buildSessionFollowUp({
  sourceTask,
  prompt,
  thread,
  execution,
  attachments = [],
  platform = process.platform,
}) {
  if (!sourceTask) throw new Error('Task not found.');
  if (sourceTask.mode !== 'execute' || !['codex', 'claude'].includes(sourceTask.provider)) {
    throw new Error('Only direct Codex or Claude tasks can continue in one terminal session.');
  }
  const normalizedPrompt = typeof prompt === 'string' ? prompt.trim() : '';
  if (!normalizedPrompt) throw new Error('Write a follow-up before sending it.');
  if (!thread || thread.id !== sourceTask.thread_id) {
    throw new Error('The original terminal session is not connected.');
  }
  // The typeof guards stay ahead of the comparison so a session with no reported cwd is still a
  // workspace mismatch rather than a resolve() TypeError. On Windows the reported cwd carries
  // whatever drive-letter and path case the shell recorded, so only the case-folding comparison
  // accepts the terminal this task actually owns. POSIX keeps the exact byte comparison.
  if (
    typeof thread.cwd !== 'string'
    || typeof sourceTask.repo_path !== 'string'
    || !sameWorkspacePath(thread.cwd, sourceTask.repo_path, platform)
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
