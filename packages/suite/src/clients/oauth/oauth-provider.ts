/** OAuthClientProvider backed by ctx.credentials grant records. */
import type { OAuthClientProvider, OAuthDiscoveryState } from "@modelcontextprotocol/client";
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/client";
import {
  beginOAuthViaGateway,
  requireGateway,
  startOAuthViaGateway,
  waitOAuthViaGateway,
  type LoginGatewayAvailability,
  type LoginGatewayResult,
  type OAuthPreference,
  type StartedOAuthInteraction,
} from "./gateway.js";
import {
  emptyGrant,
  hasAccessToken,
  hasRefreshToken,
  mergeRotatedTokens,
  normalizeGrantPayload,
  parseGrantPayload,
  type McpOAuthGrantPayload,
} from "./grant.js";
import { allocateLoopbackRedirect, newOAuthState } from "./redirect.js";
import { SilentAuthorizationRequired } from "./restore.js";

export type CredentialKeyLike = string;

export interface CredentialsLike {
  readRecord(key: CredentialKeyLike): Promise<{ kind: string; payload?: unknown } | undefined>;
  modifyRecord(
    key: CredentialKeyLike,
    mutate: (current: { kind: string; payload?: unknown } | undefined) => Promise<
      { kind: "grant"; payload: unknown } | undefined
    >,
  ): Promise<unknown>;
  deleteRecord(key: CredentialKeyLike): Promise<void>;
}

export interface CredentialKeyFactory {
  (scope: string, id: string): CredentialKeyLike;
}

export type AuthorizationStarted = Pick<StartedOAuthInteraction, "id" | "prefer" | "authorizationUrl">;

export interface GrantOAuthProviderOptions {
  readonly credentials: CredentialsLike;
  readonly credentialKey: CredentialKeyFactory;
  readonly scopeName: string;
  readonly credentialId: string;
  readonly clientName: string;
  readonly authorizationTimeoutMs: number;
  /** Resolved per attempt, not captured: the host may bind its web server after this plugin starts, and a
   * login must use the origin that exists when the user asks for it (ADR-033 R1). */
  readonly gateway: () => LoginGatewayAvailability;
  readonly staticClientId?: string;
  readonly onAuthorizationStarted?: (started: AuthorizationStarted) => void;
}

export class GrantOAuthProvider implements OAuthClientProvider {
  private redirectUri = "";
  private pendingCode: string | undefined;
  private expectedState: string | undefined;
  private pendingInteractionId: string | undefined;
  private prefer: OAuthPreference = "auto";
  private deferWait = false;
  private silent = false;
  private memory: McpOAuthGrantPayload = emptyGrant();
  private readonly opts: GrantOAuthProviderOptions;

  constructor(opts: GrantOAuthProviderOptions) {
    this.opts = opts;
  }

  setInteractionMode(mode: { prefer: OAuthPreference; deferWait: boolean }): void {
    this.prefer = mode.prefer;
    this.deferWait = mode.deferWait;
  }

  setSilent(silent: boolean): void {
    this.silent = silent;
  }

  private key(): CredentialKeyLike {
    return this.opts.credentialKey(this.opts.scopeName, this.opts.credentialId);
  }

  async hydrate(): Promise<void> {
    const record = await this.opts.credentials.readRecord(this.key());
    if (record?.kind === "grant") {
      this.memory = parseGrantPayload(record.payload);
      if (typeof this.memory.redirectUri === "string" && this.memory.redirectUri !== "") {
        this.redirectUri = this.memory.redirectUri;
      }
    }
  }

  async ensureRedirectUri(): Promise<string> {
    if (this.redirectUri !== "") return this.redirectUri;
    if (typeof this.memory.redirectUri === "string" && this.memory.redirectUri !== "") {
      this.redirectUri = this.memory.redirectUri;
      return this.redirectUri;
    }
    const allocated = await allocateLoopbackRedirect("/callback");
    this.redirectUri = allocated.redirectUri;
    await this.patchGrant((current) => ({ ...current, redirectUri: this.redirectUri }));
    return this.redirectUri;
  }

  get redirectUrl(): string {
    return this.redirectUri;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: this.opts.clientName,
      redirect_uris: [this.redirectUri || "http://127.0.0.1/callback"],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: "mcp:use",
    };
  }

  state(): string {
    this.expectedState = newOAuthState();
    return this.expectedState;
  }

  async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
    if (this.memory.client !== undefined) return this.memory.client;
    if (this.opts.staticClientId !== undefined && this.opts.staticClientId !== "") {
      return { client_id: this.opts.staticClientId };
    }
    return undefined;
  }

  async saveClientInformation(clientInformation: OAuthClientInformationMixed): Promise<void> {
    await this.patchGrant((current) => ({ ...current, client: clientInformation }));
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    return this.memory.tokens;
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    await this.patchGrant((current) => ({
      ...current,
      tokens: mergeRotatedTokens(current.tokens, tokens),
    }));
  }

  async saveDiscoveryState(state: OAuthDiscoveryState): Promise<void> {
    await this.patchGrant((current) => ({ ...current, discovery: state }));
  }

  async discoveryState(): Promise<OAuthDiscoveryState | undefined> {
    return this.memory.discovery;
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    // The silent path never needs the gateway, so it is ruled out first. Everything after this point is a
    // real login attempt: resolve the gateway before allocating a redirect URI, so a host with no web server
    // is refused without writing a half-filled grant (ADR-033 R1).
    if (this.silent) throw new SilentAuthorizationRequired();
    const gateway = requireGateway(this.opts.gateway());
    const redirectUri = await this.ensureRedirectUri();
    const request = {
      key: `${this.opts.scopeName}/${this.opts.credentialId}`,
      authorizationUrl: authorizationUrl.href,
      redirectUri,
      timeoutMs: this.opts.authorizationTimeoutMs,
      prefer: this.prefer,
    };
    if (this.deferWait) {
      const started = await beginOAuthViaGateway(request, gateway);
      if (!started.ok) throw new Error(`${started.result.code}: ${started.result.message}`);
      this.pendingInteractionId = started.id;
      this.opts.onAuthorizationStarted?.({
        id: started.id,
        prefer: started.prefer,
        authorizationUrl: started.authorizationUrl,
      });
      return;
    }
    const outcome = await startOAuthViaGateway(request, gateway, (started) => {
      this.pendingInteractionId = started.id;
      this.opts.onAuthorizationStarted?.({
        id: started.id,
        prefer: started.prefer,
        authorizationUrl: started.authorizationUrl,
      });
    });
    this.applyOutcome(outcome);
  }

  takePendingInteractionId(): string {
    const id = this.pendingInteractionId;
    if (id === undefined || id === "") throw new Error("no authorization pending");
    return id;
  }

  applyOutcome(outcome: LoginGatewayResult): void {
    if (outcome.status === "cancelled") throw new Error("authorization cancelled");
    if (outcome.status === "failed") throw new Error(`${outcome.code}: ${outcome.message}`);
    if (this.expectedState !== undefined && outcome.state !== undefined && outcome.state !== this.expectedState) {
      throw new Error("oauth state mismatch");
    }
    this.pendingCode = outcome.code;
    this.pendingInteractionId = undefined;
  }

  async completePendingAuthorization(): Promise<void> {
    const id = this.takePendingInteractionId();
    this.applyOutcome(await waitOAuthViaGateway(id, requireGateway(this.opts.gateway())));
  }

  /**
   * ADR-052 D2: forget a pending interaction and any code it produced. Used by cancel: the gateway interaction
   * is over, so a code remembered from it can never be exchanged and must not be picked up later by a submit
   * that arrives after the user cancelled.
   */
  dropPendingAuthorization(): void {
    this.pendingInteractionId = undefined;
    this.pendingCode = undefined;
  }

  takeAuthorizationCode(): string {
    const code = this.pendingCode;
    this.pendingCode = undefined;
    if (code === undefined || code === "") throw new Error("no authorization code pending");
    return code;
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    await this.patchGrant((current) => ({ ...current, codeVerifier }));
  }

  async codeVerifier(): Promise<string> {
    const verifier = this.memory.codeVerifier;
    if (verifier === undefined || verifier === "") throw new Error("missing PKCE code_verifier");
    return verifier;
  }

  async invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery"): Promise<void> {
    if (scope === "all") {
      await this.opts.credentials.deleteRecord(this.key());
      this.memory = emptyGrant();
      this.redirectUri = "";
      this.pendingInteractionId = undefined;
      this.pendingCode = undefined;
      return;
    }
    await this.patchGrant((current) => {
      const next = { ...current };
      if (scope === "client") delete next.client;
      if (scope === "tokens") delete next.tokens;
      if (scope === "verifier") delete next.codeVerifier;
      if (scope === "discovery") delete next.discovery;
      return next;
    });
  }

  isAuthorized(): boolean {
    return hasAccessToken(this.memory);
  }

  hasRefreshToken(): boolean {
    return hasRefreshToken(this.memory);
  }

  private async patchGrant(mutate: (current: McpOAuthGrantPayload) => McpOAuthGrantPayload): Promise<void> {
    let written: McpOAuthGrantPayload | undefined;
    await this.opts.credentials.modifyRecord(this.key(), async (current) => {
      const base = current?.kind === "grant" ? parseGrantPayload(current.payload) : emptyGrant();
      // ADR-033 D3: only plain JSON reaches the store. Normalizing inside the mutation keeps a rejected
      // payload from touching the stored bytes, and the in-memory grant is replaced only after the write
      // resolves — a failed write leaves both the file and the cached grant on their previous value.
      written = normalizeGrantPayload(mutate(base));
      return { kind: "grant", payload: written };
    });
    if (written !== undefined) this.memory = written;
  }
}
