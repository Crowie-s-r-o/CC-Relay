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
  return platform === 'win32' && portable !== true;
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
 * Coordinates the safe, user-driven desktop update lifecycle.
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

  let started = false;
  let checkInFlight = false;
  let downloadInFlight = false;
  let availablePromptInFlight = false;
  let downloadedPromptInFlight = false;
  let lastAvailablePromptVersion = null;
  let state = {
    supported: false,
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
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
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
      await updater.checkForUpdates();
    } catch (error) {
      publish('error');
      safeLogger(logger, 'error', 'Desktop update check failed.', error);
    } finally {
      checkInFlight = false;
    }
  }

  async function handleAvailable(info) {
    if (availablePromptInFlight || downloadInFlight) return;
    publishUpdate('available', info, { downloadPercent: null });
    const version = availableVersion(info);
    if (lastAvailablePromptVersion === version) return;
    const window = dialogWindow(getMainWindow);
    if (!window) {
      safeLogger(logger, 'info', 'Desktop update available, but no live window can show the prompt.');
      return;
    }
    lastAvailablePromptVersion = version;
    availablePromptInFlight = true;
    try {
      const response = await showMessage(
        dialog,
        window,
        dialogOptions(
          'CC Relay update available',
          `CC Relay ${availableVersion(info)} is available. You are running ${currentVersion(options)}.`,
          ['Download', 'Later'],
        ),
      );
      if (selectedDialogButton(response) !== 0) return;
      if (downloadInFlight) return;
      downloadInFlight = true;
      publishUpdate('downloading', info, { downloadPercent: null });
      safeLogger(logger, 'info', `Downloading CC Relay ${availableVersion(info)}.`);
      try {
        await updater.downloadUpdate();
      } catch (error) {
        publishUpdate('error', info);
        safeLogger(logger, 'error', 'Desktop update download failed.', error);
      } finally {
        downloadInFlight = false;
      }
    } catch (error) {
      safeLogger(logger, 'error', 'Desktop update prompt failed.', error);
    } finally {
      availablePromptInFlight = false;
    }
  }

  async function handleDownloaded(info) {
    if (downloadedPromptInFlight) return;
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
          `CC Relay ${availableVersion(info)} has been downloaded and is ready to install.`,
          ['Restart and install', 'Later'],
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
    if (!updater || !resolveEligibility(options)) {
      publish('unsupported', { supported: false });
      return false;
    }

    publish('checking', { supported: true });
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
      publish('downloading', {
        downloadPercent: Number.isFinite(progress?.percent) ? progress.percent : null,
      });
    });
    eventOn(updater, 'update-downloaded', handleDownloaded);
    eventOn(updater, 'error', (error) => {
      publish('error');
      safeLogger(logger, 'error', 'Desktop updater reported an error.', error);
    });

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
