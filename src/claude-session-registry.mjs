import { execFile } from 'node:child_process';

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
  return value
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
    }))
    .sort((left, right) => (right.updatedAt || 0) - (left.updatedAt || 0));
}

export class ClaudeSessionRegistry {
  constructor({ runCommand = execute, cacheMs = 750 } = {}) {
    this.runCommand = runCommand;
    this.cacheMs = cacheMs;
    this.cachedAt = 0;
    this.cachedSessions = [];
    this.pending = null;
    this.lastError = null;
  }

  async listSessions({ refresh = false } = {}) {
    if (!refresh && Date.now() - this.cachedAt < this.cacheMs) {
      return this.cachedSessions;
    }
    if (this.pending) {
      return this.pending;
    }
    this.pending = this.runCommand('claude', ['agents', '--json'])
      .then((output) => {
        this.cachedSessions = normalizeClaudeSessions(JSON.parse(output));
        this.cachedAt = Date.now();
        this.lastError = null;
        return this.cachedSessions;
      })
      .catch((error) => {
        this.cachedSessions = [];
        this.cachedAt = Date.now();
        this.lastError = error.message;
        return [];
      })
      .finally(() => {
        this.pending = null;
      });
    return this.pending;
  }

  async readConnectedSession(sessionId) {
    const sessions = await this.listSessions({ refresh: true });
    return sessions.find((session) => session.id === sessionId) || null;
  }
}
