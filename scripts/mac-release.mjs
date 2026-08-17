import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import {
  MAC_RELEASE_ARCH,
  MAC_RELEASE_MANIFEST_NAME,
  macReleaseArtifactNames,
  parseVersion,
} from './release-core.mjs';

export const MAC_RELEASE_BUNDLE_ID = 'com.relay.queue';
export const MAC_RELEASE_TEAM_ID = '7TNPY5FX2F';
export const MAC_RELEASE_SIGNING_IDENTITY = 'Apple Development: Patrik Kelemen (SSUH7T22L8)';
export const MAC_RELEASE_DESIGNATED_REQUIREMENT = `identifier "${MAC_RELEASE_BUNDLE_ID}" and anchor apple generic and certificate leaf[subject.CN] = "${MAC_RELEASE_SIGNING_IDENTITY}" and certificate 1[field.1.2.840.113635.100.6.2.1] /* exists */`;

function commandResult(command, args, { cwd } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const output = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
    const detail = output.split(/\r?\n/).filter(Boolean).at(-1);
    throw new Error(detail || `${command} exited with status ${result.status}.`);
  }
  return `${result.stdout || ''}\n${result.stderr || ''}`.trim();
}

function quotedIdentity(identity) {
  return `"${identity}"`;
}

function normalizedRequirement(value) {
  const source = String(value || '');
  const designated = source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => /^designated\s*=>/.test(line));
  return String(designated || source)
    .replace(/^designated\s*=>\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapedPattern(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function fileSha512(path) {
  return createHash('sha512').update(readFileSync(path)).digest('base64');
}

function requiredFile(path, label) {
  if (!existsSync(path)) throw new Error(`Signed macOS release is missing ${label}: ${path}`);
  const size = statSync(path).size;
  if (size <= 0) throw new Error(`Signed macOS release has an empty ${label}: ${path}`);
  return size;
}

export function assertMacReleaseHost({
  platform = process.platform,
  architecture = process.arch,
  identityOutput,
} = {}) {
  if (platform !== 'darwin') {
    throw new Error('CC Relay releases must run on macOS so the public Mac artifacts can be signed locally.');
  }
  if (architecture !== MAC_RELEASE_ARCH) {
    throw new Error(`CC Relay macOS releases require ${MAC_RELEASE_ARCH}, found ${architecture}.`);
  }
  const output = identityOutput ?? commandResult('/usr/bin/security', [
    'find-identity',
    '-v',
    '-p',
    'codesigning',
  ]);
  if (!String(output).includes(quotedIdentity(MAC_RELEASE_SIGNING_IDENTITY))) {
    throw new Error(`The required macOS signing identity is unavailable: ${MAC_RELEASE_SIGNING_IDENTITY}`);
  }
  return true;
}

export function assertMacCodeSignature({ details = '', requirement = '' } = {}) {
  const source = String(details || '');
  const expectedFields = [
    `Identifier=${MAC_RELEASE_BUNDLE_ID}`,
    `Authority=${MAC_RELEASE_SIGNING_IDENTITY}`,
    `TeamIdentifier=${MAC_RELEASE_TEAM_ID}`,
  ];
  for (const field of expectedFields) {
    if (!source.includes(field)) {
      throw new Error(`macOS release signature does not contain ${field}.`);
    }
  }
  if (/Signature=adhoc/i.test(source)) {
    throw new Error('macOS release signature is ad hoc and cannot continue the public update lineage.');
  }
  const actualRequirement = normalizedRequirement(requirement);
  if (actualRequirement !== normalizedRequirement(MAC_RELEASE_DESIGNATED_REQUIREMENT)) {
    throw new Error(`macOS designated requirement changed unexpectedly: ${actualRequirement || 'missing'}`);
  }
  return true;
}

function verifySignedAppBundle(appPath) {
  commandResult('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath]);
  const signatureDetails = commandResult('/usr/bin/codesign', ['-dv', '--verbose=4', appPath]);
  const designatedRequirement = commandResult('/usr/bin/codesign', ['-dr', '-', appPath]);
  assertMacCodeSignature({ details: signatureDetails, requirement: designatedRequirement });
}

export function verifyMacReleaseArtifacts({ projectRoot, version }) {
  parseVersion(version);
  const root = resolve(projectRoot);
  const dist = join(root, 'dist');
  const appPath = join(dist, `mac-${MAC_RELEASE_ARCH}`, 'CC Relay.app');
  requiredFile(join(appPath, 'Contents', 'Info.plist'), 'application Info.plist');

  verifySignedAppBundle(appPath);

  const bundleVersion = commandResult('/usr/libexec/PlistBuddy', [
    '-c',
    'Print :CFBundleShortVersionString',
    join(appPath, 'Contents', 'Info.plist'),
  ]).trim();
  if (bundleVersion !== version) {
    throw new Error(`Signed macOS bundle version ${bundleVersion || 'unknown'} does not match ${version}.`);
  }

  const artifactNames = macReleaseArtifactNames(version, { includeManifest: false });
  const artifactPaths = artifactNames.map((name) => join(dist, name));
  const artifactSizes = new Map();
  for (let index = 0; index < artifactPaths.length; index += 1) {
    artifactSizes.set(artifactNames[index], requiredFile(artifactPaths[index], artifactNames[index]));
  }

  const zipName = artifactNames.find((name) => name.endsWith('.zip'));
  const zipPath = join(dist, zipName);
  const archiveEntries = commandResult('/usr/bin/unzip', ['-Z1', zipPath]);
  if (!archiveEntries.split(/\r?\n/).includes('CC Relay.app/Contents/_CodeSignature/CodeResources')) {
    throw new Error(`Signed macOS updater archive ${zipName} has no CodeResources signature.`);
  }
  const extractedRoot = mkdtempSync(join(tmpdir(), 'cc-relay-mac-zip-'));
  try {
    commandResult('/usr/bin/unzip', ['-q', zipPath, '-d', extractedRoot]);
    verifySignedAppBundle(join(extractedRoot, 'CC Relay.app'));
  } finally {
    rmSync(extractedRoot, { recursive: true, force: true });
  }

  const dmgName = artifactNames.find((name) => name.endsWith('.dmg'));
  commandResult('/usr/bin/hdiutil', ['verify', join(dist, dmgName)]);

  const metadataPath = join(dist, 'latest-mac.yml');
  const metadata = readFileSync(metadataPath, 'utf8');
  if (!new RegExp(`^version:\\s*${escapedPattern(version)}\\s*$`, 'm').test(metadata)) {
    throw new Error(`latest-mac.yml does not declare version ${version}.`);
  }
  if (!new RegExp(`^\\s*- url:\\s*${escapedPattern(zipName)}\\s*$`, 'm').test(metadata)) {
    throw new Error(`latest-mac.yml does not select ${zipName}.`);
  }
  if (!new RegExp(`^path:\\s*${escapedPattern(zipName)}\\s*$`, 'm').test(metadata)) {
    throw new Error(`latest-mac.yml does not use ${zipName} as its updater path.`);
  }
  const zipMetadata = metadata.match(new RegExp(
    `^\\s*- url:\\s*${escapedPattern(zipName)}\\s*\\n\\s+sha512:\\s*([A-Za-z0-9+/=]+)\\s*$`,
    'm',
  ));
  const zipSha512 = fileSha512(zipPath);
  if (!zipMetadata || zipMetadata[1] !== zipSha512) {
    throw new Error(`latest-mac.yml has the wrong SHA-512 digest for ${zipName}.`);
  }

  const manifest = {
    schemaVersion: 1,
    version,
    architecture: MAC_RELEASE_ARCH,
    bundleIdentifier: MAC_RELEASE_BUNDLE_ID,
    teamIdentifier: MAC_RELEASE_TEAM_ID,
    signingIdentity: MAC_RELEASE_SIGNING_IDENTITY,
    designatedRequirement: normalizedRequirement(MAC_RELEASE_DESIGNATED_REQUIREMENT),
    artifacts: artifactPaths.map((path) => ({
      name: basename(path),
      size: artifactSizes.get(basename(path)),
      sha512: fileSha512(path),
    })),
  };
  const manifestPath = join(dist, MAC_RELEASE_MANIFEST_NAME);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  requiredFile(manifestPath, MAC_RELEASE_MANIFEST_NAME);

  const paths = [...artifactPaths, manifestPath];
  return {
    appPath,
    manifest,
    paths,
    sizes: Object.fromEntries(paths.map((path) => [basename(path), statSync(path).size])),
  };
}

export function buildSignedMacRelease({ projectRoot, version, runBuild }) {
  assertMacReleaseHost();
  if (typeof runBuild !== 'function') {
    throw new TypeError('buildSignedMacRelease requires a runBuild callback.');
  }
  runBuild();
  return verifyMacReleaseArtifacts({ projectRoot, version });
}
