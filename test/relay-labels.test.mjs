import test from 'node:test';
import assert from 'node:assert/strict';
import {
  UNKNOWN_RELAY,
  relayColorClass,
  relayDisplayName,
  relayIdentity,
  relayName,
  relayNumber,
} from '../public/relay-labels.js';

test('reads stable Relay number and name directly from a thread', () => {
  const thread = { id: 'thread-b', relayNumber: 2, relayName: 'Relay 2' };
  assert.equal(relayNumber(thread), 2);
  assert.equal(relayName(thread), 'Relay 2');
  assert.equal(relayDisplayName(thread), 'Relay 2');
  assert.equal(relayColorClass(thread), 'relay-color-2');
});

test('identity and color remain stable when threads are inserted or reordered', () => {
  const target = { id: 'target', relayNumber: 5, relayName: 'Relay 5' };
  const before = [target];
  const afterInsert = [{ id: 'new', relayNumber: 1, relayName: 'Relay 1' }, target];
  const reordered = [target, { id: 'new', relayNumber: 1, relayName: 'Relay 1' }];

  const labels = [before, afterInsert, reordered].map((threads) => {
    const thread = threads.find((item) => item.id === 'target');
    return [relayDisplayName(thread), relayColorClass(thread)];
  });

  assert.deepEqual(labels, [
    ['Relay 5', 'relay-color-5'],
    ['Relay 5', 'relay-color-5'],
    ['Relay 5', 'relay-color-5'],
  ]);
});

test('missing names fall back to a valid persisted number', () => {
  const thread = { relayNumber: 7, relayName: '' };
  assert.equal(relayDisplayName(thread), 'Relay 7');
  assert.equal(relayColorClass(thread), 'relay-color-1');
});

test('invalid identity data never fabricates a number or color', () => {
  const invalidThreads = [
    {},
    { relayNumber: 0, relayName: 'Relay 0' },
    { relayNumber: -1, relayName: 'Relay -1' },
    { relayNumber: 1.5, relayName: 'Relay 1.5' },
    { relayNumber: '3', relayName: 'Relay 3' },
    { relayNumber: Number.NaN, relayName: null },
  ];

  for (const thread of invalidThreads) {
    assert.equal(relayNumber(thread), null);
    assert.equal(relayDisplayName(thread), thread.relayName || UNKNOWN_RELAY);
    assert.equal(relayColorClass(thread), '');
  }
});

test('identity helper returns only stable fields', () => {
  assert.deepEqual(relayIdentity({ relayNumber: 12 }), {
    number: 12,
    name: 'Relay 12',
    label: 'Relay 12',
    colorClass: 'relay-color-6',
    known: true,
  });
  assert.deepEqual(relayIdentity({ id: 'unknown' }), {
    number: null,
    name: UNKNOWN_RELAY,
    label: UNKNOWN_RELAY,
    colorClass: '',
    known: false,
  });
});

