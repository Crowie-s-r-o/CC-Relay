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
  assert.match(style, /\.workspace \{\s*height: calc\(100vh - 102px\)/);
  const selectedStyle = style.slice(
    style.indexOf('.project-chip[class*="project-color-"].selected {'),
    style.indexOf('.project-chip[class*="project-color-"].selected:hover {'),
  );
  assert.doesNotMatch(selectedStyle, /transform:/);
  assert.doesNotMatch(selectedStyle, /0 0 0/);
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

test('task activity identifies new completions and can clear the current project', () => {
  assert.match(markup, /id="clear-task-notifications-button"[\s\S]*?>Clear new<\/button>/);
  assert.match(app, /projectCompletionNotifications\.includes\(task\.repo_path, task\.id\)/);
  assert.match(app, /class="task-card [^"]*\$\{unread \? 'task-card-unread' : ''\}/);
  assert.match(app, /<span class="task-unread-marker">New<\/span>/);
  assert.match(app, /projectCompletionNotifications\.acknowledgeProject\(state\.activeProjectPath\)/);
  assert.match(style, /\.task-card-unread \{[\s\S]*?var\(--project-accent/);
  assert.match(style, /\.task-unread-marker \{[\s\S]*?text-transform: uppercase;/);
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
