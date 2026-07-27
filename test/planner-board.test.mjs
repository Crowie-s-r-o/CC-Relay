import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  activeWaveIndex,
  addProposal,
  blockedReasonLabel,
  blockingSteps,
  breakdownNoteLabel,
  canRunPlan,
  computeWaves,
  defaultRunSelection,
  dependencyIds,
  dependencyLabel,
  dependsOnTransitively,
  drainingStepCount,
  drainingSteps,
  nextProposalId,
  planRunIsActive,
  planRunIsLive,
  plannerBoardSignature,
  plannerV2Capable,
  proposalStatus,
  pruneDanglingDependencies,
  resolvedDependencies,
  runAnnouncement,
  runnableSelection,
  runProgressSummary,
  runStartBlockReason,
  runStatusPresentation,
  runStepFor,
  shouldAdoptServerProposals,
  stepEditingLocked,
  stepStatusPresentation,
  toggleDependency,
} from '../public/planner-board.js';

const step = (id, dependsOn = []) => ({ id, title: `Step ${id}`, prompt: `Do ${id}`, dependsOn });

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');

/** Body of a top-level function declaration in app.js, for scoped assertions. */
function functionBody(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} is defined`);
  // Skip the parameter list, which may itself contain destructuring braces.
  let parens = 0;
  let cursor = source.indexOf('(', start);
  for (; cursor < source.length; cursor += 1) {
    if (source[cursor] === '(') parens += 1;
    else if (source[cursor] === ')') {
      parens -= 1;
      if (parens === 0) break;
    }
  }
  const open = source.indexOf('{', cursor);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    else if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open, index + 1);
    }
  }
  throw new Error(`could not find the end of ${name}`);
}

test('plannerV2Capable reflects only the advertised plannerV2 capability', () => {
  assert.equal(plannerV2Capable({ capabilities: { plannerV2: true } }), true);
  assert.equal(plannerV2Capable({ capabilities: { planner: true } }), false);
  assert.equal(plannerV2Capable({ capabilities: { plannerV2: false } }), false);
  assert.equal(plannerV2Capable(null), false);
});

test('dependencyIds normalizes to unique strings and tolerates junk', () => {
  assert.deepEqual(dependencyIds({ dependsOn: ['a', 'a', 2, null, undefined, ''] }), ['a', '2']);
  assert.deepEqual(dependencyIds({}), []);
  assert.deepEqual(dependencyIds(null), []);
});

test('resolvedDependencies ignores self references and unknown ids', () => {
  const proposals = [step('a'), step('b', ['a', 'b', 'ghost'])];
  assert.deepEqual(resolvedDependencies(proposals[1], proposals), ['a']);
});

test('computeWaves groups steps with no unmet dependencies into wave 1', () => {
  const proposals = [step('a'), step('b'), step('c', ['a']), step('d', ['a', 'b']), step('e', ['c'])];
  const { waves, unresolvable } = computeWaves(proposals);
  assert.deepEqual(waves.map((wave) => wave.map((item) => item.id)), [['a', 'b'], ['c', 'd'], ['e']]);
  assert.deepEqual(unresolvable, []);
});

test('computeWaves keeps a dependency cycle out of the runnable waves', () => {
  const proposals = [step('a'), step('b', ['c']), step('c', ['b'])];
  const { waves, unresolvable } = computeWaves(proposals);
  assert.deepEqual(waves.map((wave) => wave.map((item) => item.id)), [['a']]);
  assert.deepEqual(unresolvable.map((item) => item.id), ['b', 'c']);
});

test('computeWaves handles an empty list', () => {
  assert.deepEqual(computeWaves([]), { waves: [], unresolvable: [] });
  assert.deepEqual(computeWaves(null), { waves: [], unresolvable: [] });
});

test('pruneDanglingDependencies drops references to removed steps', () => {
  const proposals = [step('a', ['gone']), step('b', ['a'])];
  const pruned = pruneDanglingDependencies(proposals);
  assert.deepEqual(pruned[0].dependsOn, []);
  assert.deepEqual(pruned[1].dependsOn, ['a']);
  // untouched entries keep their identity so a rerender can compare cheaply
  assert.equal(pruned[1], proposals[1]);
});

test('dependsOnTransitively follows the chain', () => {
  const proposals = [step('a'), step('b', ['a']), step('c', ['b'])];
  assert.equal(dependsOnTransitively(proposals, 'c', 'a'), true);
  assert.equal(dependsOnTransitively(proposals, 'a', 'c'), false);
  assert.equal(dependsOnTransitively(proposals, 'ghost', 'a'), false);
});

test('toggleDependency adds, removes, and refuses self or cycle edges', () => {
  const proposals = [step('a'), step('b', ['a'])];
  const added = toggleDependency(proposals, 'a', 'b');
  // a depends on b would close the a -> b -> a cycle, so it is refused
  assert.equal(added, proposals);
  assert.equal(toggleDependency(proposals, 'a', 'a'), proposals);
  assert.equal(toggleDependency(proposals, 'a', 'ghost'), proposals);
  const removed = toggleDependency(proposals, 'b', 'a');
  assert.deepEqual(removed[1].dependsOn, []);
  const readded = toggleDependency(removed, 'b', 'a');
  assert.deepEqual(readded[1].dependsOn, ['a']);
  // the source list is never mutated
  assert.deepEqual(proposals[1].dependsOn, ['a']);
});

test('nextProposalId and addProposal append a unique manual step', () => {
  const proposals = [step('step-1'), step('step-2')];
  assert.equal(nextProposalId(proposals), 'step-3');
  const added = addProposal(proposals, { title: 'Manual', prompt: 'Write it', dependsOn: ['step-1', 'ghost'] });
  assert.equal(added.length, 3);
  assert.equal(added[2].id, 'step-3');
  assert.equal(added[2].title, 'Manual');
  assert.deepEqual(added[2].dependsOn, ['step-1']);
  assert.equal(addProposal([], {})[0].id, 'step-1');
  // a collision-prone id set still resolves
  assert.equal(nextProposalId([step('step-1'), step('step-3')]), 'step-4');
});

test('dependencyLabel names current step numbers, not cached ones', () => {
  const proposals = [step('a'), step('b'), step('c', ['a'])];
  assert.equal(dependencyLabel(proposals[2], proposals), 'after step 1');
  const reordered = [proposals[1], proposals[0], proposals[2]];
  assert.equal(dependencyLabel(proposals[2], reordered), 'after step 2');
  const many = [step('a'), step('b'), step('c'), step('d', ['a', 'c'])];
  assert.equal(dependencyLabel(many[3], many), 'after steps 1 and 3');
  const three = [step('a'), step('b'), step('c'), step('d', ['c', 'a', 'b'])];
  assert.equal(dependencyLabel(three[3], three), 'after steps 1, 2 and 3');
  assert.equal(dependencyLabel(proposals[0], proposals), '');
});

test('stepStatusPresentation covers the frozen vocabulary and keeps retrying in flight', () => {
  assert.deepEqual(stepStatusPresentation('waiting'), { state: 'waiting', label: 'Waiting', tone: 'idle' });
  assert.equal(stepStatusPresentation('queued').tone, 'queued');
  assert.equal(stepStatusPresentation('running').tone, 'running');
  assert.equal(stepStatusPresentation('retrying').tone, 'running');
  assert.equal(stepStatusPresentation('retrying').label, 'Retrying');
  assert.notEqual(stepStatusPresentation('retrying').state, stepStatusPresentation('failed').state);
  assert.equal(stepStatusPresentation('complete').tone, 'success');
  assert.equal(stepStatusPresentation('failed').tone, 'failed');
  assert.equal(stepStatusPresentation('cancelled').tone, 'neutral');
  assert.equal(stepStatusPresentation('blocked').tone, 'warning');
  assert.equal(stepStatusPresentation(undefined).state, 'waiting');
});

test('a step still waiting when the run was stopped reads as not started', () => {
  assert.deepEqual(stepStatusPresentation('waiting', 'stopped'), { state: 'not-started', label: 'Not started', tone: 'neutral' });
  assert.equal(stepStatusPresentation('waiting', 'running').label, 'Waiting');
  // stop is latched, but a step that was already in flight still settles
  assert.equal(stepStatusPresentation('running', 'stopped').label, 'Running');
  assert.equal(stepStatusPresentation('blocked', 'stopped').label, 'Blocked');
});

test('proposalStatus and runStepFor read the run, defaulting to waiting', () => {
  const run = { status: 'running', steps: [{ proposalId: 'a', status: 'running', taskId: 7 }] };
  assert.equal(runStepFor(run, 'a').taskId, 7);
  assert.equal(runStepFor(run, 'b'), null);
  assert.equal(proposalStatus('a', run), 'running');
  assert.equal(proposalStatus('b', run), 'waiting');
  assert.equal(proposalStatus('a', null), 'waiting');
  assert.equal(proposalStatus('a', { status: 'running', steps: [{ proposalId: 'a', status: 'bogus' }] }), 'waiting');
});

test('planRunIsActive and planRunIsLive separate running from stopped', () => {
  assert.equal(planRunIsActive({ status: 'running' }), true);
  assert.equal(planRunIsActive({ status: 'stopped' }), false);
  assert.equal(planRunIsLive({ status: 'stopped' }), true);
  assert.equal(planRunIsLive({ status: 'complete' }), false);
  assert.equal(planRunIsLive(null), false);
});

test('stepEditingLocked locks in-flight steps only', () => {
  const run = (status) => ({ status: 'running', steps: [{ proposalId: 'a', status }] });
  assert.equal(stepEditingLocked('a', run('queued')), true);
  assert.equal(stepEditingLocked('a', run('running')), true);
  assert.equal(stepEditingLocked('a', run('retrying')), true);
  assert.equal(stepEditingLocked('a', run('complete')), true);
  assert.equal(stepEditingLocked('a', run('failed')), false);
  assert.equal(stepEditingLocked('a', run('cancelled')), false);
  assert.equal(stepEditingLocked('a', run('waiting')), false);
  assert.equal(stepEditingLocked('b', run('running')), false);
  assert.equal(stepEditingLocked('a', null), false);
  // a completed step becomes editable again once the run is over
  assert.equal(stepEditingLocked('a', { status: 'complete', steps: [{ proposalId: 'a', status: 'complete' }] }), false);
});

test('blockingSteps and blockedReasonLabel name the failed dependency', () => {
  const proposals = [step('a'), step('b'), step('c', ['a', 'b'])];
  const run = {
    status: 'running',
    steps: [
      { proposalId: 'a', status: 'failed' },
      { proposalId: 'b', status: 'running' },
      { proposalId: 'c', status: 'blocked' },
    ],
  };
  assert.deepEqual(blockingSteps(proposals[2], proposals, run).map((entry) => entry.number), [1, 2]);
  assert.equal(blockedReasonLabel(proposals[2], proposals, run), 'Blocked by failed step 1');
  const cancelled = { status: 'running', steps: [{ proposalId: 'a', status: 'cancelled' }, { proposalId: 'b', status: 'complete' }] };
  assert.equal(blockedReasonLabel(proposals[2], proposals, cancelled), 'Blocked by cancelled step 1');
  const waiting = { status: 'running', steps: [{ proposalId: 'a', status: 'queued' }, { proposalId: 'b', status: 'complete' }] };
  assert.equal(blockedReasonLabel(proposals[2], proposals, waiting), 'Waiting on step 1');
  const done = { status: 'complete', steps: [{ proposalId: 'a', status: 'complete' }, { proposalId: 'b', status: 'complete' }] };
  assert.equal(blockedReasonLabel(proposals[2], proposals, done), '');
});

test('runProgressSummary prefers server counts and reads like the library row', () => {
  const summary = runProgressSummary({
    status: 'running',
    counts: { total: 7, waiting: 2, queued: 1, running: 1, retrying: 0, complete: 3, failed: 1, cancelled: 0, blocked: 0 },
  });
  assert.equal(summary.total, 7);
  assert.equal(summary.label, '3 of 7 steps complete, 1 failed');
  const fallback = runProgressSummary({
    status: 'running',
    steps: [{ status: 'complete' }, { status: 'retrying' }, { status: 'blocked' }],
  });
  assert.equal(fallback.total, 3);
  assert.equal(fallback.label, '1 of 3 steps complete, 1 retrying, 1 blocked');
  assert.equal(runProgressSummary(null).label, '');
});

test('activeWaveIndex points at the first wave with unsettled work', () => {
  const waves = [[step('a')], [step('b')], [step('c')]];
  const run = {
    status: 'running',
    steps: [
      { proposalId: 'a', status: 'complete' },
      { proposalId: 'b', status: 'running' },
      { proposalId: 'c', status: 'waiting' },
    ],
  };
  assert.equal(activeWaveIndex(waves, run), 1);
  const finished = { status: 'complete', steps: [{ proposalId: 'a', status: 'complete' }, { proposalId: 'b', status: 'complete' }, { proposalId: 'c', status: 'cancelled' }] };
  assert.equal(activeWaveIndex(waves, finished), -1);
});

test('runAnnouncement is one calm sentence and empty without a run', () => {
  const waves = [[step('a')], [step('b')]];
  const run = {
    status: 'running',
    counts: { total: 2, complete: 1 },
    steps: [{ proposalId: 'a', status: 'complete' }, { proposalId: 'b', status: 'running' }],
  };
  assert.equal(runAnnouncement(waves, run), 'Wave 2 of 2. Plan run in progress. 1 of 2 steps complete.');
  assert.equal(runAnnouncement(waves, { status: 'stopped', counts: { total: 2, complete: 1 }, steps: [] }), 'Plan run stopped. 1 of 2 steps complete.');
  assert.equal(runAnnouncement(waves, null), '');
});

test('runStatusPresentation covers every run status', () => {
  assert.equal(runStatusPresentation({ status: 'running' }).tone, 'running');
  assert.equal(runStatusPresentation({ status: 'stopped' }).tone, 'neutral');
  assert.equal(runStatusPresentation({ status: 'failed' }).tone, 'failed');
  assert.equal(runStatusPresentation({ status: 'complete' }).tone, 'success');
  assert.equal(runStatusPresentation(null).state, 'idle');
});

test('plannerBoardSignature changes on structure but not on step status or text', () => {
  const proposals = [step('a'), step('b', ['a'])];
  const run = { id: 4, status: 'running', steps: [{ proposalId: 'a', status: 'running' }, { proposalId: 'b', status: 'waiting' }] };
  const base = plannerBoardSignature(proposals, run, { attemptId: 9, capable: true });
  const advanced = { ...run, steps: [{ proposalId: 'a', status: 'complete' }, { proposalId: 'b', status: 'running' }] };
  assert.equal(plannerBoardSignature(proposals, advanced, { attemptId: 9, capable: true }), base);
  const retitled = [{ ...proposals[0], title: 'Renamed' }, proposals[1]];
  assert.equal(plannerBoardSignature(retitled, run, { attemptId: 9, capable: true }), base);
  const reordered = [proposals[1], proposals[0]];
  assert.notEqual(plannerBoardSignature(reordered, run, { attemptId: 9, capable: true }), base);
  const rewired = [proposals[0], { ...proposals[1], dependsOn: [] }];
  assert.notEqual(plannerBoardSignature(rewired, run, { attemptId: 9, capable: true }), base);
  assert.notEqual(plannerBoardSignature(proposals, run, { attemptId: 10, capable: true }), base);
  assert.notEqual(plannerBoardSignature(proposals, run, { attemptId: 9, capable: false }), base);
  assert.notEqual(plannerBoardSignature(proposals, { ...run, status: 'stopped' }, { attemptId: 9, capable: true }), base);
  assert.notEqual(plannerBoardSignature(proposals, null, { attemptId: 9, capable: true }), base);
});

test('shouldAdoptServerProposals never clobbers unsaved edits, but takes a new attempt', () => {
  assert.equal(shouldAdoptServerProposals({ hasDirtyEdits: false, saveInFlight: false, localAttemptId: 3, serverAttemptId: 3 }), true);
  assert.equal(shouldAdoptServerProposals({ hasDirtyEdits: true, saveInFlight: false, localAttemptId: 3, serverAttemptId: 3 }), false);
  assert.equal(shouldAdoptServerProposals({ hasDirtyEdits: false, saveInFlight: true, localAttemptId: 3, serverAttemptId: 3 }), false);
  // a refinement landing replaces the list even mid-edit: the user was told
  // their current steps were sent up for revision
  assert.equal(shouldAdoptServerProposals({ hasDirtyEdits: true, saveInFlight: true, localAttemptId: 3, serverAttemptId: 4 }), true);
  assert.equal(shouldAdoptServerProposals({ hasDirtyEdits: true, localAttemptId: null, serverAttemptId: 4 }), false);
  assert.equal(shouldAdoptServerProposals({}), true);
});

test('canRunPlan needs a session and a selection, and refuses while running', () => {
  assert.equal(canRunPlan({ hasSession: true, selectedCount: 3 }), true);
  assert.equal(canRunPlan({ hasSession: false, selectedCount: 3 }), false);
  assert.equal(canRunPlan({ hasSession: true, selectedCount: 0 }), false);
  assert.equal(canRunPlan({ hasSession: true, selectedCount: 3, busy: true }), false);
  assert.equal(canRunPlan({ hasSession: true, selectedCount: 3, run: { status: 'running' } }), false);
  assert.equal(canRunPlan({ hasSession: true, selectedCount: 3, run: { status: 'stopped' } }), true);
  assert.equal(canRunPlan({ hasSession: true, selectedCount: 3, run: { status: 'complete' } }), true);
});

test('breakdownNoteLabel explains why a dependency vanished', () => {
  const proposals = [step('a'), step('b')];
  assert.match(breakdownNoteLabel({ code: 'unknown-dependency', proposalId: 'b' }, proposals), /^Step 2 referenced a dependency/);
  assert.match(breakdownNoteLabel({ code: 'self-dependency', proposalId: 'a' }, proposals), /^Step 1 depended on itself/);
  assert.match(breakdownNoteLabel({ code: 'cycle-dropped', proposalId: 'b' }, proposals), /dependency cycle/);
  assert.match(breakdownNoteLabel({ code: 'cycle-dropped', proposalId: 'ghost' }, proposals), /^A step formed/);
  assert.equal(breakdownNoteLabel({ code: 'future-code', message: 'Something else' }, proposals), 'Something else');
  assert.equal(breakdownNoteLabel(null, proposals), '');
});

// ----- Planner v2 surface wiring -----

test('run progress is announced through one dedicated live region, not the whole detail panel', () => {
  assert.match(html, /id="planner-run-announce"[^>]*role="status"[^>]*aria-live="polite"/);
  const detail = html.match(/<div id="planner-detail"[^>]*>/);
  assert.ok(detail, 'the planner detail container exists');
  // A container rebuilt on every structural change must not be a live region:
  // it would announce the entire dialog on each poll.
  assert.doesNotMatch(detail[0], /aria-live/);
});

test('the planner modal stays outside the task form and off the protected council classes', () => {
  const taskFormStart = html.indexOf('<form id="task-form">');
  const taskFormEnd = html.indexOf('</form>', taskFormStart);
  const plannerModal = html.indexOf('id="planner-modal"');
  assert.ok(plannerModal > taskFormEnd, 'the Planner modal is a sibling outside #task-form');
  const modalSlice = html.slice(plannerModal, html.indexOf('</dialog>', plannerModal));
  assert.equal((modalSlice.match(/<form\b/g) || []).length, 0);
  for (const protectedClass of ['plan-council-option', 'council-route', 'council-node ', 'council-connector']) {
    assert.ok(!modalSlice.includes(protectedClass), `the Planner avoids ${protectedClass}`);
  }
});

test('the board calls the frozen v2 routes and always sends dependsOn', () => {
  assert.match(app, /\/api\/plans\/\$\{plan\.id\}\/run`/);
  assert.match(app, /\/api\/plans\/\$\{plan\.id\}\/run\/stop`/);
  assert.match(app, /\/api\/plans\/\$\{plan\.id\}\/breakdown\/refine`/);
  const persist = functionBody(app, 'persistProposals');
  assert.match(persist, /dependsOn: dependencyIds\(proposal\)/);
  assert.match(persist, /method: 'PATCH'/);
  const run = functionBody(app, 'startPlanRun');
  assert.match(run, /proposalIds: chosen\.map/);
  assert.match(run, /\.\.\.terminalRequest/);
  assert.match(run, /preferIdleTerminal: !usesDisposableTerminalPools\(\) && state\.planner\.runPreferIdle/);
});

test('nothing executes without the user starting the run', () => {
  const run = functionBody(app, 'startPlanRun');
  // The only call site of POST /run is this handler, which is reachable only
  // from the Run plan button.
  assert.equal((app.match(/\/run`, \{/g) || []).length, 1);
  assert.match(run, /if \(!plan \|\| state\.planner\.busy\) return;/);
  assert.match(app, /id="planner-run-start"/);
});

test('the background refresh never clobbers unsaved edits and rebuilds only on a structure change', () => {
  const refresh = functionBody(app, 'refreshPlannerFromServer');
  assert.match(refresh, /shouldAdoptServerProposals\(\{/);
  assert.match(refresh, /hasDirtyEdits: state\.planner\.dirtyProposalIds\.size > 0/);
  assert.match(refresh, /saveInFlight: state\.planner\.saveInFlight/);
  assert.match(refresh, /applyPlannerPlan\(body\.plan, \{ adoptProposals \}\)/);
  assert.match(refresh, /if \(signature !== state\.planner\.boardSignature\) renderPlannerBoard\(\);/);
  assert.match(refresh, /else updatePlannerRunProgress\(\);/);
});

test('the live update is targeted and never replaces the board markup', () => {
  const update = functionBody(app, 'updatePlannerRunProgress');
  assert.doesNotMatch(update, /container\.innerHTML/);
  assert.doesNotMatch(update, /plannerDetail\.innerHTML/);
  // Only the small state port is rewritten, and only when the status changed.
  assert.match(update, /if \(node\.dataset\.state !== status\)/);
  assert.match(update, /port\.innerHTML/);
});

test('the poll follows an active breakdown or an active run', () => {
  const needs = functionBody(app, 'plannerNeedsPoll');
  assert.match(needs, /breakdownIsActive\(state\.planner\.breakdown\)/);
  assert.match(needs, /planRunIsActive\(state\.planner\.run\)/);
});

test('removing a step drops every reference to it before persisting', () => {
  assert.match(app, /pruneDanglingDependencies\(removeProposal\(state\.planner\.proposals, id\)\)/);
});

test('a failed step exposes its error and a way into Task Activity', () => {
  const update = functionBody(app, 'updatePlannerRunProgress');
  assert.match(update, /plannerStepErrorExcerpt\(step\)/);
  assert.match(update, /Open task #\$\{taskId\} in Task Activity`/);
  assert.match(update, /const label = taskId \? `Open task #\$\{taskId\}` : '';/);
  assert.match(app, /const open = event\.target\.closest\('\.planner-step-open'\);/);
  assert.match(app, /selectTask\(taskId\)/);
});

test('a blocked step names the step that blocks it', () => {
  const update = functionBody(app, 'updatePlannerRunProgress');
  assert.match(update, /blockedReasonLabel\(proposal, proposals, run\)/);
});

test('parse notes are rendered so a pruned dependency is explained', () => {
  const board = functionBody(app, 'renderPlannerBoard');
  assert.match(board, /breakdownNoteLabel\(note, proposals\)/);
  assert.match(board, /class="planner-notes"/);
});

test('refine is labeled as sending the current edited steps and flushes them first', () => {
  const refine = functionBody(app, 'refineBreakdown');
  assert.match(refine, /await flushProposalEdits\(\);/);
  assert.match(app, /Refine sends your current edited steps for revision/);
});

test('an older backend keeps v1 queueing and gets the standing Restart Relay convention', () => {
  assert.match(app, /plannerV2Capable\(state\.status\)/);
  assert.match(app, /Restart Relay to run this plan wave by wave/);
  // v1 behavior is preserved, not replaced
  assert.match(app, /function queueSelectedProposals\(/);
  assert.match(app, /id="planner-queue-selected"/);
});

test('editing is disabled for steps the run already owns', () => {
  const stepMarkup = functionBody(app, 'renderPlannerStep');
  assert.match(stepMarkup, /const locked = readOnly \|\| stepEditingLocked\(proposal\.id, run\);/);
  assert.match(stepMarkup, /const readonly = locked \? ' readonly' : '';/);
  assert.match(stepMarkup, /data-locked="\$\{locked \? 'true' : 'false'\}"/);
});

test('the board styles state through outline, port, and chip rather than color alone', () => {
  assert.match(css, /\.planner-step-port\[data-state="complete"\]/);
  assert.match(css, /\.planner-step-chip\[data-state="retrying"\]/);
  assert.match(css, /\.planner-wave\[data-active="true"\]/);
  // running stays purple and orange is never borrowed for a run state
  assert.match(css, /\.planner-step-chip\[data-tone="running"\] \{ background: var\(--running-soft\); color: var\(--running\); \}/);
});

test('planner motion respects prefers-reduced-motion', () => {
  const block = css.slice(css.lastIndexOf('@media (prefers-reduced-motion: reduce)'));
  assert.match(block, /\.planner-step-spinner \{ animation: none; \}/);
});

test('runProgressSummary measures a partial run against its own steps, not the plan', () => {
  // A run started from 3 of 7 proposals must reach 100 percent at 3 complete.
  const partial = runProgressSummary({
    status: 'running',
    counts: { total: 7, complete: 3 },
    steps: [{ status: 'complete' }, { status: 'complete' }, { status: 'complete' }],
  });
  assert.equal(partial.total, 3);
  assert.equal(partial.label, '3 of 3 steps complete');
  // The plan library summary carries counts without steps and still reads right.
  const summaryOnly = runProgressSummary({ status: 'running', counts: { total: 7, complete: 3, failed: 1 } });
  assert.equal(summaryOnly.total, 7);
  assert.equal(summaryOnly.label, '3 of 7 steps complete, 1 failed');
});

test('a new run is refused while the previous run is still draining', () => {
  const drained = { status: 'stopped', steps: [{ proposalId: 'a', status: 'complete' }, { proposalId: 'b', status: 'failed' }] };
  const draining = { status: 'stopped', steps: [{ proposalId: 'a', status: 'complete' }, { proposalId: 'b', status: 'running' }] };
  assert.equal(drainingSteps(draining).length, 1);
  assert.equal(drainingSteps(drained).length, 0);
  assert.equal(runStartBlockReason(drained), '');
  assert.match(runStartBlockReason(draining), /^Waiting for 1 step from the previous run/);
  assert.equal(runStartBlockReason({ status: 'running', steps: [] }), 'A plan run is already in progress.');
  assert.equal(runStartBlockReason(null), '');
  assert.equal(canRunPlan({ hasSession: true, selectedCount: 2, run: draining }), false);
  assert.equal(canRunPlan({ hasSession: true, selectedCount: 2, run: drained }), true);
  // retrying is in flight too and must block, since it will mint no new task id
  assert.equal(canRunPlan({ hasSession: true, selectedCount: 2, run: { status: 'failed', steps: [{ status: 'retrying' }] } }), false);
  // the plan library summary carries only counts, and must reach the same answer
  assert.equal(drainingStepCount({ status: 'stopped', counts: { queued: 1, running: 2, retrying: 1, complete: 4 } }), 4);
  assert.equal(drainingStepCount({ status: 'complete', counts: { queued: 0, running: 0, retrying: 0, complete: 4 } }), 0);
  assert.equal(drainingStepCount(null), 0);
  assert.match(runStartBlockReason({ status: 'stopped', counts: { running: 2 } }), /^Waiting for 2 steps/);
});

test('defaultRunSelection never re-selects completed work or re-checks an unchecked step', () => {
  const proposals = [step('a'), step('b'), step('c')];
  // first adoption: everything selected
  assert.deepEqual([...defaultRunSelection(proposals, null, new Set(), { knownIds: [] })], ['a', 'b', 'c']);
  // a completed step is never auto-selected again
  const run = { status: 'complete', steps: [{ proposalId: 'a', status: 'complete' }, { proposalId: 'b', status: 'failed' }] };
  assert.deepEqual([...defaultRunSelection(proposals, run, new Set(), { knownIds: [] })], ['b', 'c']);
  // a surviving step the user unchecked stays unchecked across a refinement
  const refined = [step('a'), step('b'), step('d')];
  const kept = defaultRunSelection(refined, null, new Set(['a']), { knownIds: ['a', 'b', 'c'] });
  assert.deepEqual([...kept], ['a', 'd']);
  assert.equal(kept.has('b'), false, 'b was known and unchecked, so it stays unchecked');
  assert.equal(kept.has('d'), true, 'd is new, so it starts selected');
});

test('refining is not blocked by a live run, because stop is a one-way door', () => {
  const refineMarkup = functionBody(app, 'renderPlannerRefine');
  assert.doesNotMatch(refineMarkup, /planRunIsActive/);
  assert.match(refineMarkup, /A breakdown attempt is already running\./);
});

test('the run button explains a draining previous run instead of relying on a 409', () => {
  const button = functionBody(app, 'updatePlannerRunButton');
  assert.match(button, /runStartBlockReason\(state\.planner\.run\)/);
  assert.match(button, /Previous run draining/);
  // the reason is readable text, not only a tooltip on a disabled control
  assert.match(button, /#planner-run-blocked/);
  assert.match(app, /id="planner-run-blocked"/);
});

// ----- Review mitigations: C1, C2, C3, S2, S4 -----

/**
 * C1 regression. The live sequence is POST -> adopt the new PENDING attempt
 * (proposals: []) -> poll -> adopt the same attempt once COMPLETE. The reseed
 * must land on the completed proposals. Reseeding against the pending attempt
 * latches the marker and leaves the selection empty forever.
 */
test('a breakdown or refinement reseeds the selection on the COMPLETE attempt, not the pending one', () => {
  // A tiny model of applyPlannerPlan's selection branch, mirroring app.js.
  const planner = { proposals: [step('a'), step('b')], selection: new Set(['a', 'b']), selectionAttemptId: 41, run: null };
  const adopt = (breakdown) => {
    const incoming = Array.isArray(breakdown.proposals) ? breakdown.proposals : [];
    if (incoming.length === 0 && breakdown.status !== 'complete' && planner.proposals.length > 0) return;
    const previousIds = planner.proposals.map((proposal) => proposal.id);
    const previousSelection = planner.selection;
    planner.proposals = incoming;
    if (breakdown.status === 'complete' && planner.selectionAttemptId !== breakdown.id) {
      planner.selection = defaultRunSelection(planner.proposals, planner.run, previousSelection, { knownIds: previousIds });
      planner.selectionAttemptId = breakdown.id;
    }
  };

  // the POST response: a brand new attempt, pending, with no proposals yet
  adopt({ id: 42, status: 'pending', proposals: [] });
  assert.deepEqual(planner.proposals.map((p) => p.id), ['a', 'b'], 'the previous steps stay on the board');
  assert.notEqual(planner.selectionAttemptId, 42, 'a pending attempt must not latch the marker');

  // the poll: the same attempt, now complete, with its refined steps
  adopt({ id: 42, status: 'complete', proposals: [step('a'), step('c')] });
  assert.equal(planner.selectionAttemptId, 42);
  assert.deepEqual([...planner.selection], ['a', 'c'], 'the reseed lands on the completed proposals');
});

test('C1 wiring: only a complete attempt latches the selection marker', () => {
  const apply = functionBody(app, 'applyPlannerPlan');
  assert.match(apply, /breakdown\?\.status === 'complete' && state\.planner\.selectionAttemptId !== attemptId/);
  // and a pending attempt with no proposals never replaces the visible steps
  assert.match(apply, /incoming\.length === 0 && breakdown\?\.status !== 'complete' && state\.planner\.proposals\.length > 0/);
});

test('C3 wiring: a pending attempt keeps the board, the run bar, and Stop mounted', () => {
  const board = functionBody(app, 'renderPlannerBoard');
  // the run bar is mounted whenever a run exists, not only when proposals are
  assert.match(board, /if \(proposals\.length > 0 \|\| state\.planner\.run\) \{/);
  assert.match(board, /planner-attempt-banner/);
  assert.match(board, /renderPlannerAttemptRecovery\(breakdown\)/);
  // Stop lives inside the run bar, so mounting the bar is what preserves it
  const bar = functionBody(app, 'renderPlannerRunBar');
  assert.match(bar, /id="planner-run-stop"/);
  assert.match(app, /function renderPlannerAttemptRecovery\(/);
  assert.match(app, /Open breakdown task #/);
});

test('C3 wiring: the board is read-only exactly when the server would reject a PATCH', () => {
  const editable = functionBody(app, 'plannerProposalsEditable');
  assert.match(editable, /state\.planner\.breakdown\?\.status === 'complete'/);
  const stepMarkup = functionBody(app, 'renderPlannerStep');
  assert.match(stepMarkup, /const locked = readOnly \|\| stepEditingLocked\(proposal\.id, run\);/);
  // the poll must apply the same rule or it silently unlocks the board
  const update = functionBody(app, 'updatePlannerRunProgress');
  assert.match(update, /const readOnly = !plannerProposalsEditable\(\);/);
  assert.match(update, /const locked = readOnly \|\| stepEditingLocked\(id, run\);/);
});

test('the board signature separates a pending attempt from the same attempt completing', () => {
  const proposals = [step('a')];
  const pending = plannerBoardSignature(proposals, null, { attemptId: 42, attemptStatus: 'pending', capable: true });
  const complete = plannerBoardSignature(proposals, null, { attemptId: 42, attemptStatus: 'complete', capable: true });
  assert.notEqual(pending, complete, 'the same attempt id in a new status must rebuild the board');
});

test('C2: the parallel batch checkbox is offered only for legacy direct execute tasks', () => {
  const render = functionBody(app, 'renderTasks');
  assert.match(render, /const batchable = queued\s+&& \(task\.mode \|\| 'execute'\) === 'execute'\s+&& task\.terminal_lifecycle !== 'disposable';/);
  assert.match(render, /\$\{batchable \? `<input class="parallel-task-check"/);
  // the selection is pruned against the narrower batchable set, so a stale
  // non-execute or disposable id cannot survive in state.parallelTaskIds
  assert.match(render, /state\.parallelTaskIds = new Set\(\[\.\.\.state\.parallelTaskIds\]\.filter\(\(id\) => batchableIds\.includes\(id\)\)\);/);
  assert.match(render, /task\.status === 'queued'\s+&& \(task\.mode \|\| 'execute'\) === 'execute'\s+&& task\.terminal_lifecycle !== 'disposable'/);
});

test('S2: runnableSelection drops steps the latest run has since completed', () => {
  const proposals = [step('a'), step('b'), step('c')];
  const run = {
    status: 'running',
    steps: [{ proposalId: 'a', status: 'complete' }, { proposalId: 'b', status: 'running' }],
  };
  const { runnable, dropped } = runnableSelection(proposals, new Set(['a', 'b', 'c']), run);
  assert.deepEqual(runnable.map((p) => p.id), ['b', 'c']);
  assert.deepEqual(dropped.map((p) => p.id), ['a']);
  // no run means nothing is stale
  assert.equal(runnableSelection(proposals, new Set(['a', 'b']), null).dropped.length, 0);
  // order follows the board, not the selection set
  assert.deepEqual(runnableSelection(proposals, ['c', 'b'], null).runnable.map((p) => p.id), ['b', 'c']);
});

test('S2 wiring: Run plan re-validates consent at press time', () => {
  const run = functionBody(app, 'startPlanRun');
  assert.match(run, /runnableSelection\(\s*state\.planner\.proposals,\s*state\.planner\.selection,\s*state\.planner\.run,\s*\)/);
  assert.match(run, /for \(const proposal of dropped\) state\.planner\.selection\.delete\(proposal\.id\);/);
  assert.match(run, /Every selected step was already completed by the current run/);
});

test('S4: a failed edit flush aborts refine instead of seeding stale steps', () => {
  const flush = functionBody(app, 'flushProposalEdits');
  assert.match(flush, /const saved = await persistProposals\(\);/);
  assert.match(flush, /if \(!saved\) throw new Error\(/);
  const persist = functionBody(app, 'persistProposals');
  assert.match(persist, /return true;/);
  assert.match(persist, /return false;/);
  // refine awaits the flush, so the throw aborts it before the POST
  const refine = functionBody(app, 'refineBreakdown');
  assert.match(refine, /await flushProposalEdits\(\);/);
  assert.match(refine, /catch \(error\) \{\s*setPlannerMessage\(error\.message\);/);
});
