import { execFileSync } from 'node:child_process';

const DEFAULT_CACHE_MS = 5_000;

function text(value) {
  if (Buffer.isBuffer(value)) return value.toString('utf8');
  return typeof value === 'string' ? value : '';
}

function parseAuthOutput(value) {
  const output = text(value).trim();
  return output ? JSON.parse(output) : null;
}

export function readClaudeRuntimeStatus({ run = execFileSync, command = 'claude' } = {}) {
  let version;
  try {
    version = text(run(command, ['--version'], { encoding: 'utf8' })).trim();
  } catch (error) {
    return {
      available: false,
      authenticated: false,
      version: null,
      error: error.message,
    };
  }

  let auth;
  try {
    auth = parseAuthOutput(run(
      command,
      ['auth', 'status', '--json'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    ));
  } catch (error) {
    try {
      auth = parseAuthOutput(error.stdout);
    } catch {
      return {
        available: true,
        authenticated: false,
        version,
        error: error.message,
      };
    }
  }

  if (!auth) {
    return {
      available: true,
      authenticated: false,
      version,
      error: 'Claude CLI returned no authentication status.',
    };
  }

  return {
    available: true,
    authenticated: auth.loggedIn === true,
    version,
    authMethod: auth.authMethod || null,
    subscriptionType: auth.subscriptionType || null,
    reason: auth.loggedIn === true ? null : 'signed_out',
  };
}

export class ClaudeRuntimeStatus {
  constructor({ read = readClaudeRuntimeStatus, now = Date.now, cacheMs = DEFAULT_CACHE_MS, command = 'claude' } = {}) {
    this.read = read;
    this.now = now;
    this.cacheMs = cacheMs;
    this.command = command;
    this.status = null;
    this.checkedAt = 0;
  }

  current({ force = false } = {}) {
    const timestamp = this.now();
    if (force || !this.status || timestamp - this.checkedAt >= this.cacheMs) {
      this.status = this.read({ command: this.command });
      this.checkedAt = timestamp;
    }
    return this.status;
  }
}
