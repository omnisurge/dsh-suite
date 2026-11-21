/** ADR-104: one policy parser, native volatile Config, and one fixed Settings write adapter. */
import z from '@deepseek-ai/schemastery';
import { defineTool } from '@deepseek-ai/dsh-tools';
import type { Context } from '@deepseek-ai/cordis';
import type { BudgetPolicy } from './compaction-budget-core.js';
import { isVerifiedSettingsSdkProof } from './compaction-budget-provenance.js';
import type { SettingsSdkProof } from './compaction-budget-provenance.js';

export const BUDGET_SETTINGS_NAMESPACE = 'omnisurge-compaction-budget';
export interface CompactionBudgetConfig {
  enabled?: boolean;
  checkpointTokens?: number;
  safetyTokens?: number;
  timeoutMs?: number;
}
/** Self-contained: this function is serialized into each native field validator. */
export function parseBudgetPolicy(config: unknown): Readonly<BudgetPolicy> {
  const fail = (): never => { throw Object.assign(new Error('COMPACTION_BUDGET_CONFIG'), { code: 'COMPACTION_BUDGET_CONFIG' }); };
  if (config === null || typeof config !== 'object' || Array.isArray(config)) fail();
  const input = config as Record<string, unknown>;
  if (![Object.prototype, null].includes(Object.getPrototypeOf(input))) fail();
  if (Reflect.ownKeys(input).some(key => typeof key !== 'string' || !['enabled', 'checkpointTokens', 'safetyTokens', 'timeoutMs'].includes(key))) fail();
  if (input.enabled !== undefined && typeof input.enabled !== 'boolean') fail();
  const defaults = { checkpointTokens: 2048, safetyTokens: 1024, timeoutMs: 60000 };
  const result = { ...defaults };
  for (const [key, min, max] of [['checkpointTokens', 160, 32768], ['safetyTokens', 0, 65536], ['timeoutMs', 1, 300000]] as const) {
    const value = Object.hasOwn(input, key) ? input[key] : defaults[key];
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) fail();
    result[key] = value as number;
  }
  return Object.freeze(result);
}
export const DEFAULT_POLICY = parseBudgetPolicy({});
const FIELDS = Object.freeze(Object.keys(DEFAULT_POLICY) as (keyof BudgetPolicy)[]);
/** Restore the callback's JSON hook on every native serialize/rehydrate hop. */
function policyFieldValidator(parser: typeof parseBudgetPolicy, field: keyof BudgetPolicy): (value: number) => number {
  const validate = (value: number): number => parser({ [field]: value })[field];
  Object.defineProperty(validate, 'toJSON', { value: () => '(' + policyFieldValidator.toString() + ')(' + parser.toString() + ',' + JSON.stringify(field) + ')' });
  return validate;
}
function numericField(field: keyof BudgetPolicy, min: number, max: number) {
  return z.transform(z.number().step(1).min(min).max(max), policyFieldValidator(parseBudgetPolicy, field), true)
    .step(1).min(min).max(max).default(DEFAULT_POLICY[field]).volatile();
}
/** Native root object is required by Settings. Unknown writes are fenced by Settings' volatile paths;
 * native object hydration itself is not a strict raw-file editor (see ADR-104).
 */
export const Config = z.object({
  enabled: z.boolean(),
  checkpointTokens: numericField('checkpointTokens', 160, 32768),
  safetyTokens: numericField('safetyTokens', 0, 65536),
  timeoutMs: numericField('timeoutMs', 1, 300000),
});
const VOLATILE_WRITE = Symbol.for('cosmokit.volatile.write');
/** Capture all three live references synchronously before any operation can await. No cached policy. */
export function snapshotBudgetPolicy(config: unknown): Readonly<BudgetPolicy> {
  if (config === null || typeof config !== 'object' || Array.isArray(config)) return parseBudgetPolicy(config);
  const plain: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(config)) {
    if (typeof key !== 'string') throw new Error('COMPACTION_BUDGET_CONFIG');
    const raw = Reflect.get(config, key);
    plain[key] = raw !== null && typeof raw === 'object' && VOLATILE_WRITE in raw
      ? (raw as { get(): unknown }).get() : raw;
  }
  return parseBudgetPolicy(plain);
}
export interface BudgetSettingsLike {
  readonly writable?: boolean;
  describe(options?: { redactSecrets?: boolean }): { ns: string; revision: number; value: unknown }[];
  mutate(ns: string, ops: readonly { op: 'set'; path: readonly string[]; value: number }[], expectedRevision: number): Promise<void>;
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
function refusal(code: string): never { throw Object.assign(new Error(code), { code }); }
export function inspectBudgetSettings(settings: BudgetSettingsLike) {
  const rows = settings.describe({ redactSecrets: true }).filter(row => row.ns === BUDGET_SETTINGS_NAMESPACE);
  if (rows.length !== 1) return { namespace: BUDGET_SETTINGS_NAMESPACE, code: 'COMPACTION_BUDGET_SETTINGS_UNAVAILABLE', writable: false, valid: false, revision: null, value: null, defaults: DEFAULT_POLICY };
  const descriptor = rows[0]!;
  if (!Number.isSafeInteger(descriptor.revision) || descriptor.revision < 0) refusal('COMPACTION_BUDGET_SETTINGS_DESCRIPTOR');
  let value: Readonly<BudgetPolicy> | null = null;
  try {
    if (!record(descriptor.value) || FIELDS.some(key => !Object.hasOwn(descriptor.value as object, key))) throw new Error('COMPACTION_BUDGET_CONFIG');
    value = parseBudgetPolicy(descriptor.value);
  } catch { /* An invalid descriptor is reported, never replaced by factory defaults. */ }
  return { namespace: BUDGET_SETTINGS_NAMESPACE, code: value === null ? 'COMPACTION_BUDGET_SETTINGS_INVALID' : 'COMPACTION_BUDGET_SETTINGS_OK', writable: settings.writable === true, valid: value !== null, revision: descriptor.revision, value, defaults: DEFAULT_POLICY };
}
/** Thin adapter: no profile file, revision counter, retry, switch, route or second settings owner. */
export async function runBudgetSettings(settings: BudgetSettingsLike, args: unknown, signal?: AbortSignal) {
  if (!record(args) || Reflect.ownKeys(args).some(key => typeof key !== 'string' || !['action', 'expectedRevision', 'patch'].includes(key))) refusal('COMPACTION_BUDGET_SETTINGS_ARGUMENTS');
  signal?.throwIfAborted();
  if (args.action === 'inspect') {
    if (Object.hasOwn(args, 'patch') || Object.hasOwn(args, 'expectedRevision')) refusal('COMPACTION_BUDGET_SETTINGS_ARGUMENTS');
    return { action: 'inspect', settings: inspectBudgetSettings(settings) };
  }
  if (args.action !== 'update' || !Number.isSafeInteger(args.expectedRevision) || (args.expectedRevision as number) < 0) refusal('COMPACTION_BUDGET_SETTINGS_REVISION_REQUIRED');
  const patch = args.patch;
  if (!record(patch) || Reflect.ownKeys(patch).length === 0 || Reflect.ownKeys(patch).some(key => typeof key !== 'string' || !FIELDS.includes(key as keyof BudgetPolicy))) refusal('COMPACTION_BUDGET_SETTINGS_PATCH');
  // The same parser validates sparse edits. Defaults are validation-only, never written as extra ops.
  parseBudgetPolicy(patch);
  const before = inspectBudgetSettings(settings);
  if (before.revision === null) refusal('COMPACTION_BUDGET_SETTINGS_UNAVAILABLE');
  if (!before.writable) refusal('COMPACTION_BUDGET_SETTINGS_READ_ONLY');
  if (before.revision !== args.expectedRevision) refusal('SETTINGS_CONFLICT');
  const ops = Object.entries(patch).map(([key, value]) => ({ op: 'set' as const, path: [key], value: value as number }));
  signal?.throwIfAborted();
  try { await settings.mutate(BUDGET_SETTINGS_NAMESPACE, ops, args.expectedRevision as number); }
  catch (error) {
    if ((error as { code?: unknown })?.code === 'SETTINGS_CONFLICT') refusal('SETTINGS_CONFLICT');
    // An exception after dispatch cannot prove whether the official transaction committed.
    refusal('COMPACTION_BUDGET_SETTINGS_WRITE_UNCONFIRMED');
  }
  // Do not reinterpret a committed write as cancelled, or claim a subsequent read is its exact revision.
  return { action: 'update', code: 'COMPACTION_BUDGET_SETTINGS_UPDATED', namespace: BUDGET_SETTINGS_NAMESPACE };
}
/** Targeted admission guard for native Schemastery's null-as-default behavior. It does not write,
 * clone state, replace Settings' revision fence, or intercept unrelated namespaces. */
export function installBudgetSettingsGuard(settings: BudgetSettingsLike, proof: SettingsSdkProof): { status: string; dispose?: () => void } {
  if (!isVerifiedSettingsSdkProof(proof, settings)) return { status: 'COMPACTION_BUDGET_SETTINGS_SDK_UNVERIFIED' };
  const own = Object.getOwnPropertyDescriptor(settings, 'mutate');
  if (own !== undefined) return { status: 'COMPACTION_BUDGET_SETTINGS_GUARD_CONFLICT' };
  const original = settings.mutate;
  if (typeof original !== 'function') return { status: 'COMPACTION_BUDGET_SETTINGS_GUARD_UNAVAILABLE' };
  let active = true;
  const wrapper = function(this: unknown, ...args: unknown[]) {
    if (active && args[0] === BUDGET_SETTINGS_NAMESPACE) {
      const ops = args[1];
      if (!Number.isSafeInteger(args[2]) || (args[2] as number) < 0) refusal('COMPACTION_BUDGET_SETTINGS_REVISION_REQUIRED');
      if (!Array.isArray(ops) || ops.length === 0) refusal('COMPACTION_BUDGET_SETTINGS_PATCH');
      for (const op of ops) {
        if (!record(op) || !Array.isArray(op.path) || op.path.length !== 1 || !FIELDS.includes(op.path[0] as keyof BudgetPolicy)
          || Reflect.ownKeys(op).some(key => typeof key !== 'string' || !['op', 'path', 'value'].includes(key))) refusal('COMPACTION_BUDGET_SETTINGS_PATCH');
        if (op.op === 'set') {
          if (!Object.hasOwn(op, 'value')) refusal('COMPACTION_BUDGET_SETTINGS_PATCH');
          parseBudgetPolicy({ [op.path[0]]: op.value });
        } else if (op.op !== 'unset' || Object.hasOwn(op, 'value')) refusal('COMPACTION_BUDGET_SETTINGS_PATCH');
      }
    }
    return Reflect.apply(original, this, args);
  };
  const installed: PropertyDescriptor = { value: wrapper, enumerable: false, configurable: true, writable: true };
  Object.defineProperty(settings, 'mutate', installed);
  return { status: 'COMPACTION_BUDGET_SETTINGS_GUARDED', dispose() {
    active = false;
    const current = Object.getOwnPropertyDescriptor(settings, 'mutate');
    if (current?.value === wrapper && current.configurable === installed.configurable
      && current.writable === installed.writable && current.enumerable === installed.enumerable) Reflect.deleteProperty(settings, 'mutate');
  } };
}
export function registerBudgetSettingsTool(ctx: Context, settings: BudgetSettingsLike, enabled: () => boolean = () => true): void {
  // Settings and its guard already belong to the active parent fiber. Tools are optional; removing
  // tools disposes only its contribution, never installs a second guard or weakens parent admission.
  ctx.inject(['tools'], scope => {
    let active = true;
    scope.effect(() => () => { active = false; });
    scope.tools.register(defineTool({
      name: 'compaction_budget_settings',
      description: 'Inspect or adjust optional summary budget parameters through official profile Settings. Defaults work without user tuning. Inspect reads effective values, defaults, validity, writability and revision; update requires that revision and a non-empty patch of the three numeric fields. Does not enable plugins, change models or output limits, retry tuning, write files or accept arbitrary namespaces/paths. The tool is available only while this plugin and Settings are active.',
      parameters: {
        action: { type: 'string', enum: ['inspect', 'update'], required: true },
        expectedRevision: { type: 'integer', description: 'Required for update: the exact revision returned by inspect.' },
        patch: { type: 'object', additionalProperties: false, properties: {
          checkpointTokens: { type: 'integer' }, safetyTokens: { type: 'integer' }, timeoutMs: { type: 'integer' },
        } },
      },
      output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
      isConcurrencySafe: args => args.action === 'inspect',
      execute: async (args, exec) => {
        if (!active) refusal('COMPACTION_BUDGET_SETTINGS_OWNER_INACTIVE');
        const result = await runBudgetSettings(settings, args, exec.signal);
        return JSON.parse(JSON.stringify({ ...result, pluginEnabled: enabled() }));
      },
    }));
  });
}
