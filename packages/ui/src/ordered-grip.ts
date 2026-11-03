/** Pure state machine behind {@link OrderedGrip}. */

export const ORDERED_GRIP_LONG_PRESS_MS = 320;
export const ORDERED_GRIP_CANCEL_DISTANCE = 6;

export interface OrderedGripPress {
  readonly pointerId: number;
  readonly from: number;
  readonly target: number;
  readonly originX: number;
  readonly originY: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly dragging: boolean;
  readonly width?: number;
  readonly grabX?: number;
  readonly grabY?: number;
}

export interface OrderedGripMove {
  readonly from: number;
  readonly to: number;
}

export function beginOrderedGripPress(
  pointerId: number,
  index: number,
  clientX: number,
  clientY: number,
): OrderedGripPress {
  return {
    pointerId,
    from: index,
    target: index,
    originX: clientX,
    originY: clientY,
    clientX,
    clientY,
    dragging: false,
  };
}

export function activateOrderedGripPress(
  press: OrderedGripPress,
  float?: { readonly width: number; readonly grabX: number; readonly grabY: number },
): OrderedGripPress {
  return { ...press, dragging: true, ...float };
}

/** Viewport box for the ghost row. Missing float metrics → not yet following. */
export function orderedGripGhostStyle(
  press: OrderedGripPress,
): { left: number; top: number; width: number } | undefined {
  if (!press.dragging || press.width === undefined || press.grabX === undefined || press.grabY === undefined) {
    return undefined;
  }
  return {
    left: press.clientX - press.grabX,
    top: press.clientY - press.grabY,
    width: press.width,
  };
}

/**
 * Track one held pointer. Moving beyond the tolerance before long-press
 * activation cancels the gesture so a scroll or short swipe never reorders.
 */
export function trackOrderedGripPress(
  press: OrderedGripPress,
  pointerId: number,
  clientX: number,
  clientY: number,
  target: number | undefined,
  count: number,
): OrderedGripPress | null {
  if (pointerId !== press.pointerId) return press;
  if (!press.dragging) {
    const distance = Math.hypot(clientX - press.originX, clientY - press.originY);
    return distance > ORDERED_GRIP_CANCEL_DISTANCE ? null : { ...press, clientX, clientY };
  }
  const nextTarget = target === undefined || target < 0 || target >= count ? press.target : target;
  if (nextTarget === press.target && clientX === press.clientX && clientY === press.clientY) {
    return press;
  }
  return { ...press, target: nextTarget, clientX, clientY };
}

/** A release commits only an activated drag whose target actually changed. */
export function finishOrderedGripPress(
  press: OrderedGripPress | null,
  pointerId: number,
): OrderedGripMove | null {
  if (press === null || press.pointerId !== pointerId || !press.dragging || press.from === press.target) {
    return null;
  }
  return { from: press.from, to: press.target };
}

export function orderedGripKeyboardTarget(
  index: number,
  count: number,
  key: string,
): number | null {
  const delta = key === "ArrowUp" || key === "ArrowLeft"
    ? -1
    : key === "ArrowDown" || key === "ArrowRight"
      ? 1
      : 0;
  if (delta === 0) return null;
  const target = index + delta;
  return target >= 0 && target < count ? target : null;
}
