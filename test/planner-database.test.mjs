import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { RelayDatabase } from '../src/database.mjs';

function withDatabase(run) {
  const directory = mkdtempSync(join(tmpdir(), 'relay-planner-'));
  const database = new RelayDatabase(join(directory, 'relay.sqlite'));
  try {
    run(database);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

test('plans are created, listed per project, updated, and deleted', () => {
  withDatabase((database) => {
    const created = database.createPlan({ repoPath: '/repo/app', name: 'Auth', content: 'Initial brief' });
    assert.ok(created.id);
    assert.equal(created.name, 'Auth');
    assert.equal(created.content, 'Initial brief');
    assert.equal(created.created_at, created.updated_at);

    database.createPlan({ repoPath: '/repo/other', name: 'Elsewhere', content: '' });
    const scoped = database.listPlans('/repo/app');
    assert.deepEqual(scoped.map((plan) => plan.name), ['Auth']);
    assert.deepEqual(database.listPlans('/repo/missing'), []);

    const updated = database.updatePlan(created.id, { name: 'Auth v2', content: 'Revised' });
    assert.equal(updated.name, 'Auth v2');
    assert.equal(updated.content, 'Revised');
    assert.notEqual(updated.updated_at, created.updated_at);

    assert.equal(database.deletePlan(created.id), true);
    assert.equal(database.getPlan(created.id), null);
    assert.deepEqual(database.listPlans('/repo/app'), []);
  });
});

test('breakdowns link to a plan, track the latest, and normalize proposals', () => {
  withDatabase((database) => {
    const plan = database.createPlan({ repoPath: '/repo/app', name: 'Auth', content: 'brief' });
    const first = database.createPlanBreakdown({
      planId: plan.id,
      provider: 'codex',
      sessionId: 'thread-1',
      sessionLabel: 'CC Relay 1',
      guidance: 'small tasks',
      status: 'pending',
    });
    assert.equal(first.status, 'pending');
    assert.deepEqual(first.proposals, []);
    assert.equal(first.parsed, false);

    const linked = database.updatePlanBreakdown(first.id, { task_id: 42 });
    assert.equal(linked.task_id, 42);
    assert.equal(database.breakdownForTask(42).id, first.id);

    const completed = database.updatePlanBreakdown(first.id, {
      status: 'complete',
      parsed: 1,
      raw_response: '{"tasks":[]}',
      proposals_json: JSON.stringify([{ id: 'a', title: 'One', prompt: 'do one' }]),
    });
    assert.equal(completed.status, 'complete');
    assert.equal(completed.parsed, true);
    assert.equal(completed.proposals.length, 1);
    assert.equal(completed.proposals[0].title, 'One');

    const second = database.createPlanBreakdown({ planId: plan.id, provider: 'claude', status: 'pending' });
    assert.equal(database.latestPlanBreakdown(plan.id).id, second.id);
    assert.equal(database.breakdownsForPlan(plan.id).length, 2);
  });
});

test('setBreakdownProposals persists edited/reordered proposals', () => {
  withDatabase((database) => {
    const plan = database.createPlan({ repoPath: '/repo/app', name: 'Auth', content: 'brief' });
    const breakdown = database.createPlanBreakdown({ planId: plan.id, status: 'complete' });
    const saved = database.setBreakdownProposals(breakdown.id, [
      { id: '2', title: 'Second', prompt: 'b' },
      { id: '1', title: 'First', prompt: 'a' },
    ]);
    assert.deepEqual(saved.proposals.map((item) => item.id), ['2', '1']);
  });
});

test('deleting a plan cascades its breakdown records', () => {
  withDatabase((database) => {
    const plan = database.createPlan({ repoPath: '/repo/app', name: 'Auth', content: 'brief' });
    const breakdown = database.createPlanBreakdown({ planId: plan.id, status: 'complete' });
    database.deletePlan(plan.id);
    assert.equal(database.getPlanBreakdown(breakdown.id), null);
    assert.deepEqual(database.breakdownsForPlan(plan.id), []);
  });
});

test('breakdown notes persist alongside proposals', () => {
  withDatabase((database) => {
    const plan = database.createPlan({ repoPath: '/repo/app', name: 'Auth', content: 'brief' });
    const breakdown = database.createPlanBreakdown({ planId: plan.id, status: 'complete' });
    assert.deepEqual(breakdown.notes, [], 'a fresh breakdown has no notes');
    const saved = database.setBreakdownProposals(
      breakdown.id,
      [{ id: 'a', title: 'One', prompt: 'do one', dependsOn: [] }],
      [{ code: 'cycle-dropped', message: 'loop broken', proposalId: 'a', ref: 'b' }],
    );
    assert.equal(saved.notes.length, 1);
    assert.equal(saved.notes[0].code, 'cycle-dropped');
    assert.deepEqual(saved.proposals[0].dependsOn, []);
    // Omitting notes leaves the stored ones alone.
    const again = database.setBreakdownProposals(breakdown.id, saved.proposals);
    assert.equal(again.notes.length, 1);
  });
});

test('breakdown attempts are numbered oldest first', () => {
  withDatabase((database) => {
    const plan = database.createPlan({ repoPath: '/repo/app', name: 'Auth', content: 'brief' });
    const first = database.createPlanBreakdown({ planId: plan.id, status: 'complete' });
    const second = database.createPlanBreakdown({ planId: plan.id, status: 'pending' });
    assert.equal(database.breakdownAttempt(plan.id, first.id), 1);
    assert.equal(database.breakdownAttempt(plan.id, second.id), 2);
  });
});

test('plan runs and their steps persist, list in order, and cascade', () => {
  withDatabase((database) => {
    const plan = database.createPlan({ repoPath: '/repo/app', name: 'Auth', content: 'brief' });
    const run = database.createPlanRun({
      planId: plan.id,
      provider: 'codex',
      sessionId: 'relay-a',
      sessionLabel: 'CC Relay 1',
      sessionSource: 'cli',
      preferIdleTerminal: true,
      terminalLifecycle: 'disposable',
      keepTerminalOpen: true,
      terminalLayout: { enabled: true, rows: 2, columns: 2, display: 0 },
      model: 'sol',
      effort: 'high',
    });
    assert.equal(run.status, 'running');
    assert.equal(run.prefer_idle_terminal, true);
    assert.equal(run.terminal_lifecycle, 'disposable');
    assert.equal(run.keep_terminal_open, true);
    assert.deepEqual(run.terminal_layout, { enabled: true, rows: 2, columns: 2, display: 0 });
    assert.equal(database.latestPlanRun(plan.id).id, run.id);
    assert.deepEqual(database.activePlanRuns().map((item) => item.id), [run.id]);

    database.createPlanRunStep({
      runId: run.id, proposalId: 'a', position: 1, title: 'A', prompt: 'do a',
    });
    const second = database.createPlanRunStep({
      runId: run.id, proposalId: 'b', position: 2, title: 'B', prompt: 'do b', dependsOn: ['a'],
    });
    assert.deepEqual(database.planRunSteps(run.id).map((step) => step.proposal_id), ['a', 'b']);
    assert.deepEqual(second.dependsOn, ['a']);

    database.updatePlanRunStep(second.id, { task_id: 9, status: 'queued' });
    assert.equal(database.planRunStepForTask(9).proposal_id, 'b');

    database.updatePlanRun(run.id, { status: 'stopped' });
    assert.deepEqual(database.activePlanRuns(), []);

    database.deletePlan(plan.id);
    assert.equal(database.getPlanRun(run.id), null);
    assert.deepEqual(database.planRunSteps(run.id), []);
  });
});

test('a database created before planner v2 gains the notes column additively', () => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-planner-migrate-'));
  const file = join(directory, 'relay.sqlite');
  try {
    const legacy = new RelayDatabase(file);
    // Reproduce a pre-v2 table: the same shape without notes_json.
    legacy.database.exec(`
      DROP TABLE plan_breakdowns;
      CREATE TABLE plan_breakdowns (
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
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    const plan = legacy.createPlan({ repoPath: '/repo/app', name: 'Auth', content: 'brief' });
    const breakdown = legacy.createPlanBreakdown({ planId: plan.id, status: 'complete' });
    legacy.close();

    const upgraded = new RelayDatabase(file);
    try {
      const row = upgraded.getPlanBreakdown(breakdown.id);
      assert.deepEqual(row.notes, [], 'the existing row survives with an empty note list');
      const saved = upgraded.setBreakdownProposals(breakdown.id, [], [{ code: 'unknown-dependency' }]);
      assert.equal(saved.notes.length, 1);
    } finally {
      upgraded.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
