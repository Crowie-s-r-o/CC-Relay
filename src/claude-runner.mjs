import { spawn } from 'node:child_process';
import { dirname } from 'node:path';

export class ClaudeRunnerError extends Error {
  constructor(message, { cancelled = false, exitCode = null, retryable = false } = {}) {
    super(message);
    this.name = 'ClaudeRunnerError';
    this.cancelled = cancelled;
    this.exitCode = exitCode;
    this.retryable = retryable;
  }
}

function parsedMessages(output) {
  const parsed = JSON.parse(output);
  return Array.isArray(parsed) ? parsed : [parsed];
}

export function claudeFailureMessage(output) {
  try {
    const messages = parsedMessages(output);
    const result = [...messages].reverse().find((message) => (
      message.type === 'result' && (message.is_error || message.subtype?.startsWith('error'))
    ));
    if (typeof result?.result === 'string' && result.result.trim()) return result.result.trim();
    if (typeof result?.error === 'string' && result.error.trim()) return result.error.trim();
    const assistantError = [...messages].reverse().find((message) => (
      message.type === 'assistant' && typeof message.error === 'string'
    ));
    const content = assistantError?.message?.content;
    const errorText = Array.isArray(content)
      ? content.find((item) => item.type === 'text' && typeof item.text === 'string')?.text
      : null;
    return errorText?.trim() || '';
  } catch {
    return '';
  }
}

export function parseClaudeResult(output) {
  let parsed;
  try {
    parsed = parsedMessages(output);
  } catch (error) {
    throw new ClaudeRunnerError(`Claude returned invalid JSON: ${error.message}`);
  }
  const messages = parsed;
  const result = [...messages].reverse().find((message) => message.type === 'result')
    || messages.find((message) => typeof message.result === 'string');
  if (!result) {
    throw new ClaudeRunnerError('Claude completed without a result message.');
  }
  if (result.is_error || result.subtype?.startsWith('error')) {
    throw new ClaudeRunnerError(result.result || result.error || 'Claude could not complete the plan stage.');
  }
  const text = typeof result.result === 'string' ? result.result.trim() : '';
  if (!text) {
    throw new ClaudeRunnerError('Claude completed without a text result.');
  }
  return {
    text,
    sessionId: result.session_id || null,
    model: Object.keys(result.modelUsage || {})[0] || null,
  };
}

export class ClaudeRunner {
  constructor({ command = 'claude', spawnProcess = spawn } = {}) {
    this.command = command;
    this.spawnProcess = spawnProcess;
    // Stages are tracked per owner, not in one global slot. A single slot meant two
    // concurrent stages could not coexist (queue.planAhead starts one forward-planning
    // preparation per project, so two projects with Plan council enabled collided), and
    // it meant cancel() killed whichever stage happened to be active rather than the one
    // the caller named.
    this.stages = new Map();
  }

  // `this.active` is retained as a read-only view of the most recently started stage so
  // existing callers and tests that inspect it keep working.
  get active() {
    let latest = null;
    for (const stage of this.stages.values()) latest = stage;
    return latest;
  }

  run(prompt, {
    cwd,
    model,
    effort,
    attachmentPaths = [],
    owner = null,
    onEvent,
    onStderr,
  }) {
    const ownerKey = owner === null || owner === undefined ? Symbol('claude-stage') : String(owner);
    if (this.stages.has(ownerKey)) {
      throw new ClaudeRunnerError('Claude already has an active Relay plan stage for this task.');
    }
    const attachmentDirectories = [...new Set(attachmentPaths.map((path) => dirname(path)))];
    const args = [
      '--print',
      '--safe-mode',
      '--no-session-persistence',
      '--no-chrome',
      '--permission-mode',
      'plan',
      '--tools',
      'Read,Glob,Grep',
      ...attachmentDirectories.flatMap((directory) => ['--add-dir', directory]),
      '--model',
      model,
      '--effort',
      effort,
      '--output-format',
      'json',
    ];
    const child = this.spawnProcess(this.command, args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderrBuffer = '';
    let lastStderrLine = '';
    const active = { child, cancelRequested: false, owner: ownerKey };
    this.stages.set(ownerKey, active);
    onEvent({
      event: { type: 'claude/started', model, effort },
      message: `Claude started with ${model} at ${effort} effort.`,
    });

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderrBuffer += chunk;
      const lines = stderrBuffer.split('\n');
      stderrBuffer = lines.pop() || '';
      for (const line of lines.filter(Boolean)) {
        lastStderrLine = line.trim() || lastStderrLine;
        onStderr(line);
      }
    });

    return new Promise((resolve, reject) => {
      const release = () => {
        if (this.stages.get(ownerKey) === active) this.stages.delete(ownerKey);
      };
      child.once('error', (error) => {
        release();
        reject(new ClaudeRunnerError(`Could not start Claude Code: ${error.message}`));
      });
      child.once('close', (code, signal) => {
        release();
        if (stderrBuffer.trim()) {
          lastStderrLine = stderrBuffer.trim();
          onStderr(stderrBuffer.trim());
        }
        if (active.cancelRequested) {
          reject(new ClaudeRunnerError('Task cancelled.', { cancelled: true, exitCode: code }));
          return;
        }
        if (code !== 0) {
          const failure = claudeFailureMessage(stdout)
            || lastStderrLine
            || `Claude Code stopped${signal ? ` after ${signal}` : ` with code ${code}`}.`;
          reject(new ClaudeRunnerError(
            failure,
            { exitCode: code },
          ));
          return;
        }
        try {
          const result = parseClaudeResult(stdout);
          onEvent({
            event: { type: 'claude/completed', model: result.model || model, effort },
            message: `Claude completed with ${result.model || model}.`,
          });
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });
      child.stdin.end(prompt);
    });
  }

  // Cancels the stage belonging to `owner`. Passing no owner keeps the historical
  // cancel-everything behaviour used by shutdown paths, but a named owner now only ever
  // stops its own stage, so cancelling one project's plan cannot kill another's.
  cancel(owner = null) {
    if (owner === null || owner === undefined) {
      let cancelled = false;
      for (const stage of [...this.stages.values()]) {
        stage.cancelRequested = true;
        stage.child.kill('SIGTERM');
        cancelled = true;
      }
      return cancelled;
    }
    const stage = this.stages.get(String(owner));
    if (!stage) return false;
    stage.cancelRequested = true;
    stage.child.kill('SIGTERM');
    return true;
  }
}
