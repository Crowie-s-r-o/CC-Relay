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

export function desktopZoomFactorForInput(input, currentFactor = 1) {
  if (input?.type !== 'keyDown' || (!input.meta && !input.control) || input.alt) return null;
  if (input.key === '0') return 1;

  const direction = input.key === '-' || input.key === '_'
    ? -1
    : ['+', '='].includes(input.key) ? 1 : 0;
  if (!direction) return null;

  const currentIndex = closestZoomIndex(Number(currentFactor) || 1);
  const nextIndex = Math.min(
    DESKTOP_ZOOM_FACTORS.length - 1,
    Math.max(0, currentIndex + direction),
  );
  return DESKTOP_ZOOM_FACTORS[nextIndex];
}
