// Invoked by verify-launchpad.cjs --paste-images against synthetic HTTP fixtures.
// Clipboard contents are simulated in the renderer; the operator's clipboard is untouched.
const assert = require('node:assert/strict');
const fs = require('node:fs');
module.exports = async ({window, js, out}) => {
  const pause = () => new Promise(resolve => setTimeout(resolve, 120));
  await js(`
    window.fixtureImage = new Blob([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z1S8AAAAASUVORK5CYII='), c => c.charCodeAt(0))], {type:'image/png'});
    window.fixtureItems = [{types:['image/png'], getType:async()=>window.fixtureImage}];
    Object.defineProperty(navigator.clipboard, 'read', {configurable:true, value:async()=>window.fixtureItems});
    document.querySelector('#task-prompt').value='Inspect this screenshot';
    document.querySelector('#task-prompt').dispatchEvent(new Event('input',{bubbles:true}));
    document.querySelector('#paste-image').click();
  `);
  await pause();
  assert.equal(await js(`document.querySelectorAll('[data-remove-attachment]').length`), 1);
  assert.equal(await js(`document.querySelector('#task-prompt').value`), 'Inspect this screenshot');
  await js(`document.querySelector('[data-remove-attachment]').click(); window.fixtureItems=[]; document.querySelector('#paste-image').click()`);
  await pause();
  assert.match(await js(`document.querySelector('#composer-alert').textContent`), /Copy an image or screenshot first/);
  await js(`window.fixtureItems=[{types:['image/png'],getType:async()=>window.fixtureImage}]; document.querySelector('#paste-image').click()`);
  await pause();
  assert.equal(await js(`document.querySelectorAll('[data-remove-attachment]').length`), 1);
  assert.equal(await js(`document.querySelector('#composer-alert').textContent`), '');
  await js(`document.querySelector('#task-continuation-paste-image').click()`);
  await pause();
  assert.equal(await js(`document.querySelector('#task-continuation-attachment-count').textContent`), '1 image attached');
  // A delayed clipboard read cannot restore a follow-up attachment cleared mid-read.
  await js(`Object.defineProperty(navigator.clipboard,'read',{configurable:true,value:()=>new Promise(resolve=>window.finishClipboard=resolve)}); document.querySelector('#task-continuation-paste-image').click()`);
  assert.equal(await js(`document.querySelector('#task-continuation-send').disabled`), true);
  await js(`document.querySelector('#task-continuation-clear-images').click(); window.finishClipboard(window.fixtureItems)`);
  await pause();
  assert.equal(await js(`document.querySelector('#task-continuation-attachment-count').textContent`), 'No images attached');
  // The new-message send also waits until the image is staged.
  await js(`document.querySelector('#paste-image').click()`);
  assert.equal(await js(`document.querySelector('#task-submit-button').disabled`), true);
  await js(`window.finishClipboard(window.fixtureItems)`);
  await pause();
  assert.equal(await js(`document.querySelectorAll('[data-remove-attachment]').length`), 2);
  assert.equal(await js(`document.querySelector('#task-submit-button').disabled`), false);
  // Inspect the real outgoing message envelopes, then reject locally to retain drafts.
  await js(`
    window.fixtureFetch=window.fetch;
    window.fixtureRequests=[];
    window.fetch=async(url,options)=>{
      if(options?.method==='POST' && /^\\/api\\/tasks(?:$|\\/)/.test(String(url))){
        window.fixtureRequests.push({url:String(url),body:JSON.parse(options.body)});
        return new Response(JSON.stringify({error:'Synthetic delivery failure'}),{status:503,headers:{'Content-Type':'application/json'}});
      }
      return window.fixtureFetch(url,options);
    };
    document.querySelector('#task-form').requestSubmit();
  `);
  await pause();
  assert.equal(await js(`window.fixtureRequests[0].body.attachments.length`), 2);
  assert.equal(await js(`window.fixtureRequests[0].body.attachments.every(image=>image.mimeType==='image/png' && image.data.startsWith('data:image/png;base64,'))`), true);
  assert.equal(await js(`document.querySelectorAll('[data-remove-attachment]').length`), 2, 'Rejected send retains images');
  await js(`Object.defineProperty(navigator.clipboard,'read',{configurable:true,value:async()=>window.fixtureItems}); document.querySelector('#task-continuation-paste-image').click()`);
  await pause();
  await js(`document.querySelector('#task-continuation-input').value='Inspect the follow-up image'; document.querySelector('#task-continuation-input').dispatchEvent(new Event('input',{bubbles:true})); document.querySelector('#task-continuation-form').requestSubmit()`);
  await pause();
  assert.match(await js(`window.fixtureRequests[1].url`), /\/steer$/);
  assert.equal(await js(`window.fixtureRequests[1].body.attachments.length`), 1);
  assert.equal(await js(`document.querySelector('#task-continuation-attachment-count').textContent`), '1 image attached');
  await js(`window.fetch=window.fixtureFetch; Object.defineProperty(navigator.clipboard,'read',{configurable:true,value:async()=>{throw new Error('Denied')}}); document.querySelector('#paste-image').click()`);
  await pause();
  assert.match(await js(`document.querySelector('#composer-alert').textContent`), /Could not read the clipboard/);
  assert.equal(await js(`document.querySelector('#paste-image').disabled`), false, 'Permission failure releases the button');
  for (const theme of ['light', 'dark']) {
    await js(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
    for (const width of [1720, 480, 320]) {
      window.setContentSize(width, 1040);
      await pause();
      assert.equal(await js(`document.body.scrollWidth<=innerWidth`), true, `${theme} ${width} has no overflow`);
      assert.equal(await js(`(() => { const button=document.querySelector('#paste-image'); const r=button.getBoundingClientRect(); return r.width>0 && r.right<=innerWidth; })()`), true);
      fs.writeFileSync(`${out}/paste-${theme}-${width}.png`, (await window.webContents.capturePage()).toPNG());
    }
  }
  console.log('Paste image verification passed: both composers, empty clipboard, draft text, cancellation, pending submission, and both themes at 1720/480/320.');
};
