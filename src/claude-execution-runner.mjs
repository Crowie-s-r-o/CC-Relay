import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { ClaudeTerminalExecutor } from './claude-terminal-executor.mjs';

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export class ClaudeExecutionError extends Error {
  constructor(message, {
    cancelled = false,
    exitCode = null,
    missingConversation = false,
    missingConversationSessionId = null,
    sessionInUseSessionId = null,
    retryable = true,
  } = {}) {
    super(message);
    this.name = 'ClaudeExecutionError';
    this.cancelled = cancelled;
    this.exitCode = exitCode;
    this.missingConversation = missingConversation;
    this.missingConversationSessionId = missingConversationSessionId;
    this.sessionInUseSessionId = sessionInUseSessionId;
    this.retryable = retryable;
  }
}

const MISSING_CONVERSATION = /No conversation found with session ID:\s*([^\s]+)/i;
const SESSION_ID_IN_USE = /Session ID\s+([^\s]+)\s+is already in use/i;

function missingConversationSessionId(value) {
  return String(value || '').match(MISSING_CONVERSATION)?.[1]?.trim() || null;
}

function sessionIdInUse(value) {
  return String(value || '').match(SESSION_ID_IN_USE)?.[1]?.trim() || null;
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
    if (typeof message.session_id === 'string' && message.session_id.trim()) {
      context.sessionId = message.session_id.trim();
      context.reportedSessionId = context.sessionId;
    }
    if (message.is_error || String(message.subtype || '').startsWith('error')) {
      context.error = context.finalResponse || message.error || 'Claude could not complete the task.';
    }
  }
  return emitted;
}

export function taskPrompt(task) {
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
    platform = process.platform,
    resolveTerminal = null,
    terminalExecutor = null,
  } = {}) {
    this.command = command;
    this.spawnProcess = spawnProcess;
    this.sessions = sessions;
    this.wait = wait;
    this.platform = platform;
    this.resolveTerminal = resolveTerminal;
    this.terminalExecutor = terminalExecutor
      || new ClaudeTerminalExecutor({ sessions, wait, resolveTerminal });
    this.activeByTask = new Map();
    this.activeBySession = new Map();
  }

  async waitForIdle(task, active, onEvent) {
    if (!this.sessions) {
      return null;
    }
    let announced = false;
    while (!active.cancelRequested) {
      const session = await this.sessions.readConnectedSession(task.thread_id);
      if (!session) {
        throw new ClaudeExecutionError(
          'The selected Claude terminal is no longer open. Choose a live Claude session and retry.',
          { retryable: false },
        );
      }
      if (session.rawStatus !== 'busy') {
        return session;
      }
      if (task.sessionFollowUp) {
        throw new ClaudeExecutionError(
          'That Claude terminal became busy. Your follow-up was not queued.',
          { retryable: false },
        );
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

  validateFreshSession(task, active, session) {
    if (active.cancelRequested) {
      throw new ClaudeExecutionError('Task cancelled.', { cancelled: true });
    }
    if (!session) {
      throw new ClaudeExecutionError(
        'The selected Claude terminal closed before Relay could start its first turn. Reopen it and retry.',
        { retryable: false },
      );
    }
    if (session.id !== task.thread_id || session.source !== 'Claude interactive') {
      throw new ClaudeExecutionError(
        'The selected Claude session is no longer the live interactive terminal Relay opened. Choose that terminal again and retry.',
        { retryable: false },
      );
    }
    if (
      typeof session.cwd !== 'string'
      || !session.cwd.trim()
      || typeof task.repo_path !== 'string'
      || !task.repo_path.trim()
      || resolve(session.cwd) !== resolve(task.repo_path)
    ) {
      throw new ClaudeExecutionError(
        'The selected Claude terminal belongs to a different workspace. Choose a Claude terminal opened for this project and retry.',
        { retryable: false },
      );
    }
  }

  async runProcess(
    task,
    active,
    args,
    { onEvent, onStderr },
    {
      model,
      sessionMode,
      suppressMissingConversationStderr = false,
      suppressSessionInUseStderr = false,
    },
  ) {
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
      reportedSessionId: null,
      error: null,
    };
    let stdoutBuffer = '';
    let stderrBuffer = '';
    const stderrLines = [];

    onEvent({
      event: {
        type: 'claude/started',
        provider: 'claude',
        sessionId: task.thread_id,
        sessionMode,
        model: model || 'session default',
        effort: task.effort || 'default',
      },
      message: sessionMode === 'fresh'
        ? `Claude started the first Relay turn in ${task.thread_name || task.thread_id}.`
        : `Claude is resuming ${task.thread_name || task.thread_id}.`,
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
    const consumeStderr = (line) => {
      if (!line.trim()) return;
      stderrLines.push(line.trim());
      const suppressMissing = suppressMissingConversationStderr
        && missingConversationSessionId(line) === task.thread_id;
      const suppressInUse = suppressSessionInUseStderr
        && sessionIdInUse(line) === task.thread_id;
      if (!suppressMissing && !suppressInUse) {
        onStderr(line.trim());
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
      for (const line of lines) {
        consumeStderr(line);
      }
    });
    const outcomePromise = new Promise((resolve, reject) => {
      child.once('error', (error) => {
        reject(new ClaudeExecutionError(`Could not start Claude Code: ${error.message}`));
      });
      child.once('close', (code, signal) => {
        consumeLine(stdoutBuffer);
        consumeStderr(stderrBuffer);
        if (active.cancelRequested) {
          reject(new ClaudeExecutionError('Task cancelled.', { cancelled: true, exitCode: code }));
          return;
        }
        const stderrMessage = stderrLines.join('\n').trim();
        if (code !== 0 || context.error) {
          const classificationText = [stderrMessage, context.error].filter(Boolean).join('\n');
          const missingSessionId = missingConversationSessionId(classificationText);
          const inUseSessionId = sessionIdInUse(classificationText);
          const message = stderrMessage
            || context.error
            || `Claude Code stopped${signal ? ` after ${signal}` : ` with code ${code}`}.`;
          reject(new ClaudeExecutionError(message, {
            exitCode: code,
            missingConversation: Boolean(missingSessionId),
            missingConversationSessionId: missingSessionId,
            sessionInUseSessionId: inUseSessionId,
            retryable: !missingSessionId && !inUseSessionId,
          }));
          return;
        }
        if (!context.finalResponse) {
          reject(new ClaudeExecutionError('Claude completed without a final text response.', { exitCode: code }));
          return;
        }
        resolve({
          finalResponse: context.finalResponse,
          sessionId: context.sessionId,
          reportedSessionId: context.reportedSessionId,
          exitCode: 0,
        });
      });
    });
    child.stdin.end(taskPrompt(task));
    try {
      return await outcomePromise;
    } finally {
      if (active.child === child) active.child = null;
    }
  }

  async run(task, { onEvent, onStderr }) {
    if (!task.thread_id) {
      throw new ClaudeExecutionError('Claude execution needs a terminal session ID.', { retryable: false });
    }
    const taskKey = task.id ?? task.thread_id;
    if (this.activeByTask.has(taskKey)) {
      throw new ClaudeExecutionError('That Claude task is already running.');
    }
    if (this.activeBySession.has(task.thread_id)) {
      throw new ClaudeExecutionError('That Claude session already has an active Relay task.');
    }
    const active = {
      taskId: taskKey,
      sessionId: task.thread_id,
      child: null,
      cancelRequested: false,
    };
    this.activeByTask.set(taskKey, active);
    this.activeBySession.set(task.thread_id, active);

    try {
      const session = await this.waitForIdle(task, active, onEvent);
      const terminal = await this.resolveTerminalTarget(session, active);
      const outcome = terminal
        ? await this.terminalExecutor.runTurn(task, active, session, terminal, { onEvent, onStderr })
        : await this.runHeadless(task, active, { onEvent, onStderr });
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
      if (this.activeByTask.get(taskKey) === active) this.activeByTask.delete(taskKey);
      if (this.activeBySession.get(task.thread_id) === active) this.activeBySession.delete(task.thread_id);
    }
  }

  // Decide whether this turn can run inside the interactive terminal on macOS. Returns the
  // owned single-tab Terminal.app identity, or null to use the headless path. Any resolution
  // failure falls back to headless; once a terminal is chosen the runner never falls back,
  // so a failed injection cannot double-execute the turn.
  async resolveTerminalTarget(session, active) {
    if (active.cancelRequested) return null;
    if (this.platform !== 'darwin') return null;
    if (typeof this.resolveTerminal !== 'function') return null;
    try {
      const terminal = await this.resolveTerminal(session);
      if (terminal
        && Number.isInteger(terminal.terminalWindowId)
        && terminal.terminalWindowId > 0) {
        return terminal;
      }
    } catch {
      // fall back to the headless path when terminal identity cannot be resolved
    }
    return null;
  }

  async runHeadless(task, active, { onEvent, onStderr }) {
    const attachmentDirectories = [...new Set(
      (task.attachments || []).map((attachment) => dirname(attachment.path)),
    )];
    const model = selectedModel(task.model);
    const commonArgs = [
      '-p',
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
    let outcome;
    try {
      outcome = await this.runProcess(task, active, [
        ...commonArgs,
        '--resume',
        task.thread_id,
      ], { onEvent, onStderr }, {
        model,
        sessionMode: 'resume',
        suppressMissingConversationStderr: true,
      });
    } catch (error) {
      if (
        !error.missingConversation
        || error.missingConversationSessionId !== task.thread_id
        || active.cancelRequested
      ) throw error;
      const freshSession = await this.waitForIdle(task, active, onEvent);
      this.validateFreshSession(task, active, freshSession);
      onEvent({
        event: {
          type: 'claude/session-initializing',
          provider: 'claude',
          sessionId: task.thread_id,
        },
        message: `Claude has no saved transcript in ${task.thread_name || task.thread_id} yet. Relay is starting its first turn with the same session ID.`,
      });
      try {
        outcome = await this.runProcess(task, active, [
          ...commonArgs,
          '--session-id',
          task.thread_id,
        ], { onEvent, onStderr }, {
          model,
          sessionMode: 'fresh',
          suppressSessionInUseStderr: true,
        });
      } catch (freshError) {
        if (freshError.sessionInUseSessionId !== task.thread_id || active.cancelRequested) {
          throw freshError;
        }
        const resumableSession = await this.waitForIdle(task, active, onEvent);
        this.validateFreshSession(task, active, resumableSession);
        onEvent({
          event: {
            type: 'claude/session-initializing',
            provider: 'claude',
            sessionId: task.thread_id,
          },
          message: 'Claude saved the transcript during initialization. Relay is resuming the same session.',
        });
        outcome = await this.runProcess(task, active, [
          ...commonArgs,
          '--resume',
          task.thread_id,
        ], { onEvent, onStderr }, { model, sessionMode: 'resume' });
      }
      if (outcome.reportedSessionId !== task.thread_id) {
        throw new ClaudeExecutionError(
          `Claude did not confirm the selected session ID after its first turn. Expected ${task.thread_id}, received ${outcome.reportedSessionId || 'none'}.`,
          { retryable: false },
        );
      }
    }
    return outcome;
  }

  cancel(taskId = null) {
    if (taskId !== null && taskId !== undefined) {
      const active = this.activeByTask.get(taskId) || this.activeBySession.get(taskId);
      if (!active) return false;
      active.cancelRequested = true;
      active.child?.kill('SIGTERM');
      return true;
    }
    const activeTasks = [...new Set(this.activeByTask.values())];
    for (const active of activeTasks) {
      active.cancelRequested = true;
      active.child?.kill('SIGTERM');
    }
    return activeTasks.length > 0;
  }
}
