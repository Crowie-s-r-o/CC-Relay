const DEFAULT_DELAY = 5_000;

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
  if (platform === 'darwin') return true;
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
  const delay = Number.isFinite(options.delay) ? Math.max(0, options.delay) : DEFAULT_DELAY;

  let started = false;
  let checkInFlight = false;
  let downloadInFlight = false;
  let availablePromptInFlight = false;
  let downloadedPromptInFlight = false;

  function configureUpdater() {
    if (!updater) return;
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
  }

  async function checkForUpdates() {
    if (checkInFlight) return;
    checkInFlight = true;
    safeLogger(logger, 'info', 'Checking for desktop updates.');
    try {
      await updater.checkForUpdates();
    } catch (error) {
      safeLogger(logger, 'error', 'Desktop update check failed.', error);
    } finally {
      checkInFlight = false;
    }
  }

  async function handleAvailable(info) {
    if (availablePromptInFlight || downloadInFlight) return;
    const window = dialogWindow(getMainWindow);
    if (!window) {
      safeLogger(logger, 'info', 'Desktop update available, but no live window can show the prompt.');
      return;
    }
    availablePromptInFlight = true;
    try {
      const response = await showMessage(
        dialog,
        window,
        dialogOptions(
          'Relay update available',
          `Relay ${availableVersion(info)} is available. You are running ${currentVersion(options)}.`,
          ['Download', 'Later'],
        ),
      );
      if (selectedDialogButton(response) !== 0) return;
      if (downloadInFlight) return;
      downloadInFlight = true;
      safeLogger(logger, 'info', `Downloading Relay ${availableVersion(info)}.`);
      try {
        await updater.downloadUpdate();
      } catch (error) {
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
          'Relay update ready',
          `Relay ${availableVersion(info)} has been downloaded and is ready to install.`,
          ['Restart and install', 'Later'],
        ),
      );
      if (selectedDialogButton(response) !== 0) return;
      await restartAndInstall();
    } catch (error) {
      safeLogger(logger, 'error', 'Desktop update installation handoff failed.', error);
    } finally {
      downloadedPromptInFlight = false;
    }
  }

  function start() {
    if (started) return false;
    started = true;
    if (!updater || !resolveEligibility(options)) return false;

    configureUpdater();
    eventOn(updater, 'update-available', handleAvailable);
    eventOn(updater, 'update-downloaded', handleDownloaded);
    eventOn(updater, 'error', (error) => {
      safeLogger(logger, 'error', 'Desktop updater reported an error.', error);
    });

    schedule(() => {
      void checkForUpdates();
    }, delay);
    return true;
  }

  return { start };
}

export default createDesktopUpdater;
