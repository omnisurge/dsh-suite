import type { Context } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";
import { createOAuthHttpHandler, OAUTH_PREFIX } from "./http.js";
import { beginOAuthInteraction, cancelOAuthInteraction, cancelOAuthInteractionByKey, openSystemBrowser, submitOAuthCode, waitForOAuthResult } from "./oauth-interaction.js";

export * from "./http.js";
export * from "./oauth-interaction.js";
// ADR-056: the window-focus seam belongs to this module's contract, and it is asserted against the *built*
// artifact (test/login-gateway-focus.test.mjs). Exporting it here keeps that assertion on shipped bytes instead of
// an internal subpath the bundle never keeps.
export * from "./focus.js";

export const name = "omnisurge-login-gateway";
export const inject: string[] = [];

/** ADR-057: one preference, one meaning. `false` means "never launch a browser for me"; everything else about
 * the loopback flow (listener, URL, callback, result page) stays exactly the same, so turning it off cannot
 * break signing in — the page still renders the URL as a real link. */
export interface LoginGatewayConfig {
  openAuthorizationInBrowser: boolean;
}
export const Config = z.object({
  openAuthorizationInBrowser: z.boolean().default(true).description(
    "Open the authorization URL in the system default browser when a loopback sign-in starts. Turn off on a machine without a usable browser, or to keep the browser you are working in: the page still shows the URL.",
  ),
});

/** The opener this module should use, given the row config. Exported and asserted by identity so that "the
 * default still opens the real browser" is a checked fact rather than an assumption (ADR-057). */
export function authorizationBrowserOpener(config: Partial<LoginGatewayConfig> | undefined): (url: string) => void {
  return config?.openAuthorizationInBrowser === false ? () => {} : openSystemBrowser;
}

/** Cordis is only the lifecycle wrapper around the pure OAuth core. */
export function apply(ctx: Context, config: Partial<LoginGatewayConfig> = {}): void {
  // ADR-057: resolve the preference once per apply (a Cordis config is not volatile, so this is the live value
  // for the lifetime of the row) and hand it to the interaction core through the same dependency seam the
  // gates use. Everything else keeps the module defaults.
  const openBrowser = authorizationBrowserOpener(config);
  ctx.inject(["webServer"], (webCtx) => {
    // Runtime service read structurally (same shape host.ts uses for its origin); no augmentation needed.
    const webServer = webCtx.get("webServer") as {
      register(route: { kind: string; path: string; handler: (req: never, res: never) => unknown }): () => void;
    };
    webCtx.effect(
      () =>
        webServer.register({
          kind: "prefix",
          path: OAUTH_PREFIX,
          handler: createOAuthHttpHandler({
            begin: (request) => beginOAuthInteraction(request, { openBrowser }),
            submit: submitOAuthCode,
            wait: waitForOAuthResult,
            cancel: cancelOAuthInteraction,
            cancelByKey: cancelOAuthInteractionByKey,
          }) as (req: never, res: never) => void,
        }),
      "login-gateway.oauth",
    );
  });
}
