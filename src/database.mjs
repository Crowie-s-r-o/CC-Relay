import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const TASK_FIELDS = new Set([
  'title',
  'prompt',
  'repo_path',
  'thread_id',
  'thread_name',
  'thread_source',
  'provider',
  'model',
  'effort',
  'mode',
  'author_provider',
  'author_model',
  'author_effort',
  'reviewer_provider',
  'reviewer_model',
  'reviewer_effort',
  'continued_from_task_id',
  'submission_id',
  'turbo_json',
  'attachments_json',
  'status',
  'position',
  'started_at',
  'finished_at',
  'session_id',
  'result',
  'error',
  'exit_code',
]);

function now() {
  return new Date().toISOString();
}

function normalizeTask(row) {
  if (!row) {
    return null;
  }
  const {
    attachments_json: encodedAttachments,
    turbo_json: encodedTurbo,
    submission_id: _submissionId,
    clear_context: _legacyClearContext,
    ...task
  } = row;
  let attachments = [];
  try {
    attachments = JSON.parse(encodedAttachments || '[]');
  } catch {}
  let turbo = null;
  try { turbo = encodedTurbo ? JSON.parse(encodedTurbo) : null; } catch {}
  return { ...task, attachments: Array.isArray(attachments) ? attachments : [], turbo };
}

export class RelayDatabase {
  constructor(filePath) {
    mkdirSync(dirname(filePath), { recursive: true });
    this.database = new DatabaseSync(filePath);
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;

      CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        prompt TEXT NOT NULL,
        repo_path TEXT NOT NULL,
        thread_id TEXT,
        thread_name TEXT,
        thread_source TEXT,
        provider TEXT NOT NULL DEFAULT 'codex',
        model TEXT,
        effort TEXT,
        mode TEXT NOT NULL DEFAULT 'execute',
        author_provider TEXT,
        author_model TEXT,
        author_effort TEXT,
        reviewer_provider TEXT,
        reviewer_model TEXT,
        reviewer_effort TEXT,
        continued_from_task_id INTEGER,
        submission_id TEXT,
        turbo_json TEXT,
        attachments_json TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'queued',
        position INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT,
        session_id TEXT,
        result TEXT,
        error TEXT,
        exit_code INTEGER
      );

      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id INTEGER NOT NULL,
        kind TEXT NOT NULL,
        message TEXT NOT NULL,
        payload TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        position INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        last_launched_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_tasks_status_position
        ON tasks(status, position, id);
      CREATE INDEX IF NOT EXISTS idx_tasks_repo_status_position
        ON tasks(repo_path, status, position, id);
      CREATE INDEX IF NOT EXISTS idx_events_task_id
        ON events(task_id, id);
    `);

    this.ensureColumn('thread_id', 'TEXT');
    this.ensureColumn('thread_name', 'TEXT');
    this.ensureColumn('thread_source', 'TEXT');
    this.ensureColumn('provider', "TEXT NOT NULL DEFAULT 'codex'");
    this.ensureColumn('model', 'TEXT');
    this.ensureColumn('effort', 'TEXT');
    this.ensureColumn('mode', "TEXT NOT NULL DEFAULT 'execute'");
    this.ensureColumn('author_provider', 'TEXT');
    this.ensureColumn('author_model', 'TEXT');
    this.ensureColumn('author_effort', 'TEXT');
    this.ensureColumn('reviewer_provider', 'TEXT');
    this.ensureColumn('reviewer_model', 'TEXT');
    this.ensureColumn('reviewer_effort', 'TEXT');
    this.ensureColumn('continued_from_task_id', 'INTEGER');
    this.ensureColumn('submission_id', 'TEXT');
    this.ensureColumn('turbo_json', 'TEXT');
    this.ensureColumn('attachments_json', "TEXT NOT NULL DEFAULT '[]'");
    this.database.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_submission_id
        ON tasks(submission_id)
        WHERE submission_id IS NOT NULL;
    `);

    this.database.prepare(`
      INSERT OR IGNORE INTO settings (key, value) VALUES ('paused', '0')
    `).run();
  }

  ensureColumn(name, definition) {
    const columns = this.database.prepare(`PRAGMA table_info(tasks)`).all();
    if (!columns.some((column) => column.name === name)) {
      this.database.exec(`ALTER TABLE tasks ADD COLUMN ${name} ${definition}`);
    }
  }

  recoverInterruptedTasks() {
    const timestamp = now();
    const runningTasks = this.database.prepare(
      `SELECT id FROM tasks WHERE status = 'running' ORDER BY id`,
    ).all();

    for (const task of runningTasks) {
      const latestStart = this.database.prepare(`
        SELECT message FROM events
        WHERE task_id = ?
          AND kind = 'queue'
          AND (
            message LIKE 'Task started%'
            OR message LIKE 'Follow-up dispatch requested%'
            OR message LIKE 'Follow-up started immediately%'
          )
        ORDER BY id DESC
        LIMIT 1
      `).get(task.id);
      const followUpInterrupted = latestStart?.message?.startsWith('Follow-up');
      const error = followUpInterrupted
        ? 'Same-session follow-up interrupted: Relay stopped while the follow-up was running.'
        : 'Relay stopped while this task was running.';
      this.database.prepare(`
        UPDATE tasks
        SET status = 'interrupted',
            finished_at = ?,
            error = ?
        WHERE id = ?
      `).run(timestamp, error, task.id);
      this.addEvent(
        task.id,
        'system',
        followUpInterrupted
          ? 'Same-session follow-up marked interrupted after Relay restarted. It was not queued.'
          : 'Task marked interrupted after Relay restarted.',
      );
    }

    return runningTasks.length;
  }

  createTask({
    title,
    prompt,
    thread,
    provider = 'codex',
    model = null,
    effort = null,
    mode = 'execute',
    council = {},
    turbo = null,
    continuedFromTaskId = null,
    submissionId = null,
    priority = false,
  }) {
    const repoPath = thread.cwd || '';
    const row = this.database.prepare(
      `SELECT
         COALESCE(MAX(position), 0) AS max_position,
         COALESCE(MIN(CASE WHEN status = 'queued' THEN position END), 1) AS min_queued_position
       FROM tasks
       WHERE repo_path = ?`,
    ).get(repoPath);
    const result = this.database.prepare(`
      INSERT INTO tasks (
        title, prompt, repo_path, thread_id, thread_name, thread_source,
        provider, model, effort, mode,
        author_provider, author_model, author_effort,
        reviewer_provider, reviewer_model, reviewer_effort, continued_from_task_id, submission_id, turbo_json,
        status, position, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?)
    `).run(
      title,
      prompt,
      repoPath,
      thread.id,
      thread.title,
      thread.source,
      provider,
      model,
      effort,
      mode,
      council.authorProvider || null,
      council.authorModel || null,
      council.authorEffort || null,
      council.reviewerProvider || null,
      council.reviewerModel || null,
      council.reviewerEffort || null,
      continuedFromTaskId,
      submissionId,
      turbo ? JSON.stringify(turbo) : null,
      priority ? Number(row.min_queued_position) - 1 : Number(row.max_position) + 1,
      now(),
    );

    const task = this.getTask(Number(result.lastInsertRowid));
    this.addEvent(task.id, 'queue', 'Task added to the queue.');
    return task;
  }

  getTask(id) {
    return normalizeTask(this.database.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id));
  }

  getTaskBySubmissionId(submissionId) {
    if (!submissionId) return null;
    return normalizeTask(this.database.prepare(
      `SELECT * FROM tasks WHERE submission_id = ?`,
    ).get(submissionId));
  }

  listTasks() {
    return this.database.prepare(`
      SELECT * FROM tasks
      ORDER BY
        CASE status
          WHEN 'running' THEN 0
          WHEN 'queued' THEN 1
          ELSE 2
        END,
        CASE WHEN status = 'queued' THEN position END ASC,
        CASE WHEN status IN ('running', 'queued') THEN id END ASC,
        CASE WHEN status NOT IN ('running', 'queued') THEN id END DESC
    `).all().map(normalizeTask);
  }

  nextQueuedTask() {
    return normalizeTask(this.database.prepare(`
      SELECT * FROM tasks
      WHERE status = 'queued'
      ORDER BY position ASC, id ASC
      LIMIT 1
    `).get());
  }

  reorderQueuedTasks(taskIds, expectedTaskIds = null, repoPath = null) {
    let inTransaction = false;
    try {
      this.database.exec('BEGIN IMMEDIATE');
      inTransaction = true;

      const candidateIds = Array.isArray(expectedTaskIds) && expectedTaskIds.length > 0
        ? expectedTaskIds : taskIds;
      const inferredTask = candidateIds?.length ? this.getTask(Number(candidateIds[0])) : null;
      const queuePath = repoPath ?? inferredTask?.repo_path;
      if (typeof queuePath !== 'string') {
        throw new Error('A project path is required to reorder its queue.');
      }

      const current = this.database.prepare(`
        SELECT id, position FROM tasks
        WHERE status = 'queued' AND repo_path = ?
        ORDER BY position ASC, id ASC
      `).all(queuePath);
      const currentIds = current.map((task) => task.id);

      const normalizeIds = (ids, label) => {
        if (!Array.isArray(ids)) {
          throw new Error(`${label} must be an array.`);
        }
        const normalized = ids.map((id) => Number(id));
        if (normalized.some((id) => !Number.isInteger(id) || id <= 0)) {
          throw new Error(`${label} contains an invalid task ID.`);
        }
        if (new Set(normalized).size !== normalized.length) {
          throw new Error(`${label} contains a duplicate task ID.`);
        }
        return normalized;
      };

      if (expectedTaskIds !== null && expectedTaskIds !== undefined) {
        const normalizedExpected = normalizeIds(expectedTaskIds, 'Expected queued task order');
        if (
          normalizedExpected.length !== currentIds.length
          || normalizedExpected.some((id, index) => id !== currentIds[index])
        ) {
          throw new Error('The queue changed while it was being reordered. Refresh and try again.');
        }
      }

      const normalizedIds = normalizeIds(taskIds, 'Queued task order');
      if (
        currentIds.length !== normalizedIds.length
        || normalizedIds.some((id) => !currentIds.includes(id))
      ) {
        throw new Error('The queue changed while it was being reordered. Refresh and try again.');
      }

      const oldPositions = new Map(current.map((task, index) => [task.id, index]));
      const update = this.database.prepare(`
        UPDATE tasks SET position = ? WHERE id = ? AND status = 'queued'
      `);
      normalizedIds.forEach((id, index) => update.run(index + 1, id));
      this.database.exec('COMMIT');
      inTransaction = false;

      normalizedIds.forEach((id, index) => {
        if (oldPositions.get(id) !== index) {
          this.addEvent(id, 'queue', `Task moved to queue position ${index + 1}.`);
        }
      });
      return normalizedIds.map((id) => this.getTask(id));
    } catch (error) {
      if (inTransaction) {
        try {
          this.database.exec('ROLLBACK');
        } catch {}
      }
      throw error;
    }
  }

  updateTask(id, changes) {
    const entries = Object.entries(changes).filter(([key]) => TASK_FIELDS.has(key));
    if (entries.length === 0) {
      return this.getTask(id);
    }

    const assignments = entries.map(([key]) => `${key} = ?`).join(', ');
    const values = entries.map(([, value]) => value);
    this.database.prepare(`UPDATE tasks SET ${assignments} WHERE id = ?`).run(...values, id);
    return this.getTask(id);
  }

  updateQueuedTask(id, changes) {
    const entries = Object.entries(changes).filter(([key]) => ['title', 'prompt'].includes(key));
    if (entries.length === 0) return this.getTask(id);
    const assignments = entries.map(([key]) => `${key} = ?`).join(', ');
    const values = entries.map(([, value]) => value);
    const result = this.database.prepare(
      `UPDATE tasks SET ${assignments} WHERE id = ? AND status = 'queued'`,
    ).run(...values, id);
    if (result.changes === 0) {
      const task = this.getTask(id);
      if (!task) throw new Error('Task not found.');
      throw new Error('Only a task that is still waiting in the queue can be edited.');
    }
    return this.getTask(id);
  }

  addEvent(taskId, kind, message, payload = null) {
    const encodedPayload = payload === null ? null : JSON.stringify(payload);
    const result = this.database.prepare(`
      INSERT INTO events (task_id, kind, message, payload, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(taskId, kind, message, encodedPayload, now());

    return this.database.prepare(`SELECT * FROM events WHERE id = ?`).get(
      Number(result.lastInsertRowid),
    );
  }

  listEvents(taskId, limit = 500) {
    return this.database.prepare(`
      SELECT * FROM (
        SELECT * FROM events
        WHERE task_id = ?
        ORDER BY id DESC
        LIMIT ?
      )
      ORDER BY id ASC
    `).all(taskId, limit).map((event) => ({
      ...event,
      payload: event.payload ? JSON.parse(event.payload) : null,
    }));
  }

  deleteTask(id) {
    return this.database.prepare(`DELETE FROM tasks WHERE id = ?`).run(id).changes > 0;
  }

  listProjects() {
    return this.database.prepare(`
      SELECT * FROM projects ORDER BY position ASC, id ASC
    `).all();
  }

  addProject({ path, name }) {
    const existing = this.database.prepare(`SELECT * FROM projects WHERE path = ?`).get(path);
    if (existing) {
      return existing;
    }
    const position = Number(this.database.prepare(
      `SELECT COALESCE(MAX(position), 0) AS value FROM projects`,
    ).get().value) + 1;
    const result = this.database.prepare(`
      INSERT INTO projects (path, name, position, created_at) VALUES (?, ?, ?, ?)
    `).run(path, name, position, now());
    return this.database.prepare(`SELECT * FROM projects WHERE id = ?`).get(
      Number(result.lastInsertRowid),
    );
  }

  deleteProject(id) {
    return this.database.prepare(`DELETE FROM projects WHERE id = ?`).run(id).changes > 0;
  }

  markProjectLaunched(id) {
    this.database.prepare(`UPDATE projects SET last_launched_at = ? WHERE id = ?`).run(now(), id);
    return this.database.prepare(`SELECT * FROM projects WHERE id = ?`).get(id);
  }

  isPaused() {
    const row = this.database.prepare(`SELECT value FROM settings WHERE key = 'paused'`).get();
    return row?.value === '1';
  }

  isProjectPaused(repoPath) {
    if (!repoPath) return false;
    const row = this.database.prepare(`SELECT value FROM settings WHERE key = ?`).get(`paused-project:${repoPath}`);
    return row?.value === '1';
  }

  pausedProjectPaths() {
    return this.database.prepare(`
      SELECT key FROM settings
      WHERE key LIKE 'paused-project:%' AND value = '1'
      ORDER BY key
    `).all().map(({ key }) => key.slice('paused-project:'.length));
  }

  setPaused(paused) {
    this.database.prepare(`
      INSERT INTO settings (key, value) VALUES ('paused', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(paused ? '1' : '0');
    return paused;
  }

  setProjectPaused(repoPath, paused) {
    if (!repoPath) throw new Error('A project path is required to pause its queue.');
    this.database.prepare(`
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(`paused-project:${repoPath}`, paused ? '1' : '0');
    return paused;
  }

  close() {
    this.database.close();
  }
}

export { now };
