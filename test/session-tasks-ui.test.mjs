import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);

const [html, app, style, sessionModule, uiTestSource, historyTestSource] = await Promise.all([
  readFile(new URL('public/index.html', root), 'utf8'),
  readFile(new URL('public/app.js', root), 'utf8'),
  readFile(new URL('public/style.css', root), 'utf8'),
  readFile(new URL('public/task-session-history.js', root), 'utf8'),
  readFile(new URL('test/session-tasks-ui.test.mjs', root), 'utf8'),
  readFile(new URL('test/task-session-history.test.mjs', root), 'utf8'),
]);

function functionBody(source, signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `${signature} should exist`);
  const end = source.indexOf('\n}', start);
  assert.notEqual(end, -1, `${signature} should close`);
  return source.slice(start, end);
}

/*
 * The session predicates are plain functions inside a DOM-coupled file, and the repo has
 * no DOM harness to import app.js into. Lifting the exact shipped source into a function
 * is the only way to run them for real: asserting that the identifier merely appears
 * would pass just as happily against a predicate that never returns true.
 */
function sessionPredicates() {
  const start = app.indexOf('function isSessionTask(task) {');
  assert.notEqual(start, -1, 'isSessionTask should exist');
  const end = app.indexOf('function isFailedSessionFollowUp', start);
  assert.notEqual(end, -1, 'the predicate block should be bounded');
  const source = app.slice(start, end);
  const build = new Function('taskContinuationSession', `${source}\nreturn { isSessionTask, isManualSessionTask, isDirectSessionTask, sessionTaskState, sessionBadgeWord, taskMonitorTasks, taskMonitorPresentation, taskMonitorResponse, taskMonitorResponseHash };`);
  return (thread = null) => build(() => thread);
}

/*
 * The hash decides whether a rebuild happens at all, so asserting that the identifier
 * appears would pass just as happily against a fold over prompt lengths. Lifting the
 * shipped source is the only way to prove a same-length edit moves it.
 */
function liftSessionTurnContentHash() {
  const source = functionBody(app, 'function sessionTurnContentHash(turns)');
  return new Function(`${source}\n}\nreturn sessionTurnContentHash;`)();
}

function mediaBlocks(source, feature) {
  return [...source.matchAll(new RegExp(`@media \\(prefers-reduced-motion: ${feature}\\)\\s*\\{([\\s\\S]*?)\\n\\}`, 'g'))]
    .map((match) => match[1]);
}

test('task activity markup carries the session strip and the conversation', () => {
  assert.match(html, /<section id="session-strip" class="session-strip"[^>]*hidden/);
  assert.match(html, /id="session-strip-context"/);
  assert.match(html, /id="session-strip-state"/);
  assert.match(html, /id="session-mode-badge"[^>]*>Manual finish<\/span>/);
  assert.match(html, /<p id="session-strip-message"[^>]*role="status"/);
  assert.match(html, /<button id="session-complete-button"[^>]*hidden>Complete session<\/button>/);
  assert.match(html, /<button id="session-kill-button"[^>]*type="button">Close terminal<\/button>/);
  assert.match(html, /<section id="session-history" class="detail-section session-history" hidden>/);
  assert.match(html, /id="session-history-count"/);
  assert.match(html, /<div id="session-history-turns" class="session-history-turns"><\/div>/);
  assert.match(html, /data-copy-content="conversation"/);
  assert.match(html, /aria-label="Copy conversation"/);

  // The strip message is the one live region. A state pill that re-announced on every
  // four-second thread refresh would talk over the rest of the panel.
  const strip = html.slice(html.indexOf('<section id="session-strip"'), html.indexOf('<section id="plan-preview"'));
  assert.doesNotMatch(strip, /aria-live/);
});

test('the terminal setting explains both session completion paths and workflow retention', () => {
  assert.match(html, /Complete session finishes the task without closing its terminal\./);
  assert.match(app, /manualSessionTerminalCloseCompletion/);
  assert.match(app, /Press Complete session to finish while keeping the terminal, or close the terminal to finish both/);
  assert.match(app, /This workflow completes automatically, but its terminals stay connected afterward/);
  assert.match(app, /Keep workflow terminals open/);
});

test('the session predicates admit exactly the tasks that own one retained conversation', () => {
  const { isSessionTask, isManualSessionTask, isDirectSessionTask } = sessionPredicates()();
  const session = { keep_terminal_open: true, terminal_lifecycle: 'disposable', mode: 'execute', provider: 'codex' };

  assert.equal(isSessionTask(session), true);
  assert.equal(isDirectSessionTask(session), true);
  assert.equal(isDirectSessionTask({ ...session, mode: 'breakdown' }), true);
  assert.equal(isDirectSessionTask({ ...session, provider: 'claude' }), true);
  // mode defaults to execute for rows written before the column existed.
  assert.equal(isDirectSessionTask({ ...session, mode: undefined }), true);
  assert.equal(isManualSessionTask({ ...session, manual_completion: true }), true);
  assert.equal(isManualSessionTask({ ...session, manual_completion: false }), false);
  assert.equal(isManualSessionTask({ ...session, manual_completion: true, mode: 'plan' }), false);
  assert.equal(isManualSessionTask({ ...session, manual_completion: true, provider: 'council' }), false);

  // keep_terminal_open is an INTEGER column. normalizeTask in src/database.mjs coerces it
  // to a real boolean, so === true is right; this pins the contract from the UI side. If
  // a raw 1 ever reaches the browser, the session surface silently disappears.
  assert.equal(isSessionTask({ ...session, keep_terminal_open: 1 }), false);
  assert.equal(isSessionTask({ ...session, keep_terminal_open: false }), false);
  assert.equal(isSessionTask({ ...session, terminal_lifecycle: 'persistent' }), false);

  // Plan council and Turbo hold several terminals, so no session surface for them.
  assert.equal(isDirectSessionTask({ ...session, mode: 'plan' }), false);
  assert.equal(isDirectSessionTask({ ...session, mode: 'turbo' }), false);
  assert.equal(isDirectSessionTask({ ...session, provider: 'council' }), false);
  assert.equal(isDirectSessionTask({}), false);
  assert.equal(isDirectSessionTask(null), false);
});

test('session state reads the bound thread and never claims an unlaunched terminal', () => {
  const build = sessionPredicates();
  const task = { id: 5, thread_id: 't1', provider: 'codex', repo_path: '/w' };

  const idle = build({ id: 't1', status: 'idle' });
  assert.equal(idle.sessionTaskState(task), 'open-idle');
  assert.equal(idle.sessionBadgeWord('open-idle'), 'open');

  const busy = build({ id: 't1', status: 'running' });
  assert.equal(busy.sessionTaskState(task), 'open-busy');
  assert.equal(busy.sessionBadgeWord('open-busy'), 'busy');

  const gone = build(null);
  assert.equal(gone.sessionTaskState(task), 'closed');
  assert.equal(gone.sessionBadgeWord('closed'), 'closed');
  // A queued task has no thread_id yet, so calling it closed would be a lie.
  assert.equal(gone.sessionTaskState({ ...task, thread_id: null }), 'pending');
  assert.equal(gone.sessionBadgeWord('pending'), 'pending');
  assert.equal(gone.sessionBadgeWord('nonsense'), 'unknown');
});

test('the global monitor retains an open manual session and names its live state', () => {
  const session = {
    id: 8,
    status: 'open',
    keep_terminal_open: true,
    manual_completion: true,
    terminal_lifecycle: 'disposable',
    mode: 'execute',
    provider: 'codex',
    thread_id: 't1',
    repo_path: '/w',
  };
  const idle = sessionPredicates()({ id: 't1', status: 'idle' });
  const runningFeedTask = { id: 2, status: 'running', latestAgentUpdate: { text: 'Working' } };
  const monitored = idle.taskMonitorTasks([runningFeedTask], [runningFeedTask, session, {
    ...session,
    id: 9,
    status: 'complete',
  }]);

  assert.deepEqual(monitored.map((task) => task.id), [2, 8]);
  assert.deepEqual(idle.taskMonitorPresentation(session), {
    state: 'idle',
    label: 'Terminal idle',
    terminalSession: true,
  });
  assert.equal(idle.taskMonitorResponse(session), 'Ready for another command');
  assert.equal(idle.taskMonitorResponse({ ...session, result: 'Last result' }), 'Last result');
  assert.equal(idle.taskMonitorResponse({ ...session, result: 'Old result', error: 'Latest failure' }), 'Latest failure');
  assert.notEqual(
    idle.taskMonitorResponseHash({ ...session, result: 'review the queue' }),
    idle.taskMonitorResponseHash({ ...session, result: 'review the cache' }),
  );

  const busy = sessionPredicates()({ id: 't1', status: 'running' });
  assert.equal(busy.taskMonitorPresentation(session).label, 'Terminal busy');
  assert.equal(busy.taskMonitorPresentation({ ...session, status: 'running' }).label, 'Session running');

  const closed = sessionPredicates()(null);
  assert.equal(closed.taskMonitorPresentation(session).label, 'Terminal closed');
  assert.equal(closed.taskMonitorResponse(session), 'Send a command to relaunch this session');
  assert.deepEqual(closed.taskMonitorPresentation({ status: 'running' }), {
    state: 'running',
    label: 'Running',
    terminalSession: false,
  });

  const backendAlreadyIncludesSession = idle.taskMonitorTasks(
    [runningFeedTask, { ...session, latestAgentUpdate: { text: 'Last response' } }],
    [runningFeedTask, session],
  );
  assert.deepEqual(backendAlreadyIncludesSession.map((task) => task.id), [2, 8]);
  assert.equal(backendAlreadyIncludesSession[1].latestAgentUpdate.text, 'Last response');
});

test('queue cards mark a direct session task with a word, not only a colour', () => {
  assert.match(app, /function isSessionTask\(task\)/);
  assert.match(app, /function isDirectSessionTask\(task\)/);
  assert.match(app, /keep_terminal_open === true/);
  assert.match(app, /data-session="true" data-session-state=/);
  assert.match(app, /data-manual-completion="true"/);
  assert.match(app, /class="task-session-modebar"/);
  assert.match(app, /Terminal session<\/span>/);
  assert.match(app, /<b>Manual finish<\/b>/);
  assert.match(app, /class="task-session-badge" data-session-state=/);
  assert.match(app, /manualSessionCard \? 'Terminal' : 'Session'/);
  assert.match(app, /· \$\{escapeHtml\(sessionWord\)\}/);
  assert.match(app, /terminal session with manual completion/);
  assert.match(app, /sessionCard \? ', retained session' : ''/);

  const badgeWords = functionBody(app, 'const SESSION_BADGE_WORDS = {');
  for (const word of ["'open'", "'busy'", "'pending'", "'closed'"]) {
    assert.ok(badgeWords.includes(word), `badge word ${word} should exist`);
  }
});

test('the top or bottom task monitor marks manual sessions without dropping idle ones', () => {
  assert.match(html, /aria-label="Active tasks and terminal sessions across all projects"/);
  assert.match(html, /No active tasks or sessions/);
  assert.match(app, /state\.runningTasks = taskMonitorTasks\([\s\S]{0,100}statusBody\.monitoredTasks \|\| statusBody\.runningTasks,[\s\S]{0,100}state\.tasks/);
  assert.match(app, /data-terminal-session="true"/);
  assert.match(app, /class="header-running-state" data-state=/);
  assert.match(app, /'Session running'/);
  assert.match(app, /'Terminal idle'/);
  assert.match(app, /'Terminal busy'/);
  assert.match(app, /'Terminal closed'/);
  assert.match(app, /taskMonitorResponseHash\(task\)/);
  assert.match(app, /taskMonitorPresentation\(task\)\.state/);
  assert.match(style, /\.header-running-state\[data-state="idle"\]/);
  assert.match(style, /html\[data-theme="dark"\] \.header-running-state\[data-state="idle"\]/);
});

test('the session surface replaces the flat prompt and result disclosures', () => {
  assert.match(app, /const sessionSurface = isDirectSessionTask\(task\);/);
  // Assigned, not conditionally hidden: nothing else unhides #prompt-section, so a
  // one-way hide would follow the user onto the next ordinary task.
  assert.match(app, /elements\.promptSection\.hidden = sessionSurface;/);
  assert.match(app, /elements\.resultSection\.hidden = sessionSurface;/);
  assert.match(app, /buildSessionTurns\(\{ task, prompts: promptHistory, responses \}\)/);
  assert.match(app, /conversation: sessionSurface/);
  assert.match(app, /sessionConversationText\(sessionTurns, \{ responseLabel:/);
  assert.match(app, /renderSessionStrip\(task, sessionSurface\);/);
  assert.match(app, /renderSessionHistory\(task, sessionTurns, sessionSurface\);/);
});

test('the conversation survives the two-second refresh', () => {
  assert.match(app, /expandedSessionTurns: new Map\(\)/);
  assert.match(app, /function rememberSessionDisclosures\(\)/);
  assert.match(app, /function restoreSessionDisclosures\(taskId\)/);
  assert.match(app, /function sessionHistorySignature\(task, turns\)/);
  // A skipped rebuild is the whole point: no innerHTML write means no scroll reset.
  assert.match(app, /if \(sameTask && container\.dataset\.signature === signature\) return;/);
  // Terminal state stays out of the signature: the four-second thread poll flips it
  // repeatedly and no part of a turn is drawn from it.
  const signature = functionBody(app, 'function sessionHistorySignature(task, turns)');
  assert.doesNotMatch(signature, /sessionTaskState/);
  // The remembered choice outranks the newest-turn default.
  assert.match(app, /if \(state\.expandedSessionTurns\.has\(key\)\) details\.open = state\.expandedSessionTurns\.get\(key\);/);

  // Editing a queued session task through PATCH /api/tasks/:id rewrites task.prompt into
  // the first turn and can switch the provider that names every response, while the id,
  // the status and both counts stay identical. Without these two the skipped rebuild
  // leaves the stale conversation on screen until some unrelated change lands.
  // taskProvider, not the raw column: renderSessionHistory labels every response with
  // providerLabel(taskProvider(task)), which reads 'Codex' for a row carrying no provider
  // at all, so signing task.provider would split one rendered state into two signatures.
  assert.match(signature, /taskProvider\(task\)/);
  assert.match(signature, /sessionTurnContentHash\(turns\)/);

  const contentHash = liftSessionTurnContentHash();
  const turnsFrom = (texts) => texts.map((text, index) => ({
    id: `turn-${index + 1}`,
    prompt: { text, created_at: '2026-08-03T10:00:00.000Z' },
  }));
  assert.equal(contentHash(turnsFrom(['review the queue'])), contentHash(turnsFrom(['review the queue'])));
  // Same length, different text: the case a signature built from lengths cannot see.
  assert.notEqual(contentHash(turnsFrom(['review the queue'])), contentHash(turnsFrom(['review the cache'])));
  assert.notEqual(contentHash(turnsFrom(['one', 'two'])), contentHash(turnsFrom(['two', 'one'])));
  // A turn identity or timestamp change is rendered too, so it has to move the fold.
  assert.notEqual(contentHash(turnsFrom(['same'])), contentHash([{ id: 'turn-9', prompt: { text: 'same', created_at: '2026-08-03T10:00:00.000Z' } }]));
  assert.notEqual(contentHash(turnsFrom(['same'])), contentHash([{ id: 'turn-1', prompt: { text: 'same', created_at: null } }]));
});

test('closing a retained terminal confirms first and reports into the strip', () => {
  const kill = functionBody(app, 'async function killSessionTerminal()');
  assert.match(kill, /state\.killingSessionTaskId/);
  assert.match(kill, /window\.confirm\(/);
  assert.match(kill, /Close the retained terminal for task #/);
  assert.match(kill, /api\(`\/api\/terminals\/\$\{encodeURIComponent\(threadId\)\}`, \{ method: 'DELETE' \}\)/);
  assert.match(kill, /message\.dataset\.kind = 'success'/);
  assert.match(kill, /message\.dataset\.kind = 'error'/);
  assert.match(kill, /loadThreads\(\)/);
  assert.match(kill, /load\(\{ fresh: true \}\)/);
  // Errors belong to the strip, never to the composer message line.
  assert.doesNotMatch(kill, /elements\.formMessage/);

  const strip = functionBody(app, 'function renderSessionStrip(task, active)');
  assert.match(strip, /capabilities\?\.terminalControl === true/);
  assert.match(strip, /Restart CC Relay to close terminals from here\./);
  assert.match(strip, /button\.hidden = !thread;/);
  assert.match(strip, /control\?\.canClose !== true/);
  assert.match(strip, /control\?\.reason \|\|/);
  assert.match(strip, /closing \? 'Closing' : 'Close terminal'/);
  // A close outcome has to outlive the next refresh that repaints the hint, and the
  // live region must not be rewritten with a sentence it already holds.
  assert.match(strip, /!\['error', 'success'\]\.includes\(message\.dataset\.kind\) && message\.textContent !== stripHint/);
  // The state pill is not a live region, so it may be written on every refresh.
  assert.match(strip, /elements\.sessionStripState\.textContent = label;/);

  // Wired once at startup, resolving its target from the button dataset.
  assert.match(app, /elements\.sessionKillButton\.addEventListener\('click', killSessionTerminal\);/);
});

test('manual terminal sessions support explicit completion and automatic terminal-close completion', () => {
  const strip = functionBody(app, 'function renderSessionStrip(task, active)');
  assert.match(strip, /const manualSession = isManualSessionTask\(task\)/);
  assert.match(strip, /manualSessionTerminalCloseCompletion/);
  assert.match(strip, /elements\.sessionStrip\.dataset\.completion = manualSession \? 'manual' : 'automatic'/);
  assert.match(strip, /task\.status === 'open'/);
  assert.match(strip, /'Complete session'/);
  assert.match(strip, /completeButton\.disabled = !completionSupported/);
  assert.match(strip, /The retained terminal will remain open/);
  assert.match(strip, /will complete this task after it confirms that the terminal is closed/);
  assert.match(strip, /completes this terminal session task/);

  const complete = functionBody(app, 'async function completeTerminalSession()');
  assert.match(complete, /task\.status !== 'open'/);
  assert.match(complete, /api\(`\/api\/tasks\/\$\{taskId\}\/complete-session`, \{ method: 'POST' \}\)/);
  assert.match(complete, /Session completed\. The retained terminal remains open until you close it\./);
  assert.match(complete, /Session completed\. Its terminal was already closed\./);
  assert.doesNotMatch(complete, /api\(`\/api\/terminals/);

  const close = functionBody(app, 'async function killSessionTerminal()');
  assert.match(close, /const completesTask = state\.status\?\.capabilities\?\.manualSessionTerminalCloseCompletion === true[\s\S]{0,100}isManualSessionTask\(task\)/);
  assert.match(close, /Closing it also completes this terminal session task/);
  assert.match(close, /was closed and the session task was completed/);

  assert.match(app, /elements\.sessionCompleteButton\.addEventListener\('click', completeTerminalSession\);/);
  assert.match(app, /task\.status === 'open'[\s\S]{0,220}'Send command'/);
  assert.match(app, /manualSessionComplete = manualSession && task\.status === 'complete'/);
  assert.match(app, /continuationForm\.hidden = !direct \|\| manualSessionComplete/);
});

test('running automatic tasks expose a colorful latched auto-close control', () => {
  assert.match(html, /id="terminal-retention-message"[^>]*role="status"/);
  const retention = functionBody(app, 'async function keepRunningTaskTerminalOpen(task)');
  assert.match(retention, /task\.status !== 'running'/);
  assert.match(retention, /task\.terminal_lifecycle !== 'disposable'/);
  assert.match(retention, /api\(`\/api\/tasks\/\$\{task\.id\}\/keep-terminal-open`, \{ method: 'POST' \}\)/);
  assert.match(retention, /terminalRetentionSavingTaskIds\.has\(task\.id\)/);
  assert.match(retention, /terminalRetentionFeedback/);
  assert.doesNotMatch(retention, /window\.alert/);

  assert.match(app, /terminalRetentionSavingTaskIds: new Set\(\)/);
  assert.match(app, /terminalRetentionFeedback: new Map\(\)/);
  assert.match(app, /capabilities\?\.liveTerminalRetention === true/);
  assert.match(app, /'Stop auto-close'/);
  assert.match(app, /'Auto-close stopped'/);
  assert.match(app, /setAttribute\('aria-pressed', String\(retentionEnabled\)\)/);
  assert.match(app, /retentionButton\.disabled = retentionEnabled \|\| retentionPending \|\| !retentionSupported/);

  for (const stateName of ['available', 'pending', 'protected', 'unsupported']) {
    assert.ok(style.includes(`.terminal-retention-button[data-state="${stateName}"]`));
  }
  assert.match(
    style,
    /\.detail-panel \.detail-actions \.terminal-retention-button \{[\s\S]*?border-radius: 8px;/,
  );
  const retentionIcon = style.slice(
    style.indexOf('.terminal-retention-button::before {'),
    style.indexOf('.terminal-retention-button[data-state="available"] {'),
  );
  assert.match(retentionIcon, /-webkit-mask: url\(/);
  assert.doesNotMatch(retentionIcon, /border-radius: 50%/);
  assert.match(style, /html\[data-theme="dark"\] \.terminal-retention-button\[data-state="protected"\]/);
  const noPreference = mediaBlocks(style, 'no-preference');
  assert.ok(noPreference.some((body) => body.includes('terminal-retention-pulse')));
});

test('session surfaces are styled in both themes with motion guarded', () => {
  for (const selector of [
    '.task-session-badge',
    '.task-card[data-session="true"]',
    '.session-strip',
    '.session-strip-state',
    '.session-strip-message',
    '.session-history-turns',
    '.session-turn',
    '.session-turn-response',
    '.session-turn-pending',
    '.task-session-modebar',
    '.session-mode-badge',
    '.session-complete-button',
    '.header-running-state',
  ]) {
    assert.ok(style.includes(`${selector} {`) || style.includes(`${selector}[`), `${selector} should be styled`);
    assert.ok(style.includes(`html[data-theme="dark"] ${selector}`), `${selector} should have a dark treatment`);
  }

  assert.match(style, /@keyframes session-turn-pulse/);
  assert.match(style, /#task-detail:has\(\.session-strip\[data-completion="manual"\]:not\(\[hidden\]\)\)[^{]*\{\s*grid-template-rows: minmax\(15em, 1fr\)/);
  // Declaring the animation only inside the no-preference query is the guard: under a
  // reduced-motion preference the rule never applies. A matching reduce block would be
  // redundant, and planner-board.test.mjs reads the last reduce block in the file.
  const noPreference = mediaBlocks(style, 'no-preference');
  assert.ok(noPreference.some((body) => body.includes('session-turn-pulse')), 'the pulse should only run without a reduced-motion preference');
  const uses = style.match(/animation: session-turn-pulse/g) || [];
  const guardedUses = noPreference.filter((body) => body.includes('animation: session-turn-pulse')).length;
  assert.equal(uses.length, guardedUses, 'every use of the pulse must sit inside the guard');
  // planner-board.test.mjs reads the LAST reduce block in the file, so appending one here
  // would silently break it. Pin the coupling instead of rediscovering it.
  const lastReduceStart = style.lastIndexOf('@media (prefers-reduced-motion: reduce)');
  const lastReduce = style.slice(lastReduceStart, style.indexOf('\n}', lastReduceStart) + 2);
  assert.match(lastReduce, /\.planner-step-spinner \{ animation: none; \}/);
  assert.doesNotMatch(lastReduce, /session-turn/);

  // .task-card.selected owns the inset shadow channel; the session cue must not fight it.
  const sessionCard = style.slice(style.indexOf('.task-card[data-session="true"] {'));
  assert.doesNotMatch(sessionCard.slice(0, 200), /box-shadow/);
  assert.doesNotMatch(style, /session-turn[^{]*\{[^}]*linear-gradient/);
});

test('no em dash characters reach the session sources', () => {
  const emDash = String.fromCharCode(0x2014);
  for (const [name, source] of Object.entries({
    'public/task-session-history.js': sessionModule,
    'test/session-tasks-ui.test.mjs': uiTestSource,
    'test/task-session-history.test.mjs': historyTestSource,
    'public/index.html': html,
    'public/app.js': app,
    'public/style.css': style,
  })) {
    assert.equal(source.includes(emDash), false, `${name} should hold no em dash`);
  }
});
