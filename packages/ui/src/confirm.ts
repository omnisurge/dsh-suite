/**
 * 确认幕（README「系统提示双轨」）：半透明遮罩 + 居中卡片，必须「取消 +
 * 主操作」。命令式 body 挂载（同 toast.ts 的 react-dom 缺席理由）；React
 * 消费方在 effect 里 showConfirm / handle.close()。同屏一次只一张：新开
 * 顶掉旧的，旧的按取消收场。
 */

import { trapNextIndex } from "./notify-core.js";
import { injectStyles } from "./styles.js";
import { documentOwner } from "./document-owner.js";

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

const FOCUSABLE =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

interface ActiveConfirm {
  resolve: (kind: "cancel" | "confirm" | "silent") => void;
}

let active: ActiveConfirm | null = null;
let confirmSeq = 0;

const CLOSED_HANDLE: ConfirmHandle = { closed: true, close: () => undefined };

/**
 * Open the modal confirm layer. Only one lives at a time — a newer call
 * cancels the previous one first.
 */
export function showConfirm(spec: ConfirmSpec): ConfirmHandle {
  if (typeof document === "undefined") return CLOSED_HANDLE;
  return documentOwner("confirm", () => openConfirm)(spec);
}

function openConfirm(spec: ConfirmSpec): ConfirmHandle {
  if (typeof document === "undefined") return CLOSED_HANDLE;
  injectStyles();
  active?.resolve("cancel");

  confirmSeq += 1;
  const titleId = `omni-ui-confirm-title-${confirmSeq}`;
  const textId = spec.text !== undefined ? `omni-ui-confirm-text-${confirmSeq}` : undefined;

  const scrim = document.createElement("div");
  scrim.className = CONFIRM_SCRIM_CLASS;

  const card = document.createElement("div");
  card.className = "omni-ui-confirm";
  card.setAttribute("role", "alertdialog");
  card.setAttribute("aria-modal", "true");
  card.setAttribute("aria-labelledby", titleId);
  if (textId !== undefined) card.setAttribute("aria-describedby", textId);

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
  const confirm = document.createElement("button");
  confirm.type = "button";
  confirm.className =
    spec.tone === "danger" ? "omni-ui-btn omni-ui-btnDanger" : "omni-ui-btn omni-ui-btnPrimary";
  confirm.textContent = spec.confirmLabel;
  actions.append(cancel, confirm);
  card.appendChild(actions);
  scrim.appendChild(card);

  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  let closed = false;

  const resolve = (kind: "cancel" | "confirm" | "silent"): void => {
    if (closed) return;
    closed = true;
    if (active !== null && active.resolve === resolve) active = null;
    scrim.remove();
    document.removeEventListener("keydown", onKeydown, true);
    if (previousFocus !== null && previousFocus.isConnected) {
      try {
        previousFocus.focus();
      } catch {
        /* focus restore is best-effort */
      }
    }
    try {
      if (kind === "cancel") spec.onCancel?.();
      else if (kind === "confirm") spec.onConfirm?.();
    } catch {
      // consumer callback must not leave a dead scrim behind
    }
  };

  const onKeydown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      resolve("cancel");
      return;
    }
    if (event.key !== "Tab") return;
    const stops = Array.from(card.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (element) => !element.hasAttribute("disabled"),
    );
    const current = stops.findIndex((element) => element === document.activeElement);
    const next = trapNextIndex(stops.length, current, event.shiftKey);
    if (next < 0) return;
    event.preventDefault();
    stops[next]?.focus();
  };

  cancel.addEventListener("click", () => resolve("cancel"));
  confirm.addEventListener("click", () => resolve("confirm"));
  scrim.addEventListener("mousedown", (event) => {
    if (event.target === scrim) resolve("cancel");
  });
  document.addEventListener("keydown", onKeydown, true);

  active = { resolve };
  document.body.appendChild(scrim);
  cancel.focus();

  return {
    get closed() {
      return closed;
    },
    close: () => resolve("silent"),
  };
}
