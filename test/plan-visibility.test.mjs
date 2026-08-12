import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { escapeHtml } from '../public/escape-html.js';
import {
  entryFirstEvent,
  entryItem,
  entryLastEvent,
  goalEntryDetails,
  groupEventEntries,
  isGoalEntry,
  isPlanEntry,
  isPlanToolItem,
  planEntryDetails,
} from '../public/event-stream.js';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const style = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');

/*
 * `public/app.js` reads `document` at module scope and the repo has no DOM harness, so the
 * plan and goal renderer cannot be imported. Lifting the exact shipped source with
 * `new Function` (the pattern in test/session-tasks-ui.test.mjs and test/planner-board.test.mjs)
 * is the only way to run the real markup: asserting that a class name merely appears in the
 * file would pass just as happily against a checklist that escapes nothing.
 */
function sourceBetween(start, end) {
  const from = app.indexOf(start);
  assert.notEqual(from, -1, `${start} should exist`);
  const to = app.indexOf(end, from);
  assert.notEqual(to, -1, `${end} should follow ${start}`);
  return app.slice(from, to);
}

function functionBody(signature) {
  const from = app.indexOf(signature);
  assert.notEqual(from, -1, `${signature} should exist`);
  const to = app.indexOf('\n}', from);
  assert.notEqual(to, -1, `${signature} should close`);
  return app.slice(from, to);
}

function liftPlanModule() {
  const source = sourceBetween('const PLAN_STEP_GLYPHS = {', '// Presentation for one sub-agent run.');
  const build = new Function(
    'escapeHtml',
    'planEntryDetails',
    'goalEntryDetails',
    `${source}\nreturn {
      planStepStatus,
      planChecklistMarkup,
      planCopyLines,
      planViewSteps,
      clampText,
      isTurnEnded,
      goalTimeLabel,
      goalMetaParts,
      goalMetaMarkup,
      goalCopyLines,
      planPresentation,
      goalPresentation,
      PLAN_PARTIAL_HINT,
      PLAN_PARTIAL_NOTE,
      PLAN_STEP_LIMIT,
      PLAN_STEP_TEXT_LIMIT,
      PLAN_EXPLANATION_LIMIT,
      GOAL_OBJECTIVE_LIMIT,
      ROW_TITLE_LIMIT,
    };`,
  );
  return build(escapeHtml, planEntryDetails, goalEntryDetails);
}

const toolResultText = new Function(`${functionBody('function toolResultText(result) {')}\n}\nreturn toolResultText;`)();

/*
 * The connected-tool branch of eventPresentation, lifted the same way, so the quiet reading
 * of Claude board bookkeeping is exercised as shipped rather than asserted about by regex.
 * Only the markup helpers around it are stubbed.
 */
function liftToolPresentation() {
  const source = sourceBetween("  if (item?.type === 'mcpToolCall') {", "  if (item?.type === 'webSearch') {");
  const build = new Function(
    'escapeHtml',
    'isPlanToolItem',
    'toolResultText',
    'eventOutputMarkup',
    'eventStatusLabel',
    `return function toolPresentation(entry, item, common) {\n${source}\n  return null;\n};`,
  );
  return build(
    escapeHtml,
    isPlanToolItem,
    toolResultText,
    (text, { label } = {}) => (text ? `<pre data-label="${escapeHtml(label)}">${escapeHtml(text)}</pre>` : ''),
    () => 'completed',
  );
}

function liftEntryRenderer() {
  const source = sourceBetween("  if (p.kind === 'plan') {", '  const inline = p.inline ?');
  return new Function('escapeHtml', `return function renderPlanOrGoal(p, time) {\n${source}\n  return '';\n};`)(escapeHtml);
}

function liftCopyText(plan, toolPresentation) {
  const providerLabel = new Function(`${functionBody('function providerLabel(provider) {')}\n}\nreturn providerLabel;`)();
  const formatEventTime = new Function(`${functionBody('function formatEventTime(value) {')}\n}\nreturn formatEventTime;`)();
  // The copy log reads the same presentation the row does, so a turn-ended task copies the
  // same reading it renders.
  const eventPresentation = (entry, task) => {
    const turnEnded = plan.isTurnEnded(task);
    return plan.planPresentation(entry, {}, { turnEnded })
      || plan.goalPresentation(entry, {}, { turnEnded })
      || toolPresentation(entry, entryItem(entry), {})
      || {};
  };
  const build = new Function(
    'entryFirstEvent',
    'entryItem',
    'entryLastEvent',
    'eventPresentation',
    'formatEventTime',
    'providerLabel',
    'isSubAgentEntry',
    'isPlanEntry',
    'isGoalEntry',
    'isTurnEnded',
    'planEntryDetails',
    'goalEntryDetails',
    'planCopyLines',
    'goalCopyLines',
    'toolResultText',
    `${functionBody('function eventCopyText(entry, task) {')}\n}\nreturn eventCopyText;`,
  );
  return build(
    entryFirstEvent,
    entryItem,
    entryLastEvent,
    eventPresentation,
    formatEventTime,
    providerLabel,
    () => false,
    isPlanEntry,
    isGoalEntry,
    plan.isTurnEnded,
    planEntryDetails,
    goalEntryDetails,
    plan.planCopyLines,
    plan.goalCopyLines,
    toolResultText,
  );
}

const plan = liftPlanModule();
const renderPlanOrGoal = liftEntryRenderer();
const toolPresentation = liftToolPresentation();
const eventCopyText = liftCopyText(plan, toolPresentation);

// A live task and the three ways a task stops being live. `isTurnEnded` reads exactly what
// renderEventStream already reads for the sub-agent count: anything but `running` is over.
const RUNNING_TASK = { status: 'running', repo_path: '/workspace/relay' };
const FINISHED_TASKS = [
  { status: 'complete', repo_path: '/workspace/relay' },
  { status: 'failed', repo_path: '/workspace/relay' },
  { status: 'cancelled', repo_path: '/workspace/relay' },
];

function codexPlanEvent(steps, overrides = {}) {
  return {
    id: overrides.eventId || 1,
    kind: 'codex',
    message: 'Updated plan.',
    created_at: overrides.createdAt || '2026-08-12T09:00:00.000Z',
    payload: {
      type: 'turn/plan/updated',
      threadId: 'thread-a1b2c3',
      turnId: overrides.turnId || 'turn-0001',
      planKey: overrides.planKey || 'plan-turn-1',
      explanation: overrides.explanation ?? 'Repair the fold, then cover it.',
      plan: steps,
    },
  };
}

function claudePlanEvent(steps, overrides = {}) {
  return {
    id: overrides.eventId || 1,
    kind: 'claude',
    message: 'Updated plan.',
    created_at: overrides.createdAt || '2026-08-12T09:00:00.000Z',
    payload: {
      type: 'claude/plan',
      planKey: overrides.planKey || 'plan-claude-1',
      explanation: overrides.explanation ?? 'Repair the fold, then cover it.',
      plan: steps,
      // The backend writes the flag only when it is true, so an ordinary revision produces the
      // exact payload it always did.
      ...(overrides.partial ? { partial: true } : {}),
    },
  };
}

// A revision `src/claude-execution-runner.mjs` could not vouch for whole: this turn's own
// steps and no more.
function claudePartialPlanEvent(steps, overrides = {}) {
  return claudePlanEvent(steps, { ...overrides, partial: true });
}

function goalUpdatedEvent(goal = {}, overrides = {}) {
  return {
    id: overrides.eventId || 1,
    kind: 'codex',
    message: 'Goal updated.',
    created_at: overrides.createdAt || '2026-08-12T09:00:00.000Z',
    payload: {
      type: 'thread/goal/updated',
      threadId: 'thread-a1b2c3',
      turnId: 'turn-0001',
      goal: {
        objective: 'Ship the plan visibility work',
        status: 'active',
        tokenBudget: 250_000,
        tokensUsed: 41_500,
        timeUsedSeconds: 903,
        createdAt: '2026-08-12T08:30:00.000Z',
        updatedAt: '2026-08-12T09:00:00.000Z',
        ...goal,
      },
    },
  };
}

const SAMPLE_STEPS = [
  { step: 'Read the queue module', status: 'completed' },
  { step: 'Repair the plan fold', status: 'inProgress' },
  { step: 'Cover the fold with tests', status: 'pending' },
  { step: 'Update the wiki', status: 'pending' },
  { step: 'Run the release gates', status: 'pending' },
];

function planRow(event, options = {}) {
  const [entry] = groupEventEntries(Array.isArray(event) ? event : [event]);
  const presentation = plan.planPresentation(entry, { provider: 'relay', state: 'error', status: 'Attention', duration: '4 s' }, options);
  return { entry, presentation, markup: renderPlanOrGoal(presentation, '09:00:00') };
}

function goalRow(events, options = {}) {
  const [entry] = groupEventEntries(events);
  const presentation = plan.goalPresentation(entry, { provider: 'relay', state: 'error', status: 'Attention', duration: '4 s' }, options);
  return { entry, presentation, markup: renderPlanOrGoal(presentation, '09:00:00') };
}

test('the plan row renders the reference checklist: explanation, progress, and step glyphs', () => {
  const { presentation, markup } = planRow(codexPlanEvent(SAMPLE_STEPS));

  assert.equal(presentation.kind, 'plan');
  assert.equal(presentation.title, 'Plan');
  assert.equal(presentation.status, '1/5 steps');
  assert.equal(presentation.current, 'Repair the plan fold');
  // The plan pins its own state and drops the generic duration, so an untrusted step text
  // can never drag the row into the failure or running presentation by accident.
  assert.equal(presentation.state, 'running');
  assert.equal(presentation.duration, '');

  assert.match(markup, /<span class="term-signal-title">Plan<\/span>/);
  assert.match(markup, /<span class="term-signal-state term-plan-progress">1\/5 steps<\/span>/);
  assert.match(markup, /<p class="term-plan-explanation">Repair the fold, then cover it\.<\/p>/);
  assert.match(markup, /<ol class="term-plan-list">/);
  assert.match(markup, /data-plan-status="completed"[^>]*>[^<]*<span class="term-plan-mark" aria-hidden="true">✔<\/span>/);
  assert.match(markup, /data-plan-status="inProgress"[^>]*>[^<]*<span class="term-plan-mark" aria-hidden="true">▸<\/span>/);
  assert.match(markup, /data-plan-status="pending"[^>]*>[^<]*<span class="term-plan-mark" aria-hidden="true">☐<\/span>/);
  assert.equal((markup.match(/class="term-plan-step"/g) || []).length, 5);
  // The glyph is decorative, so the status word rides along for assistive technology.
  assert.match(markup, /<span class="sr-only">In progress<\/span>/);
  assert.match(markup, /<span class="sr-only">Completed<\/span>/);
  assert.match(markup, /<span class="sr-only">Pending<\/span>/);
});

test('a finished plan and an untouched plan read differently from a live one', () => {
  const done = planRow(codexPlanEvent([{ step: 'Only step', status: 'completed' }])).presentation;
  assert.equal(done.status, '1/1 step');
  assert.equal(done.state, 'success');

  const untouched = planRow(codexPlanEvent([
    { step: 'First', status: 'pending' },
    { step: 'Second', status: 'pending' },
  ])).presentation;
  assert.equal(untouched.status, '0/2 steps');
  assert.equal(untouched.state, 'neutral');
});

test('a plan with no explanation renders the checklist without an empty quiet line', () => {
  const { markup } = planRow(codexPlanEvent([{ step: 'Only step', status: 'pending' }], { explanation: '' }));
  assert.doesNotMatch(markup, /term-plan-explanation/);
  assert.match(markup, /term-plan-list/);
});

test('a Claude plan and a Codex plan render through the same neutral path', () => {
  const codex = planRow(codexPlanEvent(SAMPLE_STEPS));
  const claude = planRow(claudePlanEvent(SAMPLE_STEPS));

  assert.equal(codex.presentation.provider, 'codex');
  assert.equal(claude.presentation.provider, 'claude');
  assert.equal(codex.presentation.kind, claude.presentation.kind);
  assert.equal(codex.presentation.status, claude.presentation.status);
  // Provider is carried by the entry class, never by a second checklist implementation.
  assert.equal(codex.markup, claude.markup);
  assert.match(app, /const providerClass = presentation\.provider === 'council' \? 'plan' : presentation\.provider;/);
  assert.match(app, /`event-provider-\$\{escapeHtml\(providerClass\)\}`/);
  assert.match(app, /`event-kind-\$\{escapeHtml\(presentation\.kind\)\}`/);
});

test('a Claude owner renders as a trailing chip and Codex steps carry none', () => {
  const claude = planRow(claudePlanEvent([
    { step: 'Land the renderer', status: 'inProgress', owner: 'dev-3' },
    { step: 'Land the backend', status: 'pending', owner: '' },
  ]));
  assert.match(claude.markup, /<span class="term-plan-owner">dev-3<\/span>/);
  assert.equal((claude.markup.match(/term-plan-owner/g) || []).length, 1);

  const codex = planRow(codexPlanEvent(SAMPLE_STEPS));
  assert.doesNotMatch(codex.markup, /term-plan-owner/);
});

test('every provider-controlled plan value is escaped before it reaches the DOM', () => {
  const { markup } = planRow(claudePlanEvent([
    { step: '<img src=x onerror=alert(1)>', status: 'inProgress', owner: '<script>owner</script>' },
    { step: 'Quote "and" \'both\' & ampersand', status: 'pending' },
  ], { explanation: '<img src=x onerror=alert(1)>' }));

  assert.doesNotMatch(markup, /<img/);
  assert.doesNotMatch(markup, /<script/);
  // No element in the output carries an event handler attribute.
  assert.doesNotMatch(markup, /<[a-z]+\b[^>]*\son[a-z]+\s*=/i);
  assert.match(markup, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(markup, /&lt;script&gt;owner&lt;\/script&gt;/);
  assert.match(markup, /Quote &quot;and&quot; &#39;both&#39; &amp; ampersand/);
  // The explanation is provider output too, not just the steps.
  assert.equal((markup.match(/&lt;img src=x onerror=alert\(1\)&gt;/g) || []).length, 2);
});

test('a plan step status invented by a provider cannot inject an attribute', () => {
  const { markup } = planRow(codexPlanEvent([{ step: 'Step', status: '" onmouseover="alert(1)' }]));
  assert.match(markup, /data-plan-status="pending"/);
  assert.doesNotMatch(markup, /onmouseover/);
});

test('the checklist defends itself against a status the stream never normalized', () => {
  // planEntryDetails already clamps unknown statuses, so the renderer is only reached with a
  // hostile value when it is called directly. It must still produce a marker, a spoken status,
  // and an inert attribute rather than a blank step with an open attribute.
  const markup = plan.planChecklistMarkup([
    { step: 'Unknown status step', status: '" onmouseover="alert(1)' },
    { step: 'Missing status step' },
  ]);

  assert.equal((markup.match(/data-plan-status="pending"/g) || []).length, 2);
  assert.equal((markup.match(/aria-hidden="true">☐<\/span>/g) || []).length, 2);
  assert.equal((markup.match(/<span class="sr-only">Pending<\/span>/g) || []).length, 2);
  assert.doesNotMatch(markup, /onmouseover/);
  assert.equal(plan.planStepStatus('somethingElse'), 'pending');
  assert.equal(plan.planStepStatus(undefined), 'pending');
  assert.equal(plan.planStepStatus('inProgress'), 'inProgress');
  assert.equal(plan.planChecklistMarkup([]), '', 'an empty plan renders no list element');
});

/* A partial revision keeps the fuller board on screen and says so -----------------
   The row draws what `planEntryDetails` merged, so its tally describes the drawn board rather
   than the newest revision's smaller slice, and the hint admits which revision it is standing
   on instead of passing a layered board off as one the provider vouched for whole. */

const PARTIAL_BASE_STEPS = [
  { step: 'Land the backend', status: 'completed' },
  { step: 'Land the renderer', status: 'inProgress' },
  { step: 'Cover it with tests', status: 'pending' },
];

function drawnStepCount(markup) {
  return (markup.match(/class="term-plan-step"/g) || []).length;
}

test('a partial revision keeps every step of the fuller board and marks the row', () => {
  const { presentation, markup } = planRow([
    claudePlanEvent(PARTIAL_BASE_STEPS, { eventId: 1 }),
    claudePartialPlanEvent([{ step: 'Land the renderer', status: 'completed' }], { eventId: 2 }),
  ], { turnEnded: plan.isTurnEnded(RUNNING_TASK) });

  assert.equal(presentation.partial, true);
  assert.equal(presentation.partialHint, plan.PLAN_PARTIAL_HINT);
  assert.equal(plan.PLAN_PARTIAL_HINT, 'partial board');
  assert.equal(drawnStepCount(markup), 3, 'the smaller revision never replaces the drawn board');
  assert.match(markup, /<span class="term-plan-partial">partial board<\/span>/);
  // The tally describes exactly what is drawn: three steps, two of them done.
  assert.equal(presentation.status, '2/3 steps');
  assert.equal(presentation.status, `${(markup.match(/data-plan-status="completed"/g) || []).length}/${drawnStepCount(markup)} steps`);
  assert.doesNotMatch(markup, /term-plan-more/, 'nothing was hidden, so nothing claims to be');
});

test('a partial revision moves a step the fuller board already lists', () => {
  const { markup } = planRow([
    claudePlanEvent(PARTIAL_BASE_STEPS, { eventId: 1 }),
    claudePartialPlanEvent([{ step: 'Land the renderer', status: 'completed' }], { eventId: 2 }),
  ], { turnEnded: plan.isTurnEnded(RUNNING_TASK) });

  assert.match(markup, /data-plan-status="completed"[^]*?Land the renderer/);
  assert.doesNotMatch(markup, /data-plan-status="inProgress"/, 'the step it completed is no longer live');
  assert.equal((markup.match(/data-plan-status="completed"/g) || []).length, 2);
  assert.match(markup, /data-plan-status="pending"[^]*?Cover it with tests/);
});

test('a step only the partial revision names still reaches the checklist', () => {
  const { presentation, markup } = planRow([
    claudePlanEvent(PARTIAL_BASE_STEPS, { eventId: 1 }),
    claudePartialPlanEvent([
      { step: 'Write the release note', status: 'inProgress', owner: 'dev-9' },
    ], { eventId: 2 }),
  ], { turnEnded: plan.isTurnEnded(RUNNING_TASK) });

  assert.equal(drawnStepCount(markup), 4);
  assert.match(markup, /Write the release note/);
  assert.match(markup, /<span class="term-plan-owner">dev-9<\/span>/);
  assert.equal(presentation.status, '1/4 steps');
});

test('a partial revision with nothing fuller behind it renders normally and still says partial', () => {
  const { presentation, markup } = planRow(
    claudePartialPlanEvent([
      { step: 'The only step this turn knows', status: 'inProgress' },
      { step: 'Its follow-up', status: 'pending' },
    ]),
    { turnEnded: plan.isTurnEnded(RUNNING_TASK) },
  );

  assert.equal(presentation.partial, true);
  assert.equal(presentation.status, '0/2 steps');
  assert.equal(drawnStepCount(markup), 2);
  assert.match(markup, /<span class="term-plan-partial">partial board<\/span>/);
  assert.match(markup, /data-plan-status="inProgress"/, 'a live turn still shows its current step');
});

test('the explanation follows the newest revision rather than the board it layered onto', () => {
  /*
   * The backend derives the explanation from the step being worked on right now, so a partial
   * revision that carries none has nothing to say about the current step. Reprinting the
   * sentence the fuller board arrived with would describe an earlier turn's step beside a
   * merged board, which is the same overclaim the partial hint exists to prevent.
   */
  const silent = planRow([
    claudePlanEvent(PARTIAL_BASE_STEPS, { eventId: 1, explanation: 'Landing the renderer half' }),
    claudePartialPlanEvent([{ step: 'Land the renderer', status: 'completed' }], { eventId: 2, explanation: '' }),
  ], { turnEnded: plan.isTurnEnded(RUNNING_TASK) });

  assert.equal(silent.presentation.explanation, '');
  assert.doesNotMatch(silent.markup, /term-plan-explanation/);
  assert.doesNotMatch(silent.markup, /Landing the renderer half/);
  assert.equal(drawnStepCount(silent.markup), 3, 'the merged board is untouched by the empty explanation');

  const spoken = planRow([
    claudePlanEvent(PARTIAL_BASE_STEPS, { eventId: 1, explanation: 'Landing the renderer half' }),
    claudePartialPlanEvent([{ step: 'Write the release note', status: 'inProgress' }], {
      eventId: 2,
      explanation: 'Writing the release note',
    }),
  ], { turnEnded: plan.isTurnEnded(RUNNING_TASK) });
  assert.match(spoken.markup, /<p class="term-plan-explanation">Writing the release note<\/p>/);
});

test('a Codex plan row never claims a partial board', () => {
  const { presentation, markup } = planRow(codexPlanEvent(SAMPLE_STEPS));
  assert.equal(presentation.partial, false);
  assert.equal(presentation.partialHint, '');
  assert.doesNotMatch(markup, /term-plan-partial/);
  assert.doesNotMatch(markup, /partial board/);

  // A whole Claude revision reads the same way: the hint belongs to the payload flag alone.
  const whole = planRow(claudePlanEvent(SAMPLE_STEPS));
  assert.equal(whole.presentation.partial, false);
  assert.doesNotMatch(whole.markup, /partial board/);
});

test('the copied log carries the partial caveat with the merged board', () => {
  const [entry] = groupEventEntries([
    claudePlanEvent(PARTIAL_BASE_STEPS, { eventId: 1 }),
    claudePartialPlanEvent([{ step: 'Land the renderer', status: 'completed' }], { eventId: 2 }),
  ]);
  const lines = eventCopyText(entry, RUNNING_TASK).split('\n');

  assert.match(lines[0], /Claude · Plan · 2\/3 steps$/);
  assert.equal(lines[1], 'Repair the fold, then cover it.');
  assert.equal(lines[2], plan.PLAN_PARTIAL_NOTE);
  assert.match(lines[2], /^partial board:/);
  assert.equal(lines[3], '[x] Land the backend');
  assert.equal(lines[4], '[x] Land the renderer');
  assert.equal(lines[5], '[ ] Cover it with tests');
  assert.equal(lines.length, 6, 'the log carries every step of the board it reports');

  // A whole revision copies exactly as it always did, with no caveat line inserted.
  const [whole] = groupEventEntries([claudePlanEvent(PARTIAL_BASE_STEPS, { eventId: 1 })]);
  assert.doesNotMatch(eventCopyText(whole, RUNNING_TASK), /partial board/);
});

test('a finished, a failed, and a cancelled task render no live step on a partial board', () => {
  for (const task of FINISHED_TASKS) {
    const { presentation, markup } = planRow([
      claudePlanEvent(PARTIAL_BASE_STEPS, { eventId: 1 }),
      claudePartialPlanEvent([{ step: 'Write the release note', status: 'inProgress' }], { eventId: 2 }),
    ], { turnEnded: plan.isTurnEnded(task) });

    assert.equal(presentation.live, false, `${task.status} owns no live plan`);
    assert.notEqual(presentation.state, 'running');
    assert.equal(presentation.current, '');
    // The tally still describes the merged board, not the revision it is standing on.
    assert.equal(presentation.status, '1/4 steps');
    assert.doesNotMatch(markup, /data-plan-status="inProgress"/, `${task.status} shows no in-progress step`);
    // Both steps the turn left in flight keep their place and read as unfinished.
    assert.equal((markup.match(/data-plan-status="unfinished"/g) || []).length, 2);
    assert.equal(drawnStepCount(markup), 4, 'the merged board is still fully listed');
    // The row is still honest about what it is standing on.
    assert.match(markup, /<span class="term-plan-partial">partial board<\/span>/);
    assert.match(eventCopyText(groupEventEntries([
      claudePlanEvent(PARTIAL_BASE_STEPS, { eventId: 1 }),
      claudePartialPlanEvent([{ step: 'Write the release note', status: 'inProgress' }], { eventId: 2 }),
    ])[0], task), /partial board/);
  }
});

test('the goal row renders objective, status, tokens, budget, and time used', () => {
  const { presentation, markup } = goalRow([goalUpdatedEvent()]);

  assert.equal(presentation.kind, 'goal');
  assert.equal(presentation.title, 'Goal');
  assert.equal(presentation.provider, 'codex');
  assert.equal(presentation.status, 'Active');
  assert.equal(presentation.goalStatus, 'active');
  assert.equal(presentation.state, 'running');

  assert.match(markup, /<span class="term-signal-inline term-goal-objective">Ship the plan visibility work<\/span>/);
  assert.match(markup, /data-goal-status="active">Active<\/span>/);
  assert.match(markup, new RegExp(`<span>${(41_500).toLocaleString()} tokens used</span>`));
  assert.match(markup, new RegExp(`<span>${(250_000).toLocaleString()} token budget</span>`));
  assert.match(markup, /<span>15m 03s used<\/span>/);
});

test('the goal omits a budget it was never given and a time it never spent', () => {
  const { markup } = goalRow([goalUpdatedEvent({ tokenBudget: 0, timeUsedSeconds: 0, tokensUsed: 0 })]);
  assert.match(markup, /<span>0 tokens used<\/span>/);
  assert.doesNotMatch(markup, /token budget/);
  assert.doesNotMatch(markup, /used<\/span>[^]*used<\/span>/);
});

test('a goal missing or misreporting its usage numbers never renders NaN', () => {
  // A goal object that omits the usage fields entirely, and one that reports nonsense, must
  // both land on a real number. Number(undefined) is NaN and would reach toLocaleString.
  const bare = goalRow([{
    id: 1,
    kind: 'codex',
    message: 'Goal updated.',
    created_at: '2026-08-12T09:00:00.000Z',
    payload: {
      type: 'thread/goal/updated',
      threadId: 'thread-a1b2c3',
      goal: { objective: 'Ship it', status: 'active' },
    },
  }]);
  assert.match(bare.markup, /<span>0 tokens used<\/span>/);
  assert.doesNotMatch(bare.markup, /NaN|undefined/);

  const nonsense = goalRow([goalUpdatedEvent({
    tokensUsed: 'lots',
    tokenBudget: -1,
    timeUsedSeconds: -900,
  })]);
  assert.match(nonsense.markup, /<span>0 tokens used<\/span>/);
  assert.doesNotMatch(nonsense.markup, /NaN|undefined/);
  assert.doesNotMatch(nonsense.markup, /<span>-/, 'a negative usage number never reaches the row');
  assert.doesNotMatch(nonsense.markup, /token budget/);
});

test('goal time reads in seconds, minutes, and hours', () => {
  assert.equal(plan.goalTimeLabel(0), '');
  assert.equal(plan.goalTimeLabel(45), '45s');
  assert.equal(plan.goalTimeLabel(903), '15m 03s');
  assert.equal(plan.goalTimeLabel(7_845), '2h 10m');
});

test('a blocked or limited goal reads as attention, a complete goal as success', () => {
  assert.equal(goalRow([goalUpdatedEvent({ status: 'blocked' })]).presentation.state, 'error');
  assert.equal(goalRow([goalUpdatedEvent({ status: 'usageLimited' })]).presentation.state, 'error');
  assert.equal(goalRow([goalUpdatedEvent({ status: 'budgetLimited' })]).presentation.state, 'error');
  // A paused goal is neither live nor resolved: it must not borrow the running accent that
  // the terminal reserves for work actually in flight.
  assert.equal(goalRow([goalUpdatedEvent({ status: 'paused' })]).presentation.state, 'neutral');
  assert.equal(goalRow([goalUpdatedEvent({ status: 'throttledByProvider' })]).presentation.state, 'neutral');
  assert.equal(goalRow([goalUpdatedEvent({ status: 'active' })]).presentation.state, 'running');
  assert.equal(goalRow([goalUpdatedEvent({ status: 'complete' })]).presentation.state, 'success');
  assert.equal(goalRow([goalUpdatedEvent({ status: 'usageLimited' })]).presentation.status, 'Usage limited');
});

test('a goal status CC Relay does not know is shown, not flattened into a generic word', () => {
  // src/codex-app-server.mjs deliberately keeps an unfamiliar goal status as trimmed text.
  assert.equal(goalRow([goalUpdatedEvent({ status: 'throttledByProvider' })]).presentation.status, 'Throttled by provider');
  assert.equal(goalRow([goalUpdatedEvent({ status: '' })]).presentation.status, 'Recorded');

  // An absurd provider value is bounded rather than allowed to dominate the uppercase pill.
  const long = goalRow([goalUpdatedEvent({ status: 'x'.repeat(400) })]).presentation;
  assert.equal(long.status.length, 48);
  assert.doesNotMatch(goalRow([goalUpdatedEvent({ status: '<b>bold</b>' })]).markup, /<b>bold<\/b>/);
});

test('a cleared goal resolves its row and stays quiet', () => {
  const cleared = {
    id: 2,
    kind: 'codex',
    message: 'Goal cleared.',
    created_at: '2026-08-12T09:05:00.000Z',
    payload: { type: 'thread/goal/cleared', threadId: 'thread-a1b2c3' },
  };
  const { entry, presentation, markup } = goalRow([goalUpdatedEvent(), cleared]);

  assert.equal(entry.completedEvent.id, 2);
  assert.equal(presentation.status, 'Cleared');
  assert.equal(presentation.state, 'success');
  assert.equal(presentation.quiet, true);
  assert.match(markup, /data-goal-status="cleared">Cleared<\/span>/);
});

test('a task with no goal event renders no goal row at all', () => {
  const entries = groupEventEntries([codexPlanEvent(SAMPLE_STEPS)]);
  assert.equal(entries.some(isGoalEntry), false);
  for (const entry of entries) {
    assert.equal(plan.goalPresentation(entry, {}), null, 'an absent goal never becomes an empty panel');
  }
  const emptyGoal = { entry: null };
  assert.equal(plan.goalPresentation(emptyGoal, {}), null);
});

test('an objective containing a quote is escaped in the markup', () => {
  const { markup } = goalRow([goalUpdatedEvent({
    objective: 'Ship "plan" visibility <img src=x onerror=alert(1)>',
  })]);
  assert.doesNotMatch(markup, /<img/);
  assert.match(markup, /Ship &quot;plan&quot; visibility &lt;img src=x onerror=alert\(1\)&gt;/);
});

test('the copied log renders the plan as plain text with step markers', () => {
  const [entry] = groupEventEntries([codexPlanEvent(SAMPLE_STEPS)]);
  const text = eventCopyText(entry, RUNNING_TASK);
  const lines = text.split('\n');

  assert.match(lines[0], /Codex · Plan · 1\/5 steps$/);
  assert.equal(lines[1], 'Repair the fold, then cover it.');
  assert.equal(lines[2], '[x] Read the queue module');
  assert.equal(lines[3], '[>] Repair the plan fold');
  assert.equal(lines[4], '[ ] Cover the fold with tests');
  assert.doesNotMatch(text, /</, 'the copied log stays plain text');
});

test('the copied plan carries the Claude owner alongside its step', () => {
  const [entry] = groupEventEntries([claudePlanEvent([{ step: 'Land the renderer', status: 'inProgress', owner: 'dev-3' }])]);
  const text = eventCopyText(entry, RUNNING_TASK);
  assert.match(text, /^\[>\] Land the renderer \(dev-3\)$/m);
  assert.match(text.split('\n')[0], /Claude · Plan · 0\/1 step$/);
});

test('the copied log renders the goal objective, status, and usage', () => {
  const [entry] = groupEventEntries([goalUpdatedEvent()]);
  const text = eventCopyText(entry, RUNNING_TASK);
  const lines = text.split('\n');

  assert.match(lines[0], /Codex · Goal · Active$/);
  assert.equal(lines[1], 'Ship the plan visibility work');
  assert.equal(lines[2], `Active · ${(41_500).toLocaleString()} tokens used · ${(250_000).toLocaleString()} token budget · 15m 03s used`);
});

test('eventPresentation resolves plan and goal before every item branch', () => {
  const branch = sourceBetween('  if (isSubAgentEntry(entry)) {', "  if (item?.type === 'commandExecution') {");
  assert.match(branch, /if \(isPlanEntry\(entry\)\) \{\s*const plan = planPresentation\(entry, common, \{ turnEnded \}\);/);
  assert.match(branch, /if \(isGoalEntry\(entry\)\) \{\s*const goal = goalPresentation\(entry, common, \{ turnEnded \}\);/);
  // The row and the copy log both read the turn state from the task, never from the plan or
  // the goal alone, so neither can keep claiming a live step after the task is over.
  assert.match(functionBody('function eventPresentation(entry, task) {'), /const turnEnded = isTurnEnded\(task\);/);

  const copy = functionBody('function eventCopyText(entry, task) {');
  assert.match(copy, /\} else if \(isPlanEntry\(entry\)\) \{\s*lines\.push\(\.\.\.planCopyLines\(planEntryDetails\(entry\), \{ turnEnded: isTurnEnded\(task\) \}\)\);/);
  assert.match(copy, /\} else if \(isGoalEntry\(entry\)\) \{\s*lines\.push\(\.\.\.goalCopyLines\(goalEntryDetails\(entry\)\)\);/);
});

test('the metrics strip shows plan progress only when the task published a plan', () => {
  const metrics = sourceBetween('elements.eventMetrics.innerHTML = `', '`;');
  assert.match(metrics, /\$\{stats\.plan \? `<span class="has-plan"><b>\$\{stats\.plan\.done\}\/\$\{stats\.plan\.total\}<\/b><small>plan steps<\/small><\/span>` : ''\}/);
  // Every pre-existing tile survives.
  for (const label of ['thinking tokens', 'commands', 'file changes', 'messages', 'errors', 'sub-agents', 'active']) {
    assert.ok(metrics.includes(`<small>${label}</small>`), `${label} tile survives`);
  }
});

test('the event stream still rebuilds its markup instead of trusting a signature', () => {
  const render = functionBody('function renderEventStream(events, task, {');
  assert.match(render, /elements\.detailEvents\.innerHTML = visible\.length === 0/);
  // A memoized render whose signature misses a step status is the exact bug this repo has
  // shipped twice. There is no signature here, so a plan revision can never go stale.
  assert.doesNotMatch(render, /[Ss]ignature/);
  assert.doesNotMatch(render, /return;\s*\/\/ unchanged/);
});

test('the plan and goal styles live in the theme-independent terminal scope', () => {
  for (const selector of [
    '.event-kind-plan .term-glyph',
    '.term-plan-progress',
    '.term-plan-explanation',
    '.term-plan-list',
    '.term-plan-step',
    '.term-plan-mark',
    '.term-plan-text',
    '.term-plan-owner',
    '.term-plan-more',
    '.term-plan-partial',
    '.event-kind-goal .term-glyph',
    '.term-goal-objective',
    '.term-goal-meta',
    '.event-metrics .has-plan b',
  ]) {
    assert.ok(style.includes(`${selector} `) || style.includes(`${selector},`) || style.includes(`${selector}{`),
      `${selector} is styled`);
  }
  assert.match(style, /\.term-plan-step\[data-plan-status="completed"\] \.term-plan-mark \{ color: var\(--term-green\); \}/);
  assert.match(style, /\.term-plan-step\[data-plan-status="pending"\] \.term-plan-mark \{ color: var\(--term-sep\); \}/);
  assert.match(style, /\.term-plan-step\[data-plan-status="inProgress"\] \.term-plan-mark \{ color: var\(--term-cyan\); \}/);
  assert.match(style, /\.term-goal-state\[data-goal-status="blocked"\] \{ color: var\(--term-red\); \}/);
  // A step left in progress by a turn that ended keeps a non-color cue of its own, and the
  // ended goal pill wins on specificity rather than on source order against the live accent.
  assert.match(style, /\.term-plan-step\[data-plan-status="unfinished"\] \.term-plan-mark \{ color: var\(--term-amber\); \}/);
  assert.match(style, /\.event-kind-goal \.term-goal-state\.is-ended \{ color: var\(--term-muted2\); \}/);
  // The partial hint reads in the same quiet register as the step-cap overflow line rather
  // than borrowing the uppercase progress pill it sits beside.
  assert.match(style, /\.term-plan-partial \{[^}]*color: var\(--term-muted\);[^}]*font-style: italic;/s);
  assert.doesNotMatch(style, /\.term-plan-partial \{[^}]*text-transform/s);

  /*
   * The execution ledger is deliberately one dark surface under both application themes:
   * its palette is declared once on .events-section and no html[data-theme="dark"] rule
   * touches it. Duplicating these rules under a dark selector would contradict that.
   */
  const palette = style.slice(style.indexOf('.events-section {'), style.indexOf('/* Metrics strip'));
  for (const token of ['--term-cyan:', '--term-green:', '--term-sep:', '--term-magenta:', '--term-amber:', '--term-red:', '--term-blue:']) {
    assert.ok(palette.includes(token), `${token} is declared once on .events-section`);
  }
  for (const match of style.matchAll(/html\[data-theme="dark"\][^{]*\{/g)) {
    assert.doesNotMatch(match[0], /term-plan|term-goal|has-plan|event-kind-plan|event-kind-goal/);
  }
});

test('the checklist adds no motion and appends no reduced-motion block', () => {
  const block = style.slice(style.indexOf('/* Plan checklist + Codex goal'), style.indexOf('/* Quiet / low-priority protocol'));
  assert.ok(block, 'the plan block is present');
  const rules = block.replaceAll(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(rules, /animation/, 'the current step is emphasized without motion');
  assert.doesNotMatch(rules, /transition/);
  assert.doesNotMatch(rules, /@keyframes/);
  assert.doesNotMatch(rules, /prefers-reduced-motion/);
  // The in-progress step still carries a non-color cue: its own glyph plus weight.
  assert.match(block, /\.term-plan-step\[data-plan-status="inProgress"\] \.term-plan-text \{\s*color: var\(--term-fg\);\s*font-weight: 650;/);

  /*
   * test/planner-board.test.mjs and test/session-tasks-ui.test.mjs both assert against the
   * LAST `prefers-reduced-motion: reduce` block in this file, so appending one here would
   * break suites this task does not own.
   */
  const lastReduce = style.slice(style.lastIndexOf('@media (prefers-reduced-motion: reduce)'));
  assert.match(lastReduce, /\.planner-step-spinner \{ animation: none; \}/);
  assert.doesNotMatch(lastReduce, /term-plan|term-goal/);
});

test('the compact breakpoint keeps the checklist gutter without overflowing', () => {
  const compact = style.slice(style.indexOf('/* Compact panel: the checklist keeps its gutter'));
  assert.match(compact, /@media \(max-width: 1344px\) \{/);
  assert.match(compact, /\.term-plan-step \{ grid-template-columns: 12px minmax\(0, 1fr\) auto; gap: 6px; \}/);
  // Long provider text must wrap rather than push the terminal into a horizontal scroll.
  assert.match(style, /\.term-plan-text \{ min-width: 0; overflow-wrap: anywhere; \}/);
  assert.match(style, /\.term-plan-explanation \{[^}]*overflow-wrap: anywhere;/s);
});

test('the plan and goal rows introduce nothing focusable and no new live region', () => {
  const branch = sourceBetween("  if (p.kind === 'plan') {", '  const inline = p.inline ?');
  assert.doesNotMatch(branch, /tabindex/);
  assert.doesNotMatch(branch, /aria-live/);
  assert.doesNotMatch(branch, /<button|<a |<details|<summary/);
});

test('the renderer consumes the exact payload shapes the backends store', () => {
  /*
   * src/codex-app-server.mjs writes `planKey: threadId:turnId`, drops `owner` entirely, and
   * reports an absent token budget, token count, or elapsed time as null rather than 0.
   * src/claude-execution-runner.mjs writes `provider: 'claude'` and a session-scoped planKey.
   * A null that reached toLocaleString would render "NaN tokens used" in the goal row.
   */
  const [codexEntry] = groupEventEntries([{
    id: 1,
    kind: 'codex',
    message: 'Codex updated its plan (0/2 steps done): Repair the fold.',
    created_at: '2026-08-12T09:00:00.000Z',
    payload: {
      type: 'turn/plan/updated',
      threadId: 'thread-a1b2c3',
      turnId: 'turn-0001',
      planKey: 'thread-a1b2c3:turn-0001',
      explanation: 'Repair the fold, then cover it.',
      plan: [{ step: 'Repair the fold', status: 'inProgress' }, { step: 'Cover it', status: 'pending' }],
    },
  }]);
  assert.equal(codexEntry.id, 'plan-thread-a1b2c3:turn-0001');
  const codexPlan = plan.planPresentation(codexEntry, {});
  assert.equal(codexPlan.provider, 'codex');
  assert.equal(codexPlan.status, '0/2 steps');
  assert.doesNotMatch(renderPlanOrGoal(codexPlan, '09:00:00'), /term-plan-owner/);

  const [claudeEntry] = groupEventEntries([{
    id: 2,
    kind: 'claude',
    message: 'Claude updated its plan (1/2 steps done).',
    created_at: '2026-08-12T09:00:00.000Z',
    payload: {
      type: 'claude/plan',
      provider: 'claude',
      planKey: 'session-8f21a0c4',
      explanation: 'Landing the renderer half',
      plan: [
        { step: 'Land the backend', status: 'completed', owner: 'dev-1' },
        { step: 'Land the renderer', status: 'inProgress', owner: 'dev-3' },
      ],
    },
  }]);
  assert.equal(claudeEntry.id, 'plan-session-8f21a0c4');
  assert.equal(plan.planPresentation(claudeEntry, {}).provider, 'claude');

  const [goalEntry] = groupEventEntries([{
    id: 3,
    kind: 'codex',
    message: 'Codex goal active: Ship it.',
    created_at: '2026-08-12T09:00:00.000Z',
    payload: {
      type: 'thread/goal/updated',
      threadId: 'thread-a1b2c3',
      turnId: 'turn-0001',
      goal: {
        objective: 'Ship it',
        status: 'active',
        tokenBudget: null,
        tokensUsed: null,
        timeUsedSeconds: null,
        createdAt: null,
        updatedAt: null,
      },
    },
  }]);
  const goalMarkup = renderPlanOrGoal(plan.goalPresentation(goalEntry, {}), '09:00:00');
  assert.match(goalMarkup, /<span>0 tokens used<\/span>/);
  assert.doesNotMatch(goalMarkup, /NaN/);
  assert.doesNotMatch(goalMarkup, /null/);
  assert.doesNotMatch(goalMarkup, /token budget/);
});

test('plan and goal entries keep the shared entry accessors working', () => {
  const [planEntry] = groupEventEntries([codexPlanEvent(SAMPLE_STEPS, { eventId: 4 })]);
  assert.equal(entryItem(planEntry), null);
  assert.equal(entryFirstEvent(planEntry).id, 4);
  assert.equal(entryLastEvent(planEntry).id, 4);
  assert.equal(isPlanEntry(planEntry), true);

  const [goalEntry] = groupEventEntries([goalUpdatedEvent({}, { eventId: 9 })]);
  assert.equal(entryItem(goalEntry), null);
  assert.equal(entryFirstEvent(goalEntry).id, 9);
  assert.equal(entryLastEvent(goalEntry).id, 9);
  assert.equal(goalEntryDetails(goalEntry).objective, 'Ship the plan visibility work');
});

/* Fix 1: a finished task owns no live plan and no live goal -----------------------
   Providers stop revising the plan and stop publishing goal notifications when the turn
   ends, so the last thing they said is not evidence of work in flight. */

function goalTurnEndedEvent(overrides = {}) {
  return {
    id: overrides.eventId || 2,
    kind: 'codex',
    message: 'Goal recorded at turn end.',
    created_at: overrides.createdAt || '2026-08-12T09:10:00.000Z',
    payload: {
      type: 'thread/goal/updated',
      threadId: 'thread-a1b2c3',
      // The backend writes the flag beside the goal. The nested shape is accepted too, so a
      // record written either way is read the same and cleared the same.
      ...(overrides.nested ? {} : { turnEnded: true }),
      goal: {
        objective: 'Ship the plan visibility work',
        status: 'active',
        ...(overrides.nested ? { turnEnded: true } : {}),
        ...overrides.goal,
      },
    },
  };
}

function goalClearedEvent(overrides = {}) {
  return {
    id: overrides.eventId || 2,
    kind: 'codex',
    message: 'Goal cleared.',
    created_at: overrides.createdAt || '2026-08-12T09:05:00.000Z',
    payload: { type: 'thread/goal/cleared', threadId: 'thread-a1b2c3' },
  };
}

function planToolItem(overrides = {}) {
  return {
    type: 'mcpToolCall',
    id: 'toolu_board_1',
    server: 'Claude Code',
    tool: 'TaskUpdate',
    arguments: { taskId: '3', status: 'in_progress' },
    status: 'completed',
    result: { content: [{ type: 'text', text: 'Task 3 updated.' }] },
    planTool: true,
    planToolName: 'TaskUpdate',
    ...overrides,
  };
}

test('a running task still renders the live step and the live goal', () => {
  const live = planRow(codexPlanEvent(SAMPLE_STEPS), { turnEnded: plan.isTurnEnded(RUNNING_TASK) });
  assert.equal(live.presentation.state, 'running');
  assert.equal(live.presentation.live, true);
  assert.equal(live.presentation.current, 'Repair the plan fold');
  assert.match(live.markup, /data-plan-status="inProgress"/);
  assert.doesNotMatch(live.markup, /unfinished/);

  const goal = goalRow([goalUpdatedEvent()], { turnEnded: plan.isTurnEnded(RUNNING_TASK) });
  assert.equal(goal.presentation.state, 'running');
  assert.equal(goal.presentation.live, true);
  assert.match(goal.markup, /class="term-signal-state term-goal-state" data-goal-status="active">Active</);
});

test('a finished, a failed, and a cancelled task each render a plan that is not live', () => {
  for (const task of FINISHED_TASKS) {
    const { presentation, markup } = planRow(codexPlanEvent(SAMPLE_STEPS), { turnEnded: plan.isTurnEnded(task) });

    assert.notEqual(presentation.state, 'running', `${task.status} never renders the running state`);
    assert.equal(presentation.state, 'neutral');
    assert.equal(presentation.live, false);
    assert.equal(presentation.current, '', `${task.status} claims no current step`);
    // The count is untouched: the row loses the live claim, not the record.
    assert.equal(presentation.status, '1/5 steps');

    // The step left in progress keeps its place and reads as unfinished.
    assert.doesNotMatch(markup, /data-plan-status="inProgress"/, `${task.status} shows no in-progress step`);
    assert.match(markup, /data-plan-status="unfinished"[^>]*>[^<]*<span class="term-plan-mark" aria-hidden="true">◌<\/span>/);
    assert.match(markup, /<span class="sr-only">Unfinished<\/span>/);
    assert.equal((markup.match(/class="term-plan-step"/g) || []).length, 5, 'every step is still listed');
    assert.match(markup, /data-plan-status="completed"/);
    assert.match(markup, /data-plan-status="pending"/);
  }
});

test('a plan finished before the turn ended still reads as finished', () => {
  const done = planRow(codexPlanEvent([{ step: 'Only step', status: 'completed' }]), { turnEnded: true });
  assert.equal(done.presentation.state, 'success');
  assert.equal(done.presentation.live, false);
  assert.doesNotMatch(done.markup, /unfinished/);
});

test('a finished, a failed, and a cancelled task each render a goal that is not live', () => {
  for (const task of FINISHED_TASKS) {
    const { presentation, markup } = goalRow([goalUpdatedEvent()], { turnEnded: plan.isTurnEnded(task) });

    assert.notEqual(presentation.state, 'running', `${task.status} never renders the running state`);
    assert.equal(presentation.state, 'neutral');
    assert.equal(presentation.live, false);
    // The last status the provider actually published is still reported, it just stops
    // claiming to be current: the pill drops the live accent.
    assert.equal(presentation.status, 'Active');
    assert.equal(presentation.endedLive, true);
    assert.match(markup, /class="term-signal-state term-goal-state is-ended" data-goal-status="active">Active</);
  }
});

test('a goal that ended blocked or complete keeps that reading after the turn', () => {
  // Attention and resolution are facts about how the goal ended, not live claims, so the
  // ended pill must not flatten a red or a green goal into the muted reading.
  const blocked = goalRow([goalUpdatedEvent({ status: 'blocked' })], { turnEnded: true });
  assert.equal(blocked.presentation.state, 'error');
  assert.equal(blocked.presentation.endedLive, false);
  assert.doesNotMatch(blocked.markup, /is-ended/);
  assert.match(blocked.markup, /class="term-signal-state term-goal-state" data-goal-status="blocked">Blocked</);

  const complete = goalRow([goalUpdatedEvent({ status: 'complete' })], { turnEnded: true });
  assert.equal(complete.presentation.state, 'success');
  assert.doesNotMatch(complete.markup, /is-ended/);

  // A paused goal was never live, so an ended turn changes nothing about how it reads.
  const paused = goalRow([goalUpdatedEvent({ status: 'paused' })], { turnEnded: true });
  assert.equal(paused.presentation.state, 'neutral');
  assert.doesNotMatch(paused.markup, /is-ended/);
  const cleared = goalRow([
    goalUpdatedEvent(),
    { id: 2, kind: 'codex', message: 'Goal cleared.', created_at: '2026-08-12T09:05:00.000Z', payload: { type: 'thread/goal/cleared', threadId: 'thread-a1b2c3' } },
  ], { turnEnded: true });
  assert.equal(cleared.presentation.state, 'success');
  assert.equal(cleared.presentation.status, 'Cleared');
});

test('a turn-final goal record ends the goal on its own, without the task status', () => {
  // The backend records this when the turn that owned the goal finishes. The task row can
  // still be running (a later turn), and the goal from the finished turn is still over.
  const { presentation, markup } = goalRow([goalUpdatedEvent(), goalTurnEndedEvent()], { turnEnded: false });
  assert.equal(presentation.state, 'neutral');
  assert.equal(presentation.live, false);
  assert.match(markup, /term-goal-state is-ended/);
});

test('a goal recorded before the turn-final record falls back to the task status', () => {
  // Stored history from before that backend change carries no flag at all, so the task
  // status is the only evidence and it has to be enough.
  const [entry] = groupEventEntries([goalUpdatedEvent()]);
  assert.equal(goalEntryDetails(entry).turnEnded, false, 'the fallback path is the one under test');
  assert.equal(plan.goalPresentation(entry, {}, { turnEnded: true }).state, 'neutral');
  assert.equal(plan.goalPresentation(entry, {}, { turnEnded: false }).state, 'running');
});

/* Round two: the turn-final record must not outlive the turn that wrote it --------------
   src/queue.mjs dispatches a same-session follow-up with addEvent(sourceTask.id, ...), so a
   second turn's events land in the first turn's task stream and every goal on the thread
   folds into one row. A latching flag would read turn 2's running goal as finished. */

// Turn 1 reports a goal, its turn ends, then turn 2 reports the same goal still running.
function secondTurnGoalEvents({ nested = false } = {}) {
  return [
    goalUpdatedEvent(),
    goalTurnEndedEvent({ nested }),
    goalUpdatedEvent({ tokensUsed: 500 }, { eventId: 3, createdAt: '2026-08-12T09:20:00.000Z' }),
  ];
}

test('a second turn in the same stream renders its goal live again', () => {
  const events = secondTurnGoalEvents();
  assert.equal(goalEntryDetails(groupEventEntries(events)[0]).turnEnded, false, 'the flag does not latch');

  const { presentation, markup } = goalRow(events, { turnEnded: plan.isTurnEnded(RUNNING_TASK) });
  assert.equal(presentation.state, 'running');
  assert.equal(presentation.live, true);
  assert.equal(presentation.endedLive, false);
  assert.doesNotMatch(markup, /is-ended/, 'a goal that is actually running keeps the live accent');
  assert.match(markup, /class="term-signal-state term-goal-state" data-goal-status="active">Active</);
  assert.match(markup, /<span>500 tokens used<\/span>/, 'the newest record describes the row');

  const nested = goalRow(secondTurnGoalEvents({ nested: true }), { turnEnded: plan.isTurnEnded(RUNNING_TASK) });
  assert.equal(goalEntryDetails(groupEventEntries(secondTurnGoalEvents({ nested: true }))[0]).turnEnded, false);
  assert.equal(nested.presentation.state, 'running');
  assert.equal(nested.presentation.live, true);
  assert.equal(nested.presentation.endedLive, false);
  assert.doesNotMatch(nested.markup, /is-ended/);
});

test('the task status still ends that same sequence on a task that is not running', () => {
  // The fallback is what covers stored history written before the backend flag existed, so
  // clearing the flag on a later record must not cost a finished task its not-live reading.
  for (const task of FINISHED_TASKS) {
    const { presentation, markup } = goalRow(secondTurnGoalEvents(), { turnEnded: plan.isTurnEnded(task) });
    assert.notEqual(presentation.state, 'running', `${task.status} never renders the running state`);
    assert.equal(presentation.state, 'neutral');
    assert.equal(presentation.live, false);
    assert.equal(presentation.endedLive, true);
    assert.match(markup, /class="term-signal-state term-goal-state is-ended" data-goal-status="active">Active</);
  }

  // The plan half of the fallback is untouched by the goal fix and stays proven here.
  const planned = planRow(codexPlanEvent(SAMPLE_STEPS), { turnEnded: plan.isTurnEnded(FINISHED_TASKS[0]) });
  assert.equal(planned.presentation.live, false);
  assert.doesNotMatch(planned.markup, /data-plan-status="inProgress"/);
});

test('a cleared goal renders resolved in every order it can meet a turn-final record', () => {
  const running = { turnEnded: plan.isTurnEnded(RUNNING_TASK) };

  // Cleared, then a later goal: the row reopens and is live again.
  const reopened = goalRow([
    goalClearedEvent({ eventId: 1 }),
    goalUpdatedEvent({}, { eventId: 2, createdAt: '2026-08-12T09:20:00.000Z' }),
  ], running);
  assert.equal(reopened.presentation.state, 'running');
  assert.equal(reopened.presentation.live, true);
  assert.equal(reopened.presentation.status, 'Active');
  assert.doesNotMatch(reopened.markup, /is-ended/);

  // A live goal, then cleared: the row resolves.
  const resolved = goalRow([goalUpdatedEvent(), goalClearedEvent({ eventId: 2 })], running);
  assert.equal(resolved.presentation.state, 'success');
  assert.equal(resolved.presentation.live, false);
  assert.equal(resolved.presentation.status, 'Cleared');
  assert.doesNotMatch(resolved.markup, /is-ended/);

  // A turn-final record, then cleared: the clear stands, and the muted live pill stays off
  // a goal that is not claiming to be live in the first place.
  const endedThenCleared = goalRow([
    goalUpdatedEvent(),
    goalTurnEndedEvent(),
    goalClearedEvent({ eventId: 3, createdAt: '2026-08-12T09:20:00.000Z' }),
  ], running);
  assert.equal(endedThenCleared.presentation.state, 'success');
  assert.equal(endedThenCleared.presentation.live, false);
  assert.equal(endedThenCleared.presentation.status, 'Cleared');
  assert.equal(endedThenCleared.presentation.endedLive, false);
  assert.doesNotMatch(endedThenCleared.markup, /is-ended/);
  assert.match(endedThenCleared.markup, /data-goal-status="cleared">Cleared</);
});

test('isTurnEnded reads the task exactly as the sub-agent count already does', () => {
  assert.equal(plan.isTurnEnded({ status: 'running' }), false);
  for (const status of ['complete', 'failed', 'cancelled', 'interrupted', 'queued', 'input-required']) {
    assert.equal(plan.isTurnEnded({ status }), true, `${status} is not a running turn`);
  }
});

test('the copied log of a finished task marks the step it left unfinished', () => {
  const [entry] = groupEventEntries([codexPlanEvent(SAMPLE_STEPS)]);
  const ended = eventCopyText(entry, FINISHED_TASKS[0]).split('\n');
  assert.equal(ended[3], '[~] Repair the plan fold');
  assert.equal(ended[2], '[x] Read the queue module', 'the other markers are untouched');

  const live = eventCopyText(entry, RUNNING_TASK).split('\n');
  assert.equal(live[3], '[>] Repair the plan fold');
});

/* Fix 5: provider-controlled plan and goal text is bounded before it reaches the DOM ---- */

test('a plan longer than the row can draw says exactly how many steps it is not drawing', () => {
  const steps = Array.from({ length: 5_000 }, (unused, index) => ({ step: `Step ${index + 1}`, status: 'pending' }));
  const { presentation, markup } = planRow(codexPlanEvent(steps));

  assert.equal((markup.match(/class="term-plan-step"/g) || []).length, plan.PLAN_STEP_LIMIT);
  assert.equal(plan.PLAN_STEP_LIMIT, 50);
  assert.match(markup, new RegExp(`<li class="term-plan-more">and ${(4_950).toLocaleString()} more steps</li>`));
  // The tally the operator reads is the true one: the row bounds what it draws, never what
  // it reports, and the copied log still carries every step.
  assert.equal(presentation.status, '0/5000 steps');
  assert.ok(markup.length < 20_000, `one plan row stays small (${markup.length} bytes)`);
  assert.equal(plan.planCopyLines({ steps }).length, 5_000);
});

test('the overflow line counts one remaining step in the singular', () => {
  const steps = Array.from({ length: plan.PLAN_STEP_LIMIT + 1 }, (unused, index) => ({ step: `Step ${index + 1}`, status: 'pending' }));
  const { markup } = planRow(codexPlanEvent(steps));
  assert.match(markup, /<li class="term-plan-more">and 1 more step<\/li>/);
  assert.doesNotMatch(markup, /more steps/);
});

test('a plan at the cap draws every step and no overflow line', () => {
  const steps = Array.from({ length: plan.PLAN_STEP_LIMIT }, (unused, index) => ({ step: `Step ${index + 1}`, status: 'pending' }));
  const { markup } = planRow(codexPlanEvent(steps));
  assert.equal((markup.match(/class="term-plan-step"/g) || []).length, plan.PLAN_STEP_LIMIT);
  assert.doesNotMatch(markup, /term-plan-more/);
});

test('an absurdly long step is clipped with an ellipsis and keeps a bounded hover title', () => {
  const long = 'A'.repeat(100_000);
  const { markup } = planRow(codexPlanEvent([{ step: long, status: 'pending' }]));

  const visible = markup.match(/<span class="term-plan-text" title="[^"]*">([^<]*)<\/span>/);
  assert.ok(visible, 'the clipped step carries a title');
  assert.equal(visible[1].length, plan.PLAN_STEP_TEXT_LIMIT);
  assert.ok(visible[1].endsWith('…'), 'a clipped step never reads as the whole step');

  const title = markup.match(/title="([^"]*)"/)[1];
  assert.equal(title.length, plan.ROW_TITLE_LIMIT);
  assert.ok(title.endsWith('…'));
  assert.ok(markup.length < 3_000, `one long step stays small (${markup.length} bytes)`);

  // The hover title is a convenience, not the record: the copied log stays lossless.
  const [entry] = groupEventEntries([codexPlanEvent([{ step: long, status: 'pending' }])]);
  assert.ok(eventCopyText(entry, RUNNING_TASK).includes(long));
});

test('a step short enough to render whole carries no title at all', () => {
  const { markup } = planRow(codexPlanEvent([{ step: 'Repair the fold', status: 'pending' }]));
  assert.match(markup, /<span class="term-plan-text">Repair the fold<\/span>/);
  assert.doesNotMatch(markup, /title=/);
});

test('the hover title on a clipped step is escaped like every other provider value', () => {
  const hostile = `" onmouseover="alert(1)" data-x="${'B'.repeat(500)}`;
  const { markup } = planRow(codexPlanEvent([{ step: hostile, status: 'pending' }]));
  // Every `"` in the output is a real attribute delimiter: the provider's own quotes are
  // escaped, so the handler it tried to open is inert text inside the title.
  assert.doesNotMatch(markup, /onmouseover="/, 'the quote that would close the attribute is escaped');
  assert.match(markup, /title="&quot; onmouseover=&quot;alert\(1\)&quot;/);
});

test('a long explanation, owner, and objective are bounded in the row and whole in the log', () => {
  const explanation = 'E'.repeat(100_000);
  const plans = planRow(codexPlanEvent([{ step: 'Step', status: 'pending', owner: 'O'.repeat(400) }], { explanation }));
  const rendered = plans.markup.match(/<p class="term-plan-explanation" title="[^"]*">([^<]*)<\/p>/);
  assert.ok(rendered, 'a clipped explanation carries a title');
  assert.equal(rendered[1].length, plan.PLAN_EXPLANATION_LIMIT);
  assert.ok(rendered[1].endsWith('…'));
  assert.match(plans.markup, /<span class="term-plan-owner">O{47}…<\/span>/);
  assert.ok(plans.markup.length < 4_000, `the row stays small (${plans.markup.length} bytes)`);

  const [entry] = groupEventEntries([codexPlanEvent([{ step: 'Step', status: 'pending' }], { explanation })]);
  assert.ok(eventCopyText(entry, RUNNING_TASK).includes(explanation), 'the copied log keeps the whole explanation');

  const objective = 'G'.repeat(100_000);
  const goal = goalRow([goalUpdatedEvent({ objective })]);
  const shown = goal.markup.match(/term-goal-objective" title="[^"]*">([^<]*)<\/span>/);
  assert.ok(shown, 'a clipped objective carries a title');
  assert.equal(shown[1].length, plan.GOAL_OBJECTIVE_LIMIT);
  assert.ok(shown[1].endsWith('…'));
  assert.ok(goal.markup.length < 3_000, `the goal row stays small (${goal.markup.length} bytes)`);

  const [goalEntry] = groupEventEntries([goalUpdatedEvent({ objective })]);
  assert.ok(eventCopyText(goalEntry, RUNNING_TASK).includes(objective), 'the copied log keeps the whole objective');
});

test('a step status naming an Object prototype member cannot reach the glyph map', () => {
  // The glyph, label, and marker maps are indexed by provider text. An unguarded lookup
  // renders `[object Object]` as the marker and a function body as the spoken status.
  for (const status of ['__proto__', 'constructor', 'toString', 'valueOf', 'hasOwnProperty']) {
    const markup = plan.planChecklistMarkup([{ step: 'Step', status }]);
    assert.match(markup, /data-plan-status="pending"/, `${status} degrades to pending`);
    assert.match(markup, /aria-hidden="true">☐<\/span>/);
    assert.match(markup, /<span class="sr-only">Pending<\/span>/);
    assert.doesNotMatch(markup, /\[object |native code|function /, `${status} renders no prototype member`);
    assert.equal(plan.planStepStatus(status), 'pending');
    assert.equal(plan.planCopyLines({ steps: [{ step: 'Step', status }] })[0], '[ ] Step');
  }
});

/* Fix 3: Claude board bookkeeping renders quietly beside the plan it produced ---------- */

test('a Claude board tool call renders as a quiet plan-board row', () => {
  const quiet = toolPresentation({}, planToolItem(), { provider: 'claude', state: 'success' });
  assert.equal(quiet.quiet, true);
  assert.equal(quiet.title, 'Plan board');
  assert.equal(quiet.glyph, '☰');
  // Quiet, not hidden: the route, the arguments, and the output all survive.
  assert.match(quiet.inline, /Claude Code<b>\/<\/b>TaskUpdate/);
  assert.match(quiet.body, /data-label="arguments"/);
  assert.match(quiet.body, /Task 3 updated\./);
});

test('an ordinary connected tool call is untouched by the quiet board reading', () => {
  const loud = toolPresentation({}, {
    type: 'mcpToolCall',
    id: 'toolu_other',
    server: 'chrome-devtools',
    tool: 'take_snapshot',
    arguments: {},
    status: 'completed',
    result: null,
  }, {});
  assert.equal(loud.quiet, false);
  assert.equal(loud.title, 'take_snapshot');
  assert.equal(loud.glyph, '◆');
});

test('a board tool call that failed reads loudly, like any other failure', () => {
  const failed = toolPresentation({}, planToolItem({ status: 'failed', result: { content: [{ type: 'text', text: 'Task not found.' }] } }), {});
  assert.equal(failed.quiet, false);
  assert.equal(failed.title, 'TaskUpdate');
  assert.equal(failed.status, 'failed');
  assert.equal(isPlanToolItem(planToolItem({ status: 'failed' })), false);
});

test('the copied log still carries a quiet board tool call in full', () => {
  const [entry] = groupEventEntries([{
    id: 1,
    kind: 'claude',
    message: 'Claude TaskUpdate completed.',
    created_at: '2026-08-12T09:00:00.000Z',
    payload: { type: 'item/completed', provider: 'claude', item: planToolItem() },
  }]);
  const text = eventCopyText(entry, RUNNING_TASK);
  assert.match(text.split('\n')[0], /· Plan board · completed$/);
  assert.match(text, /^Claude Code\/TaskUpdate$/m);
  assert.match(text, /"taskId": "3"/);
});
