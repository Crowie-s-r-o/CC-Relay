export const RELAY_COMPLETION_DEPTH_INSTRUCTION = 'Before finishing, perform one extra verification pass and fix any issue you find.';

export const RELAY_NON_INTERACTIVE_INSTRUCTION = `CC Relay orchestrator notice: this is a non-interactive run and no answers can be provided. Do not ask questions, request approval, or wait for user input. Make reasonable assumptions and proceed autonomously. ${RELAY_COMPLETION_DEPTH_INSTRUCTION} If progress is impossible, report the blocker and end the run. When done, stop all processes you started.`;

export function withRelayNonInteractiveInstruction(prompt) {
  const value = typeof prompt === 'string' ? prompt : String(prompt ?? '');
  if (value.includes(RELAY_NON_INTERACTIVE_INSTRUCTION)) {
    return value;
  }
  return value
    ? `${value}\n\n${RELAY_NON_INTERACTIVE_INSTRUCTION}`
    : RELAY_NON_INTERACTIVE_INSTRUCTION;
}

export function withoutRelayNonInteractiveInstruction(prompt) {
  const value = typeof prompt === 'string' ? prompt.trim() : String(prompt ?? '').trim();
  if (value === RELAY_NON_INTERACTIVE_INSTRUCTION) return '';
  const suffix = `\n\n${RELAY_NON_INTERACTIVE_INSTRUCTION}`;
  return value.endsWith(suffix)
    ? value.slice(0, -suffix.length).trim()
    : value;
}
