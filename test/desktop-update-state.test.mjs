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
    status: 'available',
    latestVersion: '1.2.0',
    releaseUrl: `${DESKTOP_RELEASES_URL}/tag/v1.2.0`,
  });
  assert.equal(result.hidden, false);
  assert.equal(result.state, 'available');
  assert.equal(result.label, 'Update v1.2.0');
  assert.equal(result.href, `${DESKTOP_RELEASES_URL}/tag/v1.2.0`);
});

test('formats download progress and ready state compactly', () => {
  const downloading = desktopUpdatePresentation({
    supported: true,
    status: 'downloading',
    latestVersion: '1.2.0',
    downloadPercent: 140,
  });
  assert.equal(downloading.label, 'Downloading v1.2.0 100%');

  const downloaded = desktopUpdatePresentation({
    supported: true,
    status: 'downloaded',
    latestVersion: '1.2.0',
  });
  assert.equal(downloaded.label, 'v1.2.0 ready');
  assert.equal(downloaded.state, 'downloaded');
});

test('falls back to the official latest release for an untrusted URL', () => {
  const result = desktopUpdatePresentation({
    supported: true,
    status: 'error',
    latestVersion: '1.2.0',
    releaseUrl: 'https://example.com/fake-installer',
  });
  assert.equal(result.hidden, false);
  assert.equal(result.label, 'Update v1.2.0');
  assert.equal(result.href, `${DESKTOP_RELEASES_URL}/latest`);
  assert.match(result.title, /automatic download failed/i);
});
