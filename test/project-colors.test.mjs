import assert from 'node:assert/strict';
import test from 'node:test';
import { projectColorClass, projectColorClasses, projectColorIndex } from '../public/project-colors.js';

test('project colors are stable across path separator and case variations', () => {
  assert.equal(
    projectColorIndex('/Users/Dev/Relay/'),
    projectColorIndex('\\users\\dev\\relay'),
  );
});

test('project colors always map to the six-color interface palette', () => {
  for (const path of ['/repo/relay', '/repo/documi', '/repo/agreau', '/repo/vector-algo']) {
    assert.match(projectColorClass(path), /^project-color-[1-6]$/);
  }
});

test('visible projects receive distinct colors while palette capacity remains', () => {
  const paths = [
    '/Users/dev/WebstormProjects/relay',
    '/Users/dev/WebstormProjects/documi-ai',
    '/Users/dev/src/Agreau',
    '/Users/dev/WebstormProjects/vector-algo',
    '/Users/dev/WebstormProjects/talent-finder',
    '/Users/dev/WebstormProjects/sixth-project',
  ];
  const classes = projectColorClasses(paths);
  assert.equal(new Set(classes).size, paths.length);
});
