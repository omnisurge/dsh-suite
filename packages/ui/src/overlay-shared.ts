import type { ReactNode, RefObject } from "react";

export type OverlayCloseReason = "escape" | "backdrop" | "close-button";
export type OverlaySize = "sm" | "md" | "lg";

export interface OverlayBaseProps {
  readonly open: boolean;
  /** Request-to-close callback (allows callers to intercept dirty forms). */
  readonly onClose: (reason: OverlayCloseReason) => void;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  /** Localized accessible label for the close button (e.g. "关闭"). */
  readonly closeLabel: string;
  readonly size?: OverlaySize;
  readonly footer?: ReactNode;
  /** Whether Escape and backdrop click can close the overlay. Default true (locked while `busy`). */
  readonly dismissible?: boolean;
  /** Lock close controls during blocking async submission. */
  readonly busy?: boolean;
  readonly loading?: boolean;
  readonly children?: ReactNode;
  readonly className?: string;
  readonly "data-testid"?: string;
  /** Optional ref for the initial element focused when the overlay opens. */
  readonly initialFocusRef?: RefObject<HTMLElement | null>;
}

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1']):not([disabled])",
].join(",");

/** Return enabled focusable elements inside a container in DOM order. */
export function getFocusableElements(root: HTMLElement | null): HTMLElement[] {
  if (root === null) return [];
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => !element.hasAttribute("disabled") && element.getAttribute("aria-disabled") !== "true",
  );
}

/** Open a `<dialog>` via native `showModal()` when available, falling back to `[open]` for jsdom/old runtimes. */
export function openNativeDialog(dialog: HTMLDialogElement): void {
  if (typeof dialog.showModal === "function") {
    if (!dialog.open) dialog.showModal();
    return;
  }
  dialog.setAttribute("open", "");
}

/** Close a `<dialog>` via native `close()` when available, falling back to removing `[open]`. */
export function closeNativeDialog(dialog: HTMLDialogElement): void {
  if (typeof dialog.close === "function") {
    if (dialog.open) dialog.close();
    return;
  }
  dialog.removeAttribute("open");
}

/** Safely focus an element if it is still connected and enabled. */
export function focusElementSafe(element: HTMLElement | null | undefined): boolean {
  if (element == null || !element.isConnected) return false;
  if (element.hasAttribute("disabled")) return false;
  try {
    element.focus({ preventScroll: true });
    return true;
  } catch {
    return false;
  }
}

/** Restore focus to the trigger element captured before opening an overlay. */
export function restoreFocusSafe(previous: HTMLElement | null, dialog?: HTMLElement | null): void {
  if (previous === null || !previous.isConnected) return;
  if (dialog != null && dialog.contains(previous)) return;
  focusElementSafe(previous);
}
