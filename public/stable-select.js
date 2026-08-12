/*
 * Composer selects are rebuilt by renderers that the two-second snapshot refresh and the
 * four-second thread poll re-run unconditionally. Replacing the options of a select whose
 * native popup is open makes the popup snap shut or lose the highlighted row, so choosing
 * a Claude model took several attempts: the tick landed between the press and the release.
 *
 * These helpers write only when the control would actually change. The comparison reads
 * the live DOM instead of a cached copy of the last markup, so a writer that bypasses
 * these helpers cannot leave the cache lying about what is on screen, and an option label
 * carrying a quote or an ampersand still compares equal after the browser has parsed it.
 *
 * Forward-planning Turbo solves the same problem one level up with a render-skip token in
 * turbo-controls-signature.js. That fold has to name every datum its panel draws from; a
 * forgotten one leaves a stale panel with no event able to repair it. These helpers carry
 * no such risk because they always recompute the intended options and diff them.
 */
import { escapeHtml } from './escape-html.js';

/**
 * @typedef {object} SelectOption
 * @property {string} value Submitted value.
 * @property {string} label Visible text.
 * @property {boolean} [disabled] Present but unselectable.
 */

function matchesRenderedOptions(select, options) {
  if (select.options.length !== options.length) return false;
  return options.every((option, index) => {
    const rendered = select.options[index];
    return rendered.value === String(option.value ?? '')
      && rendered.textContent === String(option.label ?? '')
      && rendered.disabled === (option.disabled === true);
  });
}

/**
 * Replace the options of a select only when the rendered list differs.
 *
 * @param {HTMLSelectElement} select
 * @param {SelectOption[]} options
 * @returns {boolean} Whether the DOM was written.
 */
export function setSelectOptions(select, options) {
  if (!select) return false;
  if (matchesRenderedOptions(select, options)) return false;
  select.innerHTML = options.map((option) => (
    `<option value="${escapeHtml(option.value ?? '')}"${option.disabled === true ? ' disabled' : ''}>${escapeHtml(option.label ?? '')}</option>`
  )).join('');
  return true;
}

/**
 * Assign a control value only when it differs. Rewriting the current value of an open
 * select or a slider under the pointer restarts the interaction the user is in.
 *
 * @param {HTMLSelectElement|HTMLInputElement} control
 * @param {string|number|null|undefined} value
 * @returns {boolean} Whether the DOM was written.
 */
export function setControlValue(control, value) {
  if (!control) return false;
  const next = value === null || value === undefined ? '' : String(value);
  if (control.value === next) return false;
  control.value = next;
  return true;
}

/**
 * Toggle the disabled state only when it differs.
 *
 * @param {HTMLSelectElement|HTMLInputElement} control
 * @param {boolean} disabled
 * @returns {boolean} Whether the DOM was written.
 */
export function setControlDisabled(control, disabled) {
  if (!control) return false;
  const next = disabled === true;
  if (control.disabled === next) return false;
  control.disabled = next;
  return true;
}
