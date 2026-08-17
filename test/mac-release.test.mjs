import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertMacCodeSignature,
  assertMacReleaseHost,
  MAC_RELEASE_DESIGNATED_REQUIREMENT,
  MAC_RELEASE_SIGNING_IDENTITY,
} from '../scripts/mac-release.mjs';

test('macOS release preflight requires the continuity identity on an arm64 Mac', () => {
  assert.equal(assertMacReleaseHost({
    platform: 'darwin',
    architecture: 'arm64',
    identityOutput: `1) ABCDEF "${MAC_RELEASE_SIGNING_IDENTITY}"`,
  }), true);
  assert.throws(
    () => assertMacReleaseHost({
      platform: 'linux',
      architecture: 'arm64',
      identityOutput: `1) ABCDEF "${MAC_RELEASE_SIGNING_IDENTITY}"`,
    }),
    /must run on macOS/,
  );
  assert.throws(
    () => assertMacReleaseHost({
      platform: 'darwin',
      architecture: 'x64',
      identityOutput: `1) ABCDEF "${MAC_RELEASE_SIGNING_IDENTITY}"`,
    }),
    /require arm64/,
  );
  assert.throws(
    () => assertMacReleaseHost({
      platform: 'darwin',
      architecture: 'arm64',
      identityOutput: '0 valid identities found',
    }),
    /signing identity is unavailable/,
  );
});

test('macOS release verification pins the bundle, team, identity, and designated requirement', () => {
  const details = [
    'Identifier=com.relay.queue',
    `Authority=${MAC_RELEASE_SIGNING_IDENTITY}`,
    'TeamIdentifier=7TNPY5FX2F',
  ].join('\n');
  assert.equal(assertMacCodeSignature({
    details,
    requirement: `designated => ${MAC_RELEASE_DESIGNATED_REQUIREMENT}\nExecutable=/Applications/CC Relay.app/Contents/MacOS/CC Relay`,
  }), true);
  assert.throws(
    () => assertMacCodeSignature({
      details: details.replace('TeamIdentifier=7TNPY5FX2F', 'TeamIdentifier=DIFFERENT'),
      requirement: `designated => ${MAC_RELEASE_DESIGNATED_REQUIREMENT}`,
    }),
    /TeamIdentifier/,
  );
  assert.throws(
    () => assertMacCodeSignature({
      details,
      requirement: 'designated => identifier "com.relay.queue"',
    }),
    /designated requirement changed/,
  );
  assert.throws(
    () => assertMacCodeSignature({
      details: `${details}\nSignature=adhoc`,
      requirement: `designated => ${MAC_RELEASE_DESIGNATED_REQUIREMENT}`,
    }),
    /ad hoc/,
  );
});
