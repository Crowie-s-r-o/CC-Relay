#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { changelogEntryForVersion } from './release-core.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

try {
  const requested = String(process.argv[2] || '').replace(/^v/, '');
  if (!requested) throw new Error('Usage: npm run release:notes -- <version>');
  const changelog = readFileSync(resolve(projectRoot, 'CHANGELOG.md'), 'utf8');
  process.stdout.write(`${changelogEntryForVersion(changelog, requested).body}\n`);
} catch (error) {
  console.error(`Could not read release notes: ${error.message}`);
  process.exitCode = 1;
}
