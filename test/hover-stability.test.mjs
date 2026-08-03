import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const style = await readFile(new URL('../public/style.css', import.meta.url), 'utf8');

function ruleBodies(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...style.matchAll(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'g'))]
    .map((match) => match[1]);
}

test('selectable task surfaces do not move on hover', () => {
  const hoverBodies = [
    ...ruleBodies('.task-card:hover'),
    ...ruleBodies('.header-running-task:hover'),
  ];

  assert.ok(hoverBodies.length >= 2);
  for (const body of hoverBodies) {
    assert.doesNotMatch(body, /\btransform\s*:/);
    assert.doesNotMatch(body, /\bbox-shadow\s*:/);
  }
});

test('project cards do not gain hover-only elevation', () => {
  const hoverBodies = ruleBodies('.project-chip:hover');

  assert.ok(hoverBodies.length >= 1);
  for (const body of hoverBodies) {
    assert.doesNotMatch(body, /\btransform\s*:/);
    assert.doesNotMatch(body, /\bbox-shadow\s*:/);
  }
});
