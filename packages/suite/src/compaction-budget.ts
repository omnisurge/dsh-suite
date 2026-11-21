/** ADR-100: one owner of the summary hook; never intercept a compaction entry point. */
import { createHash } from 'node:crypto';
import { coverageSnapshot } from './compaction-budget-status.js';
import type { TargetCoverage } from './compaction-budget-status.js';
import type { ComponentEffectSnapshot } from './types.js';

import type { Context } from '@deepseek-ai/cordis';
import { runBudgetSummary } from './compaction-budget-core.js';
import type { BudgetPolicy } from './compaction-budget-core.js';
import { Config, parseBudgetPolicy, snapshotBudgetPolicy, registerBudgetSettingsTool, installBudgetSettingsGuard } from './compaction-budget-settings.js';
import type { BudgetSettingsLike } from './compaction-budget-settings.js';
import { verifySettingsSdkProof } from './compaction-budget-provenance.js';
import type { CompactionBudgetConfig } from './compaction-budget-settings.js';
export { Config, DEFAULT_POLICY, parseBudgetPolicy } from './compaction-budget-settings.js';
export type { CompactionBudgetConfig } from './compaction-budget-settings.js';
import { isVerifiedSdkProof, verifyInstalledSdkProof } from './compaction-budget-provenance.js';
import type { SdkEvidenceContext, SdkProof } from './compaction-budget-provenance.js';
export { verifyInstalledSdkProof } from './compaction-budget-provenance.js';

export const NAME = 'omnisurge-compaction-budget';
export const inject = ['agentPresets', 'agents', 'pluginPackages', 'profileContext', 'settings'] as const;
const MARKER = Symbol.for('omnisurge.compaction-budget.owner.v1');
/** Actual macOS official 0.2.2-rc.5 prototype bytes; other shapes fail open. */
export const METHOD_PINS = Object.freeze({
  summarize: 'ae745613f2a453b5beeb5de758b30c06bf7b8ff40498de404b7b63423f1cdb07',
  compactIfNeeded: 'e636f930c50bcb06d280923ff970acde8645921826d6ea6ce07a8a8301736d4d',
  compactNow: '5c34231543f1d21c8e77404aae5f1b0bca4fbbce0514f8ae7fd6cb3bf7a4240a',
  compactRegion: 'a247e99c98e56c0236fae5eaa00a2de25f2bff26f8069fb8f637b759cf5a4efa',
});
interface MethodDescriptor extends PropertyDescriptor { value: (...args: unknown[]) => unknown }
export interface HookReceipt { status: string; dispose?: () => void }
interface HookRecord { readonly owner:object; readonly active:boolean; readonly installed:PropertyDescriptor; dispose():void }
/** This registry owns the actual hook resources, not an independently writable success projection. */
const ownerRecords = new WeakMap<object,Set<HookRecord>>();
function recordsFor(owner:object):Set<HookRecord> {
 let records=ownerRecords.get(owner);
 if(!records){records=new Set();ownerRecords.set(owner,records);}
 return records;
}
function liveRecord(service:object,owner:object):HookRecord|undefined {
 const own=Object.getOwnPropertyDescriptor(service,'summarize');
 const marker=typeof own?.value==='function'?Object.getOwnPropertyDescriptor(own.value,MARKER)?.value:undefined;
 const record=marker?.record as HookRecord|undefined;
 return record&&marker.version===1&&marker.owner===owner&&record.owner===owner
  &&ownerRecords.get(owner)?.has(record)&&record.active&&sameDescriptor(own,record.installed)?record:undefined;
}
function shapeRefusal(service:object):string|undefined {
 const own=Object.getOwnPropertyDescriptor(service,'summarize');
 if(own!==undefined)return typeof own.value==='function'&&Object.getOwnPropertyDescriptor(own.value,MARKER)?'owned-elsewhere':'unsupported-own-summary';
 const original=methodDescriptor(service,'summarize');
 if(original===undefined||original.configurable!==true||original.writable!==true)return 'unsupported-shape';
 for(const [name,expected] of Object.entries(METHOD_PINS)){
  const descriptor=methodDescriptor(service,name);
  if(descriptor===undefined||createHash('sha256').update(Function.prototype.toString.call(descriptor.value)).digest('hex')!==expected)return 'unsupported-method-pin';
 }
 return undefined;
}
function methodDescriptor(service: object, name: string): MethodDescriptor | undefined {
  let current: object | null = service;
  for (let depth = 0; current !== null && depth < 12; depth++, current = Object.getPrototypeOf(current)) {
    const descriptor = Object.getOwnPropertyDescriptor(current, name);
    if (descriptor !== undefined) return typeof descriptor.value === 'function' ? descriptor as MethodDescriptor : undefined;
  }
  return undefined;
}
function sameDescriptor(a: PropertyDescriptor | undefined, b: PropertyDescriptor): boolean {
  return a?.value === b.value && a?.writable === b.writable
    && a?.configurable === b.configurable && a?.enumerable === b.enumerable;
}
/** Public inspection seam used as a version-pinned injection seam, not a preset replacement API. */
export function installBudgetHook(service: object, owner: object, policy: BudgetPolicy | (() => BudgetPolicy), proof?: SdkProof): HookReceipt {
  let abortInstallation: (() => void) | undefined;
  try {
    const own = Object.getOwnPropertyDescriptor(service, 'summarize');
    const priorMarker = typeof own?.value === 'function'
      ? Object.getOwnPropertyDescriptor(own.value, MARKER)?.value as { version?: number; owner?: object } | undefined : undefined;
    if (priorMarker !== undefined) return { status: liveRecord(service, owner) ? 'already-owned' : 'owned-elsewhere' };
    // Installation and status share the same no-side-effect admission oracle.
    const refusal=shapeRefusal(service);
    if(refusal!==undefined)return {status:refusal};
    const original = methodDescriptor(service, 'summarize')!;
    if (!isVerifiedSdkProof(proof)) return { status: 'sdk-proof-required' };
    // Compatibility values and live getters feed the same canonical parser, not parallel algorithms.
    const readPolicy = typeof policy === 'function' ? policy : () => policy;
    const snapshot = () => parseBudgetPolicy(readPolicy());
    snapshot(); // Admit only valid initial policy; do not install a latent invalid delegate.
    const lifecycle = new AbortController();
    let active = true;
    let record:HookRecord;
    const wrapper = function(this: unknown, ...args: unknown[]): unknown {
      if (!active) return Reflect.apply(original.value, this, args);
      // Capture once, synchronously; changing volatile references cannot alter this in-flight call.
      const policy = typeof snapshot === 'function' ? snapshot() : snapshot;
      const [input, agent, signal] = args;
      const combined = signal === undefined ? lifecycle.signal : AbortSignal.any([signal as AbortSignal, lifecycle.signal]);
      return (async () => {
        combined.throwIfAborted();
        const result = await runBudgetSummary(
          // The discovery proxy owns installation only; preserve the calling Cordis scope (ADR-101).
          this as Parameters<typeof runBudgetSummary>[0],
          original.value as Parameters<typeof runBudgetSummary>[1],
          input as Parameters<typeof runBudgetSummary>[2],
          agent as Parameters<typeof runBudgetSummary>[3], policy, combined,
        );
        combined.throwIfAborted();
        return result;
      })();
    };
    Object.defineProperty(wrapper, MARKER, { value: Object.freeze({ version: 1, owner, get record(){return record;} }) });
    const installed: PropertyDescriptor = { value: wrapper, writable: true, configurable: true, enumerable: false };
    abortInstallation = () => {
      active = false;
      lifecycle.abort(new Error('COMPACTION_BUDGET_INSTALL_FAILED'));
      if (sameDescriptor(Object.getOwnPropertyDescriptor(service, 'summarize'), installed)) Reflect.deleteProperty(service, 'summarize');
    };
    record = {owner, installed, get active(){return active&&!lifecycle.signal.aborted;}, dispose() {
      if (!active) return;
      active = false;
      lifecycle.abort(new Error('COMPACTION_BUDGET_DISABLED'));
      if (sameDescriptor(Object.getOwnPropertyDescriptor(service, 'summarize'), installed)) Reflect.deleteProperty(service, 'summarize');
    }};
    Object.defineProperty(service, 'summarize', installed);
    if (!sameDescriptor(Object.getOwnPropertyDescriptor(service, 'summarize'), installed)) {
      abortInstallation();
      return { status: 'install-failed' };
    }
    Object.freeze(installed); Object.freeze(record);
    recordsFor(owner).add(record);
    return { status: 'installed', dispose:()=>record.dispose() };
  } catch {
    // Even a failed post-write descriptor read first makes our delegate inactive.
    try { abortInstallation?.(); } catch { /* A foreign proxy can refuse restoration, not deactivation. */ }
    return { status: 'install-failed' };
  }
}

export function apply(ctx: Context, config: CompactionBudgetConfig = {}): void {
  const context = ctx as unknown as BudgetStatusContext;
  // One reporter and hook owner per public service realm; a duplicate row is inert, never a second owner.
  if(context.get?.('omnisurgeCompactionBudgetStatus')!==undefined){
    throw Object.assign(new Error('COMPACTION_BUDGET_INACTIVE'), { code: 'COMPACTION_BUDGET_INACTIVE', reason: 'owner-service-conflict' });
  }
  // ADR-105: admission is synchronous in the parent fiber, before any published status, tool or hook.
  const settings = (ctx as unknown as { settings: BudgetSettingsLike }).settings;
  const evidence = verifySettingsSdkProof(ctx as unknown as SdkEvidenceContext, settings);
  if (!evidence.proof) throw Object.assign(new Error('COMPACTION_BUDGET_SETTINGS_SDK_UNVERIFIED'), { code: 'COMPACTION_BUDGET_SETTINGS_SDK_UNVERIFIED', reason: evidence.reason });
  const guard = installBudgetSettingsGuard(settings, evidence.proof);
  if (!guard.dispose) throw Object.assign(new Error(guard.status), { code: guard.status });
  try { ctx.effect(() => guard.dispose!); } catch (error) { guard.dispose(); throw error; }
  const readPolicy = () => snapshotBudgetPolicy(config);
  try { readPolicy(); } catch { context.logger.warn('COMPACTION_BUDGET_CONFIG'); }
  registerBudgetSettingsTool(ctx, settings, () => config.enabled !== false);
  const owner={};
  const enabled=config.enabled!==false;
  let active=true;
  const report=(reason:string)=>context.logger.warn('COMPACTION_BUDGET_INACTIVE',{reason});
  const scan=()=>{
    if(!active||!enabled)return;
    try { readPolicy(); } catch { report('config-invalid');return; }
    let agents:unknown[];
    try {agents=Array.from(context.agents.list());}catch{report('discovery-failed');return;}
    for(const agent of agents){
      try {
        const service=context.agentPresets.serviceFor(agent,'compaction');
        if(service===undefined)continue;
        let receipt=installBudgetHook(service,owner,readPolicy);
        if(receipt.status==='sdk-proof-required'){
          const evidence=verifyInstalledSdkProof(context as unknown as SdkEvidenceContext,agent as {ctx?:unknown});
          receipt=evidence.proof?installBudgetHook(service,owner,readPolicy,evidence.proof):{status:evidence.reason??'sdk-evidence-unavailable'};
        }
        if(!['installed','already-owned'].includes(receipt.status))report(receipt.status);
      }catch{report('discovery-failed');}
    }
  };
  const snapshot=():ComponentEffectSnapshot=>{
    if(!active)return {...coverageSnapshot(null,[]),reasons:['owner-inactive'],policy:null};
    let policy:Readonly<BudgetPolicy>;
    try { policy=readPolicy(); } catch {return {...coverageSnapshot(null,[]),state:'rejected',reasons:['config-invalid'],policy:null};}
    if(!enabled)return {...coverageSnapshot(null,[]),state:'policy-disabled',reasons:['policy-disabled'],policy:{...policy}};
    const result=readBudgetCoverage(context,owner,agent=>{
      const evidence=verifyInstalledSdkProof(context as unknown as SdkEvidenceContext,agent as {ctx?:unknown});
      return evidence.proof?undefined:evidence.reason??'sdk-evidence-unavailable';
    });
    return {...result,policy:{...policy}};
  };
  context.provide('omnisurgeCompactionBudgetStatus',{version:'__OMNISURGE_PACKAGE_VERSION__',snapshot});
  context.effect(()=>{
    const stopCreated=context.on('agent/created',scan),stopChanged=context.on('tools/change',scan);
    scan();
    return ()=>{
      active=false;
      stopCreated();stopChanged();
      for(const record of [...recordsFor(owner)].reverse()){
        try {record.dispose();}catch{report('restore-failed');}
      }
      // Disposed records cannot authenticate a marker left behind by a refusing foreign proxy.
      ownerRecords.delete(owner);
    };
  });
}
export interface BudgetStatusContext {
 agentPresets:{serviceFor(agent:unknown,name:string):object|undefined};
 agents:{list():Iterable<unknown>};
 logger:{warn(code:string,facts?:Record<string,unknown>):void};
 get?(name:string):unknown;
 provide(name:string,value:unknown):unknown;
 effect(callback:()=>()=>void):unknown;
 on(event:string,callback:()=>void):()=>void;
}
/** Read-only oracle: live binding + actual descriptor + this owner's live installation record. */
export function readBudgetCoverage(context:Pick<BudgetStatusContext,'agents'|'agentPresets'>,owner:object,proofRefusal?:(agent:unknown)=>string|undefined):ComponentEffectSnapshot {
 let agents:unknown[];
 try {agents=Array.from(context.agents.list());}catch{return {...coverageSnapshot(null,[]),reasons:['discovery-failed']};}
 const targets:TargetCoverage[]=[];
 for(const agent of agents){
  try {
   const service=context.agentPresets.serviceFor(agent,'compaction');
   if(service===undefined){targets.push({state:'waiting',reason:'service-unavailable'});continue;}
   if(liveRecord(service,owner)){targets.push({state:'covered',reason:'owner-live'});continue;}
   const reason=shapeRefusal(service)??proofRefusal?.(agent);
   targets.push(reason?{state:'rejected',reason}:{state:'waiting',reason:'hook-not-installed'});
  }catch{targets.push({state:'unconfirmed',reason:'discovery-failed'});}
 }
 return coverageSnapshot(agents.length,targets);
}
export default { name: NAME, inject, Config, apply };
