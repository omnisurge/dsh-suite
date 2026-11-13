/**
 * 0.1.2 directoryFor throws until the session has a scope + binding.
 * Swallow that so the model seat can retry / fall back to Remote catalog
 * instead of occupying the official chip with an empty tree (ADR-020 修订 3).
 */

export interface CatalogModel {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly reasoning?: { readonly defaultEffort?: string };
}

export interface CatalogGroup {
  readonly id: string;
  readonly name: string;
  readonly models: readonly CatalogModel[];
}

export function tryDirectoryFor<T, Id>(directoryFor: (sessionId: Id) => T, sessionId: Id): T | undefined {
  try {
    return directoryFor(sessionId);
  } catch {
    return undefined;
  }
}

export function groupsFromCatalog(value: unknown): readonly CatalogGroup[] {
  if (value === null || typeof value !== "object") return [];
  const groups = (value as { groups?: unknown }).groups;
  if (!Array.isArray(groups)) return [];
  const out: CatalogGroup[] = [];
  for (const group of groups) {
    if (group === null || typeof group !== "object") continue;
    const row = group as { id?: unknown; name?: unknown; models?: unknown };
    if (typeof row.id !== "string" || typeof row.name !== "string" || !Array.isArray(row.models)) continue;
    const models: CatalogModel[] = [];
    for (const model of row.models) {
      if (model === null || typeof model !== "object") continue;
      const item = model as { id?: unknown; name?: unknown; description?: unknown; reasoning?: { defaultEffort?: unknown } };
      if (typeof item.id !== "string" || typeof item.name !== "string") continue;
      models.push({
        id: item.id,
        name: item.name,
        ...(typeof item.description === "string" ? { description: item.description } : {}),
        ...(typeof item.reasoning?.defaultEffort === "string"
          ? { reasoning: { defaultEffort: item.reasoning.defaultEffort } }
          : {}),
      });
    }
    out.push({ id: row.id, name: row.name, models });
  }
  return out;
}

export function unwrapCatalog(result: unknown): { groups: readonly CatalogGroup[]; error?: string } {
  if (result === null || typeof result !== "object") return { groups: [], error: "模型清单不可用" };
  const envelope = result as { ok?: unknown; value?: unknown; error?: { message?: unknown } };
  if (envelope.ok === false) {
    const message = envelope.error?.message;
    return { groups: [], error: typeof message === "string" && message !== "" ? message : "模型清单不可用" };
  }
  return { groups: groupsFromCatalog(envelope.ok === true ? envelope.value : result) };
}

function envelopeError(row: { error?: { message?: unknown; code?: unknown } }): string | undefined {
  const message = row.error?.message;
  if (typeof message === "string" && message !== "") return message;
  const code = row.error?.code;
  return typeof code === "string" && code !== "" ? code : undefined;
}

/**
 * `selectModel` success is not one shape: RemoteResult `{ok:true}`,
 * unwrapped `{selected}`, or `{value:{selected}}`. Only `{ok:true}`
 * was treated as success — catalog already unwrapped both ways.
 */
export function remoteSelectAccepted(result: unknown): { ok: true } | { ok: false; error?: string } {
  if (result === true) return { ok: true };
  if (result === false || result == null) return { ok: false };
  if (typeof result !== "object") return { ok: false };
  const row = result as {
    ok?: unknown;
    selected?: unknown;
    value?: unknown;
    error?: { message?: unknown; code?: unknown };
  };
  if (row.ok === false) return { ok: false, error: envelopeError(row) };
  if (row.ok === true) return { ok: true };
  if (row.selected !== null && typeof row.selected === "object") return { ok: true };
  if (row.value !== null && typeof row.value === "object") {
    const value = row.value as { selected?: unknown; ok?: unknown };
    if (value.selected !== null && typeof value.selected === "object") return { ok: true };
    if (value.ok === true) return { ok: true };
  }
  return { ok: false };
}
