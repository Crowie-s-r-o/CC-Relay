#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { changelogEntryForVersion, parseVersion } from './release-core.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function readJson(path) {
  return JSON.parse(readFileSync(resolve(projectRoot, path), 'utf8'));
}

function optionValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}

try {
  const manifest = readJson('package.json');
  const lockfile = readJson('package-lock.json');
  const changelog = readFileSync(resolve(projectRoot, 'CHANGELOG.md'), 'utf8');
  const builder = readFileSync(resolve(projectRoot, 'electron-builder.yml'), 'utf8');
  const version = String(manifest.version || '');
  parseVersion(version);

  if (manifest.license !== 'MIT') throw new Error('package.json must declare the MIT license.');
  if (lockfile.version !== version) throw new Error('package-lock.json version does not match package.json.');
  if (lockfile.packages?.['']?.version !== version) {
    throw new Error('package-lock.json root package version does not match package.json.');
  }
  if (lockfile.packages?.['']?.license !== manifest.license) {
    throw new Error('package-lock.json root license does not match package.json.');
  }
  changelogEntryForVersion(changelog, version);

  if (!/^\s*owner:\s*Crowie-s-r-o\s*$/m.test(builder)) {
    throw new Error('electron-builder.yml has the wrong GitHub owner.');
  }
  if (!/^\s*repo:\s*CC-Relay\s*$/m.test(builder)) {
    throw new Error('electron-builder.yml has the wrong GitHub repository.');
  }

  const tag = optionValue('--tag');
  if (tag && tag !== `v${version}`) {
    throw new Error(`Git tag ${tag} does not match package version ${version}.`);
  }
  console.log(`Release metadata is consistent for v${version}.`);
} catch (error) {
  console.error(`Release metadata check failed: ${error.message}`);
  process.exitCode = 1;
}
