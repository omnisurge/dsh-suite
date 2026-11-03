/**
 * Busy overlay: blocking process chrome, not a confirm and not a toast.
 * No cancel, no Esc, no scrim click. One at a time; a newer call silently
 * replaces the previous. Imperative body mount (same reason as toast/confirm:
 * no react-dom in the client module table).
 */

import { injectStyles } from "./styles.js";

export interface BusyOverlaySpec {
  readonly text: string;
}

export interface BusyOverlayHandle {
  readonly closed: boolean;
  close(): void;
}

export const BUSY_SCRIM_CLASS = "omni-ui-busyScrim";

let active: { close: () => void } | null = null;

const CLOSED_HANDLE: BusyOverlayHandle = { closed: true, close: () => undefined };

/** Open the blocking busy overlay. Only one lives at a time. */
export function showBusyOverlay(spec: BusyOverlaySpec): BusyOverlayHandle {
  if (typeof document === "undefined") return CLOSED_HANDLE;
  injectStyles();
  active?.close();

  const scrim = document.createElement("div");
  scrim.className = BUSY_SCRIM_CLASS;

  const card = document.createElement("div");
  card.className = "omni-ui-busy";
  card.setAttribute("role", "status");
  card.setAttribute("aria-live", "polite");
  card.setAttribute("aria-busy", "true");

  const spin = document.createElement("div");
  spin.className = "omni-ui-busySpin";
  spin.setAttribute("aria-hidden", "true");

  const text = document.createElement("p");
  text.className = "omni-ui-busyText";
  text.textContent = spec.text;

  card.append(spin, text);
  scrim.appendChild(card);

  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    if (active !== null && active.close === close) active = null;
    scrim.remove();
  };

  active = { close };
  document.body.appendChild(scrim);

  return {
    get closed() {
      return closed;
    },
    close,
  };
}

/** Silent teardown for plugin dispose. */
export function closeBusyOverlay(): void {
  active?.close();
}
