import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const main = readFileSync(new URL('../src/electron-main.mjs', import.meta.url), 'utf8');
const splash = readFileSync(new URL('../public/splash.html', import.meta.url), 'utf8');
const splashStyle = readFileSync(new URL('../public/splash.css', import.meta.url), 'utf8');
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const style = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');

test('desktop startup shows the minimal splash before waiting for the embedded server', () => {
  const splashStart = main.indexOf('await createSplashWindow(appIcon)');
  const serverStart = main.indexOf("await import('./server.mjs')");

  assert.ok(splashStart > 0);
  assert.ok(serverStart > splashStart);
  assert.match(main, /const SPLASH_PATH = fileURLToPath\(new URL\('\.\.\/public\/splash\.html'/);
  assert.match(main, /width: 376,\s+height: 376,/);
  assert.match(main, /frame: false,[\s\S]*?show: true,[\s\S]*?backgroundColor: '#10151b'/);
  assert.match(main, /desktopDiagnostic\('desktop\.splash\.shown'\);[\s\S]*?await splashWindow\.loadFile\(SPLASH_PATH\);/);
  assert.match(main, /mainWindow\.show\(\);[\s\S]*?closeSplashWindow\(\);/);
});

test('splash is the left-aligned compact tile with segmented progress and quiet motion', () => {
  assert.match(splash, /role="status"[^>]+aria-live="polite"/);
  assert.match(splash, /<main[^>]+aria-label="CC Relay is starting"/);
  assert.match(splash, /<img class="splash-mark" src="\.\/favicon\.svg" alt="" aria-hidden="true">/);
  assert.match(splash, /<h1 class="splash-wordmark">CC Relay<\/h1>/);
  assert.match(splash, /<p class="splash-tagline">AI work, one task at a time<\/p>/);
  assert.match(splash, /<div class="splash-progress" aria-hidden="true">/);
  assert.equal((splash.match(/<span class="splash-seg"><\/span>/g) || []).length, 6);
  assert.match(splash, /<i class="splash-dot" aria-hidden="true"><\/i>Starting</);
  assert.match(splash, /<span class="splash-status-note">Starting local server<\/span>/);
  assert.match(splash, /<p class="splash-credit">Created by software development company Crowie s\.r\.o\.<\/p>/);
  assert.doesNotMatch(splash, /<section|command center/);

  // The splash must stay a static, offline document under its own CSP.
  assert.match(splash, /<meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self'">/);
  assert.doesNotMatch(splash, /<script/i);
  assert.doesNotMatch(`${splash}\n${splashStyle}`, /url\(\s*['"]?https?:|@import|fonts\.googleapis|fonts\.gstatic/i);

  const splashBlock = splashStyle.match(/\.splash \{[^}]*\}/)?.[0] ?? '';
  assert.match(splashBlock, /align-items: flex-start;/);
  assert.match(splashBlock, /padding: 30px;/);
  assert.match(splashBlock, /background: #10151b;/);
  assert.doesNotMatch(splashBlock, /border-radius/);

  // The Electron backgroundColor and every splash surface must stay the same graphite.
  assert.match(splashStyle, /:root \{[\s\S]*?background: #10151b;/);
  assert.match(splashStyle, /html,\s*\nbody \{[\s\S]*?background: #10151b;/);
  assert.doesNotMatch(splashStyle, /#0d0e11/i);

  assert.match(splashStyle, /\.splash-mark \{[\s\S]*?width: 112px;[\s\S]*?height: 112px;[\s\S]*?margin-bottom: auto;[\s\S]*?filter: invert\(1\)/);
  assert.match(splashStyle, /\.splash-wordmark \{[\s\S]*?font-family: "Source Serif 4", serif;[\s\S]*?font-size: 32px;/);
  assert.match(splashStyle, /\.splash-seg \{[\s\S]*?flex: 1;[\s\S]*?height: 3px;[\s\S]*?animation: ccSeg 4\.4s ease-out infinite;/);
  assert.match(splashStyle, /@keyframes ccSeg/);
  assert.match(splashStyle, /\.splash-seg:nth-child\(6\) \{ animation-delay: 2\.25s; \}/);
  assert.match(splashStyle, /\.splash-dot \{[\s\S]*?background: #4ec98a;[\s\S]*?animation: ccDot/);
  assert.match(splashStyle, /\.splash-credit \{[\s\S]*?font-size: 9\.5px;/);
  assert.doesNotMatch(splashStyle, /text-align: center|max-width: 220px/);

  const reducedMotion = splashStyle.match(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}/)?.[0] ?? '';
  assert.match(reducedMotion, /\.splash-seg \{[\s\S]*?animation: none;[\s\S]*?background: rgba\(255, 255, 255, \.22\);/);
  assert.match(reducedMotion, /\.splash-dot \{ animation: none; \}/);
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
