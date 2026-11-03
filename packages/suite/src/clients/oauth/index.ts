/**
 * OAuth MCP client bridge (ADR-031).
 * One insert instance = one remote Streamable HTTP MCP server.
 * Auth: MCP-row 登录 uses login-gateway loopback; channel tools use paste.
 * Stale-grant 401 on startup may still start OAuth. Not a settings.plugin.item card.
 */
import { Client, StreamableHTTPClientTransport, auth, UnauthorizedError } from "@modelcontextprotocol/client";
import type { Context } from "@deepseek-ai/cordis";
// Type-only imports of the official seams this client binds at runtime: they put each package's Context
// augmentation in the program (ctx.tools / ctx.credentials / ctx.systemPrompt) without a runtime import.
// Never redeclare those services here: an ambient `declare module` in a non-module file *replaces* the
// real types instead of augmenting them (that mistake broke this repository's whole build on 2026-10-22).
import type {} from "@deepseek-ai/dsh-tools";
import type {} from "@deepseek-ai/dsh-credentials";
import type {} from "@deepseek-ai/dsh-system-prompt";
import z from "@deepseek-ai/schemastery";
import {
  cancelOAuthViaGateway,
  gatewayAvailability,
  requireGateway,
  submitOAuthViaGateway,
  waitOAuthViaGateway,
  type LoginGatewayAvailability,
  type OAuthPreference,
  type OriginSource,
} from "./gateway.js";
import {
  controlPlanePrefix,
  createHttpHandler,
  redactAuthorizationCode,
  HTTP_PREFIX,
  type ConnectionStatus,
  type RuntimeHandle,
  type StatusView,
} from "./http.js";
import type { AuthorizationStarted } from "./oauth-provider.js";
import { activateApplicationWindow } from "../login-gateway/focus.js";
import { SERVER_NAME_PATTERN } from "./names.js";
import { oauthPromptText } from "./prompt.js";
import { GrantOAuthProvider, type CredentialsLike } from "./oauth-provider.js";
import { restoreSession } from "./restore.js";
import { createSerializedResync, syncTools } from "./tools.js";
import { endpointReachable, probeVerdict } from "./probe.js";

export const name = "omnisurge-mcp-oauth-client";
export const inject = ["tools", "credentials"];

const KEY_SEGMENT = /^[a-z][a-z0-9-]*$/;
const DEFAULT_TOOL_CALL_TIMEOUT_MS = 60_000;
const CLIENT_INFO = { name: "dsh-mcp-oauth-client", version: "0.1.8" } as const;
const activeServerNames = new WeakMap<object, Set<string>>();

export interface Config {
  transport: "streamable-http";
  serverName: string;
  url: string;
  credentialId: string;
  failOnStartupError: boolean;
  authorizationTimeoutMs: number;
  toolCallTimeoutMs: number;
  staticClientId: string;
}

export const Config: unknown = z.object({
  transport: z.const("streamable-http").default("streamable-http"),
  serverName: z.string().required().pattern(SERVER_NAME_PATTERN),
  url: z.string().required(),
  credentialId: z.string().default(""),
  failOnStartupError: z.boolean().default(false),
  authorizationTimeoutMs: z.number().default(300_000),
  toolCallTimeoutMs: z.number().default(DEFAULT_TOOL_CALL_TIMEOUT_MS),
  staticClientId: z.string().default(""),
});

interface LoggerLike {
  info(message: string): void;
  error(message: string): void;
}

/** The only web server surface this module touches: route registration (control plane) and the bound origin
 * (login gateway, R1). Declared locally on purpose — the Host seam owns the `ctx.webServer` augmentation
 * (`src/clients/web-server.ts`), and declaring it twice would conflict. */
interface WebServerLike {
  register(route: {
    kind: string;
    path: string;
    handler: (req: never, res: never) => unknown;
  }): () => void;
  getOrigin?(): string;
}

interface ToolsRegisterLike {
  register(definition: {
    name: string;
    description: string;
    parameters: unknown;
    output: unknown;
    execute: (args: unknown, exec: { signal?: AbortSignal }) => Promise<unknown>;
  }): () => void;
}

function credentialIdOf(config: Config): string {
  return config.credentialId.trim() !== "" ? config.credentialId.trim() : config.serverName;
}

function isUnauthorized(error: unknown): boolean {
  if (error instanceof UnauthorizedError) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /unauthor/i.test(message);
}

function localCredentialKey(scope: string, id: string): string {
  if (!KEY_SEGMENT.test(scope) || !KEY_SEGMENT.test(id)) {
    throw new TypeError(`invalid credential key segments: ${scope}/${id}`);
  }
  return `${scope}/${id}`;
}

function authToolName(serverName: string, action: "login" | "submit"): string {
  return `oauth__${serverName}__${action}`;
}

function textToolOutput() {
  return {
    schema: {
      type: "object",
      properties: { content: { type: "array", items: {} } },
      required: ["content"],
      additionalProperties: false,
    },
    render(_args: unknown, value: { content?: unknown }) {
      const first = Array.isArray(value.content) ? value.content[0] : undefined;
      const text = first !== null && typeof first === "object" && "text" in first
        && typeof (first as { text: unknown }).text === "string"
        ? (first as { text: string }).text
        : "";
      return [{ type: "text", text }];
    },
  };
}

function textResult(text: string): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text", text }] };
}

async function apply(ctx: Context, config: Config): Promise<void> {
  const logger = ctx.logger as LoggerLike;
  const credentials = ctx.credentials as unknown as CredentialsLike;
  /** The code the user most recently submitted: the only secret that may leak through an error text. */
  let lastSubmittedCode: string | undefined;
  // ADR-033 R1: the login gateway origin is the host web server's own origin, read at call time (the
  // listener may bind after this plugin starts). No port is guessed — a missing or unbound web server
  // disables login with a readable reason instead of pointing the gateway at an invented address.
  const gateway = (): LoginGatewayAvailability =>
    gatewayAvailability((ctx.get("webServer") as OriginSource | undefined) ?? undefined);
  const cancelInteraction = async (): Promise<void> => {
    const availability = gateway();
    if (availability.ok) await cancelOAuthViaGateway(interactionKey, availability.client);
  };

  ctx.effect(() => {
    let names = activeServerNames.get(ctx.root);
    if (!names) {
      names = new Set();
      activeServerNames.set(ctx.root, names);
    }
    if (names.has(config.serverName)) {
      throw new Error(
        `mcp-oauth-client: serverName "${config.serverName}" already in use — pick a unique serverName`,
      );
    }
    names.add(config.serverName);
    return () => void names.delete(config.serverName);
  }, "mcp-oauth-client.serverName");

  let pendingAuthorizationUrl: string | undefined;
  let pendingPrefer: "loopback" | "paste" | undefined;
  /** ADR-052 D3: the interaction the last `auth()` call began, captured synchronously by the provider hook
   * below (it fires inside redirectToAuthorization, before auth returns). */
  let lastStarted: AuthorizationStarted | undefined;

  const provider = new GrantOAuthProvider({
    credentials,
    credentialKey: (scope, id) => localCredentialKey(scope, id),
    scopeName: name,
    credentialId: credentialIdOf(config),
    clientName: `omnidsh:${config.serverName}`,
    authorizationTimeoutMs: config.authorizationTimeoutMs,
    gateway,
    ...(config.staticClientId.trim() !== "" ? { staticClientId: config.staticClientId.trim() } : {}),
    onAuthorizationStarted(started) {
      // ADR-052 D2: both preferences publish the link — a deferred loopback login is a normal login now, and
      // the page shows the same "open this" affordance while the Host waits in the background.
      pendingPrefer = started.prefer;
      pendingAuthorizationUrl = started.authorizationUrl;
      lastStarted = started;
    },
  });
  await provider.hydrate();
  await provider.ensureRedirectUri();

  /**
   * v2 的 listChanged 是**构造期选项**（v1 是构造后 setNotificationHandler）。
   * v2 收到通知时会自己把列表重取好再回调；我们仍走自己的序列化重同步，
   * 保持既有语义不变（代价是多一次 listTools）。
   */
  const resync = createSerializedResync(async () => {
    logger.info(`mcp-oauth-client(${config.serverName}): tool list changed, re-syncing`);
    disposers = await syncTools(client, ctx.tools as never, opts, disposers, logger);
  });

  const createClient = (): Client =>
    new Client(CLIENT_INFO, {
      capabilities: {},
      listChanged: {
        tools: {
          onChanged: (error: unknown) => {
            if (error) {
              logger.error(`mcp-oauth-client(${config.serverName}): tool list refresh failed: ${redactAuthorizationCode(String(error), lastSubmittedCode)}`);
              return;
            }
            void resync.schedule().catch((e: unknown) =>
              logger.error(`mcp-oauth-client(${config.serverName}): tool re-sync failed: ${redactAuthorizationCode(String(e), lastSubmittedCode)}`));
          },
        },
      },
    });

  let client = createClient();
  const interactionKey = localCredentialKey(name, credentialIdOf(config));
  let transport = new StreamableHTTPClientTransport(new URL(config.url), { authProvider: provider });
  let disposers = new Map<string, () => void>();
  let status: ConnectionStatus = provider.isAuthorized() || provider.hasRefreshToken() ? "idle" : "needs_login";

  /** 探测超时：必须短——UI 每 4s 轮询一次。 */
  const PROBE_TIMEOUT_MS = 3000;
  /** 连续失败多少次才判死。1 会抖（与 dual 侧同样的教训）。 */
  const PROBE_FAIL_THRESHOLD = 2;
  /** 迟滞计数器：单次失败不翻脸（重启后的旧连接、网络抖动都会这样）。 */
  let probeFailures = 0;

  let lastError: string | undefined;

  const opts = {
    serverName: config.serverName,
    toolCallTimeoutMs: config.toolCallTimeoutMs,
    registrationFailure: (config.failOnStartupError ? "throw" : "contain") as "throw" | "contain",
  };

  const clearTools = (): void => {
    for (const dispose of disposers.values()) dispose();
    disposers = new Map();
  };

  const closeClient = async (): Promise<void> => {
    clearTools();
    try {
      await client.close();
    } catch {
      /* ignore */
    }
  };

  const rebuild = (): void => {
    client = new Client(CLIENT_INFO, { capabilities: {} });
    transport = new StreamableHTTPClientTransport(new URL(config.url), { authProvider: provider });
  };

  const connectAndSync = async (): Promise<void> => {
    await client.connect(transport);
    disposers = await syncTools(client, ctx.tools as never, opts, disposers, logger);
    status = "connected";
    lastError = undefined;
    clearPendingAuthorization();
  };

  const silentRefresh = async (): Promise<"AUTHORIZED" | "REDIRECT"> => {
    provider.setSilent(true);
    try {
      return await auth(provider, { serverUrl: config.url });
    } finally {
      provider.setSilent(false);
    }
  };

  const connectOrReset = async (): Promise<void> => {
    try {
      await connectAndSync();
    } catch (error) {
      if (isUnauthorized(error)) {
        await closeClient();
        rebuild();
      }
      throw error;
    }
  };

  const recoverGrant = (): ReturnType<typeof restoreSession> =>
    restoreSession({
      hasAccess: provider.isAuthorized(),
      hasRefresh: provider.hasRefreshToken(),
      connect: connectOrReset,
      silentRefresh,
      isUnauthorized,
    });

  /**
   * ADR-052 D3: the one in-flight sign-in this runtime owns. Registered here, cancelled from `cancel`,
   * `logout`, `login`, `ctx` teardown or a row-disable. `settled` is the second half of the guard: an
   * abort may race the moment the wait resolves, and a result that arrives after cancellation must not be
   * applied on top of "the user asked for this to stop".
   */
  interface PendingLogin {
    readonly controller: AbortController;
    readonly startedAt: string;
    settled: boolean;
  }
  let pendingLogin: PendingLogin | undefined;

  /**
   * One pending-authorization record feeds both shapes in StatusView (new nested `authorization` and the legacy
   * flat `authorizationUrl`/`prefer`), so they cannot disagree. `state:'waiting'` is exactly "a background wait
   * is registered"; the URL/prefer are present whenever there is a link the user could still open — a paste
   * login waits for the person, not for the Host, so it stays `idle` while still publishing its link.
   */
  const authorizationView = (): StatusView["authorization"] => {
    const startedAt = pendingLogin?.startedAt;
    return {
      state: pendingLogin === undefined ? "idle" : "waiting",
      ...(pendingAuthorizationUrl !== undefined ? { authorizationUrl: pendingAuthorizationUrl } : {}),
      ...(pendingPrefer !== undefined ? { prefer: pendingPrefer } : {}),
      ...(startedAt !== undefined ? { startedAt } : {}),
    };
  };

  const getStatus = (): StatusView => {
    const authorization = authorizationView();
    return {
      serverName: config.serverName,
      url: config.url,
      status,
      toolCount: disposers.size,
      toolNames: [...disposers.keys()],
      authorized: provider.isAuthorized(),
      ...(lastError !== undefined ? { error: lastError } : {}),
      authorization,
      // Legacy flat mirror of the same record (see StatusView): one source, read twice.
      ...(authorization.authorizationUrl !== undefined ? { authorizationUrl: authorization.authorizationUrl } : {}),
      ...(authorization.prefer !== undefined ? { prefer: authorization.prefer } : {}),
    };
  };

  const clearPendingAuthorization = (): void => {
    pendingAuthorizationUrl = undefined;
    pendingPrefer = undefined;
  };

  /** The interaction the last `auth()` call began, read at call time (the provider hook writes it mid-call). */
  const currentStarted = (): AuthorizationStarted | undefined => lastStarted;

  /** Ends the in-flight attempt without waiting for it: the aborted wait resolves as 'cancelled' in the
   * background task, which then sees `settled` and stands down. Never throws. */
  const settlePendingLogin = (): PendingLogin | undefined => {
    const current = pendingLogin;
    if (current === undefined) return undefined;
    pendingLogin = undefined;
    current.settled = true;
    try {
      current.controller.abort();
    } catch {
      // An abort listener that throws must not stop the state transition below.
    }
    return current;
  };

  const finishWithCode = async (): Promise<void> => {
    const code = provider.takeAuthorizationCode();
    await transport.finishAuth(code);
    await connectAndSync();
  };

  /**
   * ADR-052 D3/D5: the registered background wait. Everything that can fail is turned into one of two states
   * here — never an unhandled rejection, never a silent idle: a refusal/timeout/abort lands on
   * `needs_login` with a readable reason, and only a real authorization reaches `connected`.
   */
  const runDeferredLogin = async (pending: PendingLogin, started: AuthorizationStarted): Promise<void> => {
    const fail = (message: string): void => {
      if (pending.settled) return;
      pending.settled = true;
      if (pendingLogin === pending) pendingLogin = undefined;
      clearPendingAuthorization();
      lastError = redactAuthorizationCode(message, lastSubmittedCode);
      // The grant may still hold tokens from an earlier session; then this is not "needs login" but a
      // connection problem the user can retry, exactly as the synchronous path reports it.
      status = provider.isAuthorized() || provider.hasRefreshToken() ? "error" : "needs_login";
      logger.error(`mcp-oauth-client(${config.serverName}): background authorization failed: ${lastError}`);
    };
    try {
      const availability = gateway();
      if (!availability.ok) {
        fail(`login gateway unavailable: ${availability.reason}`);
        return;
      }
      const outcome = await waitOAuthViaGateway(started.id, availability.client, pending.controller.signal);
      if (pending.settled) return;
      if (outcome.status !== "authorized") {
        // 'cancelled' also lands here: the gateway only cancels an interaction when this runtime (or the
        // gateway's own timeout) ended it, and the user must see that nothing is connected.
        fail(
          outcome.status === "cancelled"
            ? "authorization cancelled"
            : `${outcome.code}: ${outcome.message}`,
        );
        return;
      }
      // The exchange itself is not cancellable on purpose: the code is already spent at the provider, so
      // dropping the half-written grant would leave the stored state behind reality. A cancel that arrives
      // *during* the exchange therefore converges here, to the connected view it would have reached anyway.
      provider.applyOutcome(outcome);
      // ADR-052 credential red line (review S4): the loopback code reaches this runtime through the gateway, not
      // through `submitCode`, so `lastSubmittedCode` — the one secret every diagnostic is scrubbed against — was
      // never set on this path. A custom authorization server that repeats the code in an error_description, or a
      // transport that echoes the request URL, would then print it in the row's technical diagnostics. Record the
      // code as a redaction secret for the whole exchange window and drop it as soon as the exchange is done.
      lastSubmittedCode = outcome.code;
      // Cleared only on SUCCESS. Clearing it in a `finally` would defeat the point: the throw leaves this block
      // before the outer catch calls fail(), and fail() redacts against this variable — with it already undefined
      // the scrub is a no-op and the code the provider echoed lands in the row's technical diagnostics (review
      // S4-2). The paste path (submitCode) already redacts inside its own catch for the same reason.
      await finishWithCode();
      lastSubmittedCode = undefined;
      pending.settled = true;
      if (pendingLogin === pending) pendingLogin = undefined;
      clearPendingAuthorization();
      // connectAndSync already set 'connected' and cleared lastError; the view is recomputed by callers.
      // ADR-056 (ADR-052 D4 焦点承接点): the callback landed in the browser, and the tab it left behind usually
      // cannot close itself. The fact the user needs — "this row is now connected" — is in the app window, so
      // ask the OS to bring this application forward. Silent by contract: it returns a machine fact, never a
      // throw, and a failure here must not undo a successful authorization.
      activateApplicationWindow();
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error));
    }
  };

  const startDeferredLogin = (started: AuthorizationStarted): void => {
    const pending: PendingLogin = {
      controller: new AbortController(),
      startedAt: new Date().toISOString(),
      settled: false,
    };
    pendingLogin = pending;
    // Deliberately not awaited, but never floating: runDeferredLogin resolves every path into a state and
    // catches its own errors, so this promise cannot reject.
    void runDeferredLogin(pending, started);
  };

  const runLogin = async (mode: { prefer: OAuthPreference; deferWait: boolean }): Promise<StatusView> => {
    // ADR-052 D5 (single flight): while a background wait is registered, a second login answers the current
    // view — including authorization.state='waiting' — instead of starting a second interaction. The gateway
    // would refuse the new key with 409 in_flight anyway; that refusal is an error the page cannot act on,
    // while the current view is exactly the fact it needs.
    if (pendingLogin !== undefined) {
      logger.info(`mcp-oauth-client(${config.serverName}): login requested while waiting — answering the current view`);
      return getStatus();
    }
    // Fail before touching connection state: a login whose gateway is unavailable must not look like an
    // attempt that already started. ADR-033 R1 — the reason is readable, and it names no port.
    requireGateway(gateway());
    lastError = undefined;
    clearPendingAuthorization();
    status = "idle";
    await cancelInteraction();
    await closeClient();
    rebuild();
    await provider.ensureRedirectUri();
    provider.setInteractionMode(mode);
    lastStarted = undefined;
    logger.info(
      mode.prefer === "paste"
        ? `mcp-oauth-client(${config.serverName}): starting paste OAuth`
        : `mcp-oauth-client(${config.serverName}): opening browser for OAuth`,
    );
    let first: Awaited<ReturnType<typeof auth>>;
    try {
      first = await auth(provider, { serverUrl: config.url });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // ADR-052 D5: the gateway refuses a second interaction for the same key with in_flight. That is not a
      // failure the page can act on — it means another sign-in for this server is already under way — so it is
      // answered with a readable view instead of a 400. Our own background wait is caught earlier, before any
      // state is touched; this path covers an interaction this runtime does not own (a leftover from a crash,
      // or a second owner of the same credential key).
      if (message.startsWith("in_flight")) {
        clearPendingAuthorization();
        status = provider.isAuthorized() || provider.hasRefreshToken() ? "idle" : "needs_login";
        lastError = "an authorization is already in progress for this server";
        logger.info(`mcp-oauth-client(${config.serverName}): login already in flight elsewhere`);
        return getStatus();
      }
      // A login that fails before its interaction exists must not leave a link behind: the status view would
      // keep advertising an authorization the user cannot complete.
      clearPendingAuthorization();
      throw error;
    }
    if (mode.deferWait) {
      // A deferred login has not connected yet: the page must show the actionable state, not a transient idle.
      if (!provider.isAuthorized() && !provider.hasRefreshToken()) status = "needs_login";
      // ADR-052 D3: the page gets the view, the Host keeps waiting. The interaction id comes from the provider
      // hook that fired inside redirectToAuthorization — never re-derived from a second gateway call.
      // Only a loopback interaction has a callback to wait for: the paste flow is completed by /submit, and a
      // background wait there would both claim the gateway's single wait and race the submit for the exchange.
      // Read through the accessor: `lastStarted` is written by the provider hook *during* `auth()`, so a direct
      // read would be narrowed to `undefined` by the assignment above.
      const startedNow = currentStarted();
      if (first === "REDIRECT" && startedNow !== undefined && startedNow.prefer === "loopback") {
        startDeferredLogin(startedNow);
      }
      return getStatus();
    }
    if (first === "REDIRECT") await finishWithCode();
    else await connectAndSync();
    return getStatus();
  };

  const completePaste = async (code: string, state?: string): Promise<StatusView> => {
    const id = provider.takePendingInteractionId();
    const submitted = await submitOAuthViaGateway(
      id,
      { code, ...(state !== undefined && state !== "" ? { state } : {}) },
      requireGateway(gateway()),
    );
    if (!submitted.accepted) {
      throw new Error(`${submitted.code}: ${submitted.message}`);
    }
    await provider.completePendingAuthorization();
    await finishWithCode();
    return getStatus();
  };

  const runtime: RuntimeHandle = {
    getStatus,
    async probe() {
      // 只看端点活没活。**不做恢复**——oauth 的 needs_login 是合法状态，
      // 探针无权改动它；恢复走既有的 reconnect / login 通路。
      const alive = await endpointReachable(config.url, PROBE_TIMEOUT_MS);
      if (alive) {
        probeFailures = 0;
        return getStatus();
      }
      probeFailures += 1;
      lastError = "endpoint unreachable";
      if (probeVerdict(probeFailures, PROBE_FAIL_THRESHOLD) === "dead") status = "error";
      return getStatus();
    },
    async login(mode) {
      // ADR-034 D2: the control plane / agent tool / page are entry points; this canonical call keeps the
      // 0.2.0-3 default when nothing is named, and only overrides what the caller explicitly asked for.
      return runLogin({ prefer: mode?.prefer ?? "loopback", deferWait: mode?.deferWait ?? false });
    },
    async logout() {
      // ADR-052 D5: logout ends an in-flight background wait before it drops the grant — a callback arriving
      // afterwards must not re-authorize a session the user just ended.
      settlePendingLogin();
      // Logout stays available when login is not: cancelling a pending interaction is best effort, and a
      // host without a web server still owns a grant the user asked to drop.
      const availability = gateway();
      if (availability.ok) await cancelOAuthViaGateway(interactionKey, availability.client);
      await closeClient();
      await provider.invalidateCredentials("all");
      rebuild();
      status = "needs_login";
      lastError = undefined;
      clearPendingAuthorization();
      return getStatus();
    },
    async cancel() {
      // ADR-052 D2: cancel is idempotent and never throws. With nothing in flight it answers the current view,
      // so the page can keep one button without a state-dependent special case.
      const pending = settlePendingLogin();
      if (pending === undefined) return getStatus();
      const availability = gateway();
      if (availability.ok) await cancelOAuthViaGateway(interactionKey, availability.client);
      // The gateway interaction is gone, so nothing can connect this session: the honest state is "log in
      // again", and the in-memory code, if any, is dropped with it.
      clearPendingAuthorization();
      provider.dropPendingAuthorization();
      status = "needs_login";
      lastError = undefined;
      logger.info(`mcp-oauth-client(${config.serverName}): login cancelled`);
      return getStatus();
    },
    async reconnect() {
      // ADR-052 D5: reconnecting replaces the connection a background wait would have completed, so that wait
      // ends here rather than racing the new one.
      settlePendingLogin();
      clearPendingAuthorization();
      lastError = undefined;
      await closeClient();
      rebuild();
      try {
        const outcome = await recoverGrant();
        if (outcome === "needs_login") status = "needs_login";
        else if (outcome === "stale_grant") await runLogin({ prefer: "auto", deferWait: false });
      } catch (error) {
        lastError = redactAuthorizationCode(error instanceof Error ? error.message : String(error), lastSubmittedCode);
        status = provider.isAuthorized() || provider.hasRefreshToken() ? "error" : "needs_login";
      }
      return getStatus();
    },
    async submitCode(code, state) {
      // ADR-052 D5 (single owner of the exchange): while a background wait owns this interaction, a submit
      // would be a second code exchange for the same login. Refuse readably instead of racing it.
      if (pendingLogin !== undefined) {
        throw new Error("an authorization is already in progress for this server");
      }
      lastSubmittedCode = code;
      try {
        const view = await completePaste(code, state);
        // Success retires the secret: a later, unrelated failure must not be redacted against a stale code.
        lastSubmittedCode = undefined;
        return view;
      } catch (error) {
        // ADR-034 D2d: the canonical entry point is where a code is known, so it is where the redaction happens.
        // The readable reason is also the status error the page shows, so it is redacted on both surfaces.
        const message = redactAuthorizationCode(error instanceof Error ? error.message : String(error), code);
        lastError = message;
        throw new Error(message);
      }
    },
  };

  const loginTool = authToolName(config.serverName, "login");
  const submitTool = authToolName(config.serverName, "submit");
  const registerAuthTools = (): (() => void) => {
    const tools = ctx.tools as unknown as ToolsRegisterLike;
    const stopLogin = tools.register({
      name: loginTool,
      description:
        `Start OAuth sign-in for MCP server "${config.serverName}". Returns an authorization URL to send to the user. Do not invent the URL.`,
      parameters: { type: "object", properties: {}, additionalProperties: false },
      output: textToolOutput(),
      execute: async () => {
        const view = await runtime.login({ prefer: "paste", deferWait: true });
        const url = view.authorizationUrl;
        if (url === undefined || url === "") {
          throw new Error(`mcp-oauth-client(${config.serverName}): paste login did not return an authorization URL`);
        }
        return textResult(
          `Open this URL to authorize ${config.serverName}, then send back the code from the page or address bar:\n${url}`,
        );
      },
    });
    const stopSubmit = tools.register({
      name: submitTool,
      description:
        `Submit the authorization code the user pasted after opening the ${config.serverName} sign-in URL. Never repeat the code in your reply.`,
      parameters: {
        type: "object",
        properties: {
          code: { type: "string", description: "Authorization code the user pasted. Do not echo it." },
          state: { type: "string", description: "Optional OAuth state if the user pasted it." },
        },
        required: ["code"],
        additionalProperties: false,
      },
      output: textToolOutput(),
      execute: async (args) => {
        const record = args !== null && typeof args === "object" ? args as Record<string, unknown> : {};
        const code = typeof record.code === "string" ? record.code.trim() : "";
        if (code === "") throw new Error("code is required");
        const state = typeof record.state === "string" ? record.state.trim() : undefined;
        await runtime.submitCode(code, state === "" ? undefined : state);
        return textResult(`${config.serverName} is signed in.`);
      },
    });
    return () => {
      stopLogin();
      stopSubmit();
    };
  };
  let stopAuthTools: (() => void) | undefined;
  const withdrawAuthTools = (): void => {
    if (stopAuthTools === undefined) return;
    stopAuthTools();
    stopAuthTools = undefined;
  };
  /** ADR-034 D2d: the page owns the flow whenever the host has a web server service at all. Whether its origin
   * is bound yet is not the question — an unbound origin gives the page a readable gateway reason, while the
   * agent tools would be a second entry point the page contradicts. */
  const pageServicePresent = (): boolean => (ctx.get("webServer") as OriginSource | undefined) !== undefined;
  let authToolsDisposed = false;
  const settleAuthTools = (): void => {
    // Unmount is final. The nested web-server cleanup may run after the outer one, and by then the service is
    // gone — without this guard it would register the headless tools back into a disposed plugin.
    if (authToolsDisposed) return;
    if (pageServicePresent()) {
      withdrawAuthTools();
      return;
    }
    if (stopAuthTools === undefined) stopAuthTools = registerAuthTools();
  };
  ctx.effect(() => {
    settleAuthTools();
    return () => {
      authToolsDisposed = true;
      withdrawAuthTools();
    };
  }, "mcp-oauth-client.auth-tools");
  ctx.inject(["webServer"], (webCtx) => {
    // The listener may bind after this plugin starts (the desktop host binds --port 0), so retirement is
    // reactive: the moment the page becomes usable the headless tools are withdrawn, and they come back only
    // if the page goes away again.
    webCtx.effect(() => {
      settleAuthTools();
      // The service can also go away again: then the page is gone and the headless tools must come back.
      return () => {
        settleAuthTools();
      };
    }, "mcp-oauth-client.auth-tools-retirement");
  });

  ctx.inject(["systemPrompt"], (promptCtx) => {
    promptCtx.effect(
      () =>
        promptCtx.systemPrompt.section({
          name: `omnidsh:mcp-oauth:${config.serverName}`,
          order: 40,
          text: () => oauthPromptText({
            serverName: config.serverName,
            connected: status === "connected" || provider.isAuthorized(),
            pageAvailable: pageServicePresent(),
            loginTool,
            submitTool,
          }),
        }),
      "mcp-oauth-client.prompt",
    );
  });

  ctx.inject(["webServer"], (webCtx) => {
    // Read the service structurally: the Host seam owns the `ctx.webServer` augmentation
    // (`src/clients/web-server.ts`), and a second `declare module` for the same service would conflict.
    const webServer = (webCtx as unknown as { webServer?: WebServerLike }).webServer;
    if (webServer === undefined) return;
    const prefix = controlPlanePrefix(config.serverName);
    webCtx.effect(
      () =>
        webServer.register({
          kind: "prefix",
          path: prefix,
          handler: createHttpHandler(runtime, config.serverName),
        }),
      "mcp-oauth-client.http",
    );
  });

  try {
    const outcome = await recoverGrant();
    if (outcome === "needs_login") {
      logger.info(`mcp-oauth-client(${config.serverName}): no grant — waiting for explicit login`);
      status = "needs_login";
    } else if (outcome === "stale_grant") {
      logger.info(`mcp-oauth-client(${config.serverName}): grant rejected — starting browser OAuth`);
      await runLogin({ prefer: "auto", deferWait: false });
    }
  } catch (error) {
    const message = redactAuthorizationCode(error instanceof Error ? error.message : String(error), lastSubmittedCode);
    lastError = message;
    status = isUnauthorized(error) ? "needs_login" : "error";
    logger.error(`mcp-oauth-client(${config.serverName}): startup failed: ${message}`);
    if (config.failOnStartupError) {
      throw new Error(`mcp-oauth-client(${config.serverName}): initial connection failed`, { cause: error });
    }
  }

  ctx.effect(
    () => () => {
      // ADR-052 D5: an unload must end the background wait. The task is registered here, so the disposer is the
      // one place that both aborts our side of the wait and asks the gateway to close the interaction — an
      // aborted fetch alone would leave the gateway's loopback listener running until its own timeout.
      const pending = settlePendingLogin();
      clearPendingAuthorization();
      if (pending !== undefined) {
        // Not awaited: a disposer cannot hold the unmount, and the call is best-effort by contract
        // (cancelOAuthViaGateway already answers false instead of throwing when the gateway is gone).
        void cancelInteraction().catch(() => {});
      }
    },
    "mcp-oauth-client.authorization",
  );

  ctx.effect(() => async () => {
    await closeClient();
  }, "mcp-oauth-client.connection");
}

export { apply, HTTP_PREFIX, controlPlanePrefix };
// Verification surface (ADR-033). The carried module ships as ONE bundled file (lib/mcp-oauth.js) and the
// per-file tsc tree is removed from the published generation, so the unit tests reach the ported building
// blocks through this entry instead of per-file modules — the same reason the upstream suite exported its
// tool helpers here. These are the exact functions the runtime calls: exporting them adds no second
// implementation, and a row loader only reads `name`/`inject`/`Config`/`apply`.
export { createSerializedResync, syncTools } from "./tools.js";
export { publicToolName, SERVER_NAME_PATTERN } from "./names.js";
export { createHttpHandler, isDcrFailure, redactAuthorizationCode, LOGIN_MODE_INVALID } from "./http.js";
export { oauthPromptText } from "./prompt.js";
export { allocateLoopbackRedirect, parseLoopbackRedirect } from "./redirect.js";
export { SilentAuthorizationRequired, isSilentAuthorizationRequired, restoreSession } from "./restore.js";
export { endpointReachable, probeVerdict } from "./probe.js";
export {
 GRANT_UNSERIALIZABLE,
 GrantUnserializableError,
 emptyGrant,
 hasAccessToken,
 hasRefreshToken,
 mergeRotatedTokens,
 normalizeGrantPayload,
 parseGrantPayload,
} from "./grant.js";
export {
 LoginGatewayUnavailable,
 beginOAuthViaGateway,
 cancelOAuthViaGateway,
 createGatewayClient,
 gatewayAvailability,
 requireGateway,
 startOAuthViaGateway,
 submitOAuthViaGateway,
 waitOAuthViaGateway,
} from "./gateway.js";
export { GrantOAuthProvider } from "./oauth-provider.js";
export type { StatusView, ConnectionStatus };
