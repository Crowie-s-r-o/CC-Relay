import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  buildProjectReorderRequest,
  dropProjectInOrder,
  moveProjectInOrder,
  projectOrderIds,
} from '../public/project-reorder.js';
import { RelayDatabase } from '../src/database.mjs';

test('project reorder helpers preserve the complete project inventory', () => {
  assert.deepEqual(projectOrderIds([{ id: 3 }, { id: 7 }, { id: 11 }]), [3, 7, 11]);
  assert.deepEqual(dropProjectInOrder([3, 7, 11], 3, 11, 'after'), [7, 11, 3]);
  assert.deepEqual(dropProjectInOrder([3, 7, 11], 11, 3, 'before'), [11, 3, 7]);
  assert.deepEqual(moveProjectInOrder([3, 7, 11], 7, -1), [7, 3, 11]);
  assert.equal(moveProjectInOrder([3, 7, 11], 3, -1), null);
  assert.equal(dropProjectInOrder([3, 7, 11], 3, 99, 'after'), null);
  assert.deepEqual(
    buildProjectReorderRequest([3, 7, 11], [7, 11, 3]),
    { expectedProjectIds: [3, 7, 11], projectIds: [7, 11, 3] },
  );
  assert.equal(buildProjectReorderRequest([3, 7, 11], [7, 3]), null);
  assert.equal(buildProjectReorderRequest([3, 7, 11], [3, 7, 11]), null);
});

test('project order persists atomically and rejects stale or incomplete snapshots', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-project-reorder-'));
  const file = join(directory, 'relay.sqlite');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  let database = new RelayDatabase(file);
  try {
    const first = database.addProject({ path: '/repo/alpha', name: 'alpha' });
    const second = database.addProject({ path: '/repo/bravo', name: 'bravo' });
    const third = database.addProject({ path: '/repo/charlie', name: 'charlie' });
    const original = [first.id, second.id, third.id];
    database.setActiveProjectPath(second.path);

    const reordered = database.reorderProjects(
      [third.id, first.id, second.id],
      original,
    );
    assert.deepEqual(reordered.map((project) => project.id), [third.id, first.id, second.id]);
    assert.deepEqual(reordered.map((project) => project.position), [1, 2, 3]);
    assert.equal(database.activeProjectPath(), second.path);
    assert.throws(
      () => database.reorderProjects([second.id, third.id, first.id], original),
      /project order changed/i,
    );
    assert.deepEqual(
      database.listProjects().map((project) => project.id),
      [third.id, first.id, second.id],
    );
    assert.throws(
      () => database.reorderProjects(
        [third.id, first.id],
        [third.id, first.id, second.id],
      ),
      /every pinned project exactly once/i,
    );

    const fourth = database.addProject({ path: '/repo/delta', name: 'delta' });
    assert.deepEqual(
      database.listProjects().map((project) => project.id),
      [third.id, first.id, second.id, fourth.id],
    );
    database.close();
    database = new RelayDatabase(file);
    assert.deepEqual(
      database.listProjects().map((project) => project.id),
      [third.id, first.id, second.id, fourth.id],
    );
  } finally {
    try { database.close(); } catch {}
  }
});

test('Launchpad exposes capability-gated pointer and keyboard project reordering', () => {
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const markup = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const style = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');
  const server = readFileSync(new URL('../src/server.mjs', import.meta.url), 'utf8');

  assert.match(server, /projectReorder:\s*true/);
  assert.match(server, /pathname === '\/api\/projects\/reorder'/);
  assert.match(server, /database\.reorderProjects\(body\.projectIds, body\.expectedProjectIds\)/);
  assert.match(markup, /id="project-reorder-status"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(app, /data-project-action="reorder" draggable="\$\{!state\.projectReorderPending\}" role="button" tabindex="0"/);
  assert.match(app, /elements\.projectList\.addEventListener\('dragstart'/);
  assert.match(app, /elements\.projectList\.addEventListener\('dragover'/);
  assert.match(app, /elements\.projectList\.addEventListener\('drop'/);
  assert.match(app, /\['ArrowLeft', 'ArrowRight'\]\.includes\(event\.key\)/);
  assert.match(app, /if \(state\.projectDrag \|\| state\.projectReorderPending\) return;/);
  assert.match(app, /restoreProjectListFocus\(focusTarget\)/);
  assert.match(app, /control\?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(app, /\$\{reorderable \? 'project-chip-reorderable' : ''\}/);
  assert.match(style, /\.project-chip\.project-chip-reorderable \{\s*grid-template-areas: "drag head activity close"/);
  assert.match(style, /\.project-chip\.project-drop-before::before,[\s\S]*?var\(--project-drag-accent/);
  assert.match(style, /html\[data-theme="dark"\] \.project-drag-handle/);
});
