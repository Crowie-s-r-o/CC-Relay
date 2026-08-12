/*
 * The Forward-planning Turbo composer panel is rebuilt by renderTurboControls, which
 * rewrites all six of its selects through innerHTML. That render is re-run by the
 * two-second snapshot refresh and the four-second thread poll, so an open MODEL or EFFORT
 * dropdown used to snap shut on a tick and a half-typed worker count used to be replaced
 * under the cursor.
 *
 * This module folds every datum the panel markup is drawn from into one short token. When
 * the token is unchanged the DOM rewrite is skipped, so a refresh tick that changed
 * nothing about the panel leaves it exactly as the user left it.
 *
 * A missing input is worse than a redundant one: an omitted datum produces a stale panel
 * that never repairs itself, while an extra datum only costs one rebuild. Every field
 * below is read by renderTurboControls; see turboControlsSignatureInputs in app.js for
 * the call site that collects them.
 */

/** Reasoning efforts are plain strings in one catalog and objects in the other. */
function effortNames(model) {
  const efforts = Array.isArray(model?.supportedReasoningEfforts) ? model.supportedReasoningEfforts : [];
  return efforts
    .map((item) => typeof item === 'string' ? item : item?.reasoningEffort)
    .filter(Boolean);
}

/*
 * Model identity alone is not enough. The selects print displayName, mark the default
 * catalog entry, and build their effort options from the supported list plus the model
 * default, so a catalog reload that keeps the IDs and changes a label must still repaint.
 */
function catalogFields(models) {
  return (Array.isArray(models) ? models : []).map((model) => [
    model?.model || '',
    model?.displayName || '',
    model?.isDefault === true,
    model?.defaultReasoningEffort || '',
    effortNames(model),
  ]);
}

/*
 * djb2 folded to 32 bits, the same shape used for the session transcript signature. The
 * shift form is deliberate: hash * 33 loses precision past 2^53 before the xor coerces,
 * while << and ^ both keep the fold inside int32.
 */
function fold(text) {
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash) ^ text.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}

/**
 * Fold every input of the Turbo composer panel into a comparable token.
 *
 * @param {object} input
 * @param {boolean} input.automatic Backend advertises disposable terminal pools.
 * @param {string} input.projectPath Selected project identity, not only its limits.
 * @param {number} input.codexLimit Project maximum Codex instances.
 * @param {number} input.claudeLimit Project maximum Claude instances.
 * @param {boolean} input.codexMissing Codex CLI is confirmed absent.
 * @param {boolean} input.claudeReady Claude is installed and signed in.
 * @param {string} input.claudeIssue Readable Claude blocker, printed by the chip.
 * @param {boolean} input.keepTerminalOpen Keep workflow terminals open toggle.
 * @param {boolean} input.retainedTerminals Backend supports terminal retention.
 * @param {boolean} input.hasPlannerThread Legacy mode has a selected Codex planner.
 * @param {number} input.workerThreadCount Legacy worker terminals in the workspace.
 * @param {object} input.settings state.turboSettings, read before normalization.
 * @param {object} input.catalogs Model catalogs as { codex, claude }.
 * @returns {string} Short token that changes whenever any input changes.
 */
export function turboControlsSignature(input = {}) {
  const settings = input.settings || {};
  const catalogs = input.catalogs || {};
  /*
   * JSON is the field separator. Model labels and readiness sentences contain spaces and
   * punctuation, so a hand-picked delimiter could appear inside a field and let two
   * different panels fold to one token; JSON quoting keeps every boundary unambiguous.
   */
  return fold(JSON.stringify([
    // Capacity and readiness, which the chip and the fleet sentence both read.
    input.automatic === true,
    input.projectPath || '',
    Number(input.codexLimit) || 0,
    Number(input.claudeLimit) || 0,
    input.codexMissing === true,
    input.claudeReady === true,
    input.claudeIssue || '',
    input.keepTerminalOpen === true,
    input.retainedTerminals === true,
    input.hasPlannerThread === true,
    Number(input.workerThreadCount) || 0,
    // Planner, worker, and council settings. The council author and reviewer models are a
    // pure function of these plus the catalogs, so normalization needs no separate field.
    settings.plannerModel || '',
    settings.plannerEffort || '',
    settings.workerModel || '',
    settings.workerEffort || '',
    Number(settings.workerCount) || 0,
    settings.councilEnabled === true,
    Array.isArray(settings.councilOrder) ? settings.councilOrder : [],
    settings.councilCodexModel || '',
    settings.councilCodexEffort || '',
    settings.councilClaudeModel || '',
    settings.councilClaudeEffort || '',
    // Both catalogs: Codex fills the planner and worker selects, Claude the reviewer.
    catalogFields(catalogs.codex),
    catalogFields(catalogs.claude),
  ]));
}
