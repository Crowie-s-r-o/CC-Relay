import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { claudeRelayCommand, cmdQuote, shellQuote } from '../src/project-launcher.mjs';

const root = new URL('../', import.meta.url);

// What the Claude binary resolver returns on Windows now that it resolves an absolute path: a
// global npm install writes its shim under %APPDATA%\npm, and the account name above it commonly
// contains a space.
const WINDOWS_CLAUDE_BINARY = 'C:\\Users\\Ada Lovelace\\AppData\\Roaming\\npm\\claude.cmd';
const POSIX_CLAUDE_BINARY = '/Users/tester/.local/bin/claude';

test('the copyable Claude launch command is quoted for cmd.exe on Windows', () => {
  // The quote function is injected, so this pins the exact string the win32 branch emits without
  // depending on the platform the suite runs on.
  assert.equal(
    claudeRelayCommand(null, cmdQuote, WINDOWS_CLAUDE_BINARY),
    '"C:\\Users\\Ada Lovelace\\AppData\\Roaming\\npm\\claude.cmd" --dangerously-skip-permissions',
  );

  // The shape this replaces. Single quotes carry no meaning in cmd.exe, so they stay literal and
  // the path still splits at its spaces: the shell looks for a program named 'C:\Users\Ada and
  // hands Lovelace\AppData\Roaming\npm\claude.cmd' to it as an argument.
  assert.equal(
    claudeRelayCommand(null, shellQuote, WINDOWS_CLAUDE_BINARY),
    "'C:\\Users\\Ada Lovelace\\AppData\\Roaming\\npm\\claude.cmd' --dangerously-skip-permissions",
  );
});

test('a Windows binary path ending in a backslash keeps its closing quote', () => {
  // A trailing backslash run would otherwise escape the closing quote under C runtime argument
  // splitting, which is why cmdQuote doubles it.
  assert.equal(
    claudeRelayCommand(null, cmdQuote, 'D:\\claude\\'),
    '"D:\\claude\\\\" --dangerously-skip-permissions',
  );
});

test('the launch command emitted off Windows is unchanged', () => {
  assert.equal(
    claudeRelayCommand(null, shellQuote, POSIX_CLAUDE_BINARY),
    "'/Users/tester/.local/bin/claude' --dangerously-skip-permissions",
  );
  // The bare default stays unquoted under either quoting rule, so a backend that never resolved
  // an absolute path emits the same command it always did.
  assert.equal(claudeRelayCommand(null, shellQuote), 'claude --dangerously-skip-permissions');
  assert.equal(claudeRelayCommand(null, cmdQuote), 'claude --dangerously-skip-permissions');
});

test('the server selects the launch command quoting by platform', async () => {
  const server = await readFile(new URL('src/server.mjs', root), 'utf8');

  assert.match(server, /import \{[^}]*\n\s+cmdQuote,\n[^}]*\} from '\.\/project-launcher\.mjs';/);
  assert.match(
    server,
    /const LAUNCH_COMMAND_QUOTE = process\.platform === 'win32' \? cmdQuote : shellQuote;/,
  );
  // The call site is the part that regresses if someone reinstates the POSIX-only quoting.
  assert.match(
    server,
    /claudeLaunchCommand: claudeRelayCommand\(null, LAUNCH_COMMAND_QUOTE, claudeBinaryPath\),/,
  );
  assert.equal(server.includes('claudeRelayCommand(null, shellQuote'), false);
});
