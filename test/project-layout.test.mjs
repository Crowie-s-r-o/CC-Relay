import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const style = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');
const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

test('desktop Launchpad uses one compact horizontal card row without vertical clipping', () => {
  assert.match(style, /\.project-list \{\s*display: flex;[\s\S]*?overflow-x: auto;\s*overflow-y: hidden;/);
  assert.match(style, /\.project-chip \{\s*display: grid;\s*flex: 0 0 330px;[\s\S]*?grid-template-areas: "head activity close";\s*grid-template-columns: minmax\(138px, \.9fr\) minmax\(0, 1\.1fr\) 20px;[\s\S]*?height: 42px;/);
  assert.match(style, /@media \(min-width: 1345px\) \{[\s\S]*?\.app-header \{\s*height: 84px;[\s\S]*?\.project-dock \{\s*height: 104px;\s*min-height: 104px;/);
  assert.match(style, /\.workspace \{\s*height: calc\(100vh - 188px\)/);
});

test('project cards show activity without per-provider launch buttons', () => {
  const renderStart = app.indexOf('function renderProjects()');
  const activityStart = app.indexOf('function projectActivity(', renderStart);
  const renderSource = app.slice(renderStart, activityStart);
  assert.match(renderSource, /class="project-activity"/);
  assert.match(renderSource, /activity\.status/);
  assert.doesNotMatch(renderSource, /project-launch-(?:codex|claude)/);
  assert.ok(renderSource.indexOf('class="project-unpin"') > renderSource.indexOf('class="project-chip-foot"'));
});

test('narrow project cards preserve the far-right close column', () => {
  assert.match(style, /@media \(max-width: 760px\) \{[\s\S]*?\.project-chip \{\s*flex-basis: calc\(100vw - 28px\);\s*\}/);
  assert.match(style, /\.project-unpin \{\s*grid-area: close;/);
});
