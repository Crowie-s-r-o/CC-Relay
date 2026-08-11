import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { providerCommandInvocation, resolveExecutableOnPath } from './claude-binary.mjs';

const execFile = promisify(execFileCallback);
const DEFAULT_TIMEOUT_MS = 8_000;

function outputText(value) {
  if (Buffer.isBuffer(value)) return value.toString('utf8');
  return typeof value === 'string' ? value : '';
}

function executableMissing(error) {
  const output = [
    error?.code || '',
    outputText(error?.stdout),
    outputText(error?.stderr),
    error?.message || '',
  ].join('\n');
  return error?.code === 'ENOENT'
    || /(?:spawn|execFile).+ENOENT|command not found|not recognized as an internal or external command/i.test(output);
}

function missing(error) {
  return {
    available: false,
    authenticated: false,
    version: null,
    error: error?.message || 'Codex CLI is unavailable.',
    reason: executableMissing(error) ? 'not_installed' : 'probe_failed',
    pending: false,
  };
}

function signedOut(error) {
  const output = [
    outputText(error?.stdout),
    outputText(error?.stderr),
    error?.message || '',
  ].join('\n');
  return /not logged in|not authenticated|login required|please.+login/i.test(output);
}

/**
 * Probe installation and authentication separately.
 *
 * A failing `codex login status` does not mean the executable is missing. Keeping
 * `available: true` after a successful version probe lets the renderer enable Codex
 * based on installation while still showing a distinct authentication problem.
 */
export async function readCodexRuntimeStatus({
  run = execFile,
  command = 'codex',
  timeoutMs = DEFAULT_TIMEOUT_MS,
  platform = process.platform,
  resolveExecutable = resolveExecutableOnPath,
} = {}) {
  const options = { encoding: 'utf8', timeout: timeoutMs };
  // On Windows the bare name matches only `codex.cmd`: PATH search never appends that
  // extension, and the shim cannot be executed directly, so an installed Codex was reported
  // as missing and every readiness indicator stayed dark.
  const resolved = resolveExecutable(command, { platform });
  const invoke = (args) => {
    const invocation = providerCommandInvocation(resolved, args, { platform });
    return run(invocation.command, invocation.args, { ...options, ...invocation.options });
  };
  let version;
  try {
    const result = await invoke(['--version']);
    version = outputText(result?.stdout ?? result).trim();
  } catch (error) {
    return missing(error);
  }

  try {
    await invoke(['login', 'status']);
    return {
      available: true,
      authenticated: true,
      version,
      reason: null,
      pending: false,
    };
  } catch (error) {
    return {
      available: true,
      authenticated: false,
      version,
      error: error?.message || 'Codex authentication status could not be read.',
      reason: signedOut(error) ? 'signed_out' : 'auth_check_failed',
      pending: false,
    };
  }
}
