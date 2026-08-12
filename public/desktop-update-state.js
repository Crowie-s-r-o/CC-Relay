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
  const currentVersion = cleanVersion(update?.currentVersion);
  const version = cleanVersion(update?.latestVersion);
  if (update?.supported !== true || !version || !VISIBLE_STATES.has(status)) {
    return {
      hidden: true,
      state: 'hidden',
      label: '',
      title: '',
      href: `${DESKTOP_RELEASES_URL}/latest`,
      currentVersion,
      latestVersion: null,
      statusLabel: '',
      modalTitle: '',
      modalMessage: '',
      releaseLabel: 'View latest release',
      automaticUpdate: false,
      progress: null,
    };
  }

  const rawPercent = update?.downloadPercent;
  const percent = rawPercent === null || rawPercent === undefined || rawPercent === ''
    ? Number.NaN
    : Number(rawPercent);
  const boundedProgress = Number.isFinite(percent)
    ? Math.max(0, Math.min(100, Math.round(percent)))
    : null;
  const common = {
    hidden: false,
    state: status,
    href: releaseUrl(update.releaseUrl),
    currentVersion,
    latestVersion: version,
    releaseLabel: update?.automaticUpdate === true
      ? `View v${version} release`
      : `Download v${version}`,
    automaticUpdate: update?.automaticUpdate === true,
    progress: status === 'downloaded' ? 100 : boundedProgress,
  };
  if (status === 'downloading') {
    const progress = boundedProgress === null ? '' : ` ${boundedProgress}%`;
    return {
      ...common,
      label: `Downloading v${version}${progress}`,
      title: `CC Relay v${version} is downloading. Open update details.`,
      statusLabel: 'Downloading update',
      modalTitle: 'The next Relay is on its way',
      modalMessage: `CC Relay v${version} is downloading in the background. You can keep working while it finishes.`,
    };
  }
  if (status === 'downloaded') {
    return {
      ...common,
      label: `v${version} ready`,
      title: `CC Relay v${version} is ready to install. Open update details.`,
      statusLabel: 'Ready to install',
      modalTitle: 'Ready when you are',
      modalMessage: `CC Relay v${version} has finished downloading. Use the desktop restart prompt when you are ready to install it.`,
    };
  }
  return {
    ...common,
    label: `Update v${version}`,
    title: status === 'error'
      ? `CC Relay v${version} is available, but the automatic download failed. Open update details.`
      : `CC Relay v${version} is available. Open update details.`,
    statusLabel: status === 'error' ? 'Update needs attention' : 'Update available',
    modalTitle: status === 'error' ? 'The update needs a hand' : 'A new Relay is ready',
    modalMessage: status === 'error'
      ? `Automatic updating could not continue for CC Relay v${version}. Open the official release to review or install it manually.`
      : update?.automaticUpdate === true
        ? `CC Relay v${version} is available. The desktop prompt can download it, and you can review the release before deciding.`
        : `CC Relay v${version} is available. Open the official release to download and install it manually.`,
  };
}
