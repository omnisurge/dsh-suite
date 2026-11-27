import { useEffect, useId, useRef } from "react";
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

export interface DialogProps extends OverlayBaseProps {
  /** Use `"alertdialog"` for destructive or irreversible confirmations. Default `"dialog"`. */
  readonly role?: "dialog" | "alertdialog";
  /** Show top-right close button. Defaults to `false` for `alertdialog`, `true` for `dialog`. */
  readonly showClose?: boolean;
}

function hasTextOrNode(value: unknown): boolean {
  return value !== undefined && value !== null && value !== false && value !== "";
}

/** Native `<dialog>` centered modal dialog (`dialog` | `alertdialog`). Zero react-dom. */
export function Dialog(props: DialogProps) {
  const {
    open,
    onClose,
    title,
    description,
    closeLabel,
    size = "sm",
    role = "dialog",
    showClose = role !== "alertdialog",
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

  const hasDesc = hasTextOrNode(description);
  const hasBody = loading || (children !== undefined && children !== null && children !== false);
  const hasFooter = footer !== undefined && footer !== null && footer !== false;

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
      // focused caller-specified safe control
    } else if (role === "alertdialog") {
      const safeFooterTarget = getFocusableElements(footerRef.current)[0];
      const fallbackTarget = safeFooterTarget ?? getFocusableElements(dialog)[0];
      if (!focusElementSafe(fallbackTarget)) {
        focusElementSafe(dialog);
      }
    } else {
      const bodyTarget = getFocusableElements(bodyRef.current)[0];
      const fallbackTarget = bodyTarget ?? getFocusableElements(dialog)[0];
      if (!focusElementSafe(fallbackTarget)) {
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
  }, [open, role]);

  const classes = ["omni-ui-tokens", "omni-ui-dialog", `omni-ui-dialog--${size}`];
  if (className !== "") classes.push(className);

  return (
    <dialog
      ref={dialogRef}
      role={role}
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
      <div className="omni-ui-dialogSurface">
        <header className="omni-ui-dialogHeader">
          <h2 id={titleId} className="omni-ui-dialogTitle">{title}</h2>
          {showClose ? (
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
          ) : null}
        </header>
        {hasDesc ? <p id={descId} className="omni-ui-dialogDesc">{description}</p> : null}
        {hasBody ? (
          <div
            ref={bodyRef}
            className="omni-ui-dialogBody"
            aria-busy={loading ? "true" : undefined}
          >
            {loading ? <Skeleton lines={3} /> : children}
          </div>
        ) : null}
        {hasFooter ? <footer ref={footerRef} className="omni-ui-dialogFooter">{footer}</footer> : null}
      </div>
    </dialog>
  );
}
