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
    releaseNotes: [
      { section: 'Added', text: 'Release summaries now appear in the app.' },
    ],
    downloadPercent: 47.25,
  }), {
    supported: true,
    automaticUpdate: true,
    status: 'downloading',
    currentVersion: '1.0.0',
    latestVersion: '1.2.0',
    releaseUrl: `${DESKTOP_RELEASES_URL}/tag/v1.2.0`,
    releaseNotes: [
      { section: 'Added', text: 'Release summaries now appear in the app.' },
    ],
    downloadPercent: 47.25,
  });
});

test('keeps absent progress null and bounds numeric progress', () => {
  assert.equal(normalizeDesktopUpdateState({ downloadPercent: null }).downloadPercent, null);
  assert.equal(normalizeDesktopUpdateState({ downloadPercent: '' }).downloadPercent, null);
  assert.equal(normalizeDesktopUpdateState({ downloadPercent: -8 }).downloadPercent, 0);
  assert.equal(normalizeDesktopUpdateState({ downloadPercent: '108' }).downloadPercent, 100);
});

test('keeps release notes plain, categorized, and bounded', () => {
  const state = normalizeDesktopUpdateState({
    releaseNotes: [
      { section: 'Security', text: '<strong>Safer</strong> updater handoff.' },
      { section: 'Unknown', text: 'A general improvement.' },
    ],
  });
  assert.deepEqual(state.releaseNotes, [
    { section: 'Security', text: 'Safer updater handoff.' },
    { section: 'Highlights', text: 'A general improvement.' },
  ]);
});

test('rejects malformed versions, states, and external release URLs', () => {
  const state = normalizeDesktopUpdateState({
    supported: 'yes',
    status: 'ready',
    currentVersion: '1.2',
    latestVersion: '01.2.3',
    releaseUrl: 'https://example.com/releases/tag/v9.9.9',
    releaseNotes: '<script>bad()</script>',
    downloadPercent: 'many',
  });
  assert.deepEqual(state, {
    supported: false,
    automaticUpdate: false,
    status: 'error',
    currentVersion: null,
    latestVersion: null,
    releaseUrl: `${DESKTOP_RELEASES_URL}/latest`,
    releaseNotes: [],
    downloadPercent: null,
  });
  assert.deepEqual(normalizeDesktopUpdateState(null), state);
});
