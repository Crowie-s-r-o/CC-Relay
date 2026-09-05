// Uses the isolated synthetic fixture described in README.md, never a real account.
const { app, BrowserWindow, nativeTheme } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const out = path.resolve(__dirname, '../.data/ui');
fs.mkdirSync(out, { recursive: true });
let win;
async function submit(script) {
  const done = new Promise(resolve => win.webContents.once('did-finish-load', resolve));
  await win.webContents.executeJavaScript(script);
  await done;
}
async function inspect(name, width, height, theme) {
  nativeTheme.themeSource = theme;
  win.setContentSize(width, height);
  await new Promise(resolve => setTimeout(resolve, 200));
  assert(await win.webContents.executeJavaScript('document.documentElement.scrollWidth <= innerWidth'), 'Page overflows');
  assert(await win.webContents.executeJavaScript("getComputedStyle(document.querySelector('main') || document.querySelector('#content')).display !== 'none'"));
  fs.writeFileSync(path.join(out, name + '.png'), (await win.webContents.capturePage()).toPNG());
}
app.whenReady().then(async () => {
  win = new BrowserWindow({ width: 1280, height: 900, show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, partition: 'vibeide-fixture-' + Date.now() } });
  await win.loadURL('http://127.0.0.1:18080/accounts/login/');
  await inspect('login-light', 1200, 850, 'light');
  await inspect('login-mobile-dark', 390, 844, 'dark');
  await submit("document.querySelector('[name=login]').value='operator@example.test'; document.querySelector('[name=password]').value='Synthetic-Fixture-739!long'; document.querySelector('form').requestSubmit();");
  assert(win.webContents.getURL().includes('/2fa/'), 'Login must require two-factor authentication');
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const hash = crypto.createHmac('sha1', Buffer.alloc(20)).update(counter).digest();
  const code = String((hash.readUInt32BE(hash.at(-1) & 15) & 0x7fffffff) % 1000000).padStart(6, '0');
  await submit(`document.querySelector('[name=code]').value=${JSON.stringify(code)}; document.querySelector('form').requestSubmit();`);
  assert(win.webContents.getURL().endsWith('/account/'), 'MFA must lead to account');
  await inspect('account-mobile', 390, 844, 'light');
  await win.loadURL('http://127.0.0.1:18080/admin/metrics/');
  assert(await win.webContents.executeJavaScript("document.body.textContent.includes('First-touch funnel')"));
  await inspect('metrics-desktop-light', 1360, 1000, 'light');
  await inspect('metrics-desktop-dark', 1360, 1000, 'dark');
  await inspect('metrics-mobile-dark', 390, 844, 'dark');
  console.log('Browser login, MFA, account, analytics and six responsive/theme captures passed.');
}).catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  if (win && !win.isDestroyed()) win.destroy();
  app.exit(process.exitCode || 0);
});
setTimeout(() => { console.error('UI verification timed out'); app.exit(1); }, 45000).unref();
