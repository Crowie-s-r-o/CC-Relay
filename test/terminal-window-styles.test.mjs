import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const style = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');

const BLOCK_START = '/* Terminal window dialog';
const BLOCK_END = '/* End terminal window dialog';

function windowCssBlock() {
  const start = style.indexOf(BLOCK_START);
  const end = style.indexOf(BLOCK_END);
  assert.ok(start >= 0 && end > start, 'the terminal window stylesheet block is delimited by both markers');
  return style.slice(start, end);
}

function windowRules() {
  return windowCssBlock().replaceAll(/\/\*[\s\S]*?\*\//g, '');
}

// Returns the declarations of exactly one rule, so a test can assert what a state does NOT
// declare as confidently as what it does. Several tests below depend on that, because the
// point of the hover treatment is the accent channels it gives up.
function ruleBody(rules, selector) {
  const marker = `\n${selector} {`;
  const start = rules.indexOf(marker);
  assert.ok(start >= 0, `${selector} is declared in the terminal window block`);
  const open = start + marker.length;
  const end = rules.indexOf('}', open);
  assert.ok(end > open, `${selector} has a closing brace`);
  return rules.slice(open, end);
}

test('the terminal window is a near full viewport dialog with its own backdrop', () => {
  const rules = windowRules();
  assert.match(rules, /\.terminal-window-modal \{[^}]*width: min\(96vw, 1720px\);/s);
  assert.match(rules, /\.terminal-window-modal \{[^}]*max-width: 96vw;/s);
  assert.match(rules, /\.terminal-window-modal \{[^}]*height: min\(94vh, 1180px\);/s);
  assert.match(rules, /\.terminal-window-modal \{[^}]*max-height: 94vh;/s);
  // The UA dialog:modal rule caps both axes, so padding and border are cleared explicitly
  // and the card owns the visible surface, exactly like .terminal-settings-modal does.
  assert.match(rules, /\.terminal-window-modal \{[^}]*padding: 0;[^}]*border: 0;/s);
  assert.match(rules, /\.terminal-window-modal \{[^}]*background: transparent;/s);
  assert.match(rules, /\.terminal-window-modal::backdrop \{[^}]*background: rgb\(14 21 36 \/ 52%\);/s);
});

test('the card is a fixed header over a mount that owns all remaining height', () => {
  const rules = windowRules();
  assert.match(rules, /\.terminal-window-card \{[^}]*grid-template-rows: auto minmax\(0, 1fr\);/s);
  assert.match(rules, /\.terminal-window-card \{[^}]*height: 100%;[^}]*min-height: 0;[^}]*overflow: hidden;/s);
  // Four header zones since the toolbar fold: identity, view rail, the docked tools cluster,
  // and close. The tools slot sits between the rail and close, matching the markup order.
  assert.match(rules, /\.terminal-window-header \{[^}]*grid-template-areas: "heading views tools close";/s);
  assert.match(rules, /\.terminal-window-header \{[^}]*grid-template-columns: minmax\(0, 1fr\) auto auto auto;/s);
  assert.match(rules, /\.terminal-window-heading \{[^}]*min-width: 0;/s);
  assert.match(rules, /\.terminal-window-heading h2 \{[^}]*margin: 0;/s);
  assert.match(rules, /\.terminal-window-body \{[^}]*min-height: 0;[^}]*overflow: hidden;/s);
  assert.match(rules, /\.terminal-window-mount \{[^}]*height: 100%;[^}]*min-height: 0;[^}]*overflow: hidden;/s);
  // The mount repeats the ledger background instead of extending .events-section.
  assert.match(rules, /\.terminal-window-mount \{[^}]*background: #08090d;/s);
  assert.match(rules, /\.terminal-window-close \{[^}]*cursor: pointer;/s);
});

test('the native Terminal.app screen replaces the fabricated ledger in the default view', () => {
  const rules = windowRules();
  assert.match(
    rules,
    /\.native-terminal-screen \{[^}]*display: grid;[^}]*grid-template-rows: auto minmax\(0, 1fr\);[^}]*overflow: hidden;/s,
  );
  assert.match(
    rules,
    /#native-terminal-screen-output \{[^}]*max-height: none;[^}]*border: 0;[^}]*overflow: auto;[^}]*font: 500 13px\/1\.42 var\(--font-mono\);[^}]*white-space: pre;[^}]*word-break: normal;[^}]*user-select: text;/s,
  );
  assert.match(
    rules,
    /#terminal-window-mount > \.events-section\[data-terminal-window="open"\]\[data-terminal-surface="native"\] \{\s*grid-template-rows: minmax\(0, 1fr\) auto auto;\s*\}/,
  );
  assert.match(
    rules,
    /\.events-section\[data-terminal-window="open"\]\[data-terminal-surface="native"\] \.event-overview,[\s\S]*?\.event-list \{\s*display: none;\s*\}/,
  );
  assert.match(rules, /#native-terminal-screen-output\[hidden\],[\s\S]*?display: none;/);
  assert.doesNotMatch(rules, /html\[data-theme="dark"\] \.native-terminal-screen/);
});

test('the view rail is a segmented switcher with a pressed state, counts, hover, and focus', () => {
  const rules = windowRules();
  // The contract's container is #terminal-window-views.terminal-window-views. Both themes
  // qualify it the same way, otherwise the light rule would outrank the dark one.
  assert.match(rules, /#terminal-window-views\.terminal-window-views \{[^}]*display: flex;/s);
  assert.match(rules, /html\[data-theme="dark"\] #terminal-window-views\.terminal-window-views \{/);
  assert.match(rules, /\.terminal-window-views button \{[^}]*min-height: 32px;/s);
  assert.match(rules, /\.terminal-window-views button b \{[^}]*border-radius: 999px;/s);
  assert.match(rules, /\.terminal-window-views button:hover:not\(\[aria-pressed="true"\]\) \{/);
  assert.match(rules, /\.terminal-window-views button\[aria-pressed="true"\] \{[^}]*box-shadow: inset 0 -3px 0 #2239c9/s);
  assert.match(rules, /\.terminal-window-views button\[aria-pressed="true"\] b \{/);
  // Visible focus must survive the compact scrolling rail, so the ring is drawn inside.
  assert.match(rules, /\.terminal-window-views button:focus-visible \{[^}]*outline: 2px solid var\(--signal\);[^}]*outline-offset: -2px;/s);
  assert.match(rules, /\.terminal-window-close:focus-visible \{[^}]*outline: 2px solid var\(--signal\);/s);
});

test('rail hover reads as a neutral lift and pressed owns the selected signal', () => {
  const rules = windowRules();

  /*
   * The defect this pins: hover and pressed were the same accent hue at 22% and 38% border
   * alpha, so on the 42px rail a hovered unselected button read as selected and the count
   * pill tint was the clearest differentiator, which is backwards. The two states must now
   * differ on several channels at once, so a future edit that recolors one of them cannot
   * quietly collapse them back together.
   *
   * Hover: neutral only. No accent hue, no underline, no elevation, and it moves the
   * OPPOSITE way from pressed on the luminance axis (a --graphite wash one step darker than
   * the rail, against pressed's solid --paper one step lighter).
   */
  const hover = ruleBody(rules, '.terminal-window-views button:hover:not([aria-pressed="true"])');
  assert.match(hover, /background: rgb\(52 64 90 \/ 10%\);/);
  assert.match(hover, /color: var\(--ink\);/);
  assert.doesNotMatch(hover, /79 95 246|34 57 201|#2239c9|var\(--signal\)/, 'light hover carries no accent hue');
  assert.doesNotMatch(hover, /box-shadow/, 'the underline and the elevation belong to pressed alone');

  const pressed = ruleBody(rules, '.terminal-window-views button[aria-pressed="true"]');
  assert.match(pressed, /color: #2239c9;/);
  assert.match(pressed, /background: var\(--paper\);/);
  assert.match(pressed, /box-shadow: inset 0 -3px 0 #2239c9/);
  assert.match(ruleBody(rules, '.terminal-window-views button[aria-pressed="true"] b'), /color: #2239c9;/);

  const darkHover = ruleBody(rules, 'html[data-theme="dark"] .terminal-window-views button:hover:not([aria-pressed="true"])');
  assert.match(darkHover, /background: var\(--app-control\);/);
  assert.doesNotMatch(darkHover, /122 162 247|--app-blue/, 'dark hover carries no accent hue');
  assert.doesNotMatch(darkHover, /box-shadow/, 'the underline and the elevation belong to pressed alone');

  const darkPressed = ruleBody(rules, 'html[data-theme="dark"] .terminal-window-views button[aria-pressed="true"]');
  assert.match(darkPressed, /background: color-mix\(in srgb, var\(--app-blue\) 16%, var\(--app-control\)\);/);
  assert.match(darkPressed, /box-shadow: inset 0 -3px 0 var\(--app-blue\)/);

  /*
   * Both hover rules exclude the pressed button outright. A bare `button:hover` ties the
   * pressed rule on specificity and only loses on source order, so a later reshuffle could
   * repaint half the selected treatment. Reverting to the bare selector fails here.
   */
  assert.doesNotMatch(rules, /\.terminal-window-views button:hover \{/);
  assert.doesNotMatch(rules, /\.terminal-window-views button:hover,/);
});

test('the light view rail clears AA contrast and the dark companion still overrides it', () => {
  const rules = windowRules();

  /*
   * The rail is the window's primary view switcher and it paints smaller than its
   * neighbours, 11px/600 for the label and 9px for the count pill. On the light --mist rail
   * the house --slate (#748096) measures 3.67:1 and the pill 3.16:1, both under the 4.5:1 AA
   * floor for text that small. --graphite (#34405a) is the light palette's high contrast
   * small text token and lifts them to 9.55:1 and 8.22:1. Reverting either declaration to
   * --slate reintroduces the failure, so both are pinned positively and negatively.
   */
  const label = ruleBody(rules, '.terminal-window-views button');
  assert.match(label, /color: var\(--graphite\);/);
  assert.doesNotMatch(label, /var\(--slate\)/);

  const pill = ruleBody(rules, '.terminal-window-views button b');
  assert.match(pill, /color: var\(--graphite\);/);
  assert.doesNotMatch(pill, /var\(--slate\)/);

  /*
   * The close glyph and the subtitle sit on the --paper header, where --slate measures
   * 3.98:1 and --graphite 10.36:1. They take the same token as the rail rather than a new
   * one, so the whole header chrome answers to a single small text decision.
   */
  const close = ruleBody(rules, '.terminal-window-close');
  assert.match(close, /color: var\(--graphite\);/);
  assert.doesNotMatch(close, /var\(--slate\)/);

  const subtitle = ruleBody(rules, '.terminal-window-heading p');
  assert.match(subtitle, /color: var\(--graphite\);/);
  assert.doesNotMatch(subtitle, /var\(--slate\)/);

  // No light rule in the block may reach for --slate again.
  assert.doesNotMatch(rules, /var\(--slate\)/);

  /*
   * The pressed accent is #2239c9, the light pressed indigo .queue-view-switch and
   * .history-period-tabs already use, not --signal (#4f5ff6). --signal measured 4.88:1 for
   * the pressed label and 4.05:1 for the pressed count pill; #2239c9 reaches 8.41:1 and
   * 6.98:1. The pill KEEPS the --signal tint, because 6.98:1 is measured against it.
   */
  assert.match(rules, /\.terminal-window-views button\[aria-pressed="true"\] \{[^}]*color: #2239c9;/s);
  assert.match(rules, /\.terminal-window-views button\[aria-pressed="true"\] b \{[^}]*background: rgb\(79 95 246 \/ 14%\);/s);
  assert.doesNotMatch(
    ruleBody(rules, '.terminal-window-views button[aria-pressed="true"]'),
    /var\(--signal\)/,
    'the pressed accent must not fall back to --signal, which measures 4.88:1 here',
  );

  // Dark was already compliant at 7.52:1 for the label and 5.93:1 for the pill, so it keeps
  // --app-text-muted. Its rules must stay at the higher specificity that beats the light
  // declarations above, otherwise --graphite would leak into the dark rail.
  assert.match(rules, /html\[data-theme="dark"\] \.terminal-window-views button \{[^}]*color: var\(--app-text-muted\);/s);
  assert.match(rules, /html\[data-theme="dark"\] \.terminal-window-views button b \{[^}]*color: var\(--app-text-muted\);/s);
});

test('the toolbar open control matches its neighbours and declares a disabled state', () => {
  const rules = windowRules();
  // It sits in .event-tools and inherits the shared terminal button geometry, so the rule
  // adds identity only. The shared rule is what makes it read like Copy log and Thinking.
  assert.match(style, /\.event-filters button,\n\.event-tools button \{/);
  /*
   * The identity rules must stay scoped under .event-tools. `.event-tools button` ends in an
   * element selector, so it outranks a bare `.terminal-window-open` and the color, border and
   * background below would never paint. `.event-tools .thinking-visibility-button` is scoped
   * for exactly the same reason.
   */
  assert.match(rules, /\.event-tools \.terminal-window-open \{[^}]*color: var\(--term-tap-hover\);/s);
  assert.doesNotMatch(rules, /^\.terminal-window-open(:|\s*\{)/m);
  assert.match(rules, /\.terminal-window-open i \{[^}]*font-style: normal;/s);
  assert.match(rules, /\.event-tools \.terminal-window-open:hover:not\(:disabled\) \{/);
  assert.match(rules, /\.event-tools \.terminal-window-open:disabled \{[^}]*cursor: not-allowed;/s);
});

test('the docked toolbar folds into the dialog header', () => {
  const rules = windowRules();

  // 1. The header slot the live .event-tools cluster is moved into.
  assert.match(rules, /\.terminal-window-tools \{[^}]*display: flex;[^}]*grid-area: tools;/s);
  // Nothing has been moved in before the first open, so the empty slot reserves nothing.
  assert.match(rules, /\.terminal-window-tools:empty \{\s*display: none;\s*\}/);

  // 2. The row the cluster left is empty, so it collapses instead of holding dead space.
  assert.match(rules, /\.events-section\[data-terminal-window="open"\] \.event-toolbar \{\s*display: none;\s*\}/);
  // Its old docked geometry is gone with it, base and compact alike.
  assert.doesNotMatch(rules, /\.events-section\[data-terminal-window="open"\] \.event-toolbar \{[^}]*padding:/s);
  assert.doesNotMatch(rules, /\.events-section\[data-terminal-window="open"\] \.event-tools \{/);

  /*
   * 3. Load bearing. #terminal-window-open travels into the header with the cluster, so the
   * old rule that hid it through .events-section stops matching and an Open control would
   * appear inside the already open window. It must be hidden through its new parent.
   */
  assert.match(rules, /\.terminal-window-tools \.terminal-window-open \{\s*display: none;\s*\}/);
  assert.doesNotMatch(rules, /\.events-section\[data-terminal-window="open"\] \.terminal-window-open \{/);

  /*
   * Specificity trap. The hide rule above is only (0,2,0). Every id qualified tools rule is
   * (1,2,1) or higher, so a display declaration in any of them would outrank it and bring
   * the redundant Window button back. The base .event-tools button display: inline-flex is
   * (0,1,1) and loses to the hide rule, so leaving it alone is what makes this work.
   */
  for (const match of rules.matchAll(/#terminal-window-tools[^{]*\{([^}]*)\}/g)) {
    assert.doesNotMatch(match[1], /display:/, 'no id qualified tools rule may declare display');
  }

  /*
   * The cluster arrives wearing the ledger's chrome, which is illegible on the --paper
   * header (--term-muted2 on a 55% navy wash). It is restated as the same white, --line
   * bordered chip the close control already is, and Thinking's default aria-pressed state
   * moves off the ledger's violet, which would paint #eadfff on white.
   */
  assert.match(
    rules,
    /#terminal-window-tools\.terminal-window-tools \.event-tools button \{[^}]*color: var\(--graphite\);[^}]*background: var\(--paper\);/s,
  );
  assert.match(
    rules,
    /#terminal-window-tools\.terminal-window-tools \.event-tools button\[aria-pressed="true"\] \{[^}]*color: #2239c9;/s,
  );
  assert.match(
    rules,
    /#terminal-window-tools\.terminal-window-tools \.thinking-visibility-button\[aria-pressed="true"\] i::after \{[^}]*background: #2239c9;/s,
  );
  /*
   * The ledger focus ring is --term-blue, 2.31:1 on this white header. The window's own
   * --signal ring reaches 4.88:1.
   *
   * The light rule is id qualified AND sets the whole outline shorthand, at one id, three
   * classes and one element. Its dark companion therefore has to carry the same id to reach
   * it, which is why the two halves are pinned together here rather than apart: a bare class
   * dark rule would lose no matter where it sat in the file, and the chips would keep the
   * light ring in dark theme with every declaration still reading correctly.
   */
  assert.match(
    rules,
    /#terminal-window-tools\.terminal-window-tools \.event-tools button:focus-visible \{[^}]*outline: 2px solid var\(--signal\);/s,
  );
  assert.match(
    rules,
    /html\[data-theme="dark"\] #terminal-window-tools\.terminal-window-tools \.event-tools button:focus-visible[^{]*\{[^}]*outline-color: var\(--app-blue\);/s,
  );
  // And the losing bare class form must not come back.
  assert.doesNotMatch(rules, /html\[data-theme="dark"\] \.terminal-window-tools \.event-tools button:focus-visible/);
});

test('the docked events section fills the mount and hides the inline filter rail', () => {
  const rules = windowRules();
  /*
   * #terminal-window-mount > .events-section[data-terminal-window="open"] does NOT outrank
   * .detail-panel #task-detail .events-section. Both compute to one id and two class level
   * components, because an attribute selector counts as class level and the child combinator
   * adds nothing. They TIE, and the docked rule wins on SOURCE ORDER alone. The test below
   * this one pins that order.
   */
  /*
   * FOUR rows. The hidden .event-toolbar is no longer a grid item, so the docked children
   * are the overview details, the scrollback, the continuation form and the status bar. The
   * old five row template would hand minmax(0, 1fr) to the continuation form and collapse
   * the scrollback, which is the entire reading surface, to its content height.
   */
  assert.match(
    rules,
    /#terminal-window-mount > \.events-section\[data-terminal-window="open"\] \{[^}]*grid-template-rows: auto minmax\(0, 1fr\) auto auto;/s,
  );
  assert.match(
    rules,
    /#terminal-window-mount > \.events-section\[data-terminal-window="open"\] \{[^}]*height: 100%;[^}]*min-height: 0;[^}]*margin: 0;/s,
  );
  assert.match(rules, /\.events-section\[data-terminal-window="open"\] #event-filters \{\s*display: none;\s*\}/);
  assert.match(
    rules,
    /\.events-section\[data-terminal-window="open"\] \.event-list \{[^}]*max-height: none;[^}]*overflow: auto;/s,
  );
});

/*
 * The docked four row template only wins because it is declared LATER in the file. It ties
 * .detail-panel #task-detail .events-section on specificity, so source order is the whole
 * mechanism, and nothing in either rule's text would change if the order were reversed. What
 * would change is the layout: the five row template would win again, the scrollback would
 * collapse to auto and the continuation composer would take the minmax(0, 1fr). This test
 * exists so that moving the terminal window block, or moving the continuation dock rule,
 * fails loudly here instead of silently inverting the window.
 */
test('the docked grid row template is declared after the rule it ties on specificity', () => {
  // Body matched loosely on purpose: pinning it to exactly one declaration would turn any
  // concurrent addition to that rule into a false failure here.
  const continuation = /\.detail-panel #task-detail \.events-section \{[^}]*grid-template-rows: auto auto minmax\(0, 1fr\) auto auto;[^}]*\}/
    .exec(style);
  assert.ok(continuation, 'the five row continuation dock rule is still declared');
  const dockedMarker = '#terminal-window-mount > .events-section[data-terminal-window="open"] {';
  const docked = style.indexOf(dockedMarker);
  assert.ok(docked >= 0, 'the docked four row rule is still declared');
  assert.equal(style.indexOf(dockedMarker, docked + 1), -1, 'the docked rule is declared exactly once');
  assert.ok(
    docked > continuation.index,
    'the docked four row rule must stay BELOW the five row .detail-panel #task-detail .events-section rule, '
      + 'because the two tie at one id and two class level components and only source order separates them',
  );
});

test('the docked terminal keeps the ledger palette and typography untouched', () => {
  const rules = windowRules();
  // The palette lives on the .events-section selector, which plan-visibility.test.mjs slices
  // with indexOf('.events-section {'). Nothing here may recolor or retype the ledger.
  assert.doesNotMatch(rules, /--term-(bg|fg|blue|green|red|muted|panel|line|border):/);
  assert.doesNotMatch(rules, /\[data-terminal-window="open"\][^{]*\{[^}]*font-size:/s);
  assert.doesNotMatch(rules, /\[data-terminal-window="open"\][^{]*\{[^}]*font-family:/s);
});

test('dark theme rules accompany every themed light rule', () => {
  const rules = windowRules();
  for (const selector of [
    '.terminal-window-modal::backdrop',
    '.terminal-window-card',
    '.terminal-window-header',
    '.terminal-window-heading p',
    '#terminal-window-views.terminal-window-views',
    '.terminal-window-views button',
    '.terminal-window-views button b',
    '.terminal-window-views button:hover:not([aria-pressed="true"])',
    '.terminal-window-views button[aria-pressed="true"]',
    '#terminal-window-tools.terminal-window-tools .event-tools button',
    '#terminal-window-tools.terminal-window-tools .event-tools button:hover:not(:disabled)',
    '#terminal-window-tools.terminal-window-tools .event-tools button[aria-pressed="true"]',
    '#terminal-window-tools.terminal-window-tools .thinking-visibility-button i',
    '.terminal-window-close',
    '.terminal-window-close:hover',
  ]) {
    assert.ok(
      rules.includes(`html[data-theme="dark"] ${selector} {`)
        || rules.includes(`html[data-theme="dark"] ${selector},`),
      `${selector} needs a dark theme companion rule`,
    );
  }
  // The moved cluster's focus ring is themed with the rail's, in the shared comma list, and
  // carries the id its light half carries so it actually outranks it.
  assert.match(
    rules,
    /html\[data-theme="dark"\] #terminal-window-tools\.terminal-window-tools \.event-tools button:focus-visible,/,
  );
  // The mount and body are deliberately theme invariant because the terminal itself is.
  assert.doesNotMatch(rules, /html\[data-theme="dark"\] \.terminal-window-mount/);
});

test('the compact breakpoints restack the header and keep the rail usable', () => {
  const rules = windowRules();
  /*
   * Four header zones now, so the identity row absorbs the tools cluster and the rail keeps
   * a full width row of its own to scroll in. Splitting the second row between views and
   * tools instead would leave close alone in an oversized auto column on row one.
   */
  assert.match(
    rules,
    /@media \(max-width: 1100px\) \{[\s\S]*?\.terminal-window-header \{[^}]*grid-template-areas:\s*\n?\s*"heading tools close"\s*\n?\s*"views views views";/,
  );
  assert.match(
    rules,
    /@media \(max-width: 1100px\) \{[\s\S]*?\.terminal-window-header \{[^}]*grid-template-columns: minmax\(0, 1fr\) auto auto;/,
  );
  assert.match(
    rules,
    /@media \(max-width: 1100px\) \{[\s\S]*?#terminal-window-views\.terminal-window-views \{[^}]*overflow-x: auto;/,
  );
  // The narrow dialog mirrors .task-detail-modal's established full bleed inset.
  assert.match(
    rules,
    /@media \(max-width: 760px\) \{[\s\S]*?\.terminal-window-modal \{[^}]*width: calc\(100vw - \.75em\);/,
  );
  assert.match(
    rules,
    /@media \(max-width: 760px\) \{[\s\S]*?\.terminal-window-modal \{[^}]*max-height: calc\(100vh - \.75em\);/,
  );
  // The cluster shares the identity row with a truncating title at this width, so it gives
  // width back before the title has to truncate.
  assert.match(
    rules,
    /@media \(max-width: 760px\) \{[\s\S]*?#terminal-window-tools\.terminal-window-tools \.event-tools button \{[^}]*min-height: 30px;/,
  );
});

test('the empty-detail landmark draws a visible ring when focus is handed to it', () => {
  /*
   * focusTaskDetailLandmark() stamps a programmatic tabindex: -1 on this heading and moves
   * focus there when the terminal window auto-closes on a task that went away. CLAUDE.md
   * requires that focus stay visible.
   *
   * :focus is listed with :focus-visible on purpose. Browsers only match :focus-visible on a
   * programmatically focused non-input element when the previously focused element already
   * matched it, so after a mouse gesture a :focus-visible only rule would draw nothing in
   * exactly the case it exists for. tabindex: -1 is unreachable by Tab, so :focus here can
   * only ever mean this hand-off.
   *
   * The ring is --signal (4.88:1 on the panel's white surface), not the house #6daff4, which
   * measures 2.31:1, under the 3:1 floor for a focus indicator.
   *
   * The rule lives beside the other .empty-detail rules, outside the terminal window block.
   */
  assert.match(style, /\.empty-detail h2\[tabindex\]:focus-visible,/);
  assert.match(style, /\.empty-detail h2\[tabindex\]:focus \{[^}]*outline: 3px solid var\(--signal\);/s);
  assert.match(style, /\.empty-detail h2\[tabindex\]:focus \{[^}]*outline-offset: 4px;/s);
  // The region itself is the next candidate the landmark walk tries, so it rings too.
  assert.match(style, /\.empty-detail\[tabindex\]:focus-visible,/);
  /*
   * The house dark rule is html[data-theme="dark"] :where(... [tabindex]):focus-visible at
   * (0,2,1). The light rule above is (0,3,1) and outranks it, so the dark companion is
   * required rather than inherited.
   */
  assert.match(
    style,
    /html\[data-theme="dark"\] \.empty-detail h2\[tabindex\]:focus \{[^}]*outline-color: var\(--app-blue\);/s,
  );
});

test('the block trips neither style.css slicing trap', () => {
  const rules = windowRules();

  /*
   * Trap one. test/plan-visibility.test.mjs and test/task-diff-view.test.mjs both slice the
   * ledger palette with indexOf('.events-section {'), so that selector must stay exactly
   * that string. A comma extension would empty the slice.
   */
  assert.ok(style.includes('.events-section {'), 'the ledger selector is still exactly .events-section {');
  assert.doesNotMatch(style, /\.events-section,[\s\S]{0,200}?\{\s*\n\s*--term-bg/);
  const palette = style.slice(style.indexOf('.events-section {'), style.indexOf('/* Metrics strip'));
  assert.ok(palette.includes('--term-bg: #08090d;'), 'the sliced palette still carries the ledger tokens');
  assert.ok(palette.includes('container-type: size;'), 'the sliced palette still carries the ledger layout');
  assert.doesNotMatch(rules, /^\.events-section,/m);

  /*
   * Trap two. planner-board, plan-visibility, session-tasks-ui, provider-usage-ui and
   * task-diff-view all read the LAST reduce-mode motion query with lastIndexOf. Appending a
   * new one, or even a comment quoting the query text, moves that anchor into this block.
   */
  const anchor = '@media (prefers-reduced-motion: reduce)';
  assert.ok(!windowCssBlock().includes(anchor), 'the block never spells the reduce-mode anchor, comments included');
  const lastReduce = style.slice(style.lastIndexOf(anchor));
  assert.match(lastReduce, /\.planner-step-spinner \{ animation: none; \}/);
  assert.doesNotMatch(lastReduce, /term-plan|term-goal/);
  assert.doesNotMatch(lastReduce, /session-turn/);

  // Any motion this block introduces stays inside a no-preference guard instead.
  assert.doesNotMatch(rules, /@keyframes|animation:/);
  const guards = [...rules.matchAll(/@media \(prefers-reduced-motion: no-preference\) \{([\s\S]*?)\n\}/g)];
  const guarded = guards.reduce((total, match) => total + (match[1].match(/transition:/g) || []).length, 0);
  const declared = (rules.match(/transition:/g) || []).length;
  assert.ok(declared > 0, 'the block declares its interaction transition');
  assert.equal(declared, guarded, 'every transition in the block sits inside a no-preference guard');
  // The moved cluster animates on the same guarded transition as the rail and the close.
  assert.match(rules, /\.terminal-window-tools \.event-tools button,\n {2}\.terminal-window-close \{/);
});

test('no em dash characters reach the terminal window sources', () => {
  const emDash = String.fromCharCode(0x2014);
  assert.ok(!windowCssBlock().includes(emDash), 'public/style.css terminal window block has no em dash');
  const spec = readFileSync(new URL('./terminal-window-styles.test.mjs', import.meta.url), 'utf8');
  assert.ok(!spec.includes(emDash), 'test/terminal-window-styles.test.mjs has no em dash');
});
