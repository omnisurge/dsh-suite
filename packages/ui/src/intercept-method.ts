type Method = (this: any, ...args: any[]) => any;
const LAYER = Symbol.for("omnidsh.client.method-layer.v1");

interface Layer {
  active: boolean;
  previous?: PropertyDescriptor;
}

function unwrap(descriptor: PropertyDescriptor | undefined): PropertyDescriptor | undefined {
  let current = descriptor;
  while (current?.value?.[LAYER]?.active === false) {
    current = (current.value[LAYER] as Layer).previous;
  }
  return current;
}

/** Reversible client adapters; descriptors bypass Cordis method proxy identity. */
export function interceptMethod<F extends Method>(
  holder: object | undefined,
  key: string,
  wrap: (next: F, active: () => boolean) => F,
): () => void {
  if (!holder || typeof Reflect.get(holder, key) !== "function") return () => {};
  const previous = Object.getOwnPropertyDescriptor(holder, key);
  let inherited = Object.getPrototypeOf(holder);
  let base = previous;
  while (!base && inherited) {
    base = Object.getOwnPropertyDescriptor(inherited, key);
    inherited = Object.getPrototypeOf(inherited);
  }
  if (!base) return () => {};
  const layer: Layer = { active: true, previous };
  const active = () => layer.active;
  const wrapped = function (this: unknown, ...args: Parameters<F>): ReturnType<F> {
    // Resolve the original getter with today's caller, never a retired plugin ctx.
    const receiver = this;
    const next = function (this: unknown, ...nextArgs: Parameters<F>): ReturnType<F> {
      const method = base!.get ? base!.get.call(receiver) : base!.value;
      return Reflect.apply(method, receiver, nextArgs);
    } as F;
    return Reflect.apply(layer.active ? wrap(next, active) : next, receiver, args);
  };
  Object.defineProperty(wrapped, LAYER, { value: layer });
  try {
    Object.defineProperty(holder, key, {
      configurable: true, enumerable: previous?.enumerable ?? true,
      writable: true, value: wrapped,
    });
  } catch {
    layer.active = false;
    return () => {};
  }
  return () => {
    layer.active = false;
    if (Object.getOwnPropertyDescriptor(holder, key)?.value !== wrapped) return;
    const restore = unwrap(previous);
    if (restore) Object.defineProperty(holder, key, restore);
    else Reflect.deleteProperty(holder, key);
  };
}
