/** Loopback control plane for status / login / logout / submit (per serverName). */
import {
  parseOAuthPreference,
  readLimitedBody,
  readLimitedJsonObject,
  requestIsJson,
  type OAuthPreference,
} from "../loopback.js";

/** ADR-034 D2b: the one error code for a refused login body. The message is a readable sentence and never
 * echoes the value that was refused. */
export const LOGIN_MODE_INVALID = "oauth/login-mode-invalid";
export const HTTP_PREFIX = "/mcp-oauth-client";

export type ConnectionStatus = "idle" | "needs_login" | "connected" | "error";

/**
 * ADR-052 D2/D3: the *authorization* half of the status — what the Host is doing about a sign-in right now.
 * Deliberately carries only non-secret facts: the URL the user must open, the resolved preference and when the
 * attempt started. It never carries the authorization code or a token, and it lives beside "status" because
 * "waiting for the browser" is not a connection state of its own (ADR-052 D3 — the page must not invent a new
 * StatusView.status value).
 */
export interface AuthorizationView {
  readonly state: "idle" | "waiting";
  readonly authorizationUrl?: string;
  readonly prefer?: "loopback" | "paste";
  /** ISO-8601 instant at which the in-flight attempt began. */
  readonly startedAt?: string;
}

/** ADR-034 D2: the explicit facts a caller may name on `POST /login`. An omitted body resolves to the
 * historical default (loopback, blocking until the callback or the timeout). */
export interface LoginMode {
  readonly prefer?: OAuthPreference;
  readonly deferWait?: boolean;
}

export interface StatusView {
  readonly serverName: string;
  readonly url: string;
  readonly status: ConnectionStatus;
  readonly toolCount: number;
  readonly toolNames: readonly string[];
  readonly error?: string;
  readonly authorized: boolean;
  /**
   * ADR-052 D2: the authorization half of the view. Always present; `state:'waiting'` holds exactly while a
   * background wait is registered for this server, and returns to `'idle'` the moment it settles.
   */
  readonly authorization: AuthorizationView;
  /**
   * Legacy flat fields (kept for pages/tests written before ADR-052 D2). They are **the same source** as
   * `authorization.authorizationUrl` / `authorization.prefer`: the runtime builds all three from one
   * in-flight record, so the two shapes can never disagree. New consumers should read `authorization`.
   */
  readonly authorizationUrl?: string;
  readonly prefer?: "loopback" | "paste";
}

export interface RuntimeHandle {
  /** 缓存态：**不反映可达性**——服务端消失后它仍可能停在 connected。 */
  getStatus(): StatusView;
  /**
   * **实时可达性探测**（2026-09-15，与 mcp-dual-client 同款）：只问端点是否活着，
   * **不做任何恢复动作**——oauth 侧 `needs_login` 是**合法状态**（用户该去登录），
   * 探针无权把它改成 error；它的职责仅是识别『网络不可达』。
   */
  probe(): Promise<StatusView>;
  login(mode?: LoginMode): Promise<StatusView>;
  logout(): Promise<StatusView>;
  reconnect(): Promise<StatusView>;
  submitCode(code: string, state?: string): Promise<StatusView>;
  /**
   * ADR-052 D2: cancel the in-flight sign-in (closes the gateway interaction, clears the pending link and puts
   * the runtime back to `needs_login`). Idempotent: with nothing in flight it answers the current view and
   * does not fail — the page can always offer the button.
   */
  cancel(): Promise<StatusView>;
}

export interface HttpRequestLike {
  readonly method?: string;
  readonly url?: string;
  readonly headers: Record<string, unknown>;
  readonly socket?: { readonly remoteAddress?: string };
  on?(event: "data", listener: (chunk: Uint8Array) => void): void;
  on?(event: "end" | "error", listener: (err?: unknown) => void): void;
}

export interface HttpResponseLike {
  writeHead(status: number, headers?: Record<string, string>): void;
  end(body?: string): void;
}

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const LOGIN_BODY_LIMIT = 32 * 1024;
const LOGIN_KEYS: ReadonlySet<string> = new Set(["prefer", "deferWait"]);
const SUBMIT_KEYS: ReadonlySet<string> = new Set(["code", "state"]);

export function isDcrFailure(message: string): boolean {
  const text = message.toLowerCase();
  return text.includes("dynamic registration")
    || text.includes("registration_endpoint")
    || text.includes("must be saveable")
    || text.includes("invalid_client_metadata")
    || text.includes("invalid client metadata");
}

function publicOauthError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (isDcrFailure(message)) return "dcr: static client id required";
  return message;
}

export function controlPlanePrefix(serverName: string): string {
  return `${HTTP_PREFIX}/${encodeURIComponent(serverName)}`;
}

function send(res: HttpResponseLike, status: number, body: unknown): void {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body));
}

function isLoopback(req: HttpRequestLike): boolean {
  return LOOPBACK.has(req.socket?.remoteAddress ?? "");
}

function matchAction(
  pathname: string,
  prefix: string,
): "status" | "probe" | "login" | "logout" | "reconnect" | "submit" | "cancel" | null {
  const base = pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  if (base === `${prefix}/status`) return "status";
  if (base === `${prefix}/probe`) return "probe";
  if (base === `${prefix}/login`) return "login";
  if (base === `${prefix}/logout`) return "logout";
  if (base === `${prefix}/reconnect`) return "reconnect";
  if (base === `${prefix}/submit`) return "submit";
  if (base === `${prefix}/cancel`) return "cancel";
  return null;
}

/** Validate the optional login body. An omitted body resolves to the historical default here, so every entry
 * point sees the same explicit facts (ADR-034 D2b). */
function loginMode(record: Record<string, unknown>): LoginMode | string {
  const prefer = parseOAuthPreference(record.prefer);
  if (record.prefer !== undefined && prefer === undefined) return "prefer must be loopback, paste, or auto";
  const deferWait = record.deferWait;
  if (deferWait !== undefined && typeof deferWait !== "boolean") return "deferWait must be a boolean";
  const resolved = prefer ?? "loopback";
  const deferred = deferWait === true;
  // ADR-052 D1/D2: deferWait is no longer bound to paste. ADR-034 D2c refused it for every other preference
  // because a deferred login was assumed to leave the user without an entry point; the Host now keeps waiting
  // in the background, exposes `authorization.state` through /status and offers /cancel, so loopback and auto
  // are first-class deferred logins. The field is still a strict boolean and unknown fields are still refused.
  return { prefer: resolved, deferWait: deferred };
}

function sendLoginModeError(res: HttpResponseLike, message: string): void {
  send(res, 400, { error: LOGIN_MODE_INVALID, message });
}

const CODE_PLACEHOLDER = "<code>";

/** ADR-034 D2d: an authorization code must never reach a response, a StatusView.error or a log line. The
 * submitted code — and any same-length opaque run, in case a transport quoted a transformed form — becomes a
 * fixed placeholder. Exported so the runtime redacts through this same implementation. */
export function redactAuthorizationCode(text: string, code: string | undefined): string {
  if (code === undefined || code === "") return text;
  // The submitted code itself is always replaced, whatever its length: the match is unambiguous.
  const literal = text.split(code).join(CODE_PLACEHOLDER);
  // Same-length opaque runs are a best-effort extra (a transport may quote a transformed form). Below eight
  // characters that heuristic would eat unrelated diagnostics, so it only runs for longer codes.
  if (code.length < 8) return literal;
  return literal.replace(new RegExp("[A-Za-z0-9._~+/=-]{" + String(code.length) + "}", "gu"), CODE_PLACEHOLDER);
}

export function createHttpHandler(runtime: RuntimeHandle, serverName: string) {
  const prefix = controlPlanePrefix(serverName);
  return (req: HttpRequestLike, res: HttpResponseLike): void => {
    void (async () => {
      if (!isLoopback(req)) {
        send(res, 403, { error: "loopback only" });
        return;
      }
      const method = req.method ?? "GET";
      const pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
      const action = matchAction(pathname, prefix);
      let submittedCode: string | undefined;
      try {
        if (action === "status" && method === "GET") {
          send(res, 200, runtime.getStatus());
          return;
        }
        if (action === "probe" && method === "GET") {
          send(res, 200, await runtime.probe());
          return;
        }
        if (action === "login" && method === "POST") {
          // ADR-034 D2b: the body is optional, but when one is present it is held to the login gateway's own
          // contract — JSON content type, bounded size, no unknown fields — under one explicit error code.
          if (!requestIsJson(req)) {
            let raw = "";
            try {
              raw = await readLimitedBody(req, LOGIN_BODY_LIMIT);
            } catch {
              sendLoginModeError(res, "body too large");
              return;
            }
            if (raw.trim() !== "") {
              sendLoginModeError(res, "content-type must be application/json");
              return;
            }
            send(res, 200, await runtime.login({ prefer: "loopback", deferWait: false }));
            return;
          }
          const parsed = await readLimitedJsonObject(req, LOGIN_KEYS, LOGIN_BODY_LIMIT, true);
          if (!parsed.ok) {
            sendLoginModeError(res, parsed.reason);
            return;
          }
          const mode = loginMode(parsed.record);
          if (typeof mode === "string") {
            sendLoginModeError(res, mode);
            return;
          }
          send(res, 200, await runtime.login(mode));
          return;
        }
        if (action === "logout" && method === "POST") {
          send(res, 200, await runtime.logout());
          return;
        }
        if (action === "reconnect" && method === "POST") {
          send(res, 200, await runtime.reconnect());
          return;
        }
        if (action === "cancel" && method === "POST") {
          // ADR-052 D2: cancelling is idempotent and never an error. The body is not read at all — the action
          // already names the one server this prefix belongs to, and a page must be able to cancel with no
          // payload. Nothing in flight means "here is the current view", still a 200.
          send(res, 200, await runtime.cancel());
          return;
        }
        if (action === "submit" && method === "POST") {
          const parsed = await readLimitedJsonObject(req, SUBMIT_KEYS, LOGIN_BODY_LIMIT);
          if (!parsed.ok) {
            send(res, 400, { error: parsed.reason });
            return;
          }
          const body = parsed.record;
          const code = typeof body.code === "string" ? body.code.trim() : "";
          if (code === "") {
            send(res, 400, { error: "code is required" });
            return;
          }
          const state = typeof body.state === "string" ? body.state.trim() : undefined;
          submittedCode = code;
          send(res, 200, await runtime.submitCode(code, state === "" ? undefined : state));
          return;
        }
        send(res, 404, { error: "not found" });
      } catch (error) {
        // ADR-034 D2d: a submitted code never reaches a response — not even inside a transport error.
        send(res, 400, { error: redactAuthorizationCode(publicOauthError(error), submittedCode) });
      }
    })();
  };
}
