import assert from 'node:assert/strict';
import test from 'node:test';
import { terminalClosePresentation } from '../public/terminal-close-state.js';

test('Close stays visible but explains when the running backend needs a restart', () => {
  const presentation = terminalClosePresentation({
    supported: false,
    threadLabel: 'CC Relay 3',
  });

  assert.equal(presentation.label, 'Close CC Relay 3');
  assert.equal(presentation.buttonLabel, 'Restart required');
  assert.equal(presentation.disabled, true);
  assert.match(presentation.reason, /Restart CC Relay/);
  assert.match(presentation.reason, /detected automatically/);
});

test('an owned idle terminal exposes the enabled close action', () => {
  const presentation = terminalClosePresentation({
    supported: true,
    threadLabel: 'CC Relay 3',
    control: { owned: true, canClose: true, reason: null },
  });

  assert.equal(presentation.state, 'ready');
  assert.equal(presentation.disabled, false);
  assert.equal(presentation.reason, 'CC Relay owns the exact native window for CC Relay 3.');
});

test('selection and missing ownership state remain explicit', () => {
  const noSelection = terminalClosePresentation({ supported: true });
  const missingControl = terminalClosePresentation({
    supported: true,
    threadLabel: 'CC Relay 3',
  });

  assert.equal(noSelection.disabled, true);
  assert.match(noSelection.reason, /Select a terminal/);
  assert.equal(missingControl.disabled, true);
  assert.match(missingControl.reason, /has not reported ownership/);
});

test('busy and unowned terminals remain visible with actionable reasons', () => {
  const busy = terminalClosePresentation({
    supported: true,
    threadLabel: 'CC Relay 3',
    control: { owned: true, canClose: false, reason: 'Task #181 is running on this terminal.' },
  });
  const unowned = terminalClosePresentation({
    supported: true,
    threadLabel: 'relay-2e',
    control: { owned: false, canClose: false, reason: 'CC Relay could not map this session to one unambiguous native terminal window.' },
  });

  assert.deepEqual([busy.state, busy.disabled, busy.reason], [
    'blocked',
    true,
    'Task #181 is running on this terminal.',
  ]);
  assert.equal(unowned.state, 'unavailable');
  assert.equal(unowned.disabled, true);
  assert.match(unowned.reason, /own native terminal/);
});

test('closing state remains disabled and names the exact selected terminal', () => {
  const presentation = terminalClosePresentation({
    supported: true,
    threadLabel: 'CC Relay 3',
    control: { owned: true, canClose: true, reason: null },
    closing: true,
  });

  assert.equal(presentation.state, 'closing');
  assert.equal(presentation.label, 'Closing CC Relay 3');
  assert.equal(presentation.buttonLabel, 'Closing');
  assert.equal(presentation.disabled, true);
});
