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

function joinMenuGroups(groups) {
  return groups
    .filter((group) => group.length > 0)
    .flatMap((group, index, populated) => (
      index < populated.length - 1 ? [...group, { type: 'separator' }] : group
    ));
}

/*
 * BrowserWindow does not provide Chromium's page context menu automatically. Keep selected
 * read-only text copyable and give editable controls the standard native editing actions without
 * exposing a menu over ordinary unselected application surfaces.
 */
export function desktopContextMenuTemplate({
  selectionText = '',
  isEditable = false,
  editFlags = {},
} = {}) {
  const canCopy = String(selectionText).length > 0 || editFlags.canCopy === true;
  if (!isEditable) return canCopy ? [{ role: 'copy' }] : [];

  return joinMenuGroups([
    [
      ...(editFlags.canUndo ? [{ role: 'undo' }] : []),
      ...(editFlags.canRedo ? [{ role: 'redo' }] : []),
    ],
    [
      ...(editFlags.canCut ? [{ role: 'cut' }] : []),
      ...(canCopy ? [{ role: 'copy' }] : []),
      ...(editFlags.canPaste ? [{ role: 'paste' }] : []),
    ],
    editFlags.canSelectAll ? [{ role: 'selectAll' }] : [],
  ]);
}

export function desktopMenuRequired(platform = process.platform) {
  return platform === 'darwin';
}
