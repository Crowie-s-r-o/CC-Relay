import {
  closeSync,
  existsSync as fsExistsSync,
  openSync,
  readSync,
  readdirSync as fsReaddirSync,
  realpathSync as fsRealpathSync,
  statSync as fsStatSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

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
} = {}) {
  return {
    path,
    size() {
      try {
        return statSync(path).size;
      } catch {
        return -1;
      }
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
// whole block literally (newlines stay soft), and Terminal's do script appends the
// carriage return that submits it as one turn.
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
    return `the prompt is ${bytes} bytes, larger than the ${maxBytes}-byte terminal injection limit. Shorten it, or run it on a non-macOS Relay that uses the headless path.`;
  }
  return null;
}
