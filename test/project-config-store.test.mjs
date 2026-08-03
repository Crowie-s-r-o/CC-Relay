import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  seed.updateProjectInstanceLimits(first.id, { codex: 4, claude: 2 });
  seed.updateProjectColor(first.id, '#f05268');
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
        color: project.color,
      })),
      [
        { path: '/repo/one', codex: 4, claude: 2, color: '#f05268' },
        { path: '/repo/two', codex: 1, claude: 1, color: null },
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
    desktop.updateProjectInstanceLimits(sharedFirst.id, { codex: 6, claude: 3 });
    assert.equal(localhost.getProject(sharedFirst.id).max_codex_instances, 6);
    desktop.updateProjectColor(sharedFirst.id, '#28bfe8');
    assert.equal(localhost.getProject(sharedFirst.id).color, '#28bfe8');

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
