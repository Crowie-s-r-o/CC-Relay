import { spawn } from 'node:child_process';
import { dirname } from 'node:path';

export class ClaudeRunnerError extends Error {
  constructor(message, { cancelled = false, exitCode = null } = {}) {
    super(message);
    this.name = 'ClaudeRunnerError';
    this.cancelled = cancelled;
    this.exitCode = exitCode;
  }
}

export function parseClaudeResult(output) {
  let parsed;
  try {
    parsed = JSON.parse(output);
  } catch (error) {
    throw new ClaudeRunnerError(`Claude returned invalid JSON: ${error.message}`);
  }
  const messages = Array.isArray(parsed) ? parsed : [parsed];
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
    this.active = null;
  }

  run(prompt, {
    cwd,
    model,
    effort,
    attachmentPaths = [],
    onEvent,
    onStderr,
  }) {
    if (this.active) {
      throw new ClaudeRunnerError('Claude already has an active Relay plan stage.');
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
    const active = { child, cancelRequested: false };
    this.active = active;
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
        onStderr(line);
      }
    });

    return new Promise((resolve, reject) => {
      child.once('error', (error) => {
        if (this.active === active) {
          this.active = null;
        }
        reject(new ClaudeRunnerError(`Could not start Claude Code: ${error.message}`));
      });
      child.once('close', (code, signal) => {
        if (this.active === active) {
          this.active = null;
        }
        if (stderrBuffer.trim()) {
          onStderr(stderrBuffer.trim());
        }
        if (active.cancelRequested) {
          reject(new ClaudeRunnerError('Task cancelled.', { cancelled: true, exitCode: code }));
          return;
        }
        if (code !== 0) {
          reject(new ClaudeRunnerError(
            `Claude Code stopped${signal ? ` after ${signal}` : ` with code ${code}`}.`,
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

  cancel() {
    if (!this.active) {
      return false;
    }
    this.active.cancelRequested = true;
    this.active.child.kill('SIGTERM');
    return true;
  }
}
