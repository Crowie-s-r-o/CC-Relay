#!/usr/bin/env node

const BASE_URL = 'http://127.0.0.1:4768';

async function request(path, options = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json' },
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error || `Relay request failed with status ${response.status}.`);
  }
  return body;
}

function option(args, name) {
  const index = args.indexOf(name);
  return index === -1 ? null : args[index + 1] ?? null;
}

function printTask(task) {
  console.log(`#${task.id} [${task.status}] ${task.title}`);
  console.log(`  ${task.thread_name || 'Legacy task'} (${task.repo_path})`);
  if (task.error) {
    console.log(`  Error: ${task.error}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'status';

  if (command === 'status') {
    const status = await request('/api/status');
    console.log(`Queue: ${status.paused ? 'paused' : 'running'}`);
    console.log(`Active task: ${status.activeTaskId ?? 'none'}`);
    console.log(`Codex: ${status.codex.available && status.codex.authenticated ? status.codex.version : 'not ready'}`);
    console.log(`Shared server: ${status.codex.appServer.connected ? status.codex.appServer.endpoint : 'not connected'}`);
    console.log(`Tasks: ${status.taskCount}`);
    return;
  }

  if (command === 'connect') {
    const status = await request('/api/status');
    console.log(status.codex.appServer.launchCommand);
    return;
  }

  if (command === 'list') {
    const { tasks } = await request('/api/tasks');
    if (tasks.length === 0) {
      console.log('Relay queue is empty.');
      return;
    }
    tasks.forEach(printTask);
    return;
  }

  if (command === 'threads') {
    const { threads } = await request('/api/threads');
    if (threads.length === 0) {
      console.log('No Relay-connected Codex terminals found. Run the connect command for launch instructions.');
      return;
    }
    for (const thread of threads) {
      console.log(`${thread.id} [${thread.status}] ${thread.title}`);
      console.log(`  ${thread.cwd}`);
    }
    return;
  }

  if (command === 'add') {
    const threadId = option(args, '--thread');
    const prompt = option(args, '--prompt');
    if (!threadId || !prompt) {
      throw new Error('Usage: add --thread <thread-id> --prompt "Prompt"');
    }
    const { task } = await request('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({ threadId, prompt }),
    });
    printTask(task);
    return;
  }

  if (command === 'pause' || command === 'resume') {
    const status = await request(`/api/queue/${command}`, { method: 'POST' });
    console.log(`Relay queue is ${status.paused ? 'paused' : 'running'}.`);
    return;
  }

  if (command === 'retry' || command === 'cancel') {
    const taskId = Number(args[1]);
    if (!Number.isInteger(taskId) || taskId < 1) {
      throw new Error(`Usage: ${command} <task-id>`);
    }
    const { task } = await request(`/api/tasks/${taskId}/${command}`, { method: 'POST' });
    printTask(task);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(`Relay: ${error.message}`);
  process.exitCode = 1;
});
