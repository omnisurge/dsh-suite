/** Tool sync — contract-aligned with official dsh-mcp-client (independent copy). */
import { publicToolName } from "./names.js";

export interface McpClientLike {
  request(
    req: { method: string; params?: Record<string, unknown> },
    options?: { signal?: AbortSignal; timeout?: number },
  ): Promise<unknown>;
}

export interface ToolsLike {
  register(definition: {
    name: string;
    description: string;
    parameters: unknown;
    output: unknown;
    execute: (args: unknown, exec: { signal?: AbortSignal }) => Promise<unknown>;
  }): () => void;
}

export interface SyncOpts {
  readonly serverName: string;
  readonly toolCallTimeoutMs: number;
  readonly registrationFailure: "throw" | "contain";
}

/** Run list_changed re-syncs one at a time so a failed pass cannot race a working set. */
export function createSerializedResync(run: () => Promise<void>): { schedule(): Promise<void> } {
  let tail: Promise<void> = Promise.resolve();
  return {
    schedule() {
      const next = tail.then(run, run);
      tail = next.then(() => undefined, () => undefined);
      return next;
    },
  };
}

function asToolPage(value: unknown): { tools: Array<{ name: string; description?: string; inputSchema?: unknown }>; nextCursor?: string } {
  if (value === null || typeof value !== "object") {
    throw new Error("tools/list returned a non-object");
  }
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.tools)) {
    throw new Error("tools/list missing tools[]");
  }
  return {
    tools: record.tools as Array<{ name: string; description?: string; inputSchema?: unknown }>,
    ...(typeof record.nextCursor === "string" ? { nextCursor: record.nextCursor } : {}),
  };
}

function listToolsUncached(client: McpClientLike, cursor: string | undefined) {
  return client.request({
    method: "tools/list",
    ...(cursor === undefined ? {} : { params: { cursor } }),
  });
}

function callToolUncached(
  client: McpClientLike,
  rawName: string,
  args: Record<string, unknown>,
  exec: { signal?: AbortSignal },
  opts: SyncOpts,
) {
  return client.request({
    method: "tools/call",
    params: { name: rawName, arguments: args },
  }, {
    signal: exec.signal,
    timeout: opts.toolCallTimeoutMs,
  });
}

function extractText(mcpContent: unknown, toolName: string): string {
  if (!Array.isArray(mcpContent)) return `(${toolName} returned no text content)`;
  const parts: string[] = [];
  for (const value of mcpContent) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      parts.push("[unsupported content type: unknown]");
      continue;
    }
    const block = value as Record<string, unknown>;
    switch (block.type) {
      case "text":
        if (typeof block.text === "string") parts.push(block.text);
        break;
      case "image":
        parts.push(`[image: ${typeof block.mimeType === "string" ? block.mimeType : "unknown"}, content discarded]`);
        break;
      case "audio":
        parts.push(`[audio: ${typeof block.mimeType === "string" ? block.mimeType : "unknown"}, content discarded]`);
        break;
      case "resource":
      case "resource_link":
        parts.push("[resource: content discarded]");
        break;
      default:
        parts.push(`[unsupported content type: ${String(block.type)}]`);
    }
  }
  return parts.join("\n") || `(${toolName} returned no text content)`;
}

function createOutput(rawName: string) {
  return {
    schema: {
      type: "object",
      properties: {
        content: { type: "array", items: {} },
        structuredContent: {},
      },
      required: ["content"],
      additionalProperties: false,
    },
    render(_args: unknown, value: { content?: unknown }) {
      return [{ type: "text", text: extractText(value.content, rawName) }];
    },
  };
}

function createExecutor(client: McpClientLike, rawName: string, opts: SyncOpts) {
  return async (args: unknown, exec: { signal?: AbortSignal }) => {
    const result = await callToolUncached(
      client,
      rawName,
      typeof args === "object" && args !== null ? args as Record<string, unknown> : {},
      exec,
      opts,
    ) as {
      content?: unknown;
      structuredContent?: unknown;
      isError?: boolean;
      toolResult?: unknown;
    };
    if (!Array.isArray(result.content)) {
      const rendered = "toolResult" in result ? JSON.stringify(result.toolResult) : "(no output)";
      const text = typeof rendered === "string" ? rendered : "(no output)";
      if (result.isError === true) throw new Error(text);
      return {
        content: [{ type: "text", text }],
        ...(result.structuredContent !== undefined ? { structuredContent: result.structuredContent } : {}),
      };
    }
    const text = extractText(result.content, rawName);
    if (result.isError === true) throw new Error(text);
    return {
      content: result.content,
      ...(result.structuredContent !== undefined ? { structuredContent: result.structuredContent } : {}),
    };
  };
}

export async function syncTools(
  client: McpClientLike,
  tools: ToolsLike,
  opts: SyncOpts,
  previous: Map<string, () => void>,
  log: { error: (message: string) => void },
): Promise<Map<string, () => void>> {
  const definitions = new Map<string, {
    name: string;
    description: string;
    parameters: unknown;
    output: unknown;
    execute: (args: unknown, exec: { signal?: AbortSignal }) => Promise<unknown>;
  }>();
  let cursor: string | undefined;
  do {
    const response = asToolPage(await listToolsUncached(client, cursor));
    for (const tool of response.tools) {
      const publicName = publicToolName(opts.serverName, tool.name);
      if (definitions.has(publicName)) {
        throw new Error(`mcp-dual-client(${opts.serverName}): duplicate tool "${tool.name}"`);
      }
      definitions.set(publicName, {
        name: publicName,
        description: tool.description ?? "",
        parameters: tool.inputSchema ?? { type: "object", properties: {} },
        output: createOutput(tool.name),
        execute: createExecutor(client, tool.name, opts),
      });
    }
    cursor = response.nextCursor;
  } while (cursor !== undefined);

  for (const dispose of previous.values()) dispose();
  const disposers = new Map<string, () => void>();
  try {
    for (const [publicName, definition] of definitions) {
      disposers.set(publicName, tools.register(definition));
    }
  } catch (error) {
    for (const dispose of disposers.values()) dispose();
    log.error(`mcp-dual-client(${opts.serverName}): tool registration failed: ${String(error)}`);
    if (opts.registrationFailure === "throw") throw error;
    return new Map();
  }
  return disposers;
}
