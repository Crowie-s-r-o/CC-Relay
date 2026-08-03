import { execFile } from 'node:child_process';
import { homedir as osHomedir } from 'node:os';
import { join } from 'node:path';

const DEFAULT_PROBE_TIMEOUT_MS = 3_000;
const FALLBACK_COMMAND = 'claude';

// Claude CLI 2.1.218 supports `agents --json`; 2.1.84 does not. Discovery and
// execution must therefore pin the newest binary instead of trusting whatever
// bare `claude` PATH resolution returns, which varies with how CC Relay was
// launched (Finder or dock versus a terminal).
const KNOWN_GOOD_VERSION = [2, 1, 218];

// Absolute locations that commonly hold a claude binary on macOS and Linux even
// when they are absent from the launching process PATH.
const WELL_KNOWN_POSIX = [
  '~/.local/bin/claude',
  '/opt/homebrew/bin/claude',
  '/usr/local/bin/claude',
  '/usr/bin/claude',
];

function defaultExec(command, args, options) {
  return new Promise((resolve, reject) => {
    execFile(command, args, options, (error, stdout, stderr) => {
      if (error) {
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve(stdout);
    });
  });
}

function binaryNames(platform) {
  // On Windows the launcher is typically a shim (`claude.cmd`) or an executable,
  // so probe the common variants. POSIX installs use the bare name.
  return platform === 'win32' ? ['claude.cmd', 'claude.exe', 'claude'] : ['claude'];
}

function expandHome(path, homedir) {
  if (path === '~') return homedir;
  if (path.startsWith('~/')) return join(homedir, path.slice(2));
  return path;
}

// Enumerate every candidate path worth probing, in priority order: each PATH
// entry (in PATH order) followed by the well-known absolute locations. Paths are
// deduplicated so a location that appears in both is probed once, keeping the
// earliest position. Exported for direct unit testing of enumeration order.
export function enumerateCandidates({ env = process.env, platform = process.platform, homedir = osHomedir() } = {}) {
  const names = binaryNames(platform);
  const seen = new Set();
  const candidates = [];
  const add = (path) => {
    if (!path || seen.has(path)) return;
    seen.add(path);
    candidates.push(path);
  };
  const pathValue = env?.PATH || env?.Path || '';
  const delimiter = platform === 'win32' ? ';' : ':';
  for (const entry of pathValue.split(delimiter)) {
    if (!entry) continue;
    for (const name of names) {
      add(join(entry, name));
    }
  }
  if (platform !== 'win32') {
    for (const location of WELL_KNOWN_POSIX) {
      add(expandHome(location, homedir));
    }
  }
  return candidates;
}

// Parse the leading semantic version from `claude --version` output such as
// "2.1.218 (Claude Code)". Returns null when no version is present.
export function parseClaudeVersion(output) {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(String(output || ''));
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

// Numeric component comparison. Lexical comparison is wrong here because
// "2.1.84" sorts above "2.1.218" as text while 218 is the newer patch.
export function compareVersions(left, right) {
  const a = left || [0, 0, 0];
  const b = right || [0, 0, 0];
  for (let index = 0; index < 3; index += 1) {
    const difference = (a[index] || 0) - (b[index] || 0);
    if (difference !== 0) return difference > 0 ? 1 : -1;
  }
  return 0;
}

// Choose the highest-version probe. Ties keep the earlier enumeration position,
// which favors PATH entries over well-known fallbacks.
export function pickBest(probes) {
  let best = null;
  for (const probe of probes) {
    if (!probe || !probe.version) continue;
    if (!best || compareVersions(probe.version, best.version) > 0) {
      best = probe;
    }
  }
  return best;
}

function versionLabel(version) {
  return version ? version.join('.') : null;
}

export class ClaudeBinaryResolver {
  constructor({
    exec = defaultExec,
    platform = process.platform,
    env = process.env,
    homedir = osHomedir(),
    diagnostic = () => {},
    probeTimeoutMs = DEFAULT_PROBE_TIMEOUT_MS,
  } = {}) {
    this.exec = exec;
    this.platform = platform;
    this.env = env;
    this.homedir = homedir;
    this.diagnostic = diagnostic;
    this.probeTimeoutMs = probeTimeoutMs;
    this.cached = null;
    this.pending = null;
  }

  // Returns the resolved absolute claude path (cached for the process lifetime).
  // Pass { refresh: true } to discard the cache and re-probe, which the session
  // registry uses when an invocation fails with an unknown-option error.
  async resolve({ refresh = false } = {}) {
    if (refresh) {
      this.cached = null;
    }
    if (this.cached) {
      return this.cached;
    }
    if (this.pending) {
      return this.pending;
    }
    this.pending = this.discover().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  async probe(path) {
    try {
      const stdout = await this.exec(path, ['--version'], {
        encoding: 'utf8',
        timeout: this.probeTimeoutMs,
      });
      const version = parseClaudeVersion(stdout);
      if (!version) {
        return { path, version: null, reason: 'unrecognized-version' };
      }
      return { path, version };
    } catch (error) {
      return { path, version: null, reason: error?.code || error?.message || 'probe-failed' };
    }
  }

  async discover() {
    try {
      const candidates = enumerateCandidates({
        env: this.env,
        platform: this.platform,
        homedir: this.homedir,
      });
      const probes = await Promise.all(candidates.map((path) => this.probe(path)));
      const best = pickBest(probes);
      if (!best) {
        this.cached = FALLBACK_COMMAND;
        this.diagnostic('claude.binary.fallback', {
          command: FALLBACK_COMMAND,
          candidates: probes.map((probe) => ({ path: probe.path, reason: probe.reason })),
        });
        return this.cached;
      }
      this.cached = best.path;
      const rejected = probes
        .filter((probe) => probe.path !== best.path)
        .map((probe) => ({
          path: probe.path,
          version: versionLabel(probe.version),
          reason: probe.version ? 'lower-version' : (probe.reason || 'probe-failed'),
        }));
      this.diagnostic('claude.binary.resolved', {
        command: best.path,
        version: versionLabel(best.version),
        supportsAgentsJson: compareVersions(best.version, KNOWN_GOOD_VERSION) >= 0,
        rejected,
      });
      return this.cached;
    } catch (error) {
      this.cached = FALLBACK_COMMAND;
      this.diagnostic('claude.binary.fallback', {
        command: FALLBACK_COMMAND,
        error: error?.message || 'resolution-failed',
      });
      return this.cached;
    }
  }
}

// Detects the exact failure the outdated 2.1.84 binary produces for
// `agents --json` so the registry can re-resolve to a newer binary and retry.
export function isUnknownOptionError(error) {
  const haystack = `${error?.stderr || ''}\n${error?.message || ''}`;
  return /unknown option/i.test(haystack);
}
