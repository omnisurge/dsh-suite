/**
 * Pure policy for the system-notice dual track (README「系统提示双轨」),
 * no DOM — shared by toast.ts / confirm.ts and tests.
 */

/** Max toasts on screen; beyond this the oldest are evicted. */
export const TOAST_STACK_LIMIT = 3;

/**
 * Index of the same-kind toast an incoming one replaces (同 kind 合并),
 * or -1. Kind-less toasts never merge.
 */
export function toastReplaceIndex(
  kinds: readonly (string | undefined)[],
  kind: string | undefined,
): number {
  if (kind === undefined || kind === "") return -1;
  return kinds.findIndex((existing) => existing === kind);
}

/** How many oldest toasts to evict so `count + 1` fits within `limit`. */
export function toastEvictCount(count: number, limit: number = TOAST_STACK_LIMIT): number {
  const cap = Math.max(1, Math.floor(limit));
  return Math.max(0, count + 1 - cap);
}

/**
 * Effective auto-dismiss delay: `undefined` → default; `null` / non-finite /
 * `<= 0` → sticky (null, close via × or code).
 */
export function toastDurationMs(
  duration: number | null | undefined,
  fallback = 6000,
): number | null {
  if (duration === undefined) return fallback;
  if (duration === null || !Number.isFinite(duration) || duration <= 0) return null;
  return duration;
}

/**
 * Resolve effective toast auto-dismiss duration taking tone defaults into
 * account: `loading` is sticky (`null`), `ok` defaults to 4000ms, others 6000ms.
 * Explicit `duration` always overrides the tone default.
 */
export function toastToneDurationMs(
  tone: string | undefined,
  duration: number | null | undefined,
): number | null {
  if (duration !== undefined) return toastDurationMs(duration);
  if (tone === "loading") return null;
  if (tone === "ok") return 4000;
  return 6000;
}

export interface ToastSvgCircle {
  readonly cx: string;
  readonly cy: string;
  readonly r: string;
  readonly fill?: string;
  readonly strokeWidth?: string;
}

export interface ToastSvgPath {
  readonly d: string;
  readonly strokeWidth: string;
}

export interface ToastIconSpec {
  readonly circles: readonly ToastSvgCircle[];
  readonly paths: readonly ToastSvgPath[];
}

export const TOAST_ICON_SPECS: Readonly<Record<"ok" | "warn" | "danger", ToastIconSpec>> = {
  ok: {
    circles: [{ cx: "8", cy: "8", r: "6.5", strokeWidth: "1.5" }],
    paths: [{ d: "M5.2 8.2 7.1 10.1 10.9 6.1", strokeWidth: "1.6" }],
  },
  warn: {
    circles: [
      { cx: "8", cy: "8", r: "6.5", strokeWidth: "1.5" },
      { cx: "8", cy: "11.4", r: "0.9", fill: "currentColor" },
    ],
    paths: [{ d: "M8 4.8v4.1", strokeWidth: "1.6" }],
  },
  danger: {
    circles: [
      { cx: "8", cy: "8", r: "6.5", strokeWidth: "1.5" },
      { cx: "8", cy: "11.4", r: "0.9", fill: "currentColor" },
    ],
    paths: [{ d: "M8 4.8v4.1", strokeWidth: "1.6" }],
  },
};

/** Shared class string for both `<ToastItem>` and imperative `showToast` nodes. */
export function toastToneClassName(tone: string | undefined, extraClass?: string): string {
  const resolved = tone ?? "neutral";
  const classes = ["omni-ui-toastItem", "omni-ui-toast", `omni-ui-toast--${resolved}`];
  if (resolved === "warn") classes.push("omni-ui-toastWarn");
  if (resolved === "danger") classes.push("omni-ui-toastDanger");
  if (extraClass !== undefined && extraClass !== "") classes.push(extraClass);
  return classes.join(" ");
}

/**
 * Focus-trap cycle: index Tab / Shift+Tab moves to among `count` stops.
 * `current` -1 (focus outside the dialog) re-enters at an edge.
 */
export function trapNextIndex(count: number, current: number, backwards: boolean): number {
  if (count <= 0) return -1;
  if (current < 0 || current >= count) return backwards ? count - 1 : 0;
  return (current + (backwards ? count - 1 : 1)) % count;
}
