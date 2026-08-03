import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const server = readFileSync(new URL('../src/server.mjs', import.meta.url), 'utf8');
const planRun = readFileSync(new URL('../src/plan-run.mjs', import.meta.url), 'utf8');

test('the server advertises the planner capability', () => {
  assert.match(server, /planner: true/);
});

test('the server exposes project-scoped plan CRUD and breakdown routes', () => {
  assert.match(server, /pathname === '\/api\/plans'/);
  assert.match(server, /\/\^\\\/api\\\/plans\\\/\(\\d\+\)\$\//);
  assert.match(server, /\/\^\\\/api\\\/plans\\\/\(\\d\+\)\\\/breakdown\$\//);
  assert.match(server, /\/\^\\\/api\\\/plans\\\/\(\\d\+\)\\\/breakdown\\\/queue\$\//);
  // 404 unknown ids
  assert.match(server, /sendError\(response, 404, 'Plan not found\.'\)/);
});

test('the breakdown runs through the existing queue as mode breakdown and never auto-creates tasks', () => {
  assert.match(server, /mode: 'breakdown'/);
  assert.match(server, /buildBreakdownPrompt\(\{ plan, guidance \}\)/);
  assert.match(server, /breakdownUpdateForTask\(task, breakdown, \{ knownIds/);
  // proposals are queued as ordinary execute tasks only on explicit user action
  assert.match(server, /planBreakdownQueueMatch/);
  assert.match(server, /mode: 'execute'/);
});

test('a breakdown in progress is guarded against a second concurrent run', () => {
  assert.match(server, /already has a breakdown in progress/);
});

test('the in-progress guard covers the automatic-retry window (Finding 23)', () => {
  assert.match(server, /planBreakdownInProgress\(database\.latestPlanBreakdown\(planId\)\)/);
  assert.match(server, /queue\.pendingRetryTaskIds\(\)\.has\(breakdown\.task_id\)/);
  assert.match(server, /breakdownInProgress\(breakdown, \{ retryScheduled, taskStatus/);
});

test('both breakdown routes re-check the in-progress guard next to the write', () => {
  // The early check runs before awaiting the body and terminal resolution, so two overlapping
  // submissions can both clear it. The guard runs again immediately before the create.
  assert.ok((server.match(/requireNoBreakdownInProgress\(plan\.id\);/g) || []).length >= 4);
  const breakdownRoute = server.indexOf("const breakdown = database.createPlanBreakdown({");
  const guardBefore = server.lastIndexOf('requireNoBreakdownInProgress(plan.id);', breakdownRoute);
  const sessionBefore = server.lastIndexOf('await resolvePlannerTaskSession(', breakdownRoute);
  assert.ok(guardBefore > sessionBefore, 'the guard runs after the last await, next to the write');
});

test('a deleted breakdown task never locks the plan out of the Planner (C2)', () => {
  assert.match(server, /breakdownUpdateForDeletedTask\(breakdown\)/);
  // A breakdown or disposable task must not be swept into a legacy parallel Codex batch.
  assert.match(server, /Only legacy direct Execute tasks assigned to a live terminal can be bundled\./);
  assert.match(server, /task\.mode !== 'execute' \|\| task\.terminal_lifecycle === 'disposable'/);
});

test('proposal edits are rejected unless the breakdown is complete (Finding 22)', () => {
  assert.match(server, /breakdown\.status !== 'complete'/);
  assert.match(server, /sendError\(response, 409, 'Proposals can only be edited after the breakdown completes\.'\)/);
});

test('proposal ids are de-duplicated server-side (Finding 25)', () => {
  // sanitizeProposalGraph runs ensureUniqueProposalIds first, then prunes dangling
  // dependsOn against the surviving ids, then breaks any cycle the edit introduced.
  assert.match(server, /sanitizeProposalGraph\(mapped\)/);
});

test('the server advertises the planner v2 capability', () => {
  assert.match(server, /plannerV2: true/);
});

test('the server exposes the plan run and refine routes', () => {
  assert.match(server, /\/\^\\\/api\\\/plans\\\/\(\\d\+\)\\\/breakdown\\\/refine\$\//);
  assert.match(server, /\/\^\\\/api\\\/plans\\\/\(\\d\+\)\\\/run\$\//);
  assert.match(server, /\/\^\\\/api\\\/plans\\\/\(\\d\+\)\\\/run\\\/stop\$\//);
});

test('starting a second run on one plan is a 409 conflict', () => {
  assert.match(server, /sendError\(response, 409, startConflict\)/);
  assert.match(server, /sendError\(response, 409, 'There is no active plan run to stop\.'\)/);
});

test('the run conflict guard is re-checked inside start, not only in the route (C4)', () => {
  // The route awaits the body, the live session, and the model list before it starts, so two
  // overlapping submissions can both clear its early check. The invariant defends itself.
  assert.match(server, /planRuns\.startConflict\(plan\.id\)/);
  assert.match(planRun, /startConflict\(planId\)/);
  assert.match(planRun, /const conflict = this\.startConflict\(plan\.id\);/);
  assert.match(planRun, /statusCode: 409/);
  // The latch only runs after the conflict check passes.
  const check = planRun.indexOf('const conflict = this.startConflict(plan.id);');
  const latch = planRun.indexOf('for (const previous of this.database.planRunsForPlan(plan.id))');
  assert.ok(check >= 0 && latch > check, 'a refused start never latches the previous run');
});

test('a status code carried on an error reaches the client', () => {
  assert.match(server, /error\.statusCode \|\| 422/);
});

test('every plan route re-validates either its automatic project or legacy live session', () => {
  assert.match(server, /async function resolvePlannerTaskSession\(plan, provider, body\)/);
  assert.match(server, /The automatic terminal must use the same project as the plan\./);
  assert.match(server, /async function requirePlanSession\(plan, provider, threadId\)/);
  assert.match(server, /The selected session must be open in the same project as the plan\./);
  // Breakdown, refine, queue, and run all go through the lifecycle-aware validator.
  assert.ok((server.match(/await resolvePlannerTaskSession\(/g) || []).length >= 4);
  // The legacy branch of that validator still goes through the live-session check.
  assert.match(server, /const thread = await requirePlanSession\(plan, provider, threadId\);/);
});

test('plan runs reconcile from the queue change signal, not from a second scheduler', () => {
  assert.match(server, /new PlanRunCoordinator\(\{ database, queue, diagnostic \}\)/);
  assert.match(server, /planRuns\.reconcileForTask\(change\.taskId\)/);
});

test('plan runs are repaired after queue recovery on boot', () => {
  const startIndex = server.indexOf('queue.start();');
  const reconcileIndex = server.indexOf('planRuns.reconcileAll();');
  assert.ok(startIndex >= 0 && reconcileIndex > startIndex, 'reconcileAll runs after queue.start');
});

test('deleting a plan stops its run instead of orphaning queued steps', () => {
  assert.match(server, /planRuns\.release\(plan\.id\)/);
});

test('a refinement revises the current proposals rather than restarting', () => {
  assert.match(server, /buildRefinementPrompt\(\{/);
  assert.match(server, /proposals: current\.proposals/);
  assert.match(server, /Run a breakdown with at least one task before refining it\./);
  // A refinement goes through the same in-progress guard as a first breakdown.
  const refineRoute = server.indexOf('planBreakdownRefineMatch) {');
  const refineEnd = server.indexOf('sendJson(response, 201', refineRoute);
  const refineSlice = server.slice(refineRoute, refineEnd);
  assert.equal((refineSlice.match(/requireNoBreakdownInProgress\(plan\.id\);/g) || []).length, 2);
});

test('the Planner entry point lives outside the task form and reuses the modal pattern', () => {
  const plannerButton = html.indexOf('id="planner-button"');
  const taskFormStart = html.indexOf('<form id="task-form">');
  const taskFormEnd = html.indexOf('</form>', taskFormStart);
  const plannerModal = html.indexOf('id="planner-modal"');
  assert.ok(plannerButton >= 0 && plannerButton < taskFormStart, 'the Planner button precedes the task form');
  assert.ok(plannerModal > taskFormEnd, 'the Planner modal is a sibling outside #task-form');
  assert.match(html, /id="planner-modal"[^>]*class="terminal-settings-modal planner-modal"/);
  assert.match(html, /<div class="terminal-settings-card planner-card">/);
  // no nested <form> inside the Planner modal
  const modalSlice = html.slice(plannerModal, html.indexOf('</dialog>', plannerModal));
  assert.equal((modalSlice.match(/<form\b/g) || []).length, 0);
});

test('the Planner does not reuse the protected Plan council component classes', () => {
  const plannerModal = html.indexOf('id="planner-modal"');
  const modalSlice = html.slice(plannerModal, html.indexOf('</dialog>', plannerModal));
  assert.doesNotMatch(modalSlice, /plan-council-option/);
  assert.doesNotMatch(modalSlice, /council-route/);
  assert.doesNotMatch(modalSlice, /council-node /);
  assert.doesNotMatch(modalSlice, /council-connector/);
});

test('the Planner degrades gracefully when the backend lacks the capability', () => {
  assert.match(app, /plannerCapable\(state\.status\)/);
  assert.match(app, /Restart CC Relay to use the Planner/);
});

test('the Planner reviews proposals before queueing them (no auto-execute)', () => {
  assert.match(app, /function queueSelectedProposals\(/);
  assert.match(app, /\/breakdown\/queue`/);
  assert.match(app, /selectedProposals\(state\.planner\.proposals, state\.planner\.selection\)/);
});
