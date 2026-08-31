import {
  closeSync,
  existsSync as fsExistsSync,
  openSync,
  readSync,
  readdirSync as fsReaddirSync,
  realpathSync as fsRealpathSync,
  statSync as fsStatSync,
  watch as fsWatch,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';

// Claude Code stores an interactive session transcript at
// ~/.claude/projects/<munged cwd>/<sessionId>.jsonl
// where the munged directory replaces every non-alphanumeric character with '-'.
// The spike confirmed Claude munges the REAL (realpath-resolved) cwd, so a symlinked
// path such as /var/... (a symlink to /private/var/...) resolves to the private form.
export function mungeClaudeCwd(cwd) {
  return String(cwd || '').replace(/[^a-zA-Z0-9]/g, '-');
}

// Resolve the transcript path for a session. Tries the realpath-munged directory and
// the raw-munged directory, then falls back to locating <sessionId>.jsonl under any
// project directory. The glob fallback keeps discovery correct even if the munging
// rule shifts between Claude versions.
export function resolveClaudeTranscriptPath(cwd, sessionId, {
  home = homedir(),
  existsSync = fsExistsSync,
  readdirSync = fsReaddirSync,
  realpathSync = fsRealpathSync,
} = {}) {
  const base = join(home, '.claude', 'projects');
  const munged = [];
  let resolvedCwd = null;
  try {
    resolvedCwd = realpathSync(cwd);
  } catch {
    resolvedCwd = null;
  }
  for (const candidate of [resolvedCwd, cwd]) {
    if (typeof candidate === 'string' && candidate.trim()) {
      const dir = mungeClaudeCwd(candidate);
      if (!munged.includes(dir)) munged.push(dir);
    }
  }
  for (const dir of munged) {
    const path = join(base, dir, `${sessionId}.jsonl`);
    if (existsSync(path)) return path;
  }
  try {
    for (const dir of readdirSync(base)) {
      const path = join(base, dir, `${sessionId}.jsonl`);
      if (existsSync(path)) return path;
    }
  } catch {
    // base directory does not exist yet
  }
  const primary = munged[0] || mungeClaudeCwd(cwd);
  return join(base, primary, `${sessionId}.jsonl`);
}

// A transcript source reads only the bytes appended after a given offset so a large
// transcript is never re-read on every poll. Backed by fs by default; tests inject a fake.
export function fsTranscriptSource(path, {
  statSync = fsStatSync,
  existsSync = fsExistsSync,
  watch = fsWatch,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  return {
    path,
    // Preserve the difference between a transcript that has not been created yet and one
    // whose metadata cannot be read. A fresh first turn legitimately has no file until Claude
    // accepts the prompt, while every other stat failure must remain fail-closed.
    state() {
      try {
        statSync(path);
        return 'present';
      } catch (error) {
        return error?.code === 'ENOENT' ? 'absent' : 'unreadable';
      }
    },
    // Whether the transcript file is present. Observed once at turn start to classify a
    // freshly launched session (no transcript yet) apart from an established one, so a later
    // transient stat failure cannot be mistaken for a fresh session. existsSync itself
    // returns false on any stat error, so it must never be trusted concurrently with size().
    exists() {
      return existsSync(path);
    },
    size() {
      try {
        return statSync(path).size;
      } catch {
        return -1;
      }
    },
    // Wake the terminal mirror as soon as Claude appends transcript bytes. The timeout keeps
    // session liveness, cancellation, and inactivity checks running even when the file is
    // quiet or the platform watcher misses an event. Watching the parent directory also
    // covers a fresh conversation whose transcript file does not exist until its first turn.
    waitForChange(offset, timeoutMs) {
      const observedSize = Number(offset);
      const currentSize = () => {
        try {
          return statSync(path).size;
        } catch {
          return -1;
        }
      };
      const initialSize = currentSize();
      if (initialSize >= 0 && initialSize !== observedSize) {
        return Promise.resolve(true);
      }
      return new Promise((resolveWait) => {
        let settled = false;
        let watcher = null;
        let timer = null;
        const finish = (changed) => {
          if (settled) return;
          settled = true;
          if (timer !== null) clearTimer(timer);
          watcher?.close();
          resolveWait(changed);
        };
        timer = setTimer(() => finish(false), Math.max(0, timeoutMs));
        try {
          watcher = watch(dirname(path), { persistent: false }, (_eventType, fileName) => {
            if (fileName != null && String(fileName) !== basename(path)) return;
            const changedSize = currentSize();
            if (changedSize < 0 || changedSize !== observedSize) finish(true);
          });
          watcher.on?.('error', () => {
            watcher?.close();
            watcher = null;
          });
        } catch {
          // The timeout remains the fallback when native file watching is unavailable.
        }
        // Close the race between the first size read and installing the directory watcher.
        const watchedSize = currentSize();
        if (watchedSize >= 0 && watchedSize !== observedSize) finish(true);
      });
    },
    readFrom(offset) {
      let size;
      try {
        size = statSync(path).size;
      } catch {
        return Buffer.alloc(0);
      }
      if (size <= offset) return Buffer.alloc(0);
      const length = size - offset;
      let fd;
      try {
        fd = openSync(path, 'r');
      } catch {
        return Buffer.alloc(0);
      }
      try {
        const buffer = Buffer.alloc(length);
        const read = readSync(fd, buffer, 0, length, offset);
        return read === length ? buffer : buffer.subarray(0, read);
      } catch {
        return Buffer.alloc(0);
      } finally {
        closeSync(fd);
      }
    },
  };
}

// Stateful line reader over a transcript source. Tracks a byte offset and buffers a
// trailing partial line so JSONL records are only surfaced once, in order.
export function createTranscriptReader(source, startOffset = 0) {
  let offset = Math.max(0, startOffset);
  let leftover = Buffer.alloc(0);
  return {
    get offset() {
      return offset;
    },
    // Returns an array of parsed records appended since the previous poll. Malformed
    // lines are skipped rather than throwing so one bad line never stalls the turn.
    poll() {
      const chunk = source.readFrom(offset);
      if (!chunk || chunk.length === 0) return [];
      offset += chunk.length;
      const data = leftover.length ? Buffer.concat([leftover, chunk]) : chunk;
      const records = [];
      let start = 0;
      for (let index = 0; index < data.length; index += 1) {
        if (data[index] === 0x0a) {
          const line = data.subarray(start, index).toString('utf8').trim();
          start = index + 1;
          if (line) {
            try {
              records.push(JSON.parse(line));
            } catch {
              // ignore a partial or non-JSON transcript line
            }
          }
        }
      }
      leftover = start < data.length ? data.subarray(start) : Buffer.alloc(0);
      return records;
    },
  };
}

// Concatenated non-empty text blocks of an assistant transcript record.
export function assistantRecordText(record) {
  if (record?.type !== 'assistant') return '';
  const blocks = record.message?.content;
  if (!Array.isArray(blocks)) return '';
  return blocks
    .filter((block) => block?.type === 'text' && typeof block.text === 'string' && block.text.trim())
    .map((block) => block.text.trim())
    .join('\n');
}

function normalizedPromptText(value) {
  return typeof value === 'string'
    ? value.replace(/\r\n?/g, '\n').trimEnd()
    : '';
}

// Claude Code's interactive composer records a pasted tab as four ASCII spaces. Task 1152
// reproduced the conversion twice with the same 39,907-character delivered prompt: all 30 tabs
// became four spaces, producing the same 39,997-character UserPromptSubmit and transcript value on
// both attempts. Keep the raw form too because a queued prompt is recorded before composer
// rewriting and future Claude versions may preserve tabs. This remains a complete deterministic
// transport transform, never general whitespace normalization.
const expandedTerminalTabs = (value) => String(value ?? '').replaceAll('\t', '    ');

// Claude normally persists a submitted terminal prompt as either one string or one or more
// user text blocks. Tool results, compact summaries, and slash-command bookkeeping are not
// prompt-delivery evidence for the turn CC Relay just injected.
//
// The bookkeeping is the `<command-name>`, `<local-command-stdout>`, `<local-command-stderr>`, and
// `<local-command-caveat>` blocks Claude Code wraps around a slash command. `<local-command-stderr>`
// is the only one not in the capture below, because that compaction succeeded; a slash command that
// FAILS writes its diagnostics into that wrapper with no `isMeta` flag either, so leaving it out
// would let the next failed compaction rebuild this incident byte for byte.
//
// Task 91 attempt 3 hit the other three on 2026-08-03 in session a0c55566 (Claude Code 2.1.220):
// CC Relay pasted at 14:26:00.620, exactly as a `/compact` of a 3MB conversation started, and the
// compaction appended indices 201 through 204 to the JSONL: the compact summary (201),
// `<local-command-caveat>` (202), `<command-name>/compact</command-name>` plus its command-message
// and command-args lines (203), and `<local-command-stdout>` (204). All four land AFTER this turn's
// injection offset even though 202 and 203 carry earlier timestamps, because Claude flushes
// slash-command records only when the command completes, so an offset-based reader sees the whole
// block as fresh post-paste traffic.
//
// Claude writes 203 and 204 with NO `isMeta` flag, so the caller's `isMeta !== true` guard cannot
// drop them and they have to be dropped here. Read as prompt text they look like a submitted prompt
// belonging to nobody, which latched the executor's unmatched-submission check, froze all further
// paste and submit recovery, and failed the task at its submission window with the held prompt still
// undelivered.
//
// The raw `/compact` record at index 193 is deliberately still returned. It is the record a genuine
// slash-command prompt correlates on and Claude writes it BEFORE the bookkeeping block, so dropping
// the block loses no delivery evidence.
//
// The narrow accepted cost is at the other end: `taskPrompt` leads with the user's own raw text, so
// a prompt that literally OPENS with one of these markers loses this transcript channel and can then
// correlate only through the UserPromptSubmit hook. No such prompt has been observed, and the
// alternative is a recovery freeze every time a slash command runs inside a CC Relay turn.
export function userPromptRecordText(record) {
  if (record?.type !== 'user' || record.isCompactSummary === true) return '';
  const isSlashCommandBookkeeping = (value) => {
    const text = value.trim();
    return text.startsWith('<command-name>')
      || text.startsWith('<local-command-stdout>')
      || text.startsWith('<local-command-stderr>')
      || text.startsWith('<local-command-caveat>');
  };
  const content = record.message?.content;
  // The returned text stays byte for byte what Claude recorded. `normalizedPromptText` only trims
  // the end, so trimming here would break the exact-equality path in `submittedPromptMatches`.
  if (typeof content === 'string') return isSlashCommandBookkeeping(content) ? '' : content;
  if (!Array.isArray(content) || content.some((block) => block?.type === 'tool_result')) return '';
  const text = content
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n');
  return isSlashCommandBookkeeping(text) ? '' : text;
}

// A message typed into a BUSY Claude session is never submitted; the composer puts it in the
// session queue and Claude Code writes a `queue-operation` record instead of a user record. Task
// 85 captured three of them on 2026-07-31 in session 917fd23a (Claude Code 2.1.220):
//
//   { "type": "queue-operation", "operation": "enqueue",
//     "timestamp": "2026-07-31T12:38:38.538Z", "sessionId": "917fd23a-...",
//     "content": "<the submitted text>" }
//
// `content` is the injected text BYTE FOR BYTE. There is no queued-message framing, no wrapper,
// no `[Image #N]` chip run, and no truncation: re-running the real `taskPrompt()` builder over
// the recorded text reproduces the recorded string exactly on all three samples. That is why the
// same `submittedPromptMatches` / `submittedRewrittenPromptMatches` pair correlates it, and why a
// foreign human message, an `<agent-message>`, or a `<task-notification>` (which travel as
// `queue-operation` records too) can never match: they are not this exact delivered prompt.
//
// Only `enqueue` proves the session accepted the text. Claude Code reuses `queue-operation` with
// other verbs (`remove` at consumption, and `dequeue` elsewhere in this repository's fixtures) for
// leaving the queue, and a human deleting a queued message emits the same verb as consuming it, so
// no other verb can stand as delivery evidence.
export function queuedPromptRecordText(record) {
  if (record?.type !== 'queue-operation' || record.operation !== 'enqueue') return '';
  return typeof record.content === 'string' ? record.content : '';
}

// Proof that the queued text was CONSUMED into a turn, which is the only record that can start one.
// Observed on all three task 85 samples:
//
//   { "type": "attachment", "attachment": { "type": "queued_command",
//     "prompt": "<the submitted text>", "commandMode": "prompt", "origin": { "kind": "human" } } }
//
// This shape exists only when Claude attaches the queued command to a turn, so unlike the `remove`
// verb below it cannot also mean "the human deleted it from the queue". That distinction is why the
// two helpers are separate: a merely-ambiguous release may lift a suppression, but only unambiguous
// consumption may declare that a prompt's own turn has begun.
//
// The record is WRITTEN at consumption but STAMPED with the enqueue timestamp, and in the capture it
// is positioned after its own `remove` record, so its timestamp is never a latency measurement.
export function consumedQueuedPromptRecordText(record) {
  if (record?.type !== 'attachment' || record.attachment?.type !== 'queued_command') return '';
  return typeof record.attachment.prompt === 'string' ? record.attachment.prompt : '';
}

// The superset: proof that the queued text is no longer waiting, whether it was consumed into a turn
// or removed from the queue. It is NEVER delivery evidence and never starts a turn, only a boundary
// signal, which is what makes the ambiguity of `remove` harmless here. Both dispositions must lift a
// suppression, because under either one the text has stopped waiting.
//
//   { "type": "queue-operation", "operation": "remove", "content": "<the submitted text>" }
export function releasedQueuedPromptRecordText(record) {
  if (record?.type === 'queue-operation') {
    if (record.operation === 'enqueue') return '';
    return typeof record.content === 'string' ? record.content : '';
  }
  return consumedQueuedPromptRecordText(record);
}

// Prompt hooks provide the exact submitted text. The transcript fallback can include
// hook-injected context before the pasted prompt, so a complete suffix match is also valid.
// Matching the full expected value keeps `/compact`, compact summaries, attachments, and
// unrelated terminal activity from being mistaken for this turn.
export function submittedPromptMatchKind(value, expectedPrompts) {
  const actual = normalizedPromptText(value);
  if (!actual) return null;
  const expected = (Array.isArray(expectedPrompts) ? expectedPrompts : [expectedPrompts])
    .map((expected) => normalizedPromptText(sanitizeInjectedPrompt(expected)))
    .filter(Boolean);
  if (expected.some((candidate) => actual === candidate || actual.endsWith(`\n${candidate}`))) {
    return 'exact';
  }
  if (expected.some((candidate) => {
    if (!candidate.includes('\t')) return false;
    const expanded = expandedTerminalTabs(candidate);
    return actual === expanded || actual.endsWith(`\n${expanded}`);
  })) {
    return 'tab-expanded';
  }
  return null;
}

export function submittedPromptMatches(value, expectedPrompts) {
  return submittedPromptMatchKind(value, expectedPrompts) !== null;
}

export function isSubmittedPromptRecord(record, expectedPrompts) {
  return submittedPromptMatches(userPromptRecordText(record), expectedPrompts);
}

// Claude Code's interactive composer rewrites a pasted prompt that references image files, so the
// delivered text can never equal what the transcript or the UserPromptSubmit hook reports for an
// attachment-bearing turn. Six samples reproduce byte for byte under the rules below: the plan
// council author stage of task 39 at 2026-07-30T13:13 and 13:22 (one attachment path referenced
// twice), the direct Execute task 41 at 13:55 (three distinct attachment paths), and a captured
// live hook payload from Claude Code 2.1.220 whose `prompt` field equals the transcript text
// exactly. Task 58 adds a reviewed-plan Execute prompt with four slash-boundary conversions, and
// task 84 adds a council revision stage whose chips did not start at one.
// Both evidence channels report rewritten forms, so they are the only anchors an image turn has.
//
//   1. Every occurrence of a known attachment path is removed, together with one immediately
//      preceding space when there is one.
//   2. Runs of two or more newlines collapse to a single newline, so pasted blank lines disappear.
//   3. The recorded prompt begins with one `[Image #N]` chip per removed occurrence, joined by
//      single spaces and concatenated directly onto the rewritten text with no separator. The
//      indices are strictly consecutive ascending integers, but Claude numbers them cumulatively
//      across the whole SESSION, not per prompt, so the run can start at any index >= 1. Task 84's
//      revision stage followed a draft stage that had already consumed two chips and was recorded
//      as `[Image #3] [Image #4]You are the original plan author ...`; after the user pressed
//      Resume the identical prompt came back as `[Image #5] [Image #6]...`. Deriving a single
//      start-at-one form matched neither, and the stage failed at promptAcceptanceTimeoutMs while
//      Claude had already completed it. The count is contractual, the start is not.
//   4. Claude can replace every space immediately before `/` with a newline. Task 58 changed all
//      four occurrences, including prose (`View Input / View Output`) and API paths (`GET /api`).
//      Task 84 confirmed the same conversion across a 27 KB prompt.
//
// The same path referenced twice produces two chips, so occurrences are counted, not unique paths.
// This derives the complete expected prompt, never a prefix or fragment, so accepting it keeps the
// task 15 contract exact. A prompt with no known attachment reference returns no attachment rewrite
// at all. Text-only prompts therefore keep complete-prompt correlation, including only the separate
// terminal tab transport form documented in [[claude-tab-prompt-correlation]].
//
// Returns the chip-less bodies plus the exact number of chips that must precede them, so a live
// candidate is matched by `submittedRewrittenPromptMatches` rather than by string equality against
// one guessed numbering. `chipCount` is 0 for a prompt with no known attachment reference, and also
// for the degenerate prompt that is nothing but attachment paths, which would leave no body to
// identify the turn by.
export function attachmentRewrittenPromptForms(prompt, attachmentPaths = []) {
  const paths = (Array.isArray(attachmentPaths) ? attachmentPaths : [attachmentPaths])
    .filter((value) => typeof value === 'string' && value.length > 0);
  if (paths.length === 0) return { chipCount: 0, bodies: [] };
  // Derive from the exact text that was injected, with line endings already normalized so the
  // blank-line rule below sees the same newlines the transcript comparison will.
  const text = sanitizeInjectedPrompt(prompt).replace(/\r\n?/g, '\n');
  const chunks = [];
  let cursor = 0;
  let occurrences = 0;
  for (;;) {
    let matchIndex = -1;
    let matched = null;
    for (const path of paths) {
      const found = text.indexOf(path, cursor);
      if (found < 0) continue;
      // Earliest occurrence wins; the longest path wins a tie so one attachment path that is a
      // prefix of another can never consume the longer reference.
      if (matchIndex < 0 || found < matchIndex || (found === matchIndex && path.length > matched.length)) {
        matchIndex = found;
        matched = path;
      }
    }
    if (matchIndex < 0) break;
    const end = matchIndex > cursor && text[matchIndex - 1] === ' ' ? matchIndex - 1 : matchIndex;
    chunks.push(text.slice(cursor, end));
    cursor = matchIndex + matched.length;
    occurrences += 1;
  }
  if (occurrences === 0) return { chipCount: 0, bodies: [] };
  chunks.push(text.slice(cursor));
  const stripped = chunks.join('');
  // The samples contain no whitespace-only lines, so they cannot separate "collapse newline runs"
  // from "drop empty lines". Both readings are emitted because they agree on every observed case
  // and each remains a complete transform of the whole prompt.
  const blankLineVariants = [
    stripped.replace(/\n{2,}/g, '\n'),
    stripped.split('\n').filter((line) => line !== '').join('\n'),
  ];
  const bodies = new Set();
  for (const variant of blankLineVariants) {
    const addTransportForms = (value) => {
      bodies.add(value);
      if (value.includes('\t')) bodies.add(expandedTerminalTabs(value));
    };
    addTransportForms(variant);
    // Task 58 converted every occurrence across the prompt. Keep the unconverted form too because
    // earlier production captures retained their spaces. Both candidates still represent the
    // complete prompt, so a partially converted or truncated value remains invalid.
    addTransportForms(variant.replaceAll(' /', '\n/'));
  }
  // A prompt whose entire content is attachment paths leaves nothing behind to identify it, and a
  // chip run alone is not a prompt: with the start index no longer contractual, an empty body would
  // accept any record ending in a newline and one chip. No CC Relay builder can produce this today
  // (taskPrompt always appends the reference list and the non-interactive notice), so refusing it
  // costs nothing and stops a future call site from creating a worthless anchor.
  const identifying = [...bodies].filter((body) => body.trim() !== '');
  if (identifying.length === 0) return { chipCount: 0, bodies: [] };
  return { chipCount: occurrences, bodies: identifying };
}

// The canonical rendering of the derived forms: the same bodies with a chip run that starts at one.
// It is what the production samples and this repository's documentation quote, and what the tests
// pin the observed shapes against. Live correlation must not compare against it directly, because
// rule 3 above makes the start index a session-cumulative value rather than a contractual one.
export function attachmentRewrittenPrompts(prompt, attachmentPaths = []) {
  const { chipCount, bodies } = attachmentRewrittenPromptForms(prompt, attachmentPaths);
  if (chipCount === 0) return [];
  const chips = Array.from({ length: chipCount }, (_, index) => `[Image #${index + 1}]`).join(' ');
  return bodies.map((body) => `${chips}${body}`);
}

// True when `value` is a complete rewritten form of the derived prompt: exactly `chipCount` chips
// whose indices ascend by one from any start >= 1, immediately followed by one derived body and
// nothing else. Anchoring on the body first means the chip run is only ever validated, never
// searched for, so the accepted shapes stay exactly the two that raw correlation accepts:
// `chips + body`, and `\n` preceded context before `chips + body` for a hook that injects context.
// A longer chip run cannot satisfy a shorter expectation, because the extra chips leave the run
// preceded by `] ` instead of the start of the text or a newline.
export function submittedRewrittenPromptMatches(value, forms) {
  const chipCount = Number(forms?.chipCount) || 0;
  const bodies = Array.isArray(forms?.bodies) ? forms.bodies : [];
  if (chipCount < 1 || bodies.length === 0) return false;
  const actual = normalizedPromptText(value);
  if (!actual) return false;
  // `[1-9]\d*` rejects `[Image #0]` and any zero-padded index without a second numeric check.
  const chipRun = new RegExp(
    String.raw`(?:^|\n)((?:\[Image #[1-9]\d*\] ){${chipCount - 1}}\[Image #[1-9]\d*\])$`,
  );
  for (const body of bodies) {
    const expected = normalizedPromptText(sanitizeInjectedPrompt(body));
    // Second half of the empty-body refusal above, for a `forms` value assembled by a caller rather
    // than derived here. An empty expectation would degenerate into "ends with a chip run".
    if (!expected) continue;
    if (!actual.endsWith(expected)) continue;
    const run = chipRun.exec(actual.slice(0, actual.length - expected.length));
    if (!run) continue;
    const indices = [...run[1].matchAll(/\[Image #(\d+)\]/g)].map(([, index]) => Number(index));
    if (indices.every((index, position) => position === 0 || index === indices[position - 1] + 1)) {
      return true;
    }
  }
  return false;
}

// True when an assistant record ends the turn. Intermediate tool rounds carry
// stop_reason 'tool_use'; every other terminal reason (end_turn, max_tokens,
// stop_sequence, null) means the model stopped generating for this turn.
export function isTurnFinalAssistantRecord(record) {
  return record?.type === 'assistant' && record.message?.stop_reason !== 'tool_use';
}

// Remove the ESC byte so a prompt can never contain the bracketed-paste end marker
// (ESC[201~) and break out of paste mode mid-injection, submitting partial garbage.
export function sanitizeInjectedPrompt(text) {
  // eslint-disable-next-line no-control-regex
  return String(text ?? '').replace(/\u001b/g, '');
}

// Wrap sanitized text in bracketed-paste markers. The interactive TUI inserts the
// whole block literally (newlines stay soft). Terminal's do script appends Return,
// but the executor separately verifies that Claude actually started the turn.
export function bracketedPastePayload(text) {
  const esc = String.fromCharCode(27);
  return `${esc}[200~${sanitizeInjectedPrompt(text)}${esc}[201~`;
}

// Reject prompts that cannot travel safely as an osascript argv value before typing.
// The prompt is passed as a single process argument, so a NUL byte would truncate it in
// C, and an oversized value risks exceeding the operating-system argument limit. Returns
// a human-readable reason string, or null when the prompt is safe to inject.
export function injectionPromptIssue(text, { maxBytes = 100_000 } = {}) {
  const value = String(text ?? '');
  if (value.includes('\u0000')) {
    return 'the prompt contains a NUL character, which the terminal cannot receive.';
  }
  const bytes = Buffer.byteLength(value, 'utf8');
  if (bytes > maxBytes) {
    return `the prompt is ${bytes} bytes, larger than the ${maxBytes}-byte terminal injection limit.`;
  }
  return null;
}
