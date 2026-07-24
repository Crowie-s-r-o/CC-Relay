import test from 'node:test';
import assert from 'node:assert/strict';
import { turboPlanMarker, turboPlanPhase, turboWaitingCopy } from '../public/turbo-state.js';

function turbo(status, planStatus) {
  return {
    mode: 'turbo',
    status,
    turboPlanSummary: planStatus ? { status: planStatus, summary: 'Graph', taskCount: 3 } : null,
  };
}

test('non-Turbo tasks have no forward-plan marker', () => {
  assert.equal(turboPlanPhase({ mode: 'execute', status: 'queued' }), null);
  assert.equal(turboPlanMarker({ mode: 'plan', status: 'running' }), null);
});

test('queued Turbo tasks distinguish awaiting, planning, ready, and terminal plan states', () => {
  assert.deepEqual(turboPlanMarker(turbo('queued')), { phase: 'awaiting', label: 'Forward plan' });
  assert.deepEqual(turboPlanMarker(turbo('queued', 'planning')), { phase: 'planning', label: 'Planning ahead' });
  assert.deepEqual(turboPlanMarker(turbo('queued', 'reviewing')), { phase: 'reviewing', label: 'Council review' });
  assert.deepEqual(turboPlanMarker(turbo('queued', 'ready')), { phase: 'ready', label: 'Plan ready' });
  assert.deepEqual(turboPlanMarker(turbo('queued', 'complete')), { phase: 'complete', label: 'Plan complete' });
  assert.deepEqual(turboPlanMarker(turbo('queued', 'failed')), { phase: 'failed', label: 'Plan failed' });
});

test('running Turbo tasks show workers running after a prepared graph', () => {
  assert.deepEqual(turboPlanMarker(turbo('running')), { phase: 'planning', label: 'Planning graph' });
  assert.deepEqual(turboPlanMarker(turbo('running', 'planning')), { phase: 'planning', label: 'Planning graph' });
  assert.deepEqual(turboPlanMarker(turbo('running', 'reviewing')), { phase: 'reviewing', label: 'Council review' });
  assert.deepEqual(turboPlanMarker(turbo('running', 'executing')), { phase: 'executing', label: 'Workers running' });
  assert.deepEqual(turboPlanMarker(turbo('running', 'ready')), { phase: 'executing', label: 'Workers running' });
  assert.deepEqual(turboPlanMarker(turbo('running', 'failed')), { phase: 'failed', label: 'Plan failed' });
});

test('terminal task outcomes map to complete or failed marker variants', () => {
  assert.equal(turboPlanPhase(turbo('complete', 'complete')), 'complete');
  assert.equal(turboPlanPhase(turbo('failed', 'executing')), 'failed');
  assert.equal(turboPlanPhase(turbo('interrupted', 'executing')), 'failed');
  assert.equal(turboPlanPhase(turbo('cancelled', 'planning')), 'failed');
});

test('ready plans explain that execution will skip planning', () => {
  assert.match(turboWaitingCopy(turbo('queued', 'ready')), /skip planning/);
  assert.match(turboWaitingCopy(turbo('queued', 'planning')), /planning this task ahead/);
  assert.match(turboWaitingCopy(turbo('queued', 'reviewing')), /reviewing the Codex graph/);
  assert.match(turboWaitingCopy(turbo('queued')), /dependency graph/);
  assert.match(turboWaitingCopy(turbo('running', 'planning')), /before workers start/);
});

test('reviewing copy follows the selected provider order', () => {
  const task = turbo('queued', 'reviewing');
  task.turbo = { council: { order: ['claude', 'codex'] } };
  assert.match(turboWaitingCopy(task), /Codex is reviewing the Claude graph/);
});
