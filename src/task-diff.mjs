import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);

// Per-task diff preview. A task records the git tree of its project working state when it
// starts and again when it reaches a terminal status. The preview always compares two trees:
// the baseline against the live working state while the task runs, and against the stored end
// tree once it has finished, so a finished task keeps showing what it changed.
//
// Every git invocation is asynchronous, bounded, argument-array based, and reads through a
// throwaway index outside the repository. The user's index, worktree, refs, and HEAD are never
// written. Only loose objects land in .git/objects, and those are prunable by git gc.
export const TASK_DIFF_STATE_VERSION = 1;

export const LIVE_TASK_STATUSES = new Set(['running', 'open']);
export const TERMINAL_TASK_STATUSES = new Set(['complete', 'failed', 'cancelled', 'interrupted']);

// Bounds. A diff is untrusted input: it is produced by whatever the provider wrote to disk.
export const MAX_SUMMARY_FILES = 500;
export const MAX_PATCH_LINES = 5000;
export const MAX_PATCH_BYTES = 2 * 1024 * 1024;

const GIT_TIMEOUT_MS = 15_000;
// execFile defaults to a 1MB buffer and throws ERR_CHILD_PROCESS_STDIO_MAXBUFFER past it, which
// a large but perfectly ordinary diff reaches, so both limits are explicit.
const SUMMARY_MAX_BUFFER = 32 * 1024 * 1024;
const FILE_MAX_BUFFER = 16 * 1024 * 1024;
const SMALL_MAX_BUFFER = 1024 * 1024;

const ROOT_CACHE_TTL_MS = 10_000;
const TREE_CACHE_TTL_MS = 2_500;
const SUMMARY_CACHE_TTL_MS = 2_500;
const CACHE_LIMIT = 32;

const MAX_DIFF_PATH_LENGTH = 4096;

// Locale, time zone, and optional locks are pinned so two backends and two platforms read the
// same bytes back. GIT_TERMINAL_PROMPT keeps a misconfigured repository from parking a child
// process on a credential prompt until the timeout fires.
const GIT_ENVIRONMENT = {
  LC_ALL: 'C',
  LANG: 'C',
  TZ: 'UTC',
  GIT_OPTIONAL_LOCKS: '0',
  GIT_TERMINAL_PROMPT: '0',
};

// core.fsmonitor would start a user-configured daemon from a background snapshot, and color.ui
// set to always would inject escape codes into output this module parses as data.
const GIT_CONFIG_ARGUMENTS = ['-c', 'core.fsmonitor=false', '-c', 'color.ui=false'];

const STATUS_BY_LETTER = {
  A: 'added',
  C: 'added',
  D: 'deleted',
  M: 'modified',
  R: 'renamed',
  T: 'modified',
  U: 'modified',
};

// The API reason set is fixed. Any other failure, including one raised by a layer this module
// does not own, is reported as a capture failure rather than leaking a new reason to clients.
const DIFF_ERROR_CODES = new Set(['not-a-git-repository', 'git-unavailable', 'baseline-failed']);

function diffErrorCode(value) {
  return DIFF_ERROR_CODES.has(value) ? value : 'baseline-failed';
}

export class TaskDiffError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'TaskDiffError';
    this.code = code;
  }
}

function isoNow() {
  return new Date().toISOString();
}

function isMissingGitBinary(error) {
  // The project directory is verified before the first spawn, so ENOENT here is the git binary
  // itself rather than a missing working directory.
  return error?.code === 'ENOENT';
}

function wasKilled(error) {
  return error?.killed === true || error?.signal === 'SIGTERM';
}

function isBufferOverflow(error) {
  return error?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER';
}

const rootCache = new Map();
const treeCache = new Map();
const summaryCache = new Map();
// Both captures are started fire and forget from more than one place, so each task id is
// claimed for the length of its snapshot.
const baselineCaptures = new Set();
const endCaptures = new Set();

// Tests share one module instance across cases and inject their own runner, so every cache has
// to be resettable.
export function clearTaskDiffCaches() {
  rootCache.clear();
  treeCache.clear();
  summaryCache.clear();
}

function cachedPromise(cache, key, ttlMs, at, factory) {
  const entry = cache.get(key);
  if (entry && at - entry.at <= ttlMs) return entry.promise;
  const promise = factory();
  // A rejection is cached on purpose: a repository that is missing git stays missing for the
  // TTL instead of spawning a child process per poll. The extra handler keeps the cached
  // rejection from surfacing as an unhandled rejection when nobody reads it again.
  promise.catch(() => {});
  cache.delete(key);
  cache.set(key, { at, promise });
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  return promise;
}

function runGit(root, args, {
  run = execFile,
  env = null,
  timeout = GIT_TIMEOUT_MS,
  maxBuffer = SMALL_MAX_BUFFER,
} = {}) {
  return run('git', [...GIT_CONFIG_ARGUMENTS, ...args], {
    cwd: root,
    timeout,
    maxBuffer,
    windowsHide: true,
    env: { ...process.env, ...GIT_ENVIRONMENT, ...(env || {}) },
  });
}

export function normalizeDiffState(value) {
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const state = {
    root: typeof parsed.root === 'string' && parsed.root ? parsed.root : null,
    baseline: normalizeTreeStamp(parsed.baseline),
    end: normalizeTreeStamp(parsed.end),
    error: normalizeDiffError(parsed.error),
  };
  if (!state.root && !state.baseline && !state.end && !state.error) return null;
  return state;
}

function normalizeTreeStamp(value) {
  if (!value || typeof value !== 'object') return null;
  const tree = typeof value.tree === 'string' ? value.tree.trim() : '';
  const at = typeof value.at === 'string' ? value.at : '';
  if (!tree || !at) return null;
  return { tree, at };
}

function normalizeDiffError(value) {
  if (!value || typeof value !== 'object') return null;
  const code = typeof value.code === 'string' ? value.code : '';
  const at = typeof value.at === 'string' ? value.at : '';
  if (!code || !at) return null;
  return { code: diffErrorCode(code), at };
}

function writeDiffState(database, taskId, state) {
  const stored = {
    version: TASK_DIFF_STATE_VERSION,
    root: state.root || null,
    baseline: state.baseline || null,
    end: state.end || null,
    error: state.error || null,
  };
  database.updateTask(taskId, { diff_state_json: JSON.stringify(stored) });
  return stored;
}

export async function resolveRepositoryRoot(repoPath, { run = execFile, clock = Date.now } = {}) {
  const key = typeof repoPath === 'string' ? repoPath.trim() : '';
  if (!key) {
    throw new TaskDiffError('not-a-git-repository', 'This task has no project directory.');
  }
  return cachedPromise(rootCache, key, ROOT_CACHE_TTL_MS, clock(), () => resolveRoot(key, { run }));
}

async function resolveRoot(repoPath, { run }) {
  try {
    const stats = await stat(repoPath);
    if (!stats.isDirectory()) {
      throw new TaskDiffError('not-a-git-repository', 'The project path is not a directory.');
    }
  } catch (error) {
    if (error instanceof TaskDiffError) throw error;
    throw new TaskDiffError('not-a-git-repository', 'The project directory is no longer available.');
  }

  let stdout = '';
  try {
    ({ stdout = '' } = await runGit(repoPath, ['rev-parse', '--show-toplevel'], { run }));
  } catch (error) {
    if (isMissingGitBinary(error) || wasKilled(error)) {
      throw new TaskDiffError('git-unavailable', 'git is not available for this project.');
    }
    throw new TaskDiffError('not-a-git-repository', 'This project is not a git repository.');
  }
  const root = String(stdout).trim();
  if (!root) {
    throw new TaskDiffError('not-a-git-repository', 'This project is not a git repository.');
  }
  return root;
}

// The working state as a real git tree: tracked files plus untracked files, .gitignore
// respected, staged and unstaged edits collapsed into the bytes that are on disk right now.
// The index lives in a throwaway directory outside the repository, so git locks that copy and
// never the user's own .git/index.
export async function snapshotWorkingTree(root, { run = execFile } = {}) {
  let directory = null;
  try {
    directory = await mkdtemp(join(tmpdir(), 'relay-task-diff-'));
  } catch {
    throw new TaskDiffError('baseline-failed', 'A temporary git index could not be created.');
  }
  const env = { GIT_INDEX_FILE: join(directory, 'index') };
  try {
    await runGit(root, ['read-tree', '--empty'], { run, env });
    await runGit(root, ['add', '-A', '--', '.'], { run, env, maxBuffer: SUMMARY_MAX_BUFFER });
    const { stdout = '' } = await runGit(root, ['write-tree'], { run, env });
    const tree = String(stdout).trim();
    if (!/^[0-9a-f]{40,64}$/.test(tree)) {
      throw new TaskDiffError('baseline-failed', 'git did not return a tree for the working state.');
    }
    return tree;
  } catch (error) {
    if (error instanceof TaskDiffError) throw error;
    if (isMissingGitBinary(error)) {
      throw new TaskDiffError('git-unavailable', 'git is not available for this project.');
    }
    throw new TaskDiffError('baseline-failed', 'The working state could not be captured.');
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}

function currentWorkingTree(root, { run = execFile, clock = Date.now } = {}) {
  // Three second polling from several open clients must not stack snapshots of the same tree.
  return cachedPromise(treeCache, root, TREE_CACHE_TTL_MS, clock(), () => snapshotWorkingTree(root, { run }));
}

/**
 * Captures the baseline tree the first time a task starts. A follow-up or retry re-enters the
 * same path and keeps the original baseline so the preview still answers "what did this task
 * change", and only clears the end tree so the diff goes live again.
 *
 * Never throws and never rejects: a task must run even when its project has no git. The queue
 * starts this without awaiting it, so the snapshot races the provider's first write. It wins
 * that race by a wide margin in practice, because the child process is spawned before the
 * runner has finished starting a terminal.
 */
export async function captureTaskDiffBaseline({
  database,
  taskId,
  run = execFile,
  now = isoNow,
} = {}) {
  let claimed = false;
  let hadBaseline = false;
  try {
    const task = database?.getTask?.(taskId);
    if (!task) return null;
    const state = normalizeDiffState(task.diffState);
    hadBaseline = Boolean(state?.baseline);

    if (state?.baseline) {
      if (!state.end) return state;
      return normalizeDiffState(writeDiffState(database, taskId, { ...state, end: null }));
    }

    // A rapid re-begin must not snapshot the same task twice. There is no end to clear yet
    // while a first capture is still in flight, so the second caller has nothing to do.
    if (baselineCaptures.has(taskId)) return null;
    baselineCaptures.add(taskId);
    claimed = true;

    const root = await resolveRepositoryRoot(task.repo_path, { run });
    const tree = await snapshotWorkingTree(root, { run });
    return normalizeDiffState(writeDiffState(database, taskId, {
      root,
      baseline: { tree, at: now() },
      end: null,
      error: null,
    }));
  } catch (error) {
    // A capture failure is recorded as state, never as a task event: the queue's event stream
    // is asserted positionally across the suite and a diff preview is not worth that noise.
    // A task that already holds a baseline keeps it; only a failed first capture is recorded.
    if (hadBaseline) return null;
    try {
      writeDiffState(database, taskId, {
        root: null,
        baseline: null,
        end: null,
        error: { code: diffErrorCode(error?.code), at: now() },
      });
    } catch {}
    return null;
  } finally {
    if (claimed) baselineCaptures.delete(taskId);
  }
}

/**
 * Freezes the diff when a task reaches a terminal status. Called fire and forget from the
 * queue change listener and lazily from the summary route when a backend restart missed the
 * transition, so the in-flight guard lives here where both callers share it.
 */
export async function maybeCaptureTaskDiffEnd({
  database,
  task,
  run = execFile,
  now = isoNow,
  requireTerminal = true,
} = {}) {
  // Synchronous prologue on purpose. The queue emits `changed` from inside beginTask, so the
  // common case has to cost nothing but a property read.
  if (!task || !database) return false;
  if (requireTerminal && !TERMINAL_TASK_STATUSES.has(task.status)) return false;
  if (!requireTerminal && LIVE_TASK_STATUSES.has(task.status)) return false;
  const state = normalizeDiffState(task.diffState);
  if (!state?.baseline || state.end || state.error) return false;
  if (endCaptures.has(task.id)) return false;

  endCaptures.add(task.id);
  try {
    const root = state.root || await resolveRepositoryRoot(task.repo_path, { run });
    const tree = await snapshotWorkingTree(root, { run });
    const current = database.getTask(task.id);
    const latest = normalizeDiffState(current?.diffState);
    // A retry or follow-up that re-began during the snapshot put this task back on the live
    // tree on purpose. Losing that race must never freeze a task that is running again.
    if (!current || LIVE_TASK_STATUSES.has(current.status)) return false;
    if (!latest?.baseline || latest.end || latest.baseline.at !== state.baseline.at) return false;
    writeDiffState(database, task.id, { ...latest, root, end: { tree, at: now() } });
    return true;
  } catch {
    return false;
  } finally {
    endCaptures.delete(task.id);
  }
}

export function parseNameStatus(output) {
  const tokens = String(output || '').split('\0');
  const records = [];
  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index];
    if (!token) {
      index += 1;
      continue;
    }
    const letter = token[0];
    if (letter === 'R' || letter === 'C') {
      const oldPath = tokens[index + 1];
      const path = tokens[index + 2];
      index += 3;
      if (!oldPath || !path) continue;
      records.push({
        path,
        oldPath: letter === 'R' ? oldPath : null,
        status: letter === 'R' ? 'renamed' : 'added',
      });
      continue;
    }
    const path = tokens[index + 1];
    index += 2;
    if (!path) continue;
    records.push({ path, oldPath: null, status: STATUS_BY_LETTER[letter] || 'modified' });
  }
  return records;
}

export function parseNumstat(output) {
  const tokens = String(output || '').split('\0');
  const records = [];
  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index];
    if (!token) {
      index += 1;
      continue;
    }
    const match = token.match(/^(\d+|-)\t(\d+|-)\t([\s\S]*)$/);
    if (!match) {
      index += 1;
      continue;
    }
    const [, added, deleted, inlinePath] = match;
    let path = inlinePath;
    let oldPath = null;
    if (path) {
      index += 1;
    } else {
      // A rename record leaves the path field empty and follows it with the two paths.
      oldPath = tokens[index + 1] || null;
      path = tokens[index + 2] || '';
      index += 3;
    }
    if (!path) continue;
    records.push({
      path,
      oldPath,
      additions: added === '-' ? 0 : Number(added),
      deletions: deleted === '-' ? 0 : Number(deleted),
      binary: added === '-' || deleted === '-',
    });
  }
  return records;
}

export function mergeDiffRecords(nameStatus, numstat) {
  const counts = new Map(numstat.map((record) => [record.path, record]));
  return nameStatus.map((record) => {
    const count = counts.get(record.path);
    return {
      path: record.path,
      oldPath: record.oldPath,
      status: record.status,
      additions: count?.additions ?? 0,
      deletions: count?.deletions ?? 0,
      binary: count?.binary === true,
    };
  });
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * Parses a unified patch into the side-by-side ready shape. Pure: everything it needs is in
 * the text. One patch can hold several file sections, because a rename is fetched by asking
 * for both of its paths.
 */
export function parsePatchSections(patchText, { maxLines = MAX_PATCH_LINES } = {}) {
  const sections = [];
  let truncated = false;
  let emitted = 0;
  let section = null;
  let hunk = null;
  let oldNumber = 0;
  let newNumber = 0;

  const lines = String(patchText || '').split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      section = { renamed: false, binary: false, hunks: [] };
      sections.push(section);
      hunk = null;
      continue;
    }
    if (!section) continue;
    if (line.startsWith('rename from ') || line.startsWith('rename to ')) {
      section.renamed = true;
      continue;
    }
    if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) {
      section.binary = true;
      hunk = null;
      continue;
    }
    const header = line.match(HUNK_HEADER);
    if (header) {
      oldNumber = Number(header[1]);
      newNumber = Number(header[3]);
      hunk = {
        oldStart: oldNumber,
        oldLines: header[2] === undefined ? 1 : Number(header[2]),
        newStart: newNumber,
        newLines: header[4] === undefined ? 1 : Number(header[4]),
        lines: [],
      };
      section.hunks.push(hunk);
      continue;
    }
    if (!hunk) continue;
    // The no-newline marker annotates the line above it and has no side-by-side row of its own.
    if (line.startsWith('\\')) continue;
    if (emitted >= maxLines) {
      truncated = true;
      continue;
    }
    const marker = line[0] ?? ' ';
    const text = line.length > 0 ? line.slice(1) : '';
    if (marker === '+') {
      hunk.lines.push({ type: 'add', oldNumber: null, newNumber, text });
      newNumber += 1;
    } else if (marker === '-') {
      hunk.lines.push({ type: 'del', oldNumber, newNumber: null, text });
      oldNumber += 1;
    } else if (marker === ' ' || line.length === 0) {
      hunk.lines.push({ type: 'context', oldNumber, newNumber, text });
      oldNumber += 1;
      newNumber += 1;
    } else {
      // Anything else inside a hunk is a header the patch format does not let us reach.
      continue;
    }
    emitted += 1;
  }

  return { sections, truncated };
}

async function readTreeDiff(root, base, target, { run = execFile } = {}) {
  const [nameStatus, numstat] = await Promise.all([
    runGit(root, ['diff-tree', '-r', '-M', '--no-color', '--name-status', '-z', base, target], {
      run,
      maxBuffer: SUMMARY_MAX_BUFFER,
    }),
    runGit(root, ['diff-tree', '-r', '-M', '--no-color', '--numstat', '-z', base, target], {
      run,
      maxBuffer: SUMMARY_MAX_BUFFER,
    }),
  ]);
  return mergeDiffRecords(parseNameStatus(nameStatus.stdout || ''), parseNumstat(numstat.stdout || ''));
}

function cachedTreeDiff(root, base, target, { run = execFile, clock = Date.now } = {}) {
  const key = `${root} ${base} ${target}`;
  return cachedPromise(summaryCache, key, SUMMARY_CACHE_TTL_MS, clock(), () => readTreeDiff(root, base, target, { run }));
}

function unavailableSummary(reason, { live = false, capturedAt = null, endedAt = null } = {}) {
  return {
    available: false,
    reason,
    live,
    capturedAt,
    endedAt,
    sharedTree: false,
    totalAdditions: 0,
    totalDeletions: 0,
    truncated: false,
    signature: `unavailable:${reason}`,
    files: [],
  };
}

function countSharedTreeTasks(database, task, state, endedAt) {
  try {
    return database.countOverlappingRepoTasks(task.repo_path, {
      excludeTaskId: task.id,
      from: state.baseline.at,
      to: endedAt,
    }) > 0;
  } catch {
    return false;
  }
}

// Resolves the tree pair the preview compares. Terminal tasks freeze against their stored end
// tree; a task that never recorded one, because the backend restarted before the transition,
// records it here on first view.
async function resolveDiffTarget({ database, task, run = execFile, clock = Date.now, now = isoNow }) {
  const state = normalizeDiffState(task.diffState);
  if (!state || (!state.baseline && !state.error)) {
    return { reason: 'captured-before-diff-support' };
  }
  if (state.error) return { reason: state.error.code, state };
  if (!state.baseline) return { reason: 'captured-before-diff-support', state };

  const live = LIVE_TASK_STATUSES.has(task.status);
  let root = state.root;
  try {
    if (!root) root = await resolveRepositoryRoot(task.repo_path, { run });
  } catch (error) {
    return { reason: error?.code === 'git-unavailable' ? 'git-unavailable' : 'diff-failed', state };
  }

  if (live) {
    try {
      const tree = await currentWorkingTree(root, { run, clock });
      return { state, root, base: state.baseline.tree, target: tree, live: true, endedAt: null };
    } catch {
      return { reason: 'diff-failed', state, live: true };
    }
  }

  let end = state.end;
  if (!end) {
    await maybeCaptureTaskDiffEnd({ database, task, run, now, requireTerminal: false });
    end = normalizeDiffState(database.getTask(task.id)?.diffState)?.end || null;
  }
  if (!end) return { reason: 'diff-failed', state };
  return { state, root, base: state.baseline.tree, target: end.tree, live: false, endedAt: end.at };
}

export async function buildTaskDiffSummary({ database, task, run = execFile, clock = Date.now, now = isoNow } = {}) {
  const resolved = await resolveDiffTarget({ database, task, run, clock, now });
  if (resolved.reason) {
    return unavailableSummary(resolved.reason, {
      live: resolved.live === true,
      capturedAt: resolved.state?.baseline?.at || null,
      endedAt: resolved.state?.end?.at || null,
    });
  }

  let files;
  try {
    files = await cachedTreeDiff(resolved.root, resolved.base, resolved.target, { run, clock });
  } catch {
    return unavailableSummary('diff-failed', {
      live: resolved.live,
      capturedAt: resolved.state.baseline.at,
      endedAt: resolved.endedAt,
    });
  }

  const totalAdditions = files.reduce((total, file) => total + file.additions, 0);
  const totalDeletions = files.reduce((total, file) => total + file.deletions, 0);
  const truncated = files.length > MAX_SUMMARY_FILES;

  return {
    available: true,
    reason: null,
    live: resolved.live,
    capturedAt: resolved.state.baseline.at,
    endedAt: resolved.endedAt,
    sharedTree: countSharedTreeTasks(database, task, resolved.state, resolved.endedAt),
    totalAdditions,
    totalDeletions,
    truncated,
    // Content addressed and free of timestamps, so a poll that finds nothing new returns a
    // byte identical signature and the client can skip the render.
    signature: `${resolved.base}:${resolved.target}:${files.length}${truncated ? ':t' : ''}`,
    files: files.slice(0, MAX_SUMMARY_FILES),
  };
}

function badRequest(message) {
  return Object.assign(new Error(message), { statusCode: 400 });
}

function notFound(message) {
  return Object.assign(new Error(message), { statusCode: 404 });
}

export function validateDiffPath(value) {
  const path = typeof value === 'string' ? value : '';
  if (!path) throw badRequest('A file path is required.');
  if (path.length > MAX_DIFF_PATH_LENGTH) throw badRequest('That file path is too long.');
  if (path.includes('\0')) throw badRequest('That file path is not valid.');
  if (path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path)) {
    throw badRequest('A file path must be relative to the project.');
  }
  if (path.split('/').includes('..')) throw badRequest('That file path is not valid.');
  return path;
}

export async function buildTaskDiffFile({ database, task, path, run = execFile, clock = Date.now, now = isoNow } = {}) {
  const requestedPath = validateDiffPath(path);
  const resolved = await resolveDiffTarget({ database, task, run, clock, now });
  if (resolved.reason) throw notFound('That file is not part of this diff.');

  let files;
  try {
    files = await cachedTreeDiff(resolved.root, resolved.base, resolved.target, { run, clock });
  } catch {
    throw notFound('That file is not part of this diff.');
  }
  // Membership is checked against the whole diff, not the truncated summary page, so file 501
  // is still viewable.
  const entry = files.find((file) => file.path === requestedPath);
  if (!entry) throw notFound('That file is not part of this diff.');

  const payload = {
    path: entry.path,
    oldPath: entry.oldPath,
    status: entry.status,
    binary: entry.binary,
    tooLarge: false,
    truncated: false,
    signature: `${resolved.base}:${resolved.target}:${entry.path}`,
    hunks: [],
  };
  if (entry.binary) return payload;

  // ':(literal)' disables pathspec magic and globbing, so a path that arrived over HTTP is
  // matched as the exact bytes it is. --no-ext-diff and --no-textconv keep a repository
  // configured diff driver from being executed by a preview request.
  const pathspecs = [`:(literal)${entry.path}`];
  if (entry.oldPath) pathspecs.push(`:(literal)${entry.oldPath}`);

  let stdout = '';
  try {
    ({ stdout = '' } = await runGit(resolved.root, [
      'diff-tree', '-r', '-M', '-p',
      '--unified=3', '--no-color', '--no-ext-diff', '--no-textconv',
      resolved.base, resolved.target, '--', ...pathspecs,
    ], { run, maxBuffer: FILE_MAX_BUFFER }));
  } catch (error) {
    if (isBufferOverflow(error)) {
      return { ...payload, tooLarge: true, truncated: true };
    }
    throw notFound('That file could not be read from this diff.');
  }

  const patch = String(stdout);
  if (patch.length > MAX_PATCH_BYTES) {
    return { ...payload, tooLarge: true, truncated: true };
  }

  const { sections, truncated } = parsePatchSections(patch);
  // Only a rename asks for two paths, and a second section can only appear when the old path
  // also exists on its own in the new tree. Pick the renamed section so the two never merge.
  const section = entry.oldPath
    ? sections.find((candidate) => candidate.renamed) || sections[0] || null
    : sections[0] || null;

  return {
    ...payload,
    binary: section?.binary === true,
    truncated,
    hunks: section?.binary === true ? [] : section?.hunks || [],
  };
}
