import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

function functionBody(source, signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `${signature} should exist`);
  const end = source.indexOf('\n}', start);
  assert.notEqual(end, -1, `${signature} should close`);
  return source.slice(start, end);
}

/*
 * workspaceName labels task cards, project chips, and the terminal prompt inside a
 * DOM-coupled file the repo has no harness to import. Lifting the shipped source, along
 * with the normalizedPath helper it now composes with, is the only way to run the real
 * separator handling: asserting that the identifier appears would pass just as happily
 * against a split that still only knows about forward slashes.
 */
function liftWorkspaceName() {
  const normalize = functionBody(app, 'function normalizedPath(path) {');
  const name = functionBody(app, 'function workspaceName(path) {');
  return new Function(`${normalize}\n}\n${name}\n}\nreturn workspaceName;`)();
}

test('workspaceName shows the folder name for a Windows workspace path', () => {
  const workspaceName = liftWorkspaceName();

  assert.equal(workspaceName('C:\\Users\\Pat\\my-project'), 'my-project');
  assert.equal(workspaceName('C:\\Users\\Pat\\my-project\\'), 'my-project');
  assert.equal(workspaceName('\\\\build-01\\share\\relay'), 'relay');
  // A drive root has no folder segment. It degrades to the drive rather than to nothing.
  assert.equal(workspaceName('C:\\'), 'C:');
});

test('workspaceName keeps every posix result it already produced', () => {
  const workspaceName = liftWorkspaceName();

  assert.equal(workspaceName('/Users/pat/relay'), 'relay');
  assert.equal(workspaceName('/Users/pat/relay/'), 'relay');
  assert.equal(workspaceName('relay'), 'relay');
  assert.equal(workspaceName(''), 'Unknown workspace');
  assert.equal(workspaceName(null), 'Unknown workspace');
  assert.equal(workspaceName('/'), 'Unknown workspace');
});

test('workspaceName reuses the shared path normalizer instead of its own separator rule', () => {
  const source = functionBody(app, 'function workspaceName(path) {');

  assert.match(source, /normalizedPath\(path\)/);
  // The single-forward-slash trim is the defect itself: it renders a whole Windows path.
  assert.doesNotMatch(source, /String\(path \|\| ''\)/);
});
