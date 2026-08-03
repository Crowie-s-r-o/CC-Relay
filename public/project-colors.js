export const PROJECT_COLOR_PRESETS = Object.freeze([
  { name: 'Electric blue', value: '#3b82f6' },
  { name: 'Hot magenta', value: '#f04fc3' },
  { name: 'Aqua', value: '#19c9ad' },
  { name: 'Sunbeam', value: '#f1c232' },
  { name: 'Signal red', value: '#f05268' },
  { name: 'Lime', value: '#91cf35' },
  { name: 'Ultraviolet', value: '#9b72f2' },
  { name: 'Bright cyan', value: '#28bfe8' },
]);

export const PROJECT_COLOR_COUNT = PROJECT_COLOR_PRESETS.length;
const PROJECT_COLOR_FALLBACKS = {
  1: [1, 4, 5, 6, 2, 3, 7, 8],
  2: [2, 6, 3, 4, 1, 8, 5, 7],
  3: [3, 5, 2, 7, 4, 1, 6, 8],
  4: [4, 5, 1, 7, 3, 6, 8, 2],
  5: [5, 3, 8, 6, 1, 7, 4, 2],
  6: [6, 2, 7, 5, 1, 8, 3, 4],
  7: [7, 6, 4, 3, 5, 8, 1, 2],
  8: [8, 5, 2, 7, 4, 6, 1, 3],
};

function colorChannels(hex) {
  return [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16));
}

function hexColor(channels) {
  return `#${channels
    .map((channel) => Math.round(channel).toString(16).padStart(2, '0'))
    .join('')}`;
}

function mixChannels(left, right, amount) {
  return left.map((channel, index) => channel * amount + right[index] * (1 - amount));
}

function relativeLuminance(channels) {
  return channels
    .map((value) => {
      const channel = value / 255;
      return channel <= 0.04045
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4;
    })
    .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
}

function contrastRatio(left, right) {
  const [bright, dark] = [relativeLuminance(left), relativeLuminance(right)]
    .sort((first, second) => second - first);
  return (bright + 0.05) / (dark + 0.05);
}

export function normalizeProjectColor(value) {
  const color = String(value || '').trim().toLowerCase();
  return /^#[\da-f]{6}$/.test(color) ? color : null;
}

export function projectColorTokens(value) {
  const color = normalizeProjectColor(value);
  if (!color) return null;
  const source = colorChannels(color);
  const white = [255, 255, 255];
  const darkInk = [7, 16, 33];
  let light = source;
  for (let step = 0; step <= 20; step += 1) {
    const amount = 1 - step * 0.04;
    const candidate = mixChannels(source, [0, 0, 0], amount).map(Math.round);
    const strongestTint = mixChannels(candidate, white, 0.16).map(Math.round);
    if (
      contrastRatio(candidate, strongestTint) >= 4.5
      && contrastRatio(white, candidate) >= 4.5
    ) {
      light = candidate;
      break;
    }
  }
  let dark = source;
  for (let step = 0; step <= 20; step += 1) {
    const amount = 1 - step * 0.04;
    const candidate = mixChannels(source, white, amount).map(Math.round);
    if (contrastRatio(candidate, darkInk) >= 4.5) {
      dark = candidate;
      break;
    }
  }
  return {
    light: hexColor(light),
    dark: hexColor(dark),
  };
}

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
