import { useEffect, useId, useLayoutEffect, useRef, type ReactNode } from "react";
import { trapNextIndex } from "./notify-core.js";
import {
  closeNativeDialog,
  focusElementSafe,
  getFocusableElements,
  openNativeDialog,
  restoreFocusSafe,
  type OverlayBaseProps,
} from "./overlay-shared.js";
import { registerOverlayDialog, topmostDialog, unregisterOverlayDialog } from "./overlay-stack.js";
import { Skeleton } from "./Progress.js";
import { injectStyles } from "./styles.js";

export interface DrawerProps extends OverlayBaseProps {
  /** Optional subtle eyebrow label above the title (e.g. "连接"). */
  readonly eyebrow?: string;
  /** Optional status/dirty badge rendered beside the title outside `<h2 id={titleId}>`. */
  readonly badge?: ReactNode;
  /** Desktop slide-in side. Default "right". */
  readonly placement?: "right" | "left";
}

function hasTextOrNode(value: unknown): boolean {
  return value !== undefined && value !== null && value !== false && value !== "";
}

/** Native `<dialog>` drawer (desktop side slide-in; 390px bottom sheet). Zero react-dom. */
export function Drawer(props: DrawerProps) {
  const {
    open,
    onClose,
    title,
    description,
    eyebrow,
    closeLabel,
    size = "md",
    placement = "right",
    footer,
    dismissible = true,
    busy = false,
    loading = false,
    children,
    className = "",
    initialFocusRef,
  } = props;

  const titleId = useId();
  const descId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLElement>(null);
  const mouseDownOnBackdropRef = useRef<boolean | null>(null);
  const latestRef = useRef({ onClose, dismissible, busy });
  latestRef.current = { onClose, dismissible, busy };

  const hasEyebrow = hasTextOrNode(eyebrow);
  const hasDesc = hasTextOrNode(description);

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (dialog === null) return;

    injectStyles();
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    openNativeDialog(dialog);
    registerOverlayDialog(dialog);

    const handleCancel = (event: Event) => {
      event.preventDefault();
      const state = latestRef.current;
      if (state.dismissible && !state.busy) state.onClose("escape");
    };

    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (typeof dialog.showModal === "function") return;
        if (topmostDialog() !== dialog) return;
        event.preventDefault();
        event.stopPropagation();
        const state = latestRef.current;
        if (state.dismissible && !state.busy) state.onClose("escape");
        return;
      }
      if (event.key === "Tab" && typeof dialog.showModal !== "function" && topmostDialog() === dialog) {
        const stops = getFocusableElements(dialog);
        const current = stops.findIndex((el) => el === document.activeElement);
        const next = trapNextIndex(stops.length, current, event.shiftKey);
        if (next < 0) return;
        event.preventDefault();
        stops[next]?.focus();
      }
    };

    dialog.addEventListener("cancel", handleCancel);
    if (typeof dialog.showModal !== "function") {
      document.addEventListener("keydown", handleKeydown, true);
    }

    const preferred = initialFocusRef?.current;
    if (
      preferred != null &&
      dialog.contains(preferred) &&
      focusElementSafe(preferred)
    ) {
      // focused caller-specified element
    } else {
      const bodyFocusable = getFocusableElements(bodyRef.current)[0];
      const anyFocusable = bodyFocusable ?? getFocusableElements(dialog)[0];
      if (!focusElementSafe(anyFocusable)) {
        focusElementSafe(dialog);
      }
    }

    return () => {
      dialog.removeEventListener("cancel", handleCancel);
      if (typeof dialog.showModal !== "function") {
        document.removeEventListener("keydown", handleKeydown, true);
      }
      unregisterOverlayDialog(dialog);
      closeNativeDialog(dialog);
      restoreFocusSafe(previousFocus, dialog);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (dialog === null) return;

    const syncFooterHeight = () => {
      const footerEl = footerRef.current;
      if (footerEl === null) {
        dialog.style.setProperty("--omni-drawer-footer-height", "0px");
        return;
      }
      const rectHeight = footerEl.getBoundingClientRect().height;
      const measured = rectHeight > 0 ? rectHeight : footerEl.offsetHeight;
      if (measured > 0) {
        dialog.style.setProperty("--omni-drawer-footer-height", `${Math.ceil(measured)}px`);
      } else {
        dialog.style.removeProperty("--omni-drawer-footer-height");
      }
    };

    syncFooterHeight();
    if (typeof ResizeObserver !== "function" || footerRef.current === null) return;
    const observer = new ResizeObserver(syncFooterHeight);
    observer.observe(footerRef.current);
    return () => observer.disconnect();
  }, [open, footer]);

  const classes = [
    "omni-ui-tokens",
    "omni-ui-drawer",
    `omni-ui-drawer--${size}`,
    `omni-ui-drawer--${placement}`,
  ];
  if (className !== "") classes.push(className);

  return (
    <dialog
      ref={dialogRef}
      className={classes.join(" ")}
      aria-labelledby={titleId}
      aria-describedby={hasDesc ? descId : undefined}
      data-testid={props["data-testid"]}
      data-busy={busy ? "true" : undefined}
      data-loading={loading ? "true" : undefined}
      tabIndex={-1}
      onMouseDown={(event) => {
        mouseDownOnBackdropRef.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        const startedOnBackdrop = mouseDownOnBackdropRef.current;
        mouseDownOnBackdropRef.current = null;
        if (event.target !== event.currentTarget) return;
        if (startedOnBackdrop === false) return;
        if (dismissible && !busy) onClose("backdrop");
      }}
    >
      <div className="omni-ui-drawerSurface">
        <div className="omni-ui-drawerHandle" aria-hidden="true" />
        <header className="omni-ui-drawerHeader">
          <div className="omni-ui-drawerHeadText">
            {hasEyebrow ? <span className="omni-ui-drawerEyebrow">{eyebrow}</span> : null}
            {props.badge !== undefined && props.badge !== null && props.badge !== false ? (
              <div className="omni-ui-drawerTitleRow">
                <h2 id={titleId} className="omni-ui-drawerTitle">{title}</h2>
                {props.badge}
              </div>
            ) : (
              <h2 id={titleId} className="omni-ui-drawerTitle">{title}</h2>
            )}
            {hasDesc ? <p id={descId} className="omni-ui-drawerDesc">{description}</p> : null}
          </div>
          <button
            type="button"
            className="omni-ui-overlayClose"
            aria-label={closeLabel}
            disabled={busy}
            onClick={() => {
              if (!busy) onClose("close-button");
            }}
          >
            ×
          </button>
        </header>
        <div
          ref={bodyRef}
          className="omni-ui-drawerBody"
          aria-busy={loading ? "true" : undefined}
        >
          {loading ? <Skeleton lines={4} /> : children}
        </div>
        {footer !== undefined && footer !== null && footer !== false ? (
          <footer ref={footerRef} className="omni-ui-drawerFooter">{footer}</footer>
        ) : null}
      </div>
    </dialog>
  );
}
