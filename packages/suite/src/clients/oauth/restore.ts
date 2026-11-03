/** Restart / 401 restore: refresh first, human login only if the grant is stale. */

export class SilentAuthorizationRequired extends Error {
  constructor() {
    super("silent_refresh_required");
    this.name = "SilentAuthorizationRequired";
  }
}

export function isSilentAuthorizationRequired(error: unknown): boolean {
  return error instanceof SilentAuthorizationRequired
    || (error instanceof Error && error.name === "SilentAuthorizationRequired");
}

export type RestoreOutcome = "connected" | "stale_grant" | "needs_login";

export interface RestoreSessionOpts {
  readonly hasAccess: boolean;
  readonly hasRefresh: boolean;
  connect(): Promise<void>;
  silentRefresh(): Promise<"AUTHORIZED" | "REDIRECT">;
  isUnauthorized(error: unknown): boolean;
}

/**
 * Try the stored access token, then a silent refresh.
 * `stale_grant` = had a grant that no longer works (caller may open the browser).
 * `needs_login` = never had a grant (do not open the browser).
 */
export async function restoreSession(opts: RestoreSessionOpts): Promise<RestoreOutcome> {
  if (opts.hasAccess) {
    try {
      await opts.connect();
      return "connected";
    } catch (error) {
      if (!opts.isUnauthorized(error)) throw error;
    }
  }
  if (!opts.hasRefresh) {
    return opts.hasAccess ? "stale_grant" : "needs_login";
  }
  try {
    const result = await opts.silentRefresh();
    if (result !== "AUTHORIZED") return "stale_grant";
    await opts.connect();
    return "connected";
  } catch (error) {
    if (isSilentAuthorizationRequired(error) || opts.isUnauthorized(error)) {
      return "stale_grant";
    }
    throw error;
  }
}
