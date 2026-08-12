import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dateFromLocalInput,
  localDateInputValue,
  standupBullets,
  standupCopyText,
  standupSections,
  tasksForStandupDay,
} from '../public/standup-summary.js';

function localIso(year, month, day, hour = 12) {
  return new Date(year, month, day, hour).toISOString();
}

test('standup date values round trip through the local calendar', () => {
  const date = new Date(2026, 6, 29, 18, 45);
  assert.equal(localDateInputValue(date), '2026-07-29');
  const parsed = dateFromLocalInput('2026-07-29');
  assert.equal(parsed.getFullYear(), 2026);
  assert.equal(parsed.getMonth(), 6);
  assert.equal(parsed.getDate(), 29);
  assert.equal(parsed.getHours(), 0);
  assert.equal(dateFromLocalInput('2026-02-30'), null);
  assert.equal(dateFromLocalInput('not-a-date'), null);
});

test('standup source selection uses terminal outcome time and exclusive local day boundaries', () => {
  const selectedDay = new Date(2026, 6, 29, 12);
  const tasks = [
    {
      id: 1,
      status: 'complete',
      created_at: localIso(2026, 6, 28, 22),
      finished_at: localIso(2026, 6, 29, 1),
    },
    {
      id: 2,
      status: 'complete',
      created_at: localIso(2026, 6, 29, 8),
      finished_at: localIso(2026, 6, 29, 9),
    },
    {
      id: 3,
      status: 'complete',
      created_at: localIso(2026, 6, 29, 23),
      finished_at: localIso(2026, 6, 30, 1),
    },
    {
      id: 4,
      status: 'running',
      created_at: localIso(2026, 6, 29, 10),
      finished_at: null,
    },
    {
      id: 5,
      status: 'cancelled',
      created_at: localIso(2026, 6, 29, 11),
      finished_at: null,
    },
  ];

  assert.deepEqual(tasksForStandupDay(tasks, selectedDay).map((task) => task.id), [1, 2]);
});

test('AI standup output is split into changelog categories', () => {
  const output = `
### Added

- Added AI standup generation.

### Changed

- Grounded standups in saved responses.

### Fixed

- Fixed date boundary handling.
`;
  assert.deepEqual(standupSections(output), {
    added: ['Added AI standup generation.'],
    changed: ['Grounded standups in saved responses.'],
    fixed: ['Fixed date boundary handling.'],
    security: [],
  });
  assert.deepEqual(standupBullets(output), [
    'Added AI standup generation.',
    'Grounded standups in saved responses.',
    'Fixed date boundary handling.',
  ]);
});

test('standup clipboard text is categorized CHANGELOG Markdown', () => {
  const text = standupCopyText({
    added: ['Added date-gated generation.'],
    changed: [],
    fixed: ['Fixed local-day boundaries.'],
    security: [],
  });
  assert.equal(text, '### Added\n\n- Added date-gated generation.\n\n### Fixed\n\n- Fixed local-day boundaries.');
  assert.match(text, /^-\s/m);
  assert.doesNotMatch(text, /### Changed|### Security/);
});
