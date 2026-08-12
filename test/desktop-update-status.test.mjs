import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DESKTOP_RELEASES_URL,
  normalizeDesktopUpdateState,
} from '../src/desktop-update-status.mjs';

test('normalizes trusted desktop update state for the status API', () => {
  assert.deepEqual(normalizeDesktopUpdateState({
    supported: true,
    automaticUpdate: true,
    status: 'downloading',
    currentVersion: 'v1.0.0',
    latestVersion: '1.2.0',
    releaseUrl: `${DESKTOP_RELEASES_URL}/tag/v1.2.0`,
    downloadPercent: 47.25,
  }), {
    supported: true,
    automaticUpdate: true,
    status: 'downloading',
    currentVersion: '1.0.0',
    latestVersion: '1.2.0',
    releaseUrl: `${DESKTOP_RELEASES_URL}/tag/v1.2.0`,
    downloadPercent: 47.25,
  });
});

test('keeps absent progress null and bounds numeric progress', () => {
  assert.equal(normalizeDesktopUpdateState({ downloadPercent: null }).downloadPercent, null);
  assert.equal(normalizeDesktopUpdateState({ downloadPercent: '' }).downloadPercent, null);
  assert.equal(normalizeDesktopUpdateState({ downloadPercent: -8 }).downloadPercent, 0);
  assert.equal(normalizeDesktopUpdateState({ downloadPercent: '108' }).downloadPercent, 100);
});

test('rejects malformed versions, states, and external release URLs', () => {
  const state = normalizeDesktopUpdateState({
    supported: 'yes',
    status: 'ready',
    currentVersion: '1.2',
    latestVersion: '01.2.3',
    releaseUrl: 'https://example.com/releases/tag/v9.9.9',
    downloadPercent: 'many',
  });
  assert.deepEqual(state, {
    supported: false,
    automaticUpdate: false,
    status: 'error',
    currentVersion: null,
    latestVersion: null,
    releaseUrl: `${DESKTOP_RELEASES_URL}/latest`,
    downloadPercent: null,
  });
  assert.deepEqual(normalizeDesktopUpdateState(null), state);
});
