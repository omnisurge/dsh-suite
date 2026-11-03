/** Opaque grant payload stored under ctx.credentials (ADR-031), written as plain JSON only (ADR-033 D3). */
import type { OAuthDiscoveryState } from "@modelcontextprotocol/client";
import type {
  OAuthClientInformationMixed,
  OAuthTokens,
} from "@modelcontextprotocol/client";

export interface McpOAuthGrantPayload {
  readonly version: 1;
  readonly tokens?: OAuthTokens;
  readonly client?: OAuthClientInformationMixed;
  readonly codeVerifier?: string;
  readonly redirectUri?: string;
  readonly discovery?: OAuthDiscoveryState;
}

/** Machine-readable code for "this grant cannot be stored as JSON". The write is refused, not truncated. */
export const GRANT_UNSERIALIZABLE = "oauth/grant-unserializable";

export class GrantUnserializableError extends Error {
  readonly code = GRANT_UNSERIALIZABLE;

  constructor(detail: string) {
    super(`${GRANT_UNSERIALIZABLE}: ${detail}`);
    this.name = "GrantUnserializableError";
  }
}

/**
 * Why the write path normalizes (ADR-033 D3 / R2): the grant is assembled from upstream SDK objects, and the
 * official credentials store admits only values JSON can represent — it accepts `null`, strings, booleans,
 * finite numbers, arrays and `Object.prototype` objects, and rejects everything else, **including
 * `undefined`**. The SDK's discovery state always carries a `resourceMetadataUrl` key whose value is
 * `undefined` when the server's 401 advertises no `resource_metadata` parameter, so passing the SDK object
 * straight through made the official store refuse the whole write ("payload holds a value JSON cannot
 * represent"). The fix is the whitelist below: rebuild the payload field by field, keep only JSON data, and
 * never write a value JSON cannot carry.
 */

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

/** Token fields the SDK may hand us. `issuer` is the SEP-2352 authorization-server binding the SDK adds;
 * keeping it is what stops every start from rewriting the grant just to re-add it. */
const TOKEN_FIELDS = [
  "access_token",
  "refresh_token",
  "token_type",
  "expires_in",
  "scope",
  "issuer",
] as const;

/** Client fields the SDK may hand us (DCR response, static client id, or a URL-based client id). */
const CLIENT_FIELDS = [
  "client_id",
  "client_secret",
  "client_id_issued_at",
  "client_secret_expires_at",
  "issuer",
] as const;

export function emptyGrant(): McpOAuthGrantPayload {
  return { version: 1 };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Rebuilds one value as plain JSON data. Undefined, class instances, functions, symbols, bigints and
 * non-finite numbers are not data JSON can represent, so they are dropped (the surrounding key disappears,
 * an array slot becomes `null`); a cycle is the one shape that cannot be dropped without corrupting the
 * record, so it refuses the write. */
function toJsonValue(
  value: unknown,
  seen: Set<object>,
): { ok: true; value: JsonValue } | { ok: false } {
  if (value === null) return { ok: true, value: null };
  if (typeof value === "string" || typeof value === "boolean") return { ok: true, value };
  if (typeof value === "number") {
    return Number.isFinite(value) ? { ok: true, value } : { ok: false };
  }
  if (typeof value !== "object") return { ok: false };
  if (seen.has(value)) throw new GrantUnserializableError("the grant contains a cycle");
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return {
        ok: true,
        value: value.map((item) => {
          const next = toJsonValue(item, seen);
          return next.ok ? next.value : null;
        }),
      };
    }
    if (!isPlainObject(value)) return { ok: false };
    const out: { [key: string]: JsonValue } = {};
    for (const [key, nested] of Object.entries(value)) {
      const next = toJsonValue(nested, seen);
      if (next.ok) out[key] = next.value;
    }
    return { ok: true, value: out };
  } finally {
    seen.delete(value);
  }
}

/** Whitelisted scalar fields of one nested object (`tokens` / `client`), or `undefined` when none survived. */
function scalarFields(
  source: unknown,
  keys: readonly string[],
): Record<string, JsonValue> | undefined {
  if (!isPlainObject(source)) return undefined;
  const out: Record<string, JsonValue> = {};
  for (const key of keys) {
    const next = toJsonValue(source[key], new Set());
    if (next.ok && next.value !== null) out[key] = next.value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Discovery state is kept whole (the SDK compares it on the callback leg for the SEP-2352 binding), but as
 * rebuilt JSON data; it is only meaningful with the authorization server URL. */
function normalizeDiscovery(source: unknown): OAuthDiscoveryState | undefined {
  if (!isPlainObject(source)) return undefined;
  const next = toJsonValue(source, new Set());
  if (!next.ok || next.value === null || typeof next.value !== "object" || Array.isArray(next.value)) {
    return undefined;
  }
  const body = next.value as unknown as Record<string, unknown>;
  if (typeof body.authorizationServerUrl !== "string" || body.authorizationServerUrl === "") {
    return undefined;
  }
  return next.value as unknown as OAuthDiscoveryState;
}

/**
 * The single write-path construction for a grant record: whitelist, drop what JSON cannot represent, refuse
 * only what cannot be represented at all. A thrown `GrantUnserializableError` means "no write" — the caller
 * keeps the previous bytes and reports `oauth/grant-unserializable`.
 */
export function normalizeGrantPayload(payload: unknown): McpOAuthGrantPayload {
  if (!isPlainObject(payload)) {
    throw new GrantUnserializableError("the grant payload is not a plain object");
  }
  const tokens = scalarFields(payload.tokens, TOKEN_FIELDS);
  const client = scalarFields(payload.client, CLIENT_FIELDS);
  const discovery = normalizeDiscovery(payload.discovery);
  return {
    version: 1,
    ...(tokens !== undefined ? { tokens: tokens as unknown as OAuthTokens } : {}),
    ...(client !== undefined ? { client: client as unknown as OAuthClientInformationMixed } : {}),
    ...(typeof payload.codeVerifier === "string" && payload.codeVerifier !== ""
      ? { codeVerifier: payload.codeVerifier }
      : {}),
    ...(typeof payload.redirectUri === "string" && payload.redirectUri !== ""
      ? { redirectUri: payload.redirectUri }
      : {}),
    ...(discovery !== undefined ? { discovery } : {}),
  };
}

function parseDiscovery(raw: unknown): OAuthDiscoveryState | undefined {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const body = raw as Record<string, unknown>;
  if (typeof body.authorizationServerUrl !== "string" || body.authorizationServerUrl === "") {
    return undefined;
  }
  return raw as OAuthDiscoveryState;
}

export function parseGrantPayload(raw: unknown): McpOAuthGrantPayload {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return emptyGrant();
  const body = raw as Record<string, unknown>;
  if (body.version !== 1) return emptyGrant();
  const discovery = parseDiscovery(body.discovery);
  return {
    version: 1,
    ...(body.tokens !== undefined ? { tokens: body.tokens as OAuthTokens } : {}),
    ...(body.client !== undefined ? { client: body.client as OAuthClientInformationMixed } : {}),
    ...(typeof body.codeVerifier === "string" ? { codeVerifier: body.codeVerifier } : {}),
    ...(typeof body.redirectUri === "string" ? { redirectUri: body.redirectUri } : {}),
    ...(discovery !== undefined ? { discovery } : {}),
  };
}

export function hasAccessToken(payload: McpOAuthGrantPayload): boolean {
  return typeof payload.tokens?.access_token === "string" && payload.tokens.access_token !== "";
}

export function hasRefreshToken(payload: McpOAuthGrantPayload): boolean {
  return typeof payload.tokens?.refresh_token === "string" && payload.tokens.refresh_token !== "";
}

/** Keep the previous refresh token when the AS rotates access only. */
export function mergeRotatedTokens(
  previous: OAuthTokens | undefined,
  next: OAuthTokens,
): OAuthTokens {
  if (typeof next.refresh_token === "string" && next.refresh_token !== "") return next;
  if (typeof previous?.refresh_token === "string" && previous.refresh_token !== "") {
    return { ...next, refresh_token: previous.refresh_token };
  }
  return next;
}
