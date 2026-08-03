import { execFile as execFileCallback } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';
import {
  ClaudeExecutionError,
  consumeClaudeStreamMessage,
  taskPrompt,
} from './claude-execution-runner.mjs';
import {
  assistantRecordText,
  attachmentRewrittenPrompts,
  bracketedPastePayload,
  createTranscriptReader,
  fsTranscriptSource,
  injectionPromptIssue,
  isTurnFinalAssistantRecord,
  resolveClaudeTranscriptPath,
  submittedPromptMatches,
  userPromptRecordText,
} from './claude-transcript-tail.mjs';

const execFile = promisify(execFileCallback);
const delay = (milliseconds) => new Promise((done) => setTimeout(done, milliseconds));

// JXA passes the payload through argv, so no AppleScript string escaping is involved and
// leading dashes, quotes, and newlines survive intact (verified in the injection spike).
const INJECT_JXA = "function run(argv){var id=parseInt(argv[0],10);var text=argv[1];"
  + "var term=Application('Terminal');var win=term.windows.byId(id);"
  + "term.doScript(text,{in:win.tabs[0]});return 'ok';}";

async function osascriptType(terminalWindowId, payload) {
  await execFile(
    'osascript',
    ['-l', 'JavaScript', '-e', INJECT_JXA, String(terminalWindowId), payload],
    { timeout: 15_000 },
  );
}

// Reads the VISIBLE screen of the exact owned Terminal tab. Terminal exposes both `contents`
// (the viewport) and `history` (the whole scrollback). Measured live on Darwin 25.5.0: three
// real tabs returned 2493, 3025, and 3110 characters for `contents` against 42323, 6270, and
// 323389 for `history`. Only the viewport is read, so a long council run cannot hand this
// classifier megabytes and cannot match a dialog phrase that scrolled by an hour ago.
//
// Defensive per the [[resume-dispatch-audit]] lesson: one unreadable window, tab, or contents
// value must degrade into a distinguishable failure result, never abort with a raw throw. The
// caller treats every failure as "no screen evidence" and keeps today's behavior.
const READ_SCREEN_JXA = `function run(argv) {
  var result = { ok: false, reason: 'unknown', text: '' };
  try {
    var id = parseInt(argv[0], 10);
    var term = Application('Terminal');
    var running = false;
    try { running = term.running(); } catch (error) { running = false; }
    if (!running) { result.reason = 'terminal-not-running'; return JSON.stringify(result); }
    var win = null;
    try { win = term.windows.byId(id); } catch (error) { win = null; }
    if (!win) { result.reason = 'window-missing'; return JSON.stringify(result); }
    var tabs = null;
    try { tabs = win.tabs(); } catch (error) { tabs = null; }
    if (!tabs || tabs.length < 1) { result.reason = 'tabs-unreadable'; return JSON.stringify(result); }
    var contents = null;
    try { contents = tabs[0].contents(); } catch (error) { contents = null; }
    if (typeof contents !== 'string') { result.reason = 'contents-unreadable'; return JSON.stringify(result); }
    result.ok = true;
    result.reason = 'read';
    result.text = contents;
    return JSON.stringify(result);
  } catch (error) {
    result.reason = String(error);
    return JSON.stringify(result);
  }
}`;

// Never throws. A screen snapshot is a protective enhancement, so an osascript failure, a denied
// Automation grant, or a closed window degrades to "no evidence" instead of failing a turn.
async function defaultReadScreen(terminalWindowId) {
  if (process.platform !== 'darwin') {
    return { ok: false, reason: 'unsupported-platform', text: '' };
  }
  let stdout = '';
  try {
    ({ stdout = '' } = await execFile(
      'osascript',
      ['-l', 'JavaScript', '-e', READ_SCREEN_JXA, String(terminalWindowId)],
      { timeout: 5_000, maxBuffer: 2 * 1024 * 1024 },
    ));
  } catch (error) {
    return { ok: false, reason: `osascript-failed: ${error.message}`, text: '' };
  }
  try {
    const parsed = JSON.parse(stdout || '{}');
    if (!parsed?.ok || typeof parsed.text !== 'string') {
      return { ok: false, reason: String(parsed?.reason || 'unreadable'), text: '' };
    }
    return { ok: true, reason: 'read', text: parsed.text };
  } catch (error) {
    return { ok: false, reason: `unparsable-screen: ${error.message}`, text: '' };
  }
}

// Sends raw key bytes into the exact owned tab through the same Apple Event channel as injection.
// Terminal's do script APPENDS a Return to whatever it types, which is deliberate for both callers:
// the resume-picker arrow needs a confirming Return, and a Ctrl+C that cleared the composer leaves
// the appended Return pressing an empty composer, which does nothing.
async function defaultSendKeys(terminalWindowId, keys, type = osascriptType) {
  await type(terminalWindowId, keys);
}

async function defaultInject(terminalWindowId, text) {
  // Bracketed paste makes the interactive TUI insert multiline text literally. Terminal's
  // do script normally appends Return, but Claude can intentionally collapse a large paste
  // and leave it in the composer instead of accepting that Return. watchTurn detects that
  // no turn started and sends one separate whitespace-plus-Return action as a guarded nudge.
  await osascriptType(terminalWindowId, bracketedPastePayload(text));
}

export async function submitHeldTerminalPaste(terminalWindowId, type = osascriptType) {
  // Keep this separate from the bracketed-paste Apple Event. An empty do script can report
  // success without moving Claude's large-paste widget on current Terminal/Claude versions.
  // A trailing space is harmless prompt whitespace, makes the Apple Event nonempty, and
  // Terminal appends the distinct Return that submits the held paste.
  await type(terminalWindowId, ' ');
}

async function defaultRelaunch(terminalWindowId, command) {
  // Claude has already returned control to the shell in this exact tab. Terminal do script
  // executes the launch command and appends Return, so this does not depend on TUI key handling.
  await osascriptType(terminalWindowId, command);
}

function defaultIsProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    if (error?.code === 'EPERM') return true;
    throw error;
  }
}

async function defaultTerminateProcess(pid) {
  try {
    process.kill(pid, 'SIGTERM');
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
  }
}

async function defaultSendCancel(terminalWindowId) {
  // Best-effort interrupt: ESC stops the running turn in the Claude TUI. This is the same
  // Automation channel as injection; System Events keystrokes are Accessibility-gated and
  // were denied in the spike, so they are intentionally not used here.
  await osascriptType(terminalWindowId, String.fromCharCode(27));
}

function defaultOpenTranscript({ cwd, sessionId }) {
  return fsTranscriptSource(resolveClaudeTranscriptPath(cwd, sessionId));
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

function selectedTerminalModel(model) {
  if (!model || model === 'default') return null;
  return model === 'best' ? 'fable' : model;
}

// Absolute paths of the images CC Relay wrote for this task, in the order they are referenced in
// the delivered prompt. They are both the directories a plan-mode session must be able to read and
// the only path references Claude's composer is expected to rewrite.
function taskAttachmentPaths(task) {
  return (task?.attachments || [])
    .map((attachment) => attachment?.path)
    .filter((path) => typeof path === 'string' && path);
}

function terminalExecutionSettings(task) {
  const model = selectedTerminalModel(task.model);
  const effort = typeof task.effort === 'string' && task.effort.trim()
    ? task.effort.trim()
    : null;
  const permissionMode = task.terminal_permission_mode === 'plan' ? 'plan' : null;
  const tools = Array.isArray(task.terminal_tools)
    ? [...new Set(task.terminal_tools.filter((tool) => typeof tool === 'string' && tool.trim()).map((tool) => tool.trim()))]
    : [];
  const addDirectories = permissionMode === 'plan'
    ? [...new Set(taskAttachmentPaths(task).map((path) => dirname(path)))]
    : [];
  return {
    model,
    effort,
    permissionMode,
    tools,
    addDirectories,
    apply: Boolean(model || effort || permissionMode || tools.length || addDirectories.length),
  };
}

function inactivityLimitLabel(milliseconds) {
  const minutes = Math.round(milliseconds / 60_000);
  if (minutes >= 1) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const seconds = Math.max(1, Math.round(milliseconds / 1_000));
  return `${seconds} second${seconds === 1 ? '' : 's'}`;
}

function terminalSettingsDescription({ model, effort, permissionMode }) {
  const modelText = model || 'the account default model';
  const effortText = effort ? `${effort} effort` : 'the account default effort';
  const permissionText = permissionMode === 'plan' ? ' in read-only plan mode' : '';
  return `${modelText} at ${effortText}${permissionText}`;
}

const MAX_HOOK_STRING_LENGTH = 20_000;
const MAX_HOOK_COLLECTION_ITEMS = 100;
const MAX_HOOK_VALUE_DEPTH = 6;

function clippedHookString(value) {
  const text = String(value ?? '');
  if (text.length <= MAX_HOOK_STRING_LENGTH) return text;
  return `${text.slice(0, MAX_HOOK_STRING_LENGTH)}\n[CC Relay truncated ${text.length - MAX_HOOK_STRING_LENGTH} characters]`;
}

function compactHookValue(value, depth = 0) {
  if (typeof value === 'string') return clippedHookString(value);
  if (value === null || ['number', 'boolean'].includes(typeof value)) return value;
  if (depth >= MAX_HOOK_VALUE_DEPTH) return '[CC Relay truncated nested hook data]';
  if (Array.isArray(value)) {
    const compact = value
      .slice(0, MAX_HOOK_COLLECTION_ITEMS)
      .map((item) => compactHookValue(item, depth + 1));
    if (value.length > compact.length) {
      compact.push(`[CC Relay truncated ${value.length - compact.length} array items]`);
    }
    return compact;
  }
  if (!value || typeof value !== 'object') return String(value ?? '');
  const entries = Object.entries(value).slice(0, MAX_HOOK_COLLECTION_ITEMS);
  const compact = Object.fromEntries(
    entries.map(([key, item]) => [key, compactHookValue(item, depth + 1)]),
  );
  if (Object.keys(value).length > entries.length) {
    compact.__relayTruncated = `${Object.keys(value).length - entries.length} object fields`;
  }
  return compact;
}

function hookResultText(payload) {
  if (payload?.hook_event_name === 'PostToolUseFailure') {
    return clippedHookString(payload.error || 'Claude tool call failed.');
  }
  const response = payload?.tool_response;
  if (typeof response === 'string') return clippedHookString(response);
  if (response && typeof response === 'object') {
    const readable = [
      response.stdout,
      response.stderr,
      typeof response.content === 'string' ? response.content : null,
    ].filter((value) => typeof value === 'string' && value);
    if (readable.length) return clippedHookString(readable.join('\n'));
  }
  try {
    return clippedHookString(JSON.stringify(compactHookValue(response)) || '');
  } catch {
    return '';
  }
}

function itemEventKey(emitted) {
  const type = emitted?.event?.type;
  const itemId = emitted?.event?.item?.id;
  if (!itemId || !['item/started', 'item/completed'].includes(type)) return null;
  return `${type}:${itemId}`;
}

function normalizedMessageText(value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

// ---- terminal screen classification -----------------------------------------------------
//
// Task 39 (July 30, 2026) proved that `claude agents --json` idle is NOT proof that the composer
// is accepting input. Claude Code 2.1.220 shows a blocking resume picker for a session that is
// both over an hour inactive and over 100k tokens, and the session registers as idle the whole
// time that dialog is displayed. CC Relay pasted a 201-line council prompt into that picker, the
// Return that Terminal appends confirmed the highlighted default (a 2.5 minute compaction), and
// the prompt was destroyed. There is no CLI flag and no settings key that suppresses the picker in
// 2.1.220, and this repository does not add environment variables, so CC Relay reads the screen.
//
// Every pattern below is a named export so tests pin the observed contract and so a Claude Code
// upgrade that changes the TUI can be re-pointed in one place. All of them are byte-verified
// against Claude Code 2.1.220: rendered pty frames captured at 100x40, 60x30, and 44x30, plus a
// live Terminal.app tab read through `contents()` on Darwin 25.5.0. The two shapes are:
//
//   composer                              resume picker
//   ─────────────────────────────         ─────────────────────────────
//   ❯ [Pasted text #2 +11 lines]            This session is 4h 30m old and 215.6k tokens.
//   ─────────────────────────────
//     user@host:/path…                      Resuming the full session will consume a substantial
//     paste again to expand                 portion of your usage limits. We recommend resuming
//                              /rc          from a summary.
//
//                                           ❯ 1. Resume from summary (recommended)
//                                             2. Resume full session as-is
//                                             3. Don't ask me again
//
//                                           Enter to confirm · Esc to cancel
//
// Three facts drive the design. The `❯` pointer is NOT a composer signal: it also marks the
// selected row of every dialog and prefixes replayed user messages, so dialogs are classified
// first and the composer needs its own positive evidence. The picker renders BELOW the replayed
// transcript, so its phrases must be matched line-anchored at the bottom of the screen and never
// as a substring of the whole screen: any CC Relay session that discusses this bug would otherwise
// match itself. And the status row is not one stable string, so it is an any-of family.

// Only the tail of the viewport is classified. The tallest dialog observed is the picker at 44
// columns, where wrapping gives it eleven non-empty lines, so fifteen covers it with margin while
// keeping ordinary transcript text out of dialog matching.
export const CLAUDE_SCREEN_TAIL_LINES = 15;
export const CLAUDE_SCREEN_TAIL_CHARS = 8_000;

// The composer caret. `❯` is what 2.1.220 draws; `>` is kept as a plain-ASCII fallback for a
// terminal or version that cannot render the glyph.
export const CLAUDE_COMPOSER_CARET_PATTERN = /^[❯>]/;
// The horizontal rules that bound the composer, including a boxed rendering's `╰────╯` edge.
// Anchored to the WHOLE line on purpose: an unanchored version matched any content line that
// merely contained eight dashes, so a prompt carrying a `--------` separator would have been read
// as the end of the composer box and truncated the text this file classifies.
export const CLAUDE_SCREEN_RULE_PATTERN = /^[╭╮╰╯┌┐└┘├┤┼─━═_-]{8,}$/;
// The bottom status row, and the positive evidence that a composer is on screen. It is deliberately
// an any-of family: the row swaps content by state. A held multi-line paste REPLACES
// "shift+tab to cycle" with "paste again to expand", so requiring the former would report
// not-ready at exactly the moment CC Relay has just pasted. "bypass permissions on" renders only
// on the --dangerously-skip-permissions launch branch and is absent for every council stage, which
// launches with --permission-mode plan, so it can never be the only marker in the list. The
// Ctrl-C hint is transient and only appears just after a clear, so it is never polled for.
export const CLAUDE_COMPOSER_STATUS_ROW_PATTERNS = [
  /shift\+tab to cycle/i,
  /paste again to expand/i,
  /Press Ctrl-C again to exit/i,
  /bypass permissions on/i,
];
// A numbered dialog row, for example `❯ 1. Resume from summary (recommended)`. A row like this is
// never treated as the composer caret.
export const CLAUDE_DIALOG_OPTION_PATTERN = /^[❯>›*•]?\s*\d[.)]\s+\S/;
// Verified literal: `Enter to confirm · Esc to cancel`, with a U+00B7 middle dot. Only the stable
// left half is matched.
export const CLAUDE_DIALOG_FOOTER_PATTERN = /enter to confirm/i;
// The 2.1.220 large-session resume picker, matched line-anchored on its option rows. The pointer is
// U+276F and marks the selected row only. "Don't" carries an ASCII apostrophe, never a curly one.
// The title and the body sentence are deliberately NOT matched: both wrap below 100 columns.
export const CLAUDE_RESUME_PICKER_OPTION_PATTERN = /^\s*(?:❯\s*)?[123][.)]\s+(?:Resume from summary|Resume full session|Don't ask me again)/;
// The folder trust prompt. Same chrome, same select widget, shown before any resume picker for an
// untrusted directory. CC Relay classifies it only to refuse it: trusting a folder is a user
// security decision and is never automated.
export const CLAUDE_TRUST_DIALOG_OPTION_PATTERN = /^\s*(?:❯\s*)?[12][.)]\s+(?:Yes, I trust this folder|No, exit)/;
// At least this many distinct option rows, plus the footer, plus the selection pointer on one of
// those rows, before a screen counts as that dialog.
export const CLAUDE_DIALOG_MIN_OPTION_ROWS = 2;
// U+276F, drawn on the selected row of a live select widget and on no other row. Requiring it
// somewhere in the matched row set NARROWS the verbatim-quotation false positive; it does not
// eliminate it. This repository's own wiki contains those exact option rows, and a byte-verbatim
// quote that also reproduces the pointer line, in the bottom fifteen lines, alongside a footer
// line, still matches. The residual cost of that case is bounded to two stray keystrokes and then
// a fail-closed error, because the post-resolution snapshot never shows the dialog gone. A false
// negative from this tightening degrades to 'unknown', which fails closed before injection without
// typing anything, so the tightening itself can only ever cost a manual retry.
export const CLAUDE_DIALOG_POINTER_PATTERN = /^\s*❯/;
// Option 2, "Resume full session as-is". Verified live: the bare ASCII digit both selects AND
// confirms in one keystroke, the composer appears, and no compaction runs. CC Relay deliberately
// never takes option 1: exact-context fidelity is the entire point of resuming a council stage or
// a continuation, and that path runs a multi-minute summarization inside the launch window. It
// never sends "3", which persists resumeReturnDismissed into the user's ~/.claude.json, and never
// a bare Return, which confirms the highlighted option 1.
export const CLAUDE_RESUME_PICKER_KEYS = '2';
// Once-only fallback if the digit did not clear the picker: the down arrow moves the pointer to
// option 2 and the Return that do script appends confirms it.
export const CLAUDE_RESUME_PICKER_FALLBACK_KEYS = `${String.fromCharCode(27)}[B`;
// Clears text from the Claude composer. Verified: one press with text clears it and the process
// stays alive; one press with an empty composer only draws a transient "Press Ctrl-C again to
// exit" hint. A second press inside that hint window exits Claude, which would destroy the owned
// terminal mid-task, so every sender goes through sendComposerClear and its spacing invariant.
export const CLAUDE_COMPOSER_CLEAR_KEYS = String.fromCharCode(3);
// A bracketed paste of four or more lines does NOT render its text. It collapses to this
// placeholder, where the second capture is the line count minus one and the first is a per-session
// paste counter. Verifying that the prompt TEXT is visible therefore cannot work for a normal CC
// Relay prompt, and the placeholder plus its line count is the only usable held signal.
export const CLAUDE_PASTE_PLACEHOLDER_PATTERN = /\[Pasted text #(\d+) \+(\d+) lines\]/;
export const CLAUDE_PASTE_COLLAPSE_MIN_LINES = 4;
// Attachment chips render before the placeholder. Task 39's composer held exactly
// `[Image #3] [Image #4][Pasted text #5 +201 lines]`.
export const CLAUDE_IMAGE_CHIP_PATTERN = /\[Image #\d+\]/;
// How far above the bottom of the tail the composer caret may sit. Measured on every captured
// frame the caret is the fourth non-empty line from the end. This bound is what stops a replayed
// `❯ user message` that happens to sit above a dialog's rule from reading as a composer box.
export const CLAUDE_COMPOSER_MAX_TAIL_DEPTH = 8;
// Placeholder text an empty composer can draw, treated as empty rather than as unsubmitted junk.
// VERIFIED EMPTY, not merely unfilled: captured 2.1.220 frames at 100x40, 60x30, and 44x30 all
// render an empty composer as the bare caret with nothing after it, and so does a live
// Terminal.app read. The hook stays exported because a future build could add placeholder text,
// and because anything added here must be weighed carefully: every pattern is anchored at the
// start of the composer text, so a wrong one would classify a real held paste that merely begins
// with those words as empty and deliver the prompt a second time. A duplicate delivery is far
// worse than a missed recovery, since an unmatched placeholder still reaches the single Ctrl+C
// and the bounded re-arm.
export const CLAUDE_COMPOSER_EMPTY_PLACEHOLDER_PATTERNS = [];
// How much of the prompt's first line has to be visible for the composer to count as holding this
// turn's paste. Long enough to be specific, short enough to survive the composer wrapping the line.
export const CLAUDE_COMPOSER_ANCHOR_CHARS = 40;

// Terminal contents() is already plain text, so the escape-sequence strip is defensive only.
// Both patterns are anchored on real control bytes, never on a bare bracket, because
// [Pasted text #5 +201 lines] and [Image #3] are exactly the composer chips this file must see.
const ANSI_SEQUENCE_PATTERN = new RegExp('\\u001b\\[[0-9;?]*[a-zA-Z]', 'g');
const SCREEN_CONTROL_CHARACTER_PATTERN = new RegExp('[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f]', 'g');

function normalizeScreenLine(line) {
  return String(line ?? '')
    .replace(ANSI_SEQUENCE_PATTERN, '')
    .replace(SCREEN_CONTROL_CHARACTER_PATTERN, '')
    // Vertical box borders belong to the frame, not to the content inside it.
    .replace(/^[\s│┃|┆┇┊┋]+/, '')
    .replace(/[\s│┃|┆┇┊┋]+$/, '');
}

// Trailing non-empty lines of the visible screen, in order, bounded twice: by characters before
// splitting and by line count after it.
export function claudeScreenTailLines(text, limit = CLAUDE_SCREEN_TAIL_LINES) {
  if (typeof text !== 'string' || !text) return [];
  const bounded = text.length > CLAUDE_SCREEN_TAIL_CHARS
    ? text.slice(-CLAUDE_SCREEN_TAIL_CHARS)
    : text;
  const lines = bounded
    .split(/\r?\n/)
    .map(normalizeScreenLine)
    .filter((line) => line !== '');
  return limit > 0 ? lines.slice(-limit) : lines;
}

// A known dialog is only recognized from its own option ROWS plus its footer, never from prose
// that quotes them. Both parts are required: the rows prove the select widget is rendered, and the
// footer proves it is waiting for a keystroke.
function matchesDialog(lines, optionPattern) {
  const tail = Array.isArray(lines) ? lines : claudeScreenTailLines(lines);
  const rows = new Set();
  let pointed = false;
  for (const line of tail) {
    if (!optionPattern.test(line)) continue;
    rows.add(line.replace(/^\s*❯\s*/, '').trim());
    if (CLAUDE_DIALOG_POINTER_PATTERN.test(line)) pointed = true;
  }
  if (rows.size < CLAUDE_DIALOG_MIN_OPTION_ROWS) return false;
  // The pointer is optional per row (only the selected row carries it) and required across the
  // row set, which is the difference between a live widget and quoted text.
  if (!pointed) return false;
  return tail.some((line) => CLAUDE_DIALOG_FOOTER_PATTERN.test(line));
}

export function isClaudeResumePickerScreen(lines) {
  return matchesDialog(lines, CLAUDE_RESUME_PICKER_OPTION_PATTERN);
}

export function isClaudeTrustDialogScreen(lines) {
  return matchesDialog(lines, CLAUDE_TRUST_DIALOG_OPTION_PATTERN);
}

// The text currently sitting in the composer, or found:false when the composer box is not visible.
// found:false is never treated as evidence of anything: the caller keeps its pre-change behavior.
export function claudeComposerContent(text) {
  const lines = claudeScreenTailLines(text);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (!CLAUDE_COMPOSER_CARET_PATTERN.test(line)) continue;
    // `❯ 1. Resume from summary (recommended)` is a highlighted dialog row, not the composer.
    if (CLAUDE_DIALOG_OPTION_PATTERN.test(line)) continue;
    // The caret also prefixes replayed user messages higher up the transcript. The composer box
    // always sits at the bottom with only its closing rule and two or three chrome lines below it.
    if (lines.length - index > CLAUDE_COMPOSER_MAX_TAIL_DEPTH) continue;
    const next = lines[index + 1];
    const closedByRule = typeof next === 'string' && CLAUDE_SCREEN_RULE_PATTERN.test(next);
    const followedByChrome = lines
      .slice(index + 1)
      .some((value) => CLAUDE_COMPOSER_STATUS_ROW_PATTERNS.some((pattern) => pattern.test(value)));
    // The composer is a caret line inside its own box. A bare caret line with neither the closing
    // rule nor the status row under it is some other rendering, so it stays unrecognized.
    if (!closedByRule && !followedByChrome) continue;
    // The composer ends at its CLOSING rule, which is the last rule line below the caret, not the
    // first one. A multi-line prompt is allowed to contain its own separator line: stopping at the
    // first rule would silently truncate the text this file then classifies. Status chrome never
    // renders a full rule line, so the last rule below the caret is always the box edge.
    let closing = -1;
    for (let cursor = lines.length - 1; cursor > index; cursor -= 1) {
      if (CLAUDE_SCREEN_RULE_PATTERN.test(lines[cursor])) {
        closing = cursor;
        break;
      }
    }
    const body = [line.replace(CLAUDE_COMPOSER_CARET_PATTERN, '')];
    const end = closing > index ? closing : lines.length;
    for (let cursor = index + 1; cursor < end; cursor += 1) {
      const candidate = lines[cursor];
      // Without a closing rule the status row underneath is the only boundary available.
      if (CLAUDE_COMPOSER_STATUS_ROW_PATTERNS.some((pattern) => pattern.test(candidate))) break;
      body.push(candidate);
    }
    return { found: true, text: body.join('\n').trim() };
  }
  return { found: false, text: '' };
}

// 'composer' means CC Relay positively saw the input prompt and may type. 'resume-picker' and
// 'trust-dialog' are the two known blocking dialogs: the first has a defined safe resolution, the
// second is a user security decision CC Relay refuses to make. 'unknown' is everything else,
// including a dialog nobody has seen yet, and CC Relay must never type into it.
export function classifyClaudeScreen(text) {
  const lines = claudeScreenTailLines(text);
  if (lines.length === 0) return 'unknown';
  // Dialogs first, always. Their selected row carries the same pointer glyph as the composer
  // caret, so composer detection cannot be allowed to see them.
  if (isClaudeResumePickerScreen(lines)) return 'resume-picker';
  if (isClaudeTrustDialogScreen(lines)) return 'trust-dialog';
  // Positive composer evidence: the bottom status row family, or the composer box itself. Either
  // alone is enough, because the status row disappears in states the box survives and vice versa.
  const statusRow = lines
    .some((line) => CLAUDE_COMPOSER_STATUS_ROW_PATTERNS.some((pattern) => pattern.test(line)));
  return statusRow || claudeComposerContent(text).found ? 'composer' : 'unknown';
}

// What Claude's collapsed-paste placeholder must report for THIS prompt: the pasted line count
// minus one. Verified on a live paste that rendered `[Pasted text #2 +11 lines]` for twelve lines.
// The raw prompt is the right input even though injection pastes the sanitized form:
// sanitizeInjectedPrompt only removes ESC bytes in place and can never add or drop a line.
export function expectedPastePlaceholderLines(prompt) {
  return Math.max(0, String(prompt ?? '').split(/\r?\n/).length - 1);
}

function promptComposerAnchor(prompt) {
  const first = String(prompt ?? '')
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .find((line) => line !== '') || '';
  // Under three characters is not a distinctive anchor. Such a turn falls back to the clear and
  // re-inject path, which still delivers the exact prompt.
  return first.length >= 3 ? first.slice(0, CLAUDE_COMPOSER_ANCHOR_CHARS) : '';
}

// What the composer is holding relative to THIS turn's prompt:
// 'held'       the paste is visibly there and only needs its Return,
// 'empty'      the paste is provably gone, so re-delivering it is the only recovery,
// 'junk'       some other unsubmitted text is in the way,
// 'unreadable' the composer box was not recognized, so nothing was proved either way.
export function claudeComposerState(screenText, prompt) {
  const composer = claudeComposerContent(screenText);
  if (!composer.found) return 'unreadable';
  const normalized = composer.text.replace(/\s+/g, ' ').trim();
  // A live empty composer renders as the bare caret with nothing after it, verified on captured
  // frames at three widths. There is no placeholder text to mistake for content.
  if (!normalized) return 'empty';
  const placeholder = CLAUDE_PASTE_PLACEHOLDER_PATTERN.exec(composer.text);
  if (placeholder) {
    // The placeholder is the primary held signal for any prompt of four or more lines, which is
    // every real CC Relay prompt. Its line count identifies WHICH paste is being held, so a
    // foreign paste sitting in the composer is not mistaken for this turn's prompt and submitted.
    const expected = expectedPastePlaceholderLines(prompt);
    // A one to three line paste never collapses, so a placeholder against a short prompt is
    // provably somebody else's text no matter what count it reports.
    if (expected + 1 < CLAUDE_PASTE_COLLAPSE_MIN_LINES) return 'junk';
    // One line of tolerance absorbs a trailing-newline difference in how the count is derived.
    return Math.abs(Number(placeholder[2]) - expected) <= 1 ? 'held' : 'junk';
  }
  // A one to three line paste renders literally, so its first line is the anchor. Attachment
  // chips render before it and are tolerated because the check is a containment test.
  const anchor = promptComposerAnchor(prompt);
  if (anchor && normalized.includes(anchor)) return 'held';
  if (CLAUDE_COMPOSER_EMPTY_PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return 'empty';
  }
  // Image chips with no text at all are still this turn's delivery in flight, never foreign text.
  if (CLAUDE_IMAGE_CHIP_PATTERN.test(normalized) && !normalized.replace(new RegExp(CLAUDE_IMAGE_CHIP_PATTERN.source, 'g'), '').trim()) {
    return 'held';
  }
  return 'junk';
}

// A short, single-line, control-character-free excerpt of what is on screen, so a user who is told
// CC Relay refused to type can see WHAT is blocking without opening the terminal.
export function claudeScreenExcerpt(text, { lines = 4, maxChars = 240 } = {}) {
  const tail = claudeScreenTailLines(text).slice(-lines);
  const joined = tail.join(' | ').replace(/\s+/g, ' ').trim();
  if (!joined) return '';
  return joined.length > maxChars ? `${joined.slice(0, maxChars)}...` : joined;
}

export function claudeTerminalRelaunchCommand({
  command = 'claude',
  sessionId,
  resumed = false,
  model = null,
  effort = null,
  permissionMode = null,
  tools = [],
  addDirectories = [],
  settings = null,
} = {}) {
  return [
    shellQuote(command),
    ...(permissionMode
      ? ['--permission-mode', shellQuote(permissionMode)]
      : ['--dangerously-skip-permissions']),
    resumed ? '--resume' : '--session-id',
    shellQuote(sessionId),
    ...(model ? ['--model', shellQuote(model)] : []),
    ...(effort ? ['--effort', shellQuote(effort)] : []),
    ...(tools.length ? ['--tools', shellQuote(tools.join(','))] : []),
    ...addDirectories.flatMap((directory) => ['--add-dir', shellQuote(directory)]),
    ...(settings ? ['--settings', shellQuote(JSON.stringify(settings))] : []),
  ].join(' ');
}

// Drives a queued turn inside the interactive Claude terminal on macOS by typing the
// prompt into the exact owned Terminal.app window and mirroring the session transcript
// back into CC Relay's Task Activity. The run outcome matches the headless runner exactly:
// { finalResponse, sessionId, reportedSessionId, exitCode }.
export class ClaudeTerminalExecutor {
  constructor({
    command = 'claude',
    sessions,
    resolveTerminal = null,
    requestAttention = null,
    hookBridge = null,
    inject = defaultInject,
    submit = submitHeldTerminalPaste,
    relaunch = defaultRelaunch,
    terminateProcess = defaultTerminateProcess,
    isProcessAlive = defaultIsProcessAlive,
    sendCancel = defaultSendCancel,
    // Reads the visible screen of the exact owned tab. Session status alone cannot tell a live
    // composer apart from a blocking dialog, which is how task 39 typed a council prompt into the
    // resume picker. A reader that fails never fails a turn: verification degrades to the former
    // status-only readiness and the former blind submit action.
    readScreen = defaultReadScreen,
    // Raw key bytes into the same tab, for resolving a known dialog and for clearing the composer.
    sendKeys = defaultSendKeys,
    openTranscript = defaultOpenTranscript,
    wait = delay,
    now = Date.now,
    readinessTimeoutMs = 15_000,
    processExitTimeoutMs = 10_000,
    // Raised from 20 s: a resumed large session can now have to resolve the resume picker AND then
    // load the full unmodified conversation before its composer appears, and both happen inside
    // this window. Task 39's own session was 187.2k tokens.
    relaunchTimeoutMs = 30_000,
    // How long to let the TUI redraw after CC Relay sends dialog keys, before re-reading the screen.
    screenSettleMs = 1_500,
    // Resolution attempts for one displayed resume picker. Two means one retry; after that the
    // user is told to resolve it by hand rather than having CC Relay keep pressing keys blindly.
    maxResumePickerResolutions = 2,
    // A lost paste is re-delivered at most this many times per turn, ever. Re-injection is
    // recovery from a provably empty composer, never a general retry.
    maxPromptReinjections = 1,
    // Hard safety spacing between two Ctrl+C presses in one terminal. Claude exits when a second
    // press lands inside its "Press Ctrl-C again to exit" hint window, which is a couple of
    // seconds, so this is deliberately far wider than the hint itself.
    composerClearSpacingMs = 5_000,
    relaunchSettleMs = 250,
    restartPollMs = 250,
    // How long a pasted prompt may sit with no submission evidence before the turn fails. It
    // must comfortably contain the whole guarded submit schedule below plus time to observe the
    // last attempt's evidence. Task 39 (July 30, 2026) failed at the former 20 seconds while the
    // composer still held a 201-line paste that a manual Return submitted instantly.
    submissionTimeoutMs = 80_000,
    // Delay before the FIRST guarded submit attempt. Claude Code collapses a large paste into a
    // composer widget and can swallow the Return that Terminal appends to the paste Apple Event.
    // Task 39 proved 1.5 seconds is far too early: the TUI was still converting a 201-line paste
    // and its image paths into attachment chips, so the nudge Return was swallowed exactly like
    // the pasted one. Keep it under ~8 seconds so an ordinary small prompt still recovers fast.
    submitNudgeMs = 6_000,
    // Bounded recovery: at most this many separate submit actions per turn, ever.
    maxSubmitAttempts = 4,
    // Spacing between guarded attempts, growing by submitRetryBackoffMs each time. With the
    // defaults the attempts land near 6 s, 15 s, 27 s, and 42 s after injection. Evidence of a
    // successful submission (hook, transcript anchor, or busy) appears well inside one gap, so a
    // landed Return always stops the schedule before the next attempt.
    submitRetryMs = 9_000,
    submitRetryBackoffMs = 3_000,
    // An attempt is only allowed while this much of the submission window still remains. Pressing
    // Return with no time left to observe its evidence proves nothing and only risks a keystroke.
    submitConfirmMs = 15_000,
    promptAcceptanceTimeoutMs = 5 * 60 * 1_000,
    pollMs = 800,
    idleGraceObservations = 4,
    finalIdleObservations = 2,
    sessionMissingGrace = 3,
    heartbeatMs = 30_000,
    // Legacy name for the safety ceiling below. It once bounded total turn duration; it now
    // bounds continuous inactivity. Kept as the default source for inactivityCeilingMs so any
    // remaining caller keeps configuring the same guard.
    turnCeilingMs = 45 * 60 * 1_000,
    // The watcher fails a turn only after this much time with no observed activity at all:
    // no new transcript records, no busy session status, and no transcript growth. A session
    // that keeps working never fails on elapsed time alone; the user cancels it explicitly.
    inactivityCeilingMs = turnCeilingMs,
    maxPromptBytes = 100_000,
    // A live update is acknowledged only by its exact UserPromptSubmit hook or transcript
    // record. The first pause gives Claude's multiline paste widget time to settle before one
    // guarded Return; the outer bound keeps an ambiguous terminal delivery from hanging HTTP.
    steerSubmitNudgeMs = 6_000,
    steerAcceptanceTimeoutMs = 25_000,
    statRetryAttempts = 3,
    statRetryDelayMs = 100,
  } = {}) {
    this.command = command;
    this.sessions = sessions;
    this.resolveTerminal = resolveTerminal;
    this.requestAttention = requestAttention;
    this.hookBridge = hookBridge;
    this.inject = inject;
    this.submit = submit;
    this.relaunch = relaunch;
    this.terminateProcess = terminateProcess;
    this.isProcessAlive = isProcessAlive;
    this.sendCancel = sendCancel;
    this.readScreen = readScreen;
    this.sendKeys = sendKeys;
    this.openTranscript = openTranscript;
    this.wait = wait;
    this.now = now;
    this.readinessTimeoutMs = readinessTimeoutMs;
    this.processExitTimeoutMs = processExitTimeoutMs;
    this.relaunchTimeoutMs = relaunchTimeoutMs;
    this.screenSettleMs = screenSettleMs;
    this.maxResumePickerResolutions = maxResumePickerResolutions;
    this.maxPromptReinjections = maxPromptReinjections;
    this.composerClearSpacingMs = composerClearSpacingMs;
    this.relaunchSettleMs = relaunchSettleMs;
    this.restartPollMs = restartPollMs;
    this.submissionTimeoutMs = submissionTimeoutMs;
    this.submitNudgeMs = submitNudgeMs;
    this.maxSubmitAttempts = maxSubmitAttempts;
    this.submitRetryMs = submitRetryMs;
    this.submitRetryBackoffMs = submitRetryBackoffMs;
    this.submitConfirmMs = submitConfirmMs;
    this.promptAcceptanceTimeoutMs = promptAcceptanceTimeoutMs;
    this.pollMs = pollMs;
    this.idleGraceObservations = idleGraceObservations;
    this.finalIdleObservations = finalIdleObservations;
    this.sessionMissingGrace = sessionMissingGrace;
    this.heartbeatMs = heartbeatMs;
    this.inactivityCeilingMs = inactivityCeilingMs;
    this.maxPromptBytes = maxPromptBytes;
    this.steerSubmitNudgeMs = steerSubmitNudgeMs;
    this.steerAcceptanceTimeoutMs = steerAcceptanceTimeoutMs;
    this.statRetryAttempts = statRetryAttempts;
    this.statRetryDelayMs = statRetryDelayMs;
  }

  async runTurn(task, active, session, terminal, { onEvent, onStderr }) {
    const sessionId = task.thread_id;
    const source = this.openTranscript({ cwd: task.repo_path, sessionId });

    // Classify the transcript BEFORE readiness. A freshly launched terminal has no file, so its
    // first turn legitimately starts at offset 0; an established session has one. Unreadable
    // metadata is neither state and must fail before typing. This is captured once, decoupled
    // in time from the offset read below, so a later stat failure cannot turn an established
    // session into a fresh one (Issue 14).
    const initialTranscriptState = this.transcriptState(source);
    if (active.cancelRequested) {
      throw new ClaudeExecutionError('Task cancelled.', { cancelled: true });
    }
    if (initialTranscriptState === 'unreadable') {
      throw new ClaudeExecutionError(
        `CC Relay could not inspect the Claude transcript for ${task.thread_name || sessionId} before typing, so it cannot tell whether this is a fresh or established conversation. Nothing was typed. Retry when the transcript is readable.`,
        { retryable: true },
      );
    }
    const resumed = initialTranscriptState === 'present';

    await this.ensureReady(task, active, onEvent);

    // Pre-flight prompt validation before typing (deterministic, pre-injection).
    const prompt = taskPrompt(task);
    const promptIssue = injectionPromptIssue(prompt, { maxBytes: this.maxPromptBytes });
    if (promptIssue) {
      throw new ClaudeExecutionError(`CC Relay cannot type this prompt into the terminal: ${promptIssue}`, { retryable: false });
    }

    const hookRegistration = this.hookBridge?.register?.(sessionId) || null;
    try {
      const settings = terminalExecutionSettings(task);
      // One shared record for the whole turn: how many times the resume dialog was answered, and
      // whether the degraded-verification notice was already said. Bounds must not reset when the
      // relaunch gate hands off to the pre-injection gate and then to the submit schedule.
      const screens = this.createScreenState();
      let activeTerminal = terminal;
      if (settings.apply) {
        // Model and effort are process launch options in Claude Code. Restart only after proving
        // that the live pid still belongs to this exact window and tty. The same session is then
        // restored in the same tab with the task's selected launch flags.
        const verified = await this.verifyTerminalIdentity(task, active, activeTerminal, { requireIdle: true });
        if (!verified?.session || !verified?.terminal) {
          throw new ClaudeExecutionError(
            `CC Relay cannot apply the selected Claude model and effort because it could not resolve the exact ${task.thread_name || sessionId} terminal. Nothing was typed.`,
            { retryable: true },
          );
        }
        activeTerminal = await this.relaunchForTask(
          task,
          active,
          verified.session,
          verified.terminal,
          resumed,
          settings,
          onEvent,
          hookRegistration?.settings || null,
          screens,
        );
      }

      if (active.cancelRequested) {
        throw new ClaudeExecutionError('Task cancelled.', { cancelled: true });
      }

      // Re-verify the exact window and tty still belong to the live session's current pid
      // immediately before typing. This also validates the new pid after a settings relaunch.
      const injectionIdentity = await this.verifyTerminalIdentity(task, active, activeTerminal, { requireIdle: true });
      if (injectionIdentity?.terminal) activeTerminal = injectionIdentity.terminal;

      // Positive composer detection before anything is typed, on every path. The relaunch gate
      // above only runs when settings.apply is true; a plain continuation resumed by the
      // disposable pool launch reaches here with no relaunch at all and can show Claude Code
      // 2.1.220's resume picker just the same, because the picker depends on the conversation's
      // age and size, not on how it was started. This gate is deliberately fail-closed: nothing
      // has been typed yet, so refusing an unrecognized screen costs one manual retry, while
      // typing into a dialog costs the whole prompt (task 39, July 30, 2026).
      await this.ensureComposerScreen(
        task,
        active,
        activeTerminal.terminalWindowId,
        this.now() + this.readinessTimeoutMs,
        onEvent,
        screens,
      );

      // With a composer proven present, make sure it is EMPTY before pasting into it. Leftover
      // unsubmitted text plus a fresh paste is a corrupted prompt, and the user photographed
      // exactly that state during the incident.
      await this.normalizeComposerBeforePaste(
        task,
        active,
        activeTerminal.terminalWindowId,
        onEvent,
        screens,
      );

      // Establish where this turn's transcript records begin. Computed before announcing the
      // turn so a pre-injection stat failure on a resumed session leaves no dangling started
      // event, and never has to fall back to offset 0 where a stale end_turn could complete the
      // task with an earlier response (Issue 14).
      const injectionOffset = await this.resolveInjectionOffset(task, active, source, resumed);

      const reader = createTranscriptReader(source, injectionOffset);

      try {
        await this.inject(activeTerminal.terminalWindowId, prompt);
      } catch (error) {
        // A do script osascript timeout can fire after Terminal.app already delivered and
        // processed the Apple Event, so the prompt may have been submitted. Never auto-retry
        // (that would run the turn twice); require an explicit manual retry.
        throw new ClaudeExecutionError(
          `CC Relay could not confirm it typed the prompt into the ${task.thread_name || sessionId} terminal: ${error.message}. The prompt may already be running, so CC Relay will not retry automatically. Check the terminal before retrying.`,
          { retryable: false },
        );
      }

      onEvent({
        event: {
          type: 'claude/progress',
          provider: 'claude',
          sessionId,
          deliveryState: 'injected',
        },
        message: `CC Relay pasted the prompt into the ${task.thread_name || sessionId} terminal and is verifying that Claude accepted this exact message.`,
      });

      return await this.watchTurn(task, active, activeTerminal, source, reader, injectionOffset, {
        onEvent,
        onStderr,
        transcriptInitiallyAbsent: initialTranscriptState === 'absent',
        hookRegistration,
        prompt,
        settings,
        screenState: screens,
      });
    } finally {
      active.closeSteering?.();
      active.closeSteering = null;
      hookRegistration?.deactivate?.();
    }
  }

  // Per-turn screen-verification state. Kept in one object so the picker resolution bound and the
  // degraded-verification notice are shared by the relaunch gate, the pre-injection gate, and the
  // guarded submit schedule instead of resetting at every call site.
  createScreenState() {
    return {
      pickerResolutions: 0,
      degradedAnnounced: false,
      reinjections: 0,
      // When the last Ctrl+C was sent into this terminal, which is what keeps two presses from
      // ever landing inside Claude's exit-hint window.
      lastComposerClearAt: null,
      // Latched the moment a snapshot positively shows the composer holding text that is NOT this
      // turn's prompt, and retired only by a later READABLE snapshot showing it gone. While it is
      // set, no Return may be sent, including down the otherwise fail-open blind path: an
      // unreadable screen is not proof that foreign text left the composer.
      junkUnproven: false,
    };
  }

  // One snapshot of the exact owned tab. Never throws and never fails a turn: an unreadable screen
  // returns ok:false and every caller falls back to the behavior it had before screen verification
  // existed. This is a protective enhancement, so it must not become a new failure source.
  async inspectTerminalScreen(terminalWindowId) {
    const failure = (reason) => ({
      ok: false,
      reason: String(reason || 'unreadable'),
      classification: 'unknown',
      text: '',
      excerpt: '',
    });
    if (typeof this.readScreen !== 'function') return failure('no-reader');
    let result = null;
    try {
      result = await this.readScreen(terminalWindowId);
    } catch (error) {
      return failure(`reader-threw: ${error.message}`);
    }
    if (!result?.ok || typeof result.text !== 'string') {
      return failure(result?.reason);
    }
    return {
      ok: true,
      reason: 'read',
      classification: classifyClaudeScreen(result.text),
      text: result.text,
      excerpt: claudeScreenExcerpt(result.text),
    };
  }

  // Said once per turn. Screen verification is degraded, not broken: readiness falls back to the
  // session status alone, exactly as every build before this change behaved.
  announceDegradedScreenVerification(task, onEvent, screenState, reason) {
    if (!screenState || screenState.degradedAnnounced) return;
    screenState.degradedAnnounced = true;
    onEvent({
      event: {
        type: 'claude/progress',
        provider: 'claude',
        sessionId: task.thread_id,
        deliveryState: 'screen-unverified',
        screenReason: String(reason || 'unreadable'),
      },
      message: `CC Relay could not read the ${task.thread_name || task.thread_id} terminal screen, so it is verifying readiness from the Claude session status alone.`,
    });
  }

  blockedScreenError(task, excerpt) {
    const shown = excerpt ? ` The terminal currently shows: ${excerpt}` : '';
    // The scroll hint is deliberate. CC Relay reads the VISIBLE viewport, so a window the user
    // scrolled up hides its own composer and reaches this error even though Claude is perfectly
    // healthy. Naming that makes the one false-positive path self-correcting.
    return new ClaudeExecutionError(
      `The ${task.thread_name || task.thread_id} Claude terminal is showing something other than its prompt composer, so CC Relay did not type anything.${shown} Open the terminal, resolve what is on screen or scroll back to the bottom, then retry.`,
      { retryable: false },
    );
  }

  // The folder trust prompt. CC Relay classifies it only in order to refuse it: answering it would
  // grant Claude read, edit, and execute access to a directory on the user's behalf, which is a
  // security decision that belongs to the user and to nobody else.
  // `pasted` is true when this is reached from the guarded submit schedule, where the prompt is
  // already in the terminal. Claiming "nothing was typed" there would be false and would send the
  // user to a retry that ignores an in-flight paste.
  trustDialogError(task, { pasted = false } = {}) {
    const name = task.thread_name || task.thread_id;
    return new ClaudeExecutionError(
      pasted
        ? `The ${name} Claude terminal is showing the folder trust prompt, and CC Relay had already pasted this task's prompt. That paste may still be held in the composer or may already be running, so CC Relay did not press Return and will not retry automatically. CC Relay never answers the trust prompt for you. Answer it in the terminal, check the prompt, then retry.`
        : `The ${name} Claude terminal is waiting on the folder trust prompt, so CC Relay did not type anything. CC Relay never answers that prompt for you. Answer it in the terminal, then retry.`,
      { retryable: false },
    );
  }

  // One Ctrl+C, never two close together. A second press inside Claude's own "Press Ctrl-C again to
  // exit" hint window exits the CLI and would destroy this owned terminal mid-task, so the spacing
  // is enforced here in code rather than left to the call sites to remember. Both senders (the
  // pre-injection residue clear and the junk clear inside the submit schedule) go through this.
  async sendComposerClear(terminalWindowId, screenState) {
    const last = screenState?.lastComposerClearAt;
    if (typeof last === 'number') {
      const since = this.now() - last;
      if (since < this.composerClearSpacingMs) {
        await this.wait(this.composerClearSpacingMs - since);
      }
    }
    if (screenState) screenState.lastComposerClearAt = this.now();
    await this.sendKeys(terminalWindowId, CLAUDE_COMPOSER_CLEAR_KEYS);
  }

  // Resolves the Claude Code 2.1.220 large-session resume picker by selecting option 2, "Resume
  // full session as-is". Called only when the snapshot taken immediately before proved the picker
  // is displayed, so these keys can never land in a live composer.
  //
  // The first resolution sends the bare digit, which is verified to select AND confirm in one
  // keystroke. Terminal's do script appends a Return to it; that Return lands on the composer the
  // dialog just left behind, where an empty or whitespace-only submit is verified to fire no hook
  // and start no turn. The once-only fallback is the down arrow, whose appended Return is what
  // confirms option 2. Neither path can ever take option 1 (a real summarization turn) or option 3
  // (which persists a preference into the user's own configuration).
  async resolveResumePickerScreen(task, terminalWindowId, onEvent, screenState, { pasted = false } = {}) {
    const sessionId = task.thread_id;
    if (screenState.pickerResolutions >= this.maxResumePickerResolutions) {
      // Reachable from the guarded submit schedule too, where the prompt is already in the
      // terminal, so the exhaustion message has to be true in both phases.
      const attempts = `after CC Relay tried ${screenState.pickerResolutions} times to choose Resume full session as-is`;
      throw new ClaudeExecutionError(
        pasted
          ? `The ${task.thread_name || sessionId} Claude terminal kept showing the resume dialog for a large conversation ${attempts}. CC Relay had already pasted this task's prompt, which the dialog may have swallowed, so it will not retry automatically. Open the terminal, choose that option yourself, check the prompt, then retry.`
          : `The ${task.thread_name || sessionId} Claude terminal kept showing the resume dialog for a large conversation ${attempts}. Nothing was typed. Open the terminal, choose that option yourself, then retry.`,
        { retryable: false },
      );
    }
    const keys = screenState.pickerResolutions === 0
      ? CLAUDE_RESUME_PICKER_KEYS
      : CLAUDE_RESUME_PICKER_FALLBACK_KEYS;
    screenState.pickerResolutions += 1;
    onEvent({
      event: {
        type: 'claude/progress',
        provider: 'claude',
        sessionId,
        deliveryState: 'resume-picker-resolved',
        resumePickerAttempt: screenState.pickerResolutions,
        resumePickerChoice: 'continue',
      },
      message: `The terminal showed the Claude resume dialog for a large conversation. CC Relay selected Resume full session as-is before typing the prompt.`,
    });
    try {
      await this.sendKeys(terminalWindowId, keys);
    } catch (error) {
      // Reachable from the guarded submit schedule too, where the prompt is already in the
      // terminal, so this failure gets the same state-aware split as the exhaustion message above.
      throw new ClaudeExecutionError(
        pasted
          ? `CC Relay could not answer the Claude resume dialog in the ${task.thread_name || sessionId} terminal: ${error.message}. CC Relay had already pasted this task's prompt, which the dialog may have swallowed, so it will not retry automatically. Resolve the dialog in the terminal, check the prompt, then retry.`
          : `CC Relay could not answer the Claude resume dialog in the ${task.thread_name || sessionId} terminal: ${error.message}. Nothing was typed. Resolve the dialog in the terminal, then retry.`,
        { retryable: false },
      );
    }
    // Let the TUI finish loading and redrawing before deciding whether the dialog is gone.
    await this.wait(this.screenSettleMs);
    return this.inspectTerminalScreen(terminalWindowId);
  }

  // Residue normalization, run once immediately before the paste and only after the gate proved a
  // composer is on screen. The incident screenshot showed leftover unsubmitted text sitting in an
  // owned terminal; pasting on top of that produces a prompt that is not the task's prompt. One
  // Ctrl+C clears it. A composer that is already clean receives NO keystroke at all, so the common
  // path is unchanged. Residue that survives the clear fails closed: CC Relay never pastes on top
  // of text it does not understand.
  async normalizeComposerBeforePaste(task, active, terminalWindowId, onEvent, screenState) {
    const screen = await this.inspectTerminalScreen(terminalWindowId);
    if (!screen.ok) {
      // Degrading silently here would hide that CC Relay pasted without checking for residue.
      this.announceDegradedScreenVerification(task, onEvent, screenState, screen.reason);
      return { cleared: false, degraded: true };
    }
    const composer = claudeComposerContent(screen.text);
    if (!composer.found || !composer.text.trim()) return { cleared: false, degraded: false };
    if (active.cancelRequested) {
      throw new ClaudeExecutionError('Task cancelled.', { cancelled: true });
    }
    onEvent({
      event: {
        type: 'claude/progress',
        provider: 'claude',
        sessionId: task.thread_id,
        deliveryState: 'composer-cleared',
      },
      message: `The ${task.thread_name || task.thread_id} terminal composer was holding leftover text, so CC Relay cleared it before pasting this task's prompt.`,
    });
    try {
      await this.sendComposerClear(terminalWindowId, screenState);
    } catch (error) {
      throw new ClaudeExecutionError(
        `The ${task.thread_name || task.thread_id} Claude terminal composer is holding leftover text and CC Relay could not clear it: ${error.message}. Nothing was typed. Clear the terminal, then retry.`,
        { retryable: false },
      );
    }
    await this.wait(this.screenSettleMs);
    const after = await this.inspectTerminalScreen(terminalWindowId);
    // Both awaits above can span a cancel. Nothing has been pasted yet, so this aborts cleanly.
    if (active.cancelRequested) {
      throw new ClaudeExecutionError('Task cancelled.', { cancelled: true });
    }
    // An unreadable re-check is not proof the clear failed, and the clear itself reported success,
    // so this degrades to the pre-change behavior instead of inventing a failure.
    if (!after.ok) {
      this.announceDegradedScreenVerification(task, onEvent, screenState, after.reason);
      return { cleared: true, degraded: true };
    }
    const remaining = claudeComposerContent(after.text);
    if (remaining.found && remaining.text.trim()) {
      throw new ClaudeExecutionError(
        // The excerpt is taken from the COMPOSER text, not from the screen tail: the screen tail
        // would show the status row underneath it, which tells the user nothing about the residue.
        `The ${task.thread_name || task.thread_id} Claude terminal composer is still holding text that CC Relay could not clear, so it did not paste this task's prompt on top of it. Open the terminal, clear it, then retry. The composer shows: ${claudeScreenExcerpt(remaining.text, { lines: 3, maxChars: 120 })}`,
        { retryable: false },
      );
    }
    return { cleared: true, degraded: false };
  }

  // Positive composer detection before anything is typed. `claude agents --json` reports idle while
  // a blocking dialog is displayed, so status readiness alone is not an input-ready signal. Bounded
  // by the caller's deadline; a screen that never becomes a recognizable composer fails closed with
  // an excerpt of what is actually there, which also covers dialogs nobody has seen yet.
  async ensureComposerScreen(task, active, terminalWindowId, deadlineAt, onEvent, screenState) {
    let lastExcerpt = '';
    for (;;) {
      if (active.cancelRequested) {
        throw new ClaudeExecutionError('Task cancelled.', { cancelled: true });
      }
      const screen = await this.inspectTerminalScreen(terminalWindowId);
      if (!screen.ok) {
        this.announceDegradedScreenVerification(task, onEvent, screenState, screen.reason);
        return { verified: false, degraded: true };
      }
      if (screen.classification === 'composer') {
        return { verified: true, degraded: false };
      }
      if (screen.classification === 'trust-dialog') {
        throw this.trustDialogError(task);
      }
      if (screen.classification === 'resume-picker') {
        // The snapshot above is an await. Re-prove cancellation before answering a dialog for a
        // task the user just abandoned; nothing has been typed, so this aborts cleanly.
        if (active.cancelRequested) {
          throw new ClaudeExecutionError('Task cancelled.', { cancelled: true });
        }
        const after = await this.resolveResumePickerScreen(task, terminalWindowId, onEvent, screenState);
        if (!after.ok) {
          this.announceDegradedScreenVerification(task, onEvent, screenState, after.reason);
          return { verified: false, degraded: true };
        }
        if (after.classification === 'composer') {
          return { verified: true, degraded: false };
        }
        lastExcerpt = after.excerpt || lastExcerpt;
      } else {
        lastExcerpt = screen.excerpt || lastExcerpt;
      }
      if (this.now() >= deadlineAt) {
        throw this.blockedScreenError(task, lastExcerpt);
      }
      await this.wait(this.restartPollMs);
    }
  }

  async relaunchForTask(
    task,
    active,
    session,
    terminal,
    resumed,
    settings,
    onEvent,
    hookSettings = null,
    screenState = null,
  ) {
    const sessionId = task.thread_id;
    const processId = Number(session.pid);
    if (!Number.isInteger(processId) || processId <= 0) {
      throw new ClaudeExecutionError(
        `CC Relay could not identify the Claude process in the ${task.thread_name || sessionId} terminal, so it did not change settings or type the prompt.`,
        { retryable: true },
      );
    }

    let alive;
    try {
      alive = await this.isProcessAlive(processId);
    } catch (error) {
      throw new ClaudeExecutionError(
        `CC Relay could not verify the Claude process in the ${task.thread_name || sessionId} terminal: ${error.message}. Nothing was typed.`,
        { retryable: true },
      );
    }
    if (!alive) {
      throw new ClaudeExecutionError(
        `The Claude process in the ${task.thread_name || sessionId} terminal exited before CC Relay could apply the selected model and effort. Nothing was typed.`,
        { retryable: true },
      );
    }
    if (active.cancelRequested) {
      throw new ClaudeExecutionError('Task cancelled.', { cancelled: true });
    }

    onEvent({
      event: { type: 'claude/progress', provider: 'claude', sessionId },
      message: `Restarting the ${task.thread_name || sessionId} Claude terminal with ${terminalSettingsDescription(settings)} before CC Relay types the prompt.`,
    });

    try {
      await this.terminateProcess(processId);
    } catch (error) {
      throw new ClaudeExecutionError(
        `CC Relay could not stop the existing Claude process in the ${task.thread_name || sessionId} terminal to apply the selected model and effort: ${error.message}. Nothing was typed.`,
        { retryable: false },
      );
    }

    const exitDeadline = this.now() + this.processExitTimeoutMs;
    let processExited = false;
    while (this.now() < exitDeadline) {
      try {
        if (!(await this.isProcessAlive(processId))) {
          processExited = true;
          break;
        }
      } catch (error) {
        throw new ClaudeExecutionError(
          `CC Relay could not confirm the old Claude process exited in the ${task.thread_name || sessionId} terminal: ${error.message}. Nothing was typed.`,
          { retryable: false },
        );
      }
      await this.wait(this.restartPollMs);
    }
    if (!processExited) {
      throw new ClaudeExecutionError(
        `The old Claude process in the ${task.thread_name || sessionId} terminal did not exit, so CC Relay could not safely apply the selected model and effort. Nothing was typed.`,
        { retryable: false },
      );
    }

    await this.wait(this.relaunchSettleMs);
    const command = claudeTerminalRelaunchCommand({
      command: this.command,
      sessionId,
      resumed,
      model: settings.model,
      effort: settings.effort,
      permissionMode: settings.permissionMode,
      tools: settings.tools,
      addDirectories: settings.addDirectories,
      settings: hookSettings,
    });
    try {
      await this.relaunch(terminal.terminalWindowId, command);
    } catch (error) {
      throw new ClaudeExecutionError(
        `CC Relay could not confirm Claude restarted in the ${task.thread_name || sessionId} terminal with the selected model and effort: ${error.message}. The launch command may already have run, so CC Relay will not send it again or type the prompt. Check the terminal before retrying.`,
        { retryable: false },
      );
    }

    const screens = screenState || this.createScreenState();
    // What the screen showed on the last pass that was neither the composer nor the known resume
    // picker, so a deadline failure can name what is actually blocking the terminal.
    let blockedExcerpt = '';
    const relaunchDeadline = this.now() + this.relaunchTimeoutMs;
    while (this.now() < relaunchDeadline) {
      let current = null;
      try {
        current = await this.sessions.readConnectedSession(sessionId);
      } catch {
        current = null;
      }
      const newProcessId = Number(current?.pid);
      if (
        current
        && Number.isInteger(newProcessId)
        && newProcessId > 0
        && newProcessId !== processId
        && current.rawStatus !== 'busy'
      ) {
        const sameSession = current.id === sessionId
          && current.source === 'Claude interactive'
          && typeof current.cwd === 'string'
          && resolve(current.cwd) === resolve(task.repo_path);
        if (!sameSession) {
          throw new ClaudeExecutionError(
            `Claude restarted after the settings change, but the new process did not register as the same interactive session in the task workspace. CC Relay did not type the prompt.`,
            { retryable: false },
          );
        }
        let fresh = null;
        try {
          fresh = await this.resolveTerminal(current);
        } catch {
          fresh = null;
        }
        if (fresh) {
          const moved = fresh.terminalWindowId !== terminal.terminalWindowId
            || (terminal.terminalTty && fresh.terminalTty && fresh.terminalTty !== terminal.terminalTty);
          if (moved) {
            throw new ClaudeExecutionError(
              `Claude restarted for ${task.thread_name || sessionId}, but the session resolved to a different Terminal window or tty. CC Relay did not type the prompt.`,
              { retryable: false },
            );
          }
          if (
            fresh.runtimeProcessId
            && Number(fresh.runtimeProcessId) !== newProcessId
          ) {
            await this.wait(this.restartPollMs);
            continue;
          }

          // The new pid is registered and idle, which used to be the whole readiness signal. Task
          // 39 (July 30, 2026) proved it is not sufficient: a relaunch that resumes a conversation
          // over an hour idle and over 100k tokens shows Claude Code 2.1.220's resume picker while
          // the session already registers as idle, and CC Relay pasted a council prompt straight
          // into that dialog. Require a positively recognized composer, resolve the one dialog
          // CC Relay understands, and keep polling for anything else.
          const screen = await this.inspectTerminalScreen(fresh.terminalWindowId);
          // The snapshot is an await inside a loop that can run for the whole relaunch window. A
          // cancel that lands here must stop CC Relay from answering a dialog, from announcing a
          // terminal ready, and from proceeding to type, for work the user abandoned. Nothing has
          // been typed at this point, so this is a clean abort.
          if (active.cancelRequested) {
            throw new ClaudeExecutionError('Task cancelled.', { cancelled: true });
          }
          if (screen.ok && screen.classification === 'trust-dialog') {
            throw this.trustDialogError(task);
          }
          if (screen.ok && screen.classification === 'resume-picker') {
            await this.resolveResumePickerScreen(task, fresh.terminalWindowId, onEvent, screens);
            // Re-verify the pid, the idle status, AND the screen from scratch on the next pass.
            // Nothing about this terminal is assumed to have survived answering a dialog.
            await this.wait(this.restartPollMs);
            continue;
          }
          if (screen.ok && screen.classification !== 'composer') {
            blockedExcerpt = screen.excerpt || blockedExcerpt;
            await this.wait(this.restartPollMs);
            continue;
          }
          if (!screen.ok) {
            this.announceDegradedScreenVerification(task, onEvent, screens, screen.reason);
          }

          onEvent({
            event: { type: 'claude/progress', provider: 'claude', sessionId },
            message: `The ${task.thread_name || sessionId} terminal is ready with ${terminalSettingsDescription(settings)}.`,
          });
          return fresh;
        }
      }
      await this.wait(this.restartPollMs);
    }

    // A screen that stayed unrecognized is a different failure from a session that never came
    // back, and the user needs to see what is on it. Both are non-retryable: nothing was typed,
    // and an automatic requeue would just relaunch into the same blocked terminal.
    if (blockedExcerpt) {
      throw this.blockedScreenError(task, blockedExcerpt);
    }
    throw new ClaudeExecutionError(
      `Claude did not become ready again in the ${task.thread_name || sessionId} terminal after CC Relay applied the selected model and effort. CC Relay did not type the prompt. Check the terminal before retrying.`,
      { retryable: false },
    );
  }

  // Tri-state metadata keeps positive first-turn absence separate from a real stat failure.
  // Production sources expose state(); the compatibility fallback preserves older injected
  // sources whose only readable signals are exists() and size().
  transcriptState(source) {
    if (typeof source.state === 'function') {
      const state = source.state();
      if (['present', 'absent', 'unreadable'].includes(state)) return state;
    }
    if (typeof source.exists === 'function' && source.exists()) return 'present';
    return source.size() >= 0 ? 'present' : 'absent';
  }

  // Byte offset where this turn's transcript records begin, read immediately before injecting.
  // A non-negative size is authoritative. A negative size on a fresh session (no transcript at
  // task start) legitimately means offset 0 (Issue 1). A negative size on a resumed session is
  // a transient stat failure: re-stat with a short bounded retry and use the recovered size,
  // because starting at offset 0 would replay the whole transcript and a stale end_turn record
  // could complete this turn with an earlier response. If it stays negative, fail retryably
  // pre-injection (nothing has been typed), so the queue re-runs the turn cleanly (Issue 14).
  async resolveInjectionOffset(task, active, source, resumed) {
    const size = source.size();
    if (size >= 0) {
      return size;
    }
    if (!resumed) {
      return 0;
    }
    for (let attempt = 0; attempt < this.statRetryAttempts; attempt += 1) {
      // Check cancellation each iteration, exactly like ensureReady. Without this, a cancel
      // arriving during the bounded re-stat is ignored, and a stat that stays negative would
      // throw the retryable transcript error below (not a cancelled error), which the queue
      // treats as failed-and-retryable and auto-requeues, re-injecting a cancelled task.
      if (active.cancelRequested) {
        throw new ClaudeExecutionError('Task cancelled.', { cancelled: true });
      }
      await this.wait(this.statRetryDelayMs);
      const retry = source.size();
      if (retry >= 0) {
        return retry;
      }
    }
    // A cancel that lands during the FINAL wait above is not seen by the loop-top check, so
    // re-check here before the retryable throw. Otherwise a cancelled task surfaces as the
    // retryable stat error and src/queue.mjs auto-requeues work the user cancelled (Issue 18).
    if (active.cancelRequested) {
      throw new ClaudeExecutionError('Task cancelled.', { cancelled: true });
    }
    throw new ClaudeExecutionError(
      `CC Relay could not read the size of the Claude transcript for ${task.thread_name || task.thread_id} before typing, so it will not risk replaying an earlier response as this turn's result. Nothing was typed. Retry when the terminal is stable.`,
      { retryable: true },
    );
  }

  // Readiness: the session must be present in claude agents --json and idle. A folder-trust
  // prompt session is not registered at all, so registration plus idle is a sufficient
  // input-ready signal (empirically verified). The transcript may not exist yet on a fresh
  // terminal's first turn; the tail reads from offset 0 once the file is created.
  async ensureReady(task, active, onEvent) {
    const sessionId = task.thread_id;
    const deadline = this.now() + this.readinessTimeoutMs;
    let announced = false;
    let missing = 0;
    while (this.now() < deadline) {
      if (active.cancelRequested) {
        throw new ClaudeExecutionError('Task cancelled.', { cancelled: true });
      }
      let current;
      try {
        current = await this.sessions.readConnectedSession(sessionId);
      } catch {
        current = null;
      }
      if (!current) {
        missing += 1;
        if (missing >= this.sessionMissingGrace) {
          throw new ClaudeExecutionError(
            `The selected Claude terminal for ${task.thread_name || sessionId} is no longer open. It disappeared before CC Relay could type the prompt, so nothing was sent. Reopen the terminal and retry.`,
            { retryable: false },
          );
        }
      } else {
        missing = 0;
        if (current.rawStatus !== 'busy') {
          return;
        }
        if (!announced) {
          onEvent({
            event: { type: 'claude/progress', provider: 'claude', sessionId },
            message: 'Waiting for the Claude terminal to become free before CC Relay types the prompt.',
          });
          announced = true;
        }
      }
      await this.wait(this.pollMs);
    }
    // A cancel that lands during the FINAL poll wait exits the loop via the deadline without
    // reaching the loop-top check, so re-check here before the retryable throw. Otherwise a
    // cancelled task surfaces as the retryable stayed-busy error and src/queue.mjs auto-requeues
    // work the user cancelled (Issue 18).
    if (active.cancelRequested) {
      throw new ClaudeExecutionError('Task cancelled.', { cancelled: true });
    }
    throw new ClaudeExecutionError(
      `The ${task.thread_name || sessionId} terminal is present but stayed busy and never became free to accept the prompt. Nothing was typed. Wait for it to finish, then retry.`,
      { retryable: true },
    );
  }

  // Immediately before typing, confirm the resolved window and tty still map to the live
  // session's current pid from a fresh discovery read. macOS recycles tty names, so a
  // window resolved at task start can belong to another session by now.
  async verifyTerminalIdentity(
    task,
    active,
    terminal,
    { requireIdle = false, tolerateResolutionFlake = false } = {},
  ) {
    if (typeof this.resolveTerminal !== 'function') {
      return null;
    }
    if (active.cancelRequested) {
      throw new ClaudeExecutionError('Task cancelled.', { cancelled: true });
    }
    const current = await this.sessions.readConnectedSession(task.thread_id);
    if (!current) {
      throw new ClaudeExecutionError(
        `The selected Claude terminal for ${task.thread_name || task.thread_id} is no longer open. Nothing was typed. Reopen the terminal and retry.`,
        { retryable: false },
      );
    }
    if (requireIdle && current.rawStatus === 'busy') {
      throw new ClaudeExecutionError(
        `The ${task.thread_name || task.thread_id} Claude terminal became busy before CC Relay could type. CC Relay did not stop the process or type the prompt. Wait for it to finish, then retry.`,
        { retryable: true },
      );
    }
    let fresh = null;
    let resolutionFailed = false;
    try {
      fresh = await this.resolveTerminal(current);
    } catch {
      resolutionFailed = true;
    }
    if (resolutionFailed || !fresh) {
      // Re-resolution flaked (threw, or returned nothing) rather than proving another session
      // took the window. A native-resolution flake at task start silently falls back to the
      // headless path in the runner; here, inside the executor which has no headless path, we
      // fail retryably so a re-run re-resolves the terminal from scratch (and that re-run
      // itself falls back to headless if resolution flakes again). Both paths recover; the
      // message must not imply a recycled-window mismatch, which this flake has not proven.
      if (tolerateResolutionFlake) {
        // The guarded submit schedule can absorb a transient flake: it sends nothing, keeps
        // watching, and re-verifies at the next attempt. A persistent flake still ends the turn
        // through the caller's bounded grace, so a broken resolver cannot spin here forever.
        return { unresolved: true };
      }
      throw new ClaudeExecutionError(
        `CC Relay could not re-verify the ${task.thread_name || task.thread_id} terminal before typing, so it did not type anything. Retry to re-resolve the exact terminal.`,
        { retryable: true },
      );
    }
    const mismatch = fresh.terminalWindowId !== terminal.terminalWindowId
      || (terminal.terminalTty && fresh.terminalTty && fresh.terminalTty !== terminal.terminalTty)
      || (terminal.runtimeProcessId && fresh.runtimeProcessId && fresh.runtimeProcessId !== terminal.runtimeProcessId);
    if (mismatch) {
      throw new ClaudeExecutionError(
        `The ${task.thread_name || task.thread_id} terminal identity changed just before CC Relay could type. A Terminal window or tty was reused by another session, so CC Relay did not type anything. Retry to re-resolve the exact terminal.`,
        { retryable: true },
      );
    }
    return { session: current, terminal: fresh };
  }

  async waitForTranscriptOrPoll(source, offset, timeoutMs = this.pollMs) {
    const waitMs = Math.max(0, timeoutMs);
    if (waitMs === 0) return;
    if (typeof source.waitForChange !== 'function') {
      await this.wait(waitMs);
      return;
    }
    try {
      await source.waitForChange(offset, waitMs);
    } catch {
      // Native file watching is an acceleration only. Polling remains the reliable fallback.
      await this.wait(waitMs);
    }
  }

  async deliverActiveSteer(task, active, terminal, request) {
    const sessionName = task.thread_name || task.thread_id;
    const fail = (message, { uncertain = false } = {}) => new ClaudeExecutionError(
      message,
      {
        deliveryUncertain: uncertain,
        retryable: false,
      },
    );
    const waitForAcknowledgement = async (milliseconds) => {
      if (request.acknowledged || request.closedError) return;
      await Promise.race([
        request.acknowledgement,
        this.wait(Math.max(0, milliseconds)),
      ]);
    };
    const accepted = () => {
      if (request.closedError) throw request.closedError;
      return request.acknowledged;
    };

    if (active.cancelRequested) {
      throw fail('That Claude turn is being cancelled. Your live update was not sent.');
    }
    const promptIssue = injectionPromptIssue(request.deliveredPrompt, { maxBytes: this.maxPromptBytes });
    if (promptIssue) {
      throw fail(`CC Relay cannot type this live update into Claude: ${promptIssue}`);
    }

    let verified = await this.verifyTerminalIdentity(task, active, terminal);
    if (!verified?.session || !verified?.terminal) {
      throw fail(`CC Relay could not resolve the exact ${sessionName} terminal. Your live update was not sent.`);
    }
    if (verified.session.rawStatus !== 'busy') {
      throw fail('That Claude turn is no longer working. Send the message again as a normal continuation after the task finishes.');
    }
    let activeTerminal = verified.terminal;
    const screen = await this.inspectTerminalScreen(activeTerminal.terminalWindowId);
    if (!screen.ok) {
      throw fail(`CC Relay could not read the exact ${sessionName} terminal before typing. Your live update was not sent.`);
    }
    if (screen.classification !== 'composer') {
      throw fail(
        `The ${sessionName} terminal is not showing Claude's message composer, so CC Relay did not type the live update. The screen shows: ${screen.excerpt || 'an unrecognized prompt'}`,
      );
    }
    const composer = claudeComposerContent(screen.text);
    if (!composer.found || composer.text.trim()) {
      throw fail(
        `The ${sessionName} Claude composer already contains unsent text. CC Relay did not overwrite or submit it.`,
      );
    }

    // Re-prove the process and busy state after the screen read. If the original turn settles
    // during this gap, the message must use the normal continuation path instead of silently
    // becoming an unmanaged new turn.
    verified = await this.verifyTerminalIdentity(task, active, activeTerminal);
    if (!verified?.session || !verified?.terminal || verified.session.rawStatus !== 'busy') {
      throw fail('That Claude turn finished before CC Relay could type the live update. Send it again as a normal continuation.');
    }
    activeTerminal = verified.terminal;
    if (active.cancelRequested) {
      throw fail('That Claude turn is being cancelled. Your live update was not sent.');
    }

    request.injectionStarted = true;
    try {
      await this.inject(activeTerminal.terminalWindowId, request.deliveredPrompt);
    } catch (error) {
      await waitForAcknowledgement(this.steerAcceptanceTimeoutMs);
      if (accepted()) return request.result();
      throw fail(
        `CC Relay could not confirm it typed the live update into the ${sessionName} terminal: ${error.message}. The message may have been delivered, so it was not sent again.`,
        { uncertain: true },
      );
    }

    await waitForAcknowledgement(this.steerSubmitNudgeMs);
    if (accepted()) return request.result();

    // Claude collapses every normal Relay message into a multiline paste widget. If the
    // appended Return was swallowed, send one separate Return only after fresh process,
    // busy-state, screen, and exact-held-paste checks.
    try {
      verified = await this.verifyTerminalIdentity(task, active, activeTerminal);
    } catch (error) {
      await waitForAcknowledgement(this.steerAcceptanceTimeoutMs - this.steerSubmitNudgeMs);
      if (accepted()) return request.result();
      throw fail(
        `CC Relay typed the live update into the ${sessionName} terminal but could not re-verify that terminal before submitting it. The message may have been delivered, so it was not sent again. ${error.message}`,
        { uncertain: true },
      );
    }
    if (
      verified?.session
      && verified?.terminal
      && verified.session.rawStatus === 'busy'
      && !active.cancelRequested
    ) {
      activeTerminal = verified.terminal;
      const heldScreen = await this.inspectTerminalScreen(activeTerminal.terminalWindowId);
      if (
        heldScreen.ok
        && heldScreen.classification === 'composer'
        && claudeComposerState(heldScreen.text, request.deliveredPrompt) === 'held'
      ) {
        try {
          await this.submit(activeTerminal.terminalWindowId);
          request.submitAttempted = true;
        } catch (error) {
          await waitForAcknowledgement(this.steerAcceptanceTimeoutMs - this.steerSubmitNudgeMs);
          if (accepted()) return request.result();
          throw fail(
            `CC Relay typed the live update into the ${sessionName} terminal but could not confirm its guarded submit action: ${error.message}. The message may have been delivered, so it was not sent again.`,
            { uncertain: true },
          );
        }
      }
    }

    await waitForAcknowledgement(this.steerAcceptanceTimeoutMs - this.steerSubmitNudgeMs);
    if (accepted()) return request.result();
    throw fail(
      `CC Relay typed the live update into the ${sessionName} terminal but did not receive exact delivery evidence within ${inactivityLimitLabel(this.steerAcceptanceTimeoutMs)}. The message may still be queued in Claude, so it was not sent again.`,
      { uncertain: true },
    );
  }

  async watchTurn(
    task,
    active,
    terminal,
    source,
    reader,
    injectionOffset,
    {
      onEvent,
      onStderr,
      transcriptInitiallyAbsent = false,
      hookRegistration = null,
      prompt = taskPrompt(task),
      settings = terminalExecutionSettings(task),
      screenState = null,
    },
  ) {
    const sessionId = task.thread_id;
    // Shared with the readiness gates when runTurn drove this watch, so the resume-dialog
    // resolution bound and the degraded-verification notice cover the whole turn rather than
    // restarting here. A direct watchTurn call gets its own fresh record.
    const screens = screenState || this.createScreenState();
    const context = {
      cwd: task.repo_path,
      tools: new Map(),
      finalResponse: '',
      sessionId,
      reportedSessionId: null,
      error: null,
    };
    // A turn starts only after the exact injected prompt appears in UserPromptSubmit or in a
    // top-level transcript user record. Task 15 showed why transcript bytes alone are unsafe:
    // `/compact`, its generated summary, and attachments all grew the file while the real
    // continuation remained held in Claude's composer.
    const expectedPrompts = [prompt];
    // An attachment-bearing prompt is rewritten by Claude's composer before it is recorded, so the
    // raw text alone would leave every image-carrying turn (every plan council stage, every Execute
    // task with attachments) permanently without submission evidence. These are complete derived
    // forms of the same prompt, so accepting them adds no partial-match surface. Empty for a
    // text-only prompt, which keeps raw equality as the only accepted form there.
    const rewrittenPrompts = attachmentRewrittenPrompts(prompt, taskAttachmentPaths(task));
    // Raw evidence is checked first so the reported value always names the form that actually
    // arrived, which makes the rewrite path observable in live diagnostics.
    const promptEvidence = (value, rawEvidence, rewrittenEvidence) => {
      if (submittedPromptMatches(value, expectedPrompts)) return rawEvidence;
      if (rewrittenPrompts.length > 0 && submittedPromptMatches(value, rewrittenPrompts)) {
        return rewrittenEvidence;
      }
      return null;
    };
    let promptSubmitted = false;
    let promptProcessingConfirmed = false;
    let hookPromptId = null;
    let transcriptCorrelated = false;
    let sawFinal = false;
    let finalPromptId = null;
    let finalText = '';
    let lastText = '';
    let idleObservations = 0;
    let awaitingInput = false;
    let unverifiedIdleAnnounced = false;
    let missing = 0;
    // Bounded multi-attempt guarded submit. Task 39 showed a single early attempt is not enough:
    // one swallowed Return permanently disabled recovery and guaranteed a dead task. Every
    // attempt re-proves the same safety conditions, so the schedule stops the instant any
    // submission evidence appears.
    let submitAttempts = 0;
    let lastSubmitAttemptAt = null;
    let submitResolutionFlakes = 0;
    // Idle time with no submission evidence, accumulated by advanceSubmissionClock below. Both
    // the attempt schedule and the submission deadline read this instead of wall time.
    let submissionElapsedMs = 0;
    let submissionClockAt = this.now();
    let compacting = false;
    let compactionAnnounced = false;
    const start = this.now();
    let lastHeartbeat = start;
    // The safety ceiling measures continuous inactivity, not total turn duration. A team of
    // sub-agents can legitimately work for hours, and task 320 proved that a wall-clock ceiling
    // fails such a turn while the session is still visibly busy. Every live signal below
    // (hooks, transcript records, busy status, transcript growth) refreshes this timestamp.
    let lastActivity = start;
    let lastObservedSize = injectionOffset;
    let lastUncorrelatedGrowthAt = null;
    // Transcript writes can arrive much faster than `claude agents --json` can run. Wake and
    // mirror every write immediately, but keep the expensive subprocess-backed session probe
    // on its original cadence so live output cannot create a discovery spawn storm.
    let nextSessionPollAt = start;
    let current = null;
    let busy = false;
    let sessionMissing = false;
    const hookItemEvents = new Set();
    const hookMessages = new Map();
    const hookFinalMessageTexts = [];
    const pendingInputRequests = new Map();
    const consumedSteerPromptIds = new Set();
    const pendingSteers = new Set();
    const unanchoredSteers = new Set();
    let steerPromptAccepted = false;
    let steeringClosed = false;
    let steeringSequence = 0;
    let steeringTail = Promise.resolve();

    const closeSteering = () => {
      if (steeringClosed) return;
      steeringClosed = true;
      if (active.steer === submitSteer) active.steer = null;
      for (const request of pendingSteers) {
        if (!request.closedError && !request.acknowledged) {
          request.closedError = request.injectionStarted
            ? new ClaudeExecutionError(
              'The Claude turn ended while CC Relay was confirming the live update. The message may already be queued in Claude, so it was not sent again.',
              { deliveryUncertain: true, retryable: false },
            )
            : new ClaudeExecutionError(
              'That Claude turn finished before the live update was delivered. Your message was not queued.',
              { retryable: false },
            );
          request.releaseAcknowledgement();
        }
      }
    };

    const acknowledgeSteerPrompt = (
      value,
      rawEvidence,
      rewrittenEvidence,
      promptId = null,
    ) => {
      const normalizedPromptId = typeof promptId === 'string' ? promptId.trim() : '';
      if (normalizedPromptId && consumedSteerPromptIds.has(normalizedPromptId)) return null;
      for (const request of pendingSteers) {
        if (!request.injectionStarted || request.acknowledged) continue;
        let evidence = null;
        if (submittedPromptMatches(value, [request.deliveredPrompt])) {
          evidence = rawEvidence;
        } else if (
          request.rewrittenPrompts.length > 0
          && submittedPromptMatches(value, request.rewrittenPrompts)
        ) {
          evidence = rewrittenEvidence;
        }
        if (!evidence) continue;
        request.acknowledged = true;
        request.evidence = evidence;
        request.transcriptAnchored = evidence.startsWith('transcript');
        if (!request.transcriptAnchored) unanchoredSteers.add(request);
        steerPromptAccepted = true;
        if (normalizedPromptId) {
          consumedSteerPromptIds.add(normalizedPromptId);
          hookPromptId = normalizedPromptId;
        }
        // A live update can arrive at the boundary where the earlier response has already
        // emitted Stop. Keep the watcher attached to the same task until Claude settles again.
        sawFinal = false;
        finalPromptId = null;
        finalText = '';
        lastText = '';
        idleObservations = 0;
        lastActivity = this.now();
        request.releaseAcknowledgement();
        return evidence;
      }
      return null;
    };

    const submitSteer = (value, attachments = []) => {
      if (!promptSubmitted) {
        throw new ClaudeExecutionError(
          'Claude has not accepted the original turn yet. Try the live update again after it starts working. Your message was not queued.',
          { retryable: false },
        );
      }
      if (steeringClosed || active.cancelRequested) {
        throw new ClaudeExecutionError(
          'That Claude turn is no longer accepting live updates. Your message was not queued.',
          { retryable: false },
        );
      }
      const steeringAttachments = Array.isArray(attachments) ? attachments : [];
      const deliveredPrompt = taskPrompt({
        prompt: value,
        attachments: steeringAttachments,
      });
      const clientUserMessageId = `relay-steer-${task.id}-${++steeringSequence}`;
      let releaseAcknowledgement;
      const acknowledgement = new Promise((resolveAcknowledgement) => {
        releaseAcknowledgement = resolveAcknowledgement;
      });
      const request = {
        value,
        attachments: steeringAttachments,
        deliveredPrompt,
        rewrittenPrompts: attachmentRewrittenPrompts(
          deliveredPrompt,
          taskAttachmentPaths({ attachments: steeringAttachments }),
        ),
        clientUserMessageId,
        acknowledgement,
        releaseAcknowledgement,
        acknowledged: false,
        evidence: null,
        injectionStarted: false,
        submitAttempted: false,
        transcriptAnchored: false,
        closedError: null,
        result: () => ({
          taskId: task.id,
          threadId: sessionId,
          turnId: null,
          clientUserMessageId,
          promptSubmissionEvidence: request.evidence,
          submitAttempted: request.submitAttempted,
        }),
      };
      pendingSteers.add(request);

      const operation = steeringTail.then(async () => {
        if (steeringClosed || request.closedError) {
          throw request.closedError || new ClaudeExecutionError(
            'That Claude turn finished before the live update could be sent. Your message was not queued.',
            { retryable: false },
          );
        }
        const outcome = await this.deliverActiveSteer(task, active, terminal, request);
        const item = {
          id: clientUserMessageId,
          clientId: clientUserMessageId,
          type: 'userMessage',
          content: [
            { type: 'text', text: value },
            ...steeringAttachments.map((attachment) => ({
              type: 'localImage',
              path: attachment.path,
            })),
          ],
        };
        try {
          onEvent({
            event: {
              type: 'item/completed',
              provider: 'claude',
              item,
              promptSubmissionEvidence: outcome.promptSubmissionEvidence,
            },
            message: value,
          });
        } catch (error) {
          // Claude already accepted the exact prompt. A local history write must not convert
          // confirmed delivery into a failed HTTP response that invites a duplicate resend.
          try {
            onStderr(`Claude accepted the live update, but CC Relay could not record its user-message event: ${error.message}`);
          } catch {
            // Delivery remains authoritative even if both local recording channels failed.
          }
        }
        return outcome;
      }).finally(() => {
        pendingSteers.delete(request);
      });
      steeringTail = operation.catch(() => {});
      return operation;
    };

    active.steer = submitSteer;
    active.closeSteering = closeSteering;

    const emitPromptSubmitted = (evidence) => {
      if (promptSubmitted) return;
      promptSubmitted = true;
      lastActivity = this.now();
      onEvent({
        event: {
          type: 'claude/started',
          provider: 'claude',
          sessionId,
          sessionMode: 'terminal',
          model: settings.model || 'session default',
          effort: settings.effort || 'session default',
          // Which signal ended the submission wait, and how many guarded actions preceded it.
          // Prior reviews asked for this: it separates "Claude took the pasted Return" from
          // "attempt N recovered a held paste" without re-reading the transcript by hand.
          promptSubmissionEvidence: evidence,
          submitAttempts,
        },
        message: settings.apply
          ? `Claude received the exact prompt in the ${task.thread_name || sessionId} terminal with ${terminalSettingsDescription(settings)}.`
          : `Claude received the exact prompt inside the ${task.thread_name || sessionId} terminal, using that session's existing model and effort.`,
      });
    };

    const inputRequestKey = (payload) => (
      typeof payload?.tool_use_id === 'string' && payload.tool_use_id.trim()
        ? payload.tool_use_id.trim()
        : null
    );

    const rememberInputRequest = (payload) => {
      if (payload?.tool_name !== 'AskUserQuestion') return;
      const key = inputRequestKey(payload);
      if (!key) return;
      pendingInputRequests.set(key, {
        kind: 'question',
        input: compactHookValue(payload.tool_input),
      });
    };

    const clearInputRequest = (payload) => {
      const key = inputRequestKey(payload);
      if (!key) return;
      pendingInputRequests.delete(key);
    };

    const emitInputResumed = () => {
      if (!awaitingInput) return;
      awaitingInput = false;
      onEvent({
        event: { type: 'claude/input-resumed', provider: 'claude', sessionId },
        message: `Claude received terminal input and resumed the turn in ${task.thread_name || sessionId}.`,
      });
    };

    const rememberFinalHookText = (text) => {
      const normalized = normalizedMessageText(text);
      if (!normalized) return;
      hookFinalMessageTexts.push(normalized);
      if (hookFinalMessageTexts.length > MAX_HOOK_COLLECTION_ITEMS) {
        hookFinalMessageTexts.shift();
      }
    };

    const emitHookStreamMessage = (message) => {
      for (const emitted of consumeClaudeStreamMessage(message, context)) {
        const key = itemEventKey(emitted);
        if (key) {
          if (hookItemEvents.has(key)) continue;
          hookItemEvents.add(key);
        }
        onEvent(emitted);
      }
    };

    const consumeHook = (payload) => {
      const eventName = payload?.hook_event_name;
      if (!eventName || payload.session_id !== sessionId) return;
      lastActivity = this.now();
      // Settings hooks also run inside Claude sub-agents. Their internal prompts, compactions,
      // tool calls, and text do not belong to the parent turn.
      if (payload.agent_id) return;

      if (eventName === 'UserPromptSubmit') {
        // A captured hook payload from Claude Code 2.1.220 proved this hook reports the composer's
        // rewritten text, byte identical to the transcript record, never the delivered text. So
        // for an attachment-bearing prompt the rewritten form is the only evidence either channel
        // can ever produce, and accepting raw alone here would strand every image turn.
        if (
          promptSubmitted
          && acknowledgeSteerPrompt(
            payload.prompt,
            'user-prompt-hook',
            'user-prompt-hook-normalized',
            payload.prompt_id,
          )
        ) return;
        const evidence = promptEvidence(
          payload.prompt,
          'user-prompt-hook',
          'user-prompt-hook-normalized',
        );
        if (evidence) {
          if (!hookPromptId && typeof payload.prompt_id === 'string' && payload.prompt_id.trim()) {
            hookPromptId = payload.prompt_id.trim();
          }
          emitPromptSubmitted(evidence);
        }
        return;
      }

      const payloadPromptId = typeof payload.prompt_id === 'string'
        ? payload.prompt_id.trim()
        : '';
      if (
        promptSubmitted
        && hookPromptId
        && payloadPromptId
        && payloadPromptId !== hookPromptId
      ) return;

      if (eventName === 'PreCompact') {
        compacting = true;
        if (!compactionAnnounced) {
          compactionAnnounced = true;
          onEvent({
            event: {
              type: 'claude/progress',
              provider: 'claude',
              sessionId,
              deliveryState: 'compacting',
            },
            message: promptSubmitted
              ? `Claude is compacting the ${task.thread_name || sessionId} conversation before processing continues.`
              : `Claude started compacting the ${task.thread_name || sessionId} conversation before accepting the continuation. CC Relay will verify the exact prompt again when compaction finishes.`,
          });
        }
        return;
      }

      if (eventName === 'PostCompact') {
        compacting = false;
        onEvent({
          event: {
            type: 'claude/progress',
            provider: 'claude',
            sessionId,
            deliveryState: 'compacted',
          },
          message: promptSubmitted
            ? `Claude finished compacting the ${task.thread_name || sessionId} conversation and can continue the accepted turn.`
            : `Claude finished compacting the ${task.thread_name || sessionId} conversation. CC Relay is checking whether the held continuation was actually submitted.`,
        });
        return;
      }

      // No assistant or tool hook belongs to this turn until Claude confirms the exact prompt.
      // In particular, compaction-related output must never become foreign task activity.
      if (!promptSubmitted) return;
      promptProcessingConfirmed = true;

      if (eventName === 'MessageDisplay') {
        const messageId = typeof payload.message_id === 'string' && payload.message_id
          ? payload.message_id
          : null;
        const index = Number(payload.index);
        if (!messageId || !Number.isInteger(index) || index < 0) return;
        const state = hookMessages.get(messageId) || {
          text: '',
          lastIndex: -1,
          final: false,
        };
        if (state.final || index <= state.lastIndex) return;
        state.lastIndex = index;
        const delta = typeof payload.delta === 'string' ? payload.delta : '';
        state.text += delta;
        state.final = payload.final === true;
        hookMessages.set(messageId, state);
        const text = state.text.trim();
        if (text) lastText = text;
        const deltaText = delta.trim();
        if (deltaText) {
          onEvent({
            event: {
              type: 'claude/message',
              provider: 'claude',
              text: deltaText,
              liveDelta: delta,
              liveMessageId: messageId,
              liveIndex: index,
              liveFinal: state.final,
            },
            message: deltaText,
          });
        }
        if (state.final) rememberFinalHookText(state.text);
        return;
      }

      if (eventName === 'PreToolUse') {
        const toolUseId = typeof payload.tool_use_id === 'string'
          ? payload.tool_use_id.trim()
          : '';
        if (!toolUseId || hookItemEvents.has(`item/started:${toolUseId}`)) return;
        rememberInputRequest(payload);
        emitHookStreamMessage({
          type: 'assistant',
          message: {
            content: [{
              type: 'tool_use',
              id: toolUseId,
              name: payload.tool_name,
              input: compactHookValue(payload.tool_input),
            }],
          },
        });
        return;
      }

      if (['PostToolUse', 'PostToolUseFailure'].includes(eventName)) {
        const toolUseId = typeof payload.tool_use_id === 'string'
          ? payload.tool_use_id.trim()
          : '';
        if (!toolUseId) return;
        clearInputRequest(payload);
        if (pendingInputRequests.size === 0) emitInputResumed();
        if (hookItemEvents.has(`item/completed:${toolUseId}`)) return;
        if (!context.tools.has(toolUseId)) {
          emitHookStreamMessage({
            type: 'assistant',
            message: {
              content: [{
                type: 'tool_use',
                id: toolUseId,
                name: payload.tool_name,
                input: compactHookValue(payload.tool_input),
              }],
            },
          });
        }
        emitHookStreamMessage({
          type: 'user',
          toolUseResult: compactHookValue(payload.tool_response),
          message: {
            content: [{
              type: 'tool_result',
              tool_use_id: toolUseId,
              content: hookResultText(payload),
              is_error: eventName === 'PostToolUseFailure',
            }],
          },
        });
        return;
      }

      if (eventName === 'Stop') {
        const text = typeof payload.last_assistant_message === 'string'
          ? payload.last_assistant_message.trim()
          : '';
        if (text) {
          lastText = text;
          const normalized = normalizedMessageText(text);
          const alreadyDisplayed = [...hookMessages.values()]
            .some((message) => normalizedMessageText(message.text) === normalized);
          if (!alreadyDisplayed) {
            const liveMessageId = `stop:${payload.prompt_id || payload.turn_id || sessionId}`;
            onEvent({
              event: {
                type: 'claude/message',
                provider: 'claude',
                text,
                liveMessageId,
                liveIndex: 0,
                liveFinal: true,
              },
              message: text,
            });
          }
          rememberFinalHookText(text);
        }
        const backgroundTasks = Array.isArray(payload.background_tasks)
          ? payload.background_tasks
          : [];
        const sessionCrons = Array.isArray(payload.session_crons)
          ? payload.session_crons
          : [];
        if (backgroundTasks.length === 0 && sessionCrons.length === 0) {
          sawFinal = true;
          finalPromptId = payloadPromptId || hookPromptId;
          if (text) finalText = text;
        }
      }
    };

    hookRegistration?.activate?.(consumeHook);

    const drain = () => {
      let consumed = false;
      for (const record of reader.poll()) {
        consumed = true;
        if (
          record?.type === 'system'
          && record?.subtype === 'compact_boundary'
        ) {
          compacting = false;
        }
        const recordPrompt = userPromptRecordText(record);
        if (
          promptSubmitted
          && acknowledgeSteerPrompt(
            recordPrompt,
            'transcript-prompt',
            'transcript-anchor-normalized',
            record.promptId,
          )
        ) {
          continue;
        }
        const acceptedSteer = [...unanchoredSteers].find((request) => (
          submittedPromptMatches(recordPrompt, [request.deliveredPrompt])
          || (
            request.rewrittenPrompts.length > 0
            && submittedPromptMatches(recordPrompt, request.rewrittenPrompts)
          )
        ));
        if (acceptedSteer) {
          acceptedSteer.transcriptAnchored = true;
          unanchoredSteers.delete(acceptedSteer);
          const recordPromptId = typeof record.promptId === 'string'
            ? record.promptId.trim()
            : '';
          if (recordPromptId) hookPromptId = recordPromptId;
          // The durable user record is the boundary between the earlier response and this
          // accepted update. Discard an earlier transcript final, but preserve a Stop hook that
          // already proved the current prompt completed before the transcript flushed.
          if (!hookPromptId || finalPromptId !== hookPromptId) {
            sawFinal = false;
            finalPromptId = null;
            finalText = '';
            lastText = '';
          }
          idleObservations = 0;
          continue;
        }
        const recordEvidence = promptEvidence(
          recordPrompt,
          'transcript-prompt',
          'transcript-anchor-normalized',
        );
        if (recordEvidence) {
          if (typeof record.promptId === 'string' && record.promptId.trim()) {
            // The post-injection transcript anchor is authoritative if a delayed hook from an
            // older turn arrived first with a different prompt identifier.
            if (!steerPromptAccepted) hookPromptId = record.promptId.trim();
          }
          transcriptCorrelated = true;
          promptProcessingConfirmed = true;
          emitPromptSubmitted(recordEvidence);
          continue;
        }
        // The UserPromptSubmit hook can arrive before the durable transcript. Ignore every
        // intervening record until the same exact prompt anchors the JSONL stream, otherwise
        // delayed compaction or foreign records could become this turn's output.
        if (!transcriptCorrelated) continue;

        if (record.type === 'assistant') {
          for (const block of record.message?.content || []) {
            if (block?.type === 'tool_use' && block.name === 'AskUserQuestion' && block.id) {
              pendingInputRequests.set(block.id, {
                kind: 'question',
                input: compactHookValue(block.input),
              });
            }
          }
        } else if (record.type === 'user') {
          for (const block of record.message?.content || []) {
            if (block?.type === 'tool_result' && block.tool_use_id) {
              pendingInputRequests.delete(block.tool_use_id);
            }
          }
          if (pendingInputRequests.size === 0) emitInputResumed();
        }

        for (const emitted of consumeClaudeStreamMessage(record, context)) {
          const key = itemEventKey(emitted);
          if (key && hookItemEvents.has(key)) continue;
          if (emitted?.event?.type === 'claude/message') {
            const normalized = normalizedMessageText(emitted.event.text);
            const match = hookFinalMessageTexts.indexOf(normalized);
            if (normalized && match >= 0) {
              hookFinalMessageTexts.splice(match, 1);
              continue;
            }
          }
          onEvent(emitted);
        }
        if (record.type === 'assistant') {
          const text = assistantRecordText(record);
          if (text && unanchoredSteers.size === 0) lastText = text;
          if (
            isTurnFinalAssistantRecord(record)
            && unanchoredSteers.size === 0
          ) {
            sawFinal = true;
            finalPromptId = null;
            if (text) finalText = text;
          }
        }
      }
      if (consumed) lastActivity = this.now();
      return consumed;
    };

    // Spacing before the next guarded submit action. The first one waits for the composer to
    // settle after a large paste; later ones back off so a Return that did land always has time
    // to produce evidence (a UserPromptSubmit hook lands within a second or two, and busy status
    // or transcript growth follows) before another action is considered.
    // Math.max keeps the multiplier at zero for the one case where the clock is restarted without
    // an attempt having been counted: a re-delivered paste after a provably empty composer. Every
    // path that counts an attempt is unaffected, because there lastSubmitAttemptAt is only set
    // once submitAttempts is at least 1.
    const submitAttemptWaitMs = () => (
      lastSubmitAttemptAt === null
        ? this.submitNudgeMs
        : this.submitRetryMs + this.submitRetryBackoffMs * Math.max(0, submitAttempts - 1)
    );

    // The submission window measures time in which the composer was provably idle and holding
    // unsubmitted text. Busy status and compaction are neither: they are the states in which
    // pressing Return is forbidden, so charging them to the window would let a long compaction
    // consume the whole schedule and fail the turn with zero attempts the moment it ended. Task
    // 15's own compaction ran roughly 79 seconds. The unconditional promptAcceptanceTimeoutMs
    // ceiling remains the outer bound, so a stale busy state still cannot hold the queue.
    const advanceSubmissionClock = () => {
      const at = this.now();
      if (!busy && !compacting) submissionElapsedMs += at - submissionClockAt;
      submissionClockAt = at;
    };

    const submitAttemptDue = () => {
      if (submitAttempts >= this.maxSubmitAttempts) return false;
      // Gaps between attempts stay on wall time: busy status is exactly the evidence a landed
      // Return would produce, so time spent busy counts as time the previous action had to prove
      // itself. A busy-to-idle transition with still no evidence is immediately eligible again.
      if (this.now() - (lastSubmitAttemptAt ?? start) < submitAttemptWaitMs()) return false;
      // Never spend the last moments of the submission window on an action whose evidence could
      // not arrive before the failure. Attempts are recovery, not a way to extend the deadline.
      return this.submissionTimeoutMs - submissionElapsedMs >= this.submitConfirmMs;
    };

    for (;;) {
      if (active.cancelRequested) {
        await this.cancelTurn(terminal, sessionId, onEvent);
        throw new ClaudeExecutionError('Task cancelled.', { cancelled: true });
      }

      // Read any record that arrived at the timeout boundary before deciding the turn is
      // stalled. Otherwise a durable prompt or final response already on disk could lose a
      // race to the clock check by one polling interval.
      drain();

      if (this.now() - lastActivity > this.inactivityCeilingMs) {
        // Only a stalled turn reaches this. An unanswered interactive prompt accrues inactivity
        // exactly like a dead one, so an abandoned question still releases the task and session
        // within the same bound. Failures at or after injection are never auto-retried: the
        // prompt already ran.
        throw new ClaudeExecutionError(
          `The Claude terminal turn in ${task.thread_name || sessionId} showed no activity for ${inactivityLimitLabel(this.inactivityCeilingMs)}, so CC Relay stopped watching it. Check the terminal; retry manually if needed.`,
          { retryable: false },
        );
      }
      if (
        !promptProcessingConfirmed
        && this.now() - start > this.promptAcceptanceTimeoutMs
      ) {
        // Busy status and compaction can delay the guarded submit, but neither proves that
        // Claude accepted this task. Bound this pre-turn state separately so a stale busy or
        // missing PostCompact signal cannot leave the queue occupied indefinitely.
        const verificationMessage = promptSubmitted
          ? `Claude reported receiving the exact prompt in the ${task.thread_name || sessionId} terminal, but CC Relay could not verify that Claude began processing it within ${inactivityLimitLabel(this.promptAcceptanceTimeoutMs)}.`
          : `CC Relay could not verify that Claude received and began processing the exact prompt in the ${task.thread_name || sessionId} terminal within ${inactivityLimitLabel(this.promptAcceptanceTimeoutMs)}.`;
        throw new ClaudeExecutionError(
          `${verificationMessage} CC Relay will not type the prompt again automatically because the terminal state is uncertain. Check the terminal before retrying.`,
          { retryable: false },
        );
      }

      const size = source.size();
      if (size >= 0 && size < injectionOffset) {
        throw new ClaudeExecutionError(
          `The Claude transcript for ${task.thread_name || sessionId} shrank below the turn start, so CC Relay can no longer trust the result. Retry when the terminal is stable.`,
          { retryable: false },
        );
      }
      if (size >= 0) {
        // A negative size is an unreadable stat, not evidence of a stalled turn, so it never
        // moves the baseline. Growth is activity, but it is not prompt-delivery proof. Claude
        // can append `/compact` and its summary while the continuation is still unsubmitted.
        if (size > lastObservedSize) {
          lastActivity = this.now();
          if (!promptSubmitted) lastUncorrelatedGrowthAt = lastActivity;
        }
        lastObservedSize = size;
      }

      const sessionPollDue = this.now() >= nextSessionPollAt;
      if (sessionPollDue) {
        try {
          current = await this.sessions.readConnectedSession(sessionId);
        } catch {
          current = null;
        }
        nextSessionPollAt = this.now() + this.pollMs;
        if (!current) {
          // Discovery swallows transient errors into an empty list, which reads as a missing
          // session. Tolerate a few consecutive misses before concluding the terminal closed.
          sessionMissing = true;
          busy = false;
          missing += 1;
          if (missing >= this.sessionMissingGrace) {
            drain();
            if (sawFinal) {
              return this.finalize(task, finalText || lastText);
            }
            throw new ClaudeExecutionError(
              `The Claude terminal for ${task.thread_name || sessionId} closed before the turn produced a final response. The task may be incomplete; retry manually if needed.`,
              { retryable: false },
            );
          }
        } else {
          sessionMissing = false;
          missing = 0;
          busy = current.rawStatus === 'busy';
          if (busy) {
            // The single most reliable long-run signal. A sub-agent fleet can run for many
            // minutes without writing another parent transcript record, and this keeps that
            // turn alive. Busy is intentionally not durable submission proof: task 341 showed
            // one settling sample while the revision prompt was still held in Claude's composer.
            lastActivity = this.now();
          }
        }
      }
      // Exactly once per iteration, before any branch that can continue, so no interval is
      // counted twice or silently skipped.
      advanceSubmissionClock();

      if (sessionMissing) {
        await this.waitForTranscriptOrPoll(
          source,
          reader.offset,
          nextSessionPollAt - this.now(),
        );
        continue;
      }

      if (
        !promptSubmitted
        && !busy
        && !compacting
        && submitAttemptDue()
      ) {
        // Claude's large-paste widget can keep bracketed text in the composer even though
        // Terminal accepted the original do script Apple Event, and a Return sent while the TUI
        // is still digesting that paste is swallowed the same way. Before sending a separate
        // Return, re-verify the exact live session/window/tty and then check prompt correlation
        // and busy state again. This closes the race where the first Return was merely slow.
        // Unrelated transcript growth gets a quiet parsing interval, but never suppresses
        // recovery permanently. Every one of these conditions is re-proved on every attempt, and
        // correlation is re-checked once more immediately before the Apple Event, so evidence
        // that CC Relay can observe always stops the schedule. Evidence CC Relay cannot observe
        // remains the residual risk: if Claude ever accepts a paste without writing a hook, a
        // transcript prompt, or a busy status, later attempts still fire against a live turn.
        let identity;
        try {
          identity = await this.verifyTerminalIdentity(task, active, terminal, {
            tolerateResolutionFlake: true,
          });
        } catch (error) {
          if (error.cancelled) {
            await this.cancelTurn(terminal, sessionId, onEvent);
            throw error;
          }
          throw new ClaudeExecutionError(
            `CC Relay pasted the prompt into the ${task.thread_name || sessionId} terminal, but could not safely re-verify that exact terminal before sending an extra submit action. CC Relay did not send the extra action and will not retry automatically because the original submit may have started. Check or clear the terminal before retrying. ${error.message}`,
            { retryable: false },
          );
        }
        if (identity?.unresolved) {
          // Discovery or window resolution flaked. That proves nothing about the composer, so
          // send nothing, keep the schedule intact, and re-verify on the next poll. A resolver
          // that keeps failing exhausts the same grace the watcher uses for a missing session
          // and then ends the turn exactly as a single-attempt flake used to.
          submitResolutionFlakes += 1;
          if (submitResolutionFlakes >= this.sessionMissingGrace) {
            throw new ClaudeExecutionError(
              `CC Relay pasted the prompt into the ${task.thread_name || sessionId} terminal, but could not safely re-verify that exact terminal before sending an extra submit action. CC Relay did not send the extra action and will not retry automatically because the original submit may have started. Check or clear the terminal before retrying.`,
              { retryable: false },
            );
          }
          await this.waitForTranscriptOrPoll(source, reader.offset, this.pollMs);
          continue;
        }
        submitResolutionFlakes = 0;

        drain();
        const guardedTranscriptSize = source.size();
        if (guardedTranscriptSize >= 0 && guardedTranscriptSize > lastObservedSize) {
          lastObservedSize = guardedTranscriptSize;
          lastActivity = this.now();
          lastUncorrelatedGrowthAt = lastActivity;
        }
        if (promptSubmitted) {
          continue;
        }
        // A JSONL write can be observed between bytes. Give uncorrelated growth one quiet
        // polling interval to finish parsing before pressing Return. Completed compaction
        // records remain uncorrelated and become eligible on the next stable idle check.
        if (
          lastUncorrelatedGrowthAt !== null
          && this.now() - lastUncorrelatedGrowthAt < this.pollMs
        ) {
          await this.waitForTranscriptOrPoll(
            source,
            reader.offset,
            this.pollMs - (this.now() - lastUncorrelatedGrowthAt),
          );
          continue;
        }

        // A missing file is expected before the first accepted turn of a freshly initialized
        // conversation. Task 364 exposed that treating this positive absence as an unreadable
        // stat suppressed the only guarded Return and guaranteed a no-start timeout. Preserve
        // fail-closed behavior for established transcripts and genuine metadata errors.
        const guardedTranscriptState = guardedTranscriptSize >= 0
          ? 'present'
          : (typeof source.state === 'function' ? source.state() : 'unreadable');
        const transcriptStateAllowsSubmit = guardedTranscriptSize >= 0
          || (transcriptInitiallyAbsent && guardedTranscriptState === 'absent');
        if (transcriptStateAllowsSubmit) {
          // The loop-level busy flag is only as fresh as the last throttled session poll, and the
          // session can have started working since. This read, not that flag, is the authority
          // that the composer is idle at the instant the action is dispatched.
          let latest;
          try {
            latest = await this.sessions.readConnectedSession(sessionId);
          } catch {
            latest = null;
          }
          if (!latest) {
            throw new ClaudeExecutionError(
              `CC Relay pasted the prompt into the ${task.thread_name || sessionId} terminal, but the session disappeared before CC Relay could safely send an extra submit action. CC Relay did not send the extra action and will not retry automatically because the original submit may have started. Check or clear the terminal before retrying.`,
              { retryable: false },
            );
          }
          if (latest.rawStatus === 'busy') {
            busy = true;
            lastActivity = this.now();
            await this.waitForTranscriptOrPoll(source, reader.offset, this.pollMs);
            continue;
          }
          if (active.cancelRequested) {
            await this.cancelTurn(terminal, sessionId, onEvent);
            throw new ClaudeExecutionError('Task cancelled.', { cancelled: true });
          }

          // Last check before the Apple Event. The fresh session read above is an await, and a
          // UserPromptSubmit hook can land during it and mark this turn submitted. Without this
          // re-check the action would be dispatched into a turn that has already started.
          if (promptSubmitted) {
            continue;
          }

          // ---- composer verification, immediately before the Apple Event ----------------
          // Task 39 (July 30, 2026) ended with guarded Returns pressed at a composer that held
          // nothing at all: the paste had gone into Claude Code 2.1.220's resume picker, and the
          // compaction that the picker's default option started then destroyed it. A Return can
          // only submit text that is actually present, so read the screen once more and act on
          // what it proves.
          //
          // Deliberately fail-open, unlike the pre-injection gate: the prompt is already in flight
          // here, so an unreadable screen or an unrecognized composer keeps the former blind
          // action. Refusing everything CC Relay cannot classify would turn a recoverable held
          // paste into a guaranteed dead task, which is the exact defect this file keeps fixing.
          const screen = await this.inspectTerminalScreen(terminal.terminalWindowId);
          // That snapshot is an await, exactly like the fresh session read above, so re-prove both
          // gates that could have changed underneath it before anything is typed.
          if (active.cancelRequested) {
            await this.cancelTurn(terminal, sessionId, onEvent);
            throw new ClaudeExecutionError('Task cancelled.', { cancelled: true });
          }
          if (promptSubmitted) {
            continue;
          }
          if (screen.ok && screen.classification === 'trust-dialog') {
            // Positively identified dialog: a Return here answers a security question on the
            // user's behalf. The paste is already lost, so end the turn instead.
            throw this.trustDialogError(task, { pasted: true });
          }
          if (screen.ok && screen.classification === 'resume-picker') {
            // The dialog that destroyed task 39 is on screen right now, which proves the paste
            // never reached the composer. Answer it and let the schedule re-evaluate: the next
            // pass finds an empty composer and re-delivers the exact prompt. No submit attempt is
            // consumed, because no submit action was sent.
            await this.resolveResumePickerScreen(task, terminal.terminalWindowId, onEvent, screens, { pasted: true });
            await this.waitForTranscriptOrPoll(source, reader.offset, this.pollMs);
            continue;
          }
          let composer = screen.ok ? claudeComposerState(screen.text, prompt) : 'unreadable';
          if (composer === 'held' || composer === 'empty') {
            // A readable snapshot showing the composer is no longer occupied by foreign text is
            // the only thing that retires the latch below.
            screens.junkUnproven = false;
          }

          if (composer === 'junk') {
            screens.junkUnproven = true;
            // Some other unsubmitted text is in the way, so a Return here would submit a foreign
            // prompt. One Ctrl+C clears the Claude composer. sendComposerClear enforces the hard
            // invariant that two presses can never land inside Claude's exit-hint window, which
            // matters because the pre-injection residue clear may also have pressed it earlier in
            // this same turn. Terminal appends a Return to it; on a cleared composer that Return
            // is a verified no-op, and if the clear failed it would submit the foreign text, which
            // is precisely why the re-read below fails closed instead of typing anything more.
            try {
              await this.sendComposerClear(terminal.terminalWindowId, screens);
            } catch (error) {
              throw new ClaudeExecutionError(
                `The ${task.thread_name || sessionId} Claude terminal is holding text that is not this task's prompt and CC Relay could not clear it: ${error.message}. Nothing else was typed. Open the terminal, clear it, then retry.`,
                { retryable: false },
              );
            }
            await this.wait(this.screenSettleMs);
            const cleared = await this.inspectTerminalScreen(terminal.terminalWindowId);
            if (active.cancelRequested) {
              await this.cancelTurn(terminal, sessionId, onEvent);
              throw new ClaudeExecutionError('Task cancelled.', { cancelled: true });
            }
            if (promptSubmitted) {
              continue;
            }
            if (!cleared.ok) {
              // HARD INVARIANT: no Return may follow a junk-positive snapshot without a readable
              // snapshot proving the junk is gone. The general submit-time fail-open rule does not
              // apply here, because one snapshot ago this composer was positively identified as
              // holding text that is NOT this turn's prompt. Falling through to the blind Return
              // would submit that foreign text as the task's prompt if the clear did not land.
              // Skipping keeps the turn recoverable: the schedule stays alive and re-verifies on
              // the next pass, when the screen may be readable again. No attempt is consumed
              // because no action was sent, and the spacing is advanced so the next pass is a full
              // gap away rather than one poll away.
              this.announceDegradedScreenVerification(task, onEvent, screens, cleared.reason);
              lastSubmitAttemptAt = this.now();
              await this.waitForTranscriptOrPoll(source, reader.offset, this.pollMs);
              continue;
            }
            composer = claudeComposerState(cleared.text, prompt);
            if (composer === 'junk') {
              // Still occupied. Burning the remaining attempts against it would only risk
              // submitting that foreign text, so end the turn now with the same guidance the
              // exhausted schedule gives.
              throw new ClaudeExecutionError(
                `CC Relay pasted the prompt into the ${task.thread_name || sessionId} terminal, but the composer is holding different unsubmitted text that CC Relay could not clear. It did not press Return, because that would submit the wrong text. Open the terminal, clear it, then retry.`,
                { retryable: false },
              );
            }
            if (composer === 'unreadable') {
              // The screen read succeeded but the composer box is no longer recognizable, so the
              // junk is not proven gone. Same invariant as above: skip, never Return.
              lastSubmitAttemptAt = this.now();
              await this.waitForTranscriptOrPoll(source, reader.offset, this.pollMs);
              continue;
            }
            // Readable proof that the foreign text is gone.
            screens.junkUnproven = false;
          }

          if (composer === 'empty') {
            // The composer is provably empty while the session is idle and no submission evidence
            // exists, so the paste is gone: swallowed by a dialog, or discarded by a compaction.
            // No number of Returns can recover that. Re-deliver the exact same prompt once.
            if (screens.reinjections >= this.maxPromptReinjections) {
              // Already re-delivered once this turn. Pressing Return at an empty composer proves
              // nothing and types nothing useful, so send no action and let the submission window
              // end the turn with its explicit message. Keep the attempt spacing moving anyway,
              // otherwise every remaining poll would re-check a state that cannot change and spend
              // an Apple Event on it for the rest of the window.
              lastSubmitAttemptAt = this.now();
              await this.waitForTranscriptOrPoll(source, reader.offset, this.pollMs);
              continue;
            }
            screens.reinjections += 1;
            try {
              await this.inject(terminal.terminalWindowId, prompt);
            } catch (error) {
              throw new ClaudeExecutionError(
                `CC Relay found the ${task.thread_name || sessionId} composer empty and could not confirm it pasted the prompt again: ${error.message}. The prompt may now be running, so CC Relay will not retry automatically. Check the terminal before retrying.`,
                { retryable: false },
              );
            }
            // A re-delivered paste needs the same settling time the original one gets. Task 39's
            // root cause was a Return that arrived while the TUI was still converting a 201-line
            // paste into a chip, so restart the attempt spacing here even though this re-delivery
            // deliberately does not consume a submit attempt: the paste carries its own appended
            // Return, and the existing schedule continues unchanged after it.
            lastSubmitAttemptAt = this.now();
            onEvent({
              event: {
                type: 'claude/progress',
                provider: 'claude',
                sessionId,
                deliveryState: 're-injected',
                promptReinjection: screens.reinjections,
                promptReinjectionLimit: this.maxPromptReinjections,
              },
              message: `The ${task.thread_name || sessionId} composer was empty, so the held paste was lost, most likely to a resume dialog or a compaction. CC Relay pasted the exact same prompt again and is verifying that Claude accepted it.`,
            });
            await this.waitForTranscriptOrPoll(source, reader.offset, this.pollMs);
            continue;
          }

          if (composer === 'unreadable' && screens.junkUnproven) {
            // Earlier in this turn the composer positively held text that is not this prompt, and
            // no readable snapshot has shown it gone since. The blind Return is fail-open for a
            // screen CC Relay never understood; it must not resurrect once foreign text HAS been
            // seen, because that Return would submit it as this task's prompt. Skip and re-verify.
            lastSubmitAttemptAt = this.now();
            await this.waitForTranscriptOrPoll(source, reader.offset, this.pollMs);
            continue;
          }

          // Count the attempt before dispatching it. The Apple Event can produce its evidence
          // (a UserPromptSubmit hook) while this call is still awaited, and the started event
          // must report the attempt that actually caused it.
          submitAttempts += 1;
          try {
            await this.submit(terminal.terminalWindowId);
          } catch (error) {
            throw new ClaudeExecutionError(
              `CC Relay pasted the prompt into the ${task.thread_name || sessionId} terminal but could not confirm the separate submit action: ${error.message}. The prompt may now be running, so CC Relay will not retry automatically. Check the terminal before retrying.`,
              { retryable: false },
            );
          }
          // Measure the next gap from when the action completed, so a slow Apple Event never
          // shortens the interval a landed Return has to prove itself.
          lastSubmitAttemptAt = this.now();
          onEvent({
            event: {
              type: 'claude/progress',
              provider: 'claude',
              sessionId,
              deliveryState: 'submit-attempt',
              submitAttempt: submitAttempts,
              submitAttemptLimit: this.maxSubmitAttempts,
            },
            message: `CC Relay found no UserPromptSubmit event or matching transcript prompt in the ${task.thread_name || sessionId} terminal, so it sent one separate submit action (attempt ${submitAttempts} of ${this.maxSubmitAttempts}).`,
          });
        }
      }

      if (
        !promptSubmitted
        && !busy
        && !compacting
        && submissionElapsedMs > this.submissionTimeoutMs
      ) {
        // Paste and every guarded submit action reported success but nothing ran. Do NOT fall
        // back to headless: the text may still be sitting in the composer and a second execution
        // would duplicate it. The whole schedule lives inside one window measured from injection,
        // so recovery attempts can never extend how long a dead paste holds its project slot.
        const attemptsSent = submitAttempts === 1
          ? 'sent 1 separate submit action'
          : `sent ${submitAttempts} separate submit actions`;
        // A re-delivery means CC Relay positively saw an empty composer at some point, so the
        // failure is not the usual held paste and the guidance has to say so.
        const reinjectionNote = screens.reinjections > 0
          ? ` CC Relay also found the composer empty during this turn and pasted the exact prompt again ${screens.reinjections === 1 ? 'once' : `${screens.reinjections} times`}, which still produced no turn.`
          : '';
        throw new ClaudeExecutionError(
          submitAttempts > 0
            ? `CC Relay pasted the prompt into the ${task.thread_name || sessionId} terminal and ${attemptsSent}, but the Claude session still never started the turn.${reinjectionNote} The terminal may be holding unsubmitted text. Open it, submit or clear the prompt, then retry.`
            : `CC Relay sent the prompt to the ${task.thread_name || sessionId} terminal but the Claude session never started the turn.${reinjectionNote} The terminal may be holding unsubmitted text. Open it, submit or clear the prompt, then retry.`,
          { retryable: false },
        );
      }

      if (sessionPollDue) {
        if (promptSubmitted && !busy) {
          idleObservations += 1;
          if (
            sawFinal
            && pendingSteers.size === 0
            && idleObservations >= this.finalIdleObservations
          ) {
            // Drain once more: a single API response is written as several records and a
            // thinking-only record can carry a terminal stop reason before the text record
            // flushes, so give the final text a chance to arrive before recording the result.
            drain();
            return this.finalize(task, finalText || lastText);
          }
          if (
            !awaitingInput
            && pendingInputRequests.size > 0
            && idleObservations >= this.idleGraceObservations
          ) {
            // Input needed is emitted only after Claude's own AskUserQuestion event proves a
            // question exists. Generic idle is not enough: task 15 returned idle after
            // compaction while the continuation was still held and no question was visible.
            awaitingInput = true;
            onEvent({
              event: {
                type: 'claude/input-required',
                provider: 'claude',
                sessionId,
                inputEvidence: 'AskUserQuestion',
              },
              message: `Claude asked a question in the ${task.thread_name || sessionId} terminal. Answer it there to continue; CC Relay verified the question event and will keep this task running.`,
            });
            if (typeof this.requestAttention === 'function') {
              void Promise.resolve()
                .then(() => this.requestAttention({
                  provider: 'claude',
                  thread: current,
                  terminal,
                }))
                .catch((error) => {
                  onStderr(`CC Relay could not bring the Claude terminal forward for input: ${error.message}`);
                });
            }
          } else if (
            pendingInputRequests.size === 0
            && !unverifiedIdleAnnounced
            && idleObservations >= this.idleGraceObservations
          ) {
            unverifiedIdleAnnounced = true;
            onEvent({
              event: {
                type: 'claude/progress',
                provider: 'claude',
                sessionId,
                deliveryState: 'idle-without-question',
              },
              message: `Claude is idle without a final response in the ${task.thread_name || sessionId} terminal, but CC Relay received no question event. It will keep checking instead of incorrectly marking the task Input needed.`,
            });
          }
        } else {
          idleObservations = 0;
          if (busy) unverifiedIdleAnnounced = false;
        }
      }

      if (busy && this.now() - lastHeartbeat > this.heartbeatMs) {
        onEvent({
          event: { type: 'claude/progress', provider: 'claude', sessionId },
          // Busy before any submission evidence is NOT this turn running. It is compaction, a
          // session still loading, or work CC Relay did not start. Saying "still working" there
          // reads as progress on the task and is exactly how task 39 looked healthy while its
          // prompt was already lost.
          message: promptSubmitted
            ? `Claude is still working in the ${task.thread_name || sessionId} terminal.`
            : `Claude is busy in the ${task.thread_name || sessionId} terminal before accepting the prompt (compaction or session preparation). CC Relay is still waiting to verify the exact prompt.`,
        });
        lastHeartbeat = this.now();
      }

      await this.waitForTranscriptOrPoll(
        source,
        reader.offset,
        nextSessionPollAt - this.now(),
      );
    }
  }

  finalize(task, text) {
    const sessionId = task.thread_id;
    const finalResponse = typeof text === 'string' ? text.trim() : '';
    if (!finalResponse) {
      throw new ClaudeExecutionError(
        `The Claude turn in ${task.thread_name || sessionId} completed without any final text. CC Relay will not retype the prompt automatically; check the terminal and retry if needed.`,
        { retryable: false },
      );
    }
    return {
      finalResponse,
      sessionId,
      reportedSessionId: sessionId,
      exitCode: 0,
    };
  }

  async cancelTurn(terminal, sessionId, onEvent) {
    try {
      await this.sendCancel(terminal.terminalWindowId);
    } catch {
      // best effort only
    }
    onEvent({
      event: { type: 'claude/progress', provider: 'claude', sessionId },
      message: 'Cancellation requested. CC Relay stopped watching this terminal turn; the terminal may still be finishing it.',
    });
  }
}
