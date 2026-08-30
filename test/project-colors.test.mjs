import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  PROJECT_COLOR_COUNT,
  PROJECT_COLOR_PRESETS,
  normalizeProjectColor,
  projectColorClass,
  projectColorClasses,
  projectColorIndex,
  projectColorTokens,
} from '../public/project-colors.js';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const index = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const server = readFileSync(new URL('../src/server.mjs', import.meta.url), 'utf8');
const style = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');

function colorChannels(hex) {
  return [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16));
}

function relativeLuminance(channels) {
  return channels
    .map((value) => {
      const channel = value / 255;
      return channel <= 0.04045
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4;
    })
    .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
}

function contrastRatio(left, right) {
  const [bright, dark] = [relativeLuminance(left), relativeLuminance(right)]
    .sort((first, second) => second - first);
  return (bright + 0.05) / (dark + 0.05);
}

function mixWithWhite(channels, amount) {
  return channels.map((channel) => Math.round(channel * amount + 255 * (1 - amount)));
}

test('project colors are stable across path separator and case variations', () => {
  assert.equal(
    projectColorIndex('/Users/Dev/CC Relay/'),
    projectColorIndex('\\users\\dev\\relay'),
  );
});

test('project colors always map to the eight-color interface palette', () => {
  for (const path of ['/repo/relay', '/repo/documi', '/repo/agreau', '/repo/vector-algo']) {
    assert.match(projectColorClass(path), /^project-color-[1-8]$/);
  }
  assert.equal(PROJECT_COLOR_COUNT, 8);
  assert.equal(PROJECT_COLOR_PRESETS.length, PROJECT_COLOR_COUNT);
});

test('visible projects receive distinct colors while palette capacity remains', () => {
  const paths = [
    '/Users/dev/WebstormProjects/relay',
    '/Users/dev/WebstormProjects/documi-ai',
    '/Users/dev/src/Agreau',
    '/Users/dev/WebstormProjects/vector-algo',
    '/Users/dev/WebstormProjects/talent-finder',
    '/Users/dev/WebstormProjects/sixth-project',
    '/Users/dev/WebstormProjects/seventh-project',
    '/Users/dev/WebstormProjects/eighth-project',
  ];
  const classes = projectColorClasses(paths);
  assert.equal(new Set(classes).size, paths.length);
});

test('Relay and talent-finder resolve to clearly separated automatic hues', () => {
  const paths = [
    '/Users/patrikkelemen/WebstormProjects/relay',
    '/Users/patrikkelemen/WebstormProjects/Agreau',
    '/Users/patrikkelemen/WebstormProjects/vector-algo',
    '/Users/patrikkelemen/WebstormProjects/talent-finder',
    '/Users/patrikkelemen/WebstormProjects/namiru-ai',
    '/Users/patrikkelemen/WebstormProjects/documi-ai',
  ];
  const classes = projectColorClasses(paths);
  assert.equal(classes[0], 'project-color-8');
  assert.equal(classes[3], 'project-color-5');
});

test('project identity remains visible across Launchpad and running-task cards', () => {
  assert.match(
    app,
    /class="header-running-prompt"[\s\S]{0,220}class="header-running-project"[\s\S]{0,120}\$\{escapeHtml\(project\)\}/,
  );
  assert.match(app, /class="header-running-loc">\$\{escapeHtml\(relay\)\}<\/span>/);
  assert.match(
    style,
    /\.project-chip\[class\*="project-color-"\] \{[\s\S]*?border-color: color-mix\(in srgb, var\(--project-accent\) 12%, var\(--line\)\);[\s\S]*?background: color-mix\(in srgb, var\(--project-accent\) 4%, #fff\);/,
  );
  assert.match(
    style,
    /\.project-chip\[class\*="project-color-"\] \.project-pin,[\s\S]*?color: #fff;\s*background: var\(--project-accent\);/,
  );
  const selectedProjectStyle = style.slice(
    style.indexOf('.project-chip[class*="project-color-"].selected {'),
    style.indexOf('.project-chip[class*="project-color-"].selected:hover {'),
  );
  assert.match(selectedProjectStyle, /border: 1px solid var\(--project-accent\);/);
  assert.match(
    selectedProjectStyle,
    /background: color-mix\(in srgb, var\(--project-accent\) 11%, #fff\);/,
  );
  assert.match(selectedProjectStyle, /box-shadow: 0 1px 2px rgb\(23 32 51 \/ 8%\);/);
  assert.doesNotMatch(selectedProjectStyle, /0 0 0|transform:/);
  const selectedProjectPinStyle = style.slice(
    style.indexOf('.project-chip[class*="project-color-"].selected .project-pin {'),
    style.indexOf('.terminal-option[class*="relay-color-"]'),
  );
  assert.match(selectedProjectPinStyle, /box-shadow: none;/);
  assert.doesNotMatch(selectedProjectPinStyle, /#fff|0 0 0/);
  assert.match(
    style,
    /\.header-running-task \{[\s\S]*?border: 1px solid color-mix\(in srgb, var\(--project-accent, var\(--running\)\) 22%, var\(--line\)\);[\s\S]*?background: color-mix\(in srgb, var\(--project-accent, var\(--running\)\) 6%, #fff\);/,
  );
  assert.match(
    style,
    /\.header-running-project \{[\s\S]*?flex: 0 0 auto;[\s\S]*?min-width: 3ch;[\s\S]*?color: var\(--project-accent, var\(--running\)\);[\s\S]*?text-overflow: ellipsis;/,
  );
  assert.match(style, /\.header-running-task-name \{\s*flex: 1 1 0;\s*min-width: 0;/);
  assert.doesNotMatch(
    style,
    /\.header-running-task::before/,
  );
  const projectIdentityStyles = style.slice(
    style.indexOf('.project-color-1'),
    style.indexOf('.terminal-option[class*="relay-color-"]'),
  );
  assert.doesNotMatch(projectIdentityStyles, /linear-gradient\(/);
});

test('prompt composer inherits the active project identity across interactive controls', () => {
  assert.match(
    app,
    /function renderComposerProjectIdentity\(\) \{[\s\S]*?applyProjectIdentityStyle\(elements\.form, project\?\.path\);/,
  );
  assert.match(
    app,
    /function renderProjects\(\) \{\s*renderComposerProjectIdentity\(\);/,
  );
  assert.match(
    style,
    /#task-form\[class\*="project-color-"\] \{[\s\S]*?--composer-accent: var\(--project-accent, var\(--signal\)\);/,
  );
  assert.match(
    style,
    /#task-form\[class\*="project-color-"\] \.mode-tab\.selected,[\s\S]*?\.agent-tab-shell:has\(\.agent-tab\.selected\) \{[\s\S]*?border-color: var\(--composer-accent\);[\s\S]*?background: var\(--composer-accent-soft\);/,
  );
  assert.match(
    style,
    /#task-form\[class\*="project-color-"\] select,[\s\S]*?background: var\(--composer-control-soft\);/,
  );
  assert.match(
    style,
    /#task-form\[class\*="project-color-"\] \.effort-slider::\-webkit-slider-runnable-track \{[\s\S]*?var\(--composer-accent\) var\(--effort-progress\)/,
  );
  assert.match(
    style,
    /#task-form\[class\*="project-color-"\] #task-submit-button \{[\s\S]*?background: var\(--composer-accent\);/,
  );
  assert.match(
    style,
    /html\[data-theme="dark"\] #task-form\[class\*="project-color-"\] \{[\s\S]*?--composer-accent: var\(--project-accent-dark, var\(--app-blue\)\);/,
  );
});

test('project accents keep names and initial tiles readable on the strongest tint', () => {
  const accents = [...style.matchAll(
    /\.project-color-\d \{ --project-accent: (#[\da-f]{6});/gi,
  )].map((match) => match[1]);
  assert.equal(accents.length, PROJECT_COLOR_COUNT);
  for (const accent of accents) {
    const channels = colorChannels(accent);
    assert.ok(
      contrastRatio(channels, mixWithWhite(channels, 0.16)) >= 4.5,
      `${accent} must keep 4.5:1 contrast on the strongest project tint`,
    );
    assert.ok(
      contrastRatio([255, 255, 255], channels) >= 4.5,
      `${accent} must keep 4.5:1 contrast behind the white initial`,
    );
  }
});

test('custom project colors produce readable light and dark identity tokens', () => {
  for (const color of ['#ffffff', '#ffff00', '#000000', '#3b82f6', '#f04fc3']) {
    const tokens = projectColorTokens(color);
    assert.equal(normalizeProjectColor(color), color);
    assert.ok(
      contrastRatio(colorChannels(tokens.light), mixWithWhite(colorChannels(tokens.light), 0.16)) >= 4.5,
      `${color} must produce readable light-theme text`,
    );
    assert.ok(
      contrastRatio([255, 255, 255], colorChannels(tokens.light)) >= 4.5,
      `${color} must produce a readable light-theme initial`,
    );
    assert.ok(
      contrastRatio(colorChannels(tokens.dark), [7, 16, 33]) >= 4.5,
      `${color} must produce a readable dark-theme initial`,
    );
  }
  assert.equal(normalizeProjectColor('red'), null);
});

test('project color picker offers presets, custom input, reset, and shared persistence', () => {
  assert.match(index, /id="project-color-modal"/);
  assert.match(index, /id="project-color-custom-input" type="color"/);
  assert.match(app, /PROJECT_COLOR_PRESETS\.map/);
  assert.match(app, /data-project-color=""/);
  assert.match(app, /api\(`\/api\/projects\/\$\{project\.id\}\/color`/);
  assert.match(server, /projectColors: true/);
  assert.match(server, /projectMatch\?\.\[2\] === 'color'/);
  assert.match(style, /\.project-color-preset-auto \.project-color-preset-swatch \{[\s\S]*?conic-gradient/);
});
