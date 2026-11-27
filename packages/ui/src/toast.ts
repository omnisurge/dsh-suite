/**
 * Toast track（README「系统提示双轨」）：视口中下浮动条，弱遮挡，栈叠上限
 * TOAST_STACK_LIMIT（同 kind 替换，超限逐最旧）。命令式 body 挂载——client
 * 运行时模块表只有 react / react/jsx-runtime（无 react-dom），无法 portal /
 * createRoot；React 消费方用 effect 包一层即可。
 */

import {
  TOAST_ICON_SPECS,
  toastEvictCount,
  toastReplaceIndex,
  toastToneClassName,
  toastToneDurationMs,
} from "./notify-core.js";
import { injectStyles } from "./styles.js";
import { documentOwner } from "./document-owner.js";
import { focusElementSafe, getFocusableElements } from "./overlay-shared.js";
import { subscribeOverlayStack, topmostDialog } from "./overlay-stack.js";

export type ToastTone = "neutral" | "ok" | "warn" | "danger" | "loading";

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
  /** Auto-dismiss ms; `null` (or `<= 0`) = sticky until × / code. Defaults: `ok` 4000ms, `loading` null, others 6000ms. */
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

type PopoverHostElement = HTMLDivElement & {
  showPopover?: () => void;
  hidePopover?: () => void;
};

interface ToastEntry {
  node: HTMLDivElement;
  kind: string | undefined;
  timer: ReturnType<typeof setTimeout> | null;
  remainingMs: number | null;
  startedAt: number;
  paused: boolean;
  hovered: boolean;
  focused: boolean;
  onClose: ((reason: ToastCloseReason) => void) | undefined;
  closed: boolean;
}

export const TOAST_HOST_CLASS = "omni-ui-toastHost";

/** State scoped per `Document` so multiple bundles share one toast stack & host cleanly without leaking across documents in tests. */
interface ToastStore {
  entries: ToastEntry[];
  host: PopoverHostElement | null;
  unsubOverlay: (() => void) | null;
  focusTrackingAttached: boolean;
  lastFocusInDialog: HTMLElement | null;
}

const SVG_NS = "http://www.w3.org/2000/svg";

function createToastController(ownerDoc: Document): { show: (spec: ToastSpec) => ToastHandle; close: () => void } {
  /** Newest first — mirrors DOM order (prepend = visually on top). */
  const store: ToastStore = {
    entries: [],
    host: null,
    unsubOverlay: null,
    focusTrackingAttached: false,
    lastFocusInDialog: null,
  };

  function onDocumentFocusIn(event: FocusEvent): void {
    if (typeof document === "undefined" || document !== ownerDoc || typeof HTMLElement === "undefined") return;
    const top = topmostDialog();
    if (top === null || !top.isConnected) return;
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (!top.contains(target)) return;
    if (store.host !== null && store.host.contains(target)) return;
    store.lastFocusInDialog = target;
  }

  function syncHostMount(): void {
    if (store.host === null || typeof document === "undefined" || document !== ownerDoc) return;
    const top = topmostDialog();
    const parent = top !== null && top.isConnected ? top : ownerDoc.body;
    if (parent === null) return;
    if (store.host.parentElement !== parent) {
      hidePopoverSafe(store.host);
      parent.appendChild(store.host);
    }
    if (store.entries.length > 0) {
      showPopoverSafe(store.host);
    }
  }

  function ensureHost(): PopoverHostElement {
    injectStyles();
    if (store.host === null || !store.host.isConnected) {
      const el = ownerDoc.createElement("div") as PopoverHostElement;
      el.className = TOAST_HOST_CLASS;
      el.setAttribute("popover", "manual");
      store.host = el;
    }
    if (store.unsubOverlay === null) {
      store.unsubOverlay = subscribeOverlayStack(() => {
        if (typeof document === "undefined") return;
        if (topmostDialog() === null) store.lastFocusInDialog = null;
        syncHostMount();
      });
    }
    if (!store.focusTrackingAttached) {
      ownerDoc.addEventListener("focusin", onDocumentFocusIn, true);
      store.focusTrackingAttached = true;
    }
    syncHostMount();
    return store.host;
  }

  function dropHostIfEmpty(): void {
    if (store.entries.length === 0 && store.host !== null) {
      hidePopoverSafe(store.host);
      store.host.remove();
      store.host = null;
      store.lastFocusInDialog = null;
      if (store.unsubOverlay !== null) {
        store.unsubOverlay();
        store.unsubOverlay = null;
      }
      if (store.focusTrackingAttached) {
        ownerDoc.removeEventListener("focusin", onDocumentFocusIn, true);
        store.focusTrackingAttached = false;
      }
    }
  }

  function restoreFocusToTopDialog(removingNode: HTMLElement, forceRestore: boolean): void {
    if (typeof document === "undefined" || document !== ownerDoc || ownerDoc.defaultView === null || typeof Node === "undefined") {
      return;
    }
    const top = topmostDialog();
    if (top === null || !top.isConnected) return;
    const active = ownerDoc.activeElement;
    const focusInRemoving = active instanceof Node && removingNode.contains(active);
    const focusDropped = forceRestore && (active === null || active === ownerDoc.body);
    if (!focusInRemoving && !focusDropped) return;

    if (
      store.lastFocusInDialog !== null &&
      store.lastFocusInDialog.isConnected &&
      top.contains(store.lastFocusInDialog) &&
      (store.host === null || !store.host.contains(store.lastFocusInDialog)) &&
      focusElementSafe(store.lastFocusInDialog)
    ) {
      return;
    }

    const candidate = getFocusableElements(top).find((el) => store.host === null || !store.host.contains(el));
    if (!focusElementSafe(candidate)) {
      focusElementSafe(top);
    }
  }

  function startEntryTimer(entry: ToastEntry): void {
    if (entry.closed || entry.remainingMs === null || entry.paused) return;
    if (entry.timer !== null) clearTimeout(entry.timer);
    entry.startedAt = Date.now();
    entry.timer = setTimeout(() => closeEntry(entry, "timeout"), entry.remainingMs);
  }

  function pauseEntryTimer(entry: ToastEntry): void {
    if (entry.closed || entry.remainingMs === null || entry.paused) return;
    entry.paused = true;
    if (entry.timer !== null) {
      clearTimeout(entry.timer);
      entry.timer = null;
      const elapsed = Math.max(0, Date.now() - entry.startedAt);
      entry.remainingMs = Math.max(16, entry.remainingMs - elapsed);
    }
  }

  function resumeEntryTimer(entry: ToastEntry): void {
    if (entry.closed || entry.remainingMs === null || entry.hovered || entry.focused) return;
    entry.paused = false;
    startEntryTimer(entry);
  }

  function closeEntry(entry: ToastEntry, reason: ToastCloseReason, forceFocusRestore = false): void {
    if (entry.closed) return;
    entry.closed = true;
    if (entry.timer !== null) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }
    if (reason !== "replaced") {
      restoreFocusToTopDialog(entry.node, forceFocusRestore);
    }
    entry.node.remove();
    store.entries = store.entries.filter((candidate) => candidate !== entry);
    dropHostIfEmpty();
    try {
      entry.onClose?.(reason);
    } catch {
      // consumer callback must not break the stack
    }
  }

  function buildNode(spec: ToastSpec, entry: ToastEntry, sticky: boolean): HTMLDivElement {
    const tone: ToastTone = spec.tone ?? "neutral";
    const node = ownerDoc.createElement("div");
    node.className = toastToneClassName(tone);

    if (tone === "danger") {
      node.setAttribute("role", "alert");
      node.setAttribute("aria-live", "assertive");
    } else {
      node.setAttribute("role", "status");
      node.setAttribute("aria-live", "polite");
    }
    if (tone === "loading") {
      node.setAttribute("aria-busy", "true");
    }

    const icon = buildToastIconNode(ownerDoc, tone);
    if (icon !== null) node.appendChild(icon);

    const text = ownerDoc.createElement("span");
    text.className = "omni-ui-toastText";
    text.textContent = spec.text;
    node.appendChild(text);

    if (spec.action !== undefined) {
      const run = spec.action.run;
      const action = ownerDoc.createElement("button");
      action.type = "button";
      action.className = "omni-ui-toastAction";
      action.textContent = spec.action.label;
      action.addEventListener("click", () => {
        const activeBeforeRun = ownerDoc.activeElement;
        try {
          run();
        } finally {
          const activeAfterRun = ownerDoc.activeElement;
          const focusMovedOutsideToast =
            activeAfterRun !== activeBeforeRun &&
            activeAfterRun !== null &&
            activeAfterRun !== ownerDoc.body &&
            !node.contains(activeAfterRun);
          closeEntry(entry, "action", !focusMovedOutsideToast);
        }
      });
      node.appendChild(action);
    }

    if (spec.showClose !== false || sticky) {
      const close = ownerDoc.createElement("button");
      close.type = "button";
      close.className = "omni-ui-toastClose";
      close.textContent = "×";
      close.setAttribute("aria-label", spec.closeLabel ?? "Dismiss");
      close.addEventListener("click", () => closeEntry(entry, "close", true));
      node.appendChild(close);
    }

    node.addEventListener("mouseenter", () => {
      entry.hovered = true;
      pauseEntryTimer(entry);
    });
    node.addEventListener("mouseleave", () => {
      entry.hovered = false;
      resumeEntryTimer(entry);
    });
    node.addEventListener("focusin", () => {
      entry.focused = true;
      pauseEntryTimer(entry);
    });
    node.addEventListener("focusout", (event) => {
      const related = event.relatedTarget;
      if (typeof Node !== "undefined" && related instanceof Node && node.contains(related)) return;
      entry.focused = false;
      resumeEntryTimer(entry);
    });

    return node;
  }

  function show(spec: ToastSpec): ToastHandle {
    if (typeof document === "undefined") return CLOSED_HANDLE;

    const duration = toastToneDurationMs(spec.tone, spec.durationMs);
    const entry: ToastEntry = {
      node: ownerDoc.createElement("div"),
      kind: spec.kind,
      timer: null,
      remainingMs: duration,
      startedAt: 0,
      paused: false,
      hovered: false,
      focused: false,
      onClose: spec.onClose,
      closed: false,
    };
    entry.node = buildNode(spec, entry, duration === null);

    const replaceAt = toastReplaceIndex(store.entries.map((candidate) => candidate.kind), spec.kind);
    if (replaceAt >= 0) {
      const previous = store.entries[replaceAt]!;
      const anchor = previous.node.nextSibling;
      closeEntry(previous, "replaced");
      store.entries.splice(Math.min(replaceAt, store.entries.length), 0, entry);
      const activeHost = ensureHost();
      activeHost.insertBefore(entry.node, anchor?.isConnected === true && anchor.parentNode === activeHost ? anchor : null);
    } else {
      for (let i = 0; i < toastEvictCount(store.entries.length); i += 1) {
        closeEntry(store.entries[store.entries.length - 1]!, "evicted");
      }
      store.entries.unshift(entry);
      ensureHost().prepend(entry.node);
    }

    startEntryTimer(entry);

    return {
      get closed() {
        return entry.closed;
      },
      close: () => closeEntry(entry, "code"),
    };
  }

  function close(): void {
    for (const entry of [...store.entries]) closeEntry(entry, "code");
  }

  return { show, close };
}

function hidePopoverSafe(element: PopoverHostElement): void {
  if (typeof element.hidePopover !== "function") return;
  let open = true;
  try {
    open = element.matches(":popover-open");
  } catch {
    open = true;
  }
  if (!open) return;
  try {
    element.hidePopover();
  } catch {
    // Ignore when already closed or running in a partial popover shim.
  }
}

function showPopoverSafe(element: PopoverHostElement): void {
  if (typeof element.showPopover !== "function") return;
  let open = false;
  try {
    open = element.matches(":popover-open");
  } catch {
    open = false;
  }
  if (open) return;
  try {
    element.showPopover();
  } catch {
    // Fallback z-index positioning remains active if top-layer promotion throws.
  }
}

function buildToastIconNode(ownerDoc: Document, tone: ToastTone): HTMLSpanElement | null {
  if (tone === "neutral") return null;
  const wrap = ownerDoc.createElement("span");
  wrap.className = `omni-ui-toastIcon omni-ui-toastIcon--${tone}`;
  wrap.setAttribute("aria-hidden", "true");

  if (tone === "loading") {
    const spinner = ownerDoc.createElement("span");
    spinner.className = "omni-ui-toastSpinner";
    wrap.appendChild(spinner);
    return wrap;
  }

  const spec = TOAST_ICON_SPECS[tone];
  const svg = ownerDoc.createElementNS(SVG_NS, "svg");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("fill", "none");

  for (const c of spec.circles) {
    const circle = ownerDoc.createElementNS(SVG_NS, "circle");
    circle.setAttribute("cx", c.cx);
    circle.setAttribute("cy", c.cy);
    circle.setAttribute("r", c.r);
    if (c.fill !== undefined) circle.setAttribute("fill", c.fill);
    if (c.strokeWidth !== undefined) {
      circle.setAttribute("stroke", "currentColor");
      circle.setAttribute("stroke-width", c.strokeWidth);
    }
    svg.appendChild(circle);
  }
  for (const p of spec.paths) {
    const path = ownerDoc.createElementNS(SVG_NS, "path");
    path.setAttribute("d", p.d);
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", p.strokeWidth);
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    svg.appendChild(path);
  }
  wrap.appendChild(svg);
  return wrap;
}

const CLOSED_HANDLE: ToastHandle = { closed: true, close: () => undefined };

/**
 * Float a toast bottom-center. Same `kind` replaces in place; the stack keeps
 * at most TOAST_STACK_LIMIT toasts (oldest evicted).
 */
export function showToast(spec: ToastSpec): ToastHandle {
  if (typeof document === "undefined") return CLOSED_HANDLE;
  return documentOwner("toast", () => createToastController(document)).show(spec);
}

/** Close every open toast (reason `code`) — for consumer effect disposal. */
export function closeAllToasts(): void {
  if (typeof document === "undefined") return;
  documentOwner("toast", () => createToastController(document)).close();
}
