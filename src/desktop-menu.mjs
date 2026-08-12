/*
 * macOS keeps an application menu even after `BrowserWindow.removeMenu()`, and Electron's default
 * menu binds Command plus, minus, and zero to its own unbounded `zoomin`, `zoomout`, and
 * `resetzoom` roles. That second owner bypasses CC Relay's bounded 50 through 200 percent factor
 * table, so the desktop app installs this menu instead and routes every zoom accelerator into the
 * same stepper the key handler uses. Windows and Linux keep a menu-free window, where the renderer
 * key handler is the only owner.
 */
const ZOOM_ACCELERATORS = Object.freeze({
  in: ['CommandOrControl+Plus', 'CommandOrControl+=', 'CommandOrControl+numadd'],
  out: ['CommandOrControl+-', 'CommandOrControl+numsub'],
  reset: ['CommandOrControl+0', 'CommandOrControl+num0'],
});

function zoomItems(onZoom) {
  const item = (label, direction, accelerator, visible) => ({
    label,
    accelerator,
    visible,
    acceleratorWorksWhenHidden: true,
    click: () => onZoom(direction),
  });
  return [
    { label: 'Actual Size', direction: 'reset' },
    { label: 'Zoom In', direction: 'in' },
    { label: 'Zoom Out', direction: 'out' },
  ].flatMap(({ label, direction }) => ZOOM_ACCELERATORS[direction].map(
    (accelerator, index) => item(label, direction, accelerator, index === 0),
  ));
}

export function desktopMenuTemplate({ onZoom }) {
  return [
    { role: 'appMenu' },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        ...zoomItems(onZoom),
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ];
}

export function desktopMenuRequired(platform = process.platform) {
  return platform === 'darwin';
}
