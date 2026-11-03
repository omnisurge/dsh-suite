/** Shared dial math (no React) for DialPicker + tests. */

/** Pixel-mode (trackpad) travel that equals one item. */
export const WHEEL_PIXEL_PER_ITEM = 72;
/** Max pixels applied from one wheel event — flicks stay one–two items. */
export const WHEEL_PIXEL_CAP = 14;
/** Ignore leftover inertia crumbs. */
export const WHEEL_PIXEL_DEAD = 0.45;
/** After the last pixel pulse, snap to a detent. */
export const WHEEL_SNAP_IDLE_MS = 140;
/** Mouse-notch / key slide duration (ms). */
export const WHEEL_STEP_MS = 220;

export function dominantWheelDelta(deltaX: number, deltaY: number): number {
  return Math.abs(deltaX) > Math.abs(deltaY) ? deltaX : deltaY;
}

/** Mouse wheel notches / page keys: one discrete step, or 0 if this is a pixel stream. */
export function discreteWheelStep(deltaX: number, deltaY: number, deltaMode: number): number {
  if (deltaMode !== 1 && deltaMode !== 2) return 0;
  const raw = dominantWheelDelta(deltaX, deltaY);
  if (raw === 0) return 0;
  return raw > 0 ? 1 : -1;
}

/**
 * Trackpad / precision-wheel contribution in item units (fractional).
 * Line/page events return 0 — those go through `discreteWheelStep`.
 */
export function pixelWheelItems(deltaX: number, deltaY: number, deltaMode: number): number {
  if (deltaMode === 1 || deltaMode === 2) return 0;
  const raw = dominantWheelDelta(deltaX, deltaY);
  if (Math.abs(raw) < WHEEL_PIXEL_DEAD) return 0;
  const capped = Math.sign(raw) * Math.min(Math.abs(raw), WHEEL_PIXEL_CAP);
  return capped / WHEEL_PIXEL_PER_ITEM;
}

export function easeOutCubic(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return 1 - (1 - x) ** 3;
}

export function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

/** Wrap index into [0, length). */
export function wrapIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  const mod = index % length;
  return mod < 0 ? mod + length : mod;
}

/**
 * How many columns fit in `width` given a minimum column width.
 * Always odd (center selection), at least 3, at most `maxCount`.
 */
export function visibleCountForWidth(
  width: number,
  minItemWidth: number,
  maxCount = 11,
): number {
  if (width <= 0 || minItemWidth <= 0) return 3;
  let n = Math.floor(width / minItemWidth);
  if (n % 2 === 0) n -= 1;
  n = Math.max(3, n);
  const cap = maxCount % 2 === 0 ? maxCount - 1 : maxCount;
  return Math.min(n, Math.max(3, cap));
}
