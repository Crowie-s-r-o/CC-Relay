import assert from 'node:assert/strict';
import test from 'node:test';
import {
  availableProviderSelection,
  providerInstallationState,
  providerIsInstalled,
} from '../public/provider-availability.js';

test('provider installation stays neutral while the background probe is pending', () => {
  const status = { codex: { pending: true, available: false } };
  assert.equal(providerInstallationState(status, 'codex'), 'checking');
  assert.equal(providerIsInstalled(status, 'codex'), false);
  assert.equal(availableProviderSelection(status, 'codex'), 'codex');
});

test('installed but signed-out providers remain installed', () => {
  const status = {
    codex: { pending: false, available: true, authenticated: false },
  };
  assert.equal(providerInstallationState(status, 'codex'), 'installed');
  assert.equal(providerIsInstalled(status, 'codex'), true);
});

test('selection moves from a confirmed missing provider to an installed provider', () => {
  const status = {
    codex: { pending: false, available: false, reason: 'not_installed' },
    claude: { pending: false, available: true, authenticated: true },
  };
  assert.equal(availableProviderSelection(status, 'codex'), 'claude');
});

test('selection can move to OpenCode when Codex and Claude are missing', () => {
  const status = {
    codex: { pending: false, available: false, reason: 'not_installed' },
    claude: { pending: false, available: false, reason: 'not_installed' },
    opencode: { pending: false, available: true, authenticated: true },
  };
  assert.equal(availableProviderSelection(status, 'codex'), 'opencode');
});

test('selection remains stable when every provider is missing', () => {
  const status = {
    codex: { pending: false, available: false, reason: 'not_installed' },
    claude: { pending: false, available: false, reason: 'not_installed' },
    opencode: { pending: false, available: false, reason: 'not_installed' },
  };
  assert.equal(availableProviderSelection(status, 'codex'), 'codex');
});

test('a transient provider probe failure remains neutral and enabled', () => {
  const status = {
    codex: { pending: false, available: false, reason: 'probe_failed' },
  };
  assert.equal(providerInstallationState(status, 'codex'), 'checking');
  assert.equal(availableProviderSelection(status, 'codex'), 'codex');
});
