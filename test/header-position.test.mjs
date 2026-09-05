import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const style = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');

test('monitor bar position is restored before the stylesheet paints', () => {
  const initializer = html.indexOf("localStorage.getItem('relay.headerPosition')");
  const stylesheet = html.indexOf('<link rel="stylesheet" href="/application.css">');
  assert.ok(initializer > 0);
  assert.ok(initializer < stylesheet);
  assert.match(
    html,
    /dataset\.headerPosition =[\s\S]*?=== 'top' \? 'top' : 'bottom'/,
  );
});

test('header exposes an accessible persisted position control', () => {
  assert.match(
    html,
    /id="header-position-toggle"[\s\S]*?aria-label="Move monitor bar to bottom"[\s\S]*?aria-pressed="false"/,
  );
  assert.match(
    app,
    /toggle\.setAttribute\('aria-label', `Move monitor bar to \$\{nextPosition\}`\)/,
  );
  assert.match(app, /localStorage\.setItem\('relay\.headerPosition', nextPosition\)/);
  assert.match(app, /setHeaderPosition\(preferences\.headerPosition, \{ persist: false \}\)/);
  assert.match(app, /queueUiPreferencesSave\(\)/);
  assert.match(app, /elements\.headerPositionToggle\.addEventListener\('click'/);
});

test('bottom monitor bar reserves its measured height instead of covering content', () => {
  assert.match(
    style,
    /html\[data-header-position="bottom"\] body \{\s*padding-bottom: var\(--app-header-height, 58px\);/,
  );
  assert.match(
    style,
    /html\[data-header-position="bottom"\] \.app-header \{[\s\S]*?position: fixed;[\s\S]*?bottom: 0;[\s\S]*?border-top: 1px solid var\(--line\);[\s\S]*?border-bottom: 0;/,
  );
  assert.match(app, /new ResizeObserver\(syncHeaderHeight\)\.observe\(elements\.appHeader\)/);
});

test('running monitor cards use the enlarged type scale', () => {
  assert.match(style, /\.header-running-meta \{\s*font-size: 8px;/);
  assert.match(style, /\.header-running-prompt \{\s*font-size: 11px;/);
  assert.match(style, /\.header-running-response \{\s*font-size: 10px;/);
  assert.match(style, /\.header-running-response b \{\s*font-size: 8px;/);
});
