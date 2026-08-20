import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const style = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');
const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const markup = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

test('desktop Launchpad uses one compact horizontal card row without vertical clipping', () => {
  assert.match(style, /\.project-list \{\s*grid-area: list;\s*display: flex;[\s\S]*?padding-block: 2px;\s*overflow-x: auto;\s*overflow-y: hidden;/);
  assert.match(style, /\.project-chip \{\s*display: grid;\s*flex: 0 0 176px;[\s\S]*?grid-template-areas: "head activity close";\s*grid-template-columns: minmax\(0, 1fr\) auto 16px;[\s\S]*?height: 30px;/);
  assert.match(style, /@media \(min-width: 1345px\) \{[\s\S]*?\.app-header \{\s*height: 58px;[\s\S]*?\.project-dock \{\s*height: 44px;\s*min-height: 44px;/);
  assert.match(style, /\.workspace \{\s*height: calc\(100vh - var\(--desktop-titlebar-height\) - var\(--app-header-height, 58px\) - 44px\)/);
  const selectedStyle = style.slice(
    style.indexOf('.project-chip[class*="project-color-"].selected {'),
    style.indexOf('.project-chip[class*="project-color-"].selected:hover {'),
  );
  assert.doesNotMatch(selectedStyle, /transform:/);
  assert.doesNotMatch(selectedStyle, /0 0 0/);
});

test('rightmost display cog owns monitor layout and application controls', () => {
  assert.match(markup, /class="header-running-primary"[\s\S]*?id="header-running-tasks"[\s\S]*?id="header-running-extra-tasks"/);
  assert.match(markup, /id="header-running-extra-tasks" class="header-running-extra-tasks"/);
  assert.match(markup, /class="header-actions"[\s\S]*?id="provider-usage"[\s\S]*?id="display-settings" class="display-settings"/);
  assert.match(markup, /summary aria-label="Open display settings"/);
  assert.match(markup, /id="running-task-rows"[\s\S]*?<option value="1">1 row<\/option>[\s\S]*?<option value="3">3 rows<\/option>/);
  assert.match(markup, /id="running-task-width"[\s\S]*?<option value="230">Compact<\/option>[\s\S]*?<option value="286">Default<\/option>[\s\S]*?<option value="360">Wide<\/option>/);
  assert.match(markup, /id="application-display-heading"[\s\S]*?id="header-position-toggle"[\s\S]*?id="theme-toggle"[\s\S]*?id="desktop-zoom-controls"/);
  assert.match(markup, /id="desktop-zoom-out"[\s\S]*?aria-label="Zoom out"/);
  assert.match(markup, /id="desktop-zoom-level"[\s\S]*?>100%<\/output>/);
  assert.match(markup, /id="desktop-zoom-in"[\s\S]*?aria-label="Zoom in"/);
  assert.ok(markup.indexOf('id="display-settings"') > markup.indexOf('id="provider-usage"'));
  assert.match(style, /\.header-running-tasks,\s*\.header-running-extra-tasks \{[\s\S]*?grid-auto-columns: var\(--running-task-width, 286px\);/);
  assert.match(style, /\.display-settings \{[\s\S]*?margin-left: auto;/);
  assert.match(style, /\.header-running-tasks \{\s*grid-template-rows: 44px;/);
  assert.match(style, /html\[data-running-task-rows="3"\] \.header-running-extra-tasks \{\s*display: grid;\s*grid-template-rows: repeat\(2, 44px\);/);
  assert.match(style, /grid-template-columns: max-content minmax\(0, 1fr\) max-content;\s*column-gap: 18px;\s*row-gap: 7px;/);
  assert.match(style, /html\[data-running-task-rows="2"\] \.header-running-extra-tasks,\s*html\[data-running-task-rows="3"\] \.header-running-extra-tasks \{\s*grid-column: 1 \/ -1;\s*grid-row: 2 \/ -1;/);
  assert.match(style, /html\[data-running-task-rows="2"\] \.app-header \{\s*height: 109px;\s*min-height: 109px;/);
  assert.match(style, /html\[data-running-task-rows="3"\] \.app-header \{\s*height: 160px;\s*min-height: 160px;/);
  assert.match(app, /runningTaskRailGroups\(\s*running,\s*state\.runningTaskLayout\.rows,\s*\)/);
  assert.match(app, /elements\.headerRunningExtraTasks\.innerHTML = extraTasks\.map\(taskMarkup\)\.join\(''\)/);
  assert.match(app, /'relay\.runningTaskLayout',[\s\S]*?JSON\.stringify\(normalizeRunningTaskLayout\(preferences\.runningTaskLayout\)\)/);
  assert.match(app, /elements\.runningTaskRows\.addEventListener\('change'/);
  assert.match(app, /elements\.runningTaskWidth\.addEventListener\('change'/);
});

test('empty task monitor uses one canonical task-card slot with text only', () => {
  const emptyMarkupStart = markup.indexOf('<div class="header-running-empty">');
  const emptyMarkup = markup.slice(emptyMarkupStart, markup.indexOf('</div>', emptyMarkupStart) + 6);
  assert.match(
    emptyMarkup,
    /class="header-running-empty">\s*<span>No active tasks or sessions<\/span>\s*<\/div>/,
  );
  assert.match(
    app,
    /<div class="header-running-empty">\s*<span>No active tasks or sessions<\/span>\s*<\/div>/,
  );
  assert.doesNotMatch(emptyMarkup, /<i/);

  const emptyStyle = style.slice(
    style.indexOf('.header-running-empty {'),
    style.indexOf('.header-running-task {'),
  );
  assert.match(emptyStyle, /min-width: 0;/);
  assert.match(emptyStyle, /padding: 4px 9px;/);
  assert.match(emptyStyle, /border: 1px solid color-mix\(in srgb, var\(--running\) 22%, var\(--line\)\);/);
  assert.match(emptyStyle, /border-radius: 9px;/);
  assert.match(emptyStyle, /background: color-mix\(in srgb, var\(--running\) 6%, #fff\);/);
  assert.doesNotMatch(emptyStyle, /justify-self|border-radius: 999px/);
});

test('Launchpad exposes one add-project action without launching a terminal', () => {
  assert.match(
    markup,
    /<div class="project-dock-actions">\s*<button id="add-project-button" class="button primary compact" type="button">\+ Add project<\/button>\s*<\/div>/,
  );
  assert.doesNotMatch(markup, /add-launch-project-button|Pin folder|Add and launch/);
  assert.match(app, /elements\.addProjectButton\.addEventListener\('click', \(\) => chooseProject\(false\)\);/);
  assert.doesNotMatch(app, /addLaunchProjectButton/);
});

test('project cards show activity without per-provider launch buttons', () => {
  const renderStart = app.indexOf('function renderProjects()');
  const activityStart = app.indexOf('function projectActivity(', renderStart);
  const renderSource = app.slice(renderStart, activityStart);
  assert.match(renderSource, /class="project-activity"/);
  assert.match(renderSource, /class="project-notification"/);
  assert.match(renderSource, /projectCompletionNotifications\.count\(project\.path\)/);
  assert.match(renderSource, /activity\.status/);
  assert.match(renderSource, /aria-label="\$\{escapeHtml\(accessibleLabel\)\}"/);
  assert.doesNotMatch(renderSource, /compactProjectPath|<small>|<span>\$\{escapeHtml\(activity\.label\)\}<\/span>/);
  assert.doesNotMatch(renderSource, /project-launch-(?:codex|claude)/);
  assert.ok(renderSource.indexOf('class="project-unpin"') > renderSource.indexOf('class="project-chip-foot"'));
  assert.match(style, /\.project-notification \{[\s\S]*?background: #d43f62;/);
  assert.match(style, /\.project-chip\[data-activity="complete"\] \.project-activity strong/);
});

test('narrow project cards preserve the far-right close column', () => {
  assert.match(style, /@media \(max-width: 760px\) \{[\s\S]*?\.project-chip \{\s*flex-basis: calc\(100vw - 28px\);\s*\}/);
  assert.match(style, /\.project-unpin \{\s*grid-area: close;/);
});

test('task activity identifies review-ready completions and can clear the current project', () => {
  assert.match(markup, /id="clear-task-notifications-button"[\s\S]*?>Mark reviewed<\/button>/);
  assert.match(app, /projectCompletionNotifications\.includes\(task\.repo_path, task\.id\)/);
  assert.match(app, /class="task-card [^"]*\$\{unread \? 'task-card-unread' : ''\}/);
  assert.match(app, /unread && \(!operationalQueue \|\| starred\) \? '<span class="task-unread-marker">Ready for review<\/span>'/);
  assert.match(app, /Mark reviewed · \$\{unreadCount\}/);
  assert.match(app, /projectCompletionNotifications\.taskIds\(state\.activeProjectPath\)/);
  assert.match(app, /api\('\/api\/tasks\/review-project'/);
  assert.match(style, /\.task-card-unread:not\(\.selected\) \{[\s\S]*?background: color-mix\(in srgb, #d43f62 4%, #f8faf9\);/);
  assert.match(style, /\.task-card-unread::before \{[\s\S]*?width: 4px;[\s\S]*?background: #d43f62;/);
  assert.match(style, /\.task-unread-marker \{[\s\S]*?text-transform: uppercase;/);
  assert.match(style, /html\[data-theme="dark"\] \.task-card-unread:not\(\.selected\)/);
  assert.match(style, /html\[data-theme="dark"\] \.clear-task-notifications-button \{[\s\S]*?color: #ff91aa;/);
  assert.doesNotMatch(style, /(?:^|\n)\.task-card-unread \{[\s\S]*?(?:border-color|background):/);
});

test('task queue header controls remain readable at compact desktop density', () => {
  assert.match(
    style,
    /\.queue-view-switch button,[\s\S]*?\.history-date-nav button \{[\s\S]*?font-size: 10px;/,
  );
  assert.match(
    style,
    /\.queue-heading-button \{[\s\S]*?font-size: 10px;/,
  );
  assert.match(
    style,
    /\.standup-button:disabled \{[\s\S]*?color: #667185;/,
  );
  assert.match(
    style,
    /html\[data-theme="dark"\] \.queue-heading-button:disabled \{[\s\S]*?color: var\(--app-text-quiet\);[\s\S]*?opacity: 1;/,
  );
});

test('desktop defaults widen the composer while keeping the queue compact', () => {
  assert.match(
    style,
    /grid-template-columns: var\(--composer-width, 580px\) 14px var\(--queue-width, 500px\) 14px minmax\(420px, 1fr\);/,
  );
  assert.match(app, /composer: Number\.isFinite\(saved\.composer\) \? saved\.composer : 580/);
  assert.match(app, /queue: Number\.isFinite\(saved\.queue\) \? saved\.queue : null/);
  assert.match(app, /const minimumComposer = 400/);
  assert.match(app, /composerQueueResizer\.setAttribute\('aria-valuemin', '400'\)/);
  assert.match(app, /: 500;[\s\S]*?constrainPanelWidths\(state\.panelWidths\.composer, state\.panelWidths\.queue\)/);
  assert.match(app, /Task queue \$\{Math\.round\(state\.panelWidths\.queue\)\} pixels wide/);
});

test('execution settings give effort twenty more pixels than model', () => {
  assert.match(
    style,
    /\.execution-controls \{\s*display: grid;\s*grid-template-columns: minmax\(0, calc\(50% - 13px\)\) minmax\(0, calc\(50% \+ 7px\)\);\s*gap: 7px;/,
  );
  assert.match(
    style,
    /@media \(max-width: 760px\) \{[\s\S]*?\.mode-tabs, \.execution-controls \{ grid-template-columns: 1fr; \}/,
  );
});

test('responsive workspace skips the two-panel split view', () => {
  assert.match(
    style,
    /@media \(max-width: 1344px\) \{[\s\S]*?\.workspace \{\s*height: auto;\s*grid-template-columns: minmax\(300px, \.9fr\) minmax\(320px, 1fr\) minmax\(380px, 1\.25fr\);\s*gap: 12px;[\s\S]*?\.detail-panel \{ grid-column: auto; min-height: 0; \}/,
  );
  assert.match(
    style,
    /@media \(max-width: 1100px\) \{[\s\S]*?\.workspace \{ grid-template-columns: minmax\(0, 1fr\); \}[\s\S]*?\.detail-panel \{ grid-column: auto; \}/,
  );
  assert.doesNotMatch(style, /grid-template-columns: minmax\(380px, 1fr\) minmax\(420px, 1fr\)/);
  assert.doesNotMatch(style, /grid-template-columns: minmax\(310px, 0\.85fr\) minmax\(360px, 1fr\)/);
});

test('task cards use the compact queue scan rhythm', () => {
  assert.match(style, /\.task-card \{\s*padding: 11px 12px;\s*border-radius: 12px;/);
  assert.match(style, /\.task-prompt \{[\s\S]*?font-size: 11\.5px;[\s\S]*?-webkit-line-clamp: 2;/);
  assert.match(style, /\.task-footer \{\s*display: grid;\s*grid-template-columns: minmax\(0, 1fr\) auto;[\s\S]*?margin-top: 8px;\s*padding-top: 7px;/);
});

test('queued task actions use compact icon controls with dark-theme surfaces', () => {
  assert.match(
    style,
    /\.task-rename-button,\s*\.task-assign-button \{[\s\S]*?min-height: 26px;[\s\S]*?border-radius: 7px;/,
  );
  assert.match(style, /\.task-rename-button::before \{[\s\S]*?-webkit-mask: url\(/);
  assert.match(
    style,
    /\.queue-reorder \{[\s\S]*?overflow: hidden;[\s\S]*?border-radius: 7px;[\s\S]*?background: #f7f9fc;/,
  );
  assert.match(style, /\.queue-reorder button::before \{[\s\S]*?-webkit-mask: url\(/);
  assert.match(
    style,
    /html\[data-theme="dark"\] \.task-rename-button,[\s\S]*?background: color-mix\(in srgb, var\(--app-blue\) 6%, var\(--app-control\)\);/,
  );
  assert.match(
    style,
    /html\[data-theme="dark"\] \.queue-reorder \{[\s\S]*?border-color: var\(--app-border-strong\);[\s\S]*?background: var\(--app-control\);/,
  );
});

test('task cards do not repeat an automatically generated task name as the prompt preview', () => {
  assert.match(
    app,
    /\$\{taskHasCustomName\(task\) \? `<p class="task-prompt">\$\{escapeHtml\(task\.prompt\)\}<\/p>` : ''\}/,
  );
});

test('task queue omits the obsolete relay scope control', () => {
  assert.doesNotMatch(markup, /id="task-scope-button"/);
  assert.doesNotMatch(app, /taskScope|taskScopeButton|renderTaskScope/);
});
