/** The typed surface of the carried module in lib/mcp-oauth.js (ADR-033).
 *
 * The runtime artifact is a single bundled file, so the per-file declarations tsc produced are not shipped
 * (the published generation stays flat). This declares only what a row loader or a type consumer reads; the
 * bundle itself is authoritative for behaviour. The verification surface the unit tests reach through the
 * bundle (tools/names/http/redirect/restore/probe/grant/gateway helpers) is intentionally not mirrored here:
 * it is not a contract of the carried module, and the bundle's own exports define it.
 */
export declare const name: string;
export declare const inject: readonly string[];
export declare const Config: unknown;
export declare function apply(ctx: unknown, config: unknown): Promise<void>;
export declare const HTTP_PREFIX: string;
export declare function controlPlanePrefix(serverName: string): string;
export declare function createHttpHandler(runtime: unknown, serverName: string): (req: unknown, res: unknown) => void;
