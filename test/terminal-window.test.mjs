import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const markup = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const server = readFileSync(new URL('../src/server.mjs', import.meta.url), 'utf8');

const eventToolbar = markup.slice(
  markup.indexOf('<div class="event-tools">'),
  markup.indexOf('<div id="detail-events"'),
);
const terminalWindowDialog = markup.slice(
  markup.indexOf('<dialog id="terminal-window-modal"'),
  markup.indexOf('</dialog>', markup.indexOf('<dialog id="terminal-window-modal"')),
);

test('the event toolbar opens the terminal window dialog', () => {
  assert.ok(eventToolbar.includes('id="terminal-window-open"'), 'the open button lives in the event toolbar');
  assert.match(eventToolbar, /id="terminal-window-open"[\s\S]*?aria-haspopup="dialog"/);
  assert.match(eventToolbar, /id="terminal-window-open"[\s\S]*?aria-controls="terminal-window-modal"/);
  assert.match(eventToolbar, /id="terminal-window-open"[\s\S]*?<span>Window<\/span>/);
  assert.match(app, /terminalWindowOpenButton: document\.querySelector\('#terminal-window-open'\)/);
  assert.match(app, /elements\.terminalWindowOpenButton\.addEventListener\('click', openTerminalWindow\)/);
});

test('the terminal window dialog is a sibling of the events section and owns a mount point', () => {
  const eventsSectionIndex = markup.indexOf('<section class="detail-section events-section"');
  const dialogIndex = markup.indexOf('<dialog id="terminal-window-modal"');
  assert.ok(eventsSectionIndex >= 0);
  assert.ok(dialogIndex > eventsSectionIndex, 'the dialog follows the events section');
  assert.ok(
    dialogIndex > markup.indexOf('</section>', eventsSectionIndex),
    'the dialog sits outside the events section, not inside it',
  );
  assert.match(terminalWindowDialog, /aria-labelledby="terminal-window-title"/);
  assert.match(terminalWindowDialog, /id="terminal-window-mount" class="terminal-window-mount"/);
  assert.match(terminalWindowDialog, /id="terminal-window-title"/);
  assert.match(terminalWindowDialog, /id="terminal-window-subtitle"/);
  assert.match(terminalWindowDialog, /id="terminal-window-close"[\s\S]*?aria-label="Close terminal window"/);
  assert.match(app, /terminalWindowMount: document\.querySelector\('#terminal-window-mount'\)/);
});

test('the window rail exposes the native terminal plus three counted conversation views', () => {
  const views = [...terminalWindowDialog.matchAll(/data-terminal-window-view="([a-z]+)"/g)]
    .map((match) => match[1]);
  assert.deepEqual(views, ['all', 'conversation', 'mine', 'ai']);
  assert.match(terminalWindowDialog, /data-terminal-window-view="all"[\s\S]*?>Terminal</);
  assert.match(terminalWindowDialog, /data-terminal-window-view="conversation"[\s\S]*?>Conversation</);
  assert.match(terminalWindowDialog, /data-terminal-window-view="mine"[\s\S]*?>My messages</);
  assert.match(terminalWindowDialog, /data-terminal-window-view="ai"[\s\S]*?>AI messages</);
  assert.match(terminalWindowDialog, /data-terminal-window-view="all"[\s\S]*?class="terminal-window-live-badge"[\s\S]*?>Live</);
  assert.doesNotMatch(
    terminalWindowDialog.match(/data-terminal-window-view="all"[\s\S]*?<\/button>/)?.[0] || '',
    /data-terminal-window-view-count/,
  );
  for (const view of views.filter((item) => item !== 'all')) {
    assert.match(
      terminalWindowDialog,
      new RegExp(`data-terminal-window-view="${view}"[\\s\\S]*?data-terminal-window-view-count`),
      `${view} carries a count badge`,
    );
  }
  assert.match(terminalWindowDialog, /role="group" aria-label="Terminal window view"/);
});

test('the default Terminal view owns a real Terminal.app screen surface', () => {
  const eventsSection = markup.slice(
    markup.indexOf('<section class="detail-section events-section"'),
    markup.indexOf('<dialog id="terminal-window-modal"'),
  );
  assert.match(eventsSection, /id="native-terminal-screen"[\s\S]*?data-state="loading"[\s\S]*?hidden/);
  assert.match(eventsSection, /id="native-terminal-screen-title">Terminal\.app</);
  assert.match(eventsSection, /id="native-terminal-screen-state"[\s\S]*?role="status"/);
  assert.match(eventsSection, /id="native-terminal-screen-output"[\s\S]*?aria-label="Live native terminal screen"/);
  assert.match(app, /api\(`\/api\/tasks\/\$\{taskId\}\/terminal-screen`/);
  assert.match(app, /if \(output\.textContent !== next\.text\) output\.textContent = next\.text/);
  assert.match(app, /view === 'all' \? 'Terminal: live native screen'/);
});

test('the terminal screen API is task scoped and delegates to owned native identity', () => {
  assert.match(server, /nativeTerminalScreen: process\.platform === 'darwin'/);
  const routeStart = server.indexOf("/^\\/api\\/tasks\\/\\d+\\/terminal-screen$/");
  const routeEnd = server.indexOf("/^\\/api\\/tasks\\/\\d+\\/plan$/", routeStart);
  assert.ok(routeStart >= 0 && routeEnd > routeStart, 'the task terminal screen route exists');
  const route = server.slice(routeStart, routeEnd);
  assert.match(route, /const task = database\.getTask\(taskId\)/);
  assert.match(route, /if \(!task\.thread_id\)/);
  assert.match(route, /\.\.\.\(knownTerminalThread \|\| \{\}\),\s*id: task\.thread_id,\s*provider: task\.provider,\s*cwd: task\.repo_path,/);
  assert.match(route, /await projectLauncher\.readTerminalScreen\(task\.thread_id, terminalThread\)/);
  assert.match(route, /provider: terminal\.provider \|\| task\.provider/);
  assert.match(route, /source: terminal\.source \|\| 'Terminal\.app'/);
  assert.doesNotMatch(route, /terminalWindowId|terminalTty/, 'the browser cannot select native identity');
});

test('the dialog header owns an empty slot the docked tools cluster moves into', () => {
  /*
   * While docked the .event-toolbar row is hidden, so leaving Thinking and Copy log
   * behind would strand them in an otherwise empty strip. The slot is empty markup: the
   * live cluster is MOVED into it, never duplicated, so there is still one of each
   * control in the document and every existing listener keeps its element.
   */
  assert.match(terminalWindowDialog, /<div id="terminal-window-tools" class="terminal-window-tools"><\/div>/);
  const header = terminalWindowDialog.slice(
    terminalWindowDialog.indexOf('<div class="terminal-window-header">'),
    terminalWindowDialog.indexOf('<div class="terminal-window-body">'),
  );
  const viewsIndex = header.indexOf('<div id="terminal-window-views"');
  const toolsIndex = header.indexOf('<div id="terminal-window-tools"');
  const closeIndex = header.indexOf('<button id="terminal-window-close"');
  assert.ok(viewsIndex >= 0, 'the rail is in the header');
  assert.ok(toolsIndex > viewsIndex, 'the tools slot follows the rail');
  assert.ok(closeIndex > toolsIndex, 'the close button still ends the header');
  for (const id of ['terminal-window-open', 'thinking-visibility-button', 'copy-events-button']) {
    assert.equal(
      [...markup.matchAll(new RegExp(`id="${id}"`, 'g'))].length,
      1,
      `${id} exists exactly once, so the cluster is moved and not cloned`,
    );
  }
  assert.match(app, /eventTools: document\.querySelector\('\.event-tools'\)/);
  assert.match(app, /terminalWindowTools: document\.querySelector\('#terminal-window-tools'\)/);
});

test('the persisted view defaults to all and rejects unknown stored values', () => {
  assert.match(app, /const TERMINAL_WINDOW_VIEWS = \['all', 'conversation', 'mine', 'ai'\];/);
  assert.match(app, /const TERMINAL_WINDOW_VIEW_DEFAULT = 'all';/);
  assert.match(
    app,
    /function normalizeTerminalWindowView\(value\) \{\s*return TERMINAL_WINDOW_VIEWS\.includes\(value\)\s*\? value\s*: TERMINAL_WINDOW_VIEW_DEFAULT;/,
  );
  assert.match(
    app,
    /terminalWindowView: normalizeTerminalWindowView\(localStorage\.getItem\('relay\.terminalWindowView'\)\)/,
  );
  // The whitelist must be the only gate: an unknown cached string cannot reach state.
  assert.doesNotMatch(app, /state\.terminalWindowView = localStorage\.getItem/);
});

test('the window view rides the shared preference record with a local cache fallback', () => {
  const payload = app.slice(app.indexOf('function uiPreferencesPayload()'), app.indexOf('function cacheUiPreferences'));
  assert.match(payload, /terminalWindowView: state\.terminalWindowView,/);
  assert.match(
    app,
    /localStorage\.setItem\(\s*'relay\.terminalWindowView',\s*normalizeTerminalWindowView\(preferences\.terminalWindowView \?\? state\.terminalWindowView\),\s*\)/,
  );
  // An older server that predates the member must not erase the remembered choice.
  assert.match(
    app,
    /if \(preferences\.terminalWindowView != null\) \{\s*setTerminalWindowView\(preferences\.terminalWindowView, \{ persist: false, render: false \}\);/,
  );
  assert.match(app, /if \(persist\) queueUiPreferencesSave\(\);\s*if \(render\) rerenderTerminalWindowStream\(\)/);
});

test('opening the window reparents the live section and applies the persisted view', () => {
  const open = app.slice(app.indexOf('function openTerminalWindow()'), app.indexOf('function undockTerminalWindow'));
  assert.match(open, /state\.inlineEventFilter = state\.eventFilter;/);
  // One record holds both slots, so one re-entrancy guard and one clear cover both moves.
  assert.match(open, /state\.terminalWindowDock = \{\s*parent: elements\.eventsSection\.parentNode,\s*nextSibling: elements\.eventsSection\.nextSibling,\s*toolsParent: elements\.eventTools\.parentNode,\s*toolsNextSibling: elements\.eventTools\.nextSibling,\s*scrollTop: elements\.detailEvents\.scrollTop,\s*follow: state\.eventFollow,\s*\}/);
  assert.match(open, /elements\.terminalWindowMount\.append\(elements\.eventsSection\)/);
  assert.match(open, /elements\.eventsSection\.dataset\.terminalWindow = 'open'/);
  assert.match(open, /elements\.terminalWindowTools\.append\(elements\.eventTools\)/);
  // Both slots are captured before either move, and the cluster follows the docked
  // section rather than leading it.
  assert.ok(
    open.indexOf('state.terminalWindowDock = {') < open.indexOf('elements.terminalWindowMount.append'),
    'the dock record is captured before the section moves',
  );
  assert.ok(
    open.indexOf('toolsParent: elements.eventTools.parentNode') < open.indexOf('elements.terminalWindowTools.append'),
    'the tools slot is captured before the cluster moves',
  );
  assert.ok(
    open.indexOf('elements.terminalWindowMount.append') < open.indexOf('elements.terminalWindowTools.append'),
    'the cluster moves after the section is docked',
  );
  assert.ok(
    open.indexOf('elements.terminalWindowTools.append') < open.indexOf('elements.terminalWindowModal.showModal()'),
    'the dialog never opens with an empty tools slot',
  );
  assert.match(open, /state\.eventFilter = state\.terminalWindowView;/);
  assert.match(open, /elements\.terminalWindowModal\.showModal\(\)/);
  // Scroll and follow-to-bottom survive the reattach, and focus lands on the live view.
  assert.match(open, /const follow = state\.eventFollow;/);
  assert.match(open, /rerenderTerminalWindowStream\(\{ forceBottom: follow \}\)/);
  assert.match(open, /if \(!follow\) elements\.detailEvents\.scrollTop = restoreScrollTop;/);
  assert.match(open, /pressed\?\.focus\(\)/);
  // There is one render target: no cloned markup and no second event list.
  assert.doesNotMatch(app, /cloneNode\(true\)[\s\S]{0,80}eventsSection/);
});

test('closing the window restores the inline filter and the original DOM slot', () => {
  const undock = app.slice(app.indexOf('function undockTerminalWindow()'), app.indexOf('function focusTerminalWindowOpenButton'));
  assert.match(undock, /dock\.parent\.insertBefore\(elements\.eventsSection, returnsBefore\)/);
  assert.match(undock, /returnsBefore = dock\.nextSibling && dock\.nextSibling\.parentNode === dock\.parent/);
  assert.match(undock, /delete elements\.eventsSection\.dataset\.terminalWindow;/);
  assert.match(undock, /state\.eventFilter = state\.inlineEventFilter;/);
  // The tools cluster is restored through the same revalidated slot, and it goes home
  // first so the section never lands in the detail grid missing its own controls.
  assert.match(
    undock,
    /toolsReturnBefore = dock\.toolsNextSibling\s*&& dock\.toolsNextSibling\.parentNode === dock\.toolsParent/,
  );
  assert.match(undock, /dock\.toolsParent\.insertBefore\(elements\.eventTools, toolsReturnBefore\)/);
  assert.ok(
    undock.indexOf('dock.toolsParent.insertBefore') < undock.indexOf('dock.parent.insertBefore'),
    'the tools cluster is restored before the section is',
  );
  assert.ok(
    undock.indexOf('state.terminalWindowDock = null;') < undock.indexOf('dock.toolsParent.insertBefore'),
    'the dock is cleared before either reinsertion',
  );
  const close = app.slice(
    app.indexOf('function closeTerminalWindow()'),
    app.indexOf('function focusTaskDetailLandmark'),
  );
  // A close with nothing open is a no-op, so a hide route can call it defensively without
  // yanking focus onto an enabled Window button.
  assert.match(close, /if \(!terminalWindowIsDocked\(\) && !elements\.terminalWindowModal\?\.open\) return;/);
  assert.match(
    close,
    /undockTerminalWindow\(\);\s*if \(elements\.terminalWindowModal\?\.open\) elements\.terminalWindowModal\.close\(\);\s*else focusTerminalWindowOpenButton\(\);/,
  );
});

test('close replays the inline reading position the dock recorded, not the window position', () => {
  const undock = app.slice(app.indexOf('function undockTerminalWindow()'), app.indexOf('function focusTerminalWindowOpenButton'));
  // A closed dialog is display:none and the window list has a different height, so a
  // scrollTop read at close time would be wrong twice over.
  assert.doesNotMatch(undock, /= elements\.detailEvents\.scrollTop;/);
  assert.doesNotMatch(undock, /= state\.eventFollow;/);
  assert.match(undock, /state\.eventFollow = dock\.follow;/);
  assert.match(undock, /rerenderTerminalWindowStream\(\{ forceBottom: dock\.follow \}\)/);
  assert.match(undock, /if \(!dock\.follow\) elements\.detailEvents\.scrollTop = dock\.scrollTop;/);
  // Follow is restored before the render, because renderEventStream reads state.eventFollow.
  assert.ok(
    undock.indexOf('state.eventFollow = dock.follow;') < undock.indexOf('rerenderTerminalWindowStream'),
    'follow is restored before the stream renders',
  );
});

test('the terminal resize handle never describes the dialog height', () => {
  const applyHeight = app.slice(app.indexOf('function applyTerminalHeight'), app.indexOf('elements.terminalHeightResizer.addEventListener'));
  assert.match(
    applyHeight,
    /if \(!terminalWindowIsDocked\(\)\) \{\s*const renderedHeight = elements\.eventsSection\.getBoundingClientRect\(\)\.height;\s*updateTerminalHeightAccessibility\(renderedHeight, maximum\);/,
  );
  const undock = app.slice(app.indexOf('function undockTerminalWindow()'), app.indexOf('function focusTerminalWindowOpenButton'));
  assert.match(undock, /applyTerminalHeight\(\);/);
});

test('focus returns to the open button only after the dialog has closed', () => {
  // Everything outside an open modal dialog is inert, so focusing from cancel is dropped.
  const undock = app.slice(app.indexOf('function undockTerminalWindow()'), app.indexOf('function focusTerminalWindowOpenButton'));
  assert.doesNotMatch(undock, /\.focus\(\)/);
  // The button is skipped when it is disabled or sitting in a hidden panel, and focus
  // lands on the empty-detail landmark rather than falling to the document body.
  assert.match(
    app,
    /function focusTerminalWindowOpenButton\(\) \{\s*const button = elements\.terminalWindowOpenButton;\s*if \(button && button\.isConnected && !button\.disabled && !elements\.taskDetail\.hidden\) \{\s*button\.focus\(\);\s*return;\s*\}\s*focusTaskDetailLandmark\(\);/,
  );
  const landmark = app.slice(
    app.indexOf('function focusTaskDetailLandmark()'),
    app.indexOf('function hideTaskDetailPanel'),
  );
  assert.match(landmark, /if \(!node \|\| !node\.isConnected \|\| node\.hidden\) continue;/);
  assert.match(landmark, /if \(!node\.hasAttribute\('tabindex'\)\) node\.setAttribute\('tabindex', '-1'\);/);
  assert.match(
    app,
    /elements\.terminalWindowModal\.addEventListener\('close', \(\) => \{\s*undockTerminalWindow\(\);\s*focusTerminalWindowOpenButton\(\);/,
  );
});

test('escape and backdrop close only the terminal window', () => {
  assert.match(
    app,
    /elements\.terminalWindowModal\.addEventListener\('click', \(event\) => \{\s*if \(event\.target === elements\.terminalWindowModal\) closeTerminalWindow\(\);/,
  );
  assert.match(app, /elements\.terminalWindowModal\.addEventListener\('cancel', \(\) => \{\s*undockTerminalWindow\(\);/);
  assert.match(app, /elements\.terminalWindowModal\.addEventListener\('close', \(\) => \{\s*undockTerminalWindow\(\);/);
  // Escape must never reach the surrounding task detail dialog.
  assert.doesNotMatch(app, /terminalWindowModal\.addEventListener\('cancel'[\s\S]{0,200}closeTaskDetailModal/);
  assert.doesNotMatch(app, /terminalWindowModal\.addEventListener\('close'[\s\S]{0,200}closeTaskDetailModal/);
});

test('the window rail reuses the computed filter counts and never recomputes them', () => {
  assert.match(app, /updateTerminalWindowControls\(filterCounts\);\s*updateThinkingVisibilityControl\(reasoningCount\);/);
  assert.match(app, /updateEventControls\(filterCounts, reasoningCount\);/);
  const controls = app.slice(
    app.indexOf('function updateTerminalWindowControls'),
    app.indexOf('function rerenderTerminalWindowStream'),
  );
  assert.match(controls, /const count = Number\(filterCounts\[view\]\) \|\| 0;/);
  assert.doesNotMatch(controls, /filterEventEntries|eventMessageCounts|groupEventEntries/);
  assert.match(controls, /button\.setAttribute\('aria-pressed', String\(view === state\.terminalWindowView\)\)/);
  assert.match(controls, /counter\.textContent = count\.toLocaleString\(\)/);
});

test('the ai view label is provider derived and never hardcoded to one provider', () => {
  assert.match(
    app,
    /function terminalWindowAiLabel\(task\) \{[\s\S]*?return task \? `\$\{providerLabel\(taskProvider\(task\)\)\} messages` : TERMINAL_WINDOW_VIEW_TITLES\.ai;/,
  );
  assert.match(app, /if \(view === 'ai' && label\) label\.textContent = aiLabel;/);
  const controls = app.slice(
    app.indexOf('const TERMINAL_WINDOW_VIEW_TITLES'),
    app.indexOf('function rerenderTerminalWindowStream'),
  );
  assert.doesNotMatch(controls, /'Claude messages'|'Codex messages'|'OpenCode messages'/);
  assert.doesNotMatch(markup, /Claude messages|Codex messages|OpenCode messages/);
  // Task controlled copy is written as text, never interpolated into markup.
  assert.match(app, /elements\.terminalWindowTitle\.textContent =/);
  assert.match(app, /elements\.terminalWindowSubtitle\.textContent =/);
  assert.doesNotMatch(app, /terminalWindow(Title|Subtitle)\.innerHTML/);
});

test('opening or closing the window leaves the inline rail selection alone', () => {
  const controls = app.slice(
    app.indexOf('function updateEventControls'),
    app.indexOf('const TERMINAL_WINDOW_VIEW_TITLES'),
  );
  assert.match(
    controls,
    /const inlineFilter = terminalWindowIsDocked\(\) \? state\.inlineEventFilter : state\.eventFilter;/,
  );
  assert.match(controls, /button\.setAttribute\('aria-pressed', String\(filter === inlineFilter\)\)/);
  assert.match(app, /state\.inlineEventFilter = button\.dataset\.eventFilter;\s*if \(!terminalWindowIsDocked\(\)\) state\.eventFilter = state\.inlineEventFilter;/);
});

test('the open control is disabled without a selected task and closes a stranded window', () => {
  const availability = app.slice(
    app.indexOf('function updateTerminalWindowAvailability'),
    app.indexOf('function updateTerminalWindowControls'),
  );
  assert.match(availability, /const available = Boolean\(state\.selectedTaskId\) && !elements\.taskDetail\.hidden;/);
  assert.match(availability, /elements\.terminalWindowOpenButton\.disabled = !available;/);
  assert.match(availability, /if \(!available && terminalWindowIsDocked\(\)\) closeTerminalWindow\(\);/);
  // A deselect never renders the event stream, so renderTasks refreshes the control too.
  assert.match(app, /function renderTasks\(\) \{\s*renderTaskSearch\(\);[\s\S]{0,200}?updateTerminalWindowAvailability\(\);/);
  assert.match(app, /function openTerminalWindow\(\) \{[\s\S]*?if \(!state\.selectedTaskId \|\| elements\.taskDetail\.hidden\) return;/);
});

test('one guarded route owns hiding the detail panel', () => {
  /*
   * #terminal-window-modal and #task-detail-modal are children of #task-detail. Hiding
   * that panel with either dialog open leaves an open modal inside a display:none
   * ancestor, which is invisible while every control outside it stays inert. The single
   * hide route closes both dialogs first, so no new caller can reintroduce the wedge.
   */
  const hides = [...app.matchAll(/elements\.taskDetail\.hidden = true;/g)];
  assert.equal(hides.length, 1, 'exactly one assignment hides the detail panel');
  const hide = app.slice(
    app.indexOf('function hideTaskDetailPanel()'),
    app.indexOf('// Fills the tmux-style terminal status bar'),
  );
  assert.match(hide, /closeTerminalWindow\(\);\s*closeTaskDetailModal\(\);\s*elements\.taskDetail\.hidden = true;\s*elements\.emptyDetail\.hidden = false;/);
  assert.match(hide, /if \(dialogHadFocus\) focusTaskDetailLandmark\(\);/);
  // Every route that used to hide the panel inline now goes through it. Each search is
  // bounded at the next top level declaration, so a concurrent edit that grows one of
  // these functions cannot fail this lock for an unrelated reason.
  for (const caller of ['function selectProject', 'async function loadSnapshot', 'function applyThreadSelection', 'async function deleteTask']) {
    const start = app.indexOf(caller);
    assert.ok(start > 0, `${caller} exists`);
    const rest = app.slice(start + caller.length);
    const next = rest.search(/\n(?:async )?function /);
    assert.ok(
      (next < 0 ? rest : rest.slice(0, next)).includes('hideTaskDetailPanel();'),
      `${caller} hides the panel through the guarded route`,
    );
  }
});

/* ------------------------------------------------------------------
 * Behavioral coverage
 *
 * The regex locks above pin the contract's shape. These tests run the real functions
 * from public/app.js against a minimal fake DOM, because the dock is a DOM identity
 * problem: a mutation that reparents the live section into the dialog it just closed
 * keeps every source assertion green while permanently orphaning the terminal.
 *
 * The repo is dependency light on purpose, so the fake DOM below models only the few
 * behaviors the dock depends on: parent and sibling identity, reattachment zeroing
 * descendant scroll, and a dialog that throws on a second showModal like a real one.
 * ------------------------------------------------------------------ */

function sliceBetween(startMarker, endMarker) {
  const start = app.indexOf(startMarker);
  const end = app.indexOf(endMarker, start + 1);
  assert.ok(start >= 0 && end > start, `source markers moved: ${startMarker}`);
  return app.slice(start, end);
}

const viewConstantsSource = sliceBetween('const TERMINAL_WINDOW_VIEWS = [', 'const state = {');
const terminalWindowSource = sliceBetween(
  'function updateEventControls(filterCounts = {}, reasoningCount = 0) {',
  '// Fills the tmux-style terminal status bar',
);
const terminalWindowListenerSource = sliceBetween(
  "elements.terminalWindowOpenButton.addEventListener('click', openTerminalWindow);",
  'elements.thinkingVisibilityButton.addEventListener',
);

let focusLog = [];
/*
 * Every reparent is logged with where the tools cluster was standing at that instant.
 * The restore order is otherwise invisible: reinserting the section first and the tools
 * second reaches the same final tree, and only the intermediate state differs, so the
 * log is what makes "the section never lands half restored" an observable fact.
 */
let moveLog = [];
let watchedTools = null;

function recordMove(child, parent) {
  moveLog.push({
    child: child.nodeName,
    parent: parent.nodeName,
    toolsParent: watchedTools?.parentNode?.nodeName ?? null,
  });
}

class FakeNode {
  constructor(name) {
    this.nodeName = name;
    this.childNodes = [];
    this.parentNode = null;
    this.dataset = {};
    this.attributes = {};
    this.listeners = new Map();
    this.scrollTop = 0;
    this.scrollLeft = 0;
    this.scrollHeight = 1000;
    this.clientHeight = 400;
    this.hidden = false;
    this.disabled = false;
    this.textContent = '';
    this.style = { setProperty() {}, removeProperty() {} };
  }

  get isConnected() {
    let node = this;
    while (node.parentNode) node = node.parentNode;
    return node.nodeName === '#document';
  }

  get nextSibling() {
    if (!this.parentNode) return null;
    const index = this.parentNode.childNodes.indexOf(this);
    return this.parentNode.childNodes[index + 1] ?? null;
  }

  remove() {
    if (!this.parentNode) return;
    const index = this.parentNode.childNodes.indexOf(this);
    if (index >= 0) this.parentNode.childNodes.splice(index, 1);
    this.parentNode = null;
  }

  append(child) {
    child.remove();
    child.parentNode = this;
    this.childNodes.push(child);
    // Reattaching a subtree zeroes every descendant scroll, exactly like a browser.
    zeroScroll(child);
    recordMove(child, this);
  }

  insertBefore(child, reference) {
    child.remove();
    child.parentNode = this;
    if (reference == null) {
      this.childNodes.push(child);
    } else {
      const index = this.childNodes.indexOf(reference);
      if (index < 0) throw new Error('NotFoundError: insertBefore reference is not a child');
      this.childNodes.splice(index, 0, child);
    }
    zeroScroll(child);
    recordMove(child, this);
  }

  setAttribute(name, value) { this.attributes[name] = String(value); }

  getAttribute(name) { return this.attributes[name] ?? null; }

  hasAttribute(name) { return Object.hasOwn(this.attributes, name); }

  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(handler);
  }

  fire(type, event = {}) {
    for (const handler of this.listeners.get(type) || []) handler(event);
  }

  querySelector() { return null; }

  querySelectorAll() { return []; }

  getBoundingClientRect() { return { height: 300, width: 800, top: 0, bottom: 0 }; }

  focus() { focusLog.push(this.nodeName); }
}

function zeroScroll(node) {
  node.scrollTop = 0;
  for (const child of node.childNodes) zeroScroll(child);
}

class FakeDialog extends FakeNode {
  constructor(name) {
    super(name);
    this.open = false;
  }

  showModal() {
    if (this.open) throw new Error('InvalidStateError: the dialog is already open');
    this.open = true;
  }

  close() {
    if (!this.open) return;
    this.open = false;
    this.fire('close', {});
  }

  // Escape: the browser fires cancel, then closes and fires close.
  escape() {
    this.fire('cancel', {});
    this.close();
  }
}

function childNames(node) {
  return node.childNodes.map((child) => child.nodeName).join(',');
}

function buildWorld({
  nativeScreen = false,
  terminalResponse = {
    terminal: {
      state: 'live',
      reason: 'read',
      text: 'real terminal output',
      busy: true,
      provider: 'claude',
      capturedAt: '2026-09-04T12:00:00.000Z',
    },
  },
} = {}) {
  focusLog = [];
  const document = new FakeNode('#document');
  const taskList = new FakeNode('#task-list');
  const emptyDetail = new FakeNode('#empty-detail');
  const emptyHeading = new FakeNode('#empty-detail-h2');
  const taskDetail = new FakeNode('#task-detail');
  const detailScroll = new FakeNode('.task-detail-scroll');
  const resizer = new FakeNode('#terminal-height-resizer');
  const taskDetailModal = new FakeDialog('#task-detail-modal');
  const eventsSection = new FakeNode('.events-section');
  const whitespace = new FakeNode('#text');
  const terminalWindowModal = new FakeDialog('#terminal-window-modal');
  const terminalWindowTools = new FakeNode('#terminal-window-tools');
  const terminalWindowMount = new FakeNode('#terminal-window-mount');
  const eventToolbar = new FakeNode('.event-toolbar');
  const eventFiltersRail = new FakeNode('#event-filters');
  const eventTools = new FakeNode('.event-tools');
  // The real .event-tools is followed by a whitespace text node inside .event-toolbar,
  // so the recorded nextSibling is a real reference rather than the null shortcut.
  const toolbarText = new FakeNode('#toolbar-text');
  const detailEvents = new FakeNode('#detail-events');
  const eventSummary = new FakeNode('#event-summary');
  const eventOverview = new FakeNode('#event-overview');
  const nativeTerminalScreen = new FakeNode('#native-terminal-screen');
  const nativeTerminalScreenTitle = new FakeNode('#native-terminal-screen-title');
  const nativeTerminalScreenState = new FakeNode('#native-terminal-screen-state');
  const nativeTerminalScreenOutput = new FakeNode('#native-terminal-screen-output');
  const nativeTerminalScreenNotice = new FakeNode('#native-terminal-screen-notice');
  const nativeTerminalNoticeTitle = new FakeNode('#native-terminal-screen-notice-title');
  const nativeTerminalNoticeDetail = new FakeNode('#native-terminal-screen-notice-detail');
  const openButton = new FakeNode('#terminal-window-open');
  const thinkingButton = new FakeNode('#thinking-visibility-button');
  const copyButton = new FakeNode('#copy-events-button');
  const closeButton = new FakeNode('#terminal-window-close');
  const title = new FakeNode('#terminal-window-title');
  const subtitle = new FakeNode('#terminal-window-subtitle');
  watchedTools = eventTools;

  document.append(taskList);
  document.append(emptyDetail);
  document.append(taskDetail);
  emptyDetail.append(emptyHeading);
  emptyDetail.querySelector = (selector) => (selector === 'h2' ? emptyHeading : null);
  // A task is selected, so the panel is on screen and the empty state is hidden.
  emptyDetail.hidden = true;
  taskDetail.append(detailScroll);
  taskDetail.append(resizer);
  taskDetail.append(taskDetailModal);
  taskDetail.append(eventsSection);
  taskDetail.append(whitespace);
  taskDetail.append(terminalWindowModal);
  // The header slot sits ahead of the body mount, exactly as in the markup.
  terminalWindowModal.append(terminalWindowTools);
  terminalWindowModal.append(terminalWindowMount);
  eventsSection.append(eventToolbar);
  eventsSection.append(eventOverview);
  eventsSection.append(nativeTerminalScreen);
  eventsSection.append(detailEvents);
  nativeTerminalScreen.append(nativeTerminalScreenTitle);
  nativeTerminalScreen.append(nativeTerminalScreenState);
  nativeTerminalScreen.append(nativeTerminalScreenOutput);
  nativeTerminalScreen.append(nativeTerminalScreenNotice);
  nativeTerminalScreenNotice.append(nativeTerminalNoticeTitle);
  nativeTerminalScreenNotice.append(nativeTerminalNoticeDetail);
  nativeTerminalScreenNotice.querySelector = (selector) => {
    if (selector === 'strong') return nativeTerminalNoticeTitle;
    if (selector === 'span') return nativeTerminalNoticeDetail;
    return null;
  };
  eventToolbar.append(eventFiltersRail);
  eventToolbar.append(eventTools);
  eventToolbar.append(toolbarText);
  eventTools.append(thinkingButton);
  eventTools.append(copyButton);
  eventTools.append(openButton);

  const viewButtons = ['all', 'conversation', 'mine', 'ai'].map((view) => {
    const button = new FakeNode(`view:${view}`);
    button.dataset.terminalWindowView = view;
    const label = new FakeNode('label');
    const counter = new FakeNode('count');
    button.querySelector = (selector) => {
      if (selector === '.terminal-window-view-label') return label;
      if (selector === '[data-terminal-window-view-count]') return counter;
      return null;
    };
    return button;
  });

  const filterButtons = ['all', 'highlights', 'commands', 'conversation', 'mine', 'ai']
    .map((filter) => {
      const button = new FakeNode(`filter:${filter}`);
      button.dataset.eventFilter = filter;
      return button;
    });

  const elements = {
    taskList,
    emptyDetail,
    taskDetail,
    taskDetailModal,
    eventsSection,
    detailEvents,
    eventSummary,
    eventOverview,
    eventFilters: filterButtons,
    eventTools,
    terminalWindowOpenButton: openButton,
    terminalWindowModal,
    terminalWindowTools,
    terminalWindowMount,
    terminalWindowTitle: title,
    terminalWindowSubtitle: subtitle,
    terminalWindowClose: closeButton,
    terminalWindowViews: viewButtons,
    nativeTerminalScreen,
    nativeTerminalScreenTitle,
    nativeTerminalScreenState,
    nativeTerminalScreenOutput,
    nativeTerminalScreenNotice,
    thinkingVisibilityButton: thinkingButton,
    copyEventsButton: copyButton,
  };

  const state = {
    selectedTaskId: 7,
    selectedTaskForEvents: { id: 7, provider: 'claude', status: 'running' },
    selectedTaskEvents: [],
    eventFilter: 'all',
    inlineEventFilter: 'all',
    terminalWindowDock: null,
    terminalWindowView: 'all',
    eventFollow: true,
    status: { capabilities: { nativeTerminalScreen: nativeScreen } },
    nativeTerminalScreen: {
      taskId: null,
      state: 'idle',
      reason: '',
      text: '',
      busy: false,
      provider: null,
      capturedAt: null,
    },
    nativeTerminalScreenTimer: null,
    nativeTerminalScreenPending: false,
    nativeTerminalScreenSequence: 0,
    visibleEventEntries: [],
  };

  const calls = {
    renders: [],
    preferenceSaves: 0,
    terminalHeights: 0,
    toolsParentAtShowModal: null,
    screenRequests: [],
    selectionWaits: 0,
  };
  let nextTimerId = 1;
  const timers = new Map();
  const fakeWindow = {
    setTimeout(callback) {
      const id = nextTimerId;
      nextTimerId += 1;
      timers.set(id, callback);
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
  };

  // Where the cluster was standing when the dialog first painted.
  const showModal = terminalWindowModal.showModal.bind(terminalWindowModal);
  terminalWindowModal.showModal = () => {
    calls.toolsParentAtShowModal = eventTools.parentNode?.nodeName ?? null;
    showModal();
  };

  /*
   * The Window button is the one control that leaves the section, so its focus call
   * records the tree it was standing in. A focus landing on a disconnected button, or on
   * one still under .terminal-window-tools, or under a section still flagged docked, is
   * a focus the operator never sees, because all three are display:none or detached.
   */
  const openButtonFocusContext = [];
  openButton.focus = function focus() {
    openButtonFocusContext.push({
      connected: this.isConnected,
      parent: this.parentNode?.nodeName ?? null,
      toolbar: this.parentNode?.parentNode?.nodeName ?? null,
      docked: eventsSection.dataset.terminalWindow,
      sectionParent: eventsSection.parentNode?.nodeName ?? null,
    });
    FakeNode.prototype.focus.call(this);
  };

  const factory = new Function(
    'state',
    'elements',
    'renderEventStream',
    'rememberEventDisclosures',
    'rememberEventOutputScroll',
    'restoreEventOutputScroll',
    'applyTerminalHeight',
    'queueUiPreferencesSave',
    'providerLabel',
    'taskProvider',
    'updateThinkingVisibilityControl',
    'closeTaskDetailModal',
    'window',
    'api',
    'textSelectionGuard',
    'formatTime',
    'NATIVE_TERMINAL_SCREEN_POLL_MS',
    'NATIVE_TERMINAL_SCREEN_RETRY_MS',
    'NATIVE_TERMINAL_SCREEN_MAX_CHARS',
    `${viewConstantsSource}\n${terminalWindowSource}\n${terminalWindowListenerSource}\n`
      + 'return { openTerminalWindow, closeTerminalWindow, undockTerminalWindow,'
      + ' updateTerminalWindowAvailability, updateTerminalWindowControls, updateEventControls,'
      + ' setTerminalWindowView, terminalWindowIsDocked, normalizeTerminalWindowView,'
      + ' rerenderTerminalWindowStream, focusTerminalWindowOpenButton, focusTaskDetailLandmark,'
      + ' hideTaskDetailPanel, refreshNativeTerminalScreen, syncTerminalWindowSurface };',
  );

  let api;
  api = factory(
    state,
    elements,
    function renderEventStream(events, task, options = {}) {
      calls.renders.push({ filter: state.eventFilter, options });
      // The real renderEventStream ends with updateEventControls(...).
      api.updateEventControls({ all: 10, conversation: 4, mine: 2, ai: 2 }, 1);
    },
    () => {},
    () => {},
    () => {},
    () => { calls.terminalHeights += 1; },
    () => { calls.preferenceSaves += 1; },
    (provider) => (provider === 'claude' ? 'Claude' : 'Codex'),
    (task) => task.provider || 'codex',
    () => {},
    function closeTaskDetailModal() {
      if (elements.taskDetailModal.open) elements.taskDetailModal.close();
    },
    fakeWindow,
    async (path, options) => {
      calls.screenRequests.push({ path, options });
      return terminalResponse;
    },
    {
      waitForClear: async () => { calls.selectionWaits += 1; },
    },
    () => '12:00:00',
    700,
    2500,
    250_000,
  );

  // The fixture above is ~20 appends. Clearing here keeps the move log describing only
  // what the functions under test did.
  moveLog = [];

  return {
    elements,
    state,
    api,
    calls,
    viewButtons,
    filterButtons,
    eventToolbar,
    toolbarText,
    focusLog: () => focusLog,
    moves: () => moveLog,
    clearMoves: () => { moveLog = []; },
    openButtonFocusContext: () => openButtonFocusContext,
    timers,
  };
}

test('a first open records the original slot, never the mount it moves into', () => {
  const world = buildWorld();
  world.state.eventFilter = 'commands';
  world.state.inlineEventFilter = 'commands';
  world.state.terminalWindowView = 'mine';
  world.api.openTerminalWindow();
  const dock = world.state.terminalWindowDock;
  assert.equal(dock.parent, world.elements.taskDetail, 'the dock remembers the detail panel');
  assert.equal(dock.nextSibling.nodeName, '#text', 'the dock remembers the exact slot');
  assert.equal(world.elements.eventsSection.parentNode, world.elements.terminalWindowMount);
  assert.equal(world.elements.eventsSection.dataset.terminalWindow, 'open');
  assert.equal(world.elements.terminalWindowModal.open, true);
  // The persisted view is applied on open, and the inline filter is saved for the close.
  assert.equal(world.state.eventFilter, 'mine');
  assert.equal(world.state.inlineEventFilter, 'commands');
  assert.equal(world.focusLog().at(-1), 'view:mine', 'focus lands on the pressed view');
});

test('a second open is a no-op that cannot corrupt the dock', () => {
  const world = buildWorld();
  const before = childNames(world.elements.taskDetail);
  world.state.eventFilter = 'commands';
  world.state.inlineEventFilter = 'commands';
  world.state.terminalWindowView = 'ai';
  world.api.openTerminalWindow();
  const dock = world.state.terminalWindowDock;
  // A double click on the Window button, or an open racing a live refresh.
  world.api.openTerminalWindow();
  assert.equal(world.state.terminalWindowDock, dock, 'the dock record is untouched');
  assert.equal(world.state.terminalWindowDock.parent, world.elements.taskDetail);
  assert.equal(world.state.inlineEventFilter, 'commands', 'the saved inline filter survives');
  world.api.closeTerminalWindow();
  assert.equal(world.elements.eventsSection.parentNode, world.elements.taskDetail);
  assert.equal(childNames(world.elements.taskDetail), before);
  assert.equal(world.state.eventFilter, 'commands');
});

const closeRoutes = [
  ['the close button', (world) => world.elements.terminalWindowClose.fire('click', {})],
  ['escape', (world) => world.elements.terminalWindowModal.escape()],
  ['a backdrop click', (world) => world.elements.terminalWindowModal.fire('click', {
    target: world.elements.terminalWindowModal,
  })],
  ['a programmatic close', (world) => world.elements.terminalWindowModal.close()],
  ['closeTerminalWindow', (world) => world.api.closeTerminalWindow()],
  ['a deselect', (world) => {
    world.state.selectedTaskId = null;
    world.api.updateTerminalWindowAvailability();
  }],
];

for (const [name, closeRoute] of closeRoutes) {
  test(`${name} restores the exact original slot and the inline filter`, () => {
    const world = buildWorld();
    const before = childNames(world.elements.taskDetail);
    const toolbarBefore = childNames(world.eventToolbar);
    world.state.eventFilter = 'highlights';
    world.state.inlineEventFilter = 'highlights';
    world.state.terminalWindowView = 'conversation';
    world.api.openTerminalWindow();
    closeRoute(world);
    assert.equal(
      world.elements.eventsSection.parentNode,
      world.elements.taskDetail,
      'the section is back in the detail panel, not stranded in the closed dialog',
    );
    assert.equal(childNames(world.elements.taskDetail), before, 'the sibling order is unchanged');
    assert.equal(world.state.terminalWindowDock, null);
    assert.equal(world.elements.terminalWindowModal.open, false);
    assert.equal(world.elements.eventsSection.dataset.terminalWindow, undefined);
    assert.equal(world.state.eventFilter, 'highlights', 'the inline filter is restored');
    assert.equal(world.state.terminalWindowView, 'conversation', 'the window view is kept');
    // The tools cluster travelled into the header and has to come home the same way.
    assert.equal(
      world.elements.eventTools.parentNode,
      world.eventToolbar,
      'the tools cluster is back in the toolbar, not stranded in the closed dialog',
    );
    assert.equal(
      childNames(world.eventToolbar),
      toolbarBefore,
      'the cluster returns to its exact slot inside the toolbar',
    );
    assert.deepEqual(
      world.elements.terminalWindowTools.childNodes,
      [],
      'the header slot is empty again',
    );
    assert.equal(
      world.elements.terminalWindowOpenButton.parentNode,
      world.elements.eventTools,
      'the Window button travels back with its cluster',
    );
  });
}

test('a first open records the tools slot inside the toolbar, never the header slot', () => {
  const world = buildWorld();
  world.api.openTerminalWindow();
  const dock = world.state.terminalWindowDock;
  assert.equal(dock.toolsParent, world.eventToolbar, 'the dock remembers the toolbar row');
  assert.equal(dock.toolsNextSibling, world.toolbarText, 'the dock remembers the exact slot');
  assert.notEqual(
    dock.toolsParent,
    world.elements.terminalWindowTools,
    'a record captured after the move would point at the header slot instead',
  );
  assert.equal(world.elements.eventTools.parentNode, world.elements.terminalWindowTools);
  assert.equal(
    world.elements.terminalWindowOpenButton.parentNode,
    world.elements.eventTools,
    'the Window button travels into the header with its cluster',
  );
  assert.equal(world.elements.terminalWindowOpenButton.isConnected, true);
  assert.equal(childNames(world.eventToolbar), '#event-filters,#toolbar-text');
});

test('the tools cluster moves after the section is docked and before the dialog paints', () => {
  const world = buildWorld();
  world.api.openTerminalWindow();
  const moves = world.moves().map((move) => `${move.child}->${move.parent}`);
  assert.deepEqual(moves, [
    '.events-section->#terminal-window-mount',
    '.event-tools->#terminal-window-tools',
  ]);
  assert.equal(
    world.moves()[0].toolsParent,
    '.event-toolbar',
    'the cluster is still in the toolbar while the section is being docked',
  );
  assert.equal(
    world.calls.toolsParentAtShowModal,
    '#terminal-window-tools',
    'the dialog never paints with an empty tools slot',
  );
});

test('a second open cannot corrupt the tools dock', () => {
  const world = buildWorld();
  const toolbarBefore = childNames(world.eventToolbar);
  world.api.openTerminalWindow();
  const dock = world.state.terminalWindowDock;
  // A double click on the Window button, or an open racing a live refresh. Without the
  // guard the second capture would record the header slot as the cluster's home, and the
  // close below would reinsert it into the dialog it just closed.
  world.api.openTerminalWindow();
  assert.equal(world.state.terminalWindowDock, dock, 'the dock record is untouched');
  assert.equal(dock.toolsParent, world.eventToolbar);
  assert.equal(dock.toolsNextSibling, world.toolbarText);
  world.api.closeTerminalWindow();
  assert.equal(world.elements.eventTools.parentNode, world.eventToolbar);
  assert.equal(childNames(world.eventToolbar), toolbarBefore);
});

test('the section is never reinserted into the detail panel before its tools are back', () => {
  const world = buildWorld();
  world.api.openTerminalWindow();
  world.clearMoves();
  world.api.closeTerminalWindow();
  const moves = world.moves().map((move) => `${move.child}->${move.parent}`);
  assert.deepEqual(moves, ['.event-tools->.event-toolbar', '.events-section->#task-detail']);
  const restore = world.moves().find((move) => move.child === '.events-section');
  assert.equal(
    restore.toolsParent,
    '.event-toolbar',
    'the section lands in the detail grid with a complete toolbar, never a half restored one',
  );
});

test('a close returns the tools cluster as the last child when it had no next sibling', () => {
  const world = buildWorld();
  // The trailing text node moves ahead of the cluster, so the recorded sibling is null.
  world.eventToolbar.append(world.elements.eventTools);
  const toolbarBefore = childNames(world.eventToolbar);
  assert.equal(world.elements.eventTools.nextSibling, null, 'fixture: the cluster is last');
  world.api.openTerminalWindow();
  assert.equal(world.state.terminalWindowDock.toolsNextSibling, null);
  world.api.closeTerminalWindow();
  assert.equal(world.elements.eventTools.parentNode, world.eventToolbar);
  assert.equal(world.elements.eventTools.nextSibling, null, 'it returns as the last child');
  assert.equal(childNames(world.eventToolbar), toolbarBefore);
});

test('the Window button is reconnected in a visible toolbar before focus is attempted', () => {
  const world = buildWorld();
  world.api.openTerminalWindow();
  world.elements.terminalWindowModal.escape();
  /*
   * Two CSS rules hide this button while the window is docked: one through its temporary
   * .terminal-window-tools parent, one through the docked section's hidden .event-toolbar
   * row. Undock clears both before any close route reaches the focus call, so the
   * existing isConnected and taskDetail.hidden guard stays a true proxy for focusable.
   */
  assert.deepEqual(world.openButtonFocusContext(), [{
    connected: true,
    parent: '.event-tools',
    toolbar: '.event-toolbar',
    docked: undefined,
    sectionParent: '#task-detail',
  }]);
  assert.equal(world.focusLog().at(-1), '#terminal-window-open');
});

test('a close restores the section as the last child when it had no next sibling', () => {
  const world = buildWorld();
  const taskDetail = world.elements.taskDetail;
  // The dialog and the trailing text node move ahead of the section.
  taskDetail.append(world.elements.eventsSection);
  const before = childNames(taskDetail);
  assert.equal(world.elements.eventsSection.nextSibling, null, 'fixture: the section is last');
  world.api.openTerminalWindow();
  assert.equal(world.state.terminalWindowDock.nextSibling, null);
  world.api.closeTerminalWindow();
  assert.equal(world.elements.eventsSection.parentNode, taskDetail);
  assert.equal(world.elements.eventsSection.nextSibling, null, 'it returns as the last child');
  assert.equal(childNames(taskDetail), before);
});

test('a reopen uses the persisted window view while the inline rail keeps its own', () => {
  const world = buildWorld();
  world.state.eventFilter = 'commands';
  world.state.inlineEventFilter = 'commands';
  world.api.openTerminalWindow();
  const pressedWhileDocked = world.filterButtons
    .filter((button) => button.getAttribute('aria-pressed') === 'true')
    .map((button) => button.dataset.eventFilter);
  assert.deepEqual(pressedWhileDocked, ['commands'], 'the inline rail keeps its selection');
  world.api.setTerminalWindowView('ai');
  assert.equal(world.state.eventFilter, 'ai');
  assert.equal(world.calls.preferenceSaves, 1, 'the view choice is persisted');
  world.api.closeTerminalWindow();
  assert.equal(world.state.eventFilter, 'commands');
  world.api.openTerminalWindow();
  assert.equal(world.state.eventFilter, 'ai', 'the reopen applies the persisted view');
  assert.deepEqual(
    world.filterButtons
      .filter((button) => button.getAttribute('aria-pressed') === 'true')
      .map((button) => button.dataset.eventFilter),
    ['commands'],
  );
});

test('the default view renders the native screen and stops polling on a conversation view', async () => {
  const world = buildWorld({ nativeScreen: true });
  world.api.openTerminalWindow();
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(world.calls.screenRequests, [{
    path: '/api/tasks/7/terminal-screen',
    options: { timeoutMs: 8_000 },
  }]);
  assert.equal(world.calls.selectionWaits, 1, 'new terminal text waits for active selection to clear');
  assert.equal(world.state.nativeTerminalScreen.state, 'live');
  assert.equal(world.state.nativeTerminalScreen.text, 'real terminal output');
  assert.equal(world.elements.nativeTerminalScreenOutput.textContent, 'real terminal output');
  assert.equal(world.elements.nativeTerminalScreen.hidden, false);
  assert.equal(world.elements.detailEvents.hidden, true);
  assert.equal(world.elements.eventOverview.hidden, true);
  assert.equal(world.elements.thinkingVisibilityButton.hidden, true);
  assert.equal(world.elements.copyEventsButton.disabled, false);
  assert.equal(world.elements.copyEventsButton.textContent, 'Copy terminal');
  assert.equal(world.elements.eventsSection.dataset.terminalSurface, 'native');
  assert.equal(world.timers.size, 1, 'a live screen schedules its next bounded poll');

  world.api.setTerminalWindowView('conversation');
  assert.equal(world.elements.nativeTerminalScreen.hidden, true);
  assert.equal(world.elements.detailEvents.hidden, false);
  assert.equal(world.elements.eventOverview.hidden, false);
  assert.equal(world.elements.thinkingVisibilityButton.hidden, false);
  assert.equal(world.elements.copyEventsButton.textContent, 'Copy log');
  assert.equal(world.elements.eventsSection.dataset.terminalSurface, undefined);
  assert.equal(world.timers.size, 0, 'leaving Terminal cancels its next poll');
});

test('a live render while docked keeps the dock and the window view', () => {
  const world = buildWorld();
  world.state.terminalWindowView = 'conversation';
  world.api.openTerminalWindow();
  const dock = world.state.terminalWindowDock;
  world.api.rerenderTerminalWindowStream();
  assert.equal(world.state.terminalWindowDock, dock, 'a render never replaces the dock');
  assert.equal(world.state.eventFilter, 'conversation');
  assert.equal(world.elements.eventsSection.parentNode, world.elements.terminalWindowMount);
});

test('hiding the detail panel closes the window before the panel disappears', () => {
  const world = buildWorld();
  const before = childNames(world.elements.taskDetail);
  world.api.openTerminalWindow();
  world.elements.taskDetailModal.showModal();
  world.state.selectedTaskId = null;
  world.api.hideTaskDetailPanel();
  // An open dialog inside a hidden ancestor is invisible while the page stays inert.
  assert.equal(world.elements.terminalWindowModal.open, false, 'the window is closed first');
  assert.equal(world.elements.taskDetailModal.open, false, 'the detail dialog is closed too');
  assert.equal(world.elements.taskDetail.hidden, true);
  assert.equal(world.elements.emptyDetail.hidden, false);
  assert.equal(world.state.terminalWindowDock, null);
  assert.equal(world.elements.eventsSection.parentNode, world.elements.taskDetail);
  assert.equal(childNames(world.elements.taskDetail), before);
  // The wedge route hides the panel, so a cluster left in the dialog would vanish with it.
  assert.equal(world.elements.eventTools.parentNode, world.eventToolbar);
  assert.deepEqual(world.elements.terminalWindowTools.childNodes, []);
});

test('a hide route lands focus on the visible landmark instead of the document body', () => {
  const world = buildWorld();
  world.api.openTerminalWindow();
  world.state.selectedTaskId = null;
  world.api.hideTaskDetailPanel();
  assert.equal(world.focusLog().at(-1), '#empty-detail-h2', 'focus moves to the empty-detail heading');
  assert.equal(world.elements.emptyDetail.getAttribute('tabindex'), null);
  assert.equal(
    world.elements.emptyDetail.childNodes[0].getAttribute('tabindex'),
    '-1',
    'the landmark takes a programmatic only tabindex',
  );
});

test('an auto-close from a deselect never focuses a hidden landmark', () => {
  const world = buildWorld();
  world.api.openTerminalWindow();
  const focusedBefore = world.focusLog().length;
  // renderTasks refreshes availability while the panel is still on screen and the empty
  // state is still hidden, so the queue list is the only focusable landmark left.
  world.state.selectedTaskId = null;
  world.api.updateTerminalWindowAvailability();
  assert.equal(world.elements.terminalWindowOpenButton.disabled, true);
  assert.ok(world.focusLog().length > focusedBefore, 'focus is not left on the document body');
  assert.equal(world.focusLog().at(-1), '#task-list');
  assert.equal(world.elements.emptyDetail.getAttribute('tabindex'), null, 'a hidden node is skipped');
});

test('closing a window that was never open moves no focus', () => {
  const world = buildWorld();
  world.api.closeTerminalWindow();
  world.api.hideTaskDetailPanel();
  assert.deepEqual(world.focusLog(), [], 'a defensive close leaves the operator where they are');
  assert.equal(world.state.terminalWindowDock, null);
  assert.equal(world.elements.eventsSection.parentNode, world.elements.taskDetail);
});
