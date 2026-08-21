import { normalizeDesktopReleaseNotes } from './desktop-release-notes.mjs';

export const DESKTOP_RELEASES_URL = 'https://github.com/Crowie-s-r-o/CC-Relay/releases';

const DESKTOP_UPDATE_STATUSES = new Set([
  'unsupported',
  'checking',
  'current',
  'available',
  'downloading',
  'downloaded',
  'installing',
  'error',
]);

function cleanVersion(value) {
  const version = String(value || '').trim().replace(/^v/i, '');
  return /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(version)
    ? version
    : null;
}

function trustedReleaseUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.origin !== 'https://github.com') return `${DESKTOP_RELEASES_URL}/latest`;
    if (!url.pathname.startsWith('/Crowie-s-r-o/CC-Relay/releases/')) {
      return `${DESKTOP_RELEASES_URL}/latest`;
    }
    return url.href;
  } catch {
    return `${DESKTOP_RELEASES_URL}/latest`;
  }
}

export function normalizeDesktopUpdateState(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const rawPercent = source.downloadPercent;
  const percent = rawPercent === null || rawPercent === undefined || rawPercent === ''
    ? Number.NaN
    : Number(rawPercent);
  return {
    supported: source.supported === true,
    automaticUpdate: source.automaticUpdate === true,
    status: DESKTOP_UPDATE_STATUSES.has(source.status) ? source.status : 'error',
    currentVersion: cleanVersion(source.currentVersion),
    latestVersion: cleanVersion(source.latestVersion),
    releaseUrl: trustedReleaseUrl(source.releaseUrl),
    releaseNotes: normalizeDesktopReleaseNotes(source.releaseNotes, {
      version: source.latestVersion,
    }),
    downloadPercent: Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : null,
  };
}
