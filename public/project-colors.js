const PROJECT_COLOR_COUNT = 6;
const PROJECT_COLOR_FALLBACKS = {
  1: [1, 6, 5, 3, 2, 4],
  2: [2, 6, 3, 5, 4, 1],
  3: [3, 5, 2, 6, 1, 4],
  4: [4, 5, 6, 2, 3, 1],
  5: [5, 3, 4, 1, 6, 2],
  6: [6, 2, 4, 5, 1, 3],
};

export function projectColorIndex(path) {
  const value = String(path || '').replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase();
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % PROJECT_COLOR_COUNT + 1;
}

export function projectColorClass(path) {
  return `project-color-${projectColorIndex(path)}`;
}

export function projectColorClasses(paths) {
  const used = new Set();
  return paths.map((path, index) => {
    const preferred = projectColorIndex(path);
    const available = PROJECT_COLOR_FALLBACKS[preferred].find((color) => !used.has(color));
    const color = available || ((preferred + index - 1) % PROJECT_COLOR_COUNT) + 1;
    if (used.size < PROJECT_COLOR_COUNT) used.add(color);
    return `project-color-${color}`;
  });
}
