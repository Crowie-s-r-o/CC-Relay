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
  const npmConfig = readFileSync(resolve(projectRoot, '.npmrc'), 'utf8');
  const changelog = readFileSync(resolve(projectRoot, 'CHANGELOG.md'), 'utf8');
  const builder = readFileSync(resolve(projectRoot, 'electron-builder.yml'), 'utf8');
  const desktopWorkflow = readFileSync(
    resolve(projectRoot, '.github/workflows/build-desktop.yml'),
    'utf8',
  );
  const deploy = readFileSync(resolve(projectRoot, 'scripts/deploy.mjs'), 'utf8');
  const macRelease = readFileSync(resolve(projectRoot, 'scripts/mac-release.mjs'), 'utf8');
  const releaseCore = readFileSync(resolve(projectRoot, 'scripts/release-core.mjs'), 'utf8');
  const license = readFileSync(resolve(projectRoot, 'LICENSE'), 'utf8');
  const readme = readFileSync(resolve(projectRoot, 'README.md'), 'utf8');
  const thirdPartyNotices = readFileSync(resolve(projectRoot, 'THIRD_PARTY_NOTICES.md'), 'utf8');
  const version = String(manifest.version || '');
  parseVersion(version);

  if (manifest.license !== 'PolyForm-Noncommercial-1.0.0') {
    throw new Error('package.json must declare the PolyForm Noncommercial 1.0.0 license.');
  }
  if (manifest.scripts?.deploy !== 'node scripts/deploy.mjs') {
    throw new Error('package.json must expose the release workflow as npm run deploy.');
  }
  if (lockfile.version !== version) throw new Error('package-lock.json version does not match package.json.');
  if (lockfile.packages?.['']?.version !== version) {
    throw new Error('package-lock.json root package version does not match package.json.');
  }
  if (lockfile.packages?.['']?.license !== manifest.license) {
    throw new Error('package-lock.json root license does not match package.json.');
  }
  if (npmConfig.trim() !== 'legacy-peer-deps=false') {
    throw new Error('.npmrc must keep default peer-dependency resolution enabled.');
  }
  const appBuilder = lockfile.packages?.['node_modules/app-builder-lib'];
  if (!appBuilder) throw new Error('package-lock.json must contain app-builder-lib.');
  for (const peerName of Object.keys(appBuilder.peerDependencies || {})) {
    if (appBuilder.peerDependenciesMeta?.[peerName]?.optional === true) continue;
    if (!lockfile.packages?.[`node_modules/${peerName}`]) {
      throw new Error(`package-lock.json is missing the required app-builder-lib peer ${peerName}.`);
    }
  }
  if (!license.startsWith('# PolyForm Noncommercial License 1.0.0\n')) {
    throw new Error('LICENSE must contain the PolyForm Noncommercial 1.0.0 terms.');
  }
  if (!/^Required Notice: Copyright \(c\) 2026 Patrik Kelemen$/m.test(license)) {
    throw new Error('LICENSE must preserve the required copyright notice.');
  }
  if (!/source-available under the \[PolyForm Noncommercial License 1\.0\.0\]/.test(readme)) {
    throw new Error('README must state the current source-available license.');
  }
  if (/\bopen source\b/i.test(readme)) {
    throw new Error('README must not describe the PolyForm-licensed project as open source.');
  }
  for (const [fontName, licensePath] of [
    ['Instrument Sans', 'public/fonts/licenses/Instrument-Sans-OFL.txt'],
    ['JetBrains Mono', 'public/fonts/licenses/JetBrains-Mono-OFL.txt'],
    ['Source Serif 4', 'public/fonts/licenses/Source-Serif-OFL.txt'],
  ]) {
    const fontLicense = readFileSync(resolve(projectRoot, licensePath), 'utf8');
    if (!thirdPartyNotices.includes(fontName) || !thirdPartyNotices.includes(licensePath)) {
      throw new Error(`THIRD_PARTY_NOTICES.md must list ${fontName} and its bundled license.`);
    }
    if (!/SIL OPEN FONT LICENSE Version 1\.1/.test(fontLicense)) {
      throw new Error(`${licensePath} must contain the SIL Open Font License 1.1 terms.`);
    }
  }
  changelogEntryForVersion(changelog, version);

  if (!/^\s*owner:\s*Crowie-s-r-o\s*$/m.test(builder)) {
    throw new Error('electron-builder.yml has the wrong GitHub owner.');
  }
  if (!/^\s*repo:\s*CC-Relay\s*$/m.test(builder)) {
    throw new Error('electron-builder.yml has the wrong GitHub repository.');
  }
  if (!/^\s*artifactName:\s*CC-Relay-\$\{version\}-\$\{os\}-\$\{arch\}-Setup\.\$\{ext\}\s*$/m.test(builder)) {
    throw new Error('electron-builder.yml must give the Windows installer a unique Setup name.');
  }
  if (!/^portable:\s*\n\s+artifactName:\s*CC-Relay-\$\{version\}-\$\{os\}-\$\{arch\}-Portable\.\$\{ext\}\s*$/m.test(builder)) {
    throw new Error('electron-builder.yml must give the Windows portable build a unique name.');
  }
  const macConfig = builder.match(/^mac:\n([\s\S]*?)^win:/m)?.[1] || '';
  if (!/^ {2}target:\n {4}- dmg\n {4}- zip$/m.test(macConfig)) {
    throw new Error('electron-builder.yml must build both macOS DMG and ZIP targets.');
  }
  for (const hostedMacPattern of ['dist/*.dmg', 'dist/*.zip', 'dist/latest-mac.yml']) {
    if (desktopWorkflow.includes(hostedMacPattern)) {
      throw new Error(`The hosted workflow must not publish unsigned macOS artifacts through ${hostedMacPattern}.`);
    }
  }
  for (const windowsPattern of ['dist/*.exe', 'dist/*.blockmap', 'dist/latest.yml']) {
    if (desktopWorkflow.split(windowsPattern).length !== 3) {
      throw new Error(`The desktop release workflow must upload and publish ${windowsPattern}.`);
    }
  }
  if (!/buildSignedMacRelease\(/.test(deploy) || !/publishSignedMacRelease\(/.test(deploy)) {
    throw new Error('npm run deploy must build, verify, and publish the signed macOS release locally.');
  }
  for (const signingContract of [
    'Apple Development: Patrik Kelemen (SSUH7T22L8)',
    "commandResult('/usr/bin/codesign', ['--verify', '--deep', '--strict'",
    "commandResult('/usr/bin/hdiutil', ['verify'",
  ]) {
    if (!macRelease.includes(signingContract)) {
      throw new Error(`The local macOS release verifier is missing: ${signingContract}`);
    }
  }
  if (!releaseCore.includes("MAC_RELEASE_MANIFEST_NAME = 'mac-release.json'")) {
    throw new Error('The signed macOS release must publish its verification manifest.');
  }
  for (const packagedNotice of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) {
    if (!new RegExp(`^\\s*- ${packagedNotice.replace('.', '\\.')}$`, 'm').test(builder)) {
      throw new Error(`electron-builder.yml must package ${packagedNotice}.`);
    }
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
