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
  'author_thread_id',
  'author_thread_name',
  'author_thread_source',
  'author_model',
  'author_effort',
  'reviewer_provider',
  'reviewer_model',
  'reviewer_effort',
  'continued_from_task_id',
  'submission_id',
  'terminal_lifecycle',
  'terminal_layout_json',
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
    terminal_layout_json: encodedTerminalLayout,
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
  let terminalLayout = null;
  try { terminalLayout = encodedTerminalLayout ? JSON.parse(encodedTerminalLayout) : null; } catch {}
  return {
    ...task,
    attachments: Array.isArray(attachments) ? attachments : [],
    turbo,
    terminal_layout: terminalLayout,
  };
}

function parseJsonList(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeBreakdown(row) {
  if (!row) return null;
  return {
    ...row,
    parsed: row.parsed === 1 || row.parsed === true,
    proposals: parseJsonList(row.proposals_json),
    notes: parseJsonList(row.notes_json),
  };
}

function normalizePlanRun(row) {
  if (!row) return null;
  let terminalLayout = null;
  try {
    terminalLayout = row.terminal_layout_json ? JSON.parse(row.terminal_layout_json) : null;
  } catch {}
  return {
    ...row,
    prefer_idle_terminal: row.prefer_idle_terminal === 1 || row.prefer_idle_terminal === true,
    terminal_layout: terminalLayout,
  };
}

function normalizePlanRunStep(row) {
  if (!row) return null;
  return { ...row, dependsOn: parseJsonList(row.depends_on_json) };
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
        author_thread_id TEXT,
        author_thread_name TEXT,
        author_thread_source TEXT,
        author_model TEXT,
        author_effort TEXT,
        reviewer_provider TEXT,
        reviewer_model TEXT,
        reviewer_effort TEXT,
        continued_from_task_id INTEGER,
        submission_id TEXT,
        terminal_lifecycle TEXT NOT NULL DEFAULT 'persistent',
        terminal_layout_json TEXT,
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
        last_launched_at TEXT,
        max_codex_instances INTEGER NOT NULL DEFAULT 1,
        max_claude_instances INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS plans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        repo_path TEXT NOT NULL,
        name TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS plan_breakdowns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        plan_id INTEGER NOT NULL,
        task_id INTEGER,
        provider TEXT,
        session_id TEXT,
        session_label TEXT,
        guidance TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        parsed INTEGER NOT NULL DEFAULT 0,
        raw_response TEXT,
        proposals_json TEXT NOT NULL DEFAULT '[]',
        notes_json TEXT NOT NULL DEFAULT '[]',
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(plan_id) REFERENCES plans(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS plan_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        plan_id INTEGER NOT NULL,
        breakdown_id INTEGER,
        provider TEXT,
        session_id TEXT,
        session_label TEXT,
        session_source TEXT,
        prefer_idle_terminal INTEGER NOT NULL DEFAULT 0,
        terminal_lifecycle TEXT NOT NULL DEFAULT 'persistent',
        terminal_layout_json TEXT,
        model TEXT,
        effort TEXT,
        status TEXT NOT NULL DEFAULT 'running',
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        finished_at TEXT,
        FOREIGN KEY(plan_id) REFERENCES plans(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS plan_run_steps (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id INTEGER NOT NULL,
        proposal_id TEXT NOT NULL,
        position INTEGER NOT NULL,
        title TEXT NOT NULL,
        prompt TEXT NOT NULL,
        depends_on_json TEXT NOT NULL DEFAULT '[]',
        task_id INTEGER,
        status TEXT NOT NULL DEFAULT 'waiting',
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(run_id) REFERENCES plan_runs(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_tasks_status_position
        ON tasks(status, position, id);
      CREATE INDEX IF NOT EXISTS idx_tasks_repo_status_position
        ON tasks(repo_path, status, position, id);
      CREATE INDEX IF NOT EXISTS idx_events_task_id
        ON events(task_id, id);
      CREATE INDEX IF NOT EXISTS idx_plans_repo
        ON plans(repo_path, id);
      CREATE INDEX IF NOT EXISTS idx_plan_breakdowns_plan
        ON plan_breakdowns(plan_id, id);
      CREATE INDEX IF NOT EXISTS idx_plan_breakdowns_task
        ON plan_breakdowns(task_id);
      CREATE INDEX IF NOT EXISTS idx_plan_runs_plan
        ON plan_runs(plan_id, id);
      CREATE INDEX IF NOT EXISTS idx_plan_runs_status
        ON plan_runs(status, id);
      CREATE INDEX IF NOT EXISTS idx_plan_run_steps_run
        ON plan_run_steps(run_id, position, id);
      CREATE INDEX IF NOT EXISTS idx_plan_run_steps_task
        ON plan_run_steps(task_id);
    `);

    // Additive column for a plan_breakdowns table created before contract v2.
    this.ensureTableColumn('plan_breakdowns', 'notes_json', "TEXT NOT NULL DEFAULT '[]'");

    this.ensureColumn('thread_id', 'TEXT');
    this.ensureColumn('thread_name', 'TEXT');
    this.ensureColumn('thread_source', 'TEXT');
    this.ensureColumn('provider', "TEXT NOT NULL DEFAULT 'codex'");
    this.ensureColumn('model', 'TEXT');
    this.ensureColumn('effort', 'TEXT');
    this.ensureColumn('mode', "TEXT NOT NULL DEFAULT 'execute'");
    this.ensureColumn('author_provider', 'TEXT');
    this.ensureColumn('author_thread_id', 'TEXT');
    this.ensureColumn('author_thread_name', 'TEXT');
    this.ensureColumn('author_thread_source', 'TEXT');
    this.ensureColumn('author_model', 'TEXT');
    this.ensureColumn('author_effort', 'TEXT');
    this.ensureColumn('reviewer_provider', 'TEXT');
    this.ensureColumn('reviewer_model', 'TEXT');
    this.ensureColumn('reviewer_effort', 'TEXT');
    this.ensureColumn('continued_from_task_id', 'INTEGER');
    this.ensureColumn('submission_id', 'TEXT');
    this.ensureColumn('terminal_lifecycle', "TEXT NOT NULL DEFAULT 'persistent'");
    this.ensureColumn('terminal_layout_json', 'TEXT');
    this.ensureColumn('turbo_json', 'TEXT');
    this.ensureColumn('attachments_json', "TEXT NOT NULL DEFAULT '[]'");
    this.ensureColumn('prefer_idle_terminal', 'INTEGER NOT NULL DEFAULT 0');
    this.ensureTableColumn('projects', 'max_codex_instances', 'INTEGER NOT NULL DEFAULT 1');
    this.ensureTableColumn('projects', 'max_claude_instances', 'INTEGER NOT NULL DEFAULT 1');
    this.ensureTableColumn('plan_runs', 'terminal_lifecycle', "TEXT NOT NULL DEFAULT 'persistent'");
    this.ensureTableColumn('plan_runs', 'terminal_layout_json', 'TEXT');
    // events(task_id, id) is already covered by idx_events_task_id in the schema above.
    this.database.exec(`
      CREATE INDEX IF NOT EXISTS idx_tasks_thread_id ON tasks(thread_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_author_thread_id ON tasks(author_thread_id);
    `);
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
    this.ensureTableColumn('tasks', name, definition);
  }

  ensureTableColumn(table, name, definition) {
    const columns = this.database.prepare(`PRAGMA table_info(${table})`).all();
    if (!columns.some((column) => column.name === name)) {
      this.database.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
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
    thread = null,
    repoPath = null,
    provider = 'codex',
    model = null,
    effort = null,
    mode = 'execute',
    council = {},
    turbo = null,
    continuedFromTaskId = null,
    submissionId = null,
    terminalLifecycle = 'persistent',
    terminalLayout = null,
    priority = false,
    preferIdleTerminal = false,
  }) {
    const taskRepoPath = repoPath || thread?.cwd || '';
    if (!taskRepoPath) {
      throw new Error('A project path is required to create a task.');
    }
    const row = this.database.prepare(
      `SELECT
         COALESCE(MAX(position), 0) AS max_position,
         COALESCE(MIN(CASE WHEN status = 'queued' THEN position END), 1) AS min_queued_position
       FROM tasks
       WHERE repo_path = ?`,
    ).get(taskRepoPath);
    const result = this.database.prepare(`
      INSERT INTO tasks (
        title, prompt, repo_path, thread_id, thread_name, thread_source,
        provider, model, effort, mode,
        author_provider, author_thread_id, author_thread_name, author_thread_source,
        author_model, author_effort, reviewer_provider, reviewer_model, reviewer_effort,
        continued_from_task_id, submission_id, terminal_lifecycle, terminal_layout_json, turbo_json,
        prefer_idle_terminal,
        status, position, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?)
    `).run(
      title,
      prompt,
      taskRepoPath,
      thread?.id || null,
      thread?.title || null,
      thread?.source || null,
      provider,
      model,
      effort,
      mode,
      council.authorProvider || null,
      council.authorThread?.id || null,
      council.authorThread?.title || null,
      council.authorThread?.source || null,
      council.authorModel || null,
      council.authorEffort || null,
      council.reviewerProvider || null,
      council.reviewerModel || null,
      council.reviewerEffort || null,
      continuedFromTaskId,
      submissionId,
      terminalLifecycle,
      terminalLayout ? JSON.stringify(terminalLayout) : null,
      turbo ? JSON.stringify(turbo) : null,
      preferIdleTerminal ? 1 : 0,
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

  // Last resort for binding a task to a workspace when live discovery cannot confirm the
  // session right now. A session Relay has run before is a known session, and its workspace
  // does not change, so this keeps task-add working through a discovery outage.
  latestTaskForThread(threadId) {
    if (!threadId) return null;
    const task = normalizeTask(this.database.prepare(
      `SELECT * FROM tasks
       WHERE thread_id = ? OR author_thread_id = ?
       ORDER BY id DESC
       LIMIT 1`,
    ).get(threadId, threadId));
    if (task?.author_thread_id === threadId && task.thread_id !== threadId) {
      return {
        ...task,
        thread_id: task.author_thread_id,
        thread_name: task.author_thread_name,
        thread_source: task.author_thread_source,
      };
    }
    return task;
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
    const editableFields = new Set([
      'title',
      'prompt',
      'provider',
      'model',
      'effort',
      'thread_id',
      'thread_name',
      'thread_source',
      'session_id',
      'continued_from_task_id',
    ]);
    const entries = Object.entries(changes).filter(([key]) => editableFields.has(key));
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

  latestEventId(taskId) {
    const row = this.database.prepare(
      `SELECT COALESCE(MAX(id), 0) AS latest FROM events WHERE task_id = ?`,
    ).get(taskId);
    return Number(row?.latest || 0);
  }

  // Incremental read used by the running-task feed. Re-reading and re-parsing a full event
  // window for every running task on every two-second poll does not scale now that several
  // tasks run at once, so callers only ask for what they have not already seen.
  listEventsSince(taskId, sinceId = 0, limit = 500) {
    return this.database.prepare(`
      SELECT * FROM (
        SELECT * FROM events
        WHERE task_id = ? AND id > ?
        ORDER BY id DESC
        LIMIT ?
      )
      ORDER BY id ASC
    `).all(taskId, sinceId, limit).map((event) => ({
      ...event,
      payload: event.payload ? JSON.parse(event.payload) : null,
    }));
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

  getProject(id) {
    return this.database.prepare(`SELECT * FROM projects WHERE id = ?`).get(id) || null;
  }

  getProjectByPath(path) {
    return this.database.prepare(`SELECT * FROM projects WHERE path = ?`).get(path) || null;
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

  updateProjectInstanceLimits(id, { codex, claude }) {
    const project = this.getProject(id);
    if (!project) throw new Error('Pinned project not found.');
    this.database.prepare(`
      UPDATE projects
      SET max_codex_instances = ?, max_claude_instances = ?
      WHERE id = ?
    `).run(codex, claude, id);
    return this.getProject(id);
  }

  createPlan({ repoPath, name, content = '' }) {
    if (!repoPath) throw new Error('A project path is required to save a plan.');
    const timestamp = now();
    const result = this.database.prepare(`
      INSERT INTO plans (repo_path, name, content, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(repoPath, name, content, timestamp, timestamp);
    return this.getPlan(Number(result.lastInsertRowid));
  }

  getPlan(id) {
    return this.database.prepare(`SELECT * FROM plans WHERE id = ?`).get(id) || null;
  }

  listPlans(repoPath) {
    if (!repoPath) return [];
    return this.database.prepare(`
      SELECT * FROM plans WHERE repo_path = ? ORDER BY updated_at DESC, id DESC
    `).all(repoPath);
  }

  updatePlan(id, changes) {
    const entries = Object.entries(changes).filter(([key]) => ['name', 'content'].includes(key));
    if (entries.length === 0) return this.getPlan(id);
    const assignments = entries.map(([key]) => `${key} = ?`).join(', ');
    const values = entries.map(([, value]) => value);
    this.database.prepare(`UPDATE plans SET ${assignments}, updated_at = ? WHERE id = ?`)
      .run(...values, now(), id);
    return this.getPlan(id);
  }

  deletePlan(id) {
    return this.database.prepare(`DELETE FROM plans WHERE id = ?`).run(id).changes > 0;
  }

  createPlanBreakdown({
    planId,
    taskId = null,
    provider = null,
    sessionId = null,
    sessionLabel = null,
    guidance = null,
    status = 'pending',
  }) {
    const timestamp = now();
    const result = this.database.prepare(`
      INSERT INTO plan_breakdowns (
        plan_id, task_id, provider, session_id, session_label, guidance,
        status, parsed, proposals_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, '[]', ?, ?)
    `).run(planId, taskId, provider, sessionId, sessionLabel, guidance, status, timestamp, timestamp);
    return this.getPlanBreakdown(Number(result.lastInsertRowid));
  }

  getPlanBreakdown(id) {
    return normalizeBreakdown(this.database.prepare(`SELECT * FROM plan_breakdowns WHERE id = ?`).get(id));
  }

  latestPlanBreakdown(planId) {
    return normalizeBreakdown(this.database.prepare(`
      SELECT * FROM plan_breakdowns WHERE plan_id = ? ORDER BY id DESC LIMIT 1
    `).get(planId));
  }

  breakdownForTask(taskId) {
    if (taskId == null) return null;
    return normalizeBreakdown(this.database.prepare(`
      SELECT * FROM plan_breakdowns WHERE task_id = ? ORDER BY id DESC LIMIT 1
    `).get(taskId));
  }

  // 1-based ordinal of a breakdown among its plan's attempts, oldest first. Refinement
  // keeps every prior attempt, so the reviewer needs to know which one they are reading.
  breakdownAttempt(planId, breakdownId) {
    if (planId == null || breakdownId == null) return null;
    const row = this.database.prepare(`
      SELECT COUNT(*) AS attempt FROM plan_breakdowns WHERE plan_id = ? AND id <= ?
    `).get(planId, breakdownId);
    return row?.attempt || null;
  }

  breakdownsForPlan(planId) {
    return this.database.prepare(`
      SELECT * FROM plan_breakdowns WHERE plan_id = ? ORDER BY id DESC
    `).all(planId).map(normalizeBreakdown);
  }

  updatePlanBreakdown(id, changes) {
    const fields = [
      'task_id', 'provider', 'session_id', 'session_label', 'guidance',
      'status', 'parsed', 'raw_response', 'proposals_json', 'notes_json', 'error',
    ];
    const entries = Object.entries(changes).filter(([key]) => fields.includes(key));
    if (entries.length === 0) return this.getPlanBreakdown(id);
    const assignments = entries.map(([key]) => `${key} = ?`).join(', ');
    const values = entries.map(([, value]) => value);
    this.database.prepare(`UPDATE plan_breakdowns SET ${assignments}, updated_at = ? WHERE id = ?`)
      .run(...values, now(), id);
    return this.getPlanBreakdown(id);
  }

  setBreakdownProposals(id, proposals, notes = null) {
    const changes = { proposals_json: JSON.stringify(proposals) };
    if (notes !== null) changes.notes_json = JSON.stringify(notes);
    return this.updatePlanBreakdown(id, changes);
  }

  createPlanRun({
    planId,
    breakdownId = null,
    provider = null,
    sessionId = null,
    sessionLabel = null,
    sessionSource = null,
    preferIdleTerminal = false,
    terminalLifecycle = 'persistent',
    terminalLayout = null,
    model = null,
    effort = null,
    status = 'running',
  }) {
    const timestamp = now();
    const result = this.database.prepare(`
      INSERT INTO plan_runs (
        plan_id, breakdown_id, provider, session_id, session_label, session_source,
        prefer_idle_terminal, terminal_lifecycle, terminal_layout_json,
        model, effort, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      planId,
      breakdownId,
      provider,
      sessionId,
      sessionLabel,
      sessionSource,
      preferIdleTerminal ? 1 : 0,
      terminalLifecycle,
      terminalLayout ? JSON.stringify(terminalLayout) : null,
      model,
      effort,
      status,
      timestamp,
      timestamp,
    );
    return this.getPlanRun(Number(result.lastInsertRowid));
  }

  getPlanRun(id) {
    return normalizePlanRun(this.database.prepare(`SELECT * FROM plan_runs WHERE id = ?`).get(id));
  }

  latestPlanRun(planId) {
    return normalizePlanRun(this.database.prepare(`
      SELECT * FROM plan_runs WHERE plan_id = ? ORDER BY id DESC LIMIT 1
    `).get(planId));
  }

  planRunsForPlan(planId) {
    return this.database.prepare(`
      SELECT * FROM plan_runs WHERE plan_id = ? ORDER BY id DESC
    `).all(planId).map(normalizePlanRun);
  }

  // Runs that can still enqueue work. One per plan at most, by construction.
  activePlanRuns() {
    return this.database.prepare(`
      SELECT * FROM plan_runs WHERE status = 'running' ORDER BY id
    `).all().map(normalizePlanRun);
  }

  // Every run holding a step that is not settled, whatever the run's own status says.
  // A stopped or failed run can still own steps that were queued or running when Relay
  // died, so restart reconciliation has to look wider than `status = 'running'`.
  unsettledPlanRuns() {
    return this.database.prepare(`
      SELECT * FROM plan_runs r
      WHERE EXISTS (
        SELECT 1 FROM plan_run_steps s
        WHERE s.run_id = r.id
          AND s.status IN ('waiting', 'queued', 'running', 'retrying')
      )
      ORDER BY r.id
    `).all().map(normalizePlanRun);
  }

  updatePlanRun(id, changes) {
    const fields = ['status', 'error', 'finished_at', 'session_id', 'session_label'];
    const entries = Object.entries(changes).filter(([key]) => fields.includes(key));
    if (entries.length === 0) return this.getPlanRun(id);
    const assignments = entries.map(([key]) => `${key} = ?`).join(', ');
    const values = entries.map(([, value]) => value);
    this.database.prepare(`UPDATE plan_runs SET ${assignments}, updated_at = ? WHERE id = ?`)
      .run(...values, now(), id);
    return this.getPlanRun(id);
  }

  createPlanRunStep({ runId, proposalId, position, title, prompt, dependsOn = [], status = 'waiting' }) {
    const timestamp = now();
    const result = this.database.prepare(`
      INSERT INTO plan_run_steps (
        run_id, proposal_id, position, title, prompt, depends_on_json, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      runId,
      proposalId,
      position,
      title,
      prompt,
      JSON.stringify(Array.isArray(dependsOn) ? dependsOn : []),
      status,
      timestamp,
      timestamp,
    );
    return normalizePlanRunStep(
      this.database.prepare(`SELECT * FROM plan_run_steps WHERE id = ?`).get(Number(result.lastInsertRowid)),
    );
  }

  planRunSteps(runId) {
    return this.database.prepare(`
      SELECT * FROM plan_run_steps WHERE run_id = ? ORDER BY position, id
    `).all(runId).map(normalizePlanRunStep);
  }

  planRunStepForTask(taskId) {
    if (taskId == null) return null;
    return normalizePlanRunStep(this.database.prepare(`
      SELECT * FROM plan_run_steps WHERE task_id = ? ORDER BY id DESC LIMIT 1
    `).get(taskId));
  }

  updatePlanRunStep(id, changes) {
    const fields = ['task_id', 'status', 'error'];
    const entries = Object.entries(changes).filter(([key]) => fields.includes(key));
    if (entries.length === 0) {
      return normalizePlanRunStep(this.database.prepare(`SELECT * FROM plan_run_steps WHERE id = ?`).get(id));
    }
    const assignments = entries.map(([key]) => `${key} = ?`).join(', ');
    const values = entries.map(([, value]) => value);
    this.database.prepare(`UPDATE plan_run_steps SET ${assignments}, updated_at = ? WHERE id = ?`)
      .run(...values, now(), id);
    return normalizePlanRunStep(this.database.prepare(`SELECT * FROM plan_run_steps WHERE id = ?`).get(id));
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
