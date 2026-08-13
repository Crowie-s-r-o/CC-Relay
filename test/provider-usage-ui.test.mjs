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

test('header places four accessible usage meters after the position control without an online pill', () => {
  assert.equal(PROVIDER_USAGE_METERS.length, 4);
  assert.equal((html.match(/data-usage-key=/g) || []).length, 4);
  assert.equal((html.match(/class="provider-usage-reset"/g) || []).length, 4);
  for (const meter of PROVIDER_USAGE_METERS) {
    assert.match(html, new RegExp(`data-usage-key="${meter.key}"`));
  }
  assert.doesNotMatch(html, /id="pause-button"/);
  assert.doesNotMatch(app, /pauseButton/);
  assert.doesNotMatch(html, /id="codex-status"/);
  assert.doesNotMatch(app, /codexStatus/);
  assert.ok(html.indexOf('id="header-position-toggle"') < html.indexOf('id="provider-usage"'));
  assert.ok(html.indexOf('id="provider-usage"') < html.indexOf('id="theme-toggle"'));
  assert.match(html, /role="progressbar"/);
  assert.match(app, /renderProviderUsage\(\)/);
  assert.match(server, /providerUsage: providerUsage\.current\(\)/);
  assert.match(server, /providerUsage: true/);
  assert.match(server, /providerUsage\.start\(\)/);
  assert.match(server, /providerUsage\.stop\(\)/);
  assert.match(server, /pathname === '\/api\/queue\/pause'/);
  assert.match(server, /pathname === '\/api\/queue\/resume'/);
});

test('usage meter presentation exposes threshold, stale, and unavailable states', () => {
  const presentations = providerUsagePresentation({
    claude: {
      status: 'stale',
      fiveHour: { usedPercent: 12, resetLabel: '1:20am' },
      weekly: { usedPercent: 70, resetLabel: 'Thursday' },
      fableWeekly: { usedPercent: 79, resetLabel: 'Thursday' },
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
    { value: '79%', level: 'elevated' },
    { value: '--', level: 'unavailable' },
  ]);
  assert.match(presentations[0].title, /Resets 1:20am/);
  assert.match(presentations[0].title, /Last known value/);
  assert.match(presentations[3].title, /unavailable/);
  assert.equal(presentations[3].countdown, '');
});

test('reset countdowns use hours and minutes for 5-hour usage and days and hours otherwise', () => {
  const now = Date.parse('2026-08-13T00:30:00Z');
  const presentations = providerUsagePresentation({
    claude: {
      status: 'ready',
      fiveHour: { usedPercent: 12, resetLabel: '4:45am (UTC)' },
      weekly: { usedPercent: 70, resetLabel: 'Aug 15 at 2pm (UTC)' },
      fableWeekly: { usedPercent: 79, resetLabel: 'Aug 14 at 2pm (UTC)' },
    },
    codex: {
      status: 'ready',
      weekly: { usedPercent: 6, resetsAt: Date.parse('2026-08-16T14:00:00Z') / 1_000 },
    },
  }, { now });

  assert.deepEqual(presentations.map(({ countdown }) => countdown), [
    '4h 15m',
    '2d 14h',
    '1d 14h',
    '3d 14h',
  ]);
  assert.equal(presentations[0].countdownLabel, 'Resets in 4 hours and 15 minutes');
  assert.equal(presentations[1].countdownLabel, 'Resets in 2 days and 14 hours');
});

test('a time-only Claude reset uses its timezone and rolls into the next day', () => {
  const [fiveHour] = providerUsagePresentation({
    claude: {
      status: 'ready',
      fiveHour: { usedPercent: 12, resetLabel: '1:20am (Europe/Bratislava)' },
    },
  }, { now: Date.parse('2026-08-12T21:00:00Z') });

  assert.equal(fiveHour.countdown, '2h 20m');
});

test('usage thresholds are green below 50, yellow from 50, orange from 75, and red from 90', () => {
  const levelAt = (usedPercent) => providerUsagePresentation({
    claude: {
      status: 'ready',
      fiveHour: { usedPercent },
      weekly: { usedPercent },
      fableWeekly: { usedPercent },
    },
    codex: { status: 'ready', weekly: { usedPercent } },
  })[0].level;

  assert.equal(levelAt(49), 'normal');
  assert.equal(levelAt(50), 'warning');
  assert.equal(levelAt(74), 'warning');
  assert.equal(levelAt(75), 'elevated');
  assert.equal(levelAt(89), 'elevated');
  assert.equal(levelAt(90), 'critical');
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

test('usage strip has four semantic colors, dark mode, and mobile layout', () => {
  assert.match(style, /\.provider-usage-meter \{[\s\S]*?--provider-usage-accent: #2f855a;/);
  assert.match(style, /\.provider-usage-meter\[data-level="warning"\]/);
  assert.match(style, /\.provider-usage-meter\[data-level="elevated"\]/);
  assert.match(style, /\.provider-usage-meter\[data-level="critical"\]/);
  assert.match(style, /html\[data-theme="dark"\] \.provider-usage/);
  assert.match(style, /\.provider-usage-reset/);
  assert.match(style, /@media \(max-width: 760px\)[\s\S]*?\.provider-usage/);
  const baseTrack = style.indexOf('.provider-usage-track i {', style.indexOf('Subscription runway'));
  const reducedMotion = style.lastIndexOf('@media (prefers-reduced-motion: reduce)');
  assert.ok(reducedMotion > baseTrack);
  assert.match(style.slice(reducedMotion), /\.provider-usage-track i \{\s*transition: none;/);
});
