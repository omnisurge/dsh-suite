/**
 * Canonical Client copy interpolation helper (ADR-117 D2).
 *
 * Replaces per-page hand-written `fill` copies across Suite Client modules so every placeholder
 * substitution shares one deterministic behavior.
 */
export function fillTemplate(template, values) {
  const text = String(template);
  if (values === undefined || values === null) return text;
  return text.replace(/\{(\w+)\}/gu, (match, key) => (Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match));
}
