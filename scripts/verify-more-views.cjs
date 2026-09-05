const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Use native input and hit testing: DOM .click() bypasses clipped menus.
module.exports = async function verifyMoreViews({window, js, out}) {
  const frame = () => js('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
  const click = async selector => {
    const point = await js(`(() => {
      const e = document.querySelector(${JSON.stringify(selector)});
      const r = e.getBoundingClientRect();
      const x = Math.round(r.x + r.width / 2), y = Math.round(r.y + r.height / 2);
      return {x, y, reachable: e.contains(document.elementFromPoint(x, y))};
    })()`);
    assert.ok(point.reachable, `Pointer can reach ${selector}`);
    for (const type of ['mouseDown', 'mouseUp']) window.webContents.sendInputEvent({type, x:point.x, y:point.y, button:'left', clickCount:1});
    await frame();
  };
  for (const theme of ['dark', 'light']) {
    await js(`document.documentElement.dataset.theme = '${theme}'`);
    for (const width of [1720, 1200, 480, 380, 320]) {
      window.setContentSize(width, 1040);
      await frame();
      await js(`document.querySelector('#event-filters').scrollIntoView({block:'center'})`);
      await frame();
      for (const surface of ['#original-terminal-view', '[data-event-filter="conversation"]']) {
        await click(surface);
        for (const filter of ['all', 'highlights', 'commands', 'mine', 'ai']) {
          await click('#event-more-views summary');
          assert.equal(await js(`document.querySelector('#event-more-views').open`), true);
          assert.ok(await js(`Array.from(document.querySelectorAll('.event-more-menu button')).every(e => {
            const r = e.getBoundingClientRect();
            return r.left >= 0 && r.right <= innerWidth && [r.top + 2, r.bottom - 2].every(y =>
              [r.left + 2, r.right - 2].every(x => e.contains(document.elementFromPoint(x, y))));
          })`), `${theme} ${width}: every menu option is visible and unobstructed`);
          if (filter === 'all') fs.writeFileSync(path.join(out, `${theme}-${width}-${surface.includes('conversation')?'conversation':'terminal'}.png`), (await window.webContents.capturePage()).toPNG());
          await click(`[data-event-filter="${filter}"]`);
          assert.equal(await js(`document.querySelector('#event-more-views').open`), false);
          assert.equal(await js(`document.querySelector('[data-event-filter="${filter}"]').getAttribute('aria-pressed')`), 'true');
          await click(surface);
        }
      }
      // Native keyboard disclosure and selection remain reachable.
      await js(`document.querySelector('#event-more-views summary').focus()`);
      for (const keyCode of ['Return', 'Tab', 'Return']) {
        for (const type of keyCode === 'Return' ? ['keyDown', 'char', 'keyUp'] : ['keyDown', 'keyUp']) window.webContents.sendInputEvent({type, keyCode});
        await frame();
      }
      assert.equal(await js(`document.querySelector('#event-more-views').open`), false);
      assert.equal(await js(`document.querySelector('[data-event-filter="all"]').getAttribute('aria-pressed')`), 'true');
      assert.ok(await js('document.body.scrollWidth <= innerWidth'), 'No horizontal page overflow');
      console.log(`More views passed: ${theme} ${width}`);
    }
  }
};
