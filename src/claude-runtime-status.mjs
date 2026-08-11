import { execFile as execFileCallback, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { providerCommandInvocation } from './claude-binary.mjs';

const execFile = promisify(execFileCallback);

const DEFAULT_CACHE_MS = 5_000;
const DEFAULT_REFRESH_MS = 15_000;
const DEFAULT_TIMEOUT_MS = 8_000;

// Every Claude CLI probe below is bounded. An unbounded probe was the difference between a
// slow CC Relay and a hung one: `claude auth status --json` can stall on a network round trip,
// and the former synchronous reader had no timeout at all.
const PROBE_OPTIONS = { encoding: 'utf8', timeout: DEFAULT_TIMEOUT_MS };

function text(value) {
  if (Buffer.isBuffer(value)) return value.toString('utf8');
  return typeof value === 'string' ? value : '';
}

function parseAuthOutput(value) {
  const output = text(value).trim();
  return output ? JSON.parse(output) : null;
}

function executableMissing(error) {
  const output = [
    error?.code || '',
    text(error?.stdout),
    text(error?.stderr),
    error?.message || '',
  ].join('\n');
  return error?.code === 'ENOENT'
    || /(?:spawn|execFile).+ENOENT|command not found|not recognized as an internal or external command/i.test(output);
}

function unavailable(error) {
  return {
    available: false,
    authenticated: false,
    version: null,
    error: error.message,
    reason: executableMissing(error) ? 'not_installed' : 'probe_failed',
  };
}

function installedButUnknown(version, error) {
  return {
    available: true,
    authenticated: false,
    version,
    error: error.message,
  };
}

function fromAuth(auth, version) {
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

export function readClaudeRuntimeStatus({
  run = execFileSync,
  command = 'claude',
  platform = process.platform,
} = {}) {
  // The resolved Windows binary is normally the `claude.cmd` shim, which cannot be executed
  // directly. Probing it that way reports Claude as not installed no matter what is installed.
  const invoke = (args, options) => {
    const invocation = providerCommandInvocation(command, args, { platform });
    return run(invocation.command, invocation.args, { ...options, ...invocation.options });
  };
  let version;
  try {
    version = text(invoke(['--version'], PROBE_OPTIONS)).trim();
  } catch (error) {
    return unavailable(error);
  }

  let auth;
  try {
    auth = parseAuthOutput(invoke(
      ['auth', 'status', '--json'],
      { ...PROBE_OPTIONS, stdio: ['ignore', 'pipe', 'pipe'] },
    ));
  } catch (error) {
    try {
      auth = parseAuthOutput(error.stdout);
    } catch {
      return installedButUnknown(version, error);
    }
  }

  return fromAuth(auth, version);
}

// Asynchronous twin of readClaudeRuntimeStatus. This is the one the server uses, so a
// Claude CLI probe can never block the Node event loop and therefore can never delay
// POST /api/tasks, /api/status, or SSE delivery.
export async function readClaudeRuntimeStatusAsync({
  run = execFile,
  command = 'claude',
  timeoutMs = DEFAULT_TIMEOUT_MS,
  platform = process.platform,
} = {}) {
  const options = { encoding: 'utf8', timeout: timeoutMs };
  const invoke = (args) => {
    const invocation = providerCommandInvocation(command, args, { platform });
    return run(invocation.command, invocation.args, { ...options, ...invocation.options });
  };
  let version;
  try {
    version = text((await invoke(['--version'])).stdout).trim();
  } catch (error) {
    return unavailable(error);
  }

  let auth;
  try {
    auth = parseAuthOutput((await invoke(['auth', 'status', '--json'])).stdout);
  } catch (error) {
    try {
      auth = parseAuthOutput(error.stdout);
    } catch {
      return installedButUnknown(version, error);
    }
  }

  return fromAuth(auth, version);
}

// Status is now pull-from-cache only. `current()` never spawns a process, so request
// handlers are constant time. A background interval keeps the cache warm.
export class ClaudeRuntimeStatus {
  constructor({
    read = readClaudeRuntimeStatusAsync,
    now = Date.now,
    cacheMs = DEFAULT_CACHE_MS,
    refreshMs = DEFAULT_REFRESH_MS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    command = 'claude',
  } = {}) {
    this.read = read;
    this.now = now;
    this.cacheMs = cacheMs;
    this.refreshMs = refreshMs;
    this.timeoutMs = timeoutMs;
    this.command = command;
    this.status = null;
    this.checkedAt = 0;
    this.pending = null;
    this.timer = null;
  }

  // Never blocks and never spawns. Before the first successful probe the caller receives an
  // explicitly pending status so it can distinguish "not signed in" from "not checked yet".
  current() {
    if (!this.status) {
      return {
        available: false,
        authenticated: false,
        version: null,
        pending: true,
        checkedAt: null,
      };
    }
    return { ...this.status, pending: false, checkedAt: this.checkedAt };
  }

  // Concurrent refreshes share one probe, so a burst of requests cannot spawn a burst of
  // Claude processes.
  refresh({ force = false } = {}) {
    if (!force && this.status && this.now() - this.checkedAt < this.cacheMs) {
      return Promise.resolve(this.current());
    }
    if (this.pending) return this.pending;
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
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

// A confident negative is a completed probe that actually reported the CLI as missing or
// signed out. A pending or errored probe is NOT confident, so it must never reject a task
// add: transient uncertainty is exactly what used to make adding a task fail.
export function isConfidentlyUnavailable(status) {
  return Boolean(status)
    && status.pending !== true
    && status.available === true
    && status.authenticated === false
    && status.reason === 'signed_out';
}
