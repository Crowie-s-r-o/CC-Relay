import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const markup = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const server = readFileSync(new URL('../src/server.mjs', import.meta.url), 'utf8');
const style = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');

test('status publishes the local daily provider-token total', () => {
  assert.match(server, /dailyTokenUsage: database\.todayTokenUsage\(\),/);
  assert.match(server, /dailyTokenUsage: true,/);
});

test('the desktop Crowie title bar renders and refreshes today\'s token total', () => {
  assert.match(markup, /id="desktop-titlebar-token-usage"[\s\S]*?role="status"/);
  assert.match(markup, /id="desktop-titlebar-token-count">Today --<\/span>/);
  assert.match(app, /dailyTokenUsagePresentation/);
  assert.match(app, /state\.status\?\.dailyTokenUsage/);
  assert.match(app, /state\.status\?\.capabilities\?\.dailyTokenUsage === true/);
  assert.match(app, /desktopTitlebarTokenCount\.textContent = presentation\.label/);
  assert.match(app, /desktopTitlebarTokenUsage\.dataset\.state = presentation\.state/);
  assert.match(app, /function renderStatus\(\)[\s\S]*?renderDailyTokenUsage\(\);/);
  assert.match(style, /\.desktop-titlebar-token-usage \{/);
  assert.match(style, /\.desktop-titlebar-token-usage\[data-state="ready"\] span/);
});
