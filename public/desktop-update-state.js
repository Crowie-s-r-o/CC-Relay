export const DESKTOP_RELEASES_URL = 'https://github.com/Crowie-s-r-o/CC-Relay/releases';

const VISIBLE_STATES = new Set(['available', 'downloading', 'downloaded', 'error']);

function cleanVersion(value) {
  const version = String(value || '').trim().replace(/^v/i, '');
  return /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(version)
    ? version
    : null;
}

function releaseUrl(value) {
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

export function desktopUpdatePresentation(update) {
  const status = String(update?.status || 'unsupported');
  const version = cleanVersion(update?.latestVersion);
  if (update?.supported !== true || !version || !VISIBLE_STATES.has(status)) {
    return {
      hidden: true,
      state: 'hidden',
      label: '',
      title: '',
      href: `${DESKTOP_RELEASES_URL}/latest`,
    };
  }

  const percent = Number(update?.downloadPercent);
  if (status === 'downloading') {
    const progress = Number.isFinite(percent) ? ` ${Math.max(0, Math.min(100, Math.round(percent)))}%` : '';
    return {
      hidden: false,
      state: status,
      label: `Downloading v${version}${progress}`,
      title: `CC Relay v${version} is downloading. Open its GitHub release.`,
      href: releaseUrl(update.releaseUrl),
    };
  }
  if (status === 'downloaded') {
    return {
      hidden: false,
      state: status,
      label: `v${version} ready`,
      title: `CC Relay v${version} is ready to install. Open its GitHub release.`,
      href: releaseUrl(update.releaseUrl),
    };
  }
  return {
    hidden: false,
    state: status,
    label: `Update v${version}`,
    title: status === 'error'
      ? `CC Relay v${version} is available, but the automatic download failed. Open its GitHub release.`
      : `CC Relay v${version} is available. Open its GitHub release.`,
    href: releaseUrl(update.releaseUrl),
  };
}
