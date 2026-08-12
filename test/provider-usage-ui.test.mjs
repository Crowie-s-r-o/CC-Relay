import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  PROVIDER_USAGE_METERS,
  providerUsagePresentation,
} from '../public/provider-usage.js';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const style = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');
const server = readFileSync(new URL('../src/server.mjs', import.meta.url), 'utf8');

test('header replaces the queue pause button with four accessible usage meters', () => {
  assert.equal(PROVIDER_USAGE_METERS.length, 4);
  assert.equal((html.match(/data-usage-key=/g) || []).length, 4);
  for (const meter of PROVIDER_USAGE_METERS) {
    assert.match(html, new RegExp(`data-usage-key="${meter.key}"`));
  }
  assert.doesNotMatch(html, /id="pause-button"/);
  assert.doesNotMatch(app, /pauseButton/);
  assert.match(html, /role="progressbar"/);
  assert.match(app, /renderProviderUsage\(\)/);
  assert.match(server, /providerUsage: providerUsage\.current\(\)/);
  assert.match(server, /providerUsage: true/);
  assert.match(server, /providerUsage\.start\(\)/);
  assert.match(server, /providerUsage\.stop\(\)/);
  assert.match(server, /pathname === '\/api\/queue\/pause'/);
  assert.match(server, /pathname === '\/api\/queue\/resume'/);
});

test('usage meter presentation exposes warning, critical, stale, and unavailable states', () => {
  const presentations = providerUsagePresentation({
    claude: {
      status: 'stale',
      fiveHour: { usedPercent: 12, resetLabel: '1:20am' },
      weekly: { usedPercent: 70, resetLabel: 'Thursday' },
      fableWeekly: { usedPercent: 91, resetLabel: 'Thursday' },
    },
    codex: {
      status: 'unavailable',
      weekly: null,
    },
  }, {
    formatDate: () => 'Aug 19, 2:00 PM',
  });

  assert.deepEqual(presentations.map(({ value, level }) => ({ value, level })), [
    { value: '12%', level: 'normal' },
    { value: '70%', level: 'warning' },
    { value: '91%', level: 'critical' },
    { value: '--', level: 'unavailable' },
  ]);
  assert.match(presentations[0].title, /Resets 1:20am/);
  assert.match(presentations[0].title, /Last known value/);
  assert.match(presentations[3].title, /unavailable/);
});

test('Codex epoch reset times are formatted for the meter tooltip', () => {
  const [,,, codex] = providerUsagePresentation({
    claude: { status: 'checking' },
    codex: {
      status: 'ready',
      weekly: { usedPercent: 6, resetsAt: 1_786_743_600, resetLabel: null },
    },
  }, {
    formatDate: () => 'Aug 19, 2:00 PM',
  });
  assert.equal(codex.value, '6%');
  assert.match(codex.title, /Resets Aug 19, 2:00 PM/);
});

test('an absent model-specific window settles as unavailable after Claude responds', () => {
  const [,, fable] = providerUsagePresentation({
    claude: {
      status: 'ready',
      fiveHour: { usedPercent: 4, resetLabel: '2am' },
      weekly: { usedPercent: 51, resetLabel: 'Friday' },
      fableWeekly: null,
    },
    codex: { status: 'checking' },
  });
  assert.equal(fable.level, 'unavailable');
  assert.equal(fable.value, '--');
});

test('usage strip has provider colors, semantic thresholds, dark mode, and mobile layout', () => {
  assert.match(style, /\.provider-usage-meter\[data-provider="claude"\]/);
  assert.match(style, /\.provider-usage-meter\[data-level="warning"\]/);
  assert.match(style, /\.provider-usage-meter\[data-level="critical"\]/);
  assert.match(style, /html\[data-theme="dark"\] \.provider-usage/);
  assert.match(style, /@media \(max-width: 760px\)[\s\S]*?\.provider-usage/);
  const baseTrack = style.indexOf('.provider-usage-track i {', style.indexOf('Subscription runway'));
  const reducedMotion = style.lastIndexOf('@media (prefers-reduced-motion: reduce)');
  assert.ok(reducedMotion > baseTrack);
  assert.match(style.slice(reducedMotion), /\.provider-usage-track i \{\s*transition: none;/);
});
