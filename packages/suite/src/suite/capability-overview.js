/**
 * Pure read-only capability overview model for the Suite page (ADR-117 D5).
 *
 * Strictly derives each declared component's badge from the Host's live componentsStatus state
 * (and live OCR / document-parse capabilities for the bundled multimodal row) without inventing
 * "ready" for disabled, unconfigured, or unread capabilities. No switches or configuration inputs
 * live here; official plugin rows and per-capability settings cards remain the single write owners.
 */

const CAPABILITY_META = new Map([
  ['web-search-searxng', {titleKey: 'capSearchTitle', entryKey: 'capSearchEntry'}],
  ['agent-teams', {titleKey: 'capTeamsTitle', entryKey: 'capTeamsEntry'}],
  ['compaction-budget', {titleKey: 'capBudgetTitle', entryKey: 'capBudgetEntry'}],
]);

/** Components that exist for Host plumbing, not as a separately user-facing capability row. */
const INTERNAL_COMPONENTS = new Set(['login-gateway']);

/** Bundled Client-only surfaces delivered with the Suite itself (no separate Host toggle row). */
const BUNDLED_SURFACES = [
  {id: 'skills-mcp', titleKey: 'capToolsTitle', entryKey: 'capToolsEntry', badgeKey: 'capBadgeReady', tone: 'ok'},
  {id: 'multimodal', titleKey: 'capMultimodalTitle', entryKey: 'capMultimodalEntry'},
  {id: 'effort-slider', titleKey: 'capEffortTitle', entryKey: 'capEffortEntry', badgeKey: 'capBadgeReady', tone: 'ok'},
];

/** The Phase 4 display order. Unknown future components append after these rows. */
const CAPABILITY_ORDER = [
  'web-search-searxng',
  'skills-mcp',
  'multimodal',
  'agent-teams',
  'effort-slider',
  'compaction-budget',
];
export const CAPABILITY_COUNT = CAPABILITY_ORDER.length;

export function capabilityBadgeForState(state) {
  if (state === 'ready' || state === 'covered') return {badgeKey: 'capBadgeReady', tone: 'ok'};
  // `config-only` means the official row is enabled and active (fiberPhase === 'active') for a
  // declarative settings module that has no separate Host version probe (`nextAction: 'none'`).
  // Reporting it as "Needs setup" misled users who had already enabled and configured it.
  if (state === 'config-only') return {badgeKey: 'capBadgeEnabled', tone: 'muted'};
  if (state === 'disabled' || state === 'policy-disabled' || state === 'retired') return {badgeKey: 'capBadgeDisabled', tone: 'muted'};
  if (state === 'restart-required') return {badgeKey: 'capBadgeRestart', tone: 'warn'};
  if (state === 'waiting' || state === 'partial') return {badgeKey: 'capBadgeSetup', tone: 'warn'};
  return {badgeKey: 'capBadgeAttention', tone: 'warn'};
}

/**
 * Derive the multimodal capability badge from live `ocrCapabilities()` and
 * `documentParseCapabilities()` snapshots. Never hardcodes "Needs setup" when unread or ready.
 */
export function multimodalBadgeForCapabilities(multimodal) {
  const ocr = multimodal?.ocr ?? null;
  const docParse = multimodal?.docParse ?? null;
  // OCR runs the selected provider by default; its legacy configured flag describes that same
  // provider. Document parsing has no selected provider and can use any configured one.
  const ocrConfigured = ocr?.providerStates?.[ocr.selectedProvider]?.configured ?? ocr?.configured;
  const ocrReady = ocr?.enabled === true && ocrConfigured === true;
  const docReady = docParse?.enabled === true && Object.values(docParse.providerStates ?? {}).some(item => item?.configured === true);
  if (ocrReady || docReady) return {badgeKey: 'capBadgeReady', tone: 'ok'};
  if (ocr?.enabled === true || docParse?.enabled === true) return {badgeKey: 'capBadgeSetup', tone: 'warn'};
  if (ocr?.enabled === false && docParse?.enabled === false) return {badgeKey: 'capBadgeDisabled', tone: 'muted'};
  return {badgeKey: 'capBadgeUnknown', tone: 'muted'};
}

/** Components that belong on the user-facing capability surface (internal plumbing removed). */
export function visibleCapabilityComponents(componentsList) {
  if (!Array.isArray(componentsList)) return [];
  return componentsList.filter(component => component && typeof component.id === 'string' && !INTERNAL_COMPONENTS.has(component.id));
}

/**
 * Build the read-only capability overview rows from live componentsStatus.components.
 * Returns an empty array when the Host has not reported components yet. The internal
 * login-gateway row is hidden because it is plumbing, not a user-facing capability.
 */
export function buildCapabilityOverview(componentsList, translate, multimodal = null) {
  if (!Array.isArray(componentsList) || componentsList.length === 0) return [];
  const rowsById = new Map();
  for (const component of visibleCapabilityComponents(componentsList)) {
    const meta = CAPABILITY_META.get(component.id);
    const {badgeKey, tone} = capabilityBadgeForState(component.state);
    rowsById.set(component.id, {
      id: component.id,
      title: meta ? translate(meta.titleKey) : String(component.display?.en ?? component.display?.zh ?? component.id),
      entry: meta ? translate(meta.entryKey) : translate('componentsWhere'),
      badge: translate(badgeKey),
      tone,
      description: component.state === 'config-only' ? translate('capConfigOnlyNote') : undefined,
      // ADR-102: policy-disabled is actionable even with nextAction: 'none' and a muted badge.
      needsAction: component.state === 'policy-disabled' || ['capBadgeSetup', 'capBadgeRestart', 'capBadgeAttention'].includes(badgeKey),
      component,
    });
  }
  for (const surface of BUNDLED_SURFACES) {
    const resolved = surface.id === 'multimodal'
      ? multimodalBadgeForCapabilities(multimodal)
      : {badgeKey: surface.badgeKey, tone: surface.tone};
    rowsById.set(surface.id, {
      id: surface.id,
      title: translate(surface.titleKey),
      entry: translate(surface.entryKey),
      badge: translate(resolved.badgeKey),
      tone: resolved.tone,
      needsAction: resolved.badgeKey === 'capBadgeSetup',
    });
  }
  const ordered = CAPABILITY_ORDER.map(id => rowsById.get(id)).filter(Boolean);
  const extras = [...rowsById.values()].filter(row => !CAPABILITY_ORDER.includes(row.id));
  return [...ordered, ...extras];
}
