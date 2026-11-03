/** Loopback control-plane helpers for the MCP client modules the Suite carries (ADR-033).
 *
 * These used to come from the separate @omnisurge/dsh-host-kit package, which the Suite does not
 * depend on. The originals were exactly this: an address gate, JSON responses, a bounded JSON body
 * reader and a path-prefix match — nothing that needs a package of its own, and keeping them here
 * means the carried modules have no private runtime dependency.
 */

export interface LoopbackRequest {
  readonly method?: string;
  readonly url?: string;
  readonly headers?: Record<string, unknown>;
  readonly socket?: { readonly remoteAddress?: string };
  on?(event: "data", listener: (chunk: Uint8Array) => void): void;
  on?(event: "end" | "error", listener: (error?: unknown) => void): void;
}

export interface LoopbackResponse {
  writeHead(status: number, headers?: Record<string, string>): void;
  end(body?: string | Uint8Array): void;
}

/** Addresses this machine owns: the control plane answers only them. */
export const LOOPBACK_ADDRESSES: ReadonlySet<string> = new Set([
  "127.0.0.1",
  "::1",
  "::ffff:127.0.0.1",
]);

export function isLoopbackAddress(address?: string | null): boolean {
  return LOOPBACK_ADDRESSES.has(address ?? "");
}

export const JSON_HEADERS: Readonly<Record<string, string>> = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

export function headerValue(
  headers: Record<string, unknown> | undefined,
  name: string,
): string {
  if (headers === undefined) return "";
  const raw = headers[name] ?? headers[name.toLowerCase()];
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) return String(raw[0] ?? "");
  return "";
}

export function requestIsJson(req: Pick<LoopbackRequest, "headers">): boolean {
  return /^application\/json(?:\s*;|$)/i.test(headerValue(req.headers, "content-type"));
}

export function sendJson(res: LoopbackResponse, status: number, body: unknown): void {
  res.writeHead(status, { ...JSON_HEADERS });
  res.end(JSON.stringify(body));
}

export function sendJsonError(res: LoopbackResponse, status: number, message: string): void {
  sendJson(res, status, { error: message });
}

/** Non-loopback peers get a 403 and no further work is done for them. */
export function requireLoopback(req: LoopbackRequest, res: LoopbackResponse): boolean {
  if (isLoopbackAddress(req.socket?.remoteAddress)) return true;
  sendJsonError(res, 403, "loopback only");
  return false;
}

/** The suffix under a mounted prefix, or null when the path is outside it. */
export function pathUnderPrefix(pathname: string, prefix: string): string | null {
  const base = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
  if (pathname === base) return "";
  if (pathname.startsWith(`${base}/`)) return pathname.slice(base.length);
  return null;
}

export function readLimitedBody(req: LoopbackRequest, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    if (typeof req.on !== "function") {
      resolve("");
      return;
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    let failed = false;
    req.on("data", (chunk) => {
      if (failed) return;
      size += chunk.length;
      if (size > limit) {
        failed = true;
        reject(new Error("body too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!failed) resolve(new TextDecoder().decode(concatBytes(chunks)));
    });
    req.on("error", (error) => {
      if (failed) return;
      failed = true;
      reject(error instanceof Error ? error : new Error(String(error)));
    });
  });
}

function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}
/** OAuth preference is one contract shared by the login gateway and the MCP OAuth control plane: both parse
 * the same three words, so a caller cannot get a different answer from each entry point (ADR-034 D2b). */
export type OAuthPreference = "loopback" | "paste" | "auto";
export type ResolvedOAuthPreference = Exclude<OAuthPreference, "auto">;

export function parseOAuthPreference(value: unknown): OAuthPreference | undefined {
  return value === "loopback" || value === "paste" || value === "auto" ? value : undefined;
}

/** The bounded JSON-object body contract: the caller checks the content type, size is bounded here, and a
 * field outside the allowed set is refused by name. One implementation for every loopback POST. */
export const DEFAULT_JSON_BODY_LIMIT = 32 * 1024;

export type LimitedJsonObject =
  | { readonly ok: true; readonly record: Record<string, unknown> }
  | { readonly ok: false; readonly reason: string };

export async function readLimitedJsonObject(
  req: LoopbackRequest,
  allowedKeys: ReadonlySet<string>,
  limit: number = DEFAULT_JSON_BODY_LIMIT,
  emptyAsObject = false,
): Promise<LimitedJsonObject> {
  let raw: string;
  try {
    raw = await readLimitedBody(req, limit);
  } catch (error) {
    return {ok: false, reason: error instanceof Error && error.message === "body too large" ? "body too large" : "body must be a JSON object"};
  }
  // Callers whose contract says "an empty body means the defaults" opt in; the login gateway keeps requiring a value.
  if (emptyAsObject && raw.trim() === "") return { ok: true, record: {} };
  let payload: unknown;
  try {
    payload = JSON.parse(raw) as unknown;
  } catch {
    return { ok: false, reason: "body must be a JSON object" };
  }
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, reason: "body must be a JSON object" };
  }
  const record = payload as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!allowedKeys.has(key)) return { ok: false, reason: "unexpected field " + JSON.stringify(key) };
  }
  return { ok: true, record };
}