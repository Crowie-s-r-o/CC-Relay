import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const launchpad = readFileSync(new URL('../public/launchpad.css', import.meta.url), 'utf8');
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

function launchpadColor(theme, token) {
  const selector = theme === 'dark' ? 'html[data-theme="dark"] {' : ':root {';
  const start = launchpad.indexOf(selector);
  const block = launchpad.slice(start, launchpad.indexOf('}', start));
  const value = block.match(new RegExp(`${token}: (#[0-9a-f]{6});`))?.[1];
  assert.ok(value, `${theme} defines ${token}`);
  return value;
}

test('Launchpad text and primary action meet AA contrast in both themes', () => {
  for (const theme of ['light', 'dark']) {
    for (const token of ['--lp-text', '--lp-body', '--lp-muted']) {
      for (const surface of ['--lp-canvas', '--lp-panel', '--lp-surface', '--lp-control']) {
        assert.ok(contrast(launchpadColor(theme, token), launchpadColor(theme, surface)) >= 4.5,
          `${theme} ${token} must be readable on ${surface}`);
      }
    }
    assert.ok(contrast(launchpadColor(theme, '--lp-action-ink'), launchpadColor(theme, '--lp-accent')) >= 4.5);
  }
});

test('Launchpad owns final chrome tokens after the legacy stylesheet', () => {
  assert.ok(html.indexOf('href="/launchpad.css"') > html.indexOf('href="/style.css"'));
  assert.match(launchpad, /--app-panel: var\(--lp-panel\);/);
  assert.match(launchpad, /--app-text-quiet: var\(--lp-muted\);/);
  assert.equal(launchpadColor('dark', '--lp-canvas'), '#0b0e12');
  assert.equal(launchpadColor('dark', '--lp-panel'), '#0d1116');
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
    /html\[data-theme="dark"\] \.terminal-layout-settings input\[type="number"\],[\s\S]*?\.completion-alert-settings input\[type="number"\] \{[\s\S]*?background: var\(--app-control\);/,
  );
  assert.match(
    style,
    /html\[data-theme="dark"\] \.completion-alert-control-row,[\s\S]*?html\[data-theme="dark"\] \.completion-speech-choices label \{[\s\S]*?background: var\(--app-control\);/,
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
