import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const MIGRATION_SETTING = 'shared-project-config-path';
const ACTIVE_PROJECT_SETTING = 'active-project-path';

function timestamp() {
  return new Date().toISOString();
}

function ensureProjectColumn(database, name, definition) {
  const columns = database.prepare('PRAGMA table_info(projects)').all();
  if (!columns.some((column) => column.name === name)) {
    database.exec(`ALTER TABLE projects ADD COLUMN ${name} ${definition}`);
  }
}

function parseTerminalLayout(value) {
  if (!value) return null;
  try {
    const layout = JSON.parse(value);
    return layout && typeof layout === 'object' ? layout : null;
  } catch {
    return null;
  }
}

function normalizeProject(row) {
  if (!row) return null;
  const { terminal_layout_json: terminalLayoutJson, ...project } = row;
  return {
    ...project,
    keep_terminal_open: row.keep_terminal_open === 1 || row.keep_terminal_open === true,
    prefer_idle_terminal: row.prefer_idle_terminal === 1 || row.prefer_idle_terminal === true,
    standup_custom_prompt: typeof row.standup_custom_prompt === 'string'
      ? row.standup_custom_prompt
      : '',
    terminal_layout: parseTerminalLayout(terminalLayoutJson),
  };
}

function projectRows(database) {
  return database.prepare(`
    SELECT
      id,
      path,
      name,
      position,
      created_at,
      last_launched_at,
      max_codex_instances,
      max_claude_instances,
      keep_terminal_open,
      prefer_idle_terminal,
      color,
      standup_custom_prompt,
      terminal_layout_json
    FROM projects
    ORDER BY position ASC, id ASC
  `).all().map(normalizeProject);
}

function sameProjects(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export class ProjectConfigStore {
  constructor(filePath, { database = null, legacyDatabase = null } = {}) {
    this.filePath = resolve(filePath);
    this.ownsDatabase = !database;
    if (database) {
      this.database = database;
    } else {
      mkdirSync(dirname(this.filePath), { recursive: true });
      this.database = new DatabaseSync(this.filePath);
    }

    this.database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;

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
        keep_terminal_open INTEGER NOT NULL DEFAULT 0,
        prefer_idle_terminal INTEGER NOT NULL DEFAULT 0,
        color TEXT,
        standup_custom_prompt TEXT NOT NULL DEFAULT '',
        terminal_layout_json TEXT
      );
    `);
    ensureProjectColumn(this.database, 'keep_terminal_open', 'INTEGER NOT NULL DEFAULT 0');
    ensureProjectColumn(this.database, 'prefer_idle_terminal', 'INTEGER NOT NULL DEFAULT 0');
    ensureProjectColumn(this.database, 'color', 'TEXT');
    ensureProjectColumn(this.database, 'standup_custom_prompt', "TEXT NOT NULL DEFAULT ''");
    ensureProjectColumn(this.database, 'terminal_layout_json', 'TEXT');

    this.legacyDatabase = legacyDatabase && legacyDatabase !== this.database
      ? legacyDatabase
      : null;
    if (this.legacyDatabase) {
      ensureProjectColumn(this.legacyDatabase, 'keep_terminal_open', 'INTEGER NOT NULL DEFAULT 0');
      ensureProjectColumn(this.legacyDatabase, 'prefer_idle_terminal', 'INTEGER NOT NULL DEFAULT 0');
      ensureProjectColumn(this.legacyDatabase, 'color', 'TEXT');
      ensureProjectColumn(this.legacyDatabase, 'standup_custom_prompt', "TEXT NOT NULL DEFAULT ''");
      ensureProjectColumn(this.legacyDatabase, 'terminal_layout_json', 'TEXT');
      this.migrateLegacyProjects();
      this.syncLegacyMirror();
    }
  }

  migrateLegacyProjects() {
    const migration = this.legacyDatabase.prepare(
      `SELECT value FROM settings WHERE key = ?`,
    ).get(MIGRATION_SETTING);
    const legacyProjects = projectRows(this.legacyDatabase);
    const sharedProjectCount = Number(this.database.prepare(
      `SELECT COUNT(*) AS value FROM projects`,
    ).get().value);

    if (
      legacyProjects.length > 0
      && (migration?.value !== this.filePath || sharedProjectCount === 0)
    ) {
      this.database.exec('BEGIN IMMEDIATE');
      try {
        const existingByPath = this.database.prepare(
          `SELECT id FROM projects WHERE path = ?`,
        );
        const nextPosition = this.database.prepare(
          `SELECT COALESCE(MAX(position), 0) + 1 AS value FROM projects`,
        );
        const insert = this.database.prepare(`
          INSERT INTO projects (
            path,
            name,
            position,
            created_at,
            last_launched_at,
            max_codex_instances,
            max_claude_instances,
            keep_terminal_open,
            prefer_idle_terminal,
            color,
            standup_custom_prompt,
            terminal_layout_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const project of legacyProjects) {
          if (existingByPath.get(project.path)) continue;
          insert.run(
            project.path,
            project.name,
            Number(nextPosition.get().value),
            project.created_at || timestamp(),
            project.last_launched_at || null,
            project.max_codex_instances || 1,
            project.max_claude_instances || 1,
            project.keep_terminal_open ? 1 : 0,
            project.prefer_idle_terminal ? 1 : 0,
            project.color || null,
            project.standup_custom_prompt || '',
            project.terminal_layout ? JSON.stringify(project.terminal_layout) : null,
          );
        }
        this.database.exec('COMMIT');
      } catch (error) {
        this.database.exec('ROLLBACK');
        throw error;
      }
    }

    const legacyActiveProjectPath = this.legacyDatabase.prepare(
      `SELECT value FROM settings WHERE key = ?`,
    ).get(ACTIVE_PROJECT_SETTING)?.value;
    if (
      !this.activeProjectPath()
      && legacyActiveProjectPath
      && this.getProjectByPath(legacyActiveProjectPath)
    ) {
      this.setSetting(ACTIVE_PROJECT_SETTING, legacyActiveProjectPath);
    }

    this.legacyDatabase.prepare(`
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(MIGRATION_SETTING, this.filePath);
  }

  syncLegacyMirror(projects = projectRows(this.database)) {
    if (!this.legacyDatabase) return;
    const legacyProjects = projectRows(this.legacyDatabase);
    if (!sameProjects(legacyProjects, projects)) {
      this.legacyDatabase.exec('BEGIN IMMEDIATE');
      try {
        this.legacyDatabase.prepare(`DELETE FROM projects`).run();
        const insert = this.legacyDatabase.prepare(`
          INSERT INTO projects (
            id,
            path,
            name,
            position,
            created_at,
            last_launched_at,
            max_codex_instances,
            max_claude_instances,
            keep_terminal_open,
            prefer_idle_terminal,
            color,
            standup_custom_prompt,
            terminal_layout_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const project of projects) {
          insert.run(
            project.id,
            project.path,
            project.name,
            project.position,
            project.created_at,
            project.last_launched_at,
            project.max_codex_instances,
            project.max_claude_instances,
            project.keep_terminal_open ? 1 : 0,
            project.prefer_idle_terminal ? 1 : 0,
            project.color || null,
            project.standup_custom_prompt || '',
            project.terminal_layout ? JSON.stringify(project.terminal_layout) : null,
          );
        }
        this.legacyDatabase.exec('COMMIT');
      } catch (error) {
        this.legacyDatabase.exec('ROLLBACK');
        throw error;
      }
    }

    const activeProjectPath = this.activeProjectPath();
    if (activeProjectPath) {
      this.legacyDatabase.prepare(`
        INSERT INTO settings (key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run(ACTIVE_PROJECT_SETTING, activeProjectPath);
    } else {
      this.legacyDatabase.prepare(`DELETE FROM settings WHERE key = ?`)
        .run(ACTIVE_PROJECT_SETTING);
    }
  }

  listProjects() {
    const projects = projectRows(this.database);
    this.syncLegacyMirror(projects);
    return projects;
  }

  getProject(id) {
    return normalizeProject(
      this.database.prepare(`SELECT * FROM projects WHERE id = ?`).get(id),
    );
  }

  getProjectByPath(path) {
    return normalizeProject(
      this.database.prepare(`SELECT * FROM projects WHERE path = ?`).get(path),
    );
  }

  addProject({ path, name }) {
    this.database.exec('BEGIN IMMEDIATE');
    let project;
    try {
      project = this.getProjectByPath(path);
      if (!project) {
        const position = Number(this.database.prepare(
          `SELECT COALESCE(MAX(position), 0) + 1 AS value FROM projects`,
        ).get().value);
        const result = this.database.prepare(`
          INSERT INTO projects (path, name, position, created_at, keep_terminal_open)
          VALUES (?, ?, ?, ?, 0)
        `).run(path, name, position, timestamp());
        project = this.getProject(Number(result.lastInsertRowid));
      }
      if (!this.activeProjectPath()) {
        this.setSetting(ACTIVE_PROJECT_SETTING, project.path);
      }
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
    this.syncLegacyMirror();
    return project;
  }

  deleteProject(id) {
    this.database.exec('BEGIN IMMEDIATE');
    let deleted = false;
    try {
      const project = this.getProject(id);
      if (project) {
        const projectCount = Number(this.database.prepare(
          `SELECT COUNT(*) AS value FROM projects`,
        ).get().value);
        if (projectCount <= 1) {
          throw new Error(
            'CC Relay must keep one Launchpad project selected. Add another project before unpinning this one.',
          );
        }
        deleted = this.database.prepare(`DELETE FROM projects WHERE id = ?`).run(id).changes > 0;
        if (deleted && this.activeProjectPath() === project.path) {
          const replacement = this.database.prepare(`
            SELECT path FROM projects ORDER BY position ASC, id ASC LIMIT 1
          `).get();
          if (replacement?.path) this.setSetting(ACTIVE_PROJECT_SETTING, replacement.path);
          else this.deleteSetting(ACTIVE_PROJECT_SETTING);
        }
      }
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
    this.syncLegacyMirror();
    return deleted;
  }

  markProjectLaunched(id) {
    this.database.prepare(
      `UPDATE projects SET last_launched_at = ? WHERE id = ?`,
    ).run(timestamp(), id);
    const project = this.getProject(id);
    this.syncLegacyMirror();
    return project;
  }

  updateProjectInstanceLimits(id, { codex, claude }) {
    const project = this.getProject(id);
    if (!project) throw new Error('Pinned project not found.');
    this.database.prepare(`
      UPDATE projects
      SET max_codex_instances = ?, max_claude_instances = ?
      WHERE id = ?
    `).run(codex, claude, id);
    const updated = this.getProject(id);
    this.syncLegacyMirror();
    return updated;
  }

  updateProjectTerminalSettings(id, {
    keepTerminalOpen,
    preferIdleTerminal,
    terminalLayout,
  }) {
    const project = this.getProject(id);
    if (!project) throw new Error('Pinned project not found.');
    this.database.prepare(`
      UPDATE projects
      SET
        keep_terminal_open = ?,
        prefer_idle_terminal = ?,
        terminal_layout_json = ?
      WHERE id = ?
    `).run(
      keepTerminalOpen ? 1 : 0,
      preferIdleTerminal ? 1 : 0,
      terminalLayout ? JSON.stringify(terminalLayout) : null,
      id,
    );
    const updated = this.getProject(id);
    this.syncLegacyMirror();
    return updated;
  }

  updateAllProjectTerminalLayouts(terminalLayout) {
    this.database.prepare(`
      UPDATE projects
      SET terminal_layout_json = ?
    `).run(terminalLayout ? JSON.stringify(terminalLayout) : null);
    const projects = this.listProjects();
    this.syncLegacyMirror();
    return projects;
  }

  updateProjectColor(id, color) {
    const project = this.getProject(id);
    if (!project) throw new Error('Pinned project not found.');
    this.database.prepare(`
      UPDATE projects
      SET color = ?
      WHERE id = ?
    `).run(color || null, id);
    const updated = this.getProject(id);
    this.syncLegacyMirror();
    return updated;
  }

  updateProjectStandupCustomPrompt(id, prompt) {
    const project = this.getProject(id);
    if (!project) throw new Error('Pinned project not found.');
    this.database.prepare(`
      UPDATE projects
      SET standup_custom_prompt = ?
      WHERE id = ?
    `).run(prompt || '', id);
    const updated = this.getProject(id);
    this.syncLegacyMirror();
    return updated;
  }

  activeProjectPath() {
    const path = this.setting(ACTIVE_PROJECT_SETTING);
    if (!path || !this.getProjectByPath(path)) return null;
    return path;
  }

  setActiveProjectPath(path) {
    const project = this.getProjectByPath(path);
    if (!project) throw new Error('Pinned project not found.');
    this.setSetting(ACTIVE_PROJECT_SETTING, project.path);
    this.syncLegacyMirror();
    return project.path;
  }

  setting(key) {
    return this.database.prepare(`SELECT value FROM settings WHERE key = ?`).get(key)?.value || null;
  }

  setSetting(key, value) {
    this.database.prepare(`
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, value);
  }

  deleteSetting(key) {
    this.database.prepare(`DELETE FROM settings WHERE key = ?`).run(key);
  }

  close() {
    if (this.ownsDatabase) this.database.close();
  }
}
