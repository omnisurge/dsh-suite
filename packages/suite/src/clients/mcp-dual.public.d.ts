/** The typed surface of the carried module in lib/mcp-dual.js (ADR-033).
 *
 * The runtime artifact is a single bundled file, so the per-file declarations tsc produced are not shipped
 * (the published generation stays flat). This declares only what a row loader or a type consumer reads; the
 * bundle itself is authoritative for behaviour.
 */
export declare const name: string;
export declare const inject: readonly string[];
export declare const Config: unknown;
export declare function apply(ctx: unknown, config: unknown): Promise<void>;
export declare const HTTP_PREFIX: string;
export declare function controlPlanePrefix(serverName: string): string;
export declare function createHttpHandler(runtime: unknown, serverName: string): (req: unknown, res: unknown) => void;
export declare const VERSION_NEGOTIATION: { readonly mode: "auto" };
export declare const CLIENT_INFO: { readonly name: string; readonly version: string };
export declare function publicToolName(serverName: string, rawName: string): string;
export declare const SERVER_NAME_PATTERN: RegExp;
