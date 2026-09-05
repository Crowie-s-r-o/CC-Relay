const assert = require('node:assert/strict');

// Shares the isolated renderer fixture in verify-launchpad.cjs. All pointer and
// keyboard events reach the real native range control, with no provider work.
module.exports = async function verifySelectionAndEffort({ window, js, capture, label, refresh }) {
  const frame = () => js('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  const read = () => js(`(() => {
    const slider = document.querySelector('#effort-select');
    const rect = slider.getBoundingClientRect();
    return {
      x: rect.x, y: rect.y, width: rect.width, height: rect.height,
      value: Number(slider.value), values: JSON.parse(slider.dataset.values),
      label: document.querySelector('#effort-slider-value').textContent,
      aria: slider.getAttribute('aria-valuetext'),
      progress: slider.style.getPropertyValue('--effort-progress'),
      disabled: slider.disabled,
    };
  })()`);
  await js(`document.querySelector('#provider-codex').click();
    document.querySelector('#model-select').value = 'gpt-5.6-sol';
    document.querySelector('#model-select').dispatchEvent(new Event('input', { bubbles: true }));`);
  await frame();
  const initial = await read();
  assert.equal(initial.values.length, 6, 'Use the longest supported effort list');
  const geometry = ({ x, y, width, height }) => [x, y, width, height];
  if (label === 'dark-desktop') {
    await js(`window.effortRangeMutations = [];
      window.effortRenders = 0;
      window.effortRangeNode = document.querySelector('#effort-select');
      window.effortRangeObserver = new MutationObserver(records => window.effortRangeMutations.push(...records.map(record => record.attributeName)));
      window.effortRangeObserver.observe(window.effortRangeNode, { attributes: true, attributeFilter: ['min', 'max', 'step', 'disabled', 'data-values'] });
      window.effortRenderObserver = new MutationObserver(() => window.effortRenders++);
      window.effortRenderObserver.observe(document.querySelector('#model-hint'), { childList: true });`);
  }
  const pointer = (type, index) => window.webContents.sendInputEvent({
    type, button: 'left', clickCount: 1,
    modifiers: type === 'mouseMove' ? ['leftButtonDown'] : [],
    x: Math.round(initial.x + 7 + (initial.width - 14) * index / (initial.values.length - 1)),
    y: Math.round(initial.y + initial.height / 2),
  });
  pointer('mouseDown', 0);
  try {
    for (const index of [0, 1, 2, 3, 4, 5, 4, 3, 2, 1, 0]) {
      pointer('mouseMove', index);
      await frame();
      const current = await read();
      assert.deepEqual(geometry(current), geometry(initial), `${label}: effort label must not resize the drag track (${current.label})`);
      assert.equal(current.value, index, `${label}: pointer reaches stop ${index}`);
      assert.equal(current.label, initial.values[index]);
      assert.equal(current.aria, `${initial.values[index]} effort`);
      assert.ok(Math.abs(parseFloat(current.progress) - index * 100 / 5) < 0.001);
    }
    if (label === 'dark-desktop') {
      // A backend change reaches the normal snapshot path while the pointer owns the slider.
      refresh();
      await js('new Promise(resolve => setTimeout(resolve, 600))');
      assert.equal((await read()).label, 'low', 'Background refresh does not reset an active drag');
    }
  } finally {
    pointer('mouseUp', 0);
  }
  if (label === 'dark-desktop') {
    await js('new Promise(resolve => setTimeout(resolve, 300))');
    assert.equal((await read()).label, 'low', 'Polling keeps the choice after pointer release');
    assert.deepEqual(await js('window.effortRangeMutations'), [], 'Unchanged polling never rewrites the native scale');
    assert.ok(await js('window.effortRenders > 0'), 'A real background render was exercised');
    assert.ok(await js(`window.effortRangeNode === document.querySelector('#effort-select')`), 'Polling preserves the range node');
    await js('window.effortRangeObserver.disconnect(); window.effortRenderObserver.disconnect();');
  }

  const stops = await js(`Array.from(document.querySelectorAll('#effort-slider-steps i'), node => {
    const rect = node.getBoundingClientRect();
    return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
  })`);
  for (const [index, point] of stops.entries()) {
    for (const type of ['mouseDown', 'mouseUp']) {
      window.webContents.sendInputEvent({ type, button: 'left', clickCount: 1, ...point });
    }
    await frame();
    assert.equal((await read()).value, index, `${label}: clicking a visible stop selects its exact effort`);
  }

  window.webContents.debugger.attach('1.3');
  try {
    await window.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true });
    await js(`document.querySelector('#effort-select').focus()`);
    const key = async keyCode => {
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode });
      window.webContents.sendInputEvent({ type: 'keyUp', keyCode });
      await frame();
    };
    await key('End');
    assert.equal((await read()).label, 'ultra');
    await key('Home');
    assert.equal((await read()).label, 'low');
    await key('Right');
    assert.equal((await read()).label, 'medium');
    assert.ok(await js(`(() => {
      const slider = document.querySelector('#effort-select');
      return getComputedStyle(slider).outlineStyle === 'none'
        && getComputedStyle(slider.closest('.effort-slider-shell')).outlineStyle !== 'none';
    })()`), 'Keyboard focus has one visible ring around the shell');
    await capture(`${label}-effort-focus`);
  } finally {
    window.webContents.debugger.detach();
  }

  await js(`document.querySelector('#provider-claude').click();
    document.querySelector('#model-select').value = 'fable';
    document.querySelector('#model-select').dispatchEvent(new Event('input', { bubbles: true }));`);
  assert.equal((await read()).values.length, 5, 'Provider change rebuilds the actual effort scale');
  await js(`document.querySelector('#model-select').value = 'haiku';
    document.querySelector('#model-select').dispatchEvent(new Event('input', { bubbles: true }));`);
  const unavailable = await read();
  assert.equal(unavailable.disabled, true);
  assert.equal(unavailable.aria, 'Unavailable');
  assert.equal(unavailable.values.length, 0);
  await capture(`${label}-effort-unavailable`);
  assert.ok(await js(`document.querySelector('#effort-slider-value').getBoundingClientRect().right
    <= document.querySelector('.execution-control-effort').getBoundingClientRect().right`), 'Unavailable label fits the control');
  await js(`document.querySelector('#provider-opencode').click()`);
  assert.deepEqual((await read()).values, ['high'], 'Single-stop catalogs remain valid');
  assert.ok(await js(`(() => {
    const range = document.querySelector('#effort-select').getBoundingClientRect();
    const stop = document.querySelector('#effort-slider-steps i').getBoundingClientRect();
    return Math.abs(range.x + range.width / 2 - stop.x - stop.width / 2) < 1;
  })()`), 'One supported effort has one centered stop');
  await js(`document.querySelector('#provider-codex').click()`);
  assert.equal((await read()).label, 'medium', 'Provider switching retains the unsent effort choice');

  const palette = await js(`(() => {
    const selected = document.querySelector('.task-card.selected');
    const idle = document.querySelector('.task-card:not(.selected)');
    const style = getComputedStyle(selected);
    const probe = document.createElement('span');
    probe.style.color = style.getPropertyValue('--project-accent');
    document.body.append(probe);
    const accent = getComputedStyle(probe).color;
    probe.remove();
    return { accent, border: style.borderTopColor, fill: style.backgroundColor,
      idleFill: getComputedStyle(idle).backgroundColor,
      markers: [...document.querySelectorAll('#effort-slider-steps i')].map(node => node.getBoundingClientRect().width),
      track: getComputedStyle(document.querySelector('.effort-slider-shell')).getPropertyValue('--effort-accent').trim(),
    };
  })()`);
  assert.equal(palette.border, palette.accent, `${label}: selection uses its project's color`);
  assert.notEqual(palette.fill, palette.idleFill, `${label}: selected cards have a visible tint`);
  assert.ok(palette.markers.every(width => width > 0), `${label}: every effort stop is visible`);
  assert.ok(palette.track, `${label}: effort has a project accent`);
  if (label.endsWith('desktop')) {
    // Selection must follow the newly opened card in both Queue and History.
    await js(`document.querySelector('[data-task-id="200"]').click()`);
    assert.equal(await js(`document.querySelector('.task-card.selected').dataset.taskId`), '200');
    await js(`document.querySelector('[data-task-view="history"]').click()`);
    assert.ok(await js(`document.querySelector('.task-card[data-task-id="200"]').classList.contains('selected')`));
    await capture(`${label}-history-selection`);
    await js(`document.querySelector('[data-task-view="queue"]').click(); document.querySelector('[data-task-id="201"]').click()`);
  }
  await capture(`${label}-selection-effort`);
  console.log(`${label}: native effort dragging, keyboard, provider changes, empty efforts, and task selection passed.`);
};
