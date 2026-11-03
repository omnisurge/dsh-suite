import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  WHEEL_SNAP_IDLE_MS,
  WHEEL_STEP_MS,
  discreteWheelStep,
  easeOutCubic,
  lerp,
  pixelWheelItems,
  visibleCountForWidth,
  wrapIndex,
} from "./dial-math.js";

export interface DialOption {
  readonly id: string;
  readonly label: string;
}

export interface DialPickerProps {
  readonly options: readonly DialOption[];
  readonly value: string;
  readonly onChange: (id: string) => void;
  readonly disabled?: boolean;
  readonly "aria-label"?: string;
  /**
   * Fixed visible columns (odd). When omitted, count follows container width.
   */
  readonly visibleCount?: number;
  /** Minimum column width used for elastic layout; default 88. */
  readonly minItemWidth?: number;
}

export { wrapIndex, visibleCountForWidth } from "./dial-math.js";

/**
 * Horizontal infinite dial: wheel / drag / keys, snap to center.
 * Column count flexes with width; inverted triangle + inset rails mark selection.
 */
export function DialPicker(props: DialPickerProps): ReactNode {
  const options = props.options;
  const length = options.length;
  const minItemWidth = props.minItemWidth ?? 88;
  const disabled = props.disabled === true || length === 0;

  const rootRef = useRef<HTMLDivElement | null>(null);
  const [hostWidth, setHostWidth] = useState(0);

  useEffect(() => {
    const node = rootRef.current;
    if (node === null || typeof ResizeObserver === "undefined") return;
    const apply = (width: number): void => {
      const next = Math.round(width);
      setHostWidth((prev) => (prev === next ? prev : next));
    };
    apply(node.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) apply(entry.contentRect.width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const visibleCount = (() => {
    if (props.visibleCount !== undefined) {
      const odd = props.visibleCount % 2 === 0 ? props.visibleCount + 1 : props.visibleCount;
      return Math.max(3, odd);
    }
    return visibleCountForWidth(hostWidth > 0 ? hostWidth : minItemWidth * 5, minItemWidth);
  })();
  const radius = Math.floor(visibleCount / 2);
  const itemWidth =
    hostWidth > 0 ? Math.max(minItemWidth, hostWidth / visibleCount) : minItemWidth;

  const valueIndex = (() => {
    if (length === 0) return 0;
    const found = options.findIndex((option) => option.id === props.value);
    return found >= 0 ? found : 0;
  })();

  const [scroll, setScroll] = useState(valueIndex);
  const scrollRef = useRef(scroll);
  scrollRef.current = scroll;

  const dragging = useRef(false);
  const lastX = useRef(0);
  const itemWidthRef = useRef(itemWidth);
  itemWidthRef.current = itemWidth;

  const optionsRef = useRef(options);
  optionsRef.current = options;
  const valueRef = useRef(props.value);
  valueRef.current = props.value;
  const onChangeRef = useRef(props.onChange);
  onChangeRef.current = props.onChange;
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;
  const lengthRef = useRef(length);
  lengthRef.current = length;
  const wheeling = useRef(false);
  const wheelIdle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const animRaf = useRef(0);

  const stopAnim = (): void => {
    if (animRaf.current !== 0) {
      cancelAnimationFrame(animRaf.current);
      animRaf.current = 0;
    }
  };

  const clearWheelIdle = (): void => {
    if (wheelIdle.current !== null) {
      clearTimeout(wheelIdle.current);
      wheelIdle.current = null;
    }
  };

  useEffect(() => {
    if (dragging.current || wheeling.current) return;
    setScroll(valueIndex);
  }, [valueIndex]);

  useEffect(() => {
    return () => {
      stopAnim();
      clearWheelIdle();
    };
  }, []);

  const emit = (nextScroll: number): void => {
    const len = lengthRef.current;
    if (len === 0) return;
    const snapped = Math.round(nextScroll);
    scrollRef.current = snapped;
    setScroll(snapped);
    const id = optionsRef.current[wrapIndex(snapped, len)]?.id;
    if (id !== undefined && id !== valueRef.current) onChangeRef.current(id);
  };

  const preview = (nextScroll: number): void => {
    const len = lengthRef.current;
    if (len === 0) return;
    scrollRef.current = nextScroll;
    setScroll(nextScroll);
    const id = optionsRef.current[wrapIndex(Math.round(nextScroll), len)]?.id;
    if (id !== undefined && id !== valueRef.current) onChangeRef.current(id);
  };

  const animateTo = (target: number): void => {
    stopAnim();
    wheeling.current = true;
    const from = scrollRef.current;
    const start = performance.now();
    const tick = (now: number): void => {
      const t = Math.min(1, (now - start) / WHEEL_STEP_MS);
      const next = lerp(from, target, easeOutCubic(t));
      scrollRef.current = next;
      setScroll(next);
      if (t < 1) {
        animRaf.current = requestAnimationFrame(tick);
        return;
      }
      animRaf.current = 0;
      wheeling.current = false;
      emit(target);
    };
    animRaf.current = requestAnimationFrame(tick);
  };

  const nudge = (delta: number): void => {
    if (disabledRef.current || delta === 0) return;
    animateTo(Math.round(scrollRef.current) + delta);
  };

  // Non-passive wheel: React's onWheel is passive, so preventDefault would not
  // stop the page from scrolling underneath the dial.
  useEffect(() => {
    const node = rootRef.current;
    if (node === null) return;
    const handleWheel = (event: globalThis.WheelEvent): void => {
      if (disabledRef.current || dragging.current) return;
      event.preventDefault();
      event.stopPropagation();
      const notch = discreteWheelStep(event.deltaX, event.deltaY, event.deltaMode);
      if (notch !== 0) {
        clearWheelIdle();
        nudge(notch);
        return;
      }
      const items = pixelWheelItems(event.deltaX, event.deltaY, event.deltaMode);
      if (items === 0) return;
      stopAnim();
      wheeling.current = true;
      preview(scrollRef.current + items);
      clearWheelIdle();
      wheelIdle.current = setTimeout(() => {
        wheelIdle.current = null;
        wheeling.current = false;
        emit(scrollRef.current);
      }, WHEEL_SNAP_IDLE_MS);
    };
    node.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      node.removeEventListener("wheel", handleWheel);
      clearWheelIdle();
      stopAnim();
    };
  }, []);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (disabled) return;
    dragging.current = true;
    lastX.current = event.clientX;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!dragging.current || disabled) return;
    const dx = event.clientX - lastX.current;
    lastX.current = event.clientX;
    const step = itemWidthRef.current || minItemWidth;
    setScroll(scrollRef.current - dx / step);
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!dragging.current) return;
    dragging.current = false;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      /* already released */
    }
    emit(scrollRef.current);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (disabled) return;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      nudge(1);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      nudge(-1);
    } else if (event.key === "Home") {
      event.preventDefault();
      emit(0);
    } else if (event.key === "End") {
      event.preventDefault();
      emit(length - 1);
    }
  };

  const center = Math.round(scroll);
  const frac = scroll - center;
  const selected = length === 0 ? null : options[wrapIndex(center, length)]!;

  const items: ReactNode[] = [];
  if (length > 0) {
    for (let slot = -radius; slot <= radius; slot += 1) {
      const option = options[wrapIndex(center + slot, length)]!;
      const distance = Math.abs(slot - frac);
      const active = slot === 0 && Math.abs(frac) < 0.4;
      const opacity = Math.max(0.28, 1 - distance * 0.32);
      items.push(
        <div
          key={`${slot}:${option.id}`}
          className={active ? "omni-ui-dialItem omni-ui-dialItemActive" : "omni-ui-dialItem"}
          style={{ width: itemWidth, opacity }}
          aria-hidden={true}
        >
          {option.label}
        </div>,
      );
    }
  }

  const trackWidth = itemWidth * visibleCount;

  return (
    <div
      ref={rootRef}
      className={disabled ? "omni-ui-dial omni-ui-dialDisabled" : "omni-ui-dial"}
      style={{ ["--omni-dial-item" as string]: `${itemWidth}px` }}
      role="listbox"
      tabIndex={disabled ? -1 : 0}
      aria-label={props["aria-label"]}
      aria-disabled={disabled}
      aria-activedescendant={selected ? `omni-dial-${selected.id}` : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
    >
      <div className="omni-ui-dialMarker" aria-hidden={true} />
      <div className="omni-ui-dialRail omni-ui-dialRailTop" aria-hidden={true} />
      <div className="omni-ui-dialRail omni-ui-dialRailBottom" aria-hidden={true} />
      <div className="omni-ui-dialFade omni-ui-dialFadeStart" aria-hidden={true} />
      <div className="omni-ui-dialFade omni-ui-dialFadeEnd" aria-hidden={true} />
      <div
        className="omni-ui-dialTrack"
        style={{
          width: trackWidth,
          transform: `translateX(calc(-50% + ${-frac * itemWidth}px))`,
        }}
      >
        {items}
      </div>
      {selected ? (
        <span id={`omni-dial-${selected.id}`} className="omni-ui-dialSr">
          {selected.label}
        </span>
      ) : null}
    </div>
  );
}
