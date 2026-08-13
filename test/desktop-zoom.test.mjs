import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  DESKTOP_ZOOM_FACTORS,
  desktopZoomDirectionForInput,
  desktopZoomFactorForInput,
  desktopZoomStatus,
  nextDesktopZoomFactor,
} from '../src/desktop-zoom.mjs';
import { desktopMenuRequired, desktopMenuTemplate } from '../src/desktop-menu.mjs';

const mainSource = readFileSync(new URL('../src/electron-main.mjs', import.meta.url), 'utf8');
const serverSource = readFileSync(new URL('../src/server.mjs', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const markup = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

function keyInput(key, overrides = {}) {
  return {
    type: 'keyDown',
    key,
    meta: true,
    control: false,
    alt: false,
    ...overrides,
  };
}

function findZoomItems(template) {
  const view = template.find((entry) => entry.label === 'View');
  return view.submenu.filter((entry) => typeof entry.click === 'function');
}

test('desktop zoom shortcuts step, reset, and clamp the whole app scale', () => {
  assert.equal(desktopZoomFactorForInput(keyInput('='), 1), 1.1);
  assert.equal(desktopZoomFactorForInput(keyInput('+'), 1.1), 1.25);
  assert.equal(desktopZoomFactorForInput(keyInput('-'), 1), 0.9);
  assert.equal(desktopZoomFactorForInput(keyInput('0'), 1.75), 1);
  assert.equal(desktopZoomFactorForInput(keyInput('+'), DESKTOP_ZOOM_FACTORS.at(-1)), 2);
  assert.equal(desktopZoomFactorForInput(keyInput('-'), DESKTOP_ZOOM_FACTORS[0]), 0.5);
});

test('desktop zoom accepts Control and ignores unrelated or modified input', () => {
  assert.equal(desktopZoomFactorForInput(keyInput('-', { meta: false, control: true }), 1), 0.9);
  assert.equal(desktopZoomFactorForInput(keyInput('-', { meta: false }), 1), null);
  assert.equal(desktopZoomFactorForInput(keyInput('-', { alt: true }), 1), null);
  assert.equal(desktopZoomFactorForInput(keyInput('x'), 1), null);
  assert.equal(desktopZoomFactorForInput(keyInput('-', { type: 'keyUp' }), 1), null);
  assert.equal(desktopZoomDirectionForInput(keyInput('_')), 'out');
  assert.equal(desktopZoomDirectionForInput(keyInput('x')), null);
});

test('menu and key handler share one bounded stepper', () => {
  assert.equal(nextDesktopZoomFactor('in', 1), 1.1);
  assert.equal(nextDesktopZoomFactor('out', 1), 0.9);
  assert.equal(nextDesktopZoomFactor('reset', 0.5), 1);
  assert.equal(nextDesktopZoomFactor('in', 2), 2);
  assert.equal(nextDesktopZoomFactor('out', 0.5), 0.5);
  assert.equal(nextDesktopZoomFactor(null, 1), null);
});

test('desktop zoom status reports a bounded current percentage', () => {
  assert.deepEqual(desktopZoomStatus(1), { factor: 1, percent: 100 });
  assert.deepEqual(desktopZoomStatus(1.249999), { factor: 1.25, percent: 125 });
  assert.deepEqual(desktopZoomStatus(0.67), { factor: 0.67, percent: 67 });
  assert.equal(desktopZoomStatus(0.49), null);
  assert.equal(desktopZoomStatus(2.01), null);
  assert.equal(desktopZoomStatus('unknown'), null);
});

test('macOS installs an owned menu and other platforms stay menu free', () => {
  assert.equal(desktopMenuRequired('darwin'), true);
  assert.equal(desktopMenuRequired('win32'), false);
  assert.equal(desktopMenuRequired('linux'), false);
});

test('the desktop menu binds every zoom accelerator to the bounded stepper', () => {
  const directions = [];
  const template = desktopMenuTemplate({ onZoom: (direction) => directions.push(direction) });
  const items = findZoomItems(template);
  const accelerators = items.map((item) => item.accelerator);

  assert.deepEqual(
    accelerators.filter((accelerator) => accelerator.endsWith('0')),
    ['CommandOrControl+0', 'CommandOrControl+num0'],
  );
  assert.ok(accelerators.includes('CommandOrControl+Plus'));
  assert.ok(accelerators.includes('CommandOrControl+='));
  assert.ok(accelerators.includes('CommandOrControl+-'));
  assert.ok(items.every((item) => item.acceleratorWorksWhenHidden === true));
  assert.equal(items.filter((item) => item.visible).length, 3);

  items.forEach((item) => item.click());
  assert.deepEqual(directions, ['reset', 'reset', 'in', 'in', 'in', 'out', 'out']);

  const roles = template.flatMap((entry) => (entry.role ? [entry.role] : []));
  assert.deepEqual(roles, ['appMenu', 'editMenu', 'windowMenu']);
});

test('Electron applies bounded page zoom instead of forcing 100 percent', () => {
  assert.match(mainSource, /nextDesktopZoomFactor\(direction, currentFactor\)/);
  assert.match(mainSource, /mainWindow\.webContents\.getZoomFactor\(\)/);
  assert.match(mainSource, /mainWindow\.webContents\.setZoomFactor\(nextFactor\)/);
  assert.match(mainSource, /event\.preventDefault\(\)/);
  assert.doesNotMatch(mainSource, /setVisualZoomLevelLimits\(1, 1\)/);
  assert.doesNotMatch(mainSource, /setZoomFactor\(1\);/);
});

test('the zoom key handler is attached on every platform before the window loads its page', () => {
  const handlerIndex = mainSource.indexOf("on('before-input-event'");
  const loadIndex = mainSource.indexOf('await mainWindow.loadURL(');
  const menuBranchIndex = mainSource.indexOf('if (desktopMenuRequired())');
  const branchEndIndex = mainSource.indexOf('mainWindow.removeMenu();');
  assert.ok(handlerIndex > 0 && loadIndex > 0 && menuBranchIndex > 0);
  assert.ok(handlerIndex < loadIndex);
  /*
   * The handler must sit after the platform branch closes. Stranding it inside the branch would
   * leave whichever platform owns a menu with no zoom shortcuts at all if the accelerators are
   * swallowed.
   */
  assert.ok(handlerIndex > branchEndIndex);
  assert.match(mainSource, /Menu\.setApplicationMenu\(Menu\.buildFromTemplate\(desktopMenuTemplate/);
});

test('one keystroke applies at most one zoom step even when both owners fire', () => {
  assert.match(mainSource, /now - lastDesktopZoomAt < DESKTOP_ZOOM_REPEAT_MS/);
  assert.match(mainSource, /const DESKTOP_ZOOM_REPEAT_MS = \d+;/);
  assert.match(mainSource, /lastDesktopZoomAt = now;/);
});

test('rightmost display cog exposes bounded desktop zoom buttons', () => {
  assert.match(markup, /id="display-settings"[\s\S]*?id="desktop-zoom-out"[\s\S]*?id="desktop-zoom-level"[\s\S]*?id="desktop-zoom-in"/);
  assert.match(markup, /id="desktop-zoom-level" aria-label="Current zoom level">100%<\/output>/);
  assert.match(appSource, /elements\.desktopZoomControls\.hidden = !supported/);
  assert.match(appSource, /const label = supported && Number\.isFinite\(percent\) \? `\$\{percent\}%` : '--'/);
  assert.match(appSource, /api\('\/api\/desktop\/zoom',[\s\S]*?JSON\.stringify\(\{ direction \}\)/);
  assert.match(appSource, /state\.status\.desktopZoom = zoom/);
  assert.match(appSource, /changeDesktopZoom\('out', elements\.desktopZoomOut\)/);
  assert.match(appSource, /changeDesktopZoom\('in', elements\.desktopZoomIn\)/);
});

test('desktop server routes cog zoom actions into the native whole-page stepper', () => {
  assert.match(mainSource, /relay\.setDesktopZoomHandler\(\(direction\) => applyDesktopZoom\(direction, \{ deduplicate: false \}\)\)/);
  assert.match(mainSource, /publishDesktopZoomState\(mainWindow\.webContents\.getZoomFactor\(\)\)/);
  assert.match(mainSource, /publishDesktopZoomState\?\.\(nextFactor\)/);
  assert.match(serverSource, /desktopZoomControls: IS_DESKTOP && typeof desktopZoomHandler === 'function'/);
  assert.match(serverSource, /desktopZoom: desktopZoomState/);
  assert.match(serverSource, /broadcast\(\{ desktopZoom: true \}\)/);
  assert.match(serverSource, /pathname === '\/api\/desktop\/zoom'/);
  assert.match(serverSource, /body\.direction !== 'in' && body\.direction !== 'out'/);
  assert.match(serverSource, /await desktopZoomHandler\(body\.direction\)/);
  assert.match(serverSource, /setDesktopZoomState\(factor\)/);
});
