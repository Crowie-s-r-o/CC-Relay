import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  createTextSelectionGuard,
  hasActiveTextSelection,
  selectionIntersectsTarget,
} from '../public/text-selection-guard.js';

const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

function browserFixture() {
  const documentObject = new EventTarget();
  documentObject.activeElement = null;
  let selection = {
    rangeCount: 0,
    isCollapsed: true,
    toString: () => '',
  };
  const windowObject = { getSelection: () => selection };
  return {
    documentObject,
    windowObject,
    setSelection(next) {
      selection = next;
      documentObject.dispatchEvent(new Event('selectionchange'));
    },
  };
}

test('nonempty document and form-control selections are active', () => {
  const fixture = browserFixture();
  fixture.setSelection({
    rangeCount: 1,
    isCollapsed: false,
    toString: () => 'copy me',
  });
  assert.equal(hasActiveTextSelection(fixture.documentObject, fixture.windowObject), true);

  fixture.setSelection({
    rangeCount: 1,
    isCollapsed: true,
    toString: () => '',
  });
  fixture.documentObject.activeElement = { selectionStart: 2, selectionEnd: 7 };
  assert.equal(hasActiveTextSelection(fixture.documentObject, fixture.windowObject), true);

  fixture.documentObject.activeElement = { selectionStart: 7, selectionEnd: 7 };
  assert.equal(hasActiveTextSelection(fixture.documentObject, fixture.windowObject), false);
});

test('the guard holds refresh work until selected text is cleared', async () => {
  const fixture = browserFixture();
  const guard = createTextSelectionGuard(fixture);
  fixture.setSelection({
    rangeCount: 1,
    isCollapsed: false,
    toString: () => 'stable selection',
  });

  let resumed = false;
  const first = guard.waitForClear().then(() => { resumed = true; });
  const second = guard.waitForClear();
  await Promise.resolve();
  assert.equal(resumed, false);

  fixture.setSelection({
    rangeCount: 0,
    isCollapsed: true,
    toString: () => '',
  });
  await Promise.all([first, second]);
  assert.equal(resumed, true);
});

test('clearing a selection on pointerdown does not resume rendering mid-click', async () => {
  const fixture = browserFixture();
  const guard = createTextSelectionGuard(fixture);
  fixture.setSelection({
    rangeCount: 1,
    isCollapsed: false,
    toString: () => 'selected',
  });
  let resumed = false;
  const waiting = guard.waitForClear().then(() => { resumed = true; });

  fixture.documentObject.dispatchEvent(new Event('pointerdown'));
  fixture.setSelection({
    rangeCount: 0,
    isCollapsed: true,
    toString: () => '',
  });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(resumed, false);

  fixture.documentObject.dispatchEvent(new Event('pointerup'));
  await waiting;
  assert.equal(resumed, true);
});

test('a refresh that finishes during pointerdown waits for the complete selection gesture', async () => {
  const fixture = browserFixture();
  const guard = createTextSelectionGuard(fixture);

  fixture.documentObject.dispatchEvent(new Event('pointerdown'));
  let resumed = false;
  const waiting = guard.waitForClear().then(() => { resumed = true; });
  await Promise.resolve();
  assert.equal(resumed, false);

  fixture.setSelection({
    rangeCount: 1,
    isCollapsed: false,
    toString: () => 'selection established during the drag',
  });
  fixture.documentObject.dispatchEvent(new Event('pointerup'));
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(resumed, false);

  fixture.setSelection({
    rangeCount: 0,
    isCollapsed: true,
    toString: () => '',
  });
  await waiting;
  assert.equal(resumed, true);
});

test('selection intersection follows either endpoint inside the click target', () => {
  const inside = {};
  const outside = {};
  const target = { contains: (node) => node === inside };
  assert.equal(selectionIntersectsTarget(target, {
    rangeCount: 1,
    isCollapsed: false,
    anchorNode: outside,
    focusNode: inside,
  }), true);
  assert.equal(selectionIntersectsTarget(target, {
    rangeCount: 1,
    isCollapsed: false,
    anchorNode: outside,
    focusNode: outside,
  }), false);
});

test('drag clicks inside selected text are cancelled app-wide while keyboard clicks remain usable', () => {
  const fixture = browserFixture();
  const selectedNode = {};
  fixture.documentObject.contains = (node) => node === selectedNode;
  createTextSelectionGuard(fixture);
  fixture.setSelection({
    rangeCount: 1,
    isCollapsed: false,
    anchorNode: selectedNode,
    focusNode: selectedNode,
    toString: () => 'selected disclosure text',
  });

  const pointerClick = new Event('click', { cancelable: true });
  Object.defineProperty(pointerClick, 'detail', { value: 1 });
  fixture.documentObject.dispatchEvent(pointerClick);
  assert.equal(pointerClick.defaultPrevented, true);

  const keyboardClick = new Event('click', { cancelable: true });
  Object.defineProperty(keyboardClick, 'detail', { value: 0 });
  fixture.documentObject.dispatchEvent(keyboardClick);
  assert.equal(keyboardClick.defaultPrevented, false);
});

test('every periodic renderer that can replace selected text uses the guard', () => {
  assert.match(app, /async function loadSnapshot\(\)[\s\S]*?await textSelectionGuard\.waitForClear\(\)/);
  assert.match(app, /async function loadProjects\(\)[\s\S]*?await textSelectionGuard\.waitForClear\(\)/);
  assert.match(app, /async function selectTask\(taskId\)[\s\S]*?await textSelectionGuard\.waitForClear\(\)/);
  assert.match(app, /async function loadThreads[\s\S]*?if \(render\) await textSelectionGuard\.waitForClear\(\)/);
  assert.match(app, /async function loadPlans\(\)[\s\S]*?await textSelectionGuard\.waitForClear\(\)/);
  assert.match(app, /async function refreshPlannerFromServer\(\)[\s\S]*?await textSelectionGuard\.waitForClear\(\)/);
  assert.match(app, /function refreshTaskDurations\(\) \{\s*[\s\S]*?if \(textSelectionGuard\.isActive\(\)\) return;/);
});

test('drag-selecting text in a task card does not activate and rebuild the card', () => {
  assert.match(
    app,
    /card\.addEventListener\('click', \(event\) => \{\s*\/\/[\s\S]*?if \(!textSelectionGuard\.isActive\(\) && !event\.target\.closest\('button, input, form'\)\)/,
  );
});
