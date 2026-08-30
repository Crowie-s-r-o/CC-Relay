import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { desktopContextMenuTemplate } from '../src/desktop-menu.mjs';

const mainSource = readFileSync(new URL('../src/electron-main.mjs', import.meta.url), 'utf8');
const style = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');

function menuShape(template) {
  return template.map((item) => item.role || item.type);
}

test('selected read-only text gets a native Copy context menu', () => {
  assert.deepEqual(
    desktopContextMenuTemplate({ selectionText: 'terminal selection' }),
    [{ role: 'copy' }],
  );
  assert.deepEqual(desktopContextMenuTemplate(), []);
});

test('editable controls get only their available native editing actions', () => {
  const template = desktopContextMenuTemplate({
    selectionText: 'selected input text',
    isEditable: true,
    editFlags: {
      canUndo: true,
      canRedo: false,
      canCut: true,
      canCopy: true,
      canPaste: true,
      canSelectAll: true,
    },
  });

  assert.deepEqual(menuShape(template), [
    'undo',
    'separator',
    'cut',
    'copy',
    'paste',
    'separator',
    'selectAll',
  ]);
});

test('Electron opens the native menu and terminal scrollback explicitly permits selection', () => {
  assert.match(mainSource, /webContents\.on\('context-menu',[\s\S]*desktopContextMenuTemplate\(params\)/);
  assert.match(mainSource, /Menu\.buildFromTemplate\(template\)\.popup\(\{ window: mainWindow \}\)/);
  assert.match(style, /\.event-list \{[\s\S]*?-webkit-user-select: text;[\s\S]*?user-select: text;/);
  assert.match(style, /\.event-list ::selection \{[\s\S]*?background: var\(--term-blue\);/);
  assert.match(style, /\.term-ln \{[\s\S]*?user-select: none;/);
});
