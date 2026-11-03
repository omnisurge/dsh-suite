/** Loopback redirect allocation and PKCE state — not an OAuth interaction runtime. */
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";

export function parseLoopbackRedirect(uri: string): { host: string; port: number; pathname: string } | undefined {
  try {
    const url = new URL(uri);
    if (url.protocol !== "http:") return undefined;
    if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") return undefined;
    const port = url.port !== "" ? Number(url.port) : 80;
    if (!Number.isFinite(port) || port <= 0) return undefined;
    return {
      host: url.hostname === "localhost" ? "127.0.0.1" : url.hostname,
      port,
      pathname: url.pathname || "/",
    };
  } catch {
    return undefined;
  }
}

export async function allocateLoopbackRedirect(pathname = "/callback"): Promise<{ redirectUri: string; port: number }> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new Error("loopback allocate failed");
  }
  const port = address.port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  const path = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return { redirectUri: `http://127.0.0.1:${port}${path}`, port };
}

export function newOAuthState(): string {
  return randomBytes(16).toString("hex");
}
