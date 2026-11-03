/** Loopback-only OAuth control plane: it registers on whatever origin the host web server reports.*/
import {
  readLimitedJsonObject,
  requestIsJson,
  requireLoopback,
  sendJson,
  sendJsonError,
  type LoopbackRequest,
  type LoopbackResponse,
} from "../loopback.js";
import {
  beginOAuthInteraction,
  cancelOAuthInteraction,
  cancelOAuthInteractionByKey,
  parseOAuthPreference,
  submitOAuthCode,
  waitForOAuthResult,
  type BeginOAuthInteractionResult,
  type LoginGatewayRequest,
  type LoginGatewayResult,
  type SubmitOAuthCodeResult,
} from "./oauth-interaction.js";

export const OAUTH_PREFIX = "/login-gateway/oauth";
export const OAUTH_START_PATH = `${OAUTH_PREFIX}/start`;
export const OAUTH_CANCEL_PATH = `${OAUTH_PREFIX}/cancel`;
const BODY_LIMIT = 32 * 1024;
const START_KEYS = new Set([
  "key",
  "authorizationUrl",
  "redirectUri",
  "timeoutMs",
  "prefer",
]);
const SUBMIT_KEYS = new Set(["code", "state"]);
const CANCEL_KEYS = new Set(["key"]);

export type HttpRequestLike = LoopbackRequest;
export type HttpResponseLike = LoopbackResponse;

export interface OAuthHttpDependencies {
  begin(request: LoginGatewayRequest): BeginOAuthInteractionResult;
  submit(
    id: string,
    submission: { code: string; state?: string },
  ): SubmitOAuthCodeResult;
  wait(id: string): Promise<LoginGatewayResult>;
  cancel(id: string): boolean;
  cancelByKey(key: string): boolean;
}

// ADR-057: deliberately no default dependency set here. A default `begin` would be a second construction path for
// "no config means launch the real browser": the login-gateway row resolves that fact once
// (`authorizationBrowserOpener`) and passes it in, and a caller that forgot would otherwise keep working while
// silently ignoring the row's switch.
export function createOAuthHttpHandler(
  deps: OAuthHttpDependencies,
) {
  return (req: HttpRequestLike, res: HttpResponseLike): void => {
    void handleRequest(req, res, deps);
  };
}

async function handleRequest(
  req: HttpRequestLike,
  res: HttpResponseLike,
  deps: OAuthHttpDependencies,
): Promise<void> {
  if (!requireLoopback(req, res)) return;

  const method = req.method ?? "GET";
  const pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
  const waitId = routeId(pathname, "wait");
  const submitId = routeId(pathname, "submit");
  const cancelId = routeId(pathname, "cancel");

  if (pathname === OAUTH_START_PATH) {
    if (method !== "POST") {
      sendJsonError(res, 405, "method not allowed");
      return;
    }
    if (!requestIsJson(req)) {
      sendJsonError(res, 415, "content-type must be application/json");
      return;
    }
    const parsed = await readStartRequest(req);
    if (typeof parsed === "string") {
      sendJsonError(res, 400, parsed);
      return;
    }
    const started = deps.begin(parsed);
    if (!started.ok) {
      sendJson(res, startFailureStatus(started.result.code), started.result);
      return;
    }
    sendJson(res, 202, {
      id: started.id,
      prefer: started.prefer,
      authorizationUrl: started.authorizationUrl,
      redirectUri: started.redirectUri,
    });
    return;
  }

  if (waitId !== undefined) {
    if (method !== "GET") {
      sendJsonError(res, 405, "method not allowed");
      return;
    }
    const result = await deps.wait(waitId);
    sendJson(res, waitStatus(result), result);
    return;
  }

  if (submitId !== undefined) {
    if (method !== "POST") {
      sendJsonError(res, 405, "method not allowed");
      return;
    }
    if (!requestIsJson(req)) {
      sendJsonError(res, 415, "content-type must be application/json");
      return;
    }
    const parsed = await readSubmitRequest(req);
    if (typeof parsed === "string") {
      sendJsonError(res, 400, parsed);
      return;
    }
    const accepted = deps.submit(submitId, parsed);
    if (!accepted.accepted) {
      sendJson(res, submitFailureStatus(accepted.code), {
        status: "failed",
        code: accepted.code,
        message: accepted.message,
      });
      return;
    }
    sendJson(res, 202, { status: "accepted" });
    return;
  }

  if (pathname === OAUTH_CANCEL_PATH) {
    if (method !== "POST") {
      sendJsonError(res, 405, "method not allowed");
      return;
    }
    if (!requestIsJson(req)) {
      sendJsonError(res, 415, "content-type must be application/json");
      return;
    }
    const parsed = await readCancelRequest(req);
    if (typeof parsed === "string") {
      sendJsonError(res, 400, parsed);
      return;
    }
    const cancelled = deps.cancelByKey(parsed.key);
    sendJson(res, cancelled ? 200 : 404, cancelled
      ? { status: "cancelled" }
      : { status: "failed", code: "unknown_id", message: "unknown or consumed interaction" });
    return;
  }

  if (cancelId !== undefined) {
    if (method !== "POST") {
      sendJsonError(res, 405, "method not allowed");
      return;
    }
    const cancelled = deps.cancel(cancelId);
    sendJson(res, cancelled ? 200 : 404, cancelled
      ? { status: "cancelled" }
      : { status: "failed", code: "unknown_id", message: "unknown or consumed interaction" });
    return;
  }

  sendJsonError(res, 404, "not found");
}

async function readStartRequest(
  req: HttpRequestLike,
): Promise<LoginGatewayRequest | string> {
  const record = await readObject(req, START_KEYS);
  if (typeof record === "string") return record;
  if (!boundedString(record.key, 512)) return "key must be a non-empty string";
  if (!boundedString(record.authorizationUrl, 8192)) {
    return "authorizationUrl must be a non-empty string";
  }
  if (!boundedString(record.redirectUri, 8192)) {
    return "redirectUri must be a non-empty string";
  }
  const prefer = parseOAuthPreference(record.prefer);
  if (prefer === undefined) return "prefer must be loopback, paste, or auto";
  if (
    record.timeoutMs !== undefined
    && (!Number.isInteger(record.timeoutMs)
      || (record.timeoutMs as number) <= 0
      || (record.timeoutMs as number) > 600_000)
  ) {
    return "timeoutMs must be an integer from 1 to 600000";
  }
  return {
    key: record.key,
    authorizationUrl: record.authorizationUrl,
    redirectUri: record.redirectUri,
    ...(record.timeoutMs !== undefined
      ? { timeoutMs: record.timeoutMs as number }
      : {}),
    prefer,
  };
}

async function readCancelRequest(
  req: HttpRequestLike,
): Promise<{ key: string } | string> {
  const record = await readObject(req, CANCEL_KEYS);
  if (typeof record === "string") return record;
  if (!boundedString(record.key, 512)) return "key must be a non-empty string";
  return { key: record.key };
}

async function readSubmitRequest(
  req: HttpRequestLike,
): Promise<{ code: string; state?: string } | string> {
  const record = await readObject(req, SUBMIT_KEYS);
  if (typeof record === "string") return record;
  if (!boundedString(record.code, 16_384)) {
    return "code must be a non-empty string";
  }
  if (
    record.state !== undefined
    && !boundedString(record.state, 8192)
  ) {
    return "state must be a non-empty string when provided";
  }
  return {
    code: record.code,
    ...(record.state !== undefined ? { state: record.state } : {}),
  };
}

async function readObject(
  req: HttpRequestLike,
  allowedKeys: ReadonlySet<string>,
): Promise<Record<string, unknown> | string> {
  const parsed = await readLimitedJsonObject(req, allowedKeys, BODY_LIMIT);
  return parsed.ok ? parsed.record : parsed.reason;
}

function routeId(pathname: string, action: "wait" | "submit" | "cancel"): string | undefined {
  const prefix = `${OAUTH_PREFIX}/${action}/`;
  if (!pathname.startsWith(prefix)) return undefined;
  const id = pathname.slice(prefix.length);
  if (id === "" || id.includes("/")) return undefined;
  try {
    return decodeURIComponent(id);
  } catch {
    return undefined;
  }
}

function boundedString(value: unknown, maxLength: number): value is string {
  return typeof value === "string"
    && value.trim() !== ""
    && value.length <= maxLength;
}

function startFailureStatus(code: string): number {
  return code === "in_flight" ? 409 : 400;
}

function submitFailureStatus(code: string): number {
  if (code === "expired") return 410;
  if (code === "already_completed") return 409;
  return 404;
}

function waitStatus(result: LoginGatewayResult): number {
  if (result.status !== "failed") return 200;
  if (result.code === "expired") return 410;
  if (result.code === "unknown_id" || result.code === "wait_claimed") return 404;
  return 200;
}
