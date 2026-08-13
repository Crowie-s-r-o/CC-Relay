import { isNewerDesktopRelease } from './desktop-release-discovery.mjs';

const DEFAULT_DELAY = 5_000;
export const DESKTOP_UPDATE_CHECK_INTERVAL = 5 * 60 * 1_000;

function noop() {}

function safeLogger(logger, level, message, error) {
  const method = logger?.[level];
  if (typeof method !== 'function') return;
  try {
    method.call(logger, message, error);
  } catch {
    // Logging must never interfere with updater lifecycle handling.
  }
}

function isDestroyedWindow(window) {
  if (!window) return true;
  try {
    return typeof window.isDestroyed === 'function' && window.isDestroyed();
  } catch {
    return true;
  }
}

function resolveEligibility(options) {
  if (typeof options.isEligible === 'function') {
    return Boolean(options.isEligible());
  }
  if (typeof options.isEligible === 'boolean') return options.isEligible;
  if (typeof options.eligible === 'function') return Boolean(options.eligible());
  if (typeof options.eligible === 'boolean') return options.eligible;

  const packaged = options.packaged ?? options.isPackaged;
  const platform = options.platform;
  const portable = options.portable ?? options.isPortable;
  if (packaged === undefined && platform === undefined && portable === undefined) {
    return true;
  }
  if (!packaged) return false;
  return platform === 'darwin' || platform === 'win32';
}

function resolveAutomaticUpdateEligibility(options) {
  if (typeof options.isAutomaticUpdateEligible === 'function') {
    return Boolean(options.isAutomaticUpdateEligible());
  }
  if (typeof options.isAutomaticUpdateEligible === 'boolean') {
    return options.isAutomaticUpdateEligible;
  }
  if (typeof options.automaticUpdate === 'boolean') return options.automaticUpdate;

  const packaged = options.packaged ?? options.isPackaged;
  const platform = options.platform;
  const portable = options.portable ?? options.isPortable;
  if (packaged === undefined && platform === undefined && portable === undefined) {
    return true;
  }
  if (!packaged) return false;
  return platform === 'darwin' || (platform === 'win32' && portable !== true);
}

function currentVersion(options) {
  if (typeof options.getCurrentVersion === 'function') {
    return String(options.getCurrentVersion() || 'unknown');
  }
  return String(options.currentVersion || 'unknown');
}

function availableVersion(info) {
  return String(info?.version || info?.releaseName || info?.tag || 'new version');
}

function eventOn(updater, event, listener) {
  if (typeof updater?.on !== 'function') {
    throw new TypeError('Desktop updater must expose an on(event, listener) method.');
  }
  updater.on(event, listener);
}

function dialogOptions(title, message, buttons) {
  return {
    type: 'info',
    title,
    message,
    buttons,
    defaultId: 0,
    cancelId: buttons.length - 1,
    noLink: true,
  };
}

function dialogWindow(getMainWindow) {
  try {
    const window = getMainWindow?.();
    return isDestroyedWindow(window) ? null : window;
  } catch {
    return null;
  }
}

function showMessage(dialog, window, options) {
  if (!dialog || typeof dialog.showMessageBox !== 'function' || !window) {
    return Promise.resolve(null);
  }
  try {
    return Promise.resolve(dialog.showMessageBox(window, options));
  } catch (error) {
    return Promise.reject(error);
  }
}

function selectedDialogButton(result) {
  return typeof result === 'number' ? result : result?.response;
}

function stateReleaseUrl(options, info) {
  try {
    if (typeof options.releaseUrlForVersion === 'function') {
      return String(options.releaseUrlForVersion(availableVersion(info)) || '');
    }
    return String(options.releasesUrl || '');
  } catch {
    return String(options.releasesUrl || '');
  }
}

function notifyState(listener, state) {
  if (typeof listener !== 'function') return;
  try {
    listener({ ...state });
  } catch {
    // Rendering update state must never interfere with the updater lifecycle.
  }
}

/**
 * Coordinates the safe desktop update lifecycle.
 *
 * This module intentionally has no Electron imports. The caller injects the
 * electron-updater instance, dialog API, BrowserWindow lookup, and graceful
 * shutdown/restart callback.
 */
export function createDesktopUpdater(options = {}) {
  const updater = options.updater;
  const dialog = options.dialog;
  const getMainWindow = options.getMainWindow || (() => null);
  const restartAndInstall = options.restartAndInstall || noop;
  const logger = options.logger || console;
  const schedule = options.timer || options.setTimeout || globalThis.setTimeout;
  const repeat = options.intervalTimer || options.setInterval || globalThis.setInterval;
  const delay = Number.isFinite(options.delay) ? Math.max(0, options.delay) : DEFAULT_DELAY;
  const interval = Number.isFinite(options.interval)
    ? Math.min(DESKTOP_UPDATE_CHECK_INTERVAL, Math.max(1, options.interval))
    : DESKTOP_UPDATE_CHECK_INTERVAL;
  const onStateChange = options.onStateChange;
  const checkLatestRelease = options.checkLatestRelease;

  let started = false;
  let automaticUpdate = false;
  let checkInFlight = false;
  let downloadInFlight = false;
  let downloadedPromptInFlight = false;
  let state = {
    supported: false,
    automaticUpdate: false,
    status: 'unsupported',
    currentVersion: currentVersion(options),
    latestVersion: null,
    releaseUrl: String(options.releasesUrl || ''),
    downloadPercent: null,
  };

  function publish(status, changes = {}) {
    state = { ...state, ...changes, status };
    notifyState(onStateChange, state);
  }

  function publishUpdate(status, info, changes = {}) {
    publish(status, {
      latestVersion: availableVersion(info),
      releaseUrl: stateReleaseUrl(options, info),
      ...changes,
    });
  }

  function configureUpdater() {
    if (!updater) return;
    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = true;
  }

  async function checkForUpdates() {
    if (
      checkInFlight
      || downloadInFlight
      || state.status === 'downloaded'
      || state.status === 'installing'
    ) return;
    checkInFlight = true;
    if (!state.latestVersion) publish('checking', { downloadPercent: null });
    safeLogger(logger, 'info', 'Checking for desktop updates.');
    try {
      if (automaticUpdate) {
        await updater.checkForUpdates();
      } else {
        const info = await checkLatestRelease();
        if (isNewerDesktopRelease(availableVersion(info), currentVersion(options))) {
          publishUpdate('available', info, { downloadPercent: null });
        } else {
          publish('current', {
            latestVersion: null,
            releaseUrl: String(options.releasesUrl || ''),
            downloadPercent: null,
          });
        }
      }
    } catch (error) {
      publish(!automaticUpdate && state.latestVersion ? 'available' : 'error');
      safeLogger(logger, 'error', 'Desktop update check failed.', error);
    } finally {
      checkInFlight = false;
    }
  }

  function handleAvailable(info) {
    if (state.status === 'downloaded' || state.status === 'installing') return;
    downloadInFlight = true;
    publishUpdate('downloading', info, { downloadPercent: null });
    safeLogger(logger, 'info', `Downloading CC Relay ${availableVersion(info)} automatically.`);
  }

  async function handleDownloaded(info) {
    if (downloadedPromptInFlight) return;
    downloadInFlight = false;
    publishUpdate('downloaded', info, { downloadPercent: 100 });
    const window = dialogWindow(getMainWindow);
    if (!window) {
      safeLogger(logger, 'info', 'Desktop update downloaded, but no live window can show the prompt.');
      return;
    }
    downloadedPromptInFlight = true;
    try {
      const response = await showMessage(
        dialog,
        window,
        dialogOptions(
          'CC Relay update ready',
          `CC Relay ${availableVersion(info)} is ready. Restart now, or it will install automatically when you quit CC Relay.`,
          ['Restart and install', 'Install on quit'],
        ),
      );
      if (selectedDialogButton(response) !== 0) return;
      publishUpdate('installing', info, { downloadPercent: 100 });
      await restartAndInstall();
    } catch (error) {
      publishUpdate('downloaded', info, { downloadPercent: 100 });
      safeLogger(logger, 'error', 'Desktop update installation handoff failed.', error);
    } finally {
      downloadedPromptInFlight = false;
    }
  }

  function start() {
    if (started) return false;
    started = true;
    const eligible = resolveEligibility(options);
    automaticUpdate = eligible && Boolean(updater) && resolveAutomaticUpdateEligibility(options);
    const manualDiscovery = eligible && typeof checkLatestRelease === 'function';
    if (!eligible || (!automaticUpdate && !manualDiscovery)) {
      publish('unsupported', { supported: false, automaticUpdate: false });
      return false;
    }

    publish('checking', { supported: true, automaticUpdate });
    if (automaticUpdate) {
      configureUpdater();
      eventOn(updater, 'update-available', handleAvailable);
      eventOn(updater, 'update-not-available', () => {
        publish('current', {
          latestVersion: null,
          releaseUrl: String(options.releasesUrl || ''),
          downloadPercent: null,
        });
      });
      eventOn(updater, 'download-progress', (progress) => {
        downloadInFlight = true;
        publish('downloading', {
          downloadPercent: Number.isFinite(progress?.percent) ? progress.percent : null,
        });
      });
      eventOn(updater, 'update-downloaded', handleDownloaded);
      eventOn(updater, 'error', (error) => {
        downloadInFlight = false;
        publish('error');
        safeLogger(logger, 'error', 'Desktop updater reported an error.', error);
      });
    }

    schedule(() => {
      void checkForUpdates();
    }, delay);
    const recurringTimer = repeat(() => {
      void checkForUpdates();
    }, interval);
    recurringTimer?.unref?.();
    return true;
  }

  return {
    start,
    status: () => ({ ...state }),
  };
}

export default createDesktopUpdater;
