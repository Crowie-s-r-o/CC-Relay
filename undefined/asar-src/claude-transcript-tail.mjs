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

// Claude normally persists a submitted terminal prompt as either one string or one or more
// user text blocks. Tool results, compact summaries, and slash-command bookkeeping are not
// prompt-delivery evidence for the turn CC Relay just injected.
export function userPromptRecordText(record) {
  if (record?.type !== 'user' || record.isCompactSummary === true) return '';
  const content = record.message?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content) || content.some((block) => block?.type === 'tool_result')) return '';
  return content
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n');
}

// Prompt hooks provide the exact submitted text. The transcript fallback can include
// hook-injected context before the pasted prompt, so a complete suffix match is also valid.
// Matching the full expected value keeps `/compact`, compact summaries, attachments, and
// unrelated terminal activity from being mistaken for this turn.
export function submittedPromptMatches(value, expectedPrompts) {
  const actual = normalizedPromptText(value);
  if (!actual) return false;
  return (Array.isArray(expectedPrompts) ? expectedPrompts : [expectedPrompts])
    .map((expected) => normalizedPromptText(sanitizeInjectedPrompt(expected)))
    .filter(Boolean)
    .some((expected) => actual === expected || actual.endsWith(`\n${expected}`));
}

export function isSubmittedPromptRecord(record, expectedPrompts) {
  return submittedPromptMatches(userPromptRecordText(record), expectedPrompts);
}

// Claude Code's interactive composer rewrites a pasted prompt that references image files, so the
// delivered text can never equal what the transcript or the UserPromptSubmit hook reports for an
// attachment-bearing turn. Four samples reproduce byte for byte under the rules below: the plan
// council author stage of task 39 at 2026-07-30T13:13 and 13:22 (one attachment path referenced
// twice), the direct Execute task 41 at 13:55 (three distinct attachment paths), and a captured
// live hook payload from Claude Code 2.1.220 whose `prompt` field equals the transcript text
// exactly. Both evidence channels report this one form, so it is the only anchor an image turn has.
//
//   1. Every occurrence of a known attachment path is removed, together with one immediately
//      preceding space when there is one.
//   2. Runs of two or more newlines collapse to a single newline, so pasted blank lines disappear.
//   3. The recorded prompt begins with one `[Image #N]` chip per removed occurrence, numbered in
//      delivery order, joined by single spaces and concatenated directly onto the rewritten text
//      with no separator (`[Image #1] [Image #2]You are the author ...`).
//
// The same path referenced twice produces two chips, so occurrences are counted, not unique paths.
// This derives the complete expected prompt, never a prefix or fragment, so accepting it keeps the
// task 15 contract exact. A prompt with no known attachment reference returns no rewrite at all,
// which is why text-only prompts keep pure raw-equality semantics and are unaffected.
export function attachmentRewrittenPrompts(prompt, attachmentPaths = []) {
  const paths = (Array.isArray(attachmentPaths) ? attachmentPaths : [attachmentPaths])
    .filter((value) => typeof value === 'string' && value.length > 0);
  if (paths.length === 0) return [];
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
  if (occurrences === 0) return [];
  chunks.push(text.slice(cursor));
  const stripped = chunks.join('');
  const chips = Array.from({ length: occurrences }, (_, index) => `[Image #${index + 1}]`).join(' ');
  // The samples contain no whitespace-only lines, so they cannot separate "collapse newline runs"
  // from "drop empty lines". Both readings are emitted because they agree on every observed case
  // and each remains a complete transform of the whole prompt.
  return [...new Set([
    `${chips}${stripped.replace(/\n{2,}/g, '\n')}`,
    `${chips}${stripped.split('\n').filter((line) => line !== '').join('\n')}`,
  ])];
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
