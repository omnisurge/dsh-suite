/**
 * 确认幕（README「系统提示双轨」）：半透明遮罩 + 居中卡片，必须「取消 +
 * 主操作」。命令式 body 挂载（同 toast.ts 的 react-dom 缺席理由）；React
 * 消费方在 effect 里 showConfirm / handle.close()。同屏一次只一张：新开
 * 顶掉旧的，旧的按取消收场。
 */

import { trapNextIndex } from "./notify-core.js";
import { injectStyles } from "./styles.js";
import { documentOwner } from "./document-owner.js";
import {
  closeNativeDialog,
  focusElementSafe,
  getFocusableElements,
  openNativeDialog,
  restoreFocusSafe,
} from "./overlay-shared.js";
import { registerOverlayDialog, topmostDialog, unregisterOverlayDialog } from "./overlay-stack.js";

export type ConfirmTone = "default" | "danger";

/** One row of the optional detail list (e.g. active sessions). */
export interface ConfirmListItem {
  readonly primary: string;
  readonly secondary?: string;
  readonly meta?: string;
}

export interface ConfirmSpec {
  readonly title: string;
  /** Optional paragraph under the title. */
  readonly text?: string;
  /** Optional detail list rendered between text and actions. */
  readonly items?: readonly ConfirmListItem[];
  readonly cancelLabel: string;
  readonly confirmLabel: string;
  /** `danger` styles the primary action as destructive. */
  readonly tone?: ConfirmTone;
  /** Allow backdrop clicks to cancel. Default `true`. */
  readonly dismissOnBackdrop?: boolean;
  /** Disable actions and block Esc / backdrop dismissal while submitting. */
  readonly busy?: boolean;
  /** Explicit element to restore focus to when closed (defaults to previous active element). */
  readonly returnFocusTo?: HTMLElement | null;
  /** Esc / scrim click / cancel button / replaced by a newer confirm. */
  readonly onCancel?: () => void;
  readonly onConfirm?: () => void;
}

export interface ConfirmHandle {
  readonly closed: boolean;
  /** Silent teardown — no onCancel/onConfirm (for React effect cleanup). */
  close(): void;
}

export const CONFIRM_SCRIM_CLASS = "omni-ui-confirmScrim";

interface ActiveConfirm {
  resolve: (kind: "cancel" | "confirm" | "silent") => void;
}

interface ConfirmStore {
  active: ActiveConfirm | null;
  seq: number;
}

const CLOSED_HANDLE: ConfirmHandle = { closed: true, close: () => undefined };

function createConfirmController(): (spec: ConfirmSpec) => ConfirmHandle {
  const store: ConfirmStore = { active: null, seq: 0 };
  const open = (spec: ConfirmSpec): ConfirmHandle => {
    if (typeof document === "undefined") return CLOSED_HANDLE;
    injectStyles();
    store.active?.resolve("cancel");

    store.seq += 1;
    const titleId = `omni-ui-confirm-title-${store.seq}`;
    const textId = spec.text !== undefined ? `omni-ui-confirm-text-${store.seq}` : undefined;
    const isBusy = spec.busy === true;
    const dismissOnBackdrop = spec.dismissOnBackdrop !== false;

    const scrim = document.createElement("dialog");
    scrim.className = `${CONFIRM_SCRIM_CLASS} omni-ui-tokens`;
    scrim.setAttribute("role", "alertdialog");
    scrim.setAttribute("aria-modal", "true");
    scrim.setAttribute("aria-labelledby", titleId);
    if (textId !== undefined) scrim.setAttribute("aria-describedby", textId);
    if (isBusy) scrim.setAttribute("data-busy", "true");
    scrim.tabIndex = -1;

    const card = document.createElement("div");
    card.className = "omni-ui-confirm";

    const title = document.createElement("h2");
    title.id = titleId;
    title.className = "omni-ui-confirmTitle";
    title.textContent = spec.title;
    card.appendChild(title);

    if (spec.text !== undefined && textId !== undefined) {
      const text = document.createElement("p");
      text.id = textId;
      text.className = "omni-ui-confirmText";
      text.textContent = spec.text;
      card.appendChild(text);
    }

    if (spec.items !== undefined && spec.items.length > 0) {
      const list = document.createElement("ul");
      list.className = "omni-ui-confirmList";
      for (const item of spec.items) {
        const row = document.createElement("li");
        row.className = "omni-ui-confirmItem";
        const primary = document.createElement("span");
        primary.className = "omni-ui-confirmItemPrimary";
        primary.textContent = item.primary;
        row.appendChild(primary);
        if (item.secondary !== undefined) {
          const secondary = document.createElement("span");
          secondary.className = "omni-ui-confirmItemSecondary";
          secondary.textContent = item.secondary;
          row.appendChild(secondary);
        }
        if (item.meta !== undefined) {
          const meta = document.createElement("span");
          meta.className = "omni-ui-confirmItemMeta";
          meta.textContent = item.meta;
          row.appendChild(meta);
        }
        list.appendChild(row);
      }
      card.appendChild(list);
    }

    const actions = document.createElement("div");
    actions.className = "omni-ui-confirmActions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "omni-ui-btn";
    cancel.textContent = spec.cancelLabel;
    if (isBusy) cancel.disabled = true;

    const confirm = document.createElement("button");
    confirm.type = "button";
    confirm.className =
      spec.tone === "danger" ? "omni-ui-btn omni-ui-btnDanger" : "omni-ui-btn omni-ui-btnPrimary";
    confirm.textContent = spec.confirmLabel;
    if (isBusy) {
      confirm.disabled = true;
      confirm.setAttribute("aria-busy", "true");
    }
    actions.append(cancel, confirm);
    card.appendChild(actions);
    scrim.appendChild(card);

    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    let closed = false;
    let mouseDownOnBackdrop: boolean | null = null;

    const onCancelEvent = (event: Event): void => {
      event.preventDefault();
      if (!isBusy) resolve("cancel");
    };

    const onKeydown = (event: KeyboardEvent): void => {
      if (topmostDialog() !== scrim) return;
      if (event.key === "Escape") {
        if (typeof scrim.showModal === "function") return;
        event.preventDefault();
        event.stopPropagation();
        if (!isBusy) resolve("cancel");
        return;
      }
      if (event.key !== "Tab" || typeof scrim.showModal === "function") return;
      const stops = getFocusableElements(card);
      const current = stops.findIndex((element) => element === document.activeElement);
      const next = trapNextIndex(stops.length, current, event.shiftKey);
      if (next < 0) return;
      event.preventDefault();
      stops[next]?.focus();
    };

    const resolve = (kind: "cancel" | "confirm" | "silent"): void => {
      if (closed) return;
      closed = true;
      if (store.active !== null && store.active.resolve === resolve) store.active = null;
      scrim.removeEventListener("cancel", onCancelEvent);
      if (typeof scrim.showModal !== "function") {
        document.removeEventListener("keydown", onKeydown, true);
      }
      unregisterOverlayDialog(scrim);
      closeNativeDialog(scrim);
      scrim.remove();
      const restoreTarget =
        spec.returnFocusTo !== undefined ? spec.returnFocusTo : previousFocus;
      restoreFocusSafe(restoreTarget, scrim);
      try {
        if (kind === "cancel") spec.onCancel?.();
        else if (kind === "confirm") spec.onConfirm?.();
      } catch {
        // consumer callback must not leave a dead scrim behind
      }
    };

    cancel.addEventListener("click", () => {
      if (!isBusy) resolve("cancel");
    });
    confirm.addEventListener("click", () => {
      if (!isBusy) resolve("confirm");
    });
    scrim.addEventListener("mousedown", (event) => {
      mouseDownOnBackdrop = event.target === scrim;
    });
    scrim.addEventListener("click", (event) => {
      const startedOnBackdrop = mouseDownOnBackdrop;
      mouseDownOnBackdrop = null;
      if (event.target !== scrim) return;
      if (startedOnBackdrop === false) return;
      if (dismissOnBackdrop && !isBusy) resolve("cancel");
    });
    scrim.addEventListener("cancel", onCancelEvent);
    if (typeof scrim.showModal !== "function") {
      document.addEventListener("keydown", onKeydown, true);
    }

    store.active = { resolve };
    document.body.appendChild(scrim);
    openNativeDialog(scrim);
    registerOverlayDialog(scrim);
    if (isBusy || !focusElementSafe(cancel)) {
      focusElementSafe(scrim);
    }

    return {
      get closed() {
        return closed;
      },
      close: () => resolve("silent"),
    };
  };
  return open;
}

/**
 * Open the modal confirm layer. Only one lives at a time — a newer call
 * cancels the previous one first.
 */
export function showConfirm(spec: ConfirmSpec): ConfirmHandle {
  if (typeof document === "undefined") return CLOSED_HANDLE;
  return documentOwner("confirm", createConfirmController)(spec);
}
