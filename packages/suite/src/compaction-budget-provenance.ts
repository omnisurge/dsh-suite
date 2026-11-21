/** Bounded package-byte evidence for ADR-100; never a generic resolver or a session fact. */
import { readFileSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const VERSION = '0.2.2-rc.5';
const BASIC = '@deepseek-ai/dsh-compaction-basic';
export const SDK_ENTRY_PINS = Object.freeze({
  [BASIC]: 'e1a3019949d01b22baa91d6eb672d9559d76b97fb5bb45e0428715a316bf11d4',
  '@deepseek-ai/dsh-token-meter': '0f27f128e12aaecdf360de1f2c974d5d759bc1002c5a3de560322669d200cb9a',
  '@deepseek-ai/dsh-llm': '1ed664800193b1ee9906fdb6fb79971a5a2817c20b939d151bc0ec596c5827d2',
});
export interface SdkProof { readonly version: string }
const proofs = new WeakSet<object>();
export function isVerifiedSdkProof(value: unknown): value is SdkProof {
  return typeof value === 'object' && value !== null && proofs.has(value);
}
interface PackageRecord { name: string; version?: string; dir: string; manifestPath: string }
export type PackageEvidenceContext = Pick<SdkEvidenceContext, 'profileContext' | 'pluginPackages'>;
export interface SdkEvidenceContext {
  profileContext: { installAnchor: string };
  pluginPackages: {
    packageOf(specifier: string, parentURL: string): PackageRecord | undefined;
    resolution?: { entries: readonly { name: string; packageDir: string; version?: string; scope: string }[] };
  };
  agentPresets: { inspectCompositions(context: unknown): readonly {
    id: string; modules: readonly { moduleName: string; baseUrl?: string; useHostBase: boolean }[];
    leakedServices: readonly string[];
  }[] };
}
export interface SdkEvidenceResult { proof?: SdkProof; reason?: string }
const SETTINGS = '@deepseek-ai/dsh-settings';
export const SETTINGS_ENTRY_PIN = '041a2682ed77a7025ceb9bf659b80db8b788c338cd1aa644f0bcc6bc122a4091';
export const SETTINGS_MUTATE_PIN = '8f024a874c8137f252e682c240ab49152510654ce4129e5a9d97700bf19ae5e8';
export interface SettingsSdkProof { readonly version: string }
const settingsProofs = new WeakMap<object, Function>();
/** Descriptor inspection is ordinary JS reflection, never a private Cordis proxy unwrap. */
function settingsMethod(settings: object): Function {
  if (Object.getOwnPropertyDescriptor(settings, 'mutate') !== undefined) refusal('settings-method-own');
  let node = Object.getPrototypeOf(settings);
  for (let depth = 0; node !== null && depth < 16; depth++, node = Object.getPrototypeOf(node)) {
    const descriptor = Object.getOwnPropertyDescriptor(node, 'mutate');
    if (descriptor === undefined) continue;
    if (!('value' in descriptor) || typeof descriptor.value !== 'function'
      || descriptor.writable !== true || descriptor.configurable !== true || descriptor.enumerable !== false) refusal('settings-method-descriptor');
    if (createHash('sha256').update(Function.prototype.toString.call(descriptor.value)).digest('hex') !== SETTINGS_MUTATE_PIN) refusal('settings-method-pin');
    return descriptor.value;
  }
  return refusal('settings-method-missing');
}
/** Opaque evidence is rechecked against the current descriptor, including after caller-side drift. */
export function isVerifiedSettingsSdkProof(proof: unknown, settings: object): proof is SettingsSdkProof {
  if (typeof proof !== 'object' || proof === null) return false;
  const method = settingsProofs.get(proof);
  if (!method) return false;
  try { return settingsMethod(settings) === method; } catch { return false; }
}
export function verifySettingsSdkProof(ctx: PackageEvidenceContext, settings: object): { proof?: SettingsSdkProof; reason?: string } {
  try {
    if (!isAbsolute(ctx.profileContext.installAnchor)) refusal('backend-base-unavailable');
    const pkg = packageAt(ctx, SETTINGS, pathToFileURL(ctx.profileContext.installAnchor).href);
    verifyEntry(pkg, SETTINGS_ENTRY_PIN);
    const method = settingsMethod(settings);
    const proof = Object.freeze({ version: VERSION });
    settingsProofs.set(proof, method);
    return { proof };
  } catch (error) {
    const known = ['backend-base-unavailable', 'installation-table-missing', 'sdk-package-version', 'sdk-manifest-path',
      'sdk-not-installation-owned', 'sdk-manifest-version', 'sdk-export-shape', 'sdk-entry-drift',
      'settings-method-own', 'settings-method-descriptor', 'settings-method-pin', 'settings-method-missing'];
    return { reason: error instanceof Error && known.includes(error.message) ? error.message : 'sdk-evidence-unavailable' };
  }
}
function refusal(code: string): never { throw new Error(code); }
/** One installation-owned resolver shared by Basic and Settings admission. */
function packageAt(ctx: PackageEvidenceContext, name: string, base: string) {
  const entries = ctx.pluginPackages.resolution?.entries;
  if (!Array.isArray(entries)) refusal('installation-table-missing');
  const record = ctx.pluginPackages.packageOf(name, base);
  if (!record || record.name !== name || record.version !== VERSION) refusal('sdk-package-version');
  const dir = realpathSync(record.dir);
  if (resolve(record.manifestPath) !== join(resolve(record.dir), 'package.json')) refusal('sdk-manifest-path');
  const matches = entries.filter(row => row.name === name && row.scope === 'installation'
    && row.version === VERSION && realpathSync(row.packageDir) === dir);
  if (matches.length !== 1) refusal('sdk-not-installation-owned');
  const manifest = JSON.parse(readFileSync(record.manifestPath, 'utf8')) as Record<string, unknown>;
  if (manifest.name !== name || manifest.version !== VERSION) refusal('sdk-manifest-version');
  return { record, manifest, dir };
}
function verifyEntry(pkg: ReturnType<typeof packageAt>, expected: string): void {
  const rootExport = (pkg.manifest.exports as Record<string, unknown> | undefined)?.['.'] as Record<string, unknown> | undefined;
  if (pkg.manifest.main !== 'lib/index.js' || rootExport === null || typeof rootExport !== 'object'
    || Array.isArray(rootExport) || rootExport.default !== './lib/index.js'
    || typeof rootExport.types !== 'string' || Object.keys(rootExport).length !== 2
    || Object.keys(rootExport).some(key => key !== 'types' && key !== 'default')) refusal('sdk-export-shape');
  if (createHash('sha256').update(readFileSync(join(pkg.dir, 'lib/index.js'))).digest('hex') !== expected) refusal('sdk-entry-drift');
}
/** All paths originate in public installation metadata; no profile/config/credential reads. */
export function verifyInstalledSdkProof(ctx: SdkEvidenceContext, agent: { ctx?: unknown }): SdkEvidenceResult {
  try {
    if (agent.ctx === undefined) refusal('agent-context-missing');
    const compositions = ctx.agentPresets.inspectCompositions(agent.ctx);
    if (compositions.length !== 1) refusal('composition-ambiguous');
    const refs = compositions[0].modules.filter(ref => ref.moduleName === BASIC);
    if (refs.length !== 1) refusal('backend-source-ambiguous');
    const ref = refs[0];
    if (!isAbsolute(ctx.profileContext.installAnchor)) refusal('backend-base-unavailable');
    const parent = ref.useHostBase ? pathToFileURL(ctx.profileContext.installAnchor).href : ref.baseUrl;
    if (typeof parent !== 'string' || new URL(parent).protocol !== 'file:') refusal('backend-base-unavailable');
    const basic = packageAt(ctx, BASIC, parent);
    const sdkBase = pathToFileURL(basic.record.manifestPath).href;
    packageAt(ctx, '@deepseek-ai/dsh-app-boot', pathToFileURL(ctx.profileContext.installAnchor).href);
    for (const [name, expected] of Object.entries(SDK_ENTRY_PINS)) {
      const pkg = name === BASIC ? basic : packageAt(ctx, name, sdkBase);
      verifyEntry(pkg, expected);
    }
    const proof = Object.freeze({ version: VERSION });
    proofs.add(proof);
    return { proof };
  } catch (error) {
    const known = ['agent-context-missing', 'composition-ambiguous', 'backend-source-ambiguous',
      'backend-base-unavailable', 'installation-table-missing', 'sdk-package-version', 'sdk-manifest-path',
      'sdk-not-installation-owned', 'sdk-manifest-version', 'sdk-export-shape', 'sdk-entry-drift'];
    const reason = error instanceof Error && known.includes(error.message) ? error.message : 'sdk-evidence-unavailable';
    return { reason };
  }
}
