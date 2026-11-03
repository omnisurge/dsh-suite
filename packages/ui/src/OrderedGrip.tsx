import {
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import {
  ORDERED_GRIP_LONG_PRESS_MS,
  activateOrderedGripPress,
  beginOrderedGripPress,
  finishOrderedGripPress,
  orderedGripKeyboardTarget,
  trackOrderedGripPress,
  type OrderedGripPress,
} from "./ordered-grip.js";

export interface OrderedGripProps {
  readonly index: number;
  readonly count: number;
  readonly label: string;
  readonly activeLabel?: string;
  readonly onMove: (from: number, to: number) => void;
  /** Live drag target. Null when the gesture ends or never activated. Keyboard skips this. */
  readonly onPreview?: (press: OrderedGripPress | null) => void;
}

function indexAtPoint(clientX: number, clientY: number): number | undefined {
  for (const element of document.elementsFromPoint(clientX, clientY)) {
    const row = element.closest<HTMLElement>("[data-omni-order-index]");
    if (row === null || row.classList.contains("omni-ui-tierRowGhost")) continue;
    const raw = row.dataset.omniOrderIndex;
    if (raw === undefined) continue;
    const index = Number(raw);
    if (Number.isInteger(index)) return index;
  }
  return undefined;
}

/** Left-edge long-press grip for local ordered-list editing. */
export function OrderedGrip(props: OrderedGripProps) {
  const pressRef = useRef<OrderedGripPress | null>(null);
  const timerRef = useRef<number | null>(null);
  const [dragging, setDragging] = useState(false);

  const clearTimer = (): void => {
    if (timerRef.current === null) return;
    window.clearTimeout(timerRef.current);
    timerRef.current = null;
  };

  const preview = (press: OrderedGripPress | null): void => {
    props.onPreview?.(press?.dragging === true ? press : null);
  };

  const reset = (button: HTMLButtonElement, pointerId?: number): void => {
    clearTimer();
    pressRef.current = null;
    setDragging(false);
    preview(null);
    if (pointerId !== undefined && button.hasPointerCapture(pointerId)) {
      button.releasePointerCapture(pointerId);
    }
  };

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>): void => {
    if (event.button !== 0 || props.count < 2) return;
    event.preventDefault();
    const press = beginOrderedGripPress(
      event.pointerId,
      props.index,
      event.clientX,
      event.clientY,
    );
    pressRef.current = press;
    const button = event.currentTarget;
    button.setPointerCapture(event.pointerId);
    clearTimer();
    timerRef.current = window.setTimeout(() => {
      const current = pressRef.current;
      if (current === null || current.pointerId !== press.pointerId || current.dragging) return;
      const row = button.closest<HTMLElement>("[data-omni-order-index]");
      const rect = row?.getBoundingClientRect();
      const next = activateOrderedGripPress(
        current,
        rect === undefined
          ? undefined
          : {
            width: rect.width,
            grabX: current.clientX - rect.left,
            grabY: current.clientY - rect.top,
          },
      );
      pressRef.current = next;
      setDragging(true);
      preview(next);
      timerRef.current = null;
    }, ORDERED_GRIP_LONG_PRESS_MS);
  };

  const onPointerMove = (event: PointerEvent<HTMLButtonElement>): void => {
    const press = pressRef.current;
    if (press === null) return;
    const next = trackOrderedGripPress(
      press,
      event.pointerId,
      event.clientX,
      event.clientY,
      press.dragging ? indexAtPoint(event.clientX, event.clientY) : undefined,
      props.count,
    );
    if (next === null) {
      reset(event.currentTarget, event.pointerId);
      return;
    }
    pressRef.current = next;
    if (next.dragging) preview(next);
  };

  const onPointerUp = (event: PointerEvent<HTMLButtonElement>): void => {
    const move = finishOrderedGripPress(pressRef.current, event.pointerId);
    reset(event.currentTarget, event.pointerId);
    if (move !== null) props.onMove(move.from, move.to);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    const target = orderedGripKeyboardTarget(props.index, props.count, event.key);
    if (target === null) return;
    event.preventDefault();
    props.onMove(props.index, target);
  };

  return (
    <button
      type="button"
      className={`omni-ui-tierGrip${dragging ? " omni-ui-tierGripActive" : ""}`}
      aria-label={dragging ? props.activeLabel ?? props.label : props.label}
      aria-pressed={dragging}
      title={props.label}
      onClick={(event) => event.preventDefault()}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={(event) => reset(event.currentTarget, event.pointerId)}
      onLostPointerCapture={(event) => {
        if (pressRef.current?.pointerId === event.pointerId) reset(event.currentTarget);
      }}
    >
      <span aria-hidden="true">⠿</span>
    </button>
  );
}
