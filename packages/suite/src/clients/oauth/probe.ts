/**
 * 传输层可达性检查（2026-09-15 从 index.ts 的闭包里抽出，为的是**能测**）。
 *
 * 为什么必须可测：ADR-022 修订 14 的探测只做了单元层验收，没做真机红绿——
 * 「端点真挂时确实判死」这条当时只靠推理（同源逻辑 + dual 侧已真机验证）。
 * 抽出来之后，这条推理可以变成**对真实 socket 的观测**：起一个本地服务、一个死地址、
 * 一个挂起的服务，三种情形直接断言。
 *
 * 语义（与 mcp-dual-client 侧一致）：**任何 HTTP 应答都算活**——401/405 是「可达但未授权」，
 * 正是 OAuth 的常态；只有网络错误与超时才判死。**不碰 MCP 会话**：会话级 ping 会触发重连，
 * 等于健康检查自己制造故障。
 *
 * 超时用 Promise.race 而非 AbortSignal：本包 `fetch` 是自带的极简 shim（无 signal），
 * 且 lib 只有 ES2022（无 AbortSignal 类型）。
 */
/**
 * The probe's verdict after one more result. One miss is a blip — a restart, a transient network drop — so
 * only `threshold` consecutive failures may call the endpoint dead. This hysteresis is the same lesson the
 * dual client learned; it lives here as a pure function so the "two strikes, not one" rule is asserted
 * instead of living inside a closure.
 */
export function probeVerdict(
  consecutiveFailures: number,
  threshold: number,
): "alive" | "suspect" | "dead" {
  if (consecutiveFailures <= 0) return "alive";
  return consecutiveFailures >= threshold ? "dead" : "suspect";
}

export async function endpointReachable(target: string, timeoutMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      fetch(target, { method: "GET" }),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("probe timeout")), timeoutMs);
      }),
    ]);
    return true;
  } catch {
    return false;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
