import assert from 'node:assert/strict';
import test from 'node:test';
import {
  desktopRendererUrl,
  desktopTitlebarOptions,
  MACOS_TITLEBAR_MODE,
} from '../src/desktop-titlebar.mjs';

test('macOS pairs hiddenInset chrome with a versioned renderer marker', () => {
  assert.deepEqual(desktopTitlebarOptions('darwin'), { titleBarStyle: 'hiddenInset' });

  const rendererUrl = new URL(desktopRendererUrl('http://127.0.0.1:51234/', 'darwin'));
  assert.equal(rendererUrl.searchParams.get('desktopTitlebar'), MACOS_TITLEBAR_MODE);
  assert.equal(MACOS_TITLEBAR_MODE, 'hidden-inset-v1');
});

test('other desktop platforms retain native chrome without a renderer marker', () => {
  for (const platform of ['win32', 'linux']) {
    assert.deepEqual(desktopTitlebarOptions(platform), {});
    assert.equal(
      desktopRendererUrl('http://127.0.0.1:51234/?existing=value', platform),
      'http://127.0.0.1:51234/?existing=value',
    );
  }
});

test('the renderer marker preserves endpoint parameters and fragments', () => {
  const rendererUrl = new URL(
    desktopRendererUrl('http://127.0.0.1:51234/?existing=value#workspace', 'darwin'),
  );

  assert.equal(rendererUrl.searchParams.get('existing'), 'value');
  assert.equal(rendererUrl.searchParams.get('desktopTitlebar'), MACOS_TITLEBAR_MODE);
  assert.equal(rendererUrl.hash, '#workspace');
});
