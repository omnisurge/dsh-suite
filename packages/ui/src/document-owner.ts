/** Shared by independently bundled plugins; version the key when the contract changes. */
export function documentOwner<T>(name: string, create: () => T): T {
  const key = Symbol.for(`omnidsh.ui.${name}.v1`);
  const scope = document as unknown as Record<symbol, unknown>;
  if (scope[key] === undefined) scope[key] = create();
  return scope[key] as T;
}
