// Escape text for safe interpolation into HTML, including inside quoted
// attributes. The previous DOM-based helper (textContent -> innerHTML) escaped
// &, <, and > but left " and ' intact, so agent-controlled text interpolated
// into title="..." / aria-label="..." attributes could break out of the
// attribute and inject inline event handlers. This pure helper escapes quotes
// as well and is unit-testable without a DOM (Finding 19).
export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
