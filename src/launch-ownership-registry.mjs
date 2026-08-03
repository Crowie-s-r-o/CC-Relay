import { execFile as execFileCallback } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);

export const LAUNCH_OWNER_HEARTBEAT_MS = 15_000;
// A verified process start token, not this window, decides liveness whenever the platform can
// read one. The window only decides the answer when no token is available, so it is generous
// enough that a busy backend is never mistaken for a dead one.
export const LAUNCH_OWNER_STALE_MS = 90_000;
// A claim that has not bound a conversation yet blocks its whole provider and project, which is
// the cross-process form of the in-memory pending-launch exclusion. That exclusion is naturally
// bounded because it lives in memory a process eventually forgets. A row is not: a launch whose
// native close failed stays unbound while its backend keeps running. Bound it by age so a stuck
// row can never lock a project forever. The exact native identity of such a row still applies.
export const LAUNCH_BINDING_CLAIM_MS = 60_000;
const START_TOKEN_CACHE_MS = 5_000;
const START_TOKEN_TIMEOUT_MS = 2_000;
const DUAL_BACKEND_CACHE_MS = 1_500;

// Darwin 25 accepts `pgrep -t` and matches nothing, so no liveness rule here may depend on a
// TTY filter. `process.kill(pid, 0)` answers whether the identifier is currently taken, and
// `ps -p <pid> -o lstart=` answers whether it is still taken by the same process.
export function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the identifier belongs to a live process owned by another user.
    return error?.code === 'EPERM';
  }
}

// `ps -o lstart=` formats through the caller's locale and time zone. A desktop app started from
// Finder inherits neither, while a standalone backend started from a shell usually exports both,
// so the same live process reads as "Mon Aug  3 13:59:53 2026" to one backend and
// "Mo.  3 Aug. 13:59:53 2026" to the other. A token mismatch outranks the heartbeat and means
// DEAD, so an unpinned environment would make two live backends judge each other dead, silently
// disable this whole guard, and let pruneDeadOwners() delete the live owner's claims. Both the
// writer and every reader must therefore format the token identically.
export const START_TOKEN_ENVIRONMENT = { LC_ALL: 'C', LANG: 'C', TZ: 'UTC' };

export async function readProcessStartToken(pid, {
  platform = process.platform,
  run = execFile,
  environment = process.env,
} = {}) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  // Windows has no ps. A null token degrades that platform to the heartbeat window instead of
  // inventing a token shape the other backend could never reproduce.
  if (platform === 'win32') return null;
  try {
    const { stdout = '' } = await run('ps', ['-p', String(pid), '-o', 'lstart='], {
      timeout: START_TOKEN_TIMEOUT_MS,
      env: { ...environment, ...START_TOKEN_ENVIRONMENT },
    });
    const token = String(stdout).trim().replace(/\s+/g, ' ');
    return token || null;
  } catch {
    return null;
  }
}

function integerOrNull(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function textOrNull(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || null;
}

// Every CC Relay backend that shares relay-config.sqlite records the native terminal launches it
// owns here. A second backend consults the table before it adopts, rebinds, or closes a launch it
// did not create in memory, so two live processes can no longer fight over one terminal. Reads
// and writes are advisory: any failure degrades to the previous single-process behavior.
export class LaunchOwnershipRegistry {
  constructor({
    database = null,
    instanceId = randomUUID(),
    pid = process.pid,
    role = 'relay',
    dataRoot = null,
    now = () => Date.now(),
    diagnostic = () => {},
    readStartToken = (targetPid) => readProcessStartToken(targetPid),
    processAlive = isProcessAlive,
    heartbeatMs = LAUNCH_OWNER_HEARTBEAT_MS,
    staleMs = LAUNCH_OWNER_STALE_MS,
    bindingClaimMs = LAUNCH_BINDING_CLAIM_MS,
  } = {}) {
    this.database = database;
    this.instanceId = instanceId;
    this.pid = pid;
    this.role = role;
    this.dataRoot = dataRoot;
    this.now = now;
    this.diagnostic = diagnostic;
    this.readStartToken = readStartToken;
    this.processAlive = processAlive;
    this.heartbeatMs = heartbeatMs;
    this.staleMs = staleMs;
    this.bindingClaimMs = bindingClaimMs;
    this.startToken = null;
    this.available = false;
    this.heartbeatTimer = null;
    this.reportedFailures = new Set();
    this.startTokenCache = new Map();
    this.dualBackendCache = null;
    this.ensureSchema();
  }

  ensureSchema() {
    if (!this.database) return false;
    this.available = this.guard('schema', () => {
      this.database.exec(`
        CREATE TABLE IF NOT EXISTS relay_backends (
          instance_id TEXT PRIMARY KEY,
          pid INTEGER NOT NULL,
          start_token TEXT,
          role TEXT,
          data_root TEXT,
          started_at INTEGER NOT NULL,
          heartbeat_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS terminal_launch_owners (
          instance_id TEXT NOT NULL,
          launch_id TEXT NOT NULL,
          owner_pid INTEGER NOT NULL,
          provider TEXT NOT NULL,
          project_path TEXT,
          thread_id TEXT,
          expected_thread_id TEXT,
          terminal_window_id INTEGER,
          terminal_process_id INTEGER,
          runtime_process_id INTEGER,
          terminal_tty TEXT,
          ownership_source TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (instance_id, launch_id)
        );

        CREATE INDEX IF NOT EXISTS terminal_launch_owners_thread
          ON terminal_launch_owners (thread_id);
      `);
      return true;
    }, false);
    return this.available;
  }

  // Every registry call funnels through here. A shared configuration database that is locked,
  // read-only, or older than this table must never break a launch or a cleanup.
  guard(operation, action, fallback = null) {
    if (!this.database) return fallback;
    try {
      return action();
    } catch (error) {
      if (!this.reportedFailures.has(operation)) {
        this.reportedFailures.add(operation);
        this.diagnostic('launch.registry.failed', { operation, error: error.message });
      }
      return fallback;
    }
  }

  async start() {
    if (!this.available && !this.ensureSchema()) return false;
    // The backend row lands before the first await. Reading a start token spawns `ps`, and the
    // queue starts dispatching in the same tick as this call, so a launch recorded during that
    // await would otherwise look like an orphan claim that another backend prunes and adopts.
    const timestamp = this.now();
    const registered = this.guard('register', () => {
      this.database.prepare(`
        INSERT INTO relay_backends (
          instance_id, pid, start_token, role, data_root, started_at, heartbeat_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(instance_id) DO UPDATE SET
          pid = excluded.pid,
          heartbeat_at = excluded.heartbeat_at
      `).run(
        this.instanceId,
        this.pid,
        null,
        this.role,
        this.dataRoot,
        timestamp,
        timestamp,
      );
      return true;
    }, false);
    if (!registered) return false;
    this.startToken = await this.readStartToken(this.pid).catch(() => null);
    if (this.startToken) {
      this.guard('register-token', () => {
        this.database.prepare(`UPDATE relay_backends SET start_token = ? WHERE instance_id = ?`)
          .run(this.startToken, this.instanceId);
        return true;
      }, false);
    }
    await this.pruneDeadOwners();
    this.startHeartbeat();
    this.diagnostic('launch.registry.started', {
      instanceId: this.instanceId,
      pid: this.pid,
      startToken: this.startToken,
      foreignBackends: this.liveForeignBackendCount(),
    });
    return true;
  }

  startHeartbeat() {
    if (this.heartbeatTimer || !(this.heartbeatMs > 0)) return;
    this.heartbeatTimer = setInterval(() => this.heartbeat(), this.heartbeatMs);
    this.heartbeatTimer.unref?.();
  }

  heartbeat() {
    const timestamp = this.now();
    return this.guard('heartbeat', () => {
      this.database.prepare(`
        INSERT INTO relay_backends (
          instance_id, pid, start_token, role, data_root, started_at, heartbeat_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(instance_id) DO UPDATE SET heartbeat_at = excluded.heartbeat_at
      `).run(
        this.instanceId,
        this.pid,
        this.startToken,
        this.role,
        this.dataRoot,
        timestamp,
        timestamp,
      );
      return true;
    }, false);
  }

  backendRows() {
    return this.guard('backends', () => this.database.prepare(`
      SELECT instance_id, pid, start_token, heartbeat_at FROM relay_backends
    `).all(), []);
  }

  backendRow(instanceId) {
    return this.guard('backend', () => this.database.prepare(`
      SELECT instance_id, pid, start_token, heartbeat_at FROM relay_backends WHERE instance_id = ?
    `).get(instanceId), null) || null;
  }

  async startTokenFor(pid) {
    const cached = this.startTokenCache.get(pid);
    if (cached && cached.readAt + START_TOKEN_CACHE_MS > this.now()) return cached.token;
    let token = null;
    try {
      token = await this.readStartToken(pid);
    } catch {
      token = null;
    }
    this.startTokenCache.set(pid, { token, readAt: this.now() });
    return token;
  }

  // A backend counts as live when its identifier is still taken AND the process behind that
  // identifier is provably the same one that registered. Where no start token exists, the
  // heartbeat window is the only remaining evidence.
  async backendLive(backend) {
    if (!backend) return false;
    const pid = integerOrNull(backend.pid);
    if (!pid || !this.processAlive(pid)) return false;
    const token = await this.startTokenFor(pid);
    if (backend.start_token && token) return backend.start_token === token;
    return this.now() - Number(backend.heartbeat_at || 0) <= this.staleMs;
  }

  // Synchronous liveness for the status flag only. It never authorizes a terminal action.
  backendLikelyLive(backend) {
    if (!backend) return false;
    const pid = integerOrNull(backend.pid);
    if (!pid || !this.processAlive(pid)) return false;
    return this.now() - Number(backend.heartbeat_at || 0) <= this.staleMs;
  }

  liveForeignBackendCount() {
    return this.backendRows()
      .filter((backend) => backend.instance_id !== this.instanceId)
      .filter((backend) => this.backendLikelyLive(backend))
      .length;
  }

  dualBackendDetected() {
    if (this.dualBackendCache && this.dualBackendCache.readAt + DUAL_BACKEND_CACHE_MS > this.now()) {
      return this.dualBackendCache.value;
    }
    const value = this.liveForeignBackendCount() > 0;
    this.dualBackendCache = { value, readAt: this.now() };
    return value;
  }

  async pruneDeadOwners() {
    const backends = this.backendRows();
    for (const backend of backends) {
      if (backend.instance_id === this.instanceId) continue;
      if (await this.backendLive(backend)) continue;
      this.guard('prune', () => {
        this.database.prepare(`DELETE FROM terminal_launch_owners WHERE instance_id = ?`)
          .run(backend.instance_id);
        this.database.prepare(`DELETE FROM relay_backends WHERE instance_id = ?`)
          .run(backend.instance_id);
        return true;
      }, false);
    }
    // Launch rows whose backend row is gone can never be verified again, so they must not
    // outlive it and permanently block adoption.
    this.guard('prune-orphans', () => {
      this.database.prepare(`
        DELETE FROM terminal_launch_owners
        WHERE instance_id NOT IN (SELECT instance_id FROM relay_backends)
      `).run();
      return true;
    }, false);
  }

  recordLaunch({
    launchId,
    provider,
    path = null,
    threadId = null,
    expectedThreadId = null,
    terminalWindowId = null,
    terminalProcessId = null,
    runtimeProcessId = null,
    terminalTty = null,
    ownershipSource = 'launch',
  } = {}) {
    if (!textOrNull(launchId) || !textOrNull(provider)) return false;
    const timestamp = this.now();
    return this.guard('record', () => {
      this.database.prepare(`
        INSERT INTO terminal_launch_owners (
          instance_id, launch_id, owner_pid, provider, project_path, thread_id,
          expected_thread_id, terminal_window_id, terminal_process_id, runtime_process_id,
          terminal_tty, ownership_source, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(instance_id, launch_id) DO UPDATE SET
          provider = excluded.provider,
          project_path = excluded.project_path,
          thread_id = excluded.thread_id,
          expected_thread_id = excluded.expected_thread_id,
          terminal_window_id = excluded.terminal_window_id,
          terminal_process_id = excluded.terminal_process_id,
          runtime_process_id = excluded.runtime_process_id,
          terminal_tty = excluded.terminal_tty,
          ownership_source = excluded.ownership_source,
          updated_at = excluded.updated_at
      `).run(
        this.instanceId,
        launchId,
        this.pid,
        provider,
        textOrNull(path),
        textOrNull(threadId),
        textOrNull(expectedThreadId),
        integerOrNull(terminalWindowId),
        integerOrNull(terminalProcessId),
        integerOrNull(runtimeProcessId),
        textOrNull(terminalTty),
        textOrNull(ownershipSource) || 'launch',
        timestamp,
        timestamp,
      );
      return true;
    }, false);
  }

  updateLaunch(launchId, {
    threadId,
    terminalWindowId,
    terminalProcessId,
    runtimeProcessId,
    terminalTty,
  } = {}) {
    if (!textOrNull(launchId)) return false;
    const assignments = [];
    const values = [];
    if (threadId !== undefined) {
      assignments.push('thread_id = ?');
      values.push(textOrNull(threadId));
    }
    if (terminalWindowId !== undefined) {
      assignments.push('terminal_window_id = ?');
      values.push(integerOrNull(terminalWindowId));
    }
    if (terminalProcessId !== undefined) {
      assignments.push('terminal_process_id = ?');
      values.push(integerOrNull(terminalProcessId));
    }
    if (runtimeProcessId !== undefined) {
      assignments.push('runtime_process_id = ?');
      values.push(integerOrNull(runtimeProcessId));
    }
    if (terminalTty !== undefined) {
      assignments.push('terminal_tty = ?');
      values.push(textOrNull(terminalTty));
    }
    if (assignments.length === 0) return false;
    return this.guard('update', () => {
      this.database.prepare(`
        UPDATE terminal_launch_owners
        SET ${assignments.join(', ')}, updated_at = ?
        WHERE instance_id = ? AND launch_id = ?
      `).run(...values, this.now(), this.instanceId, launchId);
      return true;
    }, false);
  }

  removeLaunch(launchId) {
    if (!textOrNull(launchId)) return false;
    return this.guard('remove', () => {
      this.database.prepare(`
        DELETE FROM terminal_launch_owners WHERE instance_id = ? AND launch_id = ?
      `).run(this.instanceId, launchId);
      return true;
    }, false);
  }

  clearOwnLaunches() {
    return this.guard('clear', () => {
      this.database.prepare(`DELETE FROM terminal_launch_owners WHERE instance_id = ?`)
        .run(this.instanceId);
      return true;
    }, false);
  }

  ownLaunch(launchId) {
    if (!textOrNull(launchId)) return null;
    return this.guard('own-launch', () => this.database.prepare(`
      SELECT * FROM terminal_launch_owners WHERE instance_id = ? AND launch_id = ?
    `).get(this.instanceId, launchId), null) || null;
  }

  candidateRows({
    threadId = null,
    provider = null,
    path = null,
    terminalWindowId = null,
    terminalProcessId = null,
    runtimeProcessId = null,
    terminalTty = null,
  }, { includePendingClaims = true } = {}) {
    const thread = textOrNull(threadId);
    const windowId = integerOrNull(terminalWindowId);
    const processId = integerOrNull(terminalProcessId);
    const runtimeId = integerOrNull(runtimeProcessId);
    const tty = textOrNull(terminalTty);
    const conditions = [
      '(? IS NOT NULL AND thread_id = ?)',
      '(? IS NOT NULL AND expected_thread_id = ?)',
      '(? IS NOT NULL AND terminal_window_id = ?)',
      '(? IS NOT NULL AND terminal_process_id = ?)',
      '(? IS NOT NULL AND runtime_process_id = ?)',
      '(? IS NOT NULL AND terminal_tty = ?)',
    ];
    const values = [
      thread, thread,
      thread, thread,
      windowId, windowId,
      processId, processId,
      runtimeId, runtimeId,
      tty, tty,
    ];
    // The pending rule identifies no particular terminal, only a provider and a project, so it
    // belongs to adoption alone. Applied to verification or closing it would make a foreign
    // backend's binding window block a terminal this process already owns and proved.
    if (includePendingClaims) {
      conditions.push(`(
        thread_id IS NULL
        AND created_at >= ?
        AND ? IS NOT NULL AND provider = ?
        AND ? IS NOT NULL AND project_path = ?
      )`);
      values.push(
        this.now() - this.bindingClaimMs,
        textOrNull(provider), textOrNull(provider),
        textOrNull(path), textOrNull(path),
      );
    }
    return this.guard('candidates', () => this.database.prepare(`
      SELECT * FROM terminal_launch_owners
      WHERE instance_id != ?
        AND (${conditions.join('\n          OR ')})
    `).all(this.instanceId, ...values), []);
  }

  matchReason(row, query) {
    const thread = textOrNull(query.threadId);
    if (thread && row.thread_id === thread) return { reason: 'conversation', rank: 0 };
    if (thread && row.expected_thread_id === thread) return { reason: 'expected-conversation', rank: 1 };
    const windowId = integerOrNull(query.terminalWindowId);
    const processId = integerOrNull(query.terminalProcessId);
    const runtimeId = integerOrNull(query.runtimeProcessId);
    const tty = textOrNull(query.terminalTty);
    if (
      (windowId && row.terminal_window_id === windowId)
      || (processId && row.terminal_process_id === processId)
      || (runtimeId && row.runtime_process_id === runtimeId)
      || (tty && row.terminal_tty === tty)
    ) {
      return { reason: 'native-terminal', rank: 2 };
    }
    return { reason: 'pending-launch', rank: 3 };
  }

  // `precedingLaunchId` resolves a simultaneous adoption. Only a foreign row that was written
  // before our own row of that launch identifier wins, so exactly one of two racing backends
  // yields instead of both yielding or neither.
  async foreignOwner(query = {}, {
    precedingLaunchId = null,
    includePendingClaims = true,
  } = {}) {
    if (!this.database) return null;
    const rows = this.candidateRows(query, { includePendingClaims });
    if (rows.length === 0) return null;
    const own = precedingLaunchId ? this.ownLaunch(precedingLaunchId) : null;
    const ranked = rows
      .map((row) => ({ row, ...this.matchReason(row, query) }))
      .sort((left, right) => left.rank - right.rank);
    for (const { row, reason } of ranked) {
      if (own && !this.precedes(row, own)) continue;
      const backend = this.backendRow(row.instance_id);
      if (!(await this.backendLive(backend))) continue;
      return {
        instanceId: row.instance_id,
        launchId: row.launch_id,
        pid: integerOrNull(backend?.pid) ?? integerOrNull(row.owner_pid),
        provider: row.provider,
        path: row.project_path,
        threadId: row.thread_id,
        expectedThreadId: row.expected_thread_id,
        terminalWindowId: row.terminal_window_id,
        terminalTty: row.terminal_tty,
        ownershipSource: row.ownership_source,
        heartbeatAt: backend?.heartbeat_at ?? null,
        reason,
      };
    }
    return null;
  }

  precedes(row, own) {
    const rowCreated = Number(row.created_at || 0);
    const ownCreated = Number(own.created_at || 0);
    if (rowCreated !== ownCreated) return rowCreated < ownCreated;
    return String(row.instance_id) < String(own.instance_id);
  }

  stop() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.clearOwnLaunches();
    this.guard('unregister', () => {
      this.database.prepare(`DELETE FROM relay_backends WHERE instance_id = ?`)
        .run(this.instanceId);
      return true;
    }, false);
  }
}
