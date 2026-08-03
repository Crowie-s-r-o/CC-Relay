import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export const DEFAULT_RELAY_HOST = '127.0.0.1';
export const DEFAULT_RELAY_PORT = 4768;
export const DEFAULT_RELAY_CODEX_PORT = 4769;
export const RELAY_APPLICATION_DIRECTORY = 'dual-agent-orchestrator';

function portFromArgs(argv, option, fallback) {
  const optionIndex = argv.lastIndexOf(option);
  if (optionIndex === -1) return fallback;

  const rawPort = argv[optionIndex + 1];
  if (!/^\d+$/.test(rawPort || '')) {
    throw new Error(`${option} must be an integer from 0 through 65535.`);
  }

  const port = Number(rawPort);
  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) {
    throw new Error(`${option} must be an integer from 0 through 65535.`);
  }
  return port;
}

export function relayPortFromArgs(argv = process.argv) {
  return portFromArgs(argv, '--relay-port', DEFAULT_RELAY_PORT);
}

export function relayCodexPortFromArgs(argv = process.argv) {
  return portFromArgs(argv, '--relay-codex-port', DEFAULT_RELAY_CODEX_PORT);
}

export function defaultRelayConfigDirectory({
  platform = process.platform,
  homeDirectory = homedir(),
} = {}) {
  if (platform === 'darwin') {
    return join(homeDirectory, 'Library', 'Application Support', RELAY_APPLICATION_DIRECTORY);
  }
  if (platform === 'win32') {
    return join(homeDirectory, 'AppData', 'Roaming', RELAY_APPLICATION_DIRECTORY);
  }
  return join(homeDirectory, '.config', RELAY_APPLICATION_DIRECTORY);
}

export function relayConfigDirectoryFromArgs(argv = process.argv, defaults = {}) {
  const option = '--relay-config-dir';
  const optionIndex = argv.lastIndexOf(option);
  if (optionIndex === -1) return defaultRelayConfigDirectory(defaults);
  const directory = argv[optionIndex + 1]?.trim();
  if (!directory) throw new Error(`${option} requires a directory path.`);
  return resolve(directory);
}

export function relayServerEndpoint(server, host = DEFAULT_RELAY_HOST) {
  const address = server.address();
  if (!address || typeof address === 'string' || !Number.isInteger(address.port)) {
    throw new Error('CC Relay server does not have a TCP listening address.');
  }
  return {
    host,
    port: address.port,
    url: `http://${host}:${address.port}`,
  };
}
