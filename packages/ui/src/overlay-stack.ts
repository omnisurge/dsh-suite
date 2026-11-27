/**
 * Shared stack of active modal `<dialog>` elements so imperative overlays
 * (ToastHost) can migrate into the topmost open modal dialog without being
 * blocked by native `showModal()` `inert` behaviour.
 */

import { documentOwner } from "./document-owner.js";

export type OverlayStackListener = (top: HTMLDialogElement | null) => void;

interface OverlayStackStore {
  readonly stack: HTMLDialogElement[];
  readonly listeners: Set<OverlayStackListener>;
  savedBodyOverflow: string | null;
  bodyScrollLocked: boolean;
}

function createStore(): OverlayStackStore {
  return {
    stack: [],
    listeners: new Set(),
    savedBodyOverflow: null,
    bodyScrollLocked: false,
  };
}

let fallbackStore: OverlayStackStore | null = null;

function getStore(): OverlayStackStore {
  if (typeof document !== "undefined") {
    return documentOwner("overlay-stack", createStore);
  }
  if (fallbackStore === null) fallbackStore = createStore();
  return fallbackStore;
}

function syncBodyScrollLock(store: OverlayStackStore): void {
  if (typeof document === "undefined" || !document.body) return;
  if (store.stack.length > 0) {
    if (!store.bodyScrollLocked) {
      store.savedBodyOverflow = document.body.style.overflow;
      store.bodyScrollLocked = true;
    }
    document.body.style.overflow = "hidden";
    document.body.dataset.omniScrollLocked = "true";
    return;
  }
  if (store.bodyScrollLocked) {
    if (store.savedBodyOverflow !== null && store.savedBodyOverflow !== "") {
      document.body.style.overflow = store.savedBodyOverflow;
    } else {
      document.body.style.removeProperty("overflow");
    }
    delete document.body.dataset.omniScrollLocked;
    store.savedBodyOverflow = null;
    store.bodyScrollLocked = false;
  }
}

function notify(store: OverlayStackStore): void {
  const top = store.stack.length > 0 ? store.stack[store.stack.length - 1]! : null;
  for (const listener of [...store.listeners]) {
    try {
      listener(top);
    } catch {
      // Subscriber errors must not prevent other overlay listeners or teardown.
    }
  }
}

/** Return the topmost active modal `<dialog>`, or `null` when none is open. */
export function topmostDialog(): HTMLDialogElement | null {
  const store = getStore();
  return store.stack.length > 0 ? store.stack[store.stack.length - 1]! : null;
}

/** Subscribe to active topmost `<dialog>` changes; returns an idempotent unsubscribe function. */
export function subscribeOverlayStack(listener: OverlayStackListener): () => void {
  const store = getStore();
  store.listeners.add(listener);
  return () => {
    store.listeners.delete(listener);
  };
}

/** Push a modal `<dialog>` onto the active stack (idempotent for duplicates). */
export function registerOverlayDialog(dialog: HTMLDialogElement): void {
  const store = getStore();
  if (store.stack.includes(dialog)) return;
  store.stack.push(dialog);
  syncBodyScrollLock(store);
  notify(store);
}

/** Remove a modal `<dialog>` from the active stack and notify subscribers. */
export function unregisterOverlayDialog(dialog: HTMLDialogElement): void {
  const store = getStore();
  const index = store.stack.indexOf(dialog);
  if (index < 0) return;
  store.stack.splice(index, 1);
  syncBodyScrollLock(store);
  notify(store);
}
