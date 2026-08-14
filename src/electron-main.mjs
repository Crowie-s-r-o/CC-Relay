import { app, BrowserWindow, Menu, dialog, nativeImage, shell } from 'electron';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import electronUpdater from 'electron-updater';
import { desktopMenuRequired, desktopMenuTemplate } from './desktop-menu.mjs';
import { createGitHubReleaseChecker } from './desktop-release-discovery.mjs';
import { desktopRendererUrl, desktopTitlebarOptions } from './desktop-titlebar.mjs';
import { desktopZoomDirectionForInput, nextDesktopZoomFactor } from './desktop-zoom.mjs';
import { createDesktopUpdater } from './desktop-updater.mjs';
import { DESKTOP_RELEASES_URL } from './desktop-update-status.mjs';
import { DiagnosticLog } from './diagnostics.mjs';
import { RELAY_APPLICATION_DIRECTORY } from './server-options.mjs';

const { autoUpdater } = electronUpdater;
const DESKTOP_RELAY_PORT = 0;
const DESKTOP_CODEX_PORT = 0;
const DESKTOP_ZOOM_REPEAT_MS = 150;
const APP_ICON_PATH = fileURLToPath(new URL('../build/icon.png', import.meta.url));
const SPLASH_PATH = fileURLToPath(new URL('../public/splash.html', import.meta.url));
const PRODUCT_NAME = 'CC Relay';
const DESKTOP_DATA_ROOT = join(app.getPath('appData'), RELAY_APPLICATION_DIRECTORY);
mkdirSync(DESKTOP_DATA_ROOT, { recursive: true });
app.setPath('userData', DESKTOP_DATA_ROOT);
app.setName(PRODUCT_NAME);
let mainWindow = null;
let splashWindow = null;
let relayShutdown = null;
let quitting = false;
let desktopDiagnostics = null;
let publishDesktopUpdateState = null;
let publishDesktopZoomState = null;
let lastDesktopZoomAt = 0;

function errorDetails(error) {
  return {
    errorName: error?.name || 'Error',
    error: error?.message || String(error),
    stack: error?.stack,
  };
}

function desktopDiagnostic(event, details = {}) {
  return desktopDiagnostics?.write(event, {
    processId: process.pid,
    ...details,
  });
}

/*
 * Both the macOS menu accelerators and the renderer key handler call this. Whether a macOS
 * accelerator also reaches the renderer is not observable from tests, so instead of dropping one
 * path on that guess the sink collapses a single keystroke into a single step.
 */
function applyDesktopZoom(direction, { deduplicate = true } = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  const now = Number(process.hrtime.bigint() / 1000000n);
  const currentFactor = mainWindow.webContents.getZoomFactor();
  if (deduplicate && now - lastDesktopZoomAt < DESKTOP_ZOOM_REPEAT_MS) {
    publishDesktopZoomState?.(currentFactor);
    return currentFactor;
  }
  if (deduplicate) lastDesktopZoomAt = now;
  const nextFactor = nextDesktopZoomFactor(direction, currentFactor);
  if (nextFactor == null || nextFactor === currentFactor) {
    publishDesktopZoomState?.(currentFactor);
    return currentFactor;
  }
  mainWindow.webContents.setZoomFactor(nextFactor);
  publishDesktopZoomState?.(nextFactor);
  desktopDiagnostic('desktop.window.zoom.changed', {
    factor: nextFactor,
    percent: Math.round(nextFactor * 100),
  });
  return nextFactor;
}

function initializeDesktopDiagnostics(dataRoot) {
  desktopDiagnostics = new DiagnosticLog(join(dataRoot, 'relay-diagnostics.jsonl'));
  desktopDiagnostic('desktop.start.requested', {
    version: app.getVersion(),
    packaged: app.isPackaged,
    platform: process.platform,
    dataRoot,
    logFile: desktopDiagnostics.filePath,
  });
}

const desktopUpdater = createDesktopUpdater({
  updater: autoUpdater,
  dialog,
  getCurrentVersion: () => app.getVersion(),
  isEligible: () => app.isPackaged && (
    process.platform === 'darwin'
    || process.platform === 'win32'
  ),
  isAutomaticUpdateEligible: () => app.isPackaged
    && (
      process.platform === 'darwin'
      || (process.platform === 'win32' && !process.env.PORTABLE_EXECUTABLE_FILE)
    ),
  checkLatestRelease: createGitHubReleaseChecker(),
  getMainWindow: () => mainWindow,
  releasesUrl: `${DESKTOP_RELEASES_URL}/latest`,
  releaseUrlForVersion: (version) => `${DESKTOP_RELEASES_URL}/tag/v${version}`,
  onStateChange: (state) => publishDesktopUpdateState?.(state),
  restartAndInstall: async () => {
    quitting = true;
    try {
      if (relayShutdown) await relayShutdown();
    } finally {
      autoUpdater.quitAndInstall(false, true);
    }
  },
  logger: console,
  timer: setTimeout,
});

function restoreMacShellPath() {
  if (process.platform !== 'darwin') return;
  try {
    const loginPath = execFileSync('/bin/zsh', ['-lic', 'printf %s "$PATH"'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (loginPath) process.env.PATH = loginPath;
  } catch {}
}

function applyDevelopmentAppIcon() {
  if (app.isPackaged) return undefined;
  const icon = nativeImage.createFromPath(APP_ICON_PATH);
  if (icon.isEmpty()) return undefined;
  if (process.platform === 'darwin') app.dock.setIcon(icon);
  return icon;
}

async function createSplashWindow(appIcon) {
  splashWindow = new BrowserWindow({
    width: 320,
    height: 320,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    show: true,
    backgroundColor: '#0d0e11',
    title: `${PRODUCT_NAME} is starting`,
    ...(appIcon ? { icon: appIcon } : {}),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  splashWindow.removeMenu();
  splashWindow.on('closed', () => {
    splashWindow = null;
  });
  desktopDiagnostic('desktop.splash.shown');
  await splashWindow.loadFile(SPLASH_PATH);
}

function closeSplashWindow() {
  if (!splashWindow || splashWindow.isDestroyed()) return;
  splashWindow.close();
  desktopDiagnostic('desktop.splash.closed');
}

async function createWindow() {
  const dataRoot = app.getPath('userData');
  initializeDesktopDiagnostics(dataRoot);
  const appIcon = applyDevelopmentAppIcon();
  app.setAboutPanelOptions({
    applicationName: PRODUCT_NAME,
    applicationVersion: app.getVersion(),
    copyright: 'Copyright © 2026 Crowie s.r.o.',
    credits: 'Founded and engineered by Ing. Patrik Kelemen',
    authors: ['Ing. Patrik Kelemen'],
    website: 'https://github.com/Crowie-s-r-o/CC-Relay',
  });
  await createSplashWindow(appIcon);
  restoreMacShellPath();
  process.argv.push(
    '--relay-data-dir',
    dataRoot,
    '--relay-config-dir',
    dataRoot,
    '--relay-port',
    String(DESKTOP_RELAY_PORT),
    '--relay-codex-port',
    String(DESKTOP_CODEX_PORT),
    '--relay-desktop',
  );
  desktopDiagnostic('desktop.server.start.requested', {
    host: '127.0.0.1',
    requestedPort: DESKTOP_RELAY_PORT,
    requestedCodexPort: DESKTOP_CODEX_PORT,
    portSelection: 'operating-system',
  });
  const relay = await import('./server.mjs');
  const endpoint = await relay.serverReady;
  const titlebarOptions = desktopTitlebarOptions(process.platform);
  const rendererUrl = desktopRendererUrl(endpoint.url, process.platform);
  relayShutdown = relay.shutdown;
  publishDesktopUpdateState = relay.setDesktopUpdateState;
  publishDesktopZoomState = relay.setDesktopZoomState;
  relay.setDesktopZoomHandler((direction) => applyDesktopZoom(direction, { deduplicate: false }));
  publishDesktopUpdateState(desktopUpdater.status());
  desktopDiagnostic('desktop.server.ready', endpoint);

  mainWindow = new BrowserWindow({
    width: 1540,
    height: 980,
    minWidth: 1040,
    minHeight: 700,
    backgroundColor: '#dfe7e4',
    title: PRODUCT_NAME,
    show: false,
    ...titlebarOptions,
    ...(appIcon ? { icon: appIcon } : {}),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  publishDesktopZoomState(mainWindow.webContents.getZoomFactor());
  desktopDiagnostic('desktop.window.created', {
    width: 1540,
    height: 980,
    titleBarStyle: titlebarOptions.titleBarStyle || 'default',
  });
  if (desktopMenuRequired()) {
    /*
     * macOS ignores removeMenu() and keeps Electron's default menu, whose zoom roles bind the same
     * accelerators and step unbounded zoom levels outside the bounded factor table. Owning the menu
     * is the only way to keep those accelerators inside it.
     */
    Menu.setApplicationMenu(Menu.buildFromTemplate(desktopMenuTemplate({ onZoom: applyDesktopZoom })));
  } else {
    mainWindow.removeMenu();
  }
  /*
   * Registered on every platform and before the page load, so neither a menu-less window nor a
   * stalled or failed load can leave the app without zoom shortcuts.
   */
  mainWindow.webContents.on('before-input-event', (event, input) => {
    const direction = desktopZoomDirectionForInput(input);
    if (!direction) return;
    event.preventDefault();
    applyDesktopZoom(direction);
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on(
    'did-fail-load',
    (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      desktopDiagnostic('desktop.window.load.failed', {
        errorCode,
        error: errorDescription,
        url: validatedURL,
        mainFrame: isMainFrame,
      });
    },
  );
  mainWindow.webContents.on('render-process-gone', (event, details) => {
    desktopDiagnostic('desktop.renderer.gone', {
      reason: details.reason,
      exitCode: details.exitCode,
    });
  });
  mainWindow.on('unresponsive', () => {
    desktopDiagnostic('desktop.window.unresponsive', { url: rendererUrl });
  });
  mainWindow.on('responsive', () => {
    desktopDiagnostic('desktop.window.responsive', { url: rendererUrl });
  });
  mainWindow.on('closed', () => {
    desktopDiagnostic('desktop.window.closed', { url: rendererUrl });
    mainWindow = null;
  });
  desktopDiagnostic('desktop.window.load.requested', { url: rendererUrl });
  await mainWindow.loadURL(rendererUrl);
  desktopDiagnostic('desktop.window.load.completed', { url: rendererUrl });
  mainWindow.show();
  mainWindow.focus();
  closeSplashWindow();
  desktopUpdater.start();
  desktopDiagnostic('desktop.updater.started');
}

const lock = app.requestSingleInstanceLock();
if (!lock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const activeWindow = mainWindow || splashWindow;
    desktopDiagnostic('desktop.second_instance.received', {
      windowAvailable: Boolean(activeWindow && !activeWindow.isDestroyed()),
    });
    if (activeWindow) {
      if (activeWindow.isMinimized()) activeWindow.restore();
      activeWindow.show();
      activeWindow.focus();
    }
  });
  app.whenReady().then(createWindow).catch((error) => {
    desktopDiagnostic('desktop.start.failed', errorDetails(error));
    console.error(error);
    const logFile = desktopDiagnostics?.filePath || 'the CC Relay application data directory';
    dialog.showErrorBox(
      'CC Relay could not start',
      `${error?.message || String(error)}\n\nDiagnostics: ${logFile}`,
    );
    quitting = true;
    if (!relayShutdown) {
      app.quit();
      return;
    }
    relayShutdown().catch((shutdownError) => {
      desktopDiagnostic('desktop.shutdown.failed', errorDetails(shutdownError));
    }).finally(() => app.quit());
  });
}

process.on('uncaughtExceptionMonitor', (error) => {
  desktopDiagnostic('desktop.process.uncaught_exception', errorDetails(error));
});
app.on('child-process-gone', (event, details) => {
  desktopDiagnostic('desktop.child_process.gone', {
    type: details.type,
    reason: details.reason,
    exitCode: details.exitCode,
    name: details.name,
    serviceName: details.serviceName,
  });
});
app.on('window-all-closed', () => {
  desktopDiagnostic('desktop.window.all_closed');
  app.quit();
});
app.on('before-quit', (event) => {
  desktopDiagnostic('desktop.shutdown.requested', {
    relayAvailable: Boolean(relayShutdown),
    alreadyQuitting: quitting,
  });
  if (quitting || !relayShutdown) return;
  event.preventDefault();
  quitting = true;
  relayShutdown().then(() => {
    desktopDiagnostic('desktop.shutdown.completed');
  }).catch((error) => {
    desktopDiagnostic('desktop.shutdown.failed', errorDetails(error));
  }).finally(() => app.quit());
});
