#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  providerCommandInvocation,
  resolveExecutableOnPath,
  terminateChildProcess,
} from '../src/claude-binary.mjs';
import {
  buildReleasePrompt,
  changelogEntryForVersion,
  formatChangelogEntry,
  inferReleaseType,
  localCalendarDate,
  MAC_RELEASE_MANIFEST_NAME,
  nextVersion,
  normalizeReleaseTags,
  normalizeReleaseNotes,
  parseVersion,
  pendingReleaseTags,
  prependChangelog,
  releaseNotesSchema,
  releasePublishStatus,
  releaseRecoveryRefspecs,
  releaseHasSignedMacArtifacts,
  releaseTagsFromCompletePublishedReleases,
  releaseTagsFromRemoteRefs,
  selectReleaseWorkflowRun,
  windowsReleaseArtifactNames,
} from './release-core.mjs';
import {
  assertMacReleaseHost,
  buildSignedMacRelease,
} from './mac-release.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const AI_TIMEOUT_MS = 180_000;
const AI_OUTPUT_LIMIT = 512 * 1024;
const EXPECTED_REMOTE = /github\.com(?::|\/)Crowie-s-r-o\/CC-Relay(?:\.git)?$/i;
const RELEASE_REPOSITORY = 'Crowie-s-r-o/CC-Relay';
const RELEASE_WATCH_TIMEOUT_MS = 45 * 60_000;
const RELEASE_WATCH_INTERVAL_MS = 20_000;
const RELEASE_SETTLE_POLLS = 6;
const MAC_RELEASE_FEED_NAME = 'latest-mac.yml';

function usage() {
  return `CC Relay deploy

Usage:
  npm run deploy -- [auto|patch|minor|major] [--provider auto|codex|claude] [--dry-run]

Examples:
  npm run deploy
  npm run deploy -- minor --provider claude
  npm run deploy -- patch --dry-run

Deploy first recovers any validated unpublished local releases in version order.
It builds and verifies signed macOS artifacts locally, waits for the Windows workflow, and fails if publication does not complete.`;
}

function parseArguments(argv) {
  const options = { releaseType: 'auto', provider: 'auto', dryRun: false, help: false };
  let sawReleaseType = false;
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--help' || value === '-h') {
      options.help = true;
      continue;
    }
    if (value === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (value === '--provider') {
      const provider = argv[index + 1];
      if (!['auto', 'codex', 'claude'].includes(provider)) {
        throw new Error('--provider must be auto, codex, or claude.');
      }
      options.provider = provider;
      index += 1;
      continue;
    }
    if (value.startsWith('--provider=')) {
      const provider = value.slice('--provider='.length);
      if (!['auto', 'codex', 'claude'].includes(provider)) {
        throw new Error('--provider must be auto, codex, or claude.');
      }
      options.provider = provider;
      continue;
    }
    if (!value.startsWith('-') && !sawReleaseType) {
      if (!['auto', 'patch', 'minor', 'major'].includes(value)) {
        throw new Error('Release type must be auto, patch, minor, or major.');
      }
      options.releaseType = value;
      sawReleaseType = true;
      continue;
    }
    throw new Error(`Unknown release option: ${value}`);
  }
  return options;
}

function commandResult(command, args, {
  cwd = projectRoot,
  input,
  inherit = false,
  allowFailure = false,
  invocationOptions = {},
} = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    input,
    stdio: inherit ? 'inherit' : ['pipe', 'pipe', 'pipe'],
    maxBuffer: 10 * 1024 * 1024,
    ...invocationOptions,
  });
  if (result.error && !allowFailure) throw result.error;
  if (result.status !== 0 && !allowFailure) {
    const detail = String(result.stderr || '').trim().split(/\r?\n/).filter(Boolean).at(-1);
    throw new Error(detail || `${command} exited with status ${result.status}.`);
  }
  return result;
}

function git(args, options = {}) {
  return commandResult('git', args, options);
}

function npm(args, options = {}) {
  const resolved = resolveExecutableOnPath('npm');
  const invocation = providerCommandInvocation(resolved, args);
  return commandResult(invocation.command, invocation.args, {
    ...options,
    invocationOptions: invocation.options,
  });
}

function gitText(args) {
  return String(git(args).stdout || '');
}

function gitRefExists(ref) {
  return git(['show-ref', '--verify', '--quiet', ref], { allowFailure: true }).status === 0;
}

function parseCommits(range) {
  const output = gitText(['log', '--reverse', '--format=%H%x1f%s%x1f%b%x1e', range]);
  return output
    .split('\x1e')
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [hash = '', subject = '', ...body] = record.split('\x1f');
      return { hash, subject, body: body.join('\x1f').trim() };
    });
}

function releaseTags() {
  return normalizeReleaseTags(gitText(['tag', '--merged', 'HEAD', '--list', 'v*'])
    .split(/\r?\n/)
    .map((tag) => tag.trim()));
}

function remoteReleaseTags() {
  return releaseTagsFromRemoteRefs(gitText(['ls-remote', '--tags', '--refs', 'origin']));
}

function gitIsAncestor(ancestor, descendant) {
  return git(['merge-base', '--is-ancestor', ancestor, descendant], { allowFailure: true }).status === 0;
}

function releaseJsonAt(tag, path) {
  try {
    return JSON.parse(gitText(['show', `${tag}:${path}`]));
  } catch (error) {
    throw new Error(`Pending release ${tag} has invalid ${path}: ${error.message}`);
  }
}

function pendingReleaseRecords(tags) {
  const firstParentCommits = new Set(gitText(['rev-list', '--first-parent', 'HEAD'])
    .split(/\r?\n/)
    .map((sha) => sha.trim())
    .filter(Boolean));
  const records = tags.map((tag) => {
    const type = gitText(['cat-file', '-t', `refs/tags/${tag}`]).trim();
    if (type !== 'tag') {
      throw new Error(`Pending release ${tag} must be an annotated tag, found ${type || 'unknown'}.`);
    }
    const sha = gitText(['rev-parse', `${tag}^{commit}`]).trim();
    if (!firstParentCommits.has(sha)) {
      throw new Error(`Pending release ${tag} is not on local main's first-parent history.`);
    }
    const subject = gitText(['show', '-s', '--format=%s', sha]).trim();
    if (subject !== `chore(release): ${tag}`) {
      throw new Error(`Pending release ${tag} points to an unexpected commit: ${subject || sha}.`);
    }

    const version = tag.slice(1);
    const manifest = releaseJsonAt(tag, 'package.json');
    const lockfile = releaseJsonAt(tag, 'package-lock.json');
    if (
      manifest.version !== version
      || lockfile.version !== version
      || lockfile.packages?.['']?.version !== version
    ) {
      throw new Error(`Pending release ${tag} has inconsistent package versions.`);
    }
    const changelog = gitText(['show', `${tag}:CHANGELOG.md`]);
    changelogEntryForVersion(changelog, version);
    return { tag, sha, advanceMain: false };
  });

  for (let index = 1; index < records.length; index += 1) {
    if (!gitIsAncestor(records[index - 1].sha, records[index].sha)) {
      throw new Error(
        `Pending release ${records[index].tag} does not follow ${records[index - 1].tag} on main.`,
      );
    }
  }

  let remoteMain = gitText(['rev-parse', 'origin/main']).trim();
  for (const record of records) {
    if (gitIsAncestor(remoteMain, record.sha)) {
      record.advanceMain = remoteMain !== record.sha;
      remoteMain = record.sha;
      continue;
    }
    if (!gitIsAncestor(record.sha, remoteMain)) {
      throw new Error(`Pending release ${record.tag} diverges from origin/main.`);
    }
  }
  return records;
}

function assertReleaseRepository() {
  const status = gitText(['status', '--porcelain']);
  if (status.trim()) throw new Error('Release requires a clean working tree. Commit or stash changes first.');
  const branch = gitText(['branch', '--show-current']).trim();
  if (branch !== 'main') throw new Error(`Release must run from main, not ${branch || 'detached HEAD'}.`);
  const remote = gitText(['remote', 'get-url', 'origin']).trim();
  if (!EXPECTED_REMOTE.test(remote)) {
    throw new Error(`origin must point to Crowie-s-r-o/CC-Relay, found ${remote || 'no URL'}.`);
  }

  console.log('Fetching origin/main and release tags...');
  git(['fetch', 'origin', 'main', '--tags', '--prune'], { inherit: true });
  if (!gitRefExists('refs/remotes/origin/main')) {
    throw new Error('origin/main does not exist. Push main once before creating a release.');
  }
  const ancestor = git(['merge-base', '--is-ancestor', 'origin/main', 'HEAD'], { allowFailure: true });
  if (ancestor.status !== 0) {
    throw new Error('Local main diverges from origin/main. Reconcile it before releasing.');
  }
}

function parseClaudeOutput(stdout) {
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch (error) {
    throw new Error(`Claude returned invalid JSON: ${error.message}`);
  }
  const messages = Array.isArray(parsed) ? parsed : [parsed];
  const result = [...messages].reverse().find((message) => message?.type === 'result') || messages.at(-1);
  if (!result || result.is_error || String(result.subtype || '').startsWith('error')) {
    throw new Error(result?.result || result?.error || 'Claude did not return release notes.');
  }
  if (result.structured_output && typeof result.structured_output === 'object') {
    return result.structured_output;
  }
  if (parsed.structured_output && typeof parsed.structured_output === 'object') {
    return parsed.structured_output;
  }
  return result.result;
}

function runAiProcess(provider, prompt, workspace, schemaPath) {
  const command = provider === 'codex' ? 'codex' : 'claude';
  const args = provider === 'codex'
    ? [
        'exec',
        '--ephemeral',
        '--ignore-user-config',
        '--ignore-rules',
        '--disable',
        'shell_tool',
        '--disable',
        'unified_exec',
        '--sandbox',
        'read-only',
        '--skip-git-repo-check',
        '--output-schema',
        schemaPath,
        '--color',
        'never',
        '-',
      ]
    : [
        '--print',
        '--no-session-persistence',
        '--no-chrome',
        '--setting-sources',
        '',
        '--disable-slash-commands',
        '--strict-mcp-config',
        '--mcp-config',
        '{"mcpServers":{}}',
        '--permission-mode',
        'plan',
        '--tools',
        '',
        '--model',
        'default',
        '--effort',
        'high',
        '--json-schema',
        JSON.stringify(releaseNotesSchema),
        '--output-format',
        'json',
      ];
  const resolved = resolveExecutableOnPath(command);
  const invocation = providerCommandInvocation(resolved, args);
  const child = spawn(invocation.command, invocation.args, {
    cwd: workspace,
    stdio: ['pipe', 'pipe', 'pipe'],
    ...invocation.options,
  });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');

  return new Promise((resolvePromise, rejectPromise) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    let exceeded = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };
    const stop = () => terminateChildProcess(child, { signal: 'SIGTERM' });
    const timer = setTimeout(() => {
      stop();
      finish(rejectPromise, new Error(`${provider} release-note generation timed out.`));
    }, AI_TIMEOUT_MS);

    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (Buffer.byteLength(stdout) > AI_OUTPUT_LIMIT && !exceeded) {
        exceeded = true;
        stop();
      }
    });
    child.stderr.on('data', (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-32_000);
    });
    child.stdin.on('error', () => {});
    child.once('error', (error) => finish(rejectPromise, error));
    child.once('close', (code, signal) => {
      if (settled) return;
      if (exceeded) {
        finish(rejectPromise, new Error(`${provider} release-note output was too large.`));
        return;
      }
      if (code !== 0) {
        const detail = stderr.trim().split(/\r?\n/).filter(Boolean).at(-1);
        finish(rejectPromise, new Error(detail || `${provider} stopped with ${signal || `code ${code}`}.`));
        return;
      }
      finish(resolvePromise, stdout);
    });
    child.stdin.end(`${prompt}\n`);
  });
}

async function generateReleaseNotes(prompt, providerPreference) {
  const workspace = mkdtempSync(join(tmpdir(), 'cc-relay-release-'));
  const schemaPath = join(workspace, 'release-notes.schema.json');
  writeFileSync(schemaPath, `${JSON.stringify(releaseNotesSchema, null, 2)}\n`);
  const providers = providerPreference === 'auto' ? ['codex', 'claude'] : [providerPreference];
  const failures = [];
  try {
    for (const provider of providers) {
      console.log(`Generating compact changelog with ${provider === 'codex' ? 'Codex' : 'Claude'}...`);
      try {
        const raw = await runAiProcess(provider, prompt, workspace, schemaPath);
        const payload = provider === 'claude' ? parseClaudeOutput(raw) : raw;
        return { notes: normalizeReleaseNotes(payload), provider };
      } catch (error) {
        failures.push(`${provider}: ${error.message}`);
        if (providers.length > 1) console.warn(`${provider} was unavailable; trying the fallback provider.`);
      }
    }
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
  throw new Error(`AI changelog generation failed. ${failures.join(' | ')}`);
}

// The GitHub CLI carries the maintainer credential, so deploy never handles a token itself.
// REST reads keep workflow selection deterministic, while `gh release upload` transfers the
// locally verified macOS artifacts after the hosted Windows draft handoff exists.
function ghJson(path) {
  const resolved = resolveExecutableOnPath('gh');
  const invocation = providerCommandInvocation(resolved, [
    'api',
    '-H',
    'Accept: application/vnd.github+json',
    path,
  ]);
  const result = commandResult(invocation.command, invocation.args, {
    allowFailure: true,
    invocationOptions: invocation.options,
  });
  if (result.error || result.status !== 0) return null;
  try {
    return JSON.parse(String(result.stdout || ''));
  } catch {
    return null;
  }
}

function gh(args, { inherit = false } = {}) {
  const resolved = resolveExecutableOnPath('gh');
  const invocation = providerCommandInvocation(resolved, args);
  return commandResult(invocation.command, invocation.args, {
    inherit,
    invocationOptions: invocation.options,
  });
}

function uploadReleaseAssets(tag, paths) {
  if (paths.length === 0) return;
  gh([
    'release',
    'upload',
    tag,
    ...paths,
    '--repo',
    RELEASE_REPOSITORY,
    '--clobber',
  ], { inherit: true });
}

function removeReleaseAssets(tag, release, names) {
  const existing = new Set((Array.isArray(release?.assets) ? release.assets : [])
    .map((asset) => String(asset?.name || ''))
    .filter(Boolean));
  for (const name of names) {
    if (!existing.has(name)) continue;
    gh([
      'release',
      'delete-asset',
      tag,
      name,
      '--repo',
      RELEASE_REPOSITORY,
      '--yes',
    ], { inherit: true });
  }
}

function releaseAssetsByName(release) {
  return new Map((Array.isArray(release?.assets) ? release.assets : [])
    .map((asset) => [String(asset?.name || ''), asset]));
}

function assertFinishedReleaseAssets(tag, release, names) {
  const remoteAssets = releaseAssetsByName(release);
  for (const name of names) {
    const asset = remoteAssets.get(name);
    if (!asset || asset.state !== 'uploaded' || Number(asset.size || 0) <= 0) {
      throw new Error(`GitHub Release ${tag} has not finished uploading ${name}.`);
    }
  }
}

function assertUploadedReleaseAssets(tag, release, expectedSizes, names) {
  assertFinishedReleaseAssets(tag, release, names);
  const remoteAssets = releaseAssetsByName(release);
  for (const name of names) {
    const asset = remoteAssets.get(name);
    if (Number(asset.size || 0) !== expectedSizes[name]) {
      throw new Error(`GitHub Release ${tag} has the wrong uploaded size for ${name}.`);
    }
  }
}

// A missing release and an unusable CLI both fail the same way, so probe the repository once and
// treat only a positive answer as permission to interpret later 404s as "not published yet".
function releaseWatchAvailable() {
  const repository = ghJson(`repos/${RELEASE_REPOSITORY}`);
  return String(repository?.full_name || '') === RELEASE_REPOSITORY;
}

function releaseByTag(tag) {
  const published = ghJson(`repos/${RELEASE_REPOSITORY}/releases/tags/${tag}`);
  if (published) return published;
  // GitHub's tag endpoint exposes published releases only. An authenticated listing also includes
  // drafts for users with push access, which is how local deploy finds the staged handoff.
  const releases = ghJson(`repos/${RELEASE_REPOSITORY}/releases?per_page=100`);
  if (!Array.isArray(releases)) return null;
  return releases.find((release) => String(release?.tag_name || '') === tag) || null;
}

function publishedReleaseTags() {
  const releases = ghJson(`repos/${RELEASE_REPOSITORY}/releases?per_page=100`);
  if (!Array.isArray(releases)) return null;
  return releaseTagsFromCompletePublishedReleases(releases);
}

function publishSignedMacRelease(tag, signedRelease) {
  const pathByName = new Map(signedRelease.paths.map((path) => [basename(path), path]));
  const expectedNames = Object.keys(signedRelease.sizes);
  const feedPath = pathByName.get(MAC_RELEASE_FEED_NAME);
  const manifestPath = pathByName.get(MAC_RELEASE_MANIFEST_NAME);
  const payloadPaths = signedRelease.paths.filter((path) => {
    const name = basename(path);
    return name !== MAC_RELEASE_FEED_NAME && name !== MAC_RELEASE_MANIFEST_NAME;
  });
  if (!feedPath || !manifestPath || payloadPaths.length + 2 !== signedRelease.paths.length) {
    throw new Error(`Verified macOS artifacts for ${tag} do not have one feed and one manifest.`);
  }

  let release = releaseByTag(tag);
  if (!release) throw new Error(`GitHub Release ${tag} does not exist.`);
  const windowsNames = windowsReleaseArtifactNames(tag.slice(1));
  assertFinishedReleaseAssets(tag, release, windowsNames);

  console.log(`Uploading verified signed macOS payloads for ${tag}...`);
  // A partial public release from the older pipeline may already have a feed. Remove that feed
  // and the completion marker before replacing payloads so no updater can observe mixed assets.
  removeReleaseAssets(tag, release, [MAC_RELEASE_FEED_NAME, MAC_RELEASE_MANIFEST_NAME]);
  uploadReleaseAssets(tag, payloadPaths);
  release = releaseByTag(tag);
  assertUploadedReleaseAssets(
    tag,
    release,
    signedRelease.sizes,
    payloadPaths.map((path) => basename(path)),
  );

  // Publish the updater feed only after every payload is complete, then publish the manifest as
  // the release-completeness marker. Future releases stay draft until all three stages pass.
  uploadReleaseAssets(tag, [feedPath]);
  release = releaseByTag(tag);
  assertUploadedReleaseAssets(tag, release, signedRelease.sizes, [
    ...payloadPaths.map((path) => basename(path)),
    MAC_RELEASE_FEED_NAME,
  ]);

  uploadReleaseAssets(tag, [manifestPath]);
  release = releaseByTag(tag);
  assertUploadedReleaseAssets(tag, release, signedRelease.sizes, expectedNames);

  if (release.draft) {
    gh([
      'release',
      'edit',
      tag,
      '--repo',
      RELEASE_REPOSITORY,
      '--draft=false',
    ], { inherit: true });
  }

  const publishedRelease = releaseByTag(tag);
  if (!releaseHasSignedMacArtifacts(publishedRelease)) {
    throw new Error(`GitHub Release ${tag} is not published with every verified macOS asset.`);
  }
  assertFinishedReleaseAssets(tag, publishedRelease, windowsNames);
  assertUploadedReleaseAssets(tag, publishedRelease, signedRelease.sizes, expectedNames);
  console.log(`Published complete desktop release ${tag}.`);
}

function removeReleaseWorktree(root, workspace) {
  git(['worktree', 'remove', '--force', workspace], { allowFailure: true });
  rmSync(root, { recursive: true, force: true });
}

function buildSignedMacReleaseAt(record) {
  const version = record.tag.slice(1);
  const currentHead = gitText(['rev-parse', 'HEAD']).trim();
  if (currentHead === record.sha) {
    console.log(`Building signed macOS artifacts for ${record.tag}...`);
    const signedRelease = buildSignedMacRelease({
      projectRoot,
      version,
      runBuild: () => npm(['run', 'desktop:build:mac'], { inherit: true }),
    });
    return { signedRelease, dispose() {} };
  }

  const root = mkdtempSync(join(tmpdir(), 'cc-relay-mac-release-'));
  const workspace = join(root, 'source');
  let worktreeAdded = false;
  try {
    console.log(`Preparing isolated signed macOS build for ${record.tag}...`);
    git(['worktree', 'add', '--detach', workspace, record.tag], { inherit: true });
    worktreeAdded = true;
    npm(['ci'], { cwd: workspace, inherit: true });
    const signedRelease = buildSignedMacRelease({
      projectRoot: workspace,
      version,
      runBuild: () => npm(['run', 'desktop:build:mac'], { cwd: workspace, inherit: true }),
    });
    return {
      signedRelease,
      dispose: () => removeReleaseWorktree(root, workspace),
    };
  } catch (error) {
    if (worktreeAdded) {
      removeReleaseWorktree(root, workspace);
    } else {
      rmSync(root, { recursive: true, force: true });
    }
    throw error;
  }
}

function delay(milliseconds) {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, milliseconds);
  });
}

async function watchReleasePublication(tag, sha) {
  const deadline = Date.now() + RELEASE_WATCH_TIMEOUT_MS;
  let settleRemaining = RELEASE_SETTLE_POLLS;
  let lastMessage = '';
  while (Date.now() < deadline) {
    const release = releaseByTag(tag);
    const runs = ghJson(`repos/${RELEASE_REPOSITORY}/actions/runs?per_page=30&head_sha=${sha}`);
    const run = selectReleaseWorkflowRun(runs, { tag, sha });
    const status = releasePublishStatus({
      tag,
      run,
      releaseUrl: release?.html_url || '',
      releaseDraft: release?.draft === true,
      settleRemaining,
    });
    if (status.done) return status;
    if (status.message !== lastMessage) {
      console.log(status.message);
      lastMessage = status.message;
    }
    if (run && run.status === 'completed') settleRemaining -= 1;
    await delay(RELEASE_WATCH_INTERVAL_MS);
  }
  return {
    done: true,
    ok: false,
    message: `Timed out waiting for the GitHub Release for ${tag}. Inspect https://github.com/${RELEASE_REPOSITORY}/actions`,
  };
}

async function recoverPendingReleases(localTags, options) {
  const remoteTags = remoteReleaseTags();
  const missingRemoteTags = pendingReleaseTags({
    localTags,
    publishedTags: remoteTags,
  });
  if (!releaseWatchAvailable()) {
    if (missingRemoteTags.length > 0) {
      throw new Error(
        `Found pending local releases ${missingRemoteTags.join(', ')}, but the GitHub CLI could not read ${RELEASE_REPOSITORY}. Restore GitHub access, then rerun npm run deploy.`,
      );
    }
    return { pendingTags: [], recoveredTags: [] };
  }

  const publishedTags = publishedReleaseTags();
  if (!publishedTags) {
    throw new Error(`Could not inspect published releases for ${RELEASE_REPOSITORY}. Rerun npm run deploy.`);
  }
  const latestPublished = publishedTags.at(-1) || null;
  if (latestPublished && !localTags.includes(latestPublished)) {
    throw new Error(`Latest published release ${latestPublished} is not reachable from local main.`);
  }

  const pendingTags = pendingReleaseTags({ localTags, publishedTags });
  if (pendingTags.length === 0) return { pendingTags, recoveredTags: [] };

  const records = pendingReleaseRecords(pendingTags);
  console.log(`Found ${pendingTags.length} pending release${pendingTags.length === 1 ? '' : 's'} after ${latestPublished || 'the empty release history'}: ${pendingTags.join(', ')}`);
  if (options.dryRun) {
    console.log('Dry run: pending releases would be published in the order shown above.');
    return { pendingTags, recoveredTags: [] };
  }

  const remoteTagSet = new Set(remoteTags);
  const recoveredTags = [];
  for (const record of records) {
    const prepared = buildSignedMacReleaseAt(record);
    try {
      const refspecs = releaseRecoveryRefspecs({
        ...record,
        remoteTagPresent: remoteTagSet.has(record.tag),
      });

      if (refspecs.length > 0) {
        console.log(`Recovering ${record.tag} with an atomic push...`);
        try {
          git(['push', '--atomic', 'origin', ...refspecs], { inherit: true });
        } catch (error) {
          throw new Error(
            `Pending release ${record.tag} is valid, but GitHub push failed: ${error.message}. Fix GitHub access, then rerun npm run deploy; completed releases will be skipped.`,
          );
        }
        remoteTagSet.add(record.tag);
      } else {
        console.log(`${record.tag} is already pushed; resuming its publication watch.`);
      }

      console.log(`Waiting for GitHub Actions to prepare the Windows release draft for ${record.tag}...`);
      const outcome = await watchReleasePublication(record.tag, record.sha);
      if (!outcome.ok) {
        throw new Error(`${outcome.message}\nRecovery stopped at ${record.tag}; later pending releases were not pushed.`);
      }
      console.log(outcome.message);
      publishSignedMacRelease(record.tag, prepared.signedRelease);
      recoveredTags.push(record.tag);
    } finally {
      prepared.dispose();
    }
  }
  return { pendingTags, recoveredTags };
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function runReleaseGates() {
  console.log('Checking commit attribution...');
  npm(['run', 'attribution:check'], { inherit: true });
  console.log('Checking release metadata...');
  npm(['run', 'release:check'], { inherit: true });
  console.log('Running the complete test suite...');
  npm(['test'], { inherit: true });
  console.log('Auditing dependencies...');
  npm(['audit', '--audit-level=high'], { inherit: true });
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  assertReleaseRepository();
  if (!options.dryRun) {
    assertMacReleaseHost();
    if (!releaseWatchAvailable()) {
      throw new Error(`The GitHub CLI must be able to read ${RELEASE_REPOSITORY} before a signed desktop release.`);
    }
  }
  const packagePath = resolve(projectRoot, 'package.json');
  const lockPath = resolve(projectRoot, 'package-lock.json');
  const changelogPath = resolve(projectRoot, 'CHANGELOG.md');
  const manifestSource = readFileSync(packagePath, 'utf8');
  const lockSource = readFileSync(lockPath, 'utf8');
  const changelogSource = readFileSync(changelogPath, 'utf8');
  const manifest = JSON.parse(manifestSource);
  const lockfile = JSON.parse(lockSource);
  const currentVersion = String(manifest.version || '');
  parseVersion(currentVersion);
  changelogEntryForVersion(changelogSource, currentVersion);
  if (lockfile.version !== currentVersion || lockfile.packages?.['']?.version !== currentVersion) {
    throw new Error('package.json and package-lock.json versions do not match.');
  }

  const localTags = releaseTags();
  const latestTag = localTags.at(-1) || null;
  if (latestTag && latestTag.slice(1) !== currentVersion) {
    throw new Error(`Latest tag ${latestTag} does not match package version ${currentVersion}.`);
  }
  const recovery = await recoverPendingReleases(localTags, options);
  const range = latestTag ? `${latestTag}..HEAD` : 'HEAD';
  const commits = parseCommits(range);
  if (commits.length === 0) {
    if (recovery.pendingTags.length > 0) {
      if (options.dryRun) {
        console.log('\nDry run complete. No files, commits, tags, or remotes were changed.');
      } else {
        console.log(`Recovered ${recovery.recoveredTags.join(', ')}. There are no new commits to release.`);
      }
      return;
    }
    throw new Error(`There are no commits to release after ${latestTag}.`);
  }
  const releaseType = options.releaseType === 'auto'
    ? inferReleaseType(commits)
    : options.releaseType;
  const version = nextVersion(currentVersion, releaseType);
  const tag = `v${version}`;
  if (gitRefExists(`refs/tags/${tag}`)) throw new Error(`Tag ${tag} already exists.`);

  const changes = gitText(['log', '--format=', '--name-status', range]);
  const prompt = buildReleasePrompt({ previousTag: latestTag, nextTag: tag, commits, changes });
  const generated = await generateReleaseNotes(prompt, options.provider);
  const date = localCalendarDate();
  const entry = formatChangelogEntry({ version, date, notes: generated.notes });

  console.log(`\n${tag} (${releaseType}, ${commits.length} commits, AI: ${generated.provider})\n`);
  console.log(entry);
  if (options.dryRun) {
    console.log('\nDry run complete. No files, commits, tags, or remotes were changed.');
    return;
  }

  manifest.version = version;
  lockfile.version = version;
  lockfile.packages[''].version = version;
  const nextChangelog = prependChangelog(changelogSource, entry, version);
  let commitCreated = false;
  let signedMacRelease = null;
  try {
    writeJson(packagePath, manifest);
    writeJson(lockPath, lockfile);
    writeFileSync(changelogPath, nextChangelog);
    runReleaseGates();
    console.log('Building and verifying signed macOS release artifacts...');
    signedMacRelease = buildSignedMacRelease({
      projectRoot,
      version,
      runBuild: () => npm(['run', 'desktop:build:mac'], { inherit: true }),
    });
    git(['add', 'package.json', 'package-lock.json', 'CHANGELOG.md']);
    git(['diff', '--cached', '--check']);
    git(['commit', '-m', `chore(release): ${tag}`], { inherit: true });
    commitCreated = true;
    git(['tag', '-a', tag, '-m', `CC Relay ${tag}`, '-m', entry], { inherit: true });
  } catch (error) {
    if (!commitCreated) {
      git(['restore', '--staged', 'package.json', 'package-lock.json', 'CHANGELOG.md'], { allowFailure: true });
      writeFileSync(packagePath, manifestSource);
      writeFileSync(lockPath, lockSource);
      writeFileSync(changelogPath, changelogSource);
    }
    throw error;
  }

  try {
    console.log(`Pushing main and ${tag} atomically...`);
    git(['push', '--atomic', 'origin', 'main', tag], { inherit: true });
  } catch (error) {
    throw new Error(
      `The local release commit and ${tag} are valid, but GitHub push failed: ${error.message}. Fix GitHub access, then rerun npm run deploy; it will recover every pending release in order.`,
    );
  }

  const sha = gitText(['rev-parse', 'HEAD']).trim();
  console.log(`Waiting for GitHub Actions to prepare the Windows release draft for ${tag}...`);
  const outcome = await watchReleasePublication(tag, sha);
  if (!outcome.ok) {
    throw new Error(`${outcome.message}\nThe commit and ${tag} are already pushed. Fix the build, then re-run the workflow for ${tag}.`);
  }
  console.log(outcome.message);
  publishSignedMacRelease(tag, signedMacRelease);
}

main().catch((error) => {
  console.error(`Deploy failed: ${error.message}`);
  process.exitCode = 1;
});
