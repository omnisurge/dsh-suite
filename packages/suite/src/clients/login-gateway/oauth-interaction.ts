/**
 * Cordis-free OAuth interaction core (ADR-027).
 *
 * Secrets are memory-only. The authorization code is exposed exactly once by
 * waitForOAuthResult; this module does not log or persist interaction data.
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";

import { parseOAuthPreference, type OAuthPreference, type ResolvedOAuthPreference } from "../loopback.js";

export { parseOAuthPreference };
export type { OAuthPreference, ResolvedOAuthPreference };

export type LoginGatewayRequest = {
  key: string;
  authorizationUrl: string;
  redirectUri: string;
  timeoutMs?: number;
  prefer: OAuthPreference;
};

export type LoginGatewayResult =
  | { status: "authorized"; code: string; state?: string; redirectUri: string }
  | { status: "cancelled" }
  | { status: "failed"; code: string; message: string };

export type StartedOAuthInteraction = {
  ok: true;
  id: string;
  prefer: ResolvedOAuthPreference;
  authorizationUrl: string;
  redirectUri: string;
};

export type RejectedOAuthInteraction = {
  ok: false;
  result: Extract<LoginGatewayResult, { status: "failed" }>;
};

export type BeginOAuthInteractionResult =
  | StartedOAuthInteraction
  | RejectedOAuthInteraction;

export type SubmitOAuthCodeResult =
  | { accepted: true }
  | { accepted: false; code: string; message: string };

export interface OAuthRuntime {
  readonly platform: string;
  readonly env: Readonly<Record<string, string | undefined>>;
}

export interface BeginOAuthInteractionOptions {
  readonly runtime?: OAuthRuntime;
  readonly openBrowser?: (url: string) => void;
  /**
   * ADR-052 D4 / focus seam: fired once when an interaction reaches the authorized result, i.e. exactly when
   * the loopback callback lands (or a pasted code settles the same interaction). The Host uses it to bring the
   * application window back to the foreground, so the user sees "the row became connected" instead of a lone
   * browser tab. Deliberately a no-op unless a caller injects it: the official public seam for raising the
   * desktop window is still being confirmed, and this module must not guess one. Never awaited and never
   * fatal — an exception here must not change the OAuth result.
   */
  readonly onAuthorized?: (authorized: { code: string; state?: string }) => void;
}

interface LoopbackRedirect {
  host: "127.0.0.1";
  port: number;
  pathname: string;
}

interface PendingInteraction {
  readonly id: string;
  readonly request: LoginGatewayRequest;
  readonly prefer: ResolvedOAuthPreference;
  /** The per-begin options: only the injected seams are read back (ADR-052 D4 focus hook). */
  readonly options: BeginOAuthInteractionOptions;
  readonly expiresAt: number;
  readonly promise: Promise<LoginGatewayResult>;
  readonly resolve: (result: LoginGatewayResult) => void;
  timer: ReturnType<typeof setTimeout> | undefined;
  server?: Server;
  settled: boolean;
  waitClaimed: boolean;
}

type TombstoneReason = "consumed" | "expired";

const DEFAULT_TIMEOUT_MS = 300_000;
const MAX_TIMEOUT_MS = 600_000;
const TOMBSTONE_TTL_MS = 300_000;
const inFlight = new Set<string>();
const pending = new Map<string, PendingInteraction>();
const tombstones = new Map<string, { reason: TombstoneReason; deleteAfter: number }>();

export function resolveOAuthPreference(
  prefer: OAuthPreference,
  runtime: OAuthRuntime = { platform: process.platform, env: process.env },
): ResolvedOAuthPreference {
  if (prefer !== "auto") return prefer;
  if (runtime.platform === "darwin" || runtime.platform === "win32") {
    return "loopback";
  }
  if (
    runtime.platform === "linux"
    && (nonEmpty(runtime.env.DISPLAY) || nonEmpty(runtime.env.WAYLAND_DISPLAY))
  ) {
    return "loopback";
  }
  return "paste";
}

export function parseLoopbackRedirect(uri: string): LoopbackRedirect | undefined {
  try {
    const url = new URL(uri);
    if (url.protocol !== "http:") return undefined;
    if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
      return undefined;
    }
    const port = url.port === "" ? 80 : Number(url.port);
    if (!Number.isInteger(port) || port <= 0 || port > 65_535) return undefined;
    return {
      host: "127.0.0.1",
      port,
      pathname: url.pathname || "/",
    };
  } catch {
    return undefined;
  }
}

/**
 * Begin without waiting so a control-plane caller can receive the interaction
 * id and pass the original authorization URL to a person.
 */
export function beginOAuthInteraction(
  request: LoginGatewayRequest,
  options: BeginOAuthInteractionOptions = {},
): BeginOAuthInteractionResult {
  pruneTombstones();
  const invalid = validateRequest(request);
  if (invalid !== undefined) return { ok: false, result: invalid };
  if (inFlight.has(request.key)) {
    return {
      ok: false,
      result: {
        status: "failed",
        code: "in_flight",
        message: "authorization already in flight for this key",
      },
    };
  }

  const prefer = resolveOAuthPreference(request.prefer, options.runtime);
  const redirect = prefer === "loopback"
    ? parseLoopbackRedirect(request.redirectUri)
    : undefined;
  if (prefer === "loopback" && redirect === undefined) {
    return {
      ok: false,
      result: {
        status: "failed",
        code: "bad_redirect",
        message: "redirectUri must be http://127.0.0.1:<port>/…",
      },
    };
  }

  const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const id = randomBytes(18).toString("hex");
  let resolve!: (result: LoginGatewayResult) => void;
  const promise = new Promise<LoginGatewayResult>((done) => {
    resolve = done;
  });
  const entry: PendingInteraction = {
    id,
    request,
    prefer,
    options,
    expiresAt: Date.now() + timeoutMs,
    promise,
    resolve,
    timer: undefined,
    settled: false,
    waitClaimed: false,
  };
  entry.timer = setTimeout(() => {
    settle(entry, {
      status: "failed",
      code: "timeout",
      message: `authorization timed out after ${timeoutMs}ms`,
    }, "expired");
  }, timeoutMs);
  entry.timer.unref?.();
  pending.set(id, entry);
  inFlight.add(request.key);

  if (prefer === "loopback") {
    startLoopback(
      entry,
      redirect as LoopbackRedirect,
      options.openBrowser ?? openSystemBrowser,
    );
  }

  return {
    ok: true,
    id,
    prefer,
    authorizationUrl: request.authorizationUrl,
    redirectUri: request.redirectUri,
  };
}

/**
 * Stable ADR-027 / ADR-031 contract. Control-plane users call begin + wait;
 * direct users can await this convenience wrapper.
 */
export async function startOAuthInteraction(
  request: LoginGatewayRequest,
  options: BeginOAuthInteractionOptions = {},
): Promise<LoginGatewayResult> {
  const started = beginOAuthInteraction(request, options);
  if (!started.ok) return started.result;
  return waitForOAuthResult(started.id);
}

export function submitOAuthCode(
  id: string,
  submission: { code: string; state?: string },
): SubmitOAuthCodeResult {
  pruneTombstones();
  const entry = pending.get(id);
  if (entry === undefined) return rejectedForMissing(id);
  if (entry.settled) {
    return {
      accepted: false,
      code: "already_completed",
      message: "interaction is already complete",
    };
  }
  if (!nonEmpty(submission.code)) {
    return {
      accepted: false,
      code: "invalid_code",
      message: "code must be a non-empty string",
    };
  }
  settle(entry, {
    status: "authorized",
    code: submission.code,
    ...(nonEmpty(submission.state) ? { state: submission.state } : {}),
    redirectUri: entry.request.redirectUri,
  });
  return { accepted: true };
}

/** Abort a pending interaction by id so the next start can reuse the key. */
export function cancelOAuthInteraction(id: string): boolean {
  pruneTombstones();
  const entry = pending.get(id);
  if (entry === undefined || entry.settled) return false;
  settle(entry, { status: "cancelled" });
  return true;
}

/** Same as cancelOAuthInteraction, keyed by the caller-supplied business key. */
export function cancelOAuthInteractionByKey(key: string): boolean {
  pruneTombstones();
  for (const entry of pending.values()) {
    if (entry.request.key === key && !entry.settled) {
      settle(entry, { status: "cancelled" });
      return true;
    }
  }
  return false;
}

export async function waitForOAuthResult(id: string): Promise<LoginGatewayResult> {
  pruneTombstones();
  const entry = pending.get(id);
  if (entry === undefined) return missingWaitResult(id);
  if (entry.waitClaimed) {
    return {
      status: "failed",
      code: "wait_claimed",
      message: "interaction result has already been claimed",
    };
  }
  entry.waitClaimed = true;
  const result = await entry.promise;
  clearTimeout(entry.timer);
  if (pending.get(id) === entry) pending.delete(id);
  const reason = result.status === "failed" && result.code === "timeout"
    ? "expired"
    : "consumed";
  rememberTombstone(id, reason);
  return result;
}

/** Test-only isolation hook; production code has no reason to call it. */
export function resetPendingForTests(): void {
  for (const entry of pending.values()) {
    clearTimeout(entry.timer);
    closeServer(entry);
    if (!entry.settled) {
      entry.settled = true;
      entry.resolve({ status: "cancelled" });
    }
  }
  pending.clear();
  tombstones.clear();
  inFlight.clear();
}

/** Alias kept explicit so tests can assert both state classes are reset. */
export function resetInFlightForTests(): void {
  resetPendingForTests();
}

function validateRequest(
  request: LoginGatewayRequest,
): Extract<LoginGatewayResult, { status: "failed" }> | undefined {
  if (!nonEmpty(request.key)) return invalidRequest("key must be a non-empty string");
  if (!validAuthorizationUrl(request.authorizationUrl)) {
    return invalidRequest("authorizationUrl must be an http(s) URL");
  }
  if (!nonEmpty(request.redirectUri)) {
    return invalidRequest("redirectUri must be a non-empty string");
  }
  if (parseOAuthPreference(request.prefer) === undefined) {
    return invalidRequest("prefer must be loopback, paste, or auto");
  }
  if (
    request.timeoutMs !== undefined
    && (!Number.isInteger(request.timeoutMs)
      || request.timeoutMs <= 0
      || request.timeoutMs > MAX_TIMEOUT_MS)
  ) {
    return invalidRequest(`timeoutMs must be an integer from 1 to ${MAX_TIMEOUT_MS}`);
  }
  return undefined;
}

function invalidRequest(
  message: string,
): Extract<LoginGatewayResult, { status: "failed" }> {
  return { status: "failed", code: "invalid_request", message };
}

function validAuthorizationUrl(value: string): boolean {
  if (!nonEmpty(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function settle(
  entry: PendingInteraction,
  result: LoginGatewayResult,
  tombstone?: TombstoneReason,
): void {
  if (entry.settled) return;
  entry.settled = true;
  clearTimeout(entry.timer);
  inFlight.delete(entry.request.key);
  closeServer(entry);
  if (tombstone !== undefined) {
    if (pending.get(entry.id) === entry) pending.delete(entry.id);
    rememberTombstone(entry.id, tombstone);
  } else {
    const remaining = Math.max(1, entry.expiresAt - Date.now());
    entry.timer = setTimeout(() => {
      if (pending.get(entry.id) === entry) {
        pending.delete(entry.id);
        rememberTombstone(entry.id, "expired");
      }
    }, remaining);
    entry.timer.unref?.();
  }
  entry.resolve(result);
  if (result.status === "authorized") notifyAuthorized(entry, result);
}

/** ADR-052 D4 / focus seam: the one place an interaction is announced as authorized. The injected hook is
 * optional, never awaited and never allowed to change the result — the authorization already settled. */
function notifyAuthorized(
  entry: PendingInteraction,
  result: Extract<LoginGatewayResult, { status: "authorized" }>,
): void {
  const hook = entry.options.onAuthorized;
  if (hook === undefined) return;
  try {
    hook({
      code: result.code,
      ...(result.state !== undefined ? { state: result.state } : {}),
    });
  } catch {
    // A focus-raising hook that throws must not turn a completed authorization into a failure.
  }
}

function closeServer(entry: PendingInteraction): void {
  if (entry.server === undefined) return;
  const server = entry.server;
  entry.server = undefined;
  try {
    server.close();
  } catch {
    // The result path remains deterministic even if a listener already closed.
  }
}

function startLoopback(
  entry: PendingInteraction,
  redirect: LoopbackRedirect,
  openBrowser: (url: string) => void,
): void {
  const server = createServer((req, res) => {
    handleLoopbackCallback(entry, redirect, req, res);
  });
  entry.server = server;
  server.once("error", (error) => {
    settle(entry, {
      status: "failed",
      code: "listen_error",
      message: error.message,
    });
  });
  server.listen(redirect.port, redirect.host, () => {
    if (!entry.settled) openBrowser(entry.request.authorizationUrl);
  });
}

function handleLoopbackCallback(
  entry: PendingInteraction,
  redirect: LoopbackRedirect,
  req: IncomingMessage,
  res: ServerResponse,
): void {
  try {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${redirect.port}`);
    if (req.method !== "GET" || url.pathname !== redirect.pathname) {
      sendResultPage(res, 404, CALLBACK_INVALID);
      return;
    }
    const error = url.searchParams.get("error");
    if (error !== null) {
      const description = url.searchParams.get("error_description") ?? error;
      if (error === "access_denied") {
        sendResultPage(res, 200, CALLBACK_CANCELLED);
        settle(entry, { status: "cancelled" });
      } else {
        sendResultPage(res, 400, CALLBACK_FAILED);
        settle(entry, { status: "failed", code: error, message: description });
      }
      return;
    }
    const code = url.searchParams.get("code");
    if (!nonEmpty(code)) {
      sendResultPage(res, 400, CALLBACK_MISSING_CODE);
      return;
    }
    const state = url.searchParams.get("state") ?? undefined;
    sendResultPage(res, 200, CALLBACK_COMPLETE);
    settle(entry, {
      status: "authorized",
      code,
      ...(state !== undefined ? { state } : {}),
      redirectUri: entry.request.redirectUri,
    });
  } catch {
    sendResultPage(res, 400, CALLBACK_INVALID);
  }
}

/**
 * ADR-052 D4: the loopback callback answers with a readable result page instead of a bare sentence.
 *
 * The page is a one-off receipt rendered in the user's browser, not a Suite Client surface: it belongs to no
 * locale dictionary (ADR §5.10 keeps user-visible wording in the Client) because it is produced by a Node
 * listener that has no locale and no page session, and it is only ever seen once, right after consent. The
 * copy is therefore English here on purpose, and every word is a fixed constant — no control-plane code, no
 * authorization code, no token, and no interpolation of anything the authorization server sent.
 *
 * Scripts: try window.close() on load (browsers refuse to close a tab they did not open through script, so it
 * usually fails silently) and offer an explicit button that tries once more. Both are wrapped so a refusal is
 * never surfaced as an error page. Everything is inline: no external resource, no template engine.
 */
const CALLBACK_COMPLETE = {
  title: "Authorization complete",
  heading: "Authorization complete",
  detail: "You can return to the app — the server is now connected. This tab can be closed.",
} as const;
const CALLBACK_MISSING_CODE = {
  title: "Missing authorization code",
  heading: "Missing authorization code",
  detail: "The sign-in page came back without an authorization code, so nothing was connected. Return to the app and start the sign-in again.",
} as const;
const CALLBACK_CANCELLED = {
  title: "Authorization cancelled",
  heading: "Authorization cancelled",
  detail: "Sign-in was cancelled before it finished. Return to the app if you want to try again.",
} as const;
const CALLBACK_FAILED = {
  title: "Authorization failed",
  heading: "Authorization failed",
  detail: "The sign-in did not finish. Return to the app to see the reason and try again.",
} as const;
const CALLBACK_INVALID = {
  title: "Invalid callback",
  heading: "Invalid callback",
  detail: "This address did not carry a sign-in result. Return to the app and start the sign-in again.",
} as const;

interface ResultPage {
  readonly title: string;
  readonly heading: string;
  readonly detail: string;
}

function resultPageHtml(page: ResultPage): string {
  // Fixed constants only: nothing from the request or the authorization server is interpolated, so neither a
  // code nor a token can reach the page even by accident.
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    "<title>" + page.title + "</title>",
    "<style>",
    ":root{color-scheme:light dark}",
    "body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;",
    'font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#f5f6f8;color:#1b1d21}',
    "main{max-width:34rem;padding:2rem;background:#fff;border-radius:12px;",
    "box-shadow:0 1px 3px rgba(0,0,0,.12)}",
    "h1{margin:0 0 .75rem;font-size:1.25rem;line-height:1.3}",
    "p{margin:0 0 1.25rem;line-height:1.55;color:#4a4e57}",
    "button{font:inherit;padding:.5rem 1rem;border-radius:8px;border:1px solid #c9cdd4;",
    "background:#fff;color:inherit;cursor:pointer}",
    "button:hover{background:#f0f1f3}",
    "button:focus-visible{outline:2px solid #2f6fed;outline-offset:2px}",
    "@media (prefers-color-scheme:dark)",
    "{body{background:#17191d;color:#e8eaee}main{background:#22252a}",
    "p{color:#a8aeb8}button{background:#22252a;border-color:#3a3f46}button:hover{background:#2b2f35}}",
    "</style>",
    "</head>",
    "<body>",
    "<main>",
    "<h1>" + page.heading + "</h1>",
    "<p>" + page.detail + "</p>",
    '<button type="button" id="close-tab">Close this tab</button>',
    "</main>",
    "<script>",
    "(function(){",
    'var button=document.getElementById("close-tab");',
    "function closeTab(){try{window.close();}catch(e){}}",
    'if(button){button.addEventListener("click",closeTab);}',
    "closeTab();",
    "})();",
    "</script>",
    "</body>",
    "</html>",
  ].join("");
}

function sendResultPage(res: ServerResponse, status: number, page: ResultPage): void {
  const body = resultPageHtml(page);
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "content-length": String(Buffer.byteLength(body)),
  });
  res.end(body);
}

/** ADR-057: the one place that decides whether this module may launch a browser. Exported so the product's
 * preference is asserted as an identity (`=== openSystemBrowser`) instead of "it seems to work": a switch that
 * silently falls back to the real browser is worse than no switch, because the gate would look clean while still
 * hijacking the developer's browser. */
export function openSystemBrowser(url: string): void {
  const command = process.platform === "darwin"
    ? "open"
    : process.platform === "win32"
      ? "rundll32"
      : "xdg-open";
  const args = process.platform === "win32"
    ? ["url.dll,FileProtocolHandler", url]
    : [url];
  try {
    spawn(command, args, { detached: true, stdio: "ignore" })
      .on("error", () => {})
      .unref();
  } catch {
    // Callers already have the original URL and can present it themselves.
  }
}

function rememberTombstone(id: string, reason: TombstoneReason): void {
  tombstones.set(id, { reason, deleteAfter: Date.now() + TOMBSTONE_TTL_MS });
}

function pruneTombstones(): void {
  const now = Date.now();
  for (const [id, tombstone] of tombstones) {
    if (tombstone.deleteAfter <= now) tombstones.delete(id);
  }
}

function rejectedForMissing(id: string): SubmitOAuthCodeResult {
  const tombstone = tombstones.get(id);
  if (tombstone?.reason === "expired") {
    return {
      accepted: false,
      code: "expired",
      message: "interaction has expired",
    };
  }
  return {
    accepted: false,
    code: "unknown_id",
    message: "unknown or consumed interaction",
  };
}

function missingWaitResult(id: string): LoginGatewayResult {
  const tombstone = tombstones.get(id);
  if (tombstone?.reason === "expired") {
    return {
      status: "failed",
      code: "expired",
      message: "interaction has expired",
    };
  }
  return {
    status: "failed",
    code: "unknown_id",
    message: "unknown or consumed interaction",
  };
}
