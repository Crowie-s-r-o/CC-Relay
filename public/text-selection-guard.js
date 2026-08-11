function controlHasSelection(control) {
  if (!control) return false;
  try {
    return Number.isInteger(control.selectionStart)
      && Number.isInteger(control.selectionEnd)
      && control.selectionEnd > control.selectionStart;
  } catch {
    return false;
  }
}

export function hasActiveTextSelection(documentObject, windowObject) {
  const selection = windowObject?.getSelection?.();
  const documentSelection = Boolean(
    selection
    && selection.rangeCount > 0
    && !selection.isCollapsed
    && String(selection).length > 0,
  );
  return documentSelection || controlHasSelection(documentObject?.activeElement);
}

export function selectionIntersectsTarget(target, selection) {
  if (!target || !selection || selection.isCollapsed || selection.rangeCount === 0) return false;
  const contains = (node) => Boolean(
    node
    && (target === node || target.contains?.(node)),
  );
  return contains(selection.anchorNode) || contains(selection.focusNode);
}

export function createTextSelectionGuard({ documentObject, windowObject }) {
  let pending = null;
  let resolvePending = null;
  let settleTimer = null;
  let pointerDown = false;
  const defer = windowObject?.setTimeout?.bind(windowObject) || globalThis.setTimeout;
  const cancelDeferred = windowObject?.clearTimeout?.bind(windowObject) || globalThis.clearTimeout;

  function isActive() {
    return hasActiveTextSelection(documentObject, windowObject);
  }

  function cancelSettlement() {
    if (settleTimer === null) return;
    cancelDeferred(settleTimer);
    settleTimer = null;
  }

  function scheduleSettlement() {
    if (!pending || pointerDown || isActive() || settleTimer !== null) return;
    // A selection often clears on pointerdown. Resume in a later task only after
    // pointerup so the click or replacement drag can finish against stable nodes.
    settleTimer = defer(() => {
      settleTimer = null;
      if (!pending || pointerDown || isActive()) return;
      const resolve = resolvePending;
      pending = null;
      resolvePending = null;
      resolve();
    }, 0);
  }

  documentObject.addEventListener('pointerdown', () => {
    pointerDown = true;
    cancelSettlement();
  }, true);
  for (const eventName of ['pointerup', 'pointercancel']) {
    documentObject.addEventListener(eventName, () => {
      pointerDown = false;
      scheduleSettlement();
    }, true);
  }
  documentObject.addEventListener('selectionchange', () => {
    if (isActive()) cancelSettlement();
    else scheduleSettlement();
  });
  documentObject.addEventListener('click', (event) => {
    const selection = windowObject?.getSelection?.();
    // A mouse drag ends with a click. If that click belongs to the selected range, its
    // default action can toggle a disclosure or activate a card and destroy the range.
    // Keyboard-generated clicks have detail 0 and remain fully functional.
    if (event.detail === 0 || !selectionIntersectsTarget(event.target, selection)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  function waitForClear() {
    // A refresh can finish between pointerdown and the browser establishing its range.
    // Treat the whole pointer gesture as protected, even while the selection is empty.
    if (!pointerDown && !isActive()) return Promise.resolve();
    if (pending) return pending;

    pending = new Promise((resolve) => {
      resolvePending = resolve;
    });
    return pending;
  }

  return { isActive, waitForClear };
}
