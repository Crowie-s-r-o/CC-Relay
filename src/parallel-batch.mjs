export function buildParallelCodexPrompt(tasks) {
  if (!Array.isArray(tasks) || tasks.length < 2) {
    throw new Error('Select at least two queued tasks for parallel execution.');
  }
  const numberedTasks = tasks.map((task, index) => `${index + 1}. ${task.prompt.trim()}`).join('\n');
  return `Use sub-agents to execute the following numbered tasks in parallel as one coordinated Codex command.

Treat this entire message as one command. Delegate each numbered task to its own sub-agent when possible. Start all independent work concurrently. Keep every sub-agent inside the current project and give each one only its assigned task. Wait for all sub-agents to finish, verify their results, resolve overlapping edits carefully, run the relevant checks for the combined work, and return one consolidated summary that reports the outcome of every numbered task.

Tasks:

${numberedTasks}`;
}
