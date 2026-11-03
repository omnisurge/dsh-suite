/**
 * Visual values live here (ADR-028). Defaults map to host --dsw-alias-*.
 * OEM swap = edit this file; controls keep using --omni-*.
 *
 * Spacing ladder (project-wide — suite plugins must not invent ad-hoc px):
 *   --omni-gap-tight   8px  within a control cluster (KV row, actions, toolbar)
 *   --omni-gap        12px  default stack / field groups / card chrome
 *   --omni-gap-section 16px between cards and major blocks
 */
export const TOKEN_SHEET = `
.omni-ui,
.omni-ui-tokens,
.omni-ui-page,
.omni-ui-pageContent,
.omni-ui-pageHead,
.omni-ui-card,
  .omni-ui-configPage,
  .omni-ui-notesPad,
  .omni-ui-lightbox,
.omni-ui-itemCard,
.omni-ui-listRow,
.omni-ui-dial,
.omni-ui-select,
.omni-ui-toastHost,
.omni-ui-confirmScrim,
.omni-ui-busyScrim,
.omni-ui-iconBtn,
.omni-ui-railBtn,
.omni-ui-segments,
.omni-ui-chip,
.omni-ui-dock,
.omni-ui-attachRail,
.omni-ui-attachTile,
.omni-ui-gallery,
.omni-ui-galleryWrap,
.omni-ui-galleryThumb,
.omni-ui-galleryThumbSvg,
.omni-ui-statusLine,
.omni-ui-banner,
.omni-ui-heroChip{
  --omni-label-primary: var(--dsw-alias-label-primary);
  --omni-label-secondary: var(--dsw-alias-label-secondary);
  --omni-label-tertiary: var(--dsw-alias-label-tertiary);
  --omni-label-error: var(--dsw-alias-label-error);
  --omni-border: var(--dsw-alias-border-l2);
  --omni-border-strong: var(--dsw-alias-label-dimmed);
  --omni-bg: var(--dsw-alias-bg-layer-3);
  --omni-brand: var(--dsw-alias-brand-primary, var(--dsw-alias-label-primary));
  --omni-danger: var(--dsw-alias-state-error-primary, #d33);
  --omni-ok: var(--dsw-alias-state-success-primary, #2e7d32);
  --omni-warn: var(--dsw-alias-state-warn-primary, #d89a1a);
  --omni-shadow: var(--dsw-shadow-lv2, 0 8px 24px color-mix(in srgb, #000 16%, transparent));
  --omni-scrim: rgba(0, 0, 0, .35);
  --omni-radius: 12px;
  --omni-radius-control: 8px;
  --omni-control-height: 34px;
  --omni-gap-tight: 8px;
  /* Aligned technical text (revisions, ids, paths). No host token carries this, so it is fixed here. */
  /* Label column of a key/value row: narrow enough that the value sits beside its label. */
  --omni-kv-label: 9rem;
  --omni-font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  --omni-gap: 12px;
  --omni-gap-section: 16px;
  --omni-fill: var(--dsw-alias-fill-tertiary, var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, var(--omni-border) 55%, transparent)));
  --omni-fill-strong: var(--dsw-alias-fill-quaternary, color-mix(in srgb, var(--omni-label-tertiary) 40%, transparent));
  --omni-bg-muted: var(--dsw-alias-bg-module-platform, var(--dsw-alias-bg-layer-2, color-mix(in srgb, var(--omni-label-tertiary) 12%, transparent)));
  --omni-bg-elevated: var(--dsw-alias-bg-elevated, var(--dsw-alias-bg-layer-3));
  --omni-stroke: var(--dsw-alias-stroke-secondary, var(--dsw-alias-border-l2));
  --omni-danger-soft: color-mix(in srgb, var(--omni-danger) 10%, transparent);
  --omni-warn-soft: color-mix(in srgb, var(--omni-warn) 10%, transparent);
  --omni-composer-size: 28px;
  --omni-rail-size: 36px;
}
`;

export const HOST_TOKEN_NAMES = [
  "--dsw-alias-label-primary",
  "--dsw-alias-label-secondary",
  "--dsw-alias-label-tertiary",
  "--dsw-alias-label-error",
  "--dsw-alias-border-l2",
  "--dsw-alias-label-dimmed",
  "--dsw-alias-bg-layer-3",
  "--dsw-alias-brand-primary",
  "--dsw-alias-state-error-primary",
  "--dsw-alias-state-warn-primary",
  "--dsw-shadow-lv2",
  "--dsw-alias-fill-tertiary",
  "--dsw-alias-interactive-bg-hover",
  "--dsw-alias-fill-quaternary",
  "--dsw-alias-bg-module-platform",
  "--dsw-alias-bg-layer-2",
  "--dsw-alias-bg-elevated",
  "--dsw-alias-stroke-secondary",
  "--dsw-alias-state-success-primary",
] as const;
