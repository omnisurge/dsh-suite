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
 * Focus-trap cycle: index Tab / Shift+Tab moves to among `count` stops.
 * `current` -1 (focus outside the dialog) re-enters at an edge.
 */
export function trapNextIndex(count: number, current: number, backwards: boolean): number {
  if (count <= 0) return -1;
  if (current < 0 || current >= count) return backwards ? count - 1 : 0;
  return (current + (backwards ? count - 1 : 1)) % count;
}
