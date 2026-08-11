import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { providerCommandInvocation, terminateChildProcess } from './claude-binary.mjs';
import { ClaudeTerminalExecutor } from './claude-terminal-executor.mjs';
import { injectionPromptIssue } from './claude-transcript-tail.mjs';
import { normalizeClaudeModel } from './model-catalog.mjs';
import { withRelayNonInteractiveInstruction } from './relay-prompt.mjs';

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export class ClaudeExecutionError extends Error {
  constructor(message, {
    cancelled = false,
    deliveryUncertain = false,
    exitCode = null,
    missingConversation = false,
    missingConversationSessionId = null,
    sessionInUseSessionId = null,
    retryable = true,
  } = {}) {
    super(message);
    this.name = 'ClaudeExecutionError';
    this.cancelled = cancelled;
    this.deliveryUncertain = deliveryUncertain;
    this.exitCode = exitCode;
    this.missingConversation = missingConversation;
    this.missingConversationSessionId = missingConversationSessionId;
    this.sessionInUseSessionId = sessionInUseSessionId;
    this.retryable = retryable;
  }
}

const MISSING_CONVERSATION = /No conversation found with session ID:\s*([^\s]+)/i;
const SESSION_ID_IN_USE = /Session ID\s+([^\s]+)\s+is already in use/i;
const CLAUDE_BACKGROUND_TERMINATION_PATTERN = /background tasks? still running[^\n]*terminating/i;

export const CLAUDE_PRINT_BACKGROUND_WAIT_ENV = 'CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS';

// The August 3, 2026 incident proved that Claude print mode otherwise exits successfully after
// terminating background agents at its default wait ceiling. Zero tells Claude to wait without a
// ceiling. Keep an operator-supplied nonblank value so CC Relay never overrides an explicit limit.
export function claudePrintEnv(baseEnv = process.env) {
  const env = { ...baseEnv };
  if (
    typeof env[CLAUDE_PRINT_BACKGROUND_WAIT_ENV] !== 'string'
    || !env[CLAUDE_PRINT_BACKGROUND_WAIT_ENV].trim()
  ) {
    env[CLAUDE_PRINT_BACKGROUND_WAIT_ENV] = '0';
  }
  return env;
}

// Windows file paths are case-insensitive, and `claude agents --json` reports whatever case the
// shell recorded, so a session started in `c:\work\app` must still match a task stored as
// `C:\work\app`. Comparing the resolved strings verbatim there rejects a legitimate terminal as
// a different workspace. POSIX keeps the exact byte comparison, where case is significant.
export function sameWorkspacePath(left, right, platform = process.platform) {
  const first = resolve(left);
  const second = resolve(right);
  return platform === 'win32'
    ? first.toLowerCase() === second.toLowerCase()
    : first === second;
}

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

// Claude Code spawns a sub-agent through its own `Agent` tool. CC Relay keeps the mcpToolCall
// envelope so every existing consumer (grouping, copy log, stored events from older tasks)
// still works, and adds flat sub-agent metadata the console uses for a dedicated signal.
const AGENT_TOOL_NAME = 'Agent';

// A backgrounded launch returns immediately while the agent keeps working. The interactive
// transcript records the launch metadata as a sibling `toolUseResult` object; the headless
// stream-json path only carries the tool_result text, so both markers are honoured.
// Both phrases are Claude's own launch text, matched in full so a sub-agent report that
// merely mentions background work is never mistaken for an async launch.
const ASYNC_LAUNCH_TEXT = /async agent launched|the agent is working in the background/i;
const ASYNC_AGENT_ID = /agentid:\s*([A-Za-z0-9_-]+)/i;

function trimmedString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function subAgentLaunchOutcome(record, block) {
  const reported = record?.toolUseResult;
  // The transcript record states the launch outcome directly, so it settles the question.
  // Falling through to the text heuristic here would let a synchronous sub-agent whose own
  // report quotes Claude's stock launch phrase be filed as a live background agent, which
  // then never resolves. The heuristic below only serves records that carry no such object,
  // which is the headless stream-json path.
  if (reported && typeof reported === 'object') {
    return {
      backgrounded: reported.isAsync === true || trimmedString(reported.status) === 'async_launched',
      agentId: trimmedString(reported.agentId),
    };
  }
  const text = resultText(block?.content);
  if (ASYNC_LAUNCH_TEXT.test(text)) {
    return { backgrounded: true, agentId: text.match(ASYNC_AGENT_ID)?.[1] || '' };
  }
  return { backgrounded: false, agentId: '' };
}

function toolItem(block, cwd) {
  const input = block.input || {};
  if (block.name === AGENT_TOOL_NAME) {
    return {
      type: 'mcpToolCall',
      id: block.id,
      server: 'Claude Code',
      tool: AGENT_TOOL_NAME,
      arguments: input,
      status: 'inProgress',
      result: null,
      subAgent: true,
      toolUseId: block.id,
      agentName: trimmedString(input.description),
      agentType: trimmedString(input.subagent_type),
    };
  }
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

function completedToolItem(item, block, record = null) {
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
  const completed = {
    ...item,
    status: failed ? 'failed' : 'completed',
    result: { content: text ? [{ type: 'text', text }] : [] },
  };
  if (item.subAgent && !failed) {
    // The tool call completing does not mean the sub-agent finished: a backgrounded launch
    // stays live until its task notification arrives.
    const outcome = subAgentLaunchOutcome(record, block);
    completed.backgrounded = outcome.backgrounded;
    if (outcome.agentId) {
      completed.agentId = outcome.agentId;
    }
  }
  return completed;
}

// Reads a Claude `<task-notification>` payload, the record that reports a backgrounded
// sub-agent finishing. Returns null for any other queue-operation content (agent messages,
// plain queue bookkeeping) so unrelated records stay invisible.
export function parseAgentTaskNotification(content) {
  const text = typeof content === 'string' ? content : '';
  if (!text.includes('<task-notification>')) {
    return null;
  }
  const body = text.match(/<task-notification>([\s\S]*?)<\/task-notification>/)?.[1] || '';
  if (!body) {
    return null;
  }
  const field = (name) => body.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1]?.trim() || '';
  const toolUseId = field('tool-use-id');
  const agentId = field('task-id');
  if (!toolUseId && !agentId) {
    return null;
  }
  const summary = field('summary');
  return {
    toolUseId,
    agentId,
    status: field('status') || 'completed',
    summary,
    // Summaries read `Agent "<name>" finished`, so the name survives even when the
    // notification arrives before (or without) the launch record it belongs to.
    agentName: summary.match(/Agent\s+"([^"]*)"/)?.[1]?.trim() || '',
  };
}

function subAgentLabel(item) {
  const name = trimmedString(item?.agentName);
  if (name) {
    return `"${name}"`;
  }
  return trimmedString(item?.agentType) || trimmedString(item?.toolUseId) || 'agent';
}

function subAgentCompletionMessage(item) {
  if (!item?.subAgent) {
    return '';
  }
  if (item.status === 'failed') {
    return `Claude could not start sub-agent ${subAgentLabel(item)}.`;
  }
  return item.backgrounded
    ? `Sub-agent ${subAgentLabel(item)} is working in the background.`
    : `Sub-agent ${subAgentLabel(item)} finished.`;
}

// Claude writes the same task notification twice, once when it enqueues the notification and
// once when it removes it. Both records carry identical content, so the turn context remembers
// what it already reported and the console shows one finish per sub-agent run.
function firstNotificationSighting(context, notification, content) {
  if (!context.agentNotifications) {
    context.agentNotifications = new Set();
  }
  const key = `${notification.agentId}|${notification.toolUseId}|${notification.status}|${String(content || '').length}`;
  if (context.agentNotifications.has(key)) {
    return false;
  }
  context.agentNotifications.add(key);
  return true;
}

function pendingBackgroundAgentCount(message) {
  if (Number.isFinite(message?.pendingBackgroundAgentCount)) {
    return message.pendingBackgroundAgentCount;
  }
  const pending = [];
  const seen = new Set([message]);
  for (const value of Object.values(message || {})) {
    if (value && typeof value === 'object') pending.push(value);
  }
  while (pending.length > 0) {
    const container = pending.shift();
    if (!container || typeof container !== 'object' || seen.has(container)) continue;
    seen.add(container);
    if (Number.isFinite(container.pendingBackgroundAgentCount)) {
      return container.pendingBackgroundAgentCount;
    }
    for (const value of Object.values(container)) {
      if (value && typeof value === 'object') pending.push(value);
    }
  }
  return null;
}

function liveSubAgentMap(context) {
  if (!(context.liveSubAgents instanceof Map)) {
    context.liveSubAgents = new Map();
  }
  return context.liveSubAgents;
}

function finishedSubAgentToolUseIds(context) {
  if (!(context.finishedSubAgentToolUseIds instanceof Set)) {
    context.finishedSubAgentToolUseIds = new Set();
  }
  return context.finishedSubAgentToolUseIds;
}

export function liveSubAgents(context) {
  return context?.liveSubAgents instanceof Map
    ? [...context.liveSubAgents.values()]
    : [];
}

export function backgroundWorkSummary({
  entries = [],
  pendingCount = null,
  backgroundTasks = [],
  sessionCrons = [],
} = {}) {
  const agents = Array.isArray(entries) ? entries : [];
  if (agents.length > 0) {
    const labels = agents
      .map((entry) => trimmedString(entry?.label))
      .filter(Boolean);
    const shown = labels.slice(0, 3);
    const remaining = Math.max(0, agents.length - shown.length);
    const names = shown.length > 0
      ? ` (${shown.join(', ')}${remaining > 0 ? `, and ${remaining} more` : ''})`
      : '';
    return `${agents.length} background sub-agent${agents.length === 1 ? '' : 's'}${names}`;
  }
  if (Number.isFinite(pendingCount) && pendingCount > 0) {
    return `${pendingCount} pending background agent${pendingCount === 1 ? '' : 's'}`;
  }
  const taskCount = Array.isArray(backgroundTasks) ? backgroundTasks.length : 0;
  const cronCount = Array.isArray(sessionCrons) ? sessionCrons.length : 0;
  const parts = [];
  if (taskCount > 0) {
    parts.push(`${taskCount} background task${taskCount === 1 ? '' : 's'}`);
  }
  if (cronCount > 0) {
    parts.push(`${cronCount} session cron${cronCount === 1 ? '' : 's'}`);
  }
  return parts.join(' and ');
}

export function consumeClaudeStreamMessage(message, context) {
  const emitted = [];
  if (message.type === 'system' && message.subtype === 'turn_duration') {
    context.pendingBackgroundAgentCount = pendingBackgroundAgentCount(message);
  }
  if (message.type === 'queue-operation') {
    const notification = parseAgentTaskNotification(message.content);
    if (notification) {
      if (notification.toolUseId) {
        finishedSubAgentToolUseIds(context).add(notification.toolUseId);
      }
      const agents = context.liveSubAgents instanceof Map ? context.liveSubAgents : null;
      if (agents) {
        if (!notification.toolUseId || !agents.delete(notification.toolUseId)) {
          for (const [toolUseId, entry] of agents) {
            if (notification.agentId && entry.agentId === notification.agentId) {
              agents.delete(toolUseId);
              break;
            }
          }
        }
      }
    }
    if (notification && firstNotificationSighting(context, notification, message.content)) {
      emitted.push({
        event: {
          type: 'claude/agent-finished',
          provider: 'claude',
          toolUseId: notification.toolUseId,
          agentId: notification.agentId,
          status: notification.status,
          summary: notification.summary,
          agentName: notification.agentName,
        },
        message: notification.summary
          || `Sub-agent ${notification.agentName || notification.agentId} finished.`,
      });
    }
  }
  if (message.type === 'assistant') {
    for (const block of message.message?.content || []) {
      if (block.type === 'tool_use' && block.id) {
        const item = toolItem(block, context.cwd);
        context.tools.set(block.id, item);
        emitted.push({
          event: { type: 'item/started', provider: 'claude', item },
          message: item.subAgent
            ? `Claude started sub-agent ${subAgentLabel(item)}.`
            : `${item.type === 'commandExecution' ? 'Running' : 'Claude started'}: ${block.name || 'tool'}`,
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
      const completedItem = completedToolItem(item, block, message);
      context.tools.delete(block.tool_use_id);
      if (
        completedItem.subAgent
        && completedItem.status !== 'failed'
        && completedItem.backgrounded
        && !finishedSubAgentToolUseIds(context).has(completedItem.toolUseId)
      ) {
        liveSubAgentMap(context).set(completedItem.toolUseId, {
          toolUseId: completedItem.toolUseId,
          agentId: completedItem.agentId || '',
          label: subAgentLabel(completedItem),
        });
      }
      emitted.push({
        event: { type: 'item/completed', provider: 'claude', item: completedItem },
        message: subAgentCompletionMessage(completedItem)
          || (completedItem.type === 'commandExecution'
            ? `Command ${completedItem.status}: ${completedItem.command}`
            : `Claude ${completedItem.tool || 'file change'} ${completedItem.status}.`),
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
  const prompt = task.attachments?.length
    ? `${task.prompt}\n\nReference images are attached. Use the Read tool to inspect every image before working:\n${task.attachments
      .map((attachment, index) => `${index + 1}. ${attachment.name}: ${attachment.path}`)
      .join('\n')}`
    : task.prompt;
  return withRelayNonInteractiveInstruction(prompt);
}

function selectedModel(model) {
  const selected = normalizeClaudeModel(model);
  if (!selected || selected === 'default') {
    return null;
  }
  return selected;
}

export class ClaudeExecutionRunner {
  constructor({
    command = 'claude',
    spawnProcess = spawn,
    sessions,
    wait = delay,
    now = Date.now,
    idleDiscoveryStaleLimitMs = 60_000,
    platform = process.platform,
    resolveTerminal = null,
    requestAttention = null,
    hookBridge = null,
    terminalExecutor = null,
    terminateProcess = terminateChildProcess,
    diagnostic = () => {},
  } = {}) {
    this.command = command;
    this.spawnProcess = spawnProcess;
    this.terminateProcess = terminateProcess;
    this.sessions = sessions;
    this.wait = wait;
    this.now = now;
    this.idleDiscoveryStaleLimitMs = idleDiscoveryStaleLimitMs;
    this.platform = platform;
    this.resolveTerminal = resolveTerminal;
    this.diagnostic = diagnostic;
    this.terminalExecutor = terminalExecutor
      || new ClaudeTerminalExecutor({
        command,
        sessions,
        wait,
        resolveTerminal,
        requestAttention,
        hookBridge,
      });
    this.activeByTask = new Map();
    this.activeBySession = new Map();
  }

  async waitForIdle(task, active, onEvent) {
    if (!this.sessions) {
      return null;
    }
    let announced = false;
    // A session cached as busy is served indefinitely while discovery keeps failing, because
    // the registry now returns last-known-good instead of an empty list. Without a bound the
    // task sits on "Waiting for the selected Claude session to become idle" forever. Track how
    // long we have been reading stale data and fail clearly instead of hanging.
    let staleSince = null;
    while (!active.cancelRequested) {
      const session = await this.sessions.readConnectedSession(task.thread_id);
      if (this.sessions.stale) {
        const timestamp = this.now();
        if (staleSince === null) {
          staleSince = timestamp;
        } else if (timestamp - staleSince >= this.idleDiscoveryStaleLimitMs) {
          throw new ClaudeExecutionError(
            `CC Relay could not read live Claude session state for ${Math.round(this.idleDiscoveryStaleLimitMs / 1000)} seconds, so it never confirmed the terminal was free and typed nothing. Check that the Claude CLI responds to \`claude agents --json\`, then retry.`,
            { retryable: false },
          );
        }
      } else {
        staleSince = null;
      }
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
        'The selected Claude terminal closed before CC Relay could start its first turn. Reopen it and retry.',
        { retryable: false },
      );
    }
    if (session.id !== task.thread_id || session.source !== 'Claude interactive') {
      throw new ClaudeExecutionError(
        'The selected Claude session is no longer the live interactive terminal CC Relay opened. Choose that terminal again and retry.',
        { retryable: false },
      );
    }
    if (
      typeof session.cwd !== 'string'
      || !session.cwd.trim()
      || typeof task.repo_path !== 'string'
      || !task.repo_path.trim()
      || !sameWorkspacePath(session.cwd, task.repo_path, this.platform)
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
    const invocation = providerCommandInvocation(this.command, args, { platform: this.platform });
    const child = this.spawnProcess(invocation.command, invocation.args, {
      cwd: task.repo_path,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: claudePrintEnv(),
      ...invocation.options,
    });
    active.child = child;
    const context = {
      cwd: task.repo_path,
      tools: new Map(),
      finalResponse: '',
      sessionId: task.thread_id,
      reportedSessionId: null,
      error: null,
      pendingBackgroundAgentCount: null,
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
        ? `Claude started the first CC Relay turn in ${task.thread_name || task.thread_id}.`
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
        const terminatedPending = CLAUDE_BACKGROUND_TERMINATION_PATTERN.test(stderrMessage)
          || (
            Number.isFinite(context.pendingBackgroundAgentCount)
            && context.pendingBackgroundAgentCount > 0
          );
        if (terminatedPending) {
          const detail = backgroundWorkSummary({
            entries: liveSubAgents(context),
            pendingCount: context.pendingBackgroundAgentCount,
          }) || 'background tasks the CLI reported still running';
          reject(new ClaudeExecutionError(
            `Claude ended this run while ${detail} still working, and that work was terminated with it. Parts of the task may already be applied in the workspace, and Retry would re-send the original prompt on top of them, so CC Relay will not retry automatically. Review the workspace, then use Continue session with a follow-up telling Claude what to audit and finish.`,
            { exitCode: code, retryable: false },
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
      throw new ClaudeExecutionError('That Claude session already has an active CC Relay task.');
    }
    const active = {
      taskId: taskKey,
      sessionId: task.thread_id,
      task,
      child: null,
      cancelRequested: false,
      executionMode: null,
      steer: null,
    };
    this.activeByTask.set(taskKey, active);
    this.activeBySession.set(task.thread_id, active);

    try {
      const session = await this.waitForIdle(task, active, onEvent);
      let terminal = await this.resolveTerminalTarget(session, active);
      if (!terminal && task.require_terminal === true) {
        throw new ClaudeExecutionError(
          `CC Relay could not resolve the exact owned terminal for ${task.thread_name || task.thread_id}. Plan council did not run Claude headlessly. Launch a Claude CC Relay from this workspace, select it as the council terminal, then retry.`,
          { retryable: false },
        );
      }
      if (terminal) {
        const fallbackReason = this.headlessFallbackReason(task);
        if (fallbackReason) {
          if (task.require_terminal === true) {
            throw new ClaudeExecutionError(
              `CC Relay cannot type this Plan council stage into ${task.thread_name || task.thread_id}: ${fallbackReason} The stage was not run headlessly.`,
              { retryable: false },
            );
          }
          // A prompt that fails the deterministic pre-injection terminal checks (too large for
          // the osascript argv, or containing a NUL byte) cannot be typed, but it ran fine
          // headless via stdin before the terminal path existed. The check is pre-injection
          // with nothing typed, so routing to the headless path here restores that capability
          // with no risk of double execution (Issue 15). The headless path never touches argv
          // with the prompt, so neither the size nor the NUL constraint applies to it.
          onEvent({
            event: { type: 'claude/progress', provider: 'claude', sessionId: task.thread_id },
            message: `CC Relay is running this task headless instead of typing it into the ${task.thread_name || task.thread_id} terminal because ${fallbackReason}`,
          });
          terminal = null;
        }
      }
      active.executionMode = terminal ? 'terminal' : 'headless';
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

  // The reason this turn must run headless even though an owned terminal resolved, or null
  // when the prompt is safe to type. Deterministic and pre-injection: an oversized or
  // NUL-bearing prompt cannot travel as an osascript argv value, so CC Relay routes it to the
  // headless stdin path instead of failing (Issue 15). Uses the same byte limit the executor
  // would enforce so the routing decision and the executor's own backstop check agree.
  headlessFallbackReason(task) {
    const maxBytes = this.terminalExecutor?.maxPromptBytes;
    return injectionPromptIssue(taskPrompt(task), maxBytes ? { maxBytes } : {});
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
        message: `Claude has no saved transcript in ${task.thread_name || task.thread_id} yet. CC Relay is starting its first turn with the same session ID.`,
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
          message: 'Claude saved the transcript during initialization. CC Relay is resuming the same session.',
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

  async steer(taskId, prompt, attachments = []) {
    const value = typeof prompt === 'string' ? prompt.trim() : '';
    if (!value) {
      throw new ClaudeExecutionError('Write a follow-up before sending it.', { retryable: false });
    }
    const active = this.activeByTask.get(taskId);
    if (!active) {
      throw new ClaudeExecutionError(
        'That task no longer has an active Claude turn. Your message was not queued.',
        { retryable: false },
      );
    }
    if (typeof active.steer !== 'function') {
      const message = active.executionMode === 'headless'
        ? 'That Claude task is not running in an interactive terminal, so it cannot accept a live update. Your message was not queued.'
        : 'Claude is still preparing the original turn and cannot accept a live update yet. Try again after it starts working. Your message was not queued.';
      throw new ClaudeExecutionError(message, { retryable: false });
    }

    this.diagnostic('task.claude.steer.requested', {
      taskId,
      threadId: active.sessionId,
      attachmentCount: attachments.length,
    });
    try {
      const outcome = await active.steer(value, attachments);
      this.diagnostic('task.claude.steer.completed', outcome);
      return outcome;
    } catch (error) {
      this.diagnostic('task.claude.steer.failed', {
        taskId,
        threadId: active.sessionId,
        deliveryUncertain: error.deliveryUncertain === true,
        // Together they say how many guarded Returns were sent and what the composer looked like on
        // every recovery pass that ran. Both are present for any failure raised inside
        // deliverActiveSteer, not only a post-injection one: a PRE-injection failure carries 0 and
        // [], which is the meaningful reading that nothing was typed and that no recovery pass ever
        // classified the composer. They are null only when the error carries neither field, for
        // example a live update rejected before deliverActiveSteer runs because the turn had
        // already closed.
        submitAttempts: Number.isInteger(error.submitAttempts) ? error.submitAttempts : null,
        composerStates: Array.isArray(error.composerStates) ? error.composerStates : null,
        error: error.message,
      });
      throw error;
    }
  }

  cancel(taskId = null) {
    if (taskId !== null && taskId !== undefined) {
      const active = this.activeByTask.get(taskId) || this.activeBySession.get(taskId);
      if (!active) return false;
      active.cancelRequested = true;
      this.stopChild(active);
      return true;
    }
    const activeTasks = [...new Set(this.activeByTask.values())];
    for (const active of activeTasks) {
      active.cancelRequested = true;
      this.stopChild(active);
    }
    return activeTasks.length > 0;
  }

  // On Windows the spawned child is cmd.exe wrapping the claude shim, so killing the direct
  // child would leave Claude running against the user's workspace after a cancel.
  stopChild(active) {
    if (!active.child) return false;
    return this.terminateProcess(active.child, { signal: 'SIGTERM', platform: this.platform });
  }
}
