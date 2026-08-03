import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);

test('task queue exposes a date-driven, copy-ready AI standup dialog', async () => {
  const [html, app, style, server] = await Promise.all([
    readFile(new URL('public/index.html', root), 'utf8'),
    readFile(new URL('public/app.js', root), 'utf8'),
    readFile(new URL('public/style.css', root), 'utf8'),
    readFile(new URL('src/server.mjs', root), 'utf8'),
  ]);

  assert.match(html, /id="standup-button"[^>]+aria-controls="standup-modal"/);
  assert.match(html, /<dialog id="standup-modal"[^>]+aria-labelledby="standup-title"/);
  assert.match(html, /id="standup-date" type="date"/);
  assert.match(html, /id="standup-length"/);
  assert.match(html, /id="standup-task-list"/);
  assert.match(html, /id="standup-blocker-list"/);
  assert.match(html, /id="standup-generator-provider"/);
  assert.match(html, /id="standup-generate"[^>]*>Generate standup/);
  assert.match(html, /id="standup-copy"[^>]+disabled>Copy standup/);
  assert.match(html, /saved prompts and responses/);
  assert.match(html, /Task terminals are never used/);

  assert.match(app, /api\('\/api\/standup\/generate'/);
  assert.match(app, /tasksForStandupDay\(projectTasks\(\), anchor\)/);
  assert.doesNotMatch(app, /buildStandupSummary|standupItem/);
  assert.match(app, /elements\.standupDate\.addEventListener\('change'/);
  const openStandup = app.match(/function openStandup\(\) \{([\s\S]*?)\n\}\n\nfunction closeStandup/)?.[1] || '';
  assert.doesNotMatch(openStandup, /generateStandup/);
  assert.match(app, /state\.standupGenerating = true/);
  assert.match(app, /length: state\.standupLength/);
  assert.match(app, /standupSections\(\{/);
  assert.match(app, /navigator\.clipboard\.writeText\(state\.standupClipboardText\)/);
  assert.match(app, /without bullet prefixes/);
  assert.match(app, /capabilities\?\.aiStandupGeneration === true/);
  assert.match(app, /capabilities\?\.aiStandupConfiguration === true/);

  assert.match(server, /pathname === '\/api\/standup\/generate'/);
  assert.match(server, /database\.listTaskPrompts\(task\.id\)/);
  assert.match(server, /database\.listTaskResponses\(task\.id\)/);
  assert.match(server, /validateStandupLength\(body\.length\)/);
  assert.match(server, /aiStandupGeneration: true/);
  assert.match(server, /aiStandupConfiguration: true/);

  assert.match(style, /\.standup-modal/);
  assert.match(style, /\.standup-list li/);
  assert.match(style, /\.standup-item-marker/);
  assert.match(style, /\.standup-generator-route/);
  assert.match(style, /\.standup-result-group/);
  assert.match(style, /\.standup-loading-line/);
  assert.match(style, /\.standup-button:disabled/);
});
