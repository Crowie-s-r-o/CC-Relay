import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { isPathInside } from '../src/artifacts.mjs';
import { sameWorkspacePath } from '../src/claude-execution-runner.mjs';

const root = new URL('../', import.meta.url);

test('isPathInside accepts a real descendant on Windows, where a separator prefix test cannot', () => {
  const publicRoot = 'C:\\Program Files\\CC Relay\\resources\\app.asar\\public';
  const asset = path.win32.resolve(publicRoot, './index.html');

  // The exact shape of the guard this replaces. It rejects every asset on Windows, which
  // served a 404 for index.html, app.js, and style.css and left the desktop window blank.
  assert.equal(asset.startsWith(`${publicRoot}/`), false);
  assert.equal(isPathInside(publicRoot, asset, path.win32), true);
  assert.equal(
    isPathInside(publicRoot, path.win32.resolve(publicRoot, './event-stream.js'), path.win32),
    true,
  );
});

test('isPathInside rejects Windows traversal through both separator forms', () => {
  const publicRoot = 'C:\\app\\public';

  for (const attack of ['./../../secret.txt', './..\\..\\secret.txt', './..\\windows\\win.ini']) {
    const escaped = path.win32.resolve(publicRoot, attack);
    assert.equal(isPathInside(publicRoot, escaped, path.win32), false, attack);
  }
  // A backslash traversal is not a special case that needs its own string filter: resolve
  // folds it before the guard runs, which is why the guard only has to be separator-correct.
  assert.equal(path.win32.resolve(publicRoot, './..\\..\\secret.txt'), 'C:\\secret.txt');
});

test('isPathInside rejects the root itself, a name-prefixed sibling, and another drive', () => {
  const attachmentRoot = 'C:\\data\\tasks\\7\\attachments';

  assert.equal(isPathInside(attachmentRoot, attachmentRoot, path.win32), false);
  assert.equal(isPathInside(attachmentRoot, 'C:\\data\\tasks\\7\\attachments-old\\1.png', path.win32), false);
  assert.equal(isPathInside(attachmentRoot, 'D:\\data\\tasks\\7\\attachments\\1.png', path.win32), false);
  assert.equal(isPathInside(attachmentRoot, 'C:\\data\\tasks\\77\\attachments\\1.png', path.win32), false);
  assert.equal(isPathInside(attachmentRoot, 'C:\\data\\tasks\\7\\attachments\\01.png', path.win32), true);
});

test('isPathInside preserves the posix decisions the previous guard made', () => {
  const publicRoot = '/opt/relay/public';

  assert.equal(isPathInside(publicRoot, '/opt/relay/public/index.html', path.posix), true);
  assert.equal(isPathInside(publicRoot, publicRoot, path.posix), false);
  assert.equal(isPathInside(publicRoot, '/opt/relay/publicfoo/x.js', path.posix), false);
  assert.equal(isPathInside(publicRoot, '/etc/passwd', path.posix), false);
  // A child whose own name starts with dots stays reachable. A naive relative.startsWith('..')
  // test would drop it, and the guard this replaces accepted it.
  assert.equal(isPathInside(publicRoot, '/opt/relay/public/..foo.css', path.posix), true);
});

test('the server routes every containment check through the shared helper', async () => {
  const server = await readFile(new URL('src/server.mjs', root), 'utf8');

  assert.match(server, /import \{ ArtifactStore, isPathInside \} from '\.\/artifacts\.mjs';/);
  // A `/`-suffixed prefix test is the Windows defect itself. It must not come back, for the
  // static root, for a task attachment root, or for any root a later guard introduces.
  assert.doesNotMatch(server, /startsWith\(`\$\{\w+\}\/`\)/);
  assert.ok(server.match(/isPathInside\(/g).length >= 3);
});

test('sameWorkspacePath decides the retained-terminal retry the way each platform stores paths', () => {
  const repoPath = 'C:\\Repo\\Project';

  // The exact shape of the guard the retained-terminal retry replaces. `readConnectedThread` and
  // `readConnectedSession` report whatever drive-letter and path case the shell recorded, so the
  // verbatim resolved comparison rejects the terminal the task is still bound to.
  assert.notEqual(path.win32.resolve('c:\\repo\\project'), path.win32.resolve(repoPath));
  assert.equal(sameWorkspacePath('c:\\repo\\project', repoPath, 'win32'), true);
  // Case folding must not turn a genuinely different project into a match.
  assert.equal(sameWorkspacePath('c:\\repo\\other', repoPath, 'win32'), false);
  assert.equal(sameWorkspacePath('d:\\repo\\project', repoPath, 'win32'), false);

  // POSIX keeps the exact byte comparison: the same case variance stays a mismatch.
  assert.equal(sameWorkspacePath('/repo/project', '/repo/Project', 'darwin'), false);
  assert.equal(sameWorkspacePath('/repo/project', '/repo/PROJECT', 'linux'), false);
  assert.equal(sameWorkspacePath('/repo/project', '/repo/project', 'darwin'), true);
  assert.equal(sameWorkspacePath('/repo/project', '/repo/other', 'darwin'), false);
});

test('the retained-terminal retry and the session continuation fold path case through the helper', async () => {
  const [server, continuation] = await Promise.all([
    readFile(new URL('src/server.mjs', root), 'utf8'),
    readFile(new URL('src/task-continuation.mjs', root), 'utf8'),
  ]);

  // server.mjs cannot be imported here (it self-starts and binds a port), so the import
  // assertion is what proves the identifier at the call site actually resolves.
  assert.match(
    server,
    /import \{ ClaudeExecutionRunner, sameWorkspacePath \} from '\.\/claude-execution-runner\.mjs';/,
  );
  // Anchored on the full call: server.mjs also has a local strict `sameWorkspace` helper, and
  // landing this fold on that one instead would leave the Windows defect in place.
  assert.match(server, /!sameWorkspacePath\(retainedThread\.cwd, task\.repo_path\)/);
  assert.doesNotMatch(server, /resolve\(retainedThread\.cwd\)/);

  assert.match(continuation, /import \{ sameWorkspacePath \} from '\.\/claude-execution-runner\.mjs';/);
  assert.match(continuation, /!sameWorkspacePath\(thread\.cwd, sourceTask\.repo_path, platform\)/);
  assert.doesNotMatch(continuation, /resolve\(thread\.cwd\)/);
});

test('the startup test launches the server by filesystem path, not by URL pathname', async () => {
  const startup = await readFile(new URL('test/server-startup.test.mjs', root), 'utf8');

  assert.match(startup, /fileURLToPath\(new URL\('\.\.\/src\/server\.mjs', import\.meta\.url\)\)/);
  assert.doesNotMatch(startup, /new URL\('\.\.\/src\/server\.mjs', import\.meta\.url\)\.pathname/);
});
