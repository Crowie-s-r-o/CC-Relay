import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));

test('Electron uses CC Relay as its product name without moving existing desktop data', () => {
  const packageMetadata = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'));
  const builder = readFileSync(join(projectRoot, 'electron-builder.yml'), 'utf8');
  const main = readFileSync(join(projectRoot, 'src', 'electron-main.mjs'), 'utf8');
  const markup = readFileSync(join(projectRoot, 'public', 'index.html'), 'utf8');

  assert.equal(packageMetadata.name, 'cc-relay');
  assert.equal(packageMetadata.productName, 'CC Relay');
  assert.match(builder, /^productName: CC Relay$/m);
  assert.match(builder, /^ {2}title: CC Relay$/m);
  assert.match(builder, /^artifactName: CC-Relay-\$\{version\}-\$\{os\}-\$\{arch\}\.\$\{ext\}$/m);
  assert.match(main, /const PRODUCT_NAME = 'CC Relay';/);
  assert.match(main, /app\.setName\(PRODUCT_NAME\);/);
  assert.match(main, /title: PRODUCT_NAME,/);
  assert.match(markup, /<title>CC Relay<\/title>/);
  assert.match(markup, /<h1>CC Relay<\/h1>/);
  assert.match(
    main,
    /const DESKTOP_DATA_ROOT = join\(app\.getPath\('appData'\), RELAY_APPLICATION_DIRECTORY\);/,
  );
  assert.match(main, /mkdirSync\(DESKTOP_DATA_ROOT, \{ recursive: true \}\);/);
  assert.match(main, /app\.setPath\('userData', DESKTOP_DATA_ROOT\);/);
});

test('Electron binds its embedded CC Relay server to an available port', () => {
  const main = readFileSync(join(projectRoot, 'src', 'electron-main.mjs'), 'utf8');

  assert.match(main, /const DESKTOP_RELAY_PORT = 0;/);
  assert.match(main, /const DESKTOP_CODEX_PORT = 0;/);
  assert.match(main, /'--relay-port',\s+String\(DESKTOP_RELAY_PORT\)/);
  assert.match(main, /'--relay-codex-port',\s+String\(DESKTOP_CODEX_PORT\)/);
  assert.match(main, /'--relay-config-dir',\s+dataRoot/);
  assert.match(main, /const endpoint = await relay\.serverReady;/);
  assert.match(main, /mainWindow\.loadURL\(endpoint\.url\)/);
  assert.doesNotMatch(main, /http:\/\/127\.0\.0\.1:4768/);
});

test('Electron persists startup, server, window, renderer, and shutdown diagnostics', () => {
  const main = readFileSync(join(projectRoot, 'src', 'electron-main.mjs'), 'utf8');

  for (const event of [
    'desktop.start.requested',
    'desktop.server.start.requested',
    'desktop.server.ready',
    'desktop.window.created',
    'desktop.window.load.completed',
    'desktop.renderer.gone',
    'desktop.start.failed',
    'desktop.shutdown.completed',
  ]) {
    assert.match(main, new RegExp(`['"]${event.replaceAll('.', '\\.')}['"]`));
  }
  assert.match(main, /new DiagnosticLog\(join\(dataRoot, 'relay-diagnostics\.jsonl'\)\)/);
});
