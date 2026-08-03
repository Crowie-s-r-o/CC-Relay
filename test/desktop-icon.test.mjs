import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));

test('Crowie native app icon is a 1024 square PNG with transparency', () => {
  const icon = readFileSync(join(projectRoot, 'build', 'icon.png'));

  assert.deepEqual([...icon.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(icon.readUInt32BE(16), 1024);
  assert.equal(icon.readUInt32BE(20), 1024);
  assert.equal(icon[25], 6);

  const imageData = [];
  for (let offset = 8; offset < icon.length;) {
    const length = icon.readUInt32BE(offset);
    const type = icon.toString('ascii', offset + 4, offset + 8);
    if (type === 'IDAT') imageData.push(icon.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  assert.equal(inflateSync(Buffer.concat(imageData))[4], 0);
});

test('Electron development and packaged builds use the native Crowie icon', () => {
  const main = readFileSync(join(projectRoot, 'src', 'electron-main.mjs'), 'utf8');
  const builder = readFileSync(join(projectRoot, 'electron-builder.yml'), 'utf8');

  assert.match(main, /nativeImage\.createFromPath\(APP_ICON_PATH\)/);
  assert.match(main, /app\.dock\.setIcon\(icon\)/);
  assert.match(main, /\.\.\.\(appIcon \? \{ icon: appIcon \} : \{\}\)/);
  assert.equal(builder.match(/^ {2}icon: icon\.png$/gm)?.length, 2);
});

test('macOS DMG uses a branded Finder background without visible helper artwork', () => {
  const builder = readFileSync(join(projectRoot, 'electron-builder.yml'), 'utf8');

  assert.match(builder, /^dmg:\n {2}backgroundColor: "#e8eaef"$/m);
  assert.match(builder, /^ {2}icon: null$/m);
  assert.doesNotMatch(builder, /^ {2}background: /m);
  assert.match(builder, /^ {2}title: CC Relay$/m);
  assert.match(builder, /^ {4}width: 640$/m);
  assert.match(builder, /^ {4}height: 380$/m);
});

test('the in-app header uses the Crowie icon instead of a text monogram', () => {
  const markup = readFileSync(join(projectRoot, 'public', 'index.html'), 'utf8');
  const brandMark = markup.match(/<img\b[^>]*class="brand-mark"[^>]*>/)?.[0];

  assert.ok(brandMark);
  assert.match(brandMark, /src="\/favicon\.svg"/);
  assert.match(brandMark, /alt=""/);
  assert.doesNotMatch(markup, /class="brand-mark"[^>]*>R/);
});
