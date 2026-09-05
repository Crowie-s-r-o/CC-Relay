const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Invoked by verify-launchpad.cjs --provider-usage with isolated synthetic provider responses.
module.exports = async ({window, js, out, setUsage}) => {
  const {normalizeCodexUsage} = await import('../src/provider-usage.mjs');
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const now = Math.floor(Date.now() / 1000);
  const usage = {
    claude: {status:'ready', fiveHour:{usedPercent:100,resetsAt:now+17940},
      weekly:{usedPercent:72,resetsAt:now+600000}, fableWeekly:{usedPercent:0}},
    codex: {status:'ready', ...normalizeCodexUsage({rateLimitsByLimitId:{codex:{
      primary:{usedPercent:95,windowDurationMins:300,resetsAt:now+17940},
    }}})},
  };
  setUsage(usage);
  await window.reload();
  await pause(1500);
  await js('document.fonts.ready');
  const inspect = () => js(`Array.from(document.querySelectorAll('#provider-usage > [data-usage-key]'), meter => {
    const box = meter.getBoundingClientRect();
    const track = meter.querySelector('[role="progressbar"]');
    const texts = [meter.firstElementChild, meter.querySelector('strong'), meter.querySelector('small')];
    return {key:meter.dataset.usageKey, value:meter.querySelector('strong').textContent,
      countdown:meter.querySelector('small').textContent, numeric:track.getAttribute('aria-valuenow'),
      label:track.getAttribute('aria-label'), title:meter.title,
      visible:meter.checkVisibility() && box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight,
      fits:texts.every(e => {
        if (!e.textContent) return true;
        const range = document.createRange(); range.selectNodeContents(e);
        const text = range.getBoundingClientRect();
        return e.checkVisibility() && text.width > 0 && text.left >= box.left - 0.5 && text.right <= box.right + 0.5;
      })};
  })`);
  for (const theme of ['dark','light']) {
    await js(`document.documentElement.dataset.theme = '${theme}'`);
    for (const width of [1720,1344,1200,800,760,480,380,320]) {
      window.setContentSize(width,1040);
      await pause(100);
      const meters = await inspect();
      assert.deepEqual(meters.map(m=>m.key), ['claude-five-hour','claude-weekly','claude-fable','codex-five-hour','codex-weekly']);
      assert.ok(meters.every(m=>m.visible && m.fits), `${theme} ${width}: ${JSON.stringify(meters)}`);
      assert.deepEqual(meters.map(m=>m.value), ['100%','72%','0%','95%','--']);
      assert.equal(meters[2].countdown,'');
      assert.match(meters[3].countdown,/^in 4h \d+m$/);
      assert.equal(meters[3].numeric,'95');
      assert.equal(meters[3].label,'Codex 5-hour usage');
      assert.equal(meters[4].numeric,null);
      assert.equal(meters[4].countdown,'');
      assert.equal(await js('document.querySelector("#display-settings").open'),false);
      assert.ok(await js(`(() => {
        const usage = document.querySelector('#provider-usage').getBoundingClientRect();
        const cog = document.querySelector('#display-settings summary').getBoundingClientRect();
        return usage.right <= cog.left && cog.top < usage.bottom && cog.bottom > usage.top;
      })()`),'Display cog shares the usage row');
      assert.ok(await js('document.body.scrollWidth <= innerWidth'),'No horizontal overflow');
      fs.writeFileSync(path.join(out,`${theme}-${width}.png`),(await window.webContents.capturePage()).toPNG());
      console.log(`Provider usage passed: ${theme} ${width}`);
    }
  }
  // Extra pass: Top placement, a real Fable value, a weekly-only account, and a normal SSE refresh.
  window.setContentSize(1720,1040);
  await js('document.querySelector("#header-position-toggle").click()');
  usage.claude.fableWeekly = {usedPercent:83,resetsAt:now+300000};
  usage.codex = {status:'ready', ...normalizeCodexUsage({rateLimits:{
    primary:{usedPercent:31,windowDurationMins:10080,resetsAt:now+600000},
  }})};
  setUsage(usage);
  let meters;
  for (let attempt=0; attempt<40; attempt++) {
    await pause(100);
    meters = await inspect();
    if (meters[2].value === '83%' && meters[4].value === '31%') break;
  }
  assert.deepEqual(meters.map(m=>m.value),['100%','72%','83%','--','31%']);
  assert.ok(meters.every(m=>m.visible && m.fits));
  assert.match(meters[2].countdown,/^in \dd \d+h$/);
  assert.equal(meters[3].numeric,null);
  fs.writeFileSync(path.join(out,'top-refreshed.png'),(await window.webContents.capturePage()).toPNG());
  console.log('Extra pass passed: Top placement, direct Fable, weekly-only Codex, normal status refresh.');
};
