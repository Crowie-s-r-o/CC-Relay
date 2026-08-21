import { isNewerDesktopRelease } from './desktop-release-discovery.mjs';
import { normalizeDesktopReleaseNotes } from './desktop-release-notes.mjs';

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

function isSameDesktopRelease(left, right) {
  return String(left || '').trim().replace(/^v/i, '')
    === String(right || '').trim().replace(/^v/i, '');
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
  let checkPromise = null;
  let downloadPromise = null;
  let downloadedPromptInFlight = false;
  let downloadedVersion = null;
  let downloadedReleaseInfo = null;
  let installIntentAcknowledged = false;
  let state = {
    supported: false,
    automaticUpdate: false,
    status: 'unsupported',
    currentVersion: currentVersion(options),
    latestVersion: null,
    releaseUrl: String(options.releasesUrl || ''),
    releaseNotes: [],
    downloadPercent: null,
  };

  function publish(status, changes = {}) {
    state = { ...state, ...changes, status };
    notifyState(onStateChange, state);
  }

  function publishUpdate(status, info, changes = {}) {
    const version = availableVersion(info);
    const notes = normalizeDesktopReleaseNotes(info?.releaseNotes, { version });
    const sameRelease = isSameDesktopRelease(version, state.latestVersion);
    publish(status, {
      latestVersion: version,
      releaseUrl: stateReleaseUrl(options, info),
      releaseNotes: notes.length || !sameRelease ? notes : state.releaseNotes,
      ...changes,
    });
  }

  function configureUpdater() {
    if (!updater) return;
    updater.logger = logger;
    // The coordinator downloads automatically after comparing the offered release with the
    // already staged one. Leaving this to electron-updater would redownload the same ready
    // release on every supersession check.
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = true;
  }

  function checkForUpdates({ allowDownloaded = false } = {}) {
    if (
      checkInFlight
      || downloadInFlight
      || (state.status === 'downloaded' && !installIntentAcknowledged && !allowDownloaded)
      || state.status === 'installing'
    ) return checkPromise || downloadPromise;
    checkInFlight = true;
    const operation = (async () => {
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
              releaseNotes: [],
              downloadPercent: null,
            });
          }
        }
      } catch (error) {
        const deferredDownloadIsStillReady = automaticUpdate
          && installIntentAcknowledged
          && state.status === 'downloaded';
        if (!deferredDownloadIsStillReady) {
          publish(!automaticUpdate && state.latestVersion ? 'available' : 'error');
        }
        safeLogger(logger, 'error', 'Desktop update check failed.', error);
      } finally {
        checkInFlight = false;
        if (checkPromise === operation) checkPromise = null;
      }
    })();
    checkPromise = operation;
    return operation;
  }

  function handleAvailable(info) {
    if (downloadInFlight || state.status === 'installing') return downloadPromise;
    const version = availableVersion(info);
    const sameAsDownloaded = downloadedVersion
      && isSameDesktopRelease(version, downloadedVersion);
    if (
      downloadedVersion
      && (
        (sameAsDownloaded && state.status !== 'error')
        || (!sameAsDownloaded && !isNewerDesktopRelease(version, downloadedVersion))
      )
    ) {
      safeLogger(
        logger,
        'info',
        `CC Relay ${downloadedVersion} is already the newest downloaded release.`,
      );
      return;
    }
    downloadInFlight = true;
    publishUpdate('downloading', info, { downloadPercent: null });
    safeLogger(logger, 'info', `Downloading CC Relay ${version} automatically.`);
    const operation = (async () => {
      try {
        await updater.downloadUpdate();
      } catch (error) {
        if (state.status !== 'error') publishUpdate('error', info);
        safeLogger(logger, 'error', `Desktop update ${version} download failed.`, error);
      } finally {
        downloadInFlight = false;
        if (downloadPromise === operation) downloadPromise = null;
      }
    })();
    downloadPromise = operation;
    return operation;
  }

  async function prepareToInstall() {
    if (!automaticUpdate || !downloadedVersion) return false;
    installIntentAcknowledged = true;
    if (checkPromise) await checkPromise;
    if (downloadPromise) await downloadPromise;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await checkForUpdates({ allowDownloaded: true });
      if (downloadPromise) await downloadPromise;
      if (state.status !== 'error') break;
      safeLogger(logger, 'info', 'Retrying the final desktop update preparation once.');
    }
    publish('installing', { downloadPercent: 100 });
    return true;
  }

  async function handleDownloaded(info) {
    if (downloadedPromptInFlight) return;
    if (!downloadPromise) downloadInFlight = false;
    const version = availableVersion(info);
    const previousVersion = downloadedVersion;
    const supersedesPrevious = previousVersion
      && isNewerDesktopRelease(version, previousVersion);
    if (
      previousVersion
      && !isSameDesktopRelease(version, previousVersion)
      && !supersedesPrevious
    ) {
      safeLogger(
        logger,
        'info',
        `Ignoring stale downloaded release ${version}; CC Relay ${previousVersion} is already ready.`,
      );
      return;
    }
    downloadedVersion = version;
    downloadedReleaseInfo = info;
    publishUpdate('downloaded', info, { downloadPercent: 100 });
    if (installIntentAcknowledged) {
      if (supersedesPrevious) {
        safeLogger(
          logger,
          'info',
          `CC Relay ${version} superseded ${previousVersion} and will install on quit without another prompt.`,
        );
        return;
      }
      safeLogger(logger, 'info', `CC Relay ${version} is already scheduled to install on quit.`);
      return;
    }
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
      const selectedButton = selectedDialogButton(response);
      if (selectedButton === 1) {
        installIntentAcknowledged = true;
        safeLogger(logger, 'info', `CC Relay ${version} will install on quit.`);
        return;
      }
      if (selectedButton !== 0) return;
      installIntentAcknowledged = true;
      downloadedPromptInFlight = false;
      await restartAndInstall(prepareToInstall);
    } catch (error) {
      publishUpdate('downloaded', downloadedReleaseInfo || info, { downloadPercent: 100 });
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
        if (state.status === 'downloaded' && downloadedVersion) return;
        publish('current', {
          latestVersion: null,
          releaseUrl: String(options.releasesUrl || ''),
          releaseNotes: [],
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
        const deferredDownloadIsStillReady = installIntentAcknowledged
          && downloadedVersion
          && checkInFlight
          && !downloadInFlight
          && state.status === 'downloaded';
        if (deferredDownloadIsStillReady) {
          safeLogger(
            logger,
            'error',
            `Desktop update refresh failed; CC Relay ${downloadedVersion} remains ready to install.`,
            error,
          );
          return;
        }
        if (!downloadPromise) downloadInFlight = false;
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
    prepareToInstall,
    status: () => ({ ...state }),
  };
}

export default createDesktopUpdater;
