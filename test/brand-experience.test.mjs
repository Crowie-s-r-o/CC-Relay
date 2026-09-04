import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const main = readFileSync(new URL('../src/electron-main.mjs', import.meta.url), 'utf8');
const splash = readFileSync(new URL('../public/splash.html', import.meta.url), 'utf8');
// Comments are stripped once, before any extraction. A raw-text matcher is otherwise satisfied by a
// commented-out decoy rule such as `/* legacy: } .splash-credit { color: #000000; } */`, which would
// silently stand in for the real declaration and let a mutated live value pass.
const splashStyle = readFileSync(new URL('../public/splash.css', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const style = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');

// One literal for the startup graphite. The Electron backgroundColor and every splash background
// declaration are asserted against this constant so the two sides cannot drift apart.
const GRAPHITE = '#10151b';

// Extracts the body of a standalone top-level rule from public/splash.css. The closing-brace anchor
// only rejects a selector that is part of a grouped selector list, such as `.splash-credit` inside
// the shared typography rule. It does NOT keep `.splash-seg` or `.splash-dot` away from the
// `prefers-reduced-motion` overrides: those are rejected purely because `String.match` returns the
// FIRST match and the standalone rules appear earlier in source order. Keep every standalone rule
// above the media query, or these assertions start reading the override body instead.
function splashRule(selectorSource) {
  const match = splashStyle.match(new RegExp(`(?:^|\\})\\s*${selectorSource}\\s*\\{([^{}]*)\\}`));
  assert.ok(match, `expected a standalone public/splash.css rule for ${selectorSource}`);
  return match[1];
}

test('desktop startup shows the minimal splash before waiting for the embedded server', () => {
  const splashStart = main.indexOf('await createSplashWindow(appIcon)');
  const serverStart = main.indexOf("await import('./server.mjs')");

  assert.ok(splashStart > 0);
  assert.ok(serverStart > splashStart);
  assert.match(main, /const SPLASH_PATH = fileURLToPath\(new URL\('\.\.\/public\/splash\.html'/);
  assert.match(main, /width: 376,\s+height: 376,/);
  assert.match(main, new RegExp(`frame: false,[\\s\\S]*?show: true,[\\s\\S]*?backgroundColor: '${GRAPHITE}'`));
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
  assert.match(splash, /<p class="splash-status">/);
  assert.match(splash, /<i class="splash-dot" aria-hidden="true"><\/i>Starting</);
  assert.match(splash, /<span class="splash-status-note">Starting local server<\/span>/);

  // The status row is the only live text on the splash, so it must stay exposed to assistive tech.
  assert.doesNotMatch(splash, /<p class="splash-status"[^>]*aria-hidden/);
  assert.match(splash, /<p class="splash-credit">Created by software development company Crowie s\.r\.o\.<\/p>/);
  assert.doesNotMatch(splash, /<section|command center/);

  // The splash must stay a static, offline document under its own CSP.
  assert.match(splash, /<meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self'">/);
  assert.doesNotMatch(splash, /<script/i);
  assert.doesNotMatch(`${splash}\n${splashStyle}`, /url\(\s*['"]?https?:|@import|fonts\.googleapis|fonts\.gstatic/i);

  const splashBlock = splashRule('\\.splash');
  assert.match(splashBlock, /align-items: flex-start;/);
  assert.match(splashBlock, /padding: 30px;/);
  assert.doesNotMatch(splashBlock, /border-radius/);

  // The single inset hairline is the only edge treatment on the frameless tile. Dropping it leaves
  // the splash indistinguishable from the desktop behind it on a dark background.
  assert.match(splashBlock, /box-shadow: inset 0 0 0 1px rgba\(255, 255, 255, \.07\);/);

  // The bundled faces are the whole reason the CSP can stay `style-src 'self'`. Pin both filenames
  // and prove the files exist, so a renamed or moved woff2 fails here instead of silently falling
  // back to the platform serif and monospace at launch.
  const fontSources = [...splashStyle.matchAll(/url\("\.\/(fonts\/[^"]+)"\) format\("woff2"\)/g)].map((entry) => entry[1]);
  assert.deepEqual(fontSources, ['fonts/jetbrains-mono-latin.woff2', 'fonts/source-serif-4-latin.woff2']);
  fontSources.forEach((relativePath) => {
    assert.ok(
      existsSync(new URL(`../public/${relativePath}`, import.meta.url)),
      `public/splash.css @font-face src points at a missing file: ${relativePath}`,
    );
  });

  // The Electron backgroundColor and all three splash background surfaces must stay the same
  // graphite. Each rule is extracted first, so a later block's declaration can never stand in for a
  // missing or diverged one and let a first-paint color flash ship.
  const graphiteBackground = new RegExp(`background: ${GRAPHITE};`);
  assert.ok(main.includes(`backgroundColor: '${GRAPHITE}',`), 'Electron splash backgroundColor drifted');
  assert.match(splashRule(':root'), graphiteBackground);
  assert.match(splashRule('html,\\s*body'), graphiteBackground);
  assert.match(splashBlock, graphiteBackground);
  assert.doesNotMatch(splashStyle, /#0d0e11/i);

  // The frameless splash window never scrolls.
  assert.match(splashRule('html,\\s*body'), /overflow: hidden;/);

  assert.match(splashRule('\\.splash-mark'), /width: 112px;[\s\S]*?height: 112px;[\s\S]*?margin-bottom: auto;[\s\S]*?filter: invert\(1\)/);
  assert.match(splashRule('\\.splash-wordmark'), /font-family: "Source Serif 4", serif;[\s\S]*?font-size: 32px;/);
  assert.match(splashRule('\\.splash-wordmark'), /font-weight: 600;/);
  assert.match(splashRule('\\.splash-tagline'), /font-size: 11px;/);
  assert.match(splashRule('\\.splash-progress'), /gap: 4px;/);
  assert.match(splashRule('\\.splash-dot'), /background: #4ec98a;[\s\S]*?animation: ccDot/);
  assert.match(splashRule('\\.splash-dot'), /width: 5px;\s+height: 5px;/);
  assert.match(splashRule('\\.splash-credit'), /font-size: 9\.5px;/);

  // The status row is the small-caps line that pushes the two labels to opposite edges of the tile.
  const statusBlock = splashRule('\\.splash-status');
  assert.match(statusBlock, /justify-content: space-between;/);
  assert.match(statusBlock, /font-size: 9\.5px;/);
  assert.match(statusBlock, /text-transform: uppercase;/);

  // The vertical rhythm below the tagline is carried entirely by these two margins. Without them
  // pinned the bottom stack can drift without failing anything.
  assert.match(splashRule('\\.splash-progress'), /margin-top: 22px;/);
  assert.match(splashRule('\\.splash-credit'), /margin-top: 20px;/);
  assert.doesNotMatch(splashStyle, /text-align: center|max-width: 220px/);

  const segBlock = splashRule('\\.splash-seg');
  assert.match(segBlock, /flex: 1;/);
  assert.match(segBlock, /height: 3px;/);
  assert.match(segBlock, /background: rgba\(255, 255, 255, \.09\);/);
  assert.match(segBlock, /animation: ccSeg 4\.4s ease-out infinite;/);

  // The pulse travels left to right, so every stagger step matters, not just the last one.
  ['0s', '.45s', '.9s', '1.35s', '1.8s', '2.25s'].forEach((delay, index) => {
    const pattern = `\\.splash-seg:nth-child\\(${index + 1}\\) \\{ animation-delay: ${delay.replace('.', '\\.')}; \\}`;
    assert.match(splashStyle, new RegExp(pattern));
  });

  const segKeyframes = splashStyle.match(/@keyframes ccSeg \{[\s\S]*?\n\}/)?.[0] ?? '';
  assert.match(segKeyframes, /0%,\s+100% \{\s+background: rgba\(255, 255, 255, \.09\);/);
  assert.match(segKeyframes, /18%,\s+46% \{\s+background: #4ec98a;/);

  // Accessibility: every text row on the splash clears WCAG AA 4.5:1 against the #10151b ground, and
  // the five rows form a deliberate ladder from brightest to quietest: the wordmark #e9eff5 at
  // 15.83:1, the tagline #8392a3 at 5.77:1, the left status #7e8c9d at 5.35:1, the right status note
  // #798797 at 5.00:1, and the credit line #748190 at 4.62:1. These values were deliberately raised
  // above the 3B design greys; see wiki/brand-startup-and-about.md before restoring anything darker.
  assert.match(splashRule('\\.splash-wordmark'), /color: #e9eff5;/);
  assert.match(splashRule('\\.splash-tagline'), /color: #8392a3;/);
  assert.match(splashRule('\\.splash-status-live'), /color: #7e8c9d;/);
  assert.match(splashRule('\\.splash-status-note'), /color: #798797;/);
  assert.match(splashRule('\\.splash-credit'), /color: #748190;/);

  // The dot keyframe body, not just the `animation: ccDot` shorthand. Flattening the 50% stop to
  // opacity 1 leaves a static dot that no other assertion notices.
  const dotKeyframes = splashStyle.match(/@keyframes ccDot \{[\s\S]*?\n\}/)?.[0] ?? '';
  assert.match(dotKeyframes, /0%,\s+100% \{\s+opacity: 1;/);
  assert.match(dotKeyframes, /50% \{\s+opacity: \.35;/);

  const reducedMotion = splashStyle.match(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}/)?.[0] ?? '';
  const reducedSeg = reducedMotion.match(/\.splash-seg \{([^{}]*)\}/)?.[1] ?? '';
  assert.match(reducedSeg, /animation: none;/);
  assert.match(reducedSeg, /background: rgba\(255, 255, 255, \.34\);/);
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
