import assert from 'node:assert/strict';
import test from 'node:test';
import { clipboardImageFiles, readClipboardImageFiles } from '../public/clipboard-images.js';

test('clipboard button reads one supported representation per image and preserves bytes', async () => {
  const requested = [];
  const clipboard = { read: async () => [
    { types: ['text/html', 'image/jpeg', 'image/png'], getType: async (type) => {
      requested.push(type);
      return new Blob(['first'], { type });
    } },
    { types: ['image/webp'], getType: async (type) => new Blob(['second'], { type }) },
    { types: ['text/plain'], getType: () => assert.fail('Text is never read') },
  ] };
  const files = await readClipboardImageFiles(clipboard);
  assert.deepEqual(requested, ['image/png']);
  assert.deepEqual(files.map((file) => file.type), ['image/png', 'image/webp']);
  assert.deepEqual(await Promise.all(files.map((file) => file.text())), ['first', 'second']);
  assert.match(files[0].name, /^clipboard-.+\.png$/);
  assert.notEqual((await readClipboardImageFiles(clipboard))[0].name, files[0].name);
});

test('clipboard button explains unavailable access, denied access, and empty or unsupported contents', async () => {
  await assert.rejects(readClipboardImageFiles({}), /unavailable.*Cmd\+V or Ctrl\+V/);
  await assert.rejects(readClipboardImageFiles({ read: async () => { throw new Error('Denied'); } }), /Could not read.*choose an image file/);
  for (const items of [[], [{ types: ['text/plain'] }], [{ types: ['image/gif'] }]]) {
    await assert.rejects(readClipboardImageFiles({ read: async () => items }), /Copy an image or screenshot first/);
  }
  await assert.rejects(readClipboardImageFiles({ read: async () => [{
    types: ['image/png'], getType: async () => { throw new Error('Lost clipboard'); },
  }] }), /Could not read the clipboard image/);
});

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
