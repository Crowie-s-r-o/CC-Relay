import { execFile as execFileCallback } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';
import { providerCommandInvocation, resolveExecutableOnPath } from './claude-binary.mjs';

const execFile = promisify(execFileCallback);
const DEFAULT_CACHE_MS = 5_000;
const DEFAULT_REFRESH_MS = 15_000;
const DEFAULT_TIMEOUT_MS = 8_000;
const ANSI_ESCAPE = /\u001b\[[0-?]*[ -/]*[@-~]/g;

function text(value) {
  if (Buffer.isBuffer(value)) return value.toString('utf8');
  return typeof value === 'string' ? value : '';
}

function executableMissing(error) {
  const output = [error?.code || '', text(error?.stderr), error?.message || ''].join('\n');
  return error?.code === 'ENOENT'
    || /(?:spawn|execFile).+ENOENT|command not found|not recognized as an internal or external command/i.test(output);
}

function authenticationFailure(error) {
  const output = [text(error?.stdout), text(error?.stderr), error?.message || ''].join('\n');
  return /not authenticated|authentication required|no credentials|login required|run.+auth login/i.test(output);
}

export function openCodeDefaultModel() {
  return {
    model: 'default',
    displayName: 'Configured default',
    description: 'Use the default model configured by OpenCode.',
    isDefault: true,
    defaultReasoningEffort: null,
    supportedReasoningEfforts: [],
  };
}

export function parseOpenCodeModels(value) {
  const ids = text(value)
    .replace(ANSI_ESCAPE, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[^\s/]+\/[^\s]+$/.test(line));
  return [...new Set(ids)].map((model) => ({
    model,
    displayName: model,
    description: `OpenCode model ${model}.`,
    isDefault: false,
    defaultReasoningEffort: null,
    supportedReasoningEfforts: [],
  }));
}

export function resolveOpenCodeCommand({
  command = 'opencode',
  env = process.env,
  platform = process.platform,
  home = homedir(),
  fileExists = existsSync,
} = {}) {
  const windowsCommand = resolveExecutableOnPath(command, { env, platform, fileExists });
  if (platform === 'win32' || /[\\/]/.test(command)) return windowsCommand;
  const candidates = [
    ...String(env?.PATH || '').split(':').filter(Boolean).map((entry) => join(entry, command)),
    join(home, '.opencode', 'bin', command),
    join(home, '.local', 'bin', command),
    join('/opt/homebrew/bin', command),
    join('/usr/local/bin', command),
    join('/usr/bin', command),
  ];
  return candidates.find((candidate) => {
    try { return fileExists(candidate); } catch { return false; }
  }) || command;
}

export async function readOpenCodeRuntimeStatus({
  run = execFile,
  command = 'opencode',
  timeoutMs = DEFAULT_TIMEOUT_MS,
  platform = process.platform,
} = {}) {
  const invoke = async (args) => {
    const invocation = providerCommandInvocation(command, args, { platform });
    return run(invocation.command, invocation.args, {
      encoding: 'utf8',
      timeout: timeoutMs,
      ...invocation.options,
    });
  };

  let version;
  try {
    version = text((await invoke(['--version'])).stdout).trim();
  } catch (error) {
    return {
      available: false,
      authenticated: false,
      version: null,
      reason: executableMissing(error) ? 'not_installed' : 'probe_failed',
      error: error.message,
      models: [],
    };
  }

  try {
    const discovered = parseOpenCodeModels((await invoke(['models'])).stdout);
    return {
      available: true,
      authenticated: discovered.length > 0,
      version,
      reason: discovered.length > 0 ? null : 'signed_out',
      error: discovered.length > 0 ? null : 'OpenCode reported no configured models.',
      models: [openCodeDefaultModel(), ...discovered],
    };
  } catch (error) {
    return {
      available: true,
      authenticated: false,
      version,
      reason: authenticationFailure(error) ? 'signed_out' : 'probe_failed',
      error: error.message,
      models: [openCodeDefaultModel()],
    };
  }
}

export class OpenCodeRuntimeStatus {
  constructor({
    read = readOpenCodeRuntimeStatus,
    now = Date.now,
    cacheMs = DEFAULT_CACHE_MS,
    refreshMs = DEFAULT_REFRESH_MS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    command = null,
    resolveCommand = resolveOpenCodeCommand,
  } = {}) {
    this.read = read;
    this.now = now;
    this.cacheMs = cacheMs;
    this.refreshMs = refreshMs;
    this.timeoutMs = timeoutMs;
    this.resolveCommand = resolveCommand;
    this.commandPinned = typeof command === 'string' && command.length > 0;
    this.command = this.commandPinned ? command : this.resolveCommand();
    this.status = null;
    this.checkedAt = 0;
    this.pending = null;
    this.timer = null;
  }

  current() {
    if (!this.status) {
      return {
        available: false,
        authenticated: false,
        version: null,
        pending: true,
        checkedAt: null,
        models: [],
      };
    }
    return { ...this.status, pending: false, checkedAt: this.checkedAt };
  }

  models() {
    return this.current().models || [];
  }

  refresh({ force = false } = {}) {
    if (!force && this.status && this.now() - this.checkedAt < this.cacheMs) {
      return Promise.resolve(this.current());
    }
    if (this.pending) return this.pending;
    if (!this.commandPinned && this.status?.reason === 'not_installed') {
      this.command = this.resolveCommand();
    }
    this.pending = Promise.resolve()
      .then(() => this.read({ command: this.command, timeoutMs: this.timeoutMs }))
      .then((status) => {
        this.status = status;
        this.checkedAt = this.now();
        return this.current();
      })
      .catch(() => this.current())
      .finally(() => {
        this.pending = null;
      });
    return this.pending;
  }

  start() {
    if (this.timer) return this;
    void this.refresh({ force: true });
    this.timer = setInterval(() => {
      void this.refresh({ force: true });
    }, this.refreshMs);
    this.timer.unref?.();
    return this;
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

export function openCodeIsConfidentlyUnavailable(status) {
  return Boolean(status)
    && status.pending !== true
    && (
      status.reason === 'not_installed'
      || (status.available === true && status.authenticated === false && status.reason === 'signed_out')
    );
}

export function openCodeCommandLabel(command) {
  return basename(command || 'opencode');
}
