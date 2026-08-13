import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  FILE_ROW_LIMIT,
  buildFileTree,
  countTreeFiles,
  diffNoticeTexts,
  diffReasonText,
  diffTotalsText,
  diffUnavailableText,
  isLiveTaskStatus,
  pairHunkRows,
  renderFileDiff,
  renderFileTree,
  statusLetter,
} from '../public/task-diff-view.js';

const markup = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const style = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');
const viewModule = readFileSync(new URL('../public/task-diff-view.js', import.meta.url), 'utf8');

function summaryFile(path, overrides = {}) {
  return {
    path,
    oldPath: null,
    status: 'modified',
    additions: 3,
    deletions: 1,
    binary: false,
    ...overrides,
  };
}

function hunk(lines, overrides = {}) {
  return {
    oldStart: 1,
    oldLines: 4,
    newStart: 1,
    newLines: 4,
    lines,
    ...overrides,
  };
}

function diffCssBlock() {
  const start = style.indexOf('/* Task changes dialog');
  const end = style.indexOf('/* End task changes dialog');
  assert.ok(start >= 0 && end > start, 'the dialog stylesheet block is delimited by both markers');
  return style.slice(start, end);
}

function diffRules() {
  return diffCssBlock().replaceAll(/\/\*[\s\S]*?\*\//g, '');
}

const contextLine = (text, oldNumber, newNumber) => ({ type: 'context', oldNumber, newNumber, text });
const delLine = (text, oldNumber) => ({ type: 'del', oldNumber, newNumber: null, text });
const addLine = (text, newNumber) => ({ type: 'add', oldNumber: null, newNumber, text });

test('the file tree nests by folder and sorts folders before files', () => {
  const tree = buildFileTree([
    summaryFile('README.md'),
    summaryFile('src/app.js'),
    summaryFile('src/lib/deep/util.js'),
    summaryFile('src/Alpha.js'),
    summaryFile('public/style.css'),
  ]);

  assert.deepEqual(tree.folders.map((folder) => folder.name), ['public', 'src']);
  assert.deepEqual(tree.files.map((file) => file.name), ['README.md']);
  const src = tree.folders.find((folder) => folder.name === 'src');
  // Folders render ahead of files, and each group is ordered case insensitively.
  assert.deepEqual(src.folders.map((folder) => folder.name), ['lib']);
  assert.deepEqual(src.files.map((file) => file.name), ['Alpha.js', 'app.js']);
  assert.equal(src.folders[0].folders[0].path, 'src/lib/deep');
  assert.deepEqual(src.folders[0].folders[0].files.map((file) => file.path), ['src/lib/deep/util.js']);
  assert.equal(countTreeFiles(tree), 5);
});

test('the tree keeps the selection and honours collapsed folders', () => {
  const tree = buildFileTree([summaryFile('src/app.js'), summaryFile('src/lib/util.js')]);
  const open = renderFileTree(tree, { selectedPath: 'src/app.js', collapsed: new Map() });
  assert.match(open, /<details class="task-diff-folder" data-folder-path="src" open>/);
  assert.match(open, /data-diff-path="src\/app\.js"[\s\S]*?data-selected="true"/);
  assert.match(open, /aria-current="true"/);

  const collapsed = renderFileTree(tree, { selectedPath: null, collapsed: new Map([['src/lib', true]]) });
  assert.match(collapsed, /data-folder-path="src\/lib"(?!\s+open)/);
  assert.match(collapsed, /data-folder-path="src" open/);
  assert.doesNotMatch(collapsed, /data-selected="true"/);
});

test('the tree caps its rows and says how many files it is not drawing', () => {
  const files = Array.from({ length: FILE_ROW_LIMIT + 5 }, (unused, index) =>
    summaryFile(`src/file-${String(index).padStart(4, '0')}.js`));
  const rendered = renderFileTree(buildFileTree(files), {});

  assert.equal((rendered.match(/class="task-diff-file-row"/g) || []).length, FILE_ROW_LIMIT);
  assert.match(rendered, /5 more changed files not shown\./);
  // The renderer cap and the server truncation are separate facts with separate copy.
  assert.doesNotMatch(rendered, /Showing first 500/);
});

test('an empty change list is stated plainly rather than left blank', () => {
  assert.match(renderFileTree(buildFileTree([]), {}), /No file changes recorded\./);
  assert.equal(diffUnavailableText({ available: true, files: [] }), 'No file changes recorded.');
  assert.equal(diffUnavailableText({ available: true, files: [summaryFile('a.js')] }), '');
});

test('context lines occupy both sides and change runs pair index by index', () => {
  const rows = pairHunkRows([hunk([
    contextLine('const a = 1;', 1, 1),
    delLine('const b = 2;', 2),
    delLine('const c = 3;', 3),
    addLine('const b = 20;', 2),
    addLine('const c = 30;', 3),
    contextLine('export default a;', 4, 4),
  ])]);

  assert.equal(rows[0].kind, 'hunk-header');
  assert.equal(rows[0].text, '@@ -1,4 +1,4 @@');
  assert.deepEqual(rows[1], {
    kind: 'row',
    old: { number: 1, text: 'const a = 1;', type: 'context' },
    new: { number: 1, text: 'const a = 1;', type: 'context' },
  });
  assert.deepEqual(rows[2].old, { number: 2, text: 'const b = 2;', type: 'del' });
  assert.deepEqual(rows[2].new, { number: 2, text: 'const b = 20;', type: 'add' });
  assert.deepEqual(rows[3].old, { number: 3, text: 'const c = 3;', type: 'del' });
  assert.deepEqual(rows[3].new, { number: 3, text: 'const c = 30;', type: 'add' });
  assert.equal(rows[4].old.type, 'context');
  assert.equal(rows.length, 5);
});

test('uneven change runs leave an empty cell opposite the leftovers', () => {
  const moreDeletions = pairHunkRows([hunk([
    delLine('gone one', 1),
    delLine('gone two', 2),
    addLine('replacement', 1),
  ])]);
  assert.equal(moreDeletions[1].new.type, 'add');
  assert.equal(moreDeletions[2].old.text, 'gone two');
  assert.equal(moreDeletions[2].new, null);

  const moreAdditions = pairHunkRows([hunk([
    delLine('gone', 1),
    addLine('first', 1),
    addLine('second', 2),
  ])]);
  assert.equal(moreAdditions[2].old, null);
  assert.equal(moreAdditions[2].new.text, 'second');
});

test('an addition run followed by a deletion starts a new pairing block', () => {
  const rows = pairHunkRows([hunk([
    addLine('added first', 1),
    delLine('removed after', 1),
    addLine('added again', 2),
  ])]);

  // Without the block break the trailing deletion would pair against the first addition.
  assert.equal(rows[1].old, null);
  assert.equal(rows[1].new.text, 'added first');
  assert.equal(rows[2].old.text, 'removed after');
  assert.equal(rows[2].new.text, 'added again');
  assert.equal(rows.length, 3);
});

test('multiple hunks each keep their own header and pairing', () => {
  const rows = pairHunkRows([
    hunk([delLine('one', 1), addLine('uno', 1)]),
    hunk([contextLine('two', 9, 9)], { oldStart: 9, oldLines: 1, newStart: 9, newLines: 1 }),
  ]);

  assert.deepEqual(rows.map((row) => row.kind), ['hunk-header', 'row', 'hunk-header', 'row']);
  assert.equal(rows[2].text, '@@ -9,1 +9,1 @@');
});

test('a no-newline marker passes through as ordinary line text', () => {
  const marker = '\\ No newline at end of file';
  const rows = pairHunkRows([hunk([delLine('last', 1), addLine('last', 1), contextLine(marker, 2, 2)])]);

  assert.equal(rows.at(-1).old.text, marker);
  assert.equal(rows.at(-1).old.type, 'context');
  assert.match(renderFileDiff({ path: 'a.txt', status: 'modified', hunks: [hunk([contextLine(marker, 1, 1)])] }), /No newline at end of file/);
});

test('repository controlled paths and line text cannot inject markup', () => {
  const attackPath = 'src/<script>alert("x")</script>.js';
  const attackLine = '<img src=x onerror=alert(1)> "quoted" \'single\'';
  const tree = renderFileTree(buildFileTree([summaryFile(attackPath, { status: 'renamed', oldPath: attackPath })]), {
    selectedPath: attackPath,
  });
  const diff = renderFileDiff({
    path: attackPath,
    oldPath: attackPath,
    status: 'renamed',
    hunks: [hunk([addLine(attackLine, 1)])],
  });

  for (const rendered of [tree, diff]) {
    assert.doesNotMatch(rendered, /<script>/);
    assert.doesNotMatch(rendered, /<img/);
    assert.match(rendered, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;\.js/);
  }
  assert.match(diff, /&lt;img src=x onerror=alert\(1\)&gt; &quot;quoted&quot; &#39;single&#39;/);
});

test('binary, too large, and shortened files state their limits honestly', () => {
  const binary = renderFileDiff({ path: 'logo.png', status: 'added', binary: false, hunks: [] });
  assert.match(binary, /No line changes recorded for this file\./);

  assert.match(
    renderFileDiff({ path: 'logo.png', status: 'added', binary: true, hunks: [] }),
    /Binary file/,
  );
  assert.match(
    renderFileDiff(
      { path: 'huge.json', status: 'modified', tooLarge: true, hunks: [] },
      summaryFile('huge.json', { additions: 9001, deletions: 42 }),
    ),
    /too large to display \(\+9001 -42\)\./,
  );
  assert.match(
    renderFileDiff({ path: 'a.js', status: 'modified', truncated: true, hunks: [hunk([addLine('x', 1)])] }),
    /This diff was shortened\./,
  );
});

test('a one sided file still renders every row', () => {
  const deleted = renderFileDiff({
    path: 'gone.js',
    status: 'deleted',
    hunks: [hunk([delLine('const gone = true;', 1)])],
  });

  assert.match(deleted, /data-type="del"[^>]*>const gone = true;/);
  assert.match(deleted, /class="task-diff-num" data-side="new" data-type="empty"/);
  assert.match(deleted, /class="task-diff-status" data-status="deleted"/);
  assert.equal(statusLetter('deleted'), 'D');
  assert.equal(statusLetter('unknown-future-status'), 'M');
});

test('every unavailable reason maps to its agreed sentence', () => {
  assert.equal(diffReasonText('not-a-git-repository'), 'This project folder is not a git repository.');
  assert.equal(diffReasonText('git-unavailable'), 'Git is not available on this machine.');
  assert.equal(diffReasonText('baseline-failed'), 'Relay could not capture a baseline when this task started.');
  assert.equal(diffReasonText('captured-before-diff-support'), 'This task ran before change tracking existed.');
  assert.equal(diffReasonText('diff-failed'), 'The changes could not be computed.');
  // A reason this build has never heard of still has to say something true.
  assert.equal(diffUnavailableText({ available: false, reason: 'invented-later' }), 'Changes are not available for this task.');
});

test('summary copy reports overlap, truncation, and totals', () => {
  assert.deepEqual(diffNoticeTexts({ sharedTree: true, truncated: true }), [
    'Other tasks ran in this project during this window; changes may overlap.',
    'Showing first 500 changed files.',
  ]);
  assert.deepEqual(diffNoticeTexts({ sharedTree: false, truncated: false }), []);
  assert.equal(
    diffTotalsText({ files: [summaryFile('a.js'), summaryFile('b.js')], totalAdditions: 12, totalDeletions: 4 }),
    '2 files · +12 -4',
  );
  assert.equal(diffTotalsText({ files: [summaryFile('a.js')], totalAdditions: 1, totalDeletions: 0 }), '1 file · +1 -0');
});

test('only running and open count as a live task for the badge and the poll', () => {
  assert.equal(isLiveTaskStatus('running'), true);
  assert.equal(isLiveTaskStatus('open'), true);
  for (const status of ['complete', 'failed', 'cancelled', 'interrupted', 'queued', 'completed']) {
    assert.equal(isLiveTaskStatus(status), false, `${status} must not read as live`);
  }
});

test('the changes dialog is a native modal beside the other dialogs', () => {
  assert.match(markup, /<dialog id="task-diff-modal" class="terminal-settings-modal task-diff-modal" aria-labelledby="task-diff-title">/);
  assert.match(markup, /id="task-diff-close"[^>]*class="terminal-settings-close"[^>]*aria-label="Close changes"/);
  assert.match(markup, /class="task-diff-surface"/);
  assert.match(markup, /id="task-diff-tree"/);
  assert.match(markup, /id="task-diff-file"/);
  // The dialog owns its own markup and never borrows the task detail modal's body.
  const detailModal = markup.slice(markup.indexOf('<dialog id="task-detail-modal"'));
  assert.doesNotMatch(detailModal.slice(0, detailModal.indexOf('</dialog>')), /task-diff-/);
});

test('the Changes action is capability gated and never guesses at legacy tasks', () => {
  assert.match(app, /import \{[\s\S]*?\} from '\.\/task-diff-view\.js';/);
  assert.match(app, /state\.status\?\.capabilities\?\.taskDiffPreview === true/);
  // diffState null means legacy or not started: the feature stays hidden entirely.
  assert.match(app, /task\.diffState\?\.baseline \|\| task\.diffState\?\.error/);
  assert.match(app, /actionButton\('Changes'/);
});

test('closing the dialog returns focus to the rebuilt trigger without stealing it', () => {
  /*
   * selectTask replaces the whole action row every two seconds, so the node the native
   * dialog stored as its opener is detached by the time the reader closes and focus falls
   * to the body. The trigger is found again by marker, never held as a reference.
   */
  assert.match(app, /changesButton\.dataset\.taskDiffTrigger = String\(task\.id\)/);
  // The repair is conditional: a task-switch close must not pull focus off the new target.
  assert.match(app, /document\.activeElement === document\.body/);
  assert.match(app, /if \(orphaned\) elements\.detailActions\.querySelector\('\[data-task-diff-trigger\]'\)\?\.focus\(\);/);
});

test('the dialog skips redundant rewrites and stops its own poll', () => {
  assert.match(app, /elements\.taskDiffTree\.dataset\.signature === signature/);
  assert.match(app, /elements\.taskDiffFile\.dataset\.signature === signature/);
  assert.match(app, /window\.clearInterval\(state\.taskDiff\.pollTimer\)/);
  assert.match(app, /elements\.taskDiffModal\.addEventListener\('close'/);
  assert.match(app, /document\.visibilityState === 'visible'/);
  // Server signatures are authoritative; the client must not mint a competing one.
  assert.doesNotMatch(app, /taskDiffSignature\s*\(/);
  // A poll driven rewrite must never destroy an active selection.
  assert.match(app, /await textSelectionGuard\.waitForClear\(\);[\s\S]{0,400}?taskDiff/);
});

test('a vanished task or file stops the poll instead of retrying forever', () => {
  assert.match(app, /failure\.status = response\.status;/);
  assert.match(app, /error\?\.status === 404/);
});

test('the diff surface carries the terminal palette without a dark theme override', () => {
  /*
   * plan-visibility.test.mjs slices the ledger palette with indexOf('.events-section {'),
   * so that selector is left exactly as it was and the dialog declares its own copy of the
   * same byte identical values. Both surfaces stay theme invariant.
   */
  const ledger = style.slice(style.indexOf('.events-section {'), style.indexOf('/* Metrics strip'));
  const surface = style.slice(
    style.indexOf('.task-diff-modal .task-diff-surface {'),
    style.indexOf('/* Task changes body'),
  );
  assert.ok(surface, 'the dialog surface declares its own palette block');
  for (const token of ['--term-bg: #08090d;', '--term-fg: #c3c8d2;', '--term-green: #9ece6a;', '--term-red: #f7768e;', '--term-blue: #7aa2f7;', '--term-muted: #7b818d;', '--term-meta: #6d7480;', '--term-panel: #131418;', '--term-panel2: #1b1d22;', '--term-border: #1c1e23;']) {
    assert.ok(ledger.includes(token), `${token} still belongs to the ledger`);
    assert.ok(surface.includes(token), `${token} must be byte identical on the diff surface`);
  }
  // Prose explaining the choice is not a rule, so the assertions read the rules alone.
  assert.doesNotMatch(diffRules(), /html\[data-theme="dark"\]/);
});

test('the diff panes scroll internally, collapse at 760px, and add no motion', () => {
  const diffCss = diffRules();
  assert.match(diffCss, /\.task-diff-body \{[^}]*grid-template-columns: 260px minmax\(0, 1fr\);/s);
  assert.match(diffCss, /\.task-diff-tree \{[^}]*overflow: auto;/s);
  assert.match(diffCss, /\.task-diff-file \{[^}]*overflow: auto;/s);
  assert.match(diffCss, /\.task-diff-text \{[^}]*white-space: pre;/s);
  assert.match(diffCss, /@media \(max-width: 760px\) \{[\s\S]*?\.task-diff-body \{[^}]*grid-template-columns: minmax\(0, 1fr\);/);
  assert.match(diffCss, /data-type="add"\]/);
  assert.match(diffCss, /data-type="del"\]/);
  assert.match(diffCss, /:focus-visible/);

  /*
   * planner-board.test.mjs, plan-visibility.test.mjs and session-tasks-ui.test.mjs all read
   * the LAST reduce block in this file. Appending one here would silently break all three.
   */
  assert.doesNotMatch(diffCss, /prefers-reduced-motion: reduce/);
  assert.doesNotMatch(diffCss, /@keyframes|animation:/);
  const lastReduce = style.slice(style.lastIndexOf('@media (prefers-reduced-motion: reduce)'));
  assert.match(lastReduce, /\.planner-step-spinner \{ animation: none; \}/);
});

test('no em dash characters reach the diff sources', () => {
  const emDash = String.fromCharCode(0x2014);
  for (const [name, source] of Object.entries({
    'public/task-diff-view.js': viewModule,
    'test/task-diff-view.test.mjs': readFileSync(new URL('./task-diff-view.test.mjs', import.meta.url), 'utf8'),
  })) {
    assert.ok(!source.includes(emDash), `${name} must not contain an em dash`);
  }
});
