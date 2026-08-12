import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const main = readFileSync(new URL('../src/electron-main.mjs', import.meta.url), 'utf8');
const splash = readFileSync(new URL('../public/splash.html', import.meta.url), 'utf8');
const splashStyle = readFileSync(new URL('../public/splash.css', import.meta.url), 'utf8');
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const style = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');

test('desktop startup shows the Crowie splash before waiting for the embedded server', () => {
  const splashStart = main.indexOf('await createSplashWindow(appIcon)');
  const serverStart = main.indexOf("await import('./server.mjs')");

  assert.ok(splashStart > 0);
  assert.ok(serverStart > splashStart);
  assert.match(main, /const SPLASH_PATH = fileURLToPath\(new URL\('\.\.\/public\/splash\.html'/);
  assert.match(main, /frame: false,[\s\S]*?show: true,[\s\S]*?backgroundColor: '#0d0e11'/);
  assert.match(main, /desktopDiagnostic\('desktop\.splash\.shown'\);[\s\S]*?await splashWindow\.loadFile\(SPLASH_PATH\);/);
  assert.match(main, /mainWindow\.show\(\);[\s\S]*?closeSplashWindow\(\);/);
});

test('splash presents a static CC Relay and Crowie company identity accessibly', () => {
  assert.match(splash, /role="status"[^>]+aria-live="polite"/);
  assert.match(splash, /class="splash-logo" src="\.\/favicon\.svg"/);
  assert.match(splash, /<h1><span>CC<\/span> Relay<\/h1>/);
  assert.match(splash, /Software by Crowie s\.r\.o\./);
  assert.match(splash, /Software Development company/);
  assert.match(splash, /Preparing your command center/);
  assert.match(splashStyle, /\.splash \{[\s\S]*?background: #0d0e11;/);
  assert.match(splashStyle, /font-family: "Source Serif 4"/);
  assert.doesNotMatch(splashStyle, /animation|transition|@keyframes|gradient/i);
});

test('the header opens a branded About dialog with company and founder details', () => {
  assert.match(html, /id="about-button"[^>]+aria-controls="about-modal"/);
  assert.match(html, /<dialog id="about-modal"[^>]+aria-labelledby="about-title"/);
  assert.match(html, /Crowie s\.r\.o\./);
  assert.match(html, /Software Development company/);
  assert.match(html, /Ing\. Patrik Kelemen/);
  assert.match(app, /elements\.aboutButton\.addEventListener\('click',[\s\S]*?elements\.aboutModal\.showModal\(\)/);
  assert.match(app, /elements\.aboutClose\.addEventListener\('click',[\s\S]*?elements\.aboutModal\.close\(\)/);
  assert.match(style, /\.about-identity-grid/);
  assert.match(style, /html\[data-theme="dark"\] \.about-card/);
  assert.match(style, /@keyframes about-orbit/);
});

test('native About metadata carries the Crowie company identity', () => {
  assert.match(main, /app\.setAboutPanelOptions\(\{/);
  assert.match(main, /copyright: 'Copyright © 2026 Crowie s\.r\.o\.'/);
  assert.match(main, /credits: 'Founded and engineered by Ing\. Patrik Kelemen'/);
  assert.doesNotMatch(main, /credits: 'Software Development company/);
  assert.match(main, /authors: \['Ing\. Patrik Kelemen'\]/);
});
