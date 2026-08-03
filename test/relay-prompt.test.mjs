import assert from 'node:assert/strict';
import test from 'node:test';
import {
  RELAY_NON_INTERACTIVE_INSTRUCTION,
  withRelayNonInteractiveInstruction,
} from '../src/relay-prompt.mjs';

test('CC Relay delivery appends the non-interactive instruction without changing the original text', () => {
  const delivered = withRelayNonInteractiveInstruction('Implement the requested change.');

  assert.equal(
    delivered,
    `Implement the requested change.\n\n${RELAY_NON_INTERACTIVE_INSTRUCTION}`,
  );
  assert.match(delivered, /Do not ask questions, request approval, or wait for user input/);
});

test('CC Relay delivery does not duplicate an existing non-interactive instruction', () => {
  const delivered = withRelayNonInteractiveInstruction('Implement the requested change.');

  assert.equal(withRelayNonInteractiveInstruction(delivered), delivered);
});
