import {
  pathUnderPrefix,
  requireLoopback,
  sendJson,
  sendJsonError,
  type LoopbackRequest,
  type LoopbackResponse,
} from "../loopback.js";

export const HTTP_PREFIX = "/mcp-dual-client";

export type ConnectionStatus = "idle" | "connected" | "error";

export interface StatusView {
  readonly serverName: string;
  readonly url: string;
  readonly status: ConnectionStatus;
  readonly toolCount: number;
  readonly toolNames: readonly string[];
  readonly protocolVersion?: string;
  readonly protocolEra?: "modern" | "legacy";
  readonly error?: string;
}

export interface RuntimeHandle {
  /** 缓存态：**不反映可达性**——服务进程退出后它仍停在 connected（2026-09-14 实测）。 */
  getStatus(): StatusView;
  /**
   * **实时探测**（ADR-022 修订 13）：真打一次轻量往返，死了就当场翻 error。
   *
   * 存在的理由：`getStatus()` 只是内存里的缓存变量，而没有任何东西会在「已连接的服务
   * 突然消失」时把它改掉——实测停掉服务进程后 >23 秒仍报 connected，
   * 于是 MCP 分区会显示绿色「已连接」骗过所有人（正是 kb-tool-gateway 静默死亡 11.5 小时那类事故）。
   * 未连接时它顺带推进一步真连（走既有 reconnectOnce）。
   */
  probe(): Promise<StatusView>;
  reconnect(): Promise<StatusView>;
}

export function controlPlanePrefix(serverName: string): string {
  return `${HTTP_PREFIX}/${encodeURIComponent(serverName)}`;
}

function matchAction(pathname: string, prefix: string): "status" | "probe" | "reconnect" | null {
  const base = pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  if (base === `${prefix}/status`) return "status";
  if (base === `${prefix}/probe`) return "probe";
  if (base === `${prefix}/reconnect`) return "reconnect";
  return null;
}

export function createHttpHandler(runtime: RuntimeHandle, serverName: string) {
  const prefix = controlPlanePrefix(serverName);
  return (req: LoopbackRequest, res: LoopbackResponse): void => {
    void (async () => {
      if (!requireLoopback(req, res)) return;
      if (pathUnderPrefix(new URL(req.url ?? "/", "http://127.0.0.1").pathname, prefix) === null) {
        sendJsonError(res, 404, "not found");
        return;
      }
      const method = req.method ?? "GET";
      const pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
      const action = matchAction(pathname, prefix);
      try {
        if (action === "status" && method === "GET") {
          sendJson(res, 200, runtime.getStatus());
          return;
        }
        if (action === "probe" && method === "GET") {
          sendJson(res, 200, await runtime.probe());
          return;
        }
        if (action === "reconnect" && method === "POST") {
          sendJson(res, 200, await runtime.reconnect());
          return;
        }
        sendJsonError(res, 404, "not found");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        sendJsonError(res, 400, message);
      }
    })();
  };
}
