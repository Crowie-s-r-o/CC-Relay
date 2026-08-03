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

test('task queue omits the obsolete relay scope control', () => {
  assert.doesNotMatch(markup, /id="task-scope-button"/);
  assert.doesNotMatch(app, /taskScope|taskScopeButton|renderTaskScope/);
});
