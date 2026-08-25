import { sameWorkspacePath } from './claude-execution-runner.mjs';

export function isTurboExecutionSession(task) {
  return task?.mode === 'turbo'
    && task.terminal_lifecycle === 'disposable'
    && task.provider === 'codex'
    && Boolean(task.turbo?.executionThreadId)
    && task.thread_id === task.turbo.executionThreadId;
}

export function buildSessionFollowUp({
  sourceTask,
  prompt,
  thread,
  execution,
  attachments = [],
  platform = process.platform,
}) {
  if (!sourceTask) throw new Error('Task not found.');
  const turboExecution = isTurboExecutionSession(sourceTask);
  const directExecution = sourceTask.mode === 'execute'
    && ['codex', 'claude'].includes(sourceTask.provider);
  if (!directExecution && !turboExecution) {
    throw new Error('Only direct tasks and completed Turbo execution sessions can continue.');
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
    ...(turboExecution ? {
      mode: 'execute',
      provider: 'codex',
      model: execution.model || sourceTask.turbo.workerModel,
      effort: execution.effort || sourceTask.turbo.workerEffort,
    } : {}),
    prompt: normalizedPrompt,
    ...(!turboExecution ? { model: execution.model, effort: execution.effort } : {}),
    attachments,
    sessionFollowUp: true,
  };
}
