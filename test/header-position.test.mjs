import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { normalizeUiPreferences } from '../src/ui-preferences.mjs';

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
    /id="header-position-toggle"[\s\S]*?aria-label="Move monitor bar to top"[\s\S]*?aria-pressed="true"/,
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

test('first paint, renderer restore, and shared preferences agree on bottom defaults and saved choices', () => {
  const bootstrap = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const positionFunctions = app.slice(app.indexOf('function currentHeaderPosition()'), app.indexOf('function cachedCompletionAlertPreferences()'));
  for (const value of [undefined, null, '', 'sideways', 0, false, 'top', 'bottom']) {
    const expected = value === 'top' ? 'top' : 'bottom';
    const document = { documentElement: { dataset: {} }, querySelector: () => null };
    runInNewContext(bootstrap, {
      document,
      localStorage: { getItem: (key) => key === 'relay.headerPosition' ? value : null },
      matchMedia: () => ({ matches: false }),
      URLSearchParams,
      location: { search: '' },
      navigator: { userAgent: 'Browser' },
    });
    assert.equal(document.documentElement.dataset.headerPosition, expected);
    const runtime = { document, requestAnimationFrame() {} };
    runInNewContext(positionFunctions, runtime);
    runtime.setHeaderPosition(value, { persist: false });
    assert.equal(runtime.currentHeaderPosition(), expected);
    assert.equal(normalizeUiPreferences({ panelWidths: { composer: 420, queue: 440 }, headerPosition: value }).headerPosition, expected);
  }
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
