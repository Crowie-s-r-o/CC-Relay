#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  providerCommandInvocation,
  resolveExecutableOnPath,
  terminateChildProcess,
} from '../src/claude-binary.mjs';
import {
  buildReleasePrompt,
  changelogEntryForVersion,
  compareVersions,
  formatChangelogEntry,
  inferReleaseType,
  localCalendarDate,
  nextVersion,
  normalizeReleaseNotes,
  parseVersion,
  prependChangelog,
  releaseNotesSchema,
  releasePublishStatus,
  selectReleaseWorkflowRun,
} from './release-core.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const AI_TIMEOUT_MS = 180_000;
const AI_OUTPUT_LIMIT = 512 * 1024;
const EXPECTED_REMOTE = /github\.com(?::|\/)Crowie-s-r-o\/CC-Relay(?:\.git)?$/i;
const RELEASE_REPOSITORY = 'Crowie-s-r-o/CC-Relay';
const RELEASE_WATCH_TIMEOUT_MS = 45 * 60_000;
const RELEASE_WATCH_INTERVAL_MS = 20_000;
const RELEASE_SETTLE_POLLS = 6;

function usage() {
  return `CC Relay deploy

Usage:
  npm run deploy -- [auto|patch|minor|major] [--provider auto|codex|claude] [--dry-run] [--no-watch]

Examples:
  npm run deploy
  npm run deploy -- minor --provider claude
  npm run deploy -- patch --dry-run

Deploy waits for GitHub Actions to publish the release and fails if it does not.
Pass --no-watch to stop right after the atomic push.`;
}

function parseArguments(argv) {
  const options = { releaseType: 'auto', provider: 'auto', dryRun: false, watch: true, help: false };
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
    if (value === '--no-watch') {
      options.watch = false;
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
  return gitText(['tag', '--merged', 'HEAD', '--list', 'v*'])
    .split(/\r?\n/)
    .map((tag) => tag.trim())
    .filter((tag) => /^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(tag))
    .sort((left, right) => compareVersions(left.slice(1), right.slice(1)));
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
// `gh api` is used instead of `gh run`/`gh release` because the REST paths are stable across the
// old CLI builds that are commonly installed.
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

// A missing release and an unusable CLI both fail the same way, so probe the repository once and
// treat only a positive answer as permission to interpret later 404s as "not published yet".
function releaseWatchAvailable() {
  const repository = ghJson(`repos/${RELEASE_REPOSITORY}`);
  return String(repository?.full_name || '') === RELEASE_REPOSITORY;
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
    const release = ghJson(`repos/${RELEASE_REPOSITORY}/releases/tags/${tag}`);
    const runs = ghJson(`repos/${RELEASE_REPOSITORY}/actions/runs?per_page=30&head_sha=${sha}`);
    const run = selectReleaseWorkflowRun(runs, { tag, sha });
    const status = releasePublishStatus({
      tag,
      run,
      releaseUrl: release?.html_url || '',
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

  const latestTag = releaseTags().at(-1) || null;
  if (latestTag && latestTag.slice(1) !== currentVersion) {
    throw new Error(`Latest tag ${latestTag} does not match package version ${currentVersion}.`);
  }
  const range = latestTag ? `${latestTag}..HEAD` : 'HEAD';
  const commits = parseCommits(range);
  if (commits.length === 0) throw new Error(`There are no commits to release after ${latestTag}.`);
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
  try {
    writeJson(packagePath, manifest);
    writeJson(lockPath, lockfile);
    writeFileSync(changelogPath, nextChangelog);
    runReleaseGates();
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
      `The local release commit and ${tag} are valid, but GitHub push failed: ${error.message}. Retry with git push --atomic origin main ${tag}`,
    );
  }

  const sha = gitText(['rev-parse', 'HEAD']).trim();
  const releasePage = `https://github.com/${RELEASE_REPOSITORY}/releases/tag/${tag}`;
  if (!options.watch) {
    console.log(`Pushed ${tag}. Confirm the published release at ${releasePage}`);
    return;
  }
  if (!releaseWatchAvailable()) {
    console.log(`Pushed ${tag}, but the GitHub CLI could not read the repository, so the release is unconfirmed.`);
    console.log(`Confirm it at ${releasePage}`);
    return;
  }

  console.log(`Waiting for GitHub Actions to build and publish ${tag}...`);
  const outcome = await watchReleasePublication(tag, sha);
  if (!outcome.ok) {
    throw new Error(`${outcome.message}\nThe commit and ${tag} are already pushed. Fix the build, then re-run the workflow for ${tag}.`);
  }
  console.log(outcome.message);
}

main().catch((error) => {
  console.error(`Deploy failed: ${error.message}`);
  process.exitCode = 1;
});
