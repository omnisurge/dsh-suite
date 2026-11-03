/**
 * Dual-version MCP HTTP client (ADR-041).
 * One insert instance = one Streamable HTTP server.
 * Official SDK v2 + versionNegotiation.mode auto. Static headers only.
 */
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-tools";
import z from "@deepseek-ai/schemastery";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { controlPlanePrefix, createHttpHandler, HTTP_PREFIX, type ConnectionStatus, type RuntimeHandle, type StatusView } from "./http.js";
import { CLIENT_INFO, VERSION_NEGOTIATION } from "./negotiate.js";
import { SERVER_NAME_PATTERN } from "./names.js";
import { createSerializedResync, syncTools } from "./tools.js";

export const name = "omnisurge-mcp-dual-client";
export const inject = ["tools"];

const DEFAULT_TOOL_CALL_TIMEOUT_MS = 60_000;
const RECONNECT_INITIAL_MS = 500;
const RECONNECT_MAX_MS = 30_000;
const RECONNECT_MAX_ATTEMPTS = 10;

/** 实时探测的超时：必须**短**——UI 每 4s 轮询一次，探测不能堆叠。 */
const PROBE_TIMEOUT_MS = 3000;

/** 连续失败多少次才判死。1 会抖（实测 6 次采样里误报 2 次），2 足够。 */
const PROBE_FAIL_THRESHOLD = 2;
const activeServerNames = new WeakMap<object, Set<string>>();

export interface Config {
  transport: "streamable-http";
  serverName: string;
  url: string;
  headers: Record<string, string>;
  failOnStartupError: boolean;
  toolCallTimeoutMs: number;
}

export const Config: unknown = z.object({
  transport: z.const("streamable-http").default("streamable-http"),
  serverName: z.string().required().pattern(SERVER_NAME_PATTERN),
  url: z.string().required(),
  headers: z.dict(String).default({}),
  failOnStartupError: z.boolean().default(false),
  toolCallTimeoutMs: z.number().default(DEFAULT_TOOL_CALL_TIMEOUT_MS),
});

interface LoggerLike {
  info(message: string): void;
  warn?(message: string): void;
  error(message: string): void;
}

function warn(logger: LoggerLike, message: string): void {
  if (typeof logger.warn === "function") logger.warn(message);
  else logger.info(message);
}

function createClient(): Client {
  return new Client(CLIENT_INFO, {
    capabilities: {},
    versionNegotiation: VERSION_NEGOTIATION,
  });
}

function createTransport(config: Config): StreamableHTTPClientTransport {
  const headers = Object.fromEntries(
    Object.entries(config.headers).filter(([, value]) => value !== ""),
  );
  return new StreamableHTTPClientTransport(new URL(config.url), {
    requestInit: Object.keys(headers).length > 0 ? { headers } : {},
  });
}

async function apply(ctx: Context, config: Config): Promise<void> {
  const logger = ctx.logger as LoggerLike;
  const label = `mcp-dual-client(${config.serverName})`;

  ctx.effect(() => {
    let names = activeServerNames.get(ctx.root);
    if (!names) {
      names = new Set();
      activeServerNames.set(ctx.root, names);
    }
    if (names.has(config.serverName)) {
      throw new Error(`${label}: serverName already in use — pick a unique serverName`);
    }
    names.add(config.serverName);
    return () => void names.delete(config.serverName);
  }, "mcp-dual-client.serverName");

  let client = createClient();
  let transport = createTransport(config);
  let disposers = new Map<string, () => void>();
  let status: ConnectionStatus = "idle";
  // 迟滞（ADR-022 修订 13）：单次 ping 失败不判死——服务刚重启时旧会话必然失败一次，
  // 立刻翻 error 会让健康服务闪红。连续 PROBE_FAIL_THRESHOLD 次才认。
  let probeFailures = 0;
  /** 主动关闭期间为 true：此间触发的 onclose 由我们自己造成，不计失败。 */
  let intentionalClose = false;

  /**
   * 统一的失败判定（ADR-022 修订 13）。
   *
   * **两条失败路径必须共用它**——只给 ping 分支加迟滞是不够的：
   * `reconnectOnce` 失败时也会把 status 置 error，实测那才是抖动的真凶
   * （连接一断，第一次探测就走那条路，当场翻红）。
   */
  const endpointReachable = async (target: string, timeoutMs: number): Promise<boolean> => {
    try {
      await fetch(target, { method: "GET", redirect: "error", signal: AbortSignal.timeout(timeoutMs) });
      return true;
    } catch {
      return false;
    }
  };
  const noteProbeFailure = (message: string): void => {
    lastError = message;
    probeFailures += 1;
    if (probeFailures >= PROBE_FAIL_THRESHOLD) status = "error";
  };
  let lastError: string | undefined;
  let disposed = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let failedAttempts = 0;
  let settling: Promise<void> = Promise.resolve();

  const opts = {
    serverName: config.serverName,
    toolCallTimeoutMs: config.toolCallTimeoutMs,
    registrationFailure: (config.failOnStartupError ? "throw" : "contain") as "throw" | "contain",
  };

  const clearTools = (): void => {
    for (const dispose of disposers.values()) dispose();
    disposers = new Map();
  };

  const closeGeneration = async (): Promise<void> => {
    clearTools();
    try {
      await client.close();
    } catch {
      /* ignore */
    }
  };

  const rebuild = (): void => {
    client = createClient();
    transport = createTransport(config);
  };

  const protocolOf = (): Pick<StatusView, "protocolVersion" | "protocolEra"> => {
    const version = client.getNegotiatedProtocolVersion();
    const era = client.getProtocolEra();
    return {
      ...(typeof version === "string" && version !== "" ? { protocolVersion: version } : {}),
      ...(era === "modern" || era === "legacy" ? { protocolEra: era } : {}),
    };
  };

  const getStatus = (): StatusView => ({
    serverName: config.serverName,
    url: config.url,
    status,
    toolCount: disposers.size,
    toolNames: [...disposers.keys()],
    ...protocolOf(),
    ...(lastError !== undefined ? { error: lastError } : {}),
  });

  const connectAndSync = async (): Promise<void> => {
    await client.connect(transport);
    disposers = await syncTools(client, ctx.tools as never, opts, disposers, logger);
    const resync = createSerializedResync(async () => {
      logger.info(`${label}: tool list changed, re-syncing`);
      disposers = await syncTools(client, ctx.tools as never, opts, disposers, logger);
    });
    client.setNotificationHandler("notifications/tools/list_changed", async () => {
      try {
        await resync.schedule();
      } catch (error) {
        logger.error(`${label}: tool re-sync failed: ${String(error)}`);
      }
    });
    client.onclose = () => {
      if (disposed) return;
      // 我们自己拆的连接（重连/重建）不算失败，否则计数被自身动作污染。
      if (intentionalClose) return;
      // 传输层关闭**不等于**服务已死：ping 失败、服务端主动断流都会触发一次 close，
      // 而紧接着的重连往往就成功。裸置 error 会让健康服务闪红
      //（2026-09-14 实测：基线与恢复后的轮询里都误报过）。走同一条迟滞判定。
      noteProbeFailure("transport closed");
      scheduleReconnect();
    };
    status = "connected";
    probeFailures = 0;
    lastError = undefined;
    failedAttempts = 0;
  };

  const scheduleReconnect = (): void => {
    if (disposed || reconnectTimer !== undefined) return;
    failedAttempts += 1;
    if (failedAttempts > RECONNECT_MAX_ATTEMPTS) {
      clearTools();
      logger.error(`${label}: giving up after ${RECONNECT_MAX_ATTEMPTS} reconnect attempts`);
      return;
    }
    const delayMs = Math.min(RECONNECT_MAX_MS, RECONNECT_INITIAL_MS * 2 ** (failedAttempts - 1));
    warn(logger, `${label}: reconnecting in ${delayMs}ms (attempt ${failedAttempts}/${RECONNECT_MAX_ATTEMPTS})`);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined;
      settling = reconnectOnce();
    }, delayMs);
    reconnectTimer.unref?.();
  };

  const reconnectOnce = async (): Promise<void> => {
    if (disposed) return;
    intentionalClose = true;
    try {
      await closeGeneration();
    } finally {
      intentionalClose = false;
    }
    rebuild();
    try {
      await connectAndSync();
      logger.info(`${label}: reconnected`);
    } catch (error) {
      noteProbeFailure(error instanceof Error ? error.message : String(error));
      warn(logger, `${label}: reconnect failed (${probeFailures}/${PROBE_FAIL_THRESHOLD}): ${lastError}`);
      scheduleReconnect();
    }
  };

  const runtime: RuntimeHandle = {
    getStatus,
    async probe() {
      if (disposed) return getStatus();
      // **传输层可达性检查，不碰 MCP 会话**（ADR-022 修订 13）。
      //
      // 为什么不用 client.ping()：那是**会话级**往返，实测会触发 close/重连，
      // 于是「健康检查」制造了它要检测的故障（自伤），且自身重连被计入失败造成抖动。
      // 可达性检查只问一句「端点还活着吗」——任何 HTTP 应答（含 4xx/5xx）都算活，
      // 只有网络错误/超时才算死。
      const alive = await endpointReachable(config.url, PROBE_TIMEOUT_MS);
      if (!alive) {
        noteProbeFailure("endpoint unreachable");
        if (probeFailures >= PROBE_FAIL_THRESHOLD) scheduleReconnect();
        return getStatus();
      }
      probeFailures = 0;
      if (status !== "connected") {
        if (reconnectTimer !== undefined) {
          clearTimeout(reconnectTimer);
          reconnectTimer = undefined;
        }
        await reconnectOnce();
      }
      return getStatus();
    },
    async reconnect() {
      if (reconnectTimer !== undefined) {
        clearTimeout(reconnectTimer);
        reconnectTimer = undefined;
      }
      failedAttempts = 0;
      lastError = undefined;
      settling = reconnectOnce();
      await settling;
      return getStatus();
    },
  };

  ctx.inject(["webServer"], (webCtx) => {
    // The host web server is a runtime service, not a cordis core type: read the one shape used here
    // structurally (host.ts reads its origin the same way), so no module augmentation is introduced.
    const webServer = webCtx.get("webServer") as {
      register(route: { kind: string; path: string; handler: (req: never, res: never) => unknown }): () => void;
    };
    const prefix = controlPlanePrefix(config.serverName);
    webCtx.effect(
      () =>
        webServer.register({
          kind: "prefix",
          path: prefix,
          handler: createHttpHandler(runtime, config.serverName) as (req: never, res: never) => void,
        }),
      "mcp-dual-client.http",
    );
  });

  try {
    await connectAndSync();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    noteProbeFailure(message);
    logger.error(`${label}: startup failed: ${message}`);
    if (config.failOnStartupError) {
      throw new Error(`${label}: initial connection failed`, { cause: error });
    }
    scheduleReconnect();
  }

  ctx.effect(() => async () => {
    disposed = true;
    if (reconnectTimer !== undefined) {
      clearTimeout(reconnectTimer);
      reconnectTimer = undefined;
    }
    await settling;
    intentionalClose = true;
    try {
      await closeGeneration();
    } finally {
      intentionalClose = false;
    }
  }, "mcp-dual-client.connection");
}

export { apply, HTTP_PREFIX, controlPlanePrefix, createHttpHandler, VERSION_NEGOTIATION, CLIENT_INFO };
export { publicToolName, SERVER_NAME_PATTERN } from "./names.js";
export { createSerializedResync, syncTools } from "./tools.js";
export type { McpClientLike } from "./tools.js";
export type { StatusView, ConnectionStatus, RuntimeHandle };
