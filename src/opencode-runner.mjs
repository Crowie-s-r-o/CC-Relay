import { execFile, spawn } from 'node:child_process';
import { providerCommandInvocation, terminateChildProcess } from './claude-binary.mjs';
import { withRelayNonInteractiveInstruction } from './relay-prompt.mjs';
import {
  addTokenUsage,
  normalizeTokenUsage,
  providerTokenUsageEvent,
  tokenUsageMessage,
} from './token-usage.mjs';

const MAX_STREAM_LINE_BYTES = 4 * 1024 * 1024;
const MAX_STDERR_BYTES = 256 * 1024;
const MAX_EXPORT_BYTES = 8 * 1024 * 1024;
const EXPORT_TIMEOUT_MS = 3_000;

export class OpenCodeExecutionError extends Error {
  constructor(message, { cancelled = false, exitCode = null, retryable = true } = {}) {
    super(message);
    this.name = 'OpenCodeExecutionError';
    this.cancelled = cancelled;
    this.exitCode = exitCode;
    this.retryable = retryable;
  }
}

function sessionId(record) {
  const value = record?.sessionID || record?.sessionId || record?.session_id;
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > 512 || /[\0\r\n]/.test(normalized)) return null;
  return normalized;
}

function messageId(record) {
  return record?.part?.messageID
    || record?.part?.messageId
    || record?.messageID
    || record?.messageId
    || null;
}

function messageCreatedAt(message) {
  const value = Number(
    message?.info?.time?.created
    || message?.info?.time?.start
    || message?.time?.created
    || 0,
  );
  return Number.isFinite(value) ? value : 0;
}

function messageIdentifier(message) {
  return message?.info?.id || message?.id || null;
}

function messageParts(message) {
  return Array.isArray(message?.parts) ? message.parts : [];
}

export function openCodeSessionSnapshot(value, {
  messageIds = [],
  startedAt = 0,
} = {}) {
  const data = typeof value === 'string' ? JSON.parse(value) : value;
  const observed = new Set(messageIds);
  const messages = Array.isArray(data?.messages) ? data.messages : [];
  const relevant = messages.filter((message) => {
    if (message?.info?.role !== 'assistant') return false;
    const id = messageIdentifier(message);
    return (id && observed.has(id))
      || (startedAt > 0 && messageCreatedAt(message) >= startedAt);
  });

  let usage = normalizeTokenUsage({});
  let finalResponse = '';
  const countedParts = new Set();
  const reasoningParts = new Map();
  for (const message of relevant) {
    const parts = messageParts(message);
    const finishParts = parts.filter((part) => (
      ['step-finish', 'step_finish'].includes(part?.type)
      && part.tokens
      && typeof part.tokens === 'object'
    ));
    if (finishParts.length > 0) {
      for (const part of finishParts) {
        const key = part.id || `${messageIdentifier(message) || 'message'}:${countedParts.size}`;
        if (countedParts.has(key)) continue;
        countedParts.add(key);
        usage = addTokenUsage(usage, part.tokens);
      }
    } else if (message?.info?.tokens && typeof message.info.tokens === 'object') {
      usage = addTokenUsage(usage, message.info.tokens);
    }
    const response = parts
      .filter((part) => part?.type === 'text' && String(part.text || '').trim())
      .map((part) => String(part.text).trim())
      .join('\n\n');
    if (response) finalResponse = response;
    for (const [index, part] of parts.entries()) {
      if (part?.type !== 'reasoning') continue;
      const text = String(part.text || '').trim();
      if (!text) continue;
      const messageId = messageIdentifier(message) || 'message';
      const id = String(part.id || `${messageId}-reasoning-${index}`);
      reasoningParts.set(id, { id, messageId, text });
    }
  }
  return { usage, finalResponse, reasoningParts: [...reasoningParts.values()] };
}

export function readOpenCodeSession({
  command,
  sessionId: requestedSessionId,
  cwd,
  platform = process.platform,
  onChild = () => {},
}) {
  const invocation = providerCommandInvocation(command, ['export', requestedSessionId], { platform });
  return new Promise((resolve, reject) => {
    const child = execFile(invocation.command, invocation.args, {
      cwd,
      encoding: 'utf8',
      timeout: EXPORT_TIMEOUT_MS,
      maxBuffer: MAX_EXPORT_BYTES,
      detached: platform !== 'win32',
      ...invocation.options,
    }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
    onChild(child);
  });
}

function eventError(record) {
  const error = record?.error || record?.part?.error;
  if (typeof error === 'string') return error.trim();
  if (error && typeof error === 'object') {
    return String(error.message || error.name || JSON.stringify(error)).trim();
  }
  return '';
}

function toolItem(record) {
  const part = record?.part || {};
  const state = part.state || {};
  return {
    id: part.id || record.id || `opencode-tool-${Date.now()}`,
    type: 'mcpToolCall',
    server: 'opencode',
    tool: part.tool || part.name || 'tool',
    status: ['error', 'failed'].includes(state.status)
      ? 'failed'
      : state.status === 'completed' ? 'completed' : 'running',
    arguments: state.input || part.input || {},
    result: state.output ? { content: [{ type: 'text', text: String(state.output) }] } : null,
  };
}

export function openCodeRunArguments(task) {
  // OpenCode intentionally suppresses reasoning records in a non-interactive run unless
  // `--thinking` is explicit, including when its JSON session export contains those parts.
  // Relay needs the native record so Task Activity can show it live through the Thinking switch.
  const args = ['run', '--format', 'json', '--thinking', '--auto', '--dir', task.repo_path];
  if (task.thread_id) args.push('--session', task.thread_id);
  if (task.model && task.model !== 'default') args.push('--model', task.model);
  if (task.effort) args.push('--variant', task.effort);
  for (const attachment of task.attachments || []) {
    if (attachment?.path) args.push('--file', attachment.path);
  }
  args.push(withRelayNonInteractiveInstruction(task.prompt));
  return args;
}

function terminateOpenCode(child, platform = process.platform) {
  if (!child) return false;
  if (platform !== 'win32' && Number.isInteger(child.pid) && child.pid > 0) {
    try {
      process.kill(-child.pid, 'SIGTERM');
      return true;
    } catch {}
  }
  return terminateChildProcess(child, { platform });
}

export class OpenCodeRunner {
  constructor({
    command = 'opencode',
    platform = process.platform,
    spawnProcess = spawn,
    terminateProcess = terminateOpenCode,
    readSession = readOpenCodeSession,
    now = Date.now,
  } = {}) {
    this.command = command;
    this.platform = platform;
    this.spawnProcess = spawnProcess;
    this.terminateProcess = terminateProcess;
    this.readSession = readSession;
    this.now = now;
    this.active = new Map();
  }

  run(task, { onEvent, onStderr }) {
    const startedAt = this.now();
    const args = openCodeRunArguments(task);
    const command = typeof this.command === 'function' ? this.command() : this.command;
    const invocation = providerCommandInvocation(command, args, { platform: this.platform });
    const child = this.spawnProcess(invocation.command, invocation.args, {
      cwd: task.repo_path,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: this.platform !== 'win32',
      ...invocation.options,
    });
    const active = { child, cancelRequested: false };
    this.active.set(task.id, active);

    let stdoutBuffer = '';
    let stderrBuffer = '';
    let stderrText = '';
    let finalResponse = '';
    let reportedSessionId = task.thread_id || null;
    let cumulativeUsage = normalizeTokenUsage({});
    let providerError = '';
    let settled = false;
    let sessionMismatchReported = false;
    const observedMessageIds = new Set();
    const finishedMessageIds = new Set();
    const usageByStep = new Map();
    const responsePartsByMessage = new Map();
    const reasoningTextByPart = new Map();
    let anonymousReasoningIndex = 0;

    const emitReasoning = ({ id, messageId: nativeMessageId, text }, reconciledFrom = null) => {
      const value = String(text || '').trim();
      if (!value) return false;
      const itemId = String(id || `${nativeMessageId || reportedSessionId || task.id}-reasoning-${anonymousReasoningIndex++}`);
      if (reasoningTextByPart.get(itemId) === value) return false;
      reasoningTextByPart.set(itemId, value);
      onEvent({
        event: {
          type: 'item/completed',
          provider: 'opencode',
          ...(reconciledFrom ? { reconciledFrom } : {}),
          item: {
            id: itemId,
            type: 'reasoning',
            status: 'completed',
            summary: [{ text: value }],
          },
        },
        message: 'OpenCode reasoning recorded.',
      });
      return true;
    };

    const observeSession = (record) => {
      const observedSessionId = sessionId(record);
      if (!observedSessionId) return true;
      if (reportedSessionId && observedSessionId !== reportedSessionId) {
        if (!sessionMismatchReported) {
          sessionMismatchReported = true;
          providerError = `OpenCode reported session ${observedSessionId} while CC Relay expected ${reportedSessionId}.`;
          onEvent({
            event: { type: 'error', provider: 'opencode', error: providerError },
            message: providerError,
          });
          this.terminateProcess(child, this.platform);
        }
        return false;
      }
      if (!reportedSessionId) {
        reportedSessionId = observedSessionId;
        onEvent({
          event: {
            type: 'opencode/session',
            provider: 'opencode',
            sessionId: reportedSessionId,
          },
          message: `OpenCode session ${reportedSessionId} is active.`,
        });
      }
      return true;
    };

    const consumeStderrLine = (line) => {
      const value = String(line || '').trim();
      if (!value) return;
      if (Buffer.byteLength(value, 'utf8') > MAX_STDERR_BYTES) {
        providerError = 'OpenCode emitted stderr that exceeded CC Relay limits.';
        onStderr(providerError);
        this.terminateProcess(child, this.platform);
        return;
      }
      if (stderrText.length < MAX_STDERR_BYTES) {
        const separator = stderrText ? '\n' : '';
        const remaining = MAX_STDERR_BYTES - stderrText.length;
        stderrText += `${separator}${value}`.slice(0, remaining);
      }
      onStderr(value);
    };

    onEvent({
      event: {
        type: 'opencode/started',
        provider: 'opencode',
        sessionId: reportedSessionId,
        model: task.model || 'configured default',
      },
      message: task.thread_id
        ? `OpenCode resumed session ${task.thread_id}.`
        : 'OpenCode started a headless task run.',
    });

    const consumeRecord = (record) => {
      if (!observeSession(record)) return;
      const recordMessageId = messageId(record);
      if (recordMessageId) observedMessageIds.add(recordMessageId);
      if (record?.type === 'reasoning') {
        emitReasoning({
          id: record.part?.id || record.id,
          messageId: recordMessageId,
          text: record.part?.text || record.text,
        });
        return;
      }
      if (record?.type === 'text') {
        const value = String(record.part?.text || record.text || '').trim();
        if (value) {
          const responseMessageId = recordMessageId || `message-${responsePartsByMessage.size}`;
          const parts = responsePartsByMessage.get(responseMessageId) || new Map();
          parts.set(record.part?.id || `part-${parts.size}`, value);
          responsePartsByMessage.set(responseMessageId, parts);
          finalResponse = [...parts.values()].join('\n\n');
          onEvent({
            event: { type: 'opencode/message', provider: 'opencode', text: value },
            message: value,
          });
        }
        return;
      }
      if (record?.type === 'tool_use') {
        const item = toolItem(record);
        const completed = ['completed', 'error', 'failed'].includes(item.status);
        onEvent({
          event: {
            type: completed ? 'item/completed' : 'item/started',
            provider: 'opencode',
            item,
          },
          message: completed
            ? `OpenCode finished ${item.tool}.`
            : `OpenCode started ${item.tool}.`,
        });
        return;
      }
      if (record?.type === 'step_finish') {
        const nativeTokens = record.part?.tokens || record.tokens;
        if (nativeTokens && typeof nativeTokens === 'object') {
          const key = record.part?.id || recordMessageId || `step-${usageByStep.size}`;
          usageByStep.set(key, normalizeTokenUsage(nativeTokens));
          cumulativeUsage = normalizeTokenUsage({});
          for (const stepUsage of usageByStep.values()) {
            cumulativeUsage = addTokenUsage(cumulativeUsage, stepUsage);
          }
          const event = providerTokenUsageEvent('opencode', cumulativeUsage);
          onEvent({ event, message: tokenUsageMessage('opencode', event.usage) });
        }
        if (recordMessageId) finishedMessageIds.add(recordMessageId);
        return;
      }
      if (record?.type === 'error') {
        providerError = eventError(record) || 'OpenCode reported an unknown error.';
        onEvent({
          event: { type: 'error', provider: 'opencode', error: providerError },
          message: providerError,
        });
      }
    };

    const consumeLine = (line) => {
      if (!line.trim()) return;
      if (Buffer.byteLength(line, 'utf8') > MAX_STREAM_LINE_BYTES) {
        providerError = 'OpenCode emitted an event that exceeded CC Relay limits.';
        onStderr(providerError);
        this.terminateProcess(child, this.platform);
        return;
      }
      try {
        consumeRecord(JSON.parse(line));
      } catch (error) {
        onStderr(`Could not parse OpenCode stream event: ${error.message}`);
      }
    };

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdoutBuffer += chunk;
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop() || '';
      for (const line of lines) consumeLine(line);
      if (Buffer.byteLength(stdoutBuffer, 'utf8') > MAX_STREAM_LINE_BYTES) {
        providerError = 'OpenCode emitted an event that exceeded CC Relay limits.';
        stdoutBuffer = '';
        onStderr(providerError);
        this.terminateProcess(child, this.platform);
      }
    });
    child.stderr.on('data', (chunk) => {
      stderrBuffer += chunk;
      const lines = stderrBuffer.split('\n');
      stderrBuffer = lines.pop() || '';
      for (const line of lines) consumeStderrLine(line);
      if (Buffer.byteLength(stderrBuffer, 'utf8') > MAX_STDERR_BYTES) {
        stderrBuffer = '';
        providerError = 'OpenCode emitted stderr that exceeded CC Relay limits.';
        onStderr(providerError);
        this.terminateProcess(child, this.platform);
      }
    });

    return new Promise((resolve, reject) => {
      child.once('error', (error) => {
        if (settled) return;
        settled = true;
        this.active.delete(task.id);
        reject(new OpenCodeExecutionError(`Could not start OpenCode: ${error.message}`));
      });
      child.once('close', (code, signal) => {
        if (settled) return;
        settled = true;
        consumeLine(stdoutBuffer);
        consumeStderrLine(stderrBuffer);
        if (active.cancelRequested) {
          this.active.delete(task.id);
          reject(new OpenCodeExecutionError('Task cancelled.', { cancelled: true, exitCode: code }));
          return;
        }
        if (code !== 0 || providerError) {
          this.active.delete(task.id);
          const message = providerError
            || stderrText.trim()
            || `OpenCode stopped${signal ? ` after ${signal}` : ` with code ${code}`}.`;
          reject(new OpenCodeExecutionError(message, { exitCode: code }));
          return;
        }
        const finish = async () => {
          const incompleteMessages = [...observedMessageIds]
            .some((id) => !finishedMessageIds.has(id));
          const needsReconciliation = reportedSessionId
            && (incompleteMessages || cumulativeUsage.totalTokens === 0 || !finalResponse);
          if (needsReconciliation && !active.cancelRequested) {
            try {
              const exported = await this.readSession({
                command,
                sessionId: reportedSessionId,
                cwd: task.repo_path,
                platform: this.platform,
                onChild: (exportChild) => { active.child = exportChild; },
              });
              const snapshot = openCodeSessionSnapshot(exported, {
                messageIds: observedMessageIds,
                startedAt,
              });
              for (const reasoning of snapshot.reasoningParts) {
                emitReasoning(reasoning, 'session-export');
              }
              if (snapshot.usage.totalTokens > cumulativeUsage.totalTokens) {
                cumulativeUsage = snapshot.usage;
                const event = {
                  ...providerTokenUsageEvent('opencode', cumulativeUsage),
                  reconciledFrom: 'session-export',
                };
                onEvent({ event, message: tokenUsageMessage('opencode', event.usage) });
              }
              if (snapshot.finalResponse && snapshot.finalResponse !== finalResponse) {
                finalResponse = snapshot.finalResponse;
                onEvent({
                  event: {
                    type: 'opencode/message',
                    provider: 'opencode',
                    text: finalResponse,
                    reconciledFrom: 'session-export',
                  },
                  message: finalResponse,
                });
              }
            } catch (error) {
              onStderr(`OpenCode completed, but its native session statistics could not be reconciled: ${error.message}`);
            }
          }
          if (active.cancelRequested) {
            throw new OpenCodeExecutionError('Task cancelled.', { cancelled: true, exitCode: code });
          }
          return {
            finalResponse,
            sessionId: reportedSessionId,
            exitCode: code,
          };
        };
        void finish()
          .then(resolve, reject)
          .finally(() => this.active.delete(task.id));
      });
    });
  }

  cancel(taskId = null) {
    if (taskId != null) {
      const active = this.active.get(taskId);
      if (!active) return false;
      active.cancelRequested = true;
      return this.terminateProcess(active.child, this.platform);
    }
    let cancelled = false;
    for (const active of this.active.values()) {
      active.cancelRequested = true;
      cancelled = this.terminateProcess(active.child, this.platform) || cancelled;
    }
    return cancelled;
  }
}
