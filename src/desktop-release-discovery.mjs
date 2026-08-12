import { DESKTOP_RELEASES_URL } from './desktop-update-status.mjs';

export const DESKTOP_RELEASE_API_URL = 'https://api.github.com/repos/Crowie-s-r-o/CC-Relay/releases/latest';
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

function releaseVersion(value) {
  const version = String(value || '').trim().replace(/^v/i, '');
  return /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(version)
    ? version
    : null;
}

function versionParts(value) {
  const version = releaseVersion(value);
  return version ? version.split('.').map(Number) : null;
}

export function isNewerDesktopRelease(candidate, current) {
  const candidateParts = versionParts(candidate);
  const currentParts = versionParts(current);
  if (!candidateParts || !currentParts) return false;
  for (let index = 0; index < candidateParts.length; index += 1) {
    if (candidateParts[index] !== currentParts[index]) {
      return candidateParts[index] > currentParts[index];
    }
  }
  return false;
}

export function createGitHubReleaseChecker(options = {}) {
  const request = options.fetchImpl || globalThis.fetch;
  const apiUrl = String(options.apiUrl || DESKTOP_RELEASE_API_URL);
  const timeoutMs = Number.isFinite(options.timeoutMs)
    ? Math.max(1, options.timeoutMs)
    : DEFAULT_REQUEST_TIMEOUT_MS;

  return async function checkLatestRelease() {
    if (typeof request !== 'function') {
      throw new TypeError('Desktop release discovery requires fetch.');
    }
    const response = await request(apiUrl, {
      headers: {
        accept: 'application/vnd.github+json',
        'user-agent': 'CC-Relay-desktop-release-check',
        'x-github-api-version': '2022-11-28',
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response?.ok) {
      throw new Error(`GitHub latest release request failed with HTTP ${response?.status || 'unknown'}.`);
    }
    const release = await response.json();
    const version = releaseVersion(release?.tag_name);
    if (!version || release?.draft === true || release?.prerelease === true) {
      throw new Error('GitHub latest release metadata is not a stable CC Relay version.');
    }
    return {
      version,
      releaseUrl: `${DESKTOP_RELEASES_URL}/tag/v${version}`,
    };
  };
}
