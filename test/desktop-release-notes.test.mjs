import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_DESKTOP_RELEASE_NOTES,
  normalizeDesktopReleaseNotes,
} from '../src/desktop-release-notes.mjs';

test('turns changelog Markdown into a categorized release brief', () => {
  assert.deepEqual(normalizeDesktopReleaseNotes(`
## [1.2.0] - 2026-08-21

### Added

- Standups now cover two days.
- Provider usage now shows [remaining runway](https://example.com/details).

### Fixed

- Update prompts no longer repeat.
`), [
    { section: 'Added', text: 'Standups now cover two days.' },
    { section: 'Added', text: 'Provider usage now shows remaining runway.' },
    { section: 'Fixed', text: 'Update prompts no longer repeat.' },
  ]);
});

test('reduces GitHub Atom HTML to safe plain text', () => {
  const notes = normalizeDesktopReleaseNotes(`
    <h3>Changed</h3>
    <ul>
      <li>Task activity separates <strong>user</strong> and AI messages.</li>
      <li>Task activity separates <strong>user</strong> and AI messages.</li>
    </ul>
    <h3>Security</h3>
    <ul><li>Folder trust is handled safely &amp; predictably.<script>bad()</script></li></ul>
    <p><strong>Full Changelog</strong>: https://example.com/compare</p>
  `);
  assert.deepEqual(notes, [
    { section: 'Changed', text: 'Task activity separates user and AI messages.' },
    { section: 'Security', text: 'Folder trust is handled safely & predictably.' },
  ]);
});

test('selects the matching electron-updater note and bounds renderer payloads', () => {
  const selected = normalizeDesktopReleaseNotes([
    { version: '1.1.0', note: '### Fixed\n- Old fix.' },
    { version: '1.2.0', note: '### Added\n- New feature.' },
  ], { version: 'v1.2.0' });
  assert.deepEqual(selected, [{ section: 'Added', text: 'New feature.' }]);

  const oversized = Array.from(
    { length: MAX_DESKTOP_RELEASE_NOTES + 5 },
    (_, index) => ({ section: 'Unexpected', text: `${index} ${'x'.repeat(400)}` }),
  );
  const bounded = normalizeDesktopReleaseNotes(oversized);
  assert.equal(bounded.length, MAX_DESKTOP_RELEASE_NOTES);
  assert.equal(bounded[0].section, 'Highlights');
  assert.match(bounded[0].text, /\.\.\.$/);
});
