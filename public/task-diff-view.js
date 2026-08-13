import { escapeHtml } from './escape-html.js';

/*
 * Pure markup and structure builders for the per-task Changes dialog.
 *
 * Everything here takes plain contract data and returns strings or plain objects, so the
 * whole surface is unit-testable without a DOM. Selection, folder collapse state, fetches
 * and the poll loop live in app.js; this module never reads or writes them.
 *
 * Every interpolated value in this file is provider-controlled or repository-controlled
 * text (paths, source lines, rename targets). All of it goes through escapeHtml.
 */

/*
 * The renderer caps its own row count so a runaway task cannot hand the browser tens of
 * thousands of buttons. This is deliberately NOT the same fact as summary.truncated,
 * which is the server refusing to enumerate more files. Both are reported, separately,
 * because "Relay stopped drawing" and "git stopped listing" are different truths.
 */
export const FILE_ROW_LIMIT = 400;

export const LIVE_TASK_STATUSES = ['running', 'open'];

const STATUS_LETTERS = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
};

const STATUS_LABELS = {
  added: 'Added',
  modified: 'Modified',
  deleted: 'Deleted',
  renamed: 'Renamed',
};

const REASON_TEXT = {
  'not-a-git-repository': 'This project folder is not a git repository.',
  'git-unavailable': 'Git is not available on this machine.',
  'baseline-failed': 'Relay could not capture a baseline when this task started.',
  'captured-before-diff-support': 'This task ran before change tracking existed.',
  'diff-failed': 'The changes could not be computed.',
};

const UNKNOWN_REASON_TEXT = 'Changes are not available for this task.';
const NO_CHANGES_TEXT = 'No file changes recorded.';

export function isLiveTaskStatus(status) {
  return LIVE_TASK_STATUSES.includes(String(status ?? ''));
}

/*
 * An unrecognised reason must never render as an empty panel. A future backend reason
 * this build has never heard of still has to say something true and non-alarming.
 */
export function diffReasonText(reason) {
  const key = String(reason ?? '');
  return Object.prototype.hasOwnProperty.call(REASON_TEXT, key) ? REASON_TEXT[key] : UNKNOWN_REASON_TEXT;
}

function normalizedStatus(status) {
  const key = String(status ?? '');
  return Object.prototype.hasOwnProperty.call(STATUS_LETTERS, key) ? key : 'modified';
}

export function statusLetter(status) {
  return STATUS_LETTERS[normalizedStatus(status)];
}

export function statusLabel(status) {
  return STATUS_LABELS[normalizedStatus(status)];
}

function countOf(value) {
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? Math.trunc(count) : 0;
}

function plural(count, word) {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

/*
 * Locale-free ordering. localeCompare would let an ICU build difference reorder the tree
 * between machines and make the file list look unstable across refreshes.
 */
function compareNames(left, right) {
  const lowerLeft = left.toLowerCase();
  const lowerRight = right.toLowerCase();
  if (lowerLeft !== lowerRight) return lowerLeft < lowerRight ? -1 : 1;
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function sortNode(node) {
  node.folders.sort((left, right) => compareNames(left.name, right.name));
  node.files.sort((left, right) => compareNames(left.name, right.name));
  for (const folder of node.folders) sortNode(folder);
  return node;
}

/*
 * Build a nested folder tree from the flat contract file list. Paths are repository
 * relative and forward slashed; empty segments (a leading slash, a doubled slash) are
 * dropped rather than becoming nameless folders.
 */
export function buildFileTree(files) {
  const root = { name: '', path: '', folders: [], files: [] };
  const folders = new Map([['', root]]);
  for (const file of files || []) {
    const path = String(file?.path ?? '');
    if (!path) continue;
    const segments = path.split('/').filter((segment) => segment !== '');
    if (!segments.length) continue;
    const name = segments.pop();
    let parent = root;
    let prefix = '';
    for (const segment of segments) {
      prefix = prefix ? `${prefix}/${segment}` : segment;
      let folder = folders.get(prefix);
      if (!folder) {
        folder = { name: segment, path: prefix, folders: [], files: [] };
        folders.set(prefix, folder);
        parent.folders.push(folder);
      }
      parent = folder;
    }
    parent.files.push({ ...file, path, name });
  }
  return sortNode(root);
}

export function countTreeFiles(node) {
  let total = node?.files?.length || 0;
  for (const folder of node?.folders || []) total += countTreeFiles(folder);
  return total;
}

function countsMarkup(file) {
  const additions = countOf(file?.additions);
  const deletions = countOf(file?.deletions);
  return `<span class="task-diff-counts"><b>+${additions}</b><i>-${deletions}</i></span>`;
}

function fileRowMarkup(file, selectedPath) {
  const status = normalizedStatus(file?.status);
  const selected = selectedPath !== null && selectedPath === file.path;
  const additions = countOf(file?.additions);
  const deletions = countOf(file?.deletions);
  const renamedFrom = status === 'renamed' && file?.oldPath ? ` (renamed from ${file.oldPath})` : '';
  /*
   * The letter is decorative once the label is in the accessible name, and the path is
   * repeated there because the visible row only shows the basename.
   */
  const label = `${STATUS_LABELS[status]} ${file.path}${renamedFrom}, ${plural(additions, 'addition')}, ${plural(deletions, 'deletion')}`;
  return `
    <button
      type="button"
      class="task-diff-file-row"
      data-diff-path="${escapeHtml(file.path)}"
      data-status="${status}"
      data-selected="${selected}"
      ${selected ? 'aria-current="true"' : ''}
      title="${escapeHtml(file.path)}${escapeHtml(renamedFrom)}"
      aria-label="${escapeHtml(label)}"
    >
      <span class="task-diff-status" data-status="${status}" aria-hidden="true">${STATUS_LETTERS[status]}</span>
      <span class="task-diff-file-name">${escapeHtml(file.name)}</span>
      ${countsMarkup(file)}
    </button>
  `;
}

function folderMarkup(folder, options, children) {
  const open = options.collapsed?.has?.(folder.path) === true ? '' : ' open';
  const count = countTreeFiles(folder);
  return `
    <details class="task-diff-folder" data-folder-path="${escapeHtml(folder.path)}"${open}>
      <summary class="task-diff-folder-summary">
        <span class="task-diff-folder-name">${escapeHtml(folder.name)}</span>
        <span class="task-diff-folder-count">${count}</span>
      </summary>
      <div class="task-diff-folder-children">${children}</div>
    </details>
  `;
}

function renderTreeChildren(node, options) {
  const parts = [];
  // Folders first, then files, so the shape of the repository reads before its leaves.
  for (const folder of node.folders) {
    if (options.budget.remaining <= 0) break;
    const children = renderTreeChildren(folder, options);
    // A folder whose whole subtree fell outside the row budget would render as an empty
    // disclosure, so it is dropped and counted by the overflow line instead.
    if (!children) continue;
    parts.push(folderMarkup(folder, options, children));
  }
  for (const file of node.files) {
    if (options.budget.remaining <= 0) break;
    options.budget.remaining -= 1;
    parts.push(fileRowMarkup(file, options.selectedPath));
  }
  return parts.join('');
}

export function renderFileTree(tree, { selectedPath = null, collapsed = null } = {}) {
  const total = countTreeFiles(tree);
  if (!total) return `<p class="task-diff-tree-empty">${NO_CHANGES_TEXT}</p>`;
  const budget = { remaining: FILE_ROW_LIMIT };
  const markup = renderTreeChildren(tree, { selectedPath, collapsed, budget });
  const hidden = total - FILE_ROW_LIMIT;
  const overflow = hidden > 0
    ? `<p class="task-diff-tree-overflow">${hidden} more changed file${hidden === 1 ? '' : 's'} not shown.</p>`
    : '';
  return `<div class="task-diff-tree-root">${markup}</div>${overflow}`;
}

function hunkHeaderText(hunk) {
  const oldStart = countOf(hunk?.oldStart);
  const oldLines = countOf(hunk?.oldLines);
  const newStart = countOf(hunk?.newStart);
  const newLines = countOf(hunk?.newLines);
  return `@@ -${oldStart},${oldLines} +${newStart},${newLines} @@`;
}

function lineNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function cell(line, type) {
  if (!line) return null;
  return {
    number: lineNumber(type === 'add' ? line.newNumber : line.oldNumber),
    text: String(line.text ?? ''),
    type,
  };
}

/*
 * Pair a file's hunk lines into side-by-side rows.
 *
 * Context lines occupy both sides. Within a change block, the consecutive deletions and
 * the consecutive additions that follow them pair index by index; whichever run is longer
 * leaves an empty cell opposite its leftovers. An addition run followed by a further
 * deletion starts a new block, so a provider that emits them out of the usual order still
 * gets aligned output instead of one giant mispaired run.
 *
 * The contract has exactly three line types. A "\ No newline at end of file" marker
 * arrives as ordinary line text and is passed through untouched.
 */
export function pairHunkRows(hunks) {
  const rows = [];
  for (const hunk of hunks || []) {
    rows.push({ kind: 'hunk-header', text: hunkHeaderText(hunk), old: null, new: null });
    let deletions = [];
    let additions = [];
    const flush = () => {
      const span = Math.max(deletions.length, additions.length);
      for (let index = 0; index < span; index += 1) {
        rows.push({
          kind: 'row',
          old: cell(deletions[index], 'del'),
          new: cell(additions[index], 'add'),
        });
      }
      deletions = [];
      additions = [];
    };
    for (const line of hunk?.lines || []) {
      if (line?.type === 'del') {
        if (additions.length) flush();
        deletions.push(line);
      } else if (line?.type === 'add') {
        additions.push(line);
      } else {
        flush();
        rows.push({ kind: 'row', old: cell(line, 'context'), new: cell(line, 'context') });
      }
    }
    flush();
  }
  return rows;
}

function numberCellMarkup(entry, side) {
  const type = entry?.type || 'empty';
  const number = entry && entry.number !== null ? String(entry.number) : '';
  return `<span class="task-diff-num" data-side="${side}" data-type="${type}">${escapeHtml(number)}</span>`;
}

function textCellMarkup(entry, side) {
  const type = entry?.type || 'empty';
  return `<span class="task-diff-text" data-side="${side}" data-type="${type}">${escapeHtml(entry?.text ?? '')}</span>`;
}

function fileHeadingMarkup(file) {
  const status = normalizedStatus(file?.status);
  const path = String(file?.path ?? '');
  const renamed = status === 'renamed' && file?.oldPath
    ? `<span class="task-diff-file-rename">${escapeHtml(String(file.oldPath))} → ${escapeHtml(path)}</span>`
    : `<span class="task-diff-file-path">${escapeHtml(path)}</span>`;
  return `
    <div class="task-diff-file-heading">
      <span class="task-diff-status" data-status="${status}" aria-hidden="true">${STATUS_LETTERS[status]}</span>
      <span class="task-diff-file-status">${STATUS_LABELS[status]}</span>
      ${renamed}
    </div>
  `;
}

export function diffPlaceholderMarkup(text = 'Select a file to see its changes.') {
  return `<p class="task-diff-placeholder">${escapeHtml(text)}</p>`;
}

/*
 * `summaryEntry` is the matching row from the summary response. The per-file response
 * carries no counts of its own, so the too-large notice borrows them from there rather
 * than inventing numbers.
 */
export function renderFileDiff(file, summaryEntry = null) {
  if (!file) return diffPlaceholderMarkup();
  const heading = fileHeadingMarkup(file);
  if (file.binary === true) {
    return `${heading}<p class="task-diff-note">Binary file</p>`;
  }
  if (file.tooLarge === true) {
    const additions = countOf(summaryEntry?.additions);
    const deletions = countOf(summaryEntry?.deletions);
    return `${heading}<p class="task-diff-note">This file's diff is too large to display (+${additions} -${deletions}).</p>`;
  }
  const rows = pairHunkRows(file.hunks);
  if (!rows.length) {
    return `${heading}<p class="task-diff-note">No line changes recorded for this file.</p>`;
  }
  const cells = rows.map((row) => row.kind === 'hunk-header'
    ? `<span class="task-diff-hunk">${escapeHtml(row.text)}</span>`
    : [
      numberCellMarkup(row.old, 'old'),
      textCellMarkup(row.old, 'old'),
      numberCellMarkup(row.new, 'new'),
      textCellMarkup(row.new, 'new'),
    ].join('')).join('');
  const truncated = file.truncated === true
    ? '<p class="task-diff-note">This diff was shortened. Later changes in this file are not shown.</p>'
    : '';
  return `${heading}<div class="task-diff-grid">${cells}</div>${truncated}`;
}

export function diffTotalsText(summary) {
  const files = Array.isArray(summary?.files) ? summary.files.length : 0;
  return `${plural(files, 'file')} · +${countOf(summary?.totalAdditions)} -${countOf(summary?.totalDeletions)}`;
}

export function diffNoticeTexts(summary) {
  const notices = [];
  if (summary?.sharedTree === true) {
    notices.push('Other tasks ran in this project during this window; changes may overlap.');
  }
  if (summary?.truncated === true) notices.push('Showing first 500 changed files.');
  return notices;
}

export function renderDiffNotices(summary) {
  return diffNoticeTexts(summary)
    .map((notice) => `<p class="task-diff-notice">${escapeHtml(notice)}</p>`)
    .join('');
}

/*
 * The single place that decides what an unusable or empty diff says. `available: false`
 * always carries a reason; `available: true` with no files is the ordinary "nothing
 * changed yet" case and must not read as a failure.
 */
export function diffUnavailableText(summary) {
  if (!summary) return '';
  if (summary.available !== true) return diffReasonText(summary.reason);
  if (!Array.isArray(summary.files) || summary.files.length === 0) return NO_CHANGES_TEXT;
  return '';
}

export function renderDiffUnavailable(summary) {
  const text = diffUnavailableText(summary);
  return text ? `<p class="task-diff-unavailable">${escapeHtml(text)}</p>` : '';
}
