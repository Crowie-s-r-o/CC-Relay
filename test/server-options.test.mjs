import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import test from 'node:test';
import {
  DEFAULT_RELAY_CODEX_PORT,
  DEFAULT_RELAY_PORT,
  defaultRelayConfigDirectory,
  relayCodexPortFromArgs,
  relayConfigDirectoryFromArgs,
  relayPortFromArgs,
  relayServerEndpoint,
} from '../src/server-options.mjs';

test('server port defaults to the stable browser port', () => {
  assert.equal(relayPortFromArgs(['node', 'src/server.mjs']), DEFAULT_RELAY_PORT);
  assert.equal(relayCodexPortFromArgs(['node', 'src/server.mjs']), DEFAULT_RELAY_CODEX_PORT);
});

test('server port accepts an operating-system-assigned port and the final option wins', () => {
  assert.equal(relayPortFromArgs([
    'node',
    'src/server.mjs',
    '--relay-port',
    '4768',
    '--relay-port',
    '0',
  ]), 0);
  assert.equal(relayCodexPortFromArgs([
    'node',
    'src/server.mjs',
    '--relay-codex-port',
    '0',
  ]), 0);
});

test('server port rejects malformed or out-of-range values', () => {
  for (const value of ['', '-1', '1.5', '65536', 'not-a-port']) {
    assert.throws(
      () => relayPortFromArgs(['node', 'src/server.mjs', '--relay-port', value]),
      /integer from 0 through 65535/,
    );
    assert.throws(
      () => relayCodexPortFromArgs(['node', 'src/server.mjs', '--relay-codex-port', value]),
      /integer from 0 through 65535/,
    );
  }
});

test('shared project configuration uses the Electron-compatible per-user directory', () => {
  assert.equal(
    defaultRelayConfigDirectory({
      platform: 'darwin',
      homeDirectory: '/Users/person',
    }),
    '/Users/person/Library/Application Support/dual-agent-orchestrator',
  );
  assert.equal(
    defaultRelayConfigDirectory({
      platform: 'linux',
      homeDirectory: '/home/person',
    }),
    '/home/person/.config/dual-agent-orchestrator',
  );
});

test('shared project configuration accepts an explicit desktop directory', () => {
  assert.equal(
    relayConfigDirectoryFromArgs([
      'node',
      'src/server.mjs',
      '--relay-config-dir',
      '/tmp/relay-user-data',
    ]),
    '/tmp/relay-user-data',
  );
  assert.throws(
    () => relayConfigDirectoryFromArgs([
      'node',
      'src/server.mjs',
      '--relay-config-dir',
      '',
    ]),
    /requires a directory path/,
  );
});

test('server endpoint reports the actual port selected by the operating system', async (t) => {
  const server = createServer();
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const endpoint = relayServerEndpoint(server);
  assert.ok(endpoint.port > 0);
  assert.equal(endpoint.host, '127.0.0.1');
  assert.equal(endpoint.url, `http://127.0.0.1:${endpoint.port}`);
});
