import type { Volatile } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { CUSTOM_ENGINES_PATTERN, DEFAULT_ENGINE_GROUP, normalizeEngineGroup, type EngineGroupId } from './engines.js';

export interface Snapshot {
  baseUrl: string;
  basicAuthEnv: string;
  engineGroup: EngineGroupId;
  customEngines: string;
  timeoutMs: number;
}
export interface Config {
  baseUrl: Volatile<string>;
  basicAuthEnv: Volatile<string>;
  engineGroup: Volatile<EngineGroupId>;
  customEngines: Volatile<string>;
  timeoutMs: Volatile<number>;
}
/** Serialized by the official SDK: do not capture imports or module-local constants here. */
export function validateEndpoint(value: string | undefined): string {
  if (value === undefined || value === '') return '';
  if (!/^https?:[/][/][^@/?#\s\\]+(?:[/][^?#\s\\]*)?$/i.test(value) || !URL.canParse(value)) {
    throw new TypeError('Invalid SearXNG endpoint: use an HTTP(S) URL without credentials, query, or fragment.');
  }
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.search || url.hash) {
    throw new TypeError('Invalid SearXNG endpoint: use an HTTP(S) URL without credentials, query, or fragment.');
  }
  return value;
}
export function isEndpoint(value: string): boolean {
  if (value === '') return false;
  try { validateEndpoint(value); return true; }
  catch (error) { if (error instanceof TypeError) return false; throw error; }
}
/** Public callback JSON hook: native Settings clones and serializes a schema again.
 * Schemastery rehydrates a function but does not restore its toJSON hook. This
 * self-contained factory restores the hook on every hop without patching SDKs.
 */
function serializableCallback<T extends (value: string) => string>(callback: T): T {
  Object.defineProperty(callback, 'toJSON', {
    configurable: true,
    value: () => '(' + serializableCallback.toString() + ')(' + callback.toString() + ')',
  });
  return callback;
}
export const Config = z.object({
  baseUrl: z.transform(z.string().default(''), serializableCallback(validateEndpoint), true).default('').description('SearXNG URL; leave blank to disable. HTTP(S), optionally with a path prefix.').volatile(),
  basicAuthEnv: z.string().pattern(/^(?:[A-Za-z_][A-Za-z0-9_]*)?$/).role('credential-ref').default('').description('Credential reference holding user:password; blank for anonymous access.').volatile(),
  engineGroup: z.transform(z.union(['default', 'all', 'auto', 'en', 'zh', 'custom'] as const), serializableCallback(normalizeEngineGroup), true).default(DEFAULT_ENGINE_GROUP).description('default uses server engines; auto chooses Chinese/international engines by query language.').volatile(),
  customEngines: z.string().pattern(CUSTOM_ENGINES_PATTERN).default('').description('Comma-separated SearXNG engine names, required for custom.').volatile(),
  timeoutMs: z.number().step(1).min(100).max(60_000).default(30_000).description('Total search budget in milliseconds, including fallback.').volatile(),
});
/** Capture once before any await; explicitly empty fields never resurrect old settings. */
export function snapshot(config: Config): Snapshot {
  return { baseUrl: config.baseUrl.get(), basicAuthEnv: config.basicAuthEnv.get(), engineGroup: normalizeEngineGroup(config.engineGroup.get()), customEngines: config.customEngines.get(), timeoutMs: config.timeoutMs.get() };
}
