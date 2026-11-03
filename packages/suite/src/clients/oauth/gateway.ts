/**
 * HTTP client for the ADR-027 login gateway (one in-memory interaction store, no local loopback runtime).
 *
 * ADR-033 R1: the gateway origin is the host web server's own origin, handed in by the caller. This module
 * never invents a port — a fixed port is a guess even when it happens to be right on one machine, and the
 * desktop host binds `--port 0`. When no usable origin exists, login is disabled with a readable reason
 * instead of being attempted against an address that cannot be the gateway.
 *
 * The reported origin is still filtered through the one shared loopback predicate (`src/loopback-origin.ts`,
 * a pure module both layers may import): the login endpoint is a local gateway, so a non-loopback origin is
 * a refusal with a readable reason rather than a request to somewhere else.
 */
import { loopbackOrigin } from "../../loopback-origin.js";
export type OAuthPreference = "loopback" | "paste" | "auto";
export type ResolvedOAuthPreference = Exclude<OAuthPreference, "auto">;

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

export type BeginOAuthInteractionResult =
  | StartedOAuthInteraction
  | { ok: false; result: Extract<LoginGatewayResult, { status: "failed" }> };

export interface GatewayHttp {
  fetch(url: string, init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    /** ADR-052 D2/D5: a cancel (or a plugin unload) aborts the pending wait instead of leaving it hanging
     * until the gateway's own timeout. The wait call below is the only caller that uses it. */
    signal?: AbortSignal;
  }): Promise<{
    readonly ok: boolean;
    readonly status: number;
    json(): Promise<unknown>;
    text(): Promise<string>;
  }>;
}

export interface GatewayClient {
  readonly origin: string;
  readonly http: GatewayHttp;
}

/** The part of the host web server this module reads: its bound origin. */
export interface OriginSource {
  getOrigin?(): string;
}

/** Whether a login can be attempted at all. The two shapes are exhaustive so callers must handle "no". */
export type LoginGatewayAvailability =
  | { ok: true; client: GatewayClient }
  | { ok: false; reason: string };

/** Login was asked for but the host offers no gateway origin. The code is machine-readable; the message is
 * the readable reason the control plane and the login tool surface (never a guessed port). */
export class LoginGatewayUnavailable extends Error {
  readonly code = "oauth/gateway-unavailable";

  constructor(reason: string) {
    super(`login gateway unavailable: ${reason}`);
    this.name = "LoginGatewayUnavailable";
  }
}

/** Resolves the gateway origin from the host's web server. A missing service, an unbound listener and a
 * non-loopback origin are three distinct reasons; none of them is answered by inventing a port. */
export function gatewayAvailability(service: OriginSource | undefined): LoginGatewayAvailability {
  if (service === undefined) return { ok: false, reason: "the host web server is not available" };
  let origin: string | null;
  try {
    const raw = service.getOrigin?.();
    origin = typeof raw === "string" && raw !== "" ? raw : null;
  } catch {
    origin = null;
  }
  if (origin === null) return { ok: false, reason: "the host web server has not bound an origin" };
  if (loopbackOrigin(origin) === null) {
    return { ok: false, reason: "the host web server origin is not loopback" };
  }
  return { ok: true, client: createGatewayClient({ origin }) };
}

export function requireGateway(availability: LoginGatewayAvailability): GatewayClient {
  if (!availability.ok) throw new LoginGatewayUnavailable(availability.reason);
  return availability.client;
}

export function createGatewayClient(options: {
  origin: string;
  http?: GatewayHttp;
}): GatewayClient {
  return {
    origin: options.origin,
    http: options.http ?? { fetch },
  };
}

export async function beginOAuthViaGateway(
  request: LoginGatewayRequest,
  client: GatewayClient,
): Promise<BeginOAuthInteractionResult> {
  let response: Awaited<ReturnType<GatewayHttp["fetch"]>>;
  try {
    response = await client.http.fetch(`${client.origin}/login-gateway/oauth/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
  } catch (error) {
    return unavailable(error);
  }
  const body = await readJson(response);
  if (response.status === 202) {
    const id = stringField(body, "id");
    const prefer = stringField(body, "prefer");
    const authorizationUrl = stringField(body, "authorizationUrl");
    const redirectUri = stringField(body, "redirectUri");
    if (
      id !== undefined
      && (prefer === "loopback" || prefer === "paste")
      && authorizationUrl !== undefined
      && redirectUri !== undefined
    ) {
      return { ok: true, id, prefer, authorizationUrl, redirectUri };
    }
    return {
      ok: false,
      result: { status: "failed", code: "invalid_request", message: "gateway start returned an incomplete body" },
    };
  }
  return { ok: false, result: failedFromBody(body, response.status) };
}

export async function waitOAuthViaGateway(
  id: string,
  client: GatewayClient,
  signal?: AbortSignal,
): Promise<LoginGatewayResult> {
  let response: Awaited<ReturnType<GatewayHttp["fetch"]>>;
  try {
    response = await client.http.fetch(
      `${client.origin}/login-gateway/oauth/wait/${encodeURIComponent(id)}`,
      signal !== undefined ? { signal } : undefined,
    );
  } catch (error) {
    // An aborted wait is not an authorization failure: the caller that aborted it owns the next state.
    if (isAbort(error)) return { status: "cancelled" };
    return unavailable(error).result;
  }
  return resultFromBody(await readJson(response));
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
}

export async function submitOAuthViaGateway(
  id: string,
  submission: { code: string; state?: string },
  client: GatewayClient,
): Promise<{ accepted: true } | { accepted: false; code: string; message: string }> {
  let response: Awaited<ReturnType<GatewayHttp["fetch"]>>;
  try {
    response = await client.http.fetch(
      `${client.origin}/login-gateway/oauth/submit/${encodeURIComponent(id)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(submission),
      },
    );
  } catch (error) {
    const failed = unavailable(error).result;
    return { accepted: false, code: failed.code, message: failed.message };
  }
  if (response.status === 202) return { accepted: true };
  const body = await readJson(response);
  return {
    accepted: false,
    code: stringField(body, "code") ?? "unknown_id",
    message: stringField(body, "message") ?? "submit failed",
  };
}

export async function cancelOAuthViaGateway(
  key: string,
  client: GatewayClient,
): Promise<boolean> {
  try {
    const response = await client.http.fetch(`${client.origin}/login-gateway/oauth/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key }),
    });
    return response.status === 200;
  } catch {
    return false;
  }
}

export async function startOAuthViaGateway(
  request: LoginGatewayRequest,
  client: GatewayClient,
  onStarted?: (started: StartedOAuthInteraction) => void,
): Promise<LoginGatewayResult> {
  const started = await beginOAuthViaGateway(request, client);
  if (!started.ok) return started.result;
  onStarted?.(started);
  return waitOAuthViaGateway(started.id, client);
}

function unavailable(error: unknown): { ok: false; result: Extract<LoginGatewayResult, { status: "failed" }> } {
  return {
    ok: false,
    result: {
      status: "failed",
      code: "gateway_unavailable",
      message: error instanceof Error ? error.message : String(error),
    },
  };
}

async function readJson(response: { json(): Promise<unknown> }): Promise<Record<string, unknown>> {
  try {
    const body = await response.json();
    return body !== null && typeof body === "object" && !Array.isArray(body)
      ? body as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function stringField(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  return typeof value === "string" && value !== "" ? value : undefined;
}

function failedFromBody(
  body: Record<string, unknown>,
  status: number,
): Extract<LoginGatewayResult, { status: "failed" }> {
  return {
    status: "failed",
    code: stringField(body, "code") ?? (status === 409 ? "in_flight" : "invalid_request"),
    message: stringField(body, "message") ?? stringField(body, "error") ?? `gateway start failed (${status})`,
  };
}

function resultFromBody(body: Record<string, unknown>): LoginGatewayResult {
  const status = stringField(body, "status");
  if (status === "cancelled") return { status: "cancelled" };
  if (status === "authorized") {
    const code = stringField(body, "code");
    const redirectUri = stringField(body, "redirectUri");
    if (code === undefined || redirectUri === undefined) {
      return { status: "failed", code: "invalid_request", message: "gateway wait returned an incomplete body" };
    }
    const state = stringField(body, "state");
    return { status: "authorized", code, redirectUri, ...(state !== undefined ? { state } : {}) };
  }
  return {
    status: "failed",
    code: stringField(body, "code") ?? "unknown_id",
    message: stringField(body, "message") ?? "authorization failed",
  };
}
