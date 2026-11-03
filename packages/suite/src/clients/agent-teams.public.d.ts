/** The typed surface of the carried module in lib/agent-teams.js (ADR-033 / ADR-062).
 *
 * The runtime artifact is a single bundled file, so the per-file declarations tsc produced are not shipped
 * (the published generation stays flat). This declares only what a row loader reads.
 */
export declare const name: string;
export declare const inject: readonly string[];
export declare const Config: unknown;
export declare const LimitMode: unknown;
export declare function apply(ctx: unknown, config?: unknown): void;
