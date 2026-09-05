const assert = require('node:assert/strict');

module.exports = async function verifyDesktopChrome({ window, js, capture, updatePreferences, setZoom }) {
  const reload = async () => {
    const loaded = new Promise(resolve => window.webContents.once('did-finish-load', resolve));
    window.reload();
    await loaded;
    await new Promise(resolve => setTimeout(resolve, 1200));
  };
  const check = async (position, factor = 1) => {
    const geometry = await js(`(() => {
      const rect = selector => document.querySelector(selector).getBoundingClientRect().toJSON();
      const top = document.querySelector('${position === 'top' ? '.app-header' : '.project-dock'}');
      return {
        position: document.documentElement.dataset.headerPosition,
        strip: !!document.querySelector('.desktop-titlebar'),
        grid: getComputedStyle(document.body).gridTemplateAreas,
        dock: rect('.project-dock'), monitor: rect('.app-header'), workspace: rect('.workspace'),
        top: top.getBoundingClientRect().toJSON(), inset: parseFloat(getComputedStyle(top).paddingLeft),
        drag: getComputedStyle(top).webkitAppRegion,
        controls: ['.project-list', '.project-dock-actions', '.brand-lockup', '.header-actions']
          .map(selector => getComputedStyle(document.querySelector(selector)).webkitAppRegion),
        viewport: innerHeight,
      };
    })()`);
    assert.equal(geometry.position, position);
    assert.equal(geometry.strip, false, 'The obsolete strip has no DOM row');
    assert.ok(!geometry.grid.includes('titlebar'), 'No empty titlebar grid track');
    assert.equal(geometry.top.top, 0, 'Content starts at the top edge');
    assert.ok(geometry.inset * factor >= 83, 'Native window controls retain physical clearance at every zoom');
    assert.ok(geometry.top.height * factor >= 39, 'Native controls fit vertically at minimum zoom');
    assert.equal(geometry.drag, 'drag');
    assert.ok(geometry.controls.every(region => region === 'no-drag'), 'Interactive controls are excluded from window dragging');
    assert.ok(Math.abs(geometry.workspace.top - geometry.dock.bottom) <= 1);
    const bottom = position === 'bottom' ? geometry.monitor : geometry.workspace;
    assert.ok(Math.abs(bottom.bottom - geometry.viewport) <= 1, 'The final row ends at the viewport edge');
    if (position === 'bottom') assert.ok(Math.abs(geometry.workspace.bottom - geometry.monitor.top) <= 1);
  };

  // The new native window has a fresh origin cache, so this proves durable Top restoration.
  await check('top');
  updatePreferences({ headerPosition: undefined });
  assert.equal(await js(`localStorage.getItem('relay.headerPosition')`), 'top');
  await reload();
  await check('bottom');
  updatePreferences(null);
  await js(`localStorage.removeItem('relay.headerPosition')`);
  await reload();
  await check('bottom');
  await capture('native-default-bottom');

  for (const factor of [0.5, 2, 1]) {
    await setZoom(factor);
    await reload();
    await check('bottom', factor);
    await capture('native-bottom-zoom-' + factor);
    await js(`document.querySelector('#display-settings').open = true; document.querySelector('#header-position-toggle').click(); document.querySelector('#display-settings').open = false`);
    await check('top', factor);
    await capture('native-top-zoom-' + factor);
    await js(`document.querySelector('#display-settings').open = true; document.querySelector('#header-position-toggle').click(); document.querySelector('#display-settings').open = false`);
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  window.setContentSize(480, 900);
  await capture('native-compact-bottom');
  await check('bottom');
  await js(`document.querySelector('#theme-toggle').click(); document.querySelector('#header-position-toggle').click()`);
  await capture('native-compact-top-light');
  await check('top');
  // Extra pass at the smallest supported browser layout while retaining native insets.
  window.setContentSize(320, 900);
  await capture('native-smallest-top-light');
  await check('top');
  await js(`document.querySelector('#header-position-toggle').click()`);
  await capture('native-smallest-bottom-light');
  await check('bottom');
  window.setContentSize(1720, 1040);
  await js(`document.querySelector('#theme-toggle').click()`);
  await check('bottom');
  console.log('Desktop chrome: durable Top, missing/fresh Bottom, both placements, zoom limits, compact geometry, and themes passed.');
};
