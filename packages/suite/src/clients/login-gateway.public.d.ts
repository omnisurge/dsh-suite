/** The typed surface of the carried module in lib/login-gateway.js (ADR-033).
 *
 * The runtime artifact is a single bundled file, so the per-file declarations tsc produced are not shipped
 * (the published generation stays flat). This declares only what a row loader or a type consumer reads; the
 * bundle itself is authoritative for behaviour.
 */
export declare const name: string;
export declare const inject: readonly string[];
export declare const Config: unknown;
export declare function apply(ctx: unknown, config?: unknown): void;
/** ADR-057: resolves the row's browser preference into the opener the interaction core uses. Exported so the
 * default (the real system launcher) and the switched-off no-op are asserted by identity. */
export declare function authorizationBrowserOpener(config?: unknown): (url: string) => void;
export declare function openSystemBrowser(url: string): void;
export declare const OAUTH_PREFIX: string;
export declare const OAUTH_START_PATH: string;
export declare const OAUTH_CANCEL_PATH: string;
export declare function createOAuthHttpHandler(deps?: unknown): (req: unknown, res: unknown) => void;
export declare function parseOAuthPreference(value: unknown): "loopback" | "paste" | "auto" | undefined;
export declare function resetPendingForTests(): void;
