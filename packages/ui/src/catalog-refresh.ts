/** Coalesce invalidations, discard pre-invalidation results, and silence disposed work. */
export function latestRefresh<T>(read: () => Promise<T>, accept: (value: T) => void, fail: () => void) {
  let revision = 0;
  let disposed = false;
  let pending: Promise<void> | undefined;
  async function run() {
    while (!disposed) {
      const at = revision;
      try {
        const value = await read();
        if (!disposed && at === revision) accept(value);
      } catch {
        if (!disposed && at === revision) fail();
      }
      if (disposed || at === revision) break;
    }
  }
  return {
    request(): Promise<void> {
      if (disposed) return Promise.resolve();
      revision++;
      if (!pending) pending = run().finally(() => { pending = undefined; });
      return pending;
    },
    dispose() { disposed = true; revision++; },
  };
}

export interface CatalogEvents {
  $on(event: "llm/adapters-updated", listener: () => void): () => void;
}

export function watchCatalog(events: CatalogEvents | undefined, refresh: () => unknown): () => void {
  const update = () => { void refresh(); };
  const visible = () => { if (document.visibilityState === "visible") update(); };
  const selector = (event: FocusEvent) => { if (event.target instanceof HTMLSelectElement) update(); };
  const off = events?.$on("llm/adapters-updated", update);
  window.addEventListener("focus", update);
  window.addEventListener("online", update);
  document.addEventListener("visibilitychange", visible);
  document.addEventListener("focusin", selector);
  return () => {
    off?.();
    window.removeEventListener("focus", update);
    window.removeEventListener("online", update);
    document.removeEventListener("visibilitychange", visible);
    document.removeEventListener("focusin", selector);
  };
}
