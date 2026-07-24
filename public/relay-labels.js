/**
 * Stable, DOM-free Relay identity helpers.
 *
 * Relay identity is assigned and persisted by the server.  The browser must
 * therefore read the identity fields from a thread directly instead of
 * deriving a number from the order in which threads happen to be returned.
 */

export const UNKNOWN_RELAY = 'Unknown Relay';

/** Return a Relay number only when the value is a positive integer number. */
export function validRelayNumber(value) {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : null;
}

/** Read the persisted Relay number without consulting any collection. */
export function relayNumber(thread) {
  return validRelayNumber(thread?.relayNumber);
}

/** Read a persisted Relay name, returning null for missing or blank values. */
function storedRelayName(thread) {
  const value = thread?.relayName;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Return the stable display label for one thread.
 *
 * A persisted name wins.  Older thread records can still display a useful
 * `Relay n` label when only their valid persisted number is available.  No
 * number is fabricated for malformed or missing identity data.
 */
export function relayDisplayName(thread) {
  const name = storedRelayName(thread);
  if (name) return name;
  const number = relayNumber(thread);
  return number === null ? UNKNOWN_RELAY : `Relay ${number}`;
}

/** Return the display name for one Relay, including its safe fallback. */
export const relayName = relayDisplayName;

/** Select one of the six stable Relay identity classes. */
export function relayColorClass(thread) {
  const number = relayNumber(thread);
  return number === null ? '' : `relay-color-${((number - 1) % 6) + 1}`;
}

/** Return all presentation fields without exposing collection-dependent state. */
export function relayIdentity(thread) {
  const number = relayNumber(thread);
  const name = relayDisplayName(thread);
  return {
    number,
    name,
    label: name,
    colorClass: relayColorClass(thread),
    known: number !== null,
  };
}

// Explicit aliases keep the helpers discoverable to callers that prefer a
// verb-style name while preserving one implementation of the contract.
export const stableRelayNumber = relayNumber;
export const stableRelayName = relayDisplayName;
export const stableRelayColorClass = relayColorClass;
export const getRelayNumber = relayNumber;
export const getRelayName = relayDisplayName;
export const getRelayDisplayName = relayDisplayName;
export const displayRelayName = relayDisplayName;
export const relayLabel = relayDisplayName;
export const getRelayColorClass = relayColorClass;
export const getRelayLabel = relayDisplayName;
