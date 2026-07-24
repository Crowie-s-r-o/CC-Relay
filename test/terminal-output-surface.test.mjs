import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const style = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');
const markup = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

test('expanded command output uses an opaque dark terminal surface', () => {
  assert.match(
    style,
    /pre\.event-output-content \{[^}]*background: #0c0e17;/s,
  );
  assert.match(
    style,
    /\.detail-panel \.events-section \.event-output > pre\.event-output-content \{[^}]*background-color: #0c0e17;[^}]*background-image: none;/s,
  );
  assert.doesNotMatch(
    style,
    /pre\.event-output-content \{[^}]*background: rgb\(0 0 0 \/ 22%\);/s,
  );
});

test('follow-up images remain a subtle action without shrinking the prompt', () => {
  assert.match(
    style,
    /\.task-continuation-entry \{[^}]*grid-template-columns: auto minmax\(0, 1fr\) auto auto;/s,
  );
  assert.match(
    style,
    /\.task-continuation-attach \{[^}]*width: 22px;[^}]*border: 0;[^}]*opacity: \.42;/s,
  );
  const textarea = markup.indexOf('id="task-continuation-input"');
  const attachment = markup.indexOf('id="task-continuation-attach"');
  const send = markup.indexOf('id="task-continuation-send"');
  assert.ok(textarea >= 0 && textarea < attachment && attachment < send);
  assert.doesNotMatch(markup, /task-continuation-attach[\s\S]{0,300}>Add images</);
});
