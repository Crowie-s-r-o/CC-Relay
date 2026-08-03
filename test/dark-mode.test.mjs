import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const style = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');

test('theme is restored before the stylesheet paints', () => {
  const initializer = html.indexOf("localStorage.getItem('relay.theme')");
  const stylesheet = html.indexOf('<link rel="stylesheet" href="/style.css">');
  assert.ok(initializer > 0);
  assert.ok(initializer < stylesheet);
  assert.match(html, /matchMedia\('\(prefers-color-scheme: dark\)'\)\.matches/);
});

test('header exposes an accessible theme toggle', () => {
  assert.match(html, /id="theme-toggle"[\s\S]*?aria-label="Use dark mode"/);
  assert.match(app, /toggle\.setAttribute\('aria-label', `Use \$\{nextLabel\} mode`\)/);
  assert.match(app, /localStorage\.setItem\('relay\.theme', nextTheme\)/);
  assert.match(app, /elements\.themeToggle\.addEventListener\('click'/);
});

test('dark theme defines app chrome without overriding the execution ledger', () => {
  assert.match(style, /html\[data-theme="dark"\] \{[\s\S]*?--mist: #08090d;[\s\S]*?--paper: #131418;[\s\S]*?--signal: #7aa2f7;/);
  assert.match(style, /html\[data-theme="dark"\] \.panel \{/);
  assert.match(style, /html\[data-theme="dark"\] \.terminal-settings-card,/);
  const darkTheme = style.slice(style.indexOf('Midnight control room theme.'));
  assert.doesNotMatch(darkTheme, /html\[data-theme="dark"\] \.events-section/);
});

function channels(hex) {
  return [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16));
}

function luminance(hex) {
  return channels(hex)
    .map((value) => {
      const channel = value / 255;
      return channel <= 0.04045
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4;
    })
    .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
}

function contrast(left, right) {
  const values = [luminance(left), luminance(right)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

test('terminal-derived dark text tokens meet WCAG contrast on raised controls', () => {
  for (const foreground of ['#e9ebef', '#d3d6dc', '#9ca2ad', '#858b96']) {
    assert.ok(
      contrast(foreground, '#1b1d22') >= 4.5,
      `${foreground} must remain readable on the raised terminal surface`,
    );
  }
  assert.ok(contrast('#071021', '#7aa2f7') >= 4.5);
});

test('the dark shell is neutral rather than navy', () => {
  const block = style.slice(
    style.indexOf('html[data-theme="dark"] {'),
    style.indexOf('html[data-theme="dark"] body'),
  );
  const surfaces = ['--app-well', '--app-panel', '--app-control', '--app-border', '--app-text'];
  for (const name of surfaces) {
    const hex = block.match(new RegExp(`${name}: (#[0-9a-f]{6});`))?.[1];
    assert.ok(hex, `${name} must be declared in the dark token block`);
    const [red, green, blue] = channels(hex);
    assert.ok(
      Math.max(red, green, blue) - Math.min(red, green, blue) <= 14,
      `${name} (${hex}) must stay a neutral grey, not a tinted navy`,
    );
  }
});

test('dark task evidence overrides higher-specificity light document surfaces', () => {
  assert.match(
    style,
    /html\[data-theme="dark"\] \.detail-panel \.detail-copy-disclosure > pre,[\s\S]*?html\[data-theme="dark"\] \.detail-panel \.detail-copy-disclosure > \.result-markdown \{[\s\S]*?background: var\(--app-well\);/,
  );
  assert.match(style, /--app-blue: #7aa2f7;[\s\S]*?--app-violet: #bb9af7;[\s\S]*?--app-teal: #73daca;/);
});

test('revealed terminal and attachment controls cannot retain light surfaces', () => {
  assert.match(
    style,
    /html\[data-theme="dark"\] \.command-row code,[\s\S]*?\.terminal-layout-settings input\[type="number"\],[\s\S]*?background: var\(--app-control\);/,
  );
  assert.match(
    style,
    /html\[data-theme="dark"\] \.terminal-background-toggle \{[\s\S]*?color: var\(--app-text-body\) !important;/,
  );
  assert.match(
    style,
    /html\[data-theme="dark"\] \.attachment-card \{[\s\S]*?border-color: var\(--app-border\);[\s\S]*?background: var\(--app-control\);/,
  );
  assert.match(
    style,
    /html\[data-theme="dark"\] \.attachment-card button \{[\s\S]*?color: var\(--app-red\);[\s\S]*?background: color-mix\(in srgb, var\(--app-red\) 10%, var\(--app-control\)\);/,
  );
});
