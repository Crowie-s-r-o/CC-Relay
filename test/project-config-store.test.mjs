import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { RelayDatabase } from '../src/database.mjs';

test('localhost and desktop databases share migrated project configuration', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-shared-projects-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const localhostFile = join(directory, 'localhost', 'relay.sqlite');
  const desktopFile = join(directory, 'desktop', 'relay.sqlite');
  const configFile = join(directory, 'user-data', 'relay-config.sqlite');

  const seed = new RelayDatabase(localhostFile);
  const first = seed.addProject({ path: '/repo/one', name: 'one' });
  const second = seed.addProject({ path: '/repo/two', name: 'two' });
  seed.updateProjectInstanceLimits(first.id, { codex: 4, claude: 2, opencode: 3 });
  seed.updateProjectColor(first.id, '#f05268');
  seed.updateProjectStandupCustomPrompt(first.id, 'Use product terminology.');
  seed.updateProjectTerminalSettings(first.id, {
    keepTerminalOpen: false,
    preferIdleTerminal: true,
    terminalLayout: {
      enabled: true,
      columns: 2,
      rows: 2,
      display: 1,
      background: false,
    },
  });
  seed.setActiveProjectPath(second.path);
  seed.close();

  const emptyDesktop = new RelayDatabase(desktopFile, { projectConfigPath: configFile });
  assert.deepEqual(emptyDesktop.listProjects(), []);
  emptyDesktop.close();

  const localhost = new RelayDatabase(localhostFile, { projectConfigPath: configFile });
  const desktop = new RelayDatabase(desktopFile, { projectConfigPath: configFile });
  try {
    assert.deepEqual(
      desktop.listProjects().map((project) => ({
        path: project.path,
        codex: project.max_codex_instances,
        claude: project.max_claude_instances,
        opencode: project.max_opencode_instances,
        color: project.color,
        standupPrompt: project.standup_custom_prompt,
      })),
      [
        {
          path: '/repo/one',
          codex: 4,
          claude: 2,
          opencode: 3,
          color: '#f05268',
          standupPrompt: 'Use product terminology.',
        },
        {
          path: '/repo/two',
          codex: 1,
          claude: 1,
          opencode: 1,
          color: null,
          standupPrompt: '',
        },
      ],
    );
    assert.equal(desktop.activeProjectPath(), '/repo/two');
    assert.deepEqual(
      desktop.listProjects().map((project) => ({
        path: project.path,
        keepOpen: project.keep_terminal_open,
        preferIdle: project.prefer_idle_terminal,
        layout: project.terminal_layout,
      })),
      [
        {
          path: '/repo/one',
          keepOpen: false,
          preferIdle: true,
          layout: {
            enabled: true,
            columns: 2,
            rows: 2,
            display: 1,
            background: false,
          },
        },
        {
          path: '/repo/two',
          keepOpen: false,
          preferIdle: false,
          layout: null,
        },
      ],
      'terminal preferences stay isolated by exact project path',
    );

    const sharedFirst = desktop.getProjectByPath('/repo/one');
    desktop.updateProjectInstanceLimits(sharedFirst.id, { codex: 6, claude: 3, opencode: 5 });
    assert.equal(localhost.getProject(sharedFirst.id).max_codex_instances, 6);
    assert.equal(localhost.getProject(sharedFirst.id).max_opencode_instances, 5);
    desktop.updateProjectColor(sharedFirst.id, '#28bfe8');
    assert.equal(localhost.getProject(sharedFirst.id).color, '#28bfe8');
    desktop.updateProjectStandupCustomPrompt(sharedFirst.id, 'Lead with shipped outcomes.');
    assert.equal(
      localhost.getProject(sharedFirst.id).standup_custom_prompt,
      'Lead with shipped outcomes.',
    );

    const third = localhost.addProject({ path: '/repo/three', name: 'three' });
    assert.deepEqual(
      desktop.listProjects().map((project) => project.path),
      ['/repo/one', '/repo/two', '/repo/three'],
    );
    desktop.setActiveProjectPath(third.path);
    assert.equal(localhost.activeProjectPath(), third.path);
    const sharedSecond = desktop.getProjectByPath('/repo/two');
    desktop.updateProjectTerminalSettings(sharedSecond.id, {
      keepTerminalOpen: true,
      preferIdleTerminal: false,
      terminalLayout: {
        enabled: true,
        columns: 5,
        rows: 1,
        display: 0,
        background: true,
      },
    });
    assert.equal(localhost.getProject(sharedFirst.id).keep_terminal_open, false);
    assert.equal(localhost.getProject(sharedSecond.id).terminal_layout.columns, 5);
    assert.equal(localhost.getProject(sharedSecond.id).standup_custom_prompt, '');

    desktop.deleteProject(sharedFirst.id);
  } finally {
    desktop.close();
    localhost.close();
  }

  const reopened = new RelayDatabase(localhostFile, { projectConfigPath: configFile });
  try {
    assert.deepEqual(
      reopened.listProjects().map((project) => project.path),
      ['/repo/two', '/repo/three'],
      'a stale legacy mirror does not resurrect a project removed by the other process',
    );
    reopened.deleteProject(reopened.getProjectByPath('/repo/two').id);
    assert.throws(
      () => reopened.deleteProject(reopened.getProjectByPath('/repo/three').id),
      /must keep one Launchpad project selected/,
    );
  } finally {
    reopened.close();
  }
});

test('older shared project rows gain an empty Standup prompt without losing configuration', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-project-standup-migration-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const configFile = join(directory, 'user-data', 'relay-config.sqlite');
  mkdirSync(join(directory, 'user-data'), { recursive: true });
  const older = new DatabaseSync(configFile);
  older.exec(`
    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE projects (
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
      terminal_layout_json TEXT
    );
    INSERT INTO projects (
      path, name, position, created_at, max_codex_instances, max_claude_instances, color
    ) VALUES ('/repo/legacy', 'legacy', 1, '2026-08-19T00:00:00.000Z', 3, 2, '#123456');
  `);
  older.close();

  const database = new RelayDatabase(join(directory, 'relay.sqlite'), {
    projectConfigPath: configFile,
  });
  try {
    const project = database.getProjectByPath('/repo/legacy');
    assert.equal(project.standup_custom_prompt, '');
    assert.equal(project.max_codex_instances, 3);
    assert.equal(project.max_claude_instances, 2);
    assert.equal(project.max_opencode_instances, 1);
    assert.equal(project.color, '#123456');
    assert.equal(
      database.updateProjectStandupCustomPrompt(project.id, 'Use legacy product names.')
        .standup_custom_prompt,
      'Use legacy product names.',
    );
  } finally {
    database.close();
  }

  const reopened = new RelayDatabase(join(directory, 'relay.sqlite'), {
    projectConfigPath: configFile,
  });
  try {
    assert.equal(
      reopened.getProjectByPath('/repo/legacy').standup_custom_prompt,
      'Use legacy product names.',
    );
  } finally {
    reopened.close();
  }
});
