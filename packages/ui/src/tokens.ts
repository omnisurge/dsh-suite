/**
 * Visual values live here (ADR-028 / ADR-121). Defaults map to host --dsw-alias-*.
 * OEM swap = edit this file; controls keep using --omni-*.
 *
 * Spacing ladder (project-wide — suite plugins must not invent ad-hoc px):
 *   --omni-gap-xs       4px  minimal breathing (icon/text)
 *   --omni-gap-sm       6px  label to control, dot to label
 *   --omni-gap-tight    8px  within a control cluster (KV row, actions, toolbar)
 *   --omni-gap         12px  default stack / field groups / card chrome
 *   --omni-gap-section 16px  between cards and major blocks
 *   --omni-gap-lg      20px  dialog / drawer padding
 *   --omni-gap-xl      24px  modal viewport inset
 *
 * Note: `--omni-drawer-footer-height` is intentionally declared ONLY on
 * `dialog.omni-ui-drawer` in styles.ts (never here) so runtime footer measurements
 * on `<dialog>` are inherited by nested `.omni-ui-toastHost` without shadowing.
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
.omni-ui-toastItem,
.omni-ui-confirmScrim,
.omni-ui-busyScrim,
.omni-ui-drawer,
.omni-ui-dialog,
.omni-ui-empty,
.omni-ui-actionGroup,
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
  --omni-label-primary: var(--dsw-alias-label-primary, #0f1115);
  --omni-label-secondary: var(--dsw-alias-label-secondary, #61666b);
  --omni-label-tertiary: var(--dsw-alias-label-tertiary, #81858c);
  --omni-label-dimmed: var(--dsw-alias-label-dimmed, #adb2b8);
  --omni-label-error: var(--dsw-alias-state-error-primary, #ec1313);
  --omni-label-on-primary: var(--dsw-alias-label-primary-foreground, var(--omni-bg));
  --omni-label-on-color: var(--dsw-alias-label-on-color, #ffffff);
  --omni-link: var(--dsw-alias-link, var(--dsw-alias-state-business-primary, #4176e6));
  --omni-bg: var(--dsw-alias-bg-layer-3, #ffffff);
  --omni-bg-base: var(--dsw-alias-bg-base, #ffffff);
  --omni-bg-surface: var(--dsw-alias-settings-card-fill, var(--dsw-alias-bg-layer-2, #ffffff));
  --omni-bg-subtle: var(--dsw-alias-card-fill, #fafafa);
  --omni-bg-muted: var(--dsw-alias-bg-module-platform, var(--dsw-alias-bg-layer-2, #f5f6f7));
  --omni-bg-elevated: var(--dsw-alias-bg-layer-2, var(--dsw-alias-bg-layer-3, #ffffff));
  --omni-bg-control: var(--dsw-alias-bg-layer-1, var(--dsw-alias-bg-layer-3, #ffffff));
  --omni-bg-skeleton: var(--dsw-alias-bg-skeleton, rgba(0, 0, 0, .04));
  --omni-toast-bg: var(--dsw-alias-toast-bg, #353638);
  --omni-toast-label: var(--dsw-alias-toast-label, #ffffff);
  --omni-toast-action: var(--dsw-alias-toast-action, #7aaaff);
  --omni-scrim: var(--dsw-alias-bg-mask-1, rgba(0, 0, 0, .24));
  --omni-brand: var(--dsw-alias-brand-primary, var(--dsw-alias-label-primary, #0f1115));
  --omni-primary-fill: var(--dsw-alias-button-primary-fill, var(--omni-brand));
  --omni-primary-hover: var(--dsw-alias-button-primary-hover, color-mix(in srgb, var(--omni-primary-fill) 86%, var(--omni-bg-base)));
  --omni-fill: var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, .06));
  --omni-fill-strong: var(--dsw-alias-interactive-bg-active, rgba(38, 49, 72, .10));
  --omni-fill-selected: var(--dsw-alias-button-ghost-active-fill, var(--omni-fill));
  --omni-border-subtle: var(--dsw-alias-border-l1, rgba(0, 0, 0, .04));
  --omni-border: var(--dsw-alias-border-l2, rgba(0, 0, 0, .10));
  --omni-stroke: var(--dsw-alias-border-l3, var(--omni-border));
  --omni-border-strong: var(--dsw-alias-border-l4, rgba(0, 0, 0, .16));
  --omni-border-selected: var(--dsw-alias-border-selected, var(--omni-border-strong));
  --omni-switch-track: var(--dsw-alias-border-l3, rgba(0, 0, 0, .12));
  --omni-switch-thumb: var(--dsw-alias-switch-thumb, #ffffff);
  --omni-ok: var(--dsw-alias-state-success-primary, #22c55e);
  --omni-ok-soft: color-mix(in srgb, var(--omni-ok) 10%, transparent);
  --omni-ok-border: color-mix(in srgb, var(--omni-ok) 28%, transparent);
  --omni-ok-label: color-mix(in srgb, var(--omni-ok) 56%, var(--omni-label-primary));
  --omni-warn: var(--dsw-alias-state-warn-primary, #f59e0b);
  --omni-warn-soft: color-mix(in srgb, var(--omni-warn) 12%, transparent);
  --omni-warn-border: color-mix(in srgb, var(--omni-warn) 32%, transparent);
  --omni-warn-label: color-mix(in srgb, var(--dsw-alias-state-warn-label, var(--omni-warn)) 62%, var(--omni-label-primary));
  --omni-danger: var(--dsw-alias-state-error-primary, #ec1313);
  --omni-danger-soft: var(--dsw-alias-interactive-bg-hover-danger, color-mix(in srgb, var(--omni-danger) 10%, transparent));
  --omni-danger-border: color-mix(in srgb, var(--omni-danger) 35%, transparent);
  --omni-danger-label: color-mix(in srgb, var(--omni-danger) 66%, var(--omni-label-primary));
  --omni-info: var(--dsw-alias-state-business-primary, #4176e6);
  --omni-info-soft: color-mix(in srgb, var(--omni-info) 10%, transparent);
  --omni-focus-ring-width: var(--dsw-focus-ring-width, 2px);
  --omni-focus-ring-color: var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary, #4176e6));
  --omni-focus-ring-offset: 2px;
  --omni-font-sans: var(--dsw-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif);
  /* Aligned technical text (revisions, ids, paths). */
  --omni-font-mono: var(--ds-font-family-code, ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace);
  --omni-text-xs: 11px;
  --omni-leading-xs: 16px;
  --omni-text-sm: 12px;
  --omni-leading-sm: 18px;
  --omni-text-md: 13px;
  --omni-leading-md: 20px;
  --omni-text-base: 14px;
  --omni-leading-base: 22px;
  --omni-text-lg: 15px;
  --omni-leading-lg: 22px;
  --omni-text-xl: 18px;
  --omni-leading-xl: 24px;
  --omni-text-input-touch: 16px;
  --omni-leading-input-touch: 22px;
  --omni-weight-regular: 400;
  --omni-weight-medium: 500;
  --omni-weight-semibold: 600;
  --omni-gap-xs: 4px;
  --omni-gap-sm: 6px;
  --omni-gap-tight: 8px;
  --omni-gap: 12px;
  --omni-gap-section: 16px;
  --omni-gap-lg: 20px;
  --omni-gap-xl: 24px;
  /* Label column of a key/value row: narrow enough that the value sits beside its label. */
  --omni-kv-label: 9rem;
  --omni-control-height-sm: 28px;
  --omni-control-height: 34px;
  --omni-control-height-lg: 36px;
  --omni-touch-target: 44px;
  --omni-composer-size: 28px;
  --omni-rail-size: 36px;
  --omni-radius-xs: var(--dsw-radius-xs, 4px);
  --omni-radius-sm: var(--dsw-radius-sm, 8px);
  --omni-radius-control: var(--dsw-radius-sm, 8px);
  --omni-radius: var(--dsw-radius-md, 12px);
  --omni-radius-lg: var(--dsw-radius-lg, 16px);
  --omni-radius-panel: var(--dsw-radius-xl, 20px);
  --omni-radius-pill: 999px;
  --omni-shadow-sm: var(--dsw-shadow-lv1, 0 2px 4px 0 rgba(0, 0, 0, .05));
  --omni-shadow: var(--dsw-shadow-lv2, 0 4px 12px 0 rgba(0, 0, 0, .02), 0 2px 8px 0 rgba(0, 0, 0, .04));
  --omni-shadow-lg: var(--dsw-shadow-lv3, 0 0 1px 0 rgba(0, 0, 0, .2), 0 0 4px 0 rgba(0, 0, 0, .02), 0 12px 32px 0 rgba(0, 0, 0, .08));
  --omni-elevation-panel: var(--dsw-elevation-panel, var(--omni-shadow));
  --omni-elevation-prominent: var(--dsw-elevation-prominent, var(--omni-shadow-lg));
  --omni-duration-fast: var(--ds-transition-duration-fast, 100ms);
  --omni-duration-base: var(--ds-transition-duration, 200ms);
  --omni-duration-slow: var(--ds-transition-duration-slow, 300ms);
  --omni-duration-spin: 1000ms;
  --omni-ease-standard: var(--ds-ease-in-out, cubic-bezier(0.4, 0, 0.2, 1));
  --omni-ease-enter: cubic-bezier(0, 0, 0.2, 1);
  --omni-ease-exit: cubic-bezier(0.4, 0, 1, 1);
  --omni-z-drawer: 8800;
  --omni-z-busy: 8900;
  --omni-z-dialog: 9000;
  --omni-z-toast: 9010;
  --omni-toast-offset-bottom: 88px;
}
`;

export const HOST_TOKEN_NAMES = [
  "--dsw-alias-label-primary",
  "--dsw-alias-label-secondary",
  "--dsw-alias-label-tertiary",
  "--dsw-alias-label-dimmed",
  "--dsw-alias-label-primary-foreground",
  "--dsw-alias-label-on-color",
  "--dsw-alias-link",
  "--dsw-alias-bg-base",
  "--dsw-alias-settings-card-fill",
  "--dsw-alias-card-fill",
  "--dsw-alias-bg-module-platform",
  "--dsw-alias-bg-layer-1",
  "--dsw-alias-bg-layer-2",
  "--dsw-alias-bg-layer-3",
  "--dsw-alias-bg-skeleton",
  "--dsw-alias-toast-bg",
  "--dsw-alias-toast-label",
  "--dsw-alias-toast-action",
  "--dsw-alias-bg-mask-1",
  "--dsw-alias-brand-primary",
  "--dsw-alias-button-primary-fill",
  "--dsw-alias-button-primary-hover",
  "--dsw-alias-interactive-bg-hover",
  "--dsw-alias-interactive-bg-active",
  "--dsw-alias-interactive-bg-hover-danger",
  "--dsw-alias-button-ghost-active-fill",
  "--dsw-alias-border-l1",
  "--dsw-alias-border-l2",
  "--dsw-alias-border-l3",
  "--dsw-alias-border-l4",
  "--dsw-alias-border-selected",
  "--dsw-alias-switch-thumb",
  "--dsw-alias-state-success-primary",
  "--dsw-alias-state-warn-primary",
  "--dsw-alias-state-warn-label",
  "--dsw-alias-state-error-primary",
  "--dsw-alias-state-business-primary",
  "--dsw-focus-ring-width",
  "--dsw-focus-ring-color",
  "--dsw-font-family",
  "--ds-font-family-code",
  "--dsw-radius-xs",
  "--dsw-radius-sm",
  "--dsw-radius-md",
  "--dsw-radius-lg",
  "--dsw-radius-xl",
  "--dsw-shadow-lv1",
  "--dsw-shadow-lv2",
  "--dsw-shadow-lv3",
  "--dsw-elevation-panel",
  "--dsw-elevation-prominent",
  "--ds-transition-duration-fast",
  "--ds-transition-duration",
  "--ds-transition-duration-slow",
  "--ds-ease-in-out",
] as const;
