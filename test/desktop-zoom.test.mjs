import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  DESKTOP_ZOOM_FACTORS,
  desktopZoomFactorForInput,
} from '../src/desktop-zoom.mjs';

const mainSource = readFileSync(new URL('../src/electron-main.mjs', import.meta.url), 'utf8');

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
});

test('Electron applies bounded page zoom instead of forcing 100 percent', () => {
  assert.match(mainSource, /desktopZoomFactorForInput\(input, currentFactor\)/);
  assert.match(mainSource, /mainWindow\.webContents\.getZoomFactor\(\)/);
  assert.match(mainSource, /mainWindow\.webContents\.setZoomFactor\(nextFactor\)/);
  assert.match(mainSource, /event\.preventDefault\(\)/);
  assert.doesNotMatch(mainSource, /setVisualZoomLevelLimits\(1, 1\)/);
  assert.doesNotMatch(mainSource, /setZoomFactor\(1\);/);
});
