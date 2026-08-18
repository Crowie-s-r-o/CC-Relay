import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);

test('task queue exposes one start-date-driven, CHANGELOG-style AI standup dialog', async () => {
  const [html, app, style, server] = await Promise.all([
    readFile(new URL('public/index.html', root), 'utf8'),
    readFile(new URL('public/app.js', root), 'utf8'),
    readFile(new URL('public/style.css', root), 'utf8'),
    readFile(new URL('src/server.mjs', root), 'utf8'),
  ]);
  const standupRoute = server.match(/if \(request\.method === 'POST' && pathname === '\/api\/standup\/generate'\) \{[\s\S]*?\n    \}\n\n    if \(request\.method === 'GET' && pathname === '\/api\/diagnostics'\)/)?.[0] || '';

  assert.match(html, /id="standup-button"[^>]+aria-controls="standup-modal"/);
  assert.match(html, /<dialog id="standup-modal"[^>]+aria-labelledby="standup-title"/);
  assert.match(html, /id="standup-date" type="date"/);
  assert.match(html, /Task start date/);
  assert.doesNotMatch(html, /id="standup-length"|All tasks|Short<\/option>|Standard<\/option>|Detailed<\/option>/);
  assert.match(html, /Added, Changed, Fixed, and Security/);
  assert.match(html, /id="standup-generator-provider"/);
  assert.match(html, /id="standup-generate"[^>]*>Generate changelog/);
  assert.match(html, /id="standup-copy"[^>]+disabled>Copy changelog/);
  assert.match(html, /saved prompts and responses/);
  assert.match(html, /Task terminals are never used/);

  assert.match(app, /api\('\/api\/standup\/generate'/);
  assert.match(app, /tasksForStandupDay\(projectTasks\(\), anchor\)/);
  assert.doesNotMatch(app, /buildStandupSummary/);
  assert.match(app, /elements\.standupDate\.addEventListener\('change'/);
  const openStandup = app.match(/function openStandup\(\) \{([\s\S]*?)\n\}\n\nfunction closeStandup/)?.[1] || '';
  assert.doesNotMatch(openStandup, /generateStandup/);
  assert.match(app, /state\.standupGenerating = true/);
  assert.doesNotMatch(app, /standupLength|relay\.standupLength|length: state\.standup/);
  assert.match(app, /standupSections\(\{/);
  assert.match(app, /body\.added/);
  assert.match(app, /body\.changed/);
  assert.match(app, /body\.fixed/);
  assert.match(app, /body\.security/);
  assert.match(app, /'text\/html': new Blob\(\[clipboardHtml\]/);
  assert.match(app, /navigator\.clipboard\.writeText\(state\.standupClipboardText\)/);
  assert.match(app, /copied with chat formatting/);
  assert.match(app, /capabilities\?\.aiStandupGeneration === true/);
  assert.match(app, /capabilities\?\.aiStandupChangelog === true/);
  assert.match(app, /capabilities\?\.aiStandupStartDate === true/);
  assert.doesNotMatch(app, /aiStandupConfiguration|aiStandupAllTasks/);

  assert.match(standupRoute, /pathname === '\/api\/standup\/generate'/);
  assert.match(server, /database\.listTaskPrompts\(task\.id\)/);
  assert.match(server, /database\.listTaskResponses\(task\.id\)/);
  assert.match(server, /startedAt: task\.started_at \|\| task\.created_at/);
  assert.doesNotMatch(standupRoute, /validateStandupLength|body\.length/);
  assert.match(server, /aiStandupGeneration: true/);
  assert.match(server, /aiStandupChangelog: true/);
  assert.match(server, /aiStandupStartDate: true/);

  assert.match(style, /\.standup-modal/);
  assert.match(style, /\.standup-list li/);
  assert.match(style, /\.standup-item-marker/);
  assert.match(style, /\.standup-generator-route/);
  assert.match(style, /\.standup-result-group/);
  assert.match(style, /\.standup-loading-line/);
  assert.match(style, /\.standup-button:disabled/);
  assert.doesNotMatch(style, /\.standup-length-field/);
});
