import { execFile } from 'node:child_process';
import { isUnknownOptionError } from './claude-binary.mjs';

function execute(command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, {
      encoding: 'utf8',
      maxBuffer: 2 * 1024 * 1024,
      timeout: 10_000,
    }, (error, stdout, stderr) => {
      if (error) {
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve(stdout);
    });
  });
}

export function normalizeClaudeSessions(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  const sessions = value
    .filter((session) => (
      typeof session?.sessionId === 'string'
      && typeof session?.cwd === 'string'
      && Number.isInteger(session?.pid)
    ))
    .map((session) => ({
      id: session.sessionId,
      provider: 'claude',
      sessionId: session.sessionId,
      title: session.name || `Claude session ${session.sessionId.slice(0, 8)}`,
      preview: `${session.kind || 'interactive'} session${session.status === 'busy' ? ' currently working' : ' ready for work'}`,
      cwd: session.cwd,
      source: `Claude ${session.kind || 'session'}`,
      status: session.status === 'busy' ? 'active' : 'idle',
      rawStatus: session.status || 'idle',
      pid: session.pid,
      connectedToRelay: true,
      updatedAt: Number(session.startedAt) || null,
    }));
  const unique = new Map();
  for (const session of sessions) {
    const existing = unique.get(session.id);
    const sessionIsInteractive = session.source === 'Claude interactive';
    const existingIsInteractive = existing?.source === 'Claude interactive';
    if (!existing || (sessionIsInteractive && !existingIsInteractive)
      || (sessionIsInteractive === existingIsInteractive && (session.updatedAt || 0) > (existing.updatedAt || 0))) {
      unique.set(session.id, session);
    }
  }
  return [...unique.values()].sort((left, right) => (right.updatedAt || 0) - (left.updatedAt || 0));
}

export class ClaudeSessionRegistry {
  constructor({ runCommand = execute, cacheMs = 750, resolveCommand = async () => 'claude' } = {}) {
    this.runCommand = runCommand;
    this.cacheMs = cacheMs;
    this.resolveCommand = resolveCommand;
    this.cachedAt = 0;
    this.cachedSessions = [];
    this.pending = null;
    this.lastError = null;
    this.lastGoodAt = 0;
    this.stale = false;
  }

  async listSessions({ refresh = false } = {}) {
    if (!refresh && Date.now() - this.cachedAt < this.cacheMs) {
      return this.cachedSessions;
    }
    // A forced refresh joins a discovery already in flight rather than starting a second one.
    // That discovery reads live state at the moment it resolves, so the caller still gets
    // current data; it only gives up control over when the read started. Deliberate: the
    // 800 ms liveness poll and dispatch can both ask at once, and one probe per caller is what
    // produced the spawn storm that made discovery fail in the first place.
    if (this.pending) {
      return this.pending;
    }
    this.pending = this.discover()
      .then((output) => {
        this.cachedSessions = normalizeClaudeSessions(JSON.parse(output));
        this.cachedAt = Date.now();
        this.lastGoodAt = this.cachedAt;
        this.lastError = null;
        this.stale = false;
        return this.cachedSessions;
      })
      .catch((error) => {
        // Last known good, deliberately. Blanking the cache here made every live Claude
        // session disappear for cacheMs after a single transient `claude agents --json`
        // failure (spawn EAGAIN, probe timeout, JSON hiccup), which turned an ordinary
        // POST /api/tasks into a hard "that session is no longer open" rejection. A failed
        // probe tells us nothing about the sessions, so it must not erase what we knew.
        // A probe that SUCCEEDS and omits a session still removes it, so a genuinely
        // closed terminal is still detected on the very next discovery.
        this.cachedAt = Date.now();
        this.lastError = error.message;
        this.stale = true;
        return this.cachedSessions;
      })
      .finally(() => {
        this.pending = null;
      });
    return this.pending;
  }

  // Runs `claude agents --json` against the resolved binary. If the invocation
  // fails with an unknown-option error (an outdated binary that predates the
  // `--json` flag), re-resolve to a newer binary once and retry.
  async discover() {
    const command = await this.resolveCommand();
    try {
      return await this.runCommand(command, ['agents', '--json']);
    } catch (error) {
      if (isUnknownOptionError(error)) {
        const refreshed = await this.resolveCommand({ refresh: true });
        if (refreshed !== command) {
          return this.runCommand(refreshed, ['agents', '--json']);
        }
      }
      throw error;
    }
  }

  // Dispatch-time and liveness lookup. Forces a fresh probe because a runner about to type
  // into a terminal needs current truth, not a cached guess.
  async readConnectedSession(sessionId) {
    const sessions = await this.listSessions({ refresh: true });
    return sessions.find((session) => session.id === sessionId) || null;
  }

  // Add-path lookup. Serves the warm cache instead of forcing a cold `claude agents --json`
  // spawn, so creating a task never waits on a subprocess and never fails because discovery
  // happened to be mid-refresh.
  async findSession(sessionId) {
    const sessions = await this.listSessions();
    return sessions.find((session) => session.id === sessionId) || null;
  }

  // Synchronous last-known-good lookup with no I/O at all.
  knownSession(sessionId) {
    return this.cachedSessions.find((session) => session.id === sessionId) || null;
  }
}
