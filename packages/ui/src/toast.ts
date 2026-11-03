/**
 * Toast track（README「系统提示双轨」）：视口中下浮动条，弱遮挡，栈叠上限
 * TOAST_STACK_LIMIT（同 kind 替换，超限逐最旧）。命令式 body 挂载——client
 * 运行时模块表只有 react / react/jsx-runtime（无 react-dom），无法 portal /
 * createRoot；React 消费方用 effect 包一层即可。
 */

import { toastDurationMs, toastEvictCount, toastReplaceIndex } from "./notify-core.js";
import { injectStyles } from "./styles.js";
import { documentOwner } from "./document-owner.js";

export type ToastTone = "neutral" | "warn" | "danger";

export type ToastCloseReason =
  | "timeout"
  | "close"
  | "action"
  | "replaced"
  | "evicted"
  | "code";

export interface ToastAction {
  readonly label: string;
  readonly run: () => void;
}

export interface ToastSpec {
  readonly text: string;
  /** Same-kind toasts replace each other in place (合并同类). */
  readonly kind?: string;
  readonly tone?: ToastTone;
  /** Auto-dismiss ms; `null` (or `<= 0`) = sticky until × / code. Default 6000. */
  readonly durationMs?: number | null;
  /** Optional secondary action (Snackbar 感), closes the toast after running. */
  readonly action?: ToastAction;
  /** aria-label for the × button — pass localized copy. */
  readonly closeLabel?: string;
  /** Hide the × button (ignored for sticky toasts, which always keep it). */
  readonly showClose?: boolean;
  readonly onClose?: (reason: ToastCloseReason) => void;
}

export interface ToastHandle {
  readonly closed: boolean;
  close(): void;
}

interface ToastEntry {
  node: HTMLDivElement;
  kind: string | undefined;
  timer: ReturnType<typeof setTimeout> | null;
  onClose: ((reason: ToastCloseReason) => void) | undefined;
  closed: boolean;
}

export const TOAST_HOST_CLASS = "omni-ui-toastHost";

/** Newest first — mirrors DOM order (prepend = visually on top). */
let entries: ToastEntry[] = [];
let host: HTMLDivElement | null = null;

function ensureHost(): HTMLDivElement {
  injectStyles();
  if (host === null || !host.isConnected) {
    host = document.createElement("div");
    host.className = TOAST_HOST_CLASS;
    document.body.appendChild(host);
  }
  return host;
}

function dropHostIfEmpty(): void {
  if (entries.length === 0 && host !== null) {
    host.remove();
    host = null;
  }
}

function closeEntry(entry: ToastEntry, reason: ToastCloseReason): void {
  if (entry.closed) return;
  entry.closed = true;
  if (entry.timer !== null) clearTimeout(entry.timer);
  entry.node.remove();
  entries = entries.filter((candidate) => candidate !== entry);
  dropHostIfEmpty();
  try {
    entry.onClose?.(reason);
  } catch {
    // consumer callback must not break the stack
  }
}

function toneClass(tone: ToastTone | undefined): string {
  if (tone === "warn") return "omni-ui-toast omni-ui-toastWarn";
  if (tone === "danger") return "omni-ui-toast omni-ui-toastDanger";
  return "omni-ui-toast";
}

function buildNode(spec: ToastSpec, entry: ToastEntry, sticky: boolean): HTMLDivElement {
  const node = document.createElement("div");
  node.className = toneClass(spec.tone);
  node.setAttribute("role", "status");
  node.setAttribute("aria-live", "polite");

  const text = document.createElement("span");
  text.className = "omni-ui-toastText";
  text.textContent = spec.text;
  node.appendChild(text);

  if (spec.action !== undefined) {
    const run = spec.action.run;
    const action = document.createElement("button");
    action.type = "button";
    action.className = "omni-ui-toastAction";
    action.textContent = spec.action.label;
    action.addEventListener("click", () => {
      try {
        run();
      } finally {
        closeEntry(entry, "action");
      }
    });
    node.appendChild(action);
  }

  if (spec.showClose !== false || sticky) {
    const close = document.createElement("button");
    close.type = "button";
    close.className = "omni-ui-toastClose";
    close.textContent = "×";
    close.setAttribute("aria-label", spec.closeLabel ?? "Dismiss");
    close.addEventListener("click", () => closeEntry(entry, "close"));
    node.appendChild(close);
  }

  return node;
}

const CLOSED_HANDLE: ToastHandle = { closed: true, close: () => undefined };

/**
 * Float a toast bottom-center. Same `kind` replaces in place; the stack keeps
 * at most TOAST_STACK_LIMIT toasts (oldest evicted).
 */
export function showToast(spec: ToastSpec): ToastHandle {
  if (typeof document === "undefined") return CLOSED_HANDLE;
  return documentOwner("toast", () => ({ show: openToast, close: closeOwnedToasts })).show(spec);
}

function openToast(spec: ToastSpec): ToastHandle {
  if (typeof document === "undefined") return CLOSED_HANDLE;

  const entry: ToastEntry = {
    node: document.createElement("div"),
    kind: spec.kind,
    timer: null,
    onClose: spec.onClose,
    closed: false,
  };
  const duration = toastDurationMs(spec.durationMs);
  entry.node = buildNode(spec, entry, duration === null);

  const replaceAt = toastReplaceIndex(entries.map((candidate) => candidate.kind), spec.kind);
  if (replaceAt >= 0) {
    const previous = entries[replaceAt]!;
    const anchor = previous.node.nextSibling;
    closeEntry(previous, "replaced");
    ensureHost().insertBefore(entry.node, anchor?.isConnected === true ? anchor : null);
    entries.splice(Math.min(replaceAt, entries.length), 0, entry);
  } else {
    for (let i = 0; i < toastEvictCount(entries.length); i += 1) {
      closeEntry(entries[entries.length - 1]!, "evicted");
    }
    ensureHost().prepend(entry.node);
    entries.unshift(entry);
  }

  if (duration !== null) {
    entry.timer = setTimeout(() => closeEntry(entry, "timeout"), duration);
  }

  return {
    get closed() {
      return entry.closed;
    },
    close: () => closeEntry(entry, "code"),
  };
}

/** Close every open toast (reason `code`) — for consumer effect disposal. */
export function closeAllToasts(): void {
  if (typeof document === "undefined") return;
  documentOwner("toast", () => ({ show: openToast, close: closeOwnedToasts })).close();
}

function closeOwnedToasts(): void {
  for (const entry of [...entries]) closeEntry(entry, "code");
}
