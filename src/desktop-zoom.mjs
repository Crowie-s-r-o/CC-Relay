export const DESKTOP_ZOOM_FACTORS = Object.freeze([
  0.5,
  0.67,
  0.75,
  0.8,
  0.9,
  1,
  1.1,
  1.25,
  1.5,
  1.75,
  2,
]);

function closestZoomIndex(currentFactor) {
  let closestIndex = 0;
  let closestDistance = Number.POSITIVE_INFINITY;
  DESKTOP_ZOOM_FACTORS.forEach((factor, index) => {
    const distance = Math.abs(factor - currentFactor);
    if (distance >= closestDistance) return;
    closestDistance = distance;
    closestIndex = index;
  });
  return closestIndex;
}

/*
 * Zoom has two entry points on the desktop: the macOS application menu accelerators and the
 * renderer key handler used where the window carries no menu. Both resolve a direction first and
 * then share this stepper, so a given keystroke lands on the same bounded factor either way.
 */
export function nextDesktopZoomFactor(direction, currentFactor = 1) {
  if (direction === 'reset') return 1;
  const step = direction === 'in' ? 1 : direction === 'out' ? -1 : 0;
  if (!step) return null;

  const currentIndex = closestZoomIndex(Number(currentFactor) || 1);
  const nextIndex = Math.min(
    DESKTOP_ZOOM_FACTORS.length - 1,
    Math.max(0, currentIndex + step),
  );
  return DESKTOP_ZOOM_FACTORS[nextIndex];
}

export function desktopZoomDirectionForInput(input) {
  if (input?.type !== 'keyDown' || (!input.meta && !input.control) || input.alt) return null;
  if (input.key === '0') return 'reset';
  if (input.key === '-' || input.key === '_') return 'out';
  if (input.key === '+' || input.key === '=') return 'in';
  return null;
}

export function desktopZoomFactorForInput(input, currentFactor = 1) {
  return nextDesktopZoomFactor(desktopZoomDirectionForInput(input), currentFactor);
}
