/*
 * Saved quick-skill catalog and normalizer for the renderer.
 *
 * This module is deliberately DOM-free so `test/quick-skills.test.mjs` can import it under Node.
 * `src/ui-preferences.mjs` carries a byte-equivalent copy of the same rules because nothing in
 * `src/` imports from `public/`; `test/quick-skills.test.mjs` holds the parity table that keeps
 * the two copies honest. This mirrors the existing `public/voice-input.js` arrangement.
 */

export const QUICK_SKILL_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const MAX_QUICK_SKILLS = 12;
export const MAX_QUICK_SKILL_LABEL_LENGTH = 80;
export const MAX_QUICK_SKILL_PROMPT_LENGTH = 20000;

export const DEFAULT_QUICK_SKILLS = Object.freeze([
  Object.freeze({
    id: 'deploy-check',
    label: 'Deploy check',
    prompt: `I want you to create me a full list of things we changed, it needs to be detailed so no change escapes it, it should basically compare with production and it should be a release-pdf with versions compared .. it's very important to have the sentences short (in bullet list) and the changes grouped by categories

it is for me to verify we did only changes which we wanted to, be sure to go through every changed line of code`,
  }),
]);

// Retained so the pre-configurable import surface keeps working while the editor lands.
export const QUICK_SKILLS = DEFAULT_QUICK_SKILLS;

function normalizeQuickSkill(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
  const { id, label, prompt } = entry;
  if (typeof id !== 'string' || !QUICK_SKILL_ID_PATTERN.test(id)) return null;
  if (typeof label !== 'string' || typeof prompt !== 'string') return null;
  const cleanLabel = label.trim().replace(/\s+/gu, ' ');
  if (!cleanLabel || cleanLabel.length > MAX_QUICK_SKILL_LABEL_LENGTH) return null;
  // Newlines inside a prompt are meaningful, so only trailing whitespace is removed. `trimEnd`
  // rather than a `/\s+$/` replace: the regex backtracks quadratically on a long interior
  // whitespace run, and a twenty thousand character prompt is exactly that input.
  const cleanPrompt = prompt.trimEnd();
  if (!cleanPrompt || cleanPrompt.length > MAX_QUICK_SKILL_PROMPT_LENGTH) return null;
  // Unknown keys are stripped: the persisted record stays exactly the three-member shape.
  return { id, label: cleanLabel, prompt: cleanPrompt };
}

/*
 * A missing or non-array value means the operator never configured the strip, so the built-in
 * catalog answers. An array is authoritative even when empty, which is how an operator deletes
 * every saved skill permanently. Invalid entries are dropped, never fatal.
 *
 * The cap applies to survivors, not to input slots, so an invalid entry early in the list cannot
 * push a valid later entry out of the strip. The returned array and its entries are always fresh
 * and mutable so the renderer can edit and reorder them in place.
 */
export function normalizeQuickSkills(value) {
  if (!Array.isArray(value)) return DEFAULT_QUICK_SKILLS.map((skill) => ({ ...skill }));
  const seen = new Set();
  const skills = [];
  for (const entry of value) {
    if (skills.length >= MAX_QUICK_SKILLS) break;
    const skill = normalizeQuickSkill(entry);
    // Duplicate ids keep the first occurrence so display order stays the operator's order.
    if (!skill || seen.has(skill.id)) continue;
    seen.add(skill.id);
    skills.push(skill);
  }
  return skills;
}

/*
 * `skills` is the live configured list. Callers that omit it fail closed against the built-in
 * catalog rather than against whatever the operator happens to have saved.
 */
export function quickSkillById(id, skills) {
  const catalog = Array.isArray(skills) ? skills : DEFAULT_QUICK_SKILLS;
  return catalog.find((skill) => skill && skill.id === id) || null;
}
