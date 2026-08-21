import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DESKTOP_RELEASES_URL,
  desktopUpdatePresentation,
} from '../public/desktop-update-state.js';

test('hides desktop update status until a trusted newer version is known', () => {
  for (const update of [
    undefined,
    { supported: false, status: 'available', latestVersion: '1.2.0' },
    { supported: true, status: 'checking', latestVersion: '1.2.0' },
    { supported: true, status: 'available', latestVersion: 'not-a-version' },
  ]) {
    const result = desktopUpdatePresentation(update);
    assert.equal(result.hidden, true);
    assert.equal(result.href, `${DESKTOP_RELEASES_URL}/latest`);
  }
});

test('shows an available release with its trusted GitHub URL', () => {
  const result = desktopUpdatePresentation({
    supported: true,
    automaticUpdate: true,
    status: 'available',
    latestVersion: '1.2.0',
    releaseUrl: `${DESKTOP_RELEASES_URL}/tag/v1.2.0`,
    releaseNotes: [
      { section: 'Added', text: 'Release summaries now appear in the app.' },
      { section: 'Fixed', text: 'Duplicate prompts no longer appear.' },
    ],
  });
  assert.equal(result.hidden, false);
  assert.equal(result.state, 'available');
  assert.equal(result.label, 'Update v1.2.0');
  assert.equal(result.href, `${DESKTOP_RELEASES_URL}/tag/v1.2.0`);
  assert.equal(result.modalTitle, 'A new Relay is ready');
  assert.equal(result.statusLabel, 'Update available');
  assert.equal(result.releaseLabel, 'View full release notes');
  assert.deepEqual(result.releaseNotes, [
    { section: 'Added', text: 'Release summaries now appear in the app.' },
    { section: 'Fixed', text: 'Duplicate prompts no longer appear.' },
  ]);
  assert.equal(result.automaticUpdate, true);
  assert.equal(result.progress, null);
  assert.match(result.modalMessage, /download automatically/i);
});

test('presents manual release discovery as an official release download', () => {
  const result = desktopUpdatePresentation({
    supported: true,
    automaticUpdate: false,
    status: 'available',
    currentVersion: '1.0.0',
    latestVersion: '1.2.0',
    releaseUrl: `${DESKTOP_RELEASES_URL}/tag/v1.2.0`,
  });
  assert.equal(result.hidden, false);
  assert.equal(result.label, 'Update v1.2.0');
  assert.equal(result.releaseLabel, 'Download v1.2.0');
  assert.equal(result.automaticUpdate, false);
  assert.match(result.modalMessage, /download and install it manually/i);
  assert.doesNotMatch(result.modalMessage, /desktop prompt/i);
});

test('formats download progress and ready state compactly', () => {
  const downloading = desktopUpdatePresentation({
    supported: true,
    status: 'downloading',
    latestVersion: '1.2.0',
    downloadPercent: 140,
  });
  assert.equal(downloading.label, 'Downloading v1.2.0 100%');
  assert.equal(downloading.progress, 100);
  assert.match(downloading.modalMessage, /keep working/i);

  const indeterminate = desktopUpdatePresentation({
    supported: true,
    status: 'downloading',
    latestVersion: '1.2.0',
    downloadPercent: null,
  });
  assert.equal(indeterminate.label, 'Downloading v1.2.0');
  assert.equal(indeterminate.progress, null);

  const downloaded = desktopUpdatePresentation({
    supported: true,
    status: 'downloaded',
    currentVersion: '1.0.0',
    latestVersion: '1.2.0',
  });
  assert.equal(downloaded.label, 'v1.2.0 ready');
  assert.equal(downloaded.state, 'downloaded');
  assert.equal(downloaded.currentVersion, '1.0.0');
  assert.equal(downloaded.latestVersion, '1.2.0');
  assert.equal(downloaded.progress, 100);
  assert.match(downloaded.modalMessage, /install automatically/i);
});

test('presents automatic updater failures as background retries with informational links', () => {
  const result = desktopUpdatePresentation({
    supported: true,
    automaticUpdate: true,
    status: 'error',
    latestVersion: '1.2.0',
    releaseUrl: 'https://example.com/fake-installer',
  });
  assert.equal(result.hidden, false);
  assert.equal(result.label, 'Retrying v1.2.0');
  assert.equal(result.href, `${DESKTOP_RELEASES_URL}/latest`);
  assert.equal(result.statusLabel, 'Automatic retry scheduled');
  assert.equal(result.modalTitle, 'Relay will try again');
  assert.equal(result.releaseLabel, 'View full release notes');
  assert.match(result.title, /retry in the background/i);
  assert.match(result.modalMessage, /retry automatically in the background/i);
  assert.doesNotMatch(result.modalMessage, /manually|needs a hand/i);
});
