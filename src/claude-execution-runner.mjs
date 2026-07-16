import { spawn } from 'node:child_process';
import { dirname } from 'node:path';

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export class ClaudeExecutionError extends Error {
  constructor(message, { cancelled = false, exitCode = null } = {}) {
    super(message);
    this.name = 'ClaudeExecutionError';
    this.cancelled = cancelled;
    this.exitCode = exitCode;
  }
}

function resultText(content) {
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    return '';
  }
  return content.map((item) => {
    if (typeof item === 'string') {
      return item;
    }
    return item?.text || item?.content || '';
  }).filter(Boolean).join('\n');
}

function toolItem(block, cwd) {
  const input = block.input || {};
  if (block.name === 'Bash') {
    return {
      type: 'commandExecution',
      id: block.id,
      command: input.command || 'Claude Bash command',
      cwd,
      status: 'inProgress',
      aggregatedOutput: null,
      exitCode: null,
    };
  }
  if (['Edit', 'Write', 'NotebookEdit'].includes(block.name)) {
    const path = input.file_path || input.notebook_path || 'workspace file';
    return {
      type: 'fileChange',
      id: block.id,
      changes: [{
        path,
        kind: { type: block.name === 'Write' ? 'create' : 'update' },
      }],
      status: 'inProgress',
    };
  }
  return {
    type: 'mcpToolCall',
    id: block.id,
    server: 'Claude Code',
    tool: block.name || 'tool',
    arguments: input,
    status: 'inProgress',
    result: null,
  };
}

function completedToolItem(item, block) {
  const text = resultText(block.content);
  const failed = Boolean(block.is_error);
  if (item.type === 'commandExecution') {
    return {
      ...item,
      status: failed ? 'failed' : 'completed',
      aggregatedOutput: text,
      exitCode: failed ? 1 : 0,
    };
  }
  if (item.type === 'fileChange') {
    return { ...item, status: failed ? 'failed' : 'completed', result: text };
  }
  return {
    ...item,
    status: failed ? 'failed' : 'completed',
    result: { content: text ? [{ type: 'text', text }] : [] },
  };
}

export function consumeClaudeStreamMessage(message, context) {
  const emitted = [];
  if (message.type === 'assistant') {
    for (const block of message.message?.content || []) {
      if (block.type === 'tool_use' && block.id) {
        const item = toolItem(block, context.cwd);
        context.tools.set(block.id, item);
        emitted.push({
          event: { type: 'item/started', provider: 'claude', item },
          message: `${item.type === 'commandExecution' ? 'Running' : 'Claude started'}: ${block.name || 'tool'}`,
        });
      } else if (block.type === 'text' && block.text?.trim()) {
        emitted.push({
          event: {
            type: 'claude/message',
            provider: 'claude',
            text: block.text.trim(),
          },
          message: block.text.trim(),
        });
      }
    }
  }

  if (message.type === 'user') {
    for (const block of message.message?.content || []) {
      if (block.type !== 'tool_result' || !block.tool_use_id) {
        continue;
      }
      const item = context.tools.get(block.tool_use_id);
      if (!item) {
        continue;
      }
      const completedItem = completedToolItem(item, block);
      context.tools.delete(block.tool_use_id);
      emitted.push({
        event: { type: 'item/completed', provider: 'claude', item: completedItem },
        message: completedItem.type === 'commandExecution'
          ? `Command ${completedItem.status}: ${completedItem.command}`
          : `Claude ${completedItem.tool || 'file change'} ${completedItem.status}.`,
      });
    }
  }

  if (message.type === 'result') {
    context.finalResponse = typeof message.result === 'string' ? message.result.trim() : '';
    context.sessionId = message.session_id || context.sessionId;
    if (message.is_error || String(message.subtype || '').startsWith('error')) {
      context.error = context.finalResponse || message.error || 'Claude could not complete the task.';
    }
  }
  return emitted;
}

function taskPrompt(task) {
  if (!task.attachments?.length) {
    return task.prompt;
  }
  return `${task.prompt}\n\nReference images are attached. Use the Read tool to inspect every image before working:\n${task.attachments
    .map((attachment, index) => `${index + 1}. ${attachment.name}: ${attachment.path}`)
    .join('\n')}`;
}

function selectedModel(model) {
  if (!model || model === 'default') {
    return null;
  }
  return model === 'best' ? 'fable' : model;
}

export class ClaudeExecutionRunner {
  constructor({
    command = 'claude',
    spawnProcess = spawn,
    sessions,
    wait = delay,
  } = {}) {
    this.command = command;
    this.spawnProcess = spawnProcess;
    this.sessions = sessions;
    this.wait = wait;
    this.active = null;
  }

  async waitForIdle(task, active, onEvent) {
    if (!this.sessions) {
      return;
    }
    let announced = false;
    while (!active.cancelRequested) {
      const session = await this.sessions.readConnectedSession(task.thread_id);
      if (!session || session.rawStatus !== 'busy') {
        return;
      }
      if (!announced) {
        onEvent({
          event: { type: 'claude/waiting', provider: 'claude', sessionId: task.thread_id },
          message: 'Waiting for the selected Claude session to become idle.',
        });
        announced = true;
      }
      await this.wait(1_000);
    }
    throw new ClaudeExecutionError('Task cancelled.', { cancelled: true });
  }

  async run(task, { onEvent, onStderr }) {
    if (this.active) {
      throw new ClaudeExecutionError('Claude already has an active Relay task.');
    }
    const active = { child: null, cancelRequested: false };
    this.active = active;

    try {
      await this.waitForIdle(task, active, onEvent);
      const attachmentDirectories = [...new Set(
        (task.attachments || []).map((attachment) => dirname(attachment.path)),
      )];
      const model = selectedModel(task.model);
      const args = [
        '-p',
        '--resume',
        task.thread_id,
        '--permission-mode',
        'auto',
        '--output-format',
        'stream-json',
        '--verbose',
        '--no-chrome',
        ...attachmentDirectories.flatMap((directory) => ['--add-dir', directory]),
        ...(model ? ['--model', model] : []),
        ...(task.effort ? ['--effort', task.effort] : []),
      ];
      const child = this.spawnProcess(this.command, args, {
        cwd: task.repo_path,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      active.child = child;
      const context = {
        cwd: task.repo_path,
        tools: new Map(),
        finalResponse: '',
        sessionId: task.thread_id,
        error: null,
      };
      let stdoutBuffer = '';
      let stderrBuffer = '';

      onEvent({
        event: {
          type: 'claude/started',
          provider: 'claude',
          sessionId: task.thread_id,
          model: model || 'session default',
          effort: task.effort || 'default',
        },
        message: `Claude resumed ${task.thread_name || task.thread_id}.`,
      });

      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      const consumeLine = (line) => {
        if (!line.trim()) {
          return;
        }
        try {
          const message = JSON.parse(line);
          for (const event of consumeClaudeStreamMessage(message, context)) {
            onEvent(event);
          }
        } catch (error) {
          onStderr(`Could not parse Claude stream event: ${error.message}`);
        }
      };
      child.stdout.on('data', (chunk) => {
        stdoutBuffer += chunk;
        const lines = stdoutBuffer.split('\n');
        stdoutBuffer = lines.pop() || '';
        for (const line of lines) {
          consumeLine(line);
        }
      });
      child.stderr.on('data', (chunk) => {
        stderrBuffer += chunk;
        const lines = stderrBuffer.split('\n');
        stderrBuffer = lines.pop() || '';
        for (const line of lines.filter(Boolean)) {
          onStderr(line);
        }
      });
      const outcomePromise = new Promise((resolve, reject) => {
        child.once('error', (error) => {
          reject(new ClaudeExecutionError(`Could not start Claude Code: ${error.message}`));
        });
        child.once('close', (code, signal) => {
          consumeLine(stdoutBuffer);
          if (stderrBuffer.trim()) {
            onStderr(stderrBuffer.trim());
          }
          if (active.cancelRequested) {
            reject(new ClaudeExecutionError('Task cancelled.', { cancelled: true, exitCode: code }));
            return;
          }
          if (code !== 0 || context.error) {
            reject(new ClaudeExecutionError(
              context.error || `Claude Code stopped${signal ? ` after ${signal}` : ` with code ${code}`}.`,
              { exitCode: code },
            ));
            return;
          }
          if (!context.finalResponse) {
            reject(new ClaudeExecutionError('Claude completed without a final text response.', { exitCode: code }));
            return;
          }
          resolve({
            finalResponse: context.finalResponse,
            sessionId: context.sessionId,
            exitCode: 0,
          });
        });
      });
      child.stdin.end(taskPrompt(task));
      const outcome = await outcomePromise;
      onEvent({
        event: {
          type: 'claude/completed',
          provider: 'claude',
          sessionId: outcome.sessionId,
        },
        message: 'Claude completed the task.',
      });
      return outcome;
    } finally {
      this.active = null;
    }
  }

  cancel() {
    if (!this.active) {
      return false;
    }
    this.active.cancelRequested = true;
    this.active.child?.kill('SIGTERM');
    return true;
  }
}
