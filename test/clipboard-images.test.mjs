import assert from 'node:assert/strict';
import test from 'node:test';
import { clipboardImageFiles } from '../public/clipboard-images.js';

test('clipboard image extraction supports file lists and clipboard items without duplicates', () => {
  const png = { name: 'screen.png', type: 'image/png' };
  const jpeg = { name: 'photo.jpg', type: 'image/jpeg' };
  const text = { name: 'notes.txt', type: 'text/plain' };
  const files = clipboardImageFiles({
    files: [png, text],
    items: [
      { kind: 'file', type: 'image/png', getAsFile: () => png },
      { kind: 'file', type: 'image/jpeg', getAsFile: () => jpeg },
      { kind: 'string', type: 'text/plain', getAsFile: () => null },
    ],
  });
  assert.deepEqual(files, [png, jpeg]);
});

test('clipboard image extraction deduplicates different File wrappers for one pasted image', () => {
  const fileListImage = {
    name: 'image.png',
    type: 'image/png',
    size: 387_072,
    lastModified: 1_785_253_200_000,
  };
  const itemImage = { ...fileListImage };

  assert.deepEqual(clipboardImageFiles({
    files: [fileListImage],
    items: [{
      kind: 'file',
      type: 'image/png',
      getAsFile: () => itemImage,
    }],
  }), [fileListImage]);
});

test('clipboard image extraction leaves text-only paste untouched', () => {
  assert.deepEqual(clipboardImageFiles({
    files: [],
    items: [{ kind: 'string', type: 'text/plain' }],
  }), []);
});
