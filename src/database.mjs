import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ProjectConfigStore } from './project-config-store.mjs';
import { compactEventForStorage } from './event-storage.mjs';
import { normalizeDiffState } from './task-diff.mjs';
import { withoutRelayNonInteractiveInstruction } from './relay-prompt.mjs';
import { titleFromPrompt } from './task-title.mjs';
import { parseUiPreferences, UI_PREFERENCES_SETTING } from './ui-preferences.mjs';

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
  'keep_terminal_open',
  'manual_completion',
  'terminal_layout_json',
  'turbo_json',
  'attachments_json',
  'diff_state_json',
  'starred',
  'status',
  'position',
  'started_at',
  'finished_at',
  'session_id',
  'result',
  'error',
  'exit_code',
]);

const COMPLETION_REVIEW_MIGRATION_SETTING = 'completion-review-state-v1-migrated';
const TOKEN_USAGE_DELTA_BACKFILL_SETTING = 'token-usage-deltas-v1-backfilled';
const TASK_ATTEMPT_OUTCOMES = new Set(['complete', 'failed', 'cancelled', 'interrupted', 'unknown']);

function now() {
  return new Date().toISOString();
}

function timestampMilliseconds(value) {
  const milliseconds = new Date(value || 0).getTime();
  return Number.isFinite(milliseconds) ? milliseconds : 0;
}

function nonNegativeTokenCount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : 0;
}

function localDateKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseEventPayload(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function tokenStreamKey(payload) {
  return JSON.stringify([
    String(payload?.provider || ''),
    String(payload?.phase || ''),
    String(payload?.worker ?? ''),
    String(payload?.graphTaskId || ''),
    String(payload?.workerThreadId || ''),
    String(payload?.threadId || ''),
    String(payload?.sessionId || ''),
  ]);
}

function tokenUsageSnapshot(payload) {
  const usage = payload?.usage && typeof payload.usage === 'object' ? payload.usage : {};
  const inputTokens = nonNegativeTokenCount(usage.inputTokens);
  const outputTokens = nonNegativeTokenCount(usage.outputTokens);
  const reportedTotal = Number(usage.totalTokens);
  const measuredTotal = inputTokens
    + outputTokens
    + nonNegativeTokenCount(usage.reasoningTokens)
    + nonNegativeTokenCount(usage.cacheReadTokens)
    + nonNegativeTokenCount(usage.cacheWriteTokens);
  return {
    inputTokens,
    outputTokens,
    totalTokens: Number.isFinite(reportedTotal) && reportedTotal >= 0
      ? Math.round(reportedTotal)
      : measuredTotal,
  };
}

function applyTokenUsageSnapshot(attempt, payload) {
  if (
    payload?.type !== 'provider/token-usage'
    || payload.source !== 'native'
    || payload.cumulative !== true
  ) {
    return {
      updated: attempt,
      delta: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    };
  }

  const current = tokenUsageSnapshot(payload);
  const key = tokenStreamKey(payload);
  const streams = attempt.streams && typeof attempt.streams === 'object' ? attempt.streams : {};
  const previous = streams[key];
  const monotonic = previous
    && current.inputTokens >= nonNegativeTokenCount(previous.inputTokens)
    && current.outputTokens >= nonNegativeTokenCount(previous.outputTokens)
    && current.totalTokens >= nonNegativeTokenCount(previous.totalTokens);
  const delta = {
    inputTokens: monotonic
      ? current.inputTokens - nonNegativeTokenCount(previous.inputTokens)
      : current.inputTokens,
    outputTokens: monotonic
      ? current.outputTokens - nonNegativeTokenCount(previous.outputTokens)
      : current.outputTokens,
    totalTokens: monotonic
      ? current.totalTokens - nonNegativeTokenCount(previous.totalTokens)
      : current.totalTokens,
  };
  return {
    delta,
    updated: {
      ...attempt,
      inputTokens: nonNegativeTokenCount(attempt.inputTokens) + delta.inputTokens,
      outputTokens: nonNegativeTokenCount(attempt.outputTokens) + delta.outputTokens,
      totalTokens: nonNegativeTokenCount(attempt.totalTokens) + delta.totalTokens,
      tokenObserved: true,
      streams: {
        ...streams,
        [key]: current,
      },
    },
  };
}

function attemptFinishedByEvent(event, payload) {
  if (payload?.type === 'relay/task-attempt-finished') return true;
  if (!['queue', 'system'].includes(event?.kind)) return false;
  return /^(?:Task completed\.|Follow-up completed\.|Turn completed\.|Task interrupted|Task cancelled|Task failed|Follow-up cancelled|Follow-up failed|The current turn failed|The current turn was stopped|The current turn was interrupted|Plan council stopped|Same-session follow-up marked interrupted|Task marked interrupted)/u.test(
    String(event?.message || ''),
  );
}

function taskAttemptOutcome(event, payload) {
  const reported = String(payload?.outcome || '').trim().toLowerCase();
  if (TASK_ATTEMPT_OUTCOMES.has(reported)) return reported;
  const message = String(event?.message || '');
  if (/^(?:Task completed\.|Follow-up completed\.|Turn completed\.)/u.test(message)) return 'complete';
  if (/cancelled|was stopped/iu.test(message)) return 'cancelled';
  if (/interrupted/iu.test(message)) return 'interrupted';
  return 'failed';
}

function normalizeTask(row) {
  if (!row) {
    return null;
  }
  const {
    attachments_json: encodedAttachments,
    turbo_json: encodedTurbo,
    terminal_layout_json: encodedTerminalLayout,
    diff_state_json: encodedDiffState,
    completion_reviewed: completionReviewed,
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
    starred: task.starred === 1 || task.starred === true,
    keep_terminal_open: task.keep_terminal_open === 1 || task.keep_terminal_open === true,
    manual_completion: task.manual_completion === 1 || task.manual_completion === true,
    attachments: Array.isArray(attachments) ? attachments : [],
    turbo,
    terminal_layout: terminalLayout,
    ready_for_review: task.status === 'complete'
      && (completionReviewed === 0 || completionReviewed === false),
    // Null for a legacy row, a task that never started, and any row whose stored state cannot
    // be parsed. The diff preview treats all three the same way.
    diffState: normalizeDiffState(encodedDiffState),
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

function relayPromptMarker(item) {
  for (const value of [item?.clientId, item?.id]) {
    const marker = typeof value === 'string' ? value.trim() : '';
    if (marker.startsWith('relay-follow-up-') || marker.startsWith('relay-steer-')) {
      return marker;
    }
  }
  return null;
}

function userMessageText(item) {
  if (item?.type !== 'userMessage' || !Array.isArray(item.content)) return '';
  return withoutRelayNonInteractiveInstruction(item.content
    .filter((part) => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join('\n')
    .trim());
}

function assistantResponseText(payload) {
  if (
    payload?.type === 'item/completed'
    && ['agentMessage', 'agent_message'].includes(payload.item?.type)
    && typeof payload.item.text === 'string'
  ) {
    return payload.item.text.trim();
  }
  if (
    ['claude/message', 'opencode/message'].includes(payload?.type)
    && typeof payload.text === 'string'
  ) {
    return payload.text.trim();
  }
  return '';
}

function normalizedTaskProjectPath(path) {
  return String(path || '').replace(/[\\/]+$/u, '').replaceAll('\\', '/');
}

function appendUniqueText(values, seen, value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || seen.has(text)) return;
  seen.add(text);
  values.push(text);
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
    keep_terminal_open: row.keep_terminal_open === 1 || row.keep_terminal_open === true,
    terminal_layout: terminalLayout,
  };
}

function normalizePlanRunStep(row) {
  if (!row) return null;
  return { ...row, dependsOn: parseJsonList(row.depends_on_json) };
}

export class RelayDatabase {
  constructor(filePath, { projectConfigPath = null } = {}) {
    mkdirSync(dirname(filePath), { recursive: true });
    this.databasePath = resolve(filePath);
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
        keep_terminal_open INTEGER NOT NULL DEFAULT 0,
        manual_completion INTEGER NOT NULL DEFAULT 0,
        terminal_layout_json TEXT,
        turbo_json TEXT,
        attachments_json TEXT NOT NULL DEFAULT '[]',
        starred INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'queued',
        position INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT,
        completion_reviewed INTEGER NOT NULL DEFAULT 1,
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

      CREATE TABLE IF NOT EXISTS task_attempts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id INTEGER NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        outcome TEXT,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        total_tokens INTEGER NOT NULL DEFAULT 0,
        token_observed INTEGER NOT NULL DEFAULT 0,
        token_streams_json TEXT NOT NULL DEFAULT '{}',
        FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE,
        UNIQUE(task_id, started_at)
      );

      CREATE TABLE IF NOT EXISTS task_token_usage_deltas (
        event_id INTEGER PRIMARY KEY,
        task_id INTEGER NOT NULL,
        observed_at TEXT NOT NULL,
        usage_date TEXT NOT NULL,
        provider TEXT NOT NULL,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        total_tokens INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE,
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
        max_claude_instances INTEGER NOT NULL DEFAULT 1,
        max_opencode_instances INTEGER NOT NULL DEFAULT 1,
        keep_terminal_open INTEGER NOT NULL DEFAULT 0,
        prefer_idle_terminal INTEGER NOT NULL DEFAULT 0,
        color TEXT,
        terminal_layout_json TEXT
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
        keep_terminal_open INTEGER NOT NULL DEFAULT 0,
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
      CREATE INDEX IF NOT EXISTS idx_task_attempts_task_id
        ON task_attempts(task_id, id);
      CREATE INDEX IF NOT EXISTS idx_task_token_usage_deltas_date
        ON task_token_usage_deltas(usage_date, provider);
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
    this.ensureTableColumn('task_attempts', 'total_tokens', 'INTEGER NOT NULL DEFAULT 0');
    this.ensureTableColumn('task_attempts', 'outcome', 'TEXT');

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
    this.ensureColumn('keep_terminal_open', 'INTEGER NOT NULL DEFAULT 0');
    this.ensureColumn('manual_completion', 'INTEGER NOT NULL DEFAULT 0');
    this.ensureColumn('terminal_layout_json', 'TEXT');
    this.ensureColumn('turbo_json', 'TEXT');
    this.ensureColumn('attachments_json', "TEXT NOT NULL DEFAULT '[]'");
    this.ensureColumn('diff_state_json', 'TEXT');
    this.ensureColumn('starred', 'INTEGER NOT NULL DEFAULT 0');
    this.ensureColumn('completion_reviewed', 'INTEGER NOT NULL DEFAULT 1');
    this.ensureColumn('prefer_idle_terminal', 'INTEGER NOT NULL DEFAULT 0');
    this.ensureColumn('import_source', 'TEXT');
    this.ensureColumn('import_task_id', 'INTEGER');
    this.ensureTableColumn('projects', 'max_codex_instances', 'INTEGER NOT NULL DEFAULT 1');
    this.ensureTableColumn('projects', 'max_claude_instances', 'INTEGER NOT NULL DEFAULT 1');
    this.ensureTableColumn('projects', 'max_opencode_instances', 'INTEGER NOT NULL DEFAULT 1');
    this.ensureTableColumn('projects', 'keep_terminal_open', 'INTEGER NOT NULL DEFAULT 0');
    this.ensureTableColumn('projects', 'prefer_idle_terminal', 'INTEGER NOT NULL DEFAULT 0');
    this.ensureTableColumn('projects', 'color', 'TEXT');
    this.ensureTableColumn('projects', 'terminal_layout_json', 'TEXT');
    this.ensureTableColumn('plan_runs', 'terminal_lifecycle', "TEXT NOT NULL DEFAULT 'persistent'");
    this.ensureTableColumn('plan_runs', 'keep_terminal_open', 'INTEGER NOT NULL DEFAULT 0');
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
      CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_import_origin
        ON tasks(import_source, import_task_id)
        WHERE import_source IS NOT NULL AND import_task_id IS NOT NULL;
    `);

    this.database.prepare(`
      INSERT OR IGNORE INTO settings (key, value) VALUES ('paused', '0')
    `).run();

    this.backfillTaskAttempts();
    this.backfillTaskAttemptOutcomes();
    this.backfillTokenUsageDeltas();

    this.projectConfig = projectConfigPath
      ? new ProjectConfigStore(projectConfigPath, { legacyDatabase: this.database })
      : new ProjectConfigStore(filePath, { database: this.database });
    this.projectConfigPath = this.projectConfig.filePath;
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

  backfillTaskAttempts() {
    const tasks = this.database.prepare(`
      SELECT id, status, started_at, finished_at
      FROM tasks
      WHERE started_at IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM task_attempts WHERE task_attempts.task_id = tasks.id
        )
      ORDER BY id
    `).all();
    const insert = this.database.prepare(`
      INSERT OR IGNORE INTO task_attempts (
        task_id, started_at, finished_at, outcome, duration_ms,
        input_tokens, output_tokens, total_tokens, token_observed, token_streams_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const task of tasks) {
      const events = this.database.prepare(`
        SELECT id, kind, message, payload, created_at
        FROM events
        WHERE task_id = ?
        ORDER BY id ASC
      `).all(task.id);
      const attempts = [];
      const byStartedAt = new Map();
      const ensureAttempt = (startedAt) => {
        const normalized = timestampMilliseconds(startedAt) ? startedAt : task.started_at;
        if (!normalized) return null;
        if (byStartedAt.has(normalized)) return byStartedAt.get(normalized);
        const attempt = {
          startedAt: normalized,
          finishedAt: null,
          outcome: null,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          tokenObserved: false,
          streams: {},
        };
        attempts.push(attempt);
        byStartedAt.set(normalized, attempt);
        return attempt;
      };
      let activeAttempt = null;

      for (const event of events) {
        const payload = parseEventPayload(event.payload);
        if (payload?.type === 'relay/task-attempt-started') {
          const startedAt = timestampMilliseconds(payload.attemptStartedAt)
            ? payload.attemptStartedAt
            : event.created_at;
          if (activeAttempt && !activeAttempt.finishedAt && activeAttempt.startedAt !== startedAt) {
            activeAttempt.finishedAt = event.created_at;
            activeAttempt.outcome = 'unknown';
          }
          activeAttempt = ensureAttempt(startedAt);
        }

        if (payload?.type === 'provider/token-usage') {
          const tokenAttempt = timestampMilliseconds(payload.attemptStartedAt)
            ? ensureAttempt(payload.attemptStartedAt)
            : activeAttempt || ensureAttempt(task.started_at);
          if (tokenAttempt) {
            const { updated } = applyTokenUsageSnapshot(tokenAttempt, payload);
            Object.assign(tokenAttempt, updated);
          }
        }

        if (attemptFinishedByEvent(event, payload)) {
          const finishedAttempt = timestampMilliseconds(payload?.attemptStartedAt)
            ? ensureAttempt(payload.attemptStartedAt)
            : activeAttempt;
          if (finishedAttempt && !finishedAttempt.finishedAt) {
            finishedAttempt.finishedAt = timestampMilliseconds(payload?.attemptFinishedAt)
              ? payload.attemptFinishedAt
              : event.created_at;
          }
          if (finishedAttempt) finishedAttempt.outcome = taskAttemptOutcome(event, payload);
          if (finishedAttempt === activeAttempt) activeAttempt = null;
        }
      }

      if (attempts.length === 0) {
        activeAttempt = ensureAttempt(task.started_at);
      }
      attempts.sort((left, right) => timestampMilliseconds(left.startedAt) - timestampMilliseconds(right.startedAt));
      for (let index = 0; index < attempts.length - 1; index += 1) {
        if (!attempts[index].finishedAt) attempts[index].finishedAt = attempts[index + 1].startedAt;
      }
      const latest = attempts.at(-1);
      if (latest && !latest.finishedAt && task.status !== 'running') {
        latest.finishedAt = task.finished_at
          || events.at(-1)?.created_at
          || latest.startedAt;
      }
      if (latest && latest.finishedAt && !latest.outcome && task.status !== 'running') {
        latest.outcome = TASK_ATTEMPT_OUTCOMES.has(task.status) ? task.status : 'unknown';
      }

      for (const attempt of attempts) {
        const startedMs = timestampMilliseconds(attempt.startedAt);
        const finishedMs = timestampMilliseconds(attempt.finishedAt);
        const durationMs = finishedMs ? Math.max(0, finishedMs - startedMs) : 0;
        insert.run(
          task.id,
          attempt.startedAt,
          attempt.finishedAt,
          attempt.outcome || (attempt.finishedAt ? 'unknown' : null),
          durationMs,
          nonNegativeTokenCount(attempt.inputTokens),
          nonNegativeTokenCount(attempt.outputTokens),
          nonNegativeTokenCount(attempt.totalTokens),
          attempt.tokenObserved ? 1 : 0,
          JSON.stringify(attempt.streams || {}),
        );
      }
    }
  }

  backfillTaskAttemptOutcomes() {
    const taskIds = this.database.prepare(`
      SELECT DISTINCT task_id
      FROM task_attempts
      WHERE finished_at IS NOT NULL AND outcome IS NULL
      ORDER BY task_id
    `).all().map((row) => Number(row.task_id));
    const update = this.database.prepare(`
      UPDATE task_attempts SET outcome = ?
      WHERE task_id = ? AND started_at = ? AND outcome IS NULL
    `);

    for (const taskId of taskIds) {
      const attempts = this.database.prepare(`
        SELECT started_at, finished_at
        FROM task_attempts
        WHERE task_id = ?
        ORDER BY started_at ASC, id ASC
      `).all(taskId);
      const attemptsByStart = new Map(attempts.map((attempt) => [attempt.started_at, attempt]));
      let activeAttempt = null;
      const events = this.database.prepare(`
        SELECT kind, message, payload, created_at
        FROM events
        WHERE task_id = ?
        ORDER BY id ASC
      `).all(taskId);
      for (const event of events) {
        const payload = parseEventPayload(event.payload);
        if (payload?.type === 'relay/task-attempt-started') {
          activeAttempt = attemptsByStart.get(payload.attemptStartedAt) || null;
        }
        if (!attemptFinishedByEvent(event, payload)) continue;
        const finishedAttempt = attemptsByStart.get(payload?.attemptStartedAt) || activeAttempt;
        if (finishedAttempt) {
          update.run(taskAttemptOutcome(event, payload), taskId, finishedAttempt.started_at);
        }
        if (finishedAttempt === activeAttempt) activeAttempt = null;
      }

      const task = this.database.prepare(`
        SELECT status, started_at FROM tasks WHERE id = ?
      `).get(taskId);
      const latest = attempts.at(-1);
      if (latest && latest.started_at === task?.started_at && TASK_ATTEMPT_OUTCOMES.has(task.status)) {
        update.run(task.status, taskId, latest.started_at);
      }
      this.database.prepare(`
        UPDATE task_attempts SET outcome = 'unknown'
        WHERE task_id = ? AND finished_at IS NOT NULL AND outcome IS NULL
      `).run(taskId);
    }
  }

  backfillTokenUsageDeltas() {
    const migration = this.database.prepare(
      `SELECT value FROM settings WHERE key = ?`,
    ).get(TOKEN_USAGE_DELTA_BACKFILL_SETTING);
    // The rebuild and marker commit in one transaction. A crash leaves neither, while every
    // post-migration token event writes its event and delta atomically in addEvent(). The marker
    // is therefore sufficient and avoids reparsing the complete JSON event ledger at every start.
    if (migration) return;

    let transactionOpen = false;
    try {
      this.database.exec('BEGIN IMMEDIATE');
      transactionOpen = true;
      this.database.exec('DELETE FROM task_token_usage_deltas');
      const events = this.database.prepare(`
        SELECT events.id, events.task_id, events.payload, events.created_at,
          tasks.provider AS task_provider
        FROM events
        JOIN tasks ON tasks.id = events.task_id
        WHERE events.payload IS NOT NULL
          AND json_valid(events.payload) = 1
          AND (
            json_extract(events.payload, '$.type') = 'relay/task-attempt-started'
            OR (
              json_extract(events.payload, '$.type') = 'provider/token-usage'
              AND json_extract(events.payload, '$.source') = 'native'
              AND json_extract(events.payload, '$.cumulative') = 1
            )
          )
        ORDER BY events.id ASC
      `).all();
      const currentAttemptByTask = new Map();
      const attemptStates = new Map();
      const insert = this.database.prepare(`
        INSERT INTO task_token_usage_deltas (
          event_id, task_id, observed_at, usage_date, provider,
          input_tokens, output_tokens, total_tokens
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const event of events) {
        const payload = parseEventPayload(event.payload);
        if (payload?.type === 'relay/task-attempt-started') {
          const attemptStartedAt = timestampMilliseconds(payload.attemptStartedAt)
            ? payload.attemptStartedAt
            : event.created_at;
          currentAttemptByTask.set(event.task_id, attemptStartedAt);
          continue;
        }
        if (payload?.type !== 'provider/token-usage') continue;
        const attemptStartedAt = timestampMilliseconds(payload.attemptStartedAt)
          ? payload.attemptStartedAt
          : currentAttemptByTask.get(event.task_id) || 'legacy';
        const attemptKey = JSON.stringify([event.task_id, attemptStartedAt]);
        const state = attemptStates.get(attemptKey) || {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          tokenObserved: false,
          streams: {},
        };
        const { updated, delta } = applyTokenUsageSnapshot(state, payload);
        attemptStates.set(attemptKey, updated);
        insert.run(
          event.id,
          event.task_id,
          event.created_at,
          localDateKey(event.created_at) || '',
          String(payload.provider || event.task_provider || 'unknown'),
          delta.inputTokens,
          delta.outputTokens,
          delta.totalTokens,
        );
      }
      this.database.prepare(`
        INSERT INTO settings (key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run(TOKEN_USAGE_DELTA_BACKFILL_SETTING, now());
      this.database.exec('COMMIT');
      transactionOpen = false;
    } catch (error) {
      if (transactionOpen) {
        try { this.database.exec('ROLLBACK'); } catch {}
      }
      throw error;
    }
  }

  conversationMetricsMap(taskId = null) {
    const rows = this.database.prepare(`
      SELECT
        attempts.task_id,
        COUNT(*) AS attempt_count,
        COALESCE(SUM(attempts.duration_ms), 0) AS duration_ms,
        COALESCE(MAX(usage.input_tokens), 0) AS input_tokens,
        COALESCE(MAX(usage.output_tokens), 0) AS output_tokens,
        COALESCE(MAX(usage.total_tokens), 0) AS total_tokens,
        COALESCE(MAX(usage.token_observed), 0) AS token_observed,
        MAX(CASE WHEN attempts.finished_at IS NULL THEN attempts.started_at END) AS active_attempt_started_at
      FROM task_attempts AS attempts
      LEFT JOIN (
        SELECT
          task_id,
          COALESCE(SUM(input_tokens), 0) AS input_tokens,
          COALESCE(SUM(output_tokens), 0) AS output_tokens,
          COALESCE(SUM(total_tokens), 0) AS total_tokens,
          CASE WHEN COUNT(*) > 0 THEN 1 ELSE 0 END AS token_observed
        FROM task_token_usage_deltas
        GROUP BY task_id
      ) AS usage ON usage.task_id = attempts.task_id
      ${taskId === null ? '' : 'WHERE attempts.task_id = ?'}
      GROUP BY attempts.task_id
    `).all(...(taskId === null ? [] : [taskId]));
    return new Map(rows.map((row) => [Number(row.task_id), {
      attempt_count: Number(row.attempt_count || 0),
      duration_ms: Number(row.duration_ms || 0),
      input_tokens: Number(row.input_tokens || 0),
      output_tokens: Number(row.output_tokens || 0),
      total_tokens: Number(row.total_tokens || 0),
      token_observed: row.token_observed === 1 || row.token_observed === true,
      active_attempt_started_at: row.active_attempt_started_at || null,
    }]));
  }

  todayTokenUsage(referenceDate = new Date()) {
    const usageDate = localDateKey(referenceDate);
    if (!usageDate) {
      return {
        date: null,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        providers: {},
      };
    }
    const rows = this.database.prepare(`
      SELECT
        provider,
        COALESCE(SUM(input_tokens), 0) AS input_tokens,
        COALESCE(SUM(output_tokens), 0) AS output_tokens,
        COALESCE(SUM(total_tokens), 0) AS total_tokens
      FROM task_token_usage_deltas
      WHERE usage_date = ?
      GROUP BY provider
      ORDER BY provider
    `).all(usageDate);
    const providers = {};
    let inputTokens = 0;
    let outputTokens = 0;
    let totalTokens = 0;
    for (const row of rows) {
      const providerInput = nonNegativeTokenCount(row.input_tokens);
      const providerOutput = nonNegativeTokenCount(row.output_tokens);
      const providerTotal = nonNegativeTokenCount(row.total_tokens);
      providers[row.provider] = {
        inputTokens: providerInput,
        outputTokens: providerOutput,
        totalTokens: providerTotal,
      };
      inputTokens += providerInput;
      outputTokens += providerOutput;
      totalTokens += providerTotal;
    }
    return { date: usageDate, inputTokens, outputTokens, totalTokens, providers };
  }

  taskWithConversationMetrics(task, metrics = null) {
    if (!task) return null;
    return {
      ...task,
      conversation_metrics: metrics || this.conversationMetricsMap(task.id).get(task.id) || {
        attempt_count: 0,
        duration_ms: 0,
        input_tokens: 0,
        output_tokens: 0,
        total_tokens: 0,
        token_observed: false,
        active_attempt_started_at: null,
      },
    };
  }

  taskAttemptsMap(taskId = null) {
    const rows = this.database.prepare(`
      SELECT attempts.task_id, attempts.started_at, attempts.finished_at,
        attempts.duration_ms, attempts.outcome
      FROM task_attempts AS attempts
      ${taskId === null ? '' : 'WHERE attempts.task_id = ?'}
      ORDER BY attempts.task_id ASC, attempts.started_at ASC, attempts.id ASC
    `).all(...(taskId === null ? [] : [taskId]));
    const attempts = new Map();
    for (const row of rows) {
      const id = Number(row.task_id);
      if (!attempts.has(id)) attempts.set(id, []);
      attempts.get(id).push({
        started_at: row.started_at,
        finished_at: row.finished_at || null,
        duration_ms: Number(row.duration_ms || 0),
        outcome: row.outcome || null,
      });
    }
    return attempts;
  }

  beginTaskAttempt(id, { attemptStartedAt, changes = {} } = {}) {
    if (!timestampMilliseconds(attemptStartedAt)) {
      throw new Error('A valid task-attempt start time is required.');
    }
    let transactionOpen = false;
    try {
      this.database.exec('BEGIN IMMEDIATE');
      transactionOpen = true;
      const active = this.database.prepare(`
        SELECT id, started_at FROM task_attempts
        WHERE task_id = ? AND finished_at IS NULL
        LIMIT 1
      `).get(id);
      if (active) {
        const task = this.database.prepare(`
          SELECT status, finished_at FROM tasks WHERE id = ?
        `).get(id);
        if (task?.status === 'running') {
          throw new Error(`Task ${id} already has an active attempt.`);
        }
        const activeStartedMs = timestampMilliseconds(active.started_at);
        const persistedFinishedMs = timestampMilliseconds(task?.finished_at);
        const nextStartedMs = timestampMilliseconds(attemptStartedAt);
        const staleFinishedAt = persistedFinishedMs >= activeStartedMs
          && persistedFinishedMs <= nextStartedMs
          ? task.finished_at
          : attemptStartedAt;
        const staleOutcome = TASK_ATTEMPT_OUTCOMES.has(task?.status)
          ? task.status
          : 'unknown';
        this.database.prepare(`
          UPDATE task_attempts
          SET finished_at = ?, duration_ms = ?, outcome = COALESCE(outcome, ?)
          WHERE id = ? AND finished_at IS NULL
        `).run(
          staleFinishedAt,
          Math.max(0, timestampMilliseconds(staleFinishedAt) - activeStartedMs),
          staleOutcome,
          active.id,
        );
      }
      this.database.prepare(`
        INSERT INTO task_attempts (task_id, started_at)
        VALUES (?, ?)
      `).run(id, attemptStartedAt);
      this.updateTask(id, changes);
      this.database.exec('COMMIT');
      transactionOpen = false;
      return this.getTask(id);
    } catch (error) {
      if (transactionOpen) {
        try { this.database.exec('ROLLBACK'); } catch {}
      }
      throw error;
    }
  }

  completeTaskAttempt(id, {
    attemptStartedAt = null,
    attemptFinishedAt = now(),
    changes = {},
    outcome = null,
  } = {}) {
    if (!timestampMilliseconds(attemptFinishedAt)) {
      throw new Error('A valid task-attempt finish time is required.');
    }
    const normalizedOutcome = TASK_ATTEMPT_OUTCOMES.has(outcome)
      ? outcome
      : TASK_ATTEMPT_OUTCOMES.has(changes.status)
        ? changes.status
        : 'unknown';
    let transactionOpen = false;
    try {
      this.database.exec('BEGIN IMMEDIATE');
      transactionOpen = true;
      const attempt = attemptStartedAt
        ? this.database.prepare(`
            SELECT * FROM task_attempts
            WHERE task_id = ? AND started_at = ?
            LIMIT 1
          `).get(id, attemptStartedAt)
        : this.database.prepare(`
            SELECT * FROM task_attempts
            WHERE task_id = ? AND finished_at IS NULL
            ORDER BY id DESC
            LIMIT 1
          `).get(id);
      if (attempt && !attempt.finished_at) {
        const durationMs = Math.max(
          0,
          timestampMilliseconds(attemptFinishedAt) - timestampMilliseconds(attempt.started_at),
        );
        this.database.prepare(`
          UPDATE task_attempts
          SET finished_at = ?, duration_ms = ?, outcome = ?
          WHERE id = ? AND finished_at IS NULL
        `).run(attemptFinishedAt, durationMs, normalizedOutcome, attempt.id);
      } else if (attempt && !attempt.outcome) {
        this.database.prepare(`
          UPDATE task_attempts
          SET outcome = ?
          WHERE id = ? AND outcome IS NULL
        `).run(normalizedOutcome, attempt.id);
      }
      this.updateTask(id, changes);
      this.database.exec('COMMIT');
      transactionOpen = false;
      return this.getTask(id);
    } catch (error) {
      if (transactionOpen) {
        try { this.database.exec('ROLLBACK'); } catch {}
      }
      throw error;
    }
  }

  recordTaskAttemptTokenUsage(taskId, payload, { eventId = null, observedAt = now() } = {}) {
    if (
      payload?.type !== 'provider/token-usage'
      || payload.source !== 'native'
      || payload.cumulative !== true
    ) return false;
    const attempt = timestampMilliseconds(payload.attemptStartedAt)
      ? this.database.prepare(`
          SELECT * FROM task_attempts
          WHERE task_id = ? AND started_at = ?
          LIMIT 1
        `).get(taskId, payload.attemptStartedAt)
      : this.database.prepare(`
          SELECT * FROM task_attempts
          WHERE task_id = ? AND finished_at IS NULL
          ORDER BY id DESC
          LIMIT 1
        `).get(taskId);
    if (!attempt) return false;
    let streams = {};
    try { streams = JSON.parse(attempt.token_streams_json || '{}'); } catch {}
    const { updated, delta } = applyTokenUsageSnapshot({
      inputTokens: attempt.input_tokens,
      outputTokens: attempt.output_tokens,
      totalTokens: attempt.total_tokens,
      tokenObserved: attempt.token_observed === 1,
      streams,
    }, payload);
    this.database.prepare(`
      UPDATE task_attempts
      SET input_tokens = ?, output_tokens = ?, total_tokens = ?,
        token_observed = ?, token_streams_json = ?
      WHERE id = ?
    `).run(
      updated.inputTokens,
      updated.outputTokens,
      updated.totalTokens,
      updated.tokenObserved ? 1 : 0,
      JSON.stringify(updated.streams || {}),
      attempt.id,
    );
    if (Number.isInteger(eventId) && eventId > 0) {
      this.database.prepare(`
        INSERT OR IGNORE INTO task_token_usage_deltas (
          event_id, task_id, observed_at, usage_date, provider,
          input_tokens, output_tokens, total_tokens
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        eventId,
        taskId,
        observedAt,
        localDateKey(observedAt) || '',
        String(payload.provider || 'unknown'),
        delta.inputTokens,
        delta.outputTokens,
        delta.totalTokens,
      );
    }
    return true;
  }

  recoverInterruptedTasks() {
    const timestamp = now();
    const runningTasks = this.database.prepare(
      `SELECT id, provider, mode, terminal_lifecycle, keep_terminal_open, manual_completion
       FROM tasks
       WHERE status = 'running'
       ORDER BY id`,
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
        ? 'Same-session follow-up interrupted: CC Relay stopped while the follow-up was running.'
        : 'CC Relay stopped while this task was running.';
      const manualSession = (task.manual_completion === 1 || task.manual_completion === true)
        && (task.keep_terminal_open === 1 || task.keep_terminal_open === true)
        && task.terminal_lifecycle === 'disposable'
        && task.mode === 'execute'
        && ['codex', 'claude'].includes(task.provider);
      const activeAttempt = this.database.prepare(`
        SELECT started_at FROM task_attempts
        WHERE task_id = ? AND finished_at IS NULL
        ORDER BY id DESC
        LIMIT 1
      `).get(task.id);
      this.completeTaskAttempt(task.id, {
        attemptStartedAt: activeAttempt?.started_at || null,
        attemptFinishedAt: timestamp,
        outcome: 'interrupted',
        changes: {
          status: manualSession ? 'open' : 'interrupted',
          finished_at: manualSession ? null : timestamp,
          error,
        },
      });
      this.addEvent(
        task.id,
        'system',
        manualSession
          ? 'The interrupted turn ended, but the terminal session remains open for another message or manual completion.'
          : followUpInterrupted
          ? 'Same-session follow-up marked interrupted after CC Relay restarted. It was not queued.'
          : 'Task marked interrupted after CC Relay restarted.',
        activeAttempt ? {
          type: 'relay/task-attempt-finished',
          provider: task.provider,
          attemptStartedAt: activeAttempt.started_at,
          attemptFinishedAt: timestamp,
          outcome: 'interrupted',
        } : null,
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
    keepTerminalOpen = false,
    manualCompletion = false,
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
        continued_from_task_id, submission_id, terminal_lifecycle, keep_terminal_open,
        manual_completion,
        terminal_layout_json, turbo_json,
        prefer_idle_terminal,
        status, position, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?)
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
      keepTerminalOpen
        && terminalLifecycle === 'disposable'
        && provider !== 'opencode'
        ? 1
        : 0,
      manualCompletion
        && keepTerminalOpen
        && terminalLifecycle === 'disposable'
        && mode === 'execute'
        && ['codex', 'claude'].includes(provider)
        ? 1
        : 0,
      terminalLayout ? JSON.stringify(terminalLayout) : null,
      turbo ? JSON.stringify(turbo) : null,
      preferIdleTerminal ? 1 : 0,
      priority ? Number(row.min_queued_position) - 1 : Number(row.max_position) + 1,
      now(),
    );

    const task = this.getTask(Number(result.lastInsertRowid));
    this.addEvent(task.id, 'queue', 'Task added to the queue.');
    if (task.keep_terminal_open) {
      this.addEvent(
        task.id,
        'queue',
        task.manual_completion
          ? 'Terminal session mode enabled. This task stays open between turns until it is completed explicitly or its terminal closes.'
          : 'Terminal retention enabled. CC Relay will leave this task session open after its final outcome.',
      );
    }
    return task;
  }

  getTask(id) {
    return this.taskWithConversationMetrics(
      normalizeTask(this.database.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id)),
    );
  }

  // Last resort for binding a task to a workspace when live discovery cannot confirm the
  // session right now. A session CC Relay has run before is a known session, and its workspace
  // does not change, so this keeps task-add working through a discovery outage.
  latestTaskForThread(threadId) {
    if (!threadId) return null;
    const task = this.taskWithConversationMetrics(normalizeTask(this.database.prepare(
      `SELECT * FROM tasks
       WHERE thread_id = ? OR author_thread_id = ?
       ORDER BY id DESC
       LIMIT 1`,
    ).get(threadId, threadId)));
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
    return this.taskWithConversationMetrics(normalizeTask(this.database.prepare(
      `SELECT * FROM tasks WHERE submission_id = ?`,
    ).get(submissionId)));
  }

  listTasks() {
    const tasks = this.database.prepare(`
      SELECT * FROM tasks
      ORDER BY
        CASE status
          WHEN 'running' THEN 0
          WHEN 'open' THEN 1
          WHEN 'queued' THEN 2
          ELSE 3
        END,
        CASE WHEN status = 'queued' THEN position END ASC,
        CASE WHEN status IN ('running', 'open', 'queued') THEN id END ASC,
        CASE WHEN status NOT IN ('running', 'open', 'queued') THEN id END DESC
    `).all().map(normalizeTask);
    const metrics = this.conversationMetricsMap();
    return tasks.map((task) => this.taskWithConversationMetrics(task, metrics.get(task.id)));
  }

  taskSummaryProjection() {
    if (this._taskSummaryProjection) return this._taskSummaryProjection;
    const active = "tasks.status IN ('running', 'open', 'queued')";
    const columns = this.database.prepare('PRAGMA table_info(tasks)').all().map(({ name }) => {
      const identifier = `tasks."${String(name).replaceAll('"', '""')}"`;
      if (name === 'prompt') {
        return `CASE WHEN ${active} THEN ${identifier} ELSE substr(${identifier}, 1, 512) END AS prompt`;
      }
      if (name === 'result') {
        return `CASE WHEN ${active} THEN ${identifier} ELSE NULL END AS result`;
      }
      return identifier;
    });
    this._taskSummaryProjection = columns.join(',\n        ');
    return this._taskSummaryProjection;
  }

  // Queue cards need routing and compact display metadata, not every finished response or
  // arbitrarily long historical prompt. The selected-task endpoint remains the lossless view.
  listTaskSummaries() {
    const tasks = this.database.prepare(`
      SELECT
        ${this.taskSummaryProjection()},
        CASE
          WHEN tasks.status IN ('running', 'open', 'queued') OR length(tasks.prompt) <= 512 THEN 0
          ELSE 1
        END AS prompt_truncated,
        CASE WHEN tasks.status IN ('running', 'open', 'queued') THEN 0 ELSE 1 END AS detail_trimmed,
        COALESCE((
          SELECT events.id
          FROM events
          WHERE events.task_id = tasks.id
          ORDER BY events.id DESC
          LIMIT 1
        ), 0) AS latest_event_id
      FROM tasks
      ORDER BY
        CASE status
          WHEN 'running' THEN 0
          WHEN 'open' THEN 1
          WHEN 'queued' THEN 2
          ELSE 3
        END,
        CASE WHEN status = 'queued' THEN position END ASC,
        CASE WHEN status IN ('running', 'open', 'queued') THEN id END ASC,
        CASE WHEN status NOT IN ('running', 'open', 'queued') THEN id END DESC
    `).all().map(normalizeTask);
    const metrics = this.conversationMetricsMap();
    return tasks.map((task) => this.taskWithConversationMetrics(task, metrics.get(task.id)));
  }

  nextQueuedTask() {
    return this.taskWithConversationMetrics(normalizeTask(this.database.prepare(`
      SELECT * FROM tasks
      WHERE status = 'queued'
      ORDER BY position ASC, id ASC
      LIMIT 1
    `).get()));
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
    const persistedChanges = Object.fromEntries(
      Object.entries(changes).filter(([key]) => TASK_FIELDS.has(key)),
    );
    if (Object.hasOwn(persistedChanges, 'status')) {
      const currentStatus = this.database.prepare(
        `SELECT status FROM tasks WHERE id = ?`,
      ).get(id)?.status;
      if (persistedChanges.status === 'complete') {
        if (currentStatus && currentStatus !== 'complete') {
          persistedChanges.completion_reviewed = 0;
        }
      } else {
        persistedChanges.completion_reviewed = 1;
      }
    }
    const entries = Object.entries(persistedChanges);
    if (entries.length === 0) {
      return this.getTask(id);
    }

    const assignments = entries.map(([key]) => `${key} = ?`).join(', ');
    const values = entries.map(([, value]) => value);
    this.database.prepare(`UPDATE tasks SET ${assignments} WHERE id = ?`).run(...values, id);
    return this.getTask(id);
  }

  markTaskReviewed(id, expectedFinishedAt = undefined) {
    const exactCompletion = expectedFinishedAt !== undefined;
    const result = this.database.prepare(`
      UPDATE tasks
      SET completion_reviewed = 1
      WHERE id = ?
        AND status = 'complete'
        AND completion_reviewed = 0
        ${exactCompletion ? 'AND finished_at IS ?' : ''}
    `).run(...(exactCompletion ? [id, expectedFinishedAt] : [id]));
    return {
      reviewed: result.changes > 0,
      task: this.getTask(id),
    };
  }

  markProjectTasksReviewed(repoPath, reviews = []) {
    let inTransaction = false;
    try {
      this.database.exec('BEGIN IMMEDIATE');
      inTransaction = true;
      const review = this.database.prepare(`
        UPDATE tasks
        SET completion_reviewed = 1
        WHERE id = ?
          AND repo_path = ?
          AND status = 'complete'
          AND completion_reviewed = 0
          AND finished_at IS ?
      `);
      let reviewedCount = 0;
      for (const item of reviews) {
        reviewedCount += Number(review.run(item.taskId, repoPath, item.finishedAt).changes);
      }
      this.database.exec('COMMIT');
      inTransaction = false;
      return reviewedCount;
    } catch (error) {
      if (inTransaction) {
        try {
          this.database.exec('ROLLBACK');
        } catch {}
      }
      throw error;
    }
  }

  migrateCompletionReviews(unreadTaskIds = []) {
    let inTransaction = false;
    try {
      this.database.exec('BEGIN IMMEDIATE');
      inTransaction = true;
      const migrated = this.database.prepare(
        `SELECT value FROM settings WHERE key = ?`,
      ).get(COMPLETION_REVIEW_MIGRATION_SETTING);
      if (migrated) {
        this.database.exec('COMMIT');
        inTransaction = false;
        return { migrated: false, restored: 0 };
      }

      const restore = this.database.prepare(`
        UPDATE tasks
        SET completion_reviewed = 0
        WHERE id = ? AND status = 'complete'
      `);
      let restored = 0;
      for (const id of unreadTaskIds) {
        restored += Number(restore.run(id).changes);
      }
      this.database.prepare(`
        INSERT INTO settings (key, value) VALUES (?, ?)
      `).run(COMPLETION_REVIEW_MIGRATION_SETTING, now());
      this.database.exec('COMMIT');
      inTransaction = false;
      return { migrated: true, restored };
    } catch (error) {
      if (inTransaction) {
        try {
          this.database.exec('ROLLBACK');
        } catch {}
      }
      throw error;
    }
  }

  // How many other tasks ran in the same working tree while this one held it. A git diff cannot
  // attribute a change to a task, so the diff preview uses this to say when what it shows may
  // include another task's edits. Timestamps are ISO UTC, so string order is time order.
  // A missing finished_at only holds the tree open while the row is still live. A crashed or
  // legacy row left terminal without an end time would otherwise overlap every later window in
  // that project forever, which would make the shared tree warning permanent and meaningless.
  countOverlappingRepoTasks(repoPath, { excludeTaskId = null, from = null, to = null } = {}) {
    if (typeof repoPath !== 'string' || !repoPath) return 0;
    const windowStart = typeof from === 'string' && from ? from : '';
    const windowEnd = typeof to === 'string' && to ? to : now();
    const row = this.database.prepare(`
      SELECT COUNT(*) AS count
      FROM tasks
      WHERE repo_path = ?
        AND id IS NOT ?
        AND started_at IS NOT NULL
        AND started_at <= ?
        AND (
          status IN ('running', 'open')
          OR finished_at >= ?
        )
    `).get(repoPath, excludeTaskId, windowEnd, windowStart);
    return Number(row?.count || 0);
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
      'keep_terminal_open',
      'manual_completion',
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

  updateRetryableTask(id, changes) {
    const retryFields = new Set([
      'status',
      'position',
      'started_at',
      'finished_at',
      'session_id',
      'result',
      'error',
      'exit_code',
      'provider',
      'model',
      'effort',
      'thread_id',
      'thread_name',
      'thread_source',
      'continued_from_task_id',
      'keep_terminal_open',
      'manual_completion',
    ]);
    const entries = Object.entries(changes).filter(([key]) => retryFields.has(key));
    if (entries.length === 0) return this.getTask(id);
    const assignments = entries.map(([key]) => `${key} = ?`).join(', ');
    const values = entries.map(([, value]) => value);
    const result = this.database.prepare(`
      UPDATE tasks
      SET ${assignments}
      WHERE id = ? AND status IN ('failed', 'cancelled', 'interrupted')
    `).run(...values, id);
    if (result.changes === 0) {
      const task = this.getTask(id);
      if (!task) throw new Error('Task not found.');
      throw new Error('Only failed, cancelled, or interrupted tasks can be retried.');
    }
    return this.getTask(id);
  }

  addEvent(taskId, kind, message, payload = null) {
    const storedPayload = payload === null ? null : compactEventForStorage(payload);
    const encodedPayload = storedPayload === null ? null : JSON.stringify(storedPayload);
    const createdAt = now();
    const tokenUsageEvent = payload?.type === 'provider/token-usage'
      && payload.source === 'native'
      && payload.cumulative === true;
    let transactionOpen = false;
    try {
      if (tokenUsageEvent) {
        this.database.exec('BEGIN IMMEDIATE');
        transactionOpen = true;
      }
      const result = this.database.prepare(`
        INSERT INTO events (task_id, kind, message, payload, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(taskId, kind, message, encodedPayload, createdAt);
      const eventId = Number(result.lastInsertRowid);
      if (tokenUsageEvent) {
        this.recordTaskAttemptTokenUsage(taskId, payload, { eventId, observedAt: createdAt });
        this.database.exec('COMMIT');
        transactionOpen = false;
      }
      return this.database.prepare(`SELECT * FROM events WHERE id = ?`).get(eventId);
    } catch (error) {
      if (transactionOpen) {
        try { this.database.exec('ROLLBACK'); } catch {}
      }
      throw error;
    }
  }

  latestEventId(taskId) {
    const row = this.database.prepare(
      `SELECT COALESCE(MAX(id), 0) AS latest FROM events WHERE task_id = ?`,
    ).get(taskId);
    return Number(row?.latest || 0);
  }

  // Incremental read used by the global task monitor. Re-reading and re-parsing a full event
  // window for every running task or open manual session on every snapshot poll does not
  // scale, so callers only ask for what they have not already seen.
  listEventsSince(taskId, sinceId = 0, limit = 500) {
    const events = [];
    const rows = this.database.prepare(`
      SELECT * FROM events
      WHERE task_id = ? AND id > ?
      ORDER BY id DESC
      LIMIT ?
    `).iterate(taskId, sinceId, limit);
    for (const event of rows) {
      const payload = event.payload ? JSON.parse(event.payload) : null;
      events.push({
        ...event,
        // Old databases can contain unbounded activity rows. Compact one row at a time so
        // the returned window never retains all of those raw payload strings together.
        payload: payload === null ? null : compactEventForStorage(payload),
      });
    }
    return events.reverse();
  }

  listEvents(taskId, limit = 500) {
    const events = [];
    const rows = this.database.prepare(`
      SELECT * FROM events
      WHERE task_id = ?
      ORDER BY id DESC
      LIMIT ?
    `).iterate(taskId, limit);
    for (const event of rows) {
      const payload = event.payload ? JSON.parse(event.payload) : null;
      events.push({
        ...event,
        payload: payload === null ? null : compactEventForStorage(payload),
      });
    }
    return events.reverse();
  }

  // Exact task diffs need only successful provider file-change records, not the complete
  // activity stream. Filtering in SQLite keeps a long command and reasoning history from
  // consuming the bounded evidence window before its edit records are reached.
  listTaskFileChangeEvents(taskId, limit = 2001) {
    return this.database.prepare(`
      SELECT id, task_id, kind, payload, created_at
      FROM events
      WHERE task_id = ?
        AND payload IS NOT NULL
        AND json_valid(payload) = 1
        AND json_extract(payload, '$.type') = 'item/completed'
        AND json_extract(payload, '$.item.type') = 'fileChange'
        AND json_extract(payload, '$.item.status') = 'completed'
      ORDER BY id ASC
      LIMIT ?
    `).all(taskId, limit).map((event) => ({
      ...event,
      payload: JSON.parse(event.payload),
    }));
  }

  listTaskPrompts(taskId) {
    const task = this.getTask(taskId);
    if (!task) return [];
    const prompts = [{
      id: `task-${task.id}-original`,
      kind: 'original',
      text: task.prompt,
      created_at: task.created_at,
    }];
    const seen = new Set();
    const events = this.database.prepare(`
      SELECT id, payload, created_at
      FROM events
      WHERE task_id = ?
        AND payload IS NOT NULL
        AND json_valid(payload) = 1
        AND json_extract(payload, '$.item.type') = 'userMessage'
        AND (
          json_extract(payload, '$.item.clientId') GLOB 'relay-follow-up-*'
          OR json_extract(payload, '$.item.clientId') GLOB 'relay-steer-*'
          OR json_extract(payload, '$.item.id') GLOB 'relay-follow-up-*'
          OR json_extract(payload, '$.item.id') GLOB 'relay-steer-*'
        )
      ORDER BY id ASC
    `).all(taskId);
    for (const event of events) {
      let payload;
      try {
        payload = JSON.parse(event.payload);
      } catch {
        continue;
      }
      const item = payload?.item;
      const marker = relayPromptMarker(item);
      const text = userMessageText(item);
      if (!marker || !text || seen.has(marker)) continue;
      seen.add(marker);
      prompts.push({
        id: marker,
        kind: 'follow-up',
        text,
        created_at: event.created_at,
      });
    }
    return prompts;
  }

  listTaskResponses(taskId) {
    const task = this.getTask(taskId);
    if (!task) return [];
    const responses = [];
    const seen = new Set();
    const events = this.database.prepare(`
      SELECT id, payload, created_at
      FROM events
      WHERE task_id = ?
        AND payload IS NOT NULL
        AND json_valid(payload) = 1
        AND (
          (
            json_extract(payload, '$.type') = 'item/completed'
            AND json_extract(payload, '$.item.type') IN ('agentMessage', 'agent_message')
          )
          OR json_extract(payload, '$.type') IN ('claude/message', 'opencode/message')
        )
      ORDER BY id ASC
    `).all(taskId);
    for (const event of events) {
      let payload;
      try {
        payload = JSON.parse(event.payload);
      } catch {
        continue;
      }
      const response = assistantResponseText(payload);
      if (!response || seen.has(response)) continue;
      seen.add(response);
      responses.push({
        id: `event-${event.id}`,
        text: response,
        created_at: event.created_at,
      });
    }
    const latestResult = typeof task.result === 'string' ? task.result.trim() : '';
    if (latestResult && !seen.has(latestResult)) {
      responses.push({
        id: `task-${task.id}-result`,
        text: latestResult,
        created_at: task.finished_at || task.created_at,
      });
    }
    return responses;
  }

  listTaskSearchDocuments(repoPath) {
    const normalizedPath = normalizedTaskProjectPath(repoPath);
    if (!normalizedPath) return [];
    const tasks = this.listTasks().filter(
      (task) => normalizedTaskProjectPath(task.repo_path) === normalizedPath,
    );
    if (!tasks.length) return [];

    const documents = new Map(tasks.map((task) => {
      const commandSeen = new Set();
      const responseSeen = new Set();
      const commands = [];
      const responses = [];
      appendUniqueText(commands, commandSeen, task.prompt);
      return [task.id, {
        taskId: task.id,
        title: task.title === titleFromPrompt(task.prompt) ? '' : task.title,
        commands,
        responses,
        responseFallbacks: [task.result, task.error],
        commandSeen,
        responseSeen,
      }];
    }));

    const taskIds = [...documents.keys()];
    for (let offset = 0; offset < taskIds.length; offset += 500) {
      const chunk = taskIds.slice(offset, offset + 500);
      const placeholders = chunk.map(() => '?').join(', ');
      const events = this.database.prepare(`
        SELECT task_id, payload
        FROM events
        WHERE payload IS NOT NULL
          AND task_id IN (${placeholders})
          AND json_valid(payload) = 1
          AND (
            (
              json_extract(payload, '$.item.type') = 'userMessage'
              AND (
                json_extract(payload, '$.item.clientId') GLOB 'relay-follow-up-*'
                OR json_extract(payload, '$.item.clientId') GLOB 'relay-steer-*'
                OR json_extract(payload, '$.item.id') GLOB 'relay-follow-up-*'
                OR json_extract(payload, '$.item.id') GLOB 'relay-steer-*'
              )
            )
            OR (
              json_extract(payload, '$.type') = 'item/completed'
              AND json_extract(payload, '$.item.type') IN ('agentMessage', 'agent_message')
            )
            OR json_extract(payload, '$.type') IN ('claude/message', 'opencode/message')
          )
        ORDER BY task_id ASC, id ASC
      `).all(...chunk);
      for (const event of events) {
        const document = documents.get(event.task_id);
        if (!document) continue;
        let payload;
        try {
          payload = JSON.parse(event.payload);
        } catch {
          continue;
        }
        const item = payload?.item;
        if (relayPromptMarker(item)) {
          appendUniqueText(document.commands, document.commandSeen, userMessageText(item));
        }
        appendUniqueText(
          document.responses,
          document.responseSeen,
          assistantResponseText(payload),
        );
      }
    }

    for (const document of documents.values()) {
      for (const fallback of document.responseFallbacks) {
        appendUniqueText(document.responses, document.responseSeen, fallback);
      }
    }

    return [...documents.values()].map(({
      commandSeen,
      responseSeen,
      responseFallbacks,
      ...document
    }) => document);
  }

  deleteTask(id) {
    return this.database.prepare(`DELETE FROM tasks WHERE id = ?`).run(id).changes > 0;
  }

  listProjects() {
    return this.projectConfig.listProjects();
  }

  getProject(id) {
    return this.projectConfig.getProject(id);
  }

  getProjectByPath(path) {
    return this.projectConfig.getProjectByPath(path);
  }

  addProject({ path, name }) {
    return this.projectConfig.addProject({ path, name });
  }

  deleteProject(id) {
    return this.projectConfig.deleteProject(id);
  }

  markProjectLaunched(id) {
    return this.projectConfig.markProjectLaunched(id);
  }

  updateProjectInstanceLimits(id, { codex, claude, opencode }) {
    return this.projectConfig.updateProjectInstanceLimits(id, { codex, claude, opencode });
  }

  updateProjectTerminalSettings(id, settings) {
    return this.projectConfig.updateProjectTerminalSettings(id, settings);
  }

  updateAllProjectTerminalLayouts(terminalLayout) {
    return this.projectConfig.updateAllProjectTerminalLayouts(terminalLayout);
  }

  reorderProjects(projectIds, expectedProjectIds) {
    return this.projectConfig.reorderProjects(projectIds, expectedProjectIds);
  }

  updateProjectColor(id, color) {
    return this.projectConfig.updateProjectColor(id, color);
  }

  updateProjectStandupCustomPrompt(id, prompt) {
    return this.projectConfig.updateProjectStandupCustomPrompt(id, prompt);
  }

  activeProjectPath() {
    return this.projectConfig.activeProjectPath();
  }

  setActiveProjectPath(path) {
    return this.projectConfig.setActiveProjectPath(path);
  }

  uiPreferences() {
    return parseUiPreferences(this.projectConfig.setting(UI_PREFERENCES_SETTING));
  }

  setUiPreferences(preferences) {
    this.projectConfig.setSetting(UI_PREFERENCES_SETTING, JSON.stringify(preferences));
    return this.uiPreferences();
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
    keepTerminalOpen = false,
    terminalLayout = null,
    model = null,
    effort = null,
    status = 'running',
  }) {
    const timestamp = now();
    const result = this.database.prepare(`
      INSERT INTO plan_runs (
        plan_id, breakdown_id, provider, session_id, session_label, session_source,
        prefer_idle_terminal, terminal_lifecycle, keep_terminal_open, terminal_layout_json,
        model, effort, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      planId,
      breakdownId,
      provider,
      sessionId,
      sessionLabel,
      sessionSource,
      preferIdleTerminal ? 1 : 0,
      terminalLifecycle,
      keepTerminalOpen && terminalLifecycle === 'disposable' ? 1 : 0,
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
  // A stopped or failed run can still own steps that were queued or running when CC Relay
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
    this.projectConfig.close();
    this.database.close();
  }
}

export { now };
