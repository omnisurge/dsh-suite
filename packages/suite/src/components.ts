import type {PluginManager} from '@deepseek-ai/dsh-plugin-manager';
import {readFile, realpath} from 'node:fs/promises';
import {join} from 'node:path';
import type {ComponentDefinition, ComponentStatus,ComponentEffectSnapshot} from './types.js';

export const SUITE_PACKAGE='@omnisurge/dsh-suite';
type Manager=Pick<PluginManager,'listBundles'|'listPlugins'|'setPluginEnabled'|'setBundleEnabled'>;
/** What the running component modules actually advertise. Injected by the Host entry so this module
 * stays a pure consumer of official inventory plus declared probes. */
export interface ComponentRuntimeProbe {
 loadedVersion(definition:ComponentDefinition):string|null;
 dispatchConfirmed(definition:ComponentDefinition):Promise<boolean>;
 effectSnapshot?(definition:ComponentDefinition):Promise<ComponentEffectSnapshot|null>;
}

export interface SourceComponentDefinition extends ComponentDefinition {source:string;export:string}
type ManifestMode='release'|'source';
type RecordValue=Record<string,unknown>;
const object=(value:unknown):value is RecordValue=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value);
/** The one validator for both the source declaration and the packed release manifest. The two
 * shapes differ only in how a module is spelled: source declares an owned `export`, release
 * declares the resolved `module`. Pack, upgrade and Host read the same rules here, so a manifest
 * accepted by one cannot fail later in another. */
function validateComponentManifest(value:unknown,mode:ManifestMode,invalidCode:string):(ComponentDefinition|SourceComponentDefinition)[]{
 const entries=mode==='release'
  ?object(value)&&value.protocol===2&&Array.isArray(value.components)&&value.components.length>0?value.components:null
  :Array.isArray(value)&&value.length>0?value:null;
 if(entries===null)throw Error(invalidCode);
 const definitions:(ComponentDefinition|SourceComponentDefinition)[]=[],identifiers=new Set<string>(),rowIds=new Set<string>(),modules=new Set<string>(),exports=new Set<string>();
 for(const raw of entries){
  if(!object(raw))throw Error(invalidCode);
  const allowed=mode==='release'?['id','module','rowId','display','runtime','effect']:['id','source','export','rowId','display','runtime','effect'];
  if(Object.keys(raw).some(key=>!allowed.includes(key)))throw Error(invalidCode);
  if(typeof raw.id!=='string'||!/^[a-z0-9][a-z0-9-]*$/.test(raw.id)||identifiers.has(raw.id))throw Error(invalidCode);
  identifiers.add(raw.id);
  if(typeof raw.rowId!=='string'||!raw.rowId||rowIds.has(raw.rowId))throw Error(invalidCode);
  rowIds.add(raw.rowId);
  let module:string;let source:string|undefined;let exported:string|undefined;
  if(mode==='release'){
   if(typeof raw.module!=='string'||!raw.module)throw Error(invalidCode);
   module=raw.module;
  }else{
   if(typeof raw.source!=='string'||!raw.source.startsWith('packages/suite/'))throw Error('COMPONENT_SOURCE_NOT_OWNED: '+raw.id);
   if(typeof raw.export!=='string'||!/^\.\/[a-z0-9][a-z0-9-]*$/.test(raw.export)||exports.has(raw.export))throw Error(invalidCode);
   source=raw.source;exported=raw.export;exports.add(raw.export);module=SUITE_PACKAGE+raw.export.slice(1);
  }
  if(module!==SUITE_PACKAGE&&!module.startsWith(SUITE_PACKAGE+'/'))throw Error('COMPONENT_MODULE_NOT_OWNED: '+raw.id);
  if(modules.has(module))throw Error(invalidCode);modules.add(module);
  if(!object(raw.display)||typeof raw.display.en!=='string'||!raw.display.en||typeof raw.display.zh!=='string'||!raw.display.zh)throw Error(invalidCode);
  const runtime=raw.runtime??null;let normalizedRuntime:ComponentDefinition['runtime']=null;
  if(runtime!==null){
   if(!object(runtime)||Object.keys(runtime).some(key=>!['service','versionField','dispatch'].includes(key))||typeof runtime.service!=='string'||!runtime.service||typeof runtime.versionField!=='string'||!runtime.versionField)throw Error(invalidCode);
   const dispatch=runtime.dispatch??null;
   if(dispatch!==null&&!object(dispatch))throw Error(invalidCode);
   const dispatchValue=dispatch as RecordValue|null;
   if(dispatchValue!==null&&(Object.keys(dispatchValue).some(key=>!['namespace','method'].includes(key))||typeof dispatchValue.namespace!=='string'||!dispatchValue.namespace||typeof dispatchValue.method!=='string'||!dispatchValue.method))throw Error(invalidCode);
   normalizedRuntime={service:runtime.service,versionField:runtime.versionField,dispatch:dispatchValue===null?null:{namespace:dispatchValue.namespace as string,method:dispatchValue.method as string}};
  }
  let effect:ComponentDefinition['effect'];
  if(raw.effect!==undefined){
   const value=raw.effect;
   if(!object(value)||Object.keys(value).some(key=>!['service','method'].includes(key))||typeof value.service!=='string'||!value.service||value.method!=='snapshot'||normalizedRuntime?.service!==value.service)throw Error(invalidCode);
   effect={service:value.service,method:value.method};
  }
  const display={en:raw.display.en,zh:raw.display.zh};
  const definition:ComponentDefinition={id:raw.id,rowId:raw.rowId,module,display,runtime:normalizedRuntime,...(effect===undefined?{}:{effect})};
  definitions.push(mode==='source'?{...definition,source:source!,export:exported!}:definition);
 }
 return definitions;
}
export function validateReleaseComponentManifest(value:unknown):ComponentDefinition[]{
 return validateComponentManifest(value,'release','COMPONENT_MANIFEST_INVALID') as ComponentDefinition[];
}
export function validateSourceComponentManifest(value:unknown):SourceComponentDefinition[]{
 return validateComponentManifest(value,'source','COMPONENT_DECLARATION_INVALID') as SourceComponentDefinition[];
}
/** The Suite's declared module set, read from the fixed manifest it carries. */
export async function readReleaseComponents(packageRoot:string):Promise<ComponentDefinition[]>{
 const root=await realpath(packageRoot),record=JSON.parse(await readFile(join(root,'components/manifest.json'),'utf8'));
 return validateReleaseComponentManifest(record);
}

/** Read-only inventory of the declared modules over official plugin inventory plus the declared
 * runtime probe. There is no preparation: a declared module ships inside the Suite, so installing,
 * upgrading or removing it separately is not a supported user path. */
function unconfirmedEffect(reason:string):ComponentEffectSnapshot {return {protocol:1,scope:'live-agent-bindings',state:'unconfirmed',complete:false,total:null,covered:0,waiting:0,rejected:0,unknown:null,reasons:[reason]};}
/** Validate unknown optional service output before transporting any of it across Remote. */
export function validEffectSnapshot(value:unknown):value is ComponentEffectSnapshot {
 if(!value||typeof value!=='object')return false;
 const v=value as ComponentEffectSnapshot;
 if(v.protocol!==1||v.scope!=='live-agent-bindings'||!['covered','waiting','partial','rejected','unconfirmed','policy-disabled','retired'].includes(v.state)||typeof v.complete!=='boolean')return false;
 const count=(n:unknown)=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0;
 if(!(v.total===null||count(v.total))||!(v.unknown===null||count(v.unknown))||![v.covered,v.waiting,v.rejected].every(count))return false;
 if(!Array.isArray(v.reasons)||v.reasons.length>32||!v.reasons.every(reason=>typeof reason==='string'&&/^[a-z0-9-]{1,80}$/.test(reason)))return false;
 if(v.complete&&(v.total===null||v.unknown!==0))return false;
 if(v.total!==null&&v.unknown!==null&&v.total!==v.covered+v.waiting+v.rejected+v.unknown)return false;
 if(v.state==='covered'&&(!v.complete||v.total===null||v.total===0||v.covered!==v.total))return false;
 if(v.policy!==undefined&&v.policy!==null&&(!v.policy||typeof v.policy!=='object'||![v.policy.checkpointTokens,v.policy.safetyTokens,v.policy.timeoutMs].every(count)))return false;
 return true;
}
export class ComponentInventory {
 constructor(private readonly manager:Manager,private readonly probe:ComponentRuntimeProbe){}
 async inspect(definition:ComponentDefinition,carriedVersion:string):Promise<ComponentStatus>{
  let loadedVersion:string|null=null;
  try {loadedVersion=this.probe.loadedVersion(definition);}catch(error){if(!definition.effect)throw error;}
  const base={id:definition.id,display:{...definition.display},module:definition.module,rowId:definition.rowId,carriedVersion,loadedVersion,rowEnabled:false,state:'owner-missing' as ComponentStatus['state'],nextAction:'check-owner' as ComponentStatus['nextAction'],diagnostic:'SUITE_OWNER_MISSING'};
  const bundles=await this.manager.listBundles(),plugins=await this.manager.listPlugins();
  const suite=bundles.find(candidate=>candidate.name===SUITE_PACKAGE);
  if(!suite?.enabled||suite.error)return base;
  if(suite.meta?.error)return {...base,diagnostic:'SUITE_METADATA_INVALID'};
  const rows=suite.rows.filter(row=>row.rowId===definition.rowId&&row.moduleName===definition.module);
  const owners=plugins.filter(plugin=>plugin.moduleName===definition.module);
  if(rows.length!==1||owners.length!==1||rows[0].entryId!==owners[0].entryId||owners[0].patchId!==definition.rowId)return {...base,diagnostic:'COMPONENT_OWNER_CONFLICT'};
  const owner=owners[0];
  base.rowEnabled=owner.enabled;
  // Enabling and disabling a row is the official switch's fact, never this page's: the card only says
  // what the single remaining user action is.
  if(!owner.enabled)return {...base,state:'disabled',nextAction:'enable-row',diagnostic:'COMPONENT_ROW_DISABLED'};
  if(owner.fiberPhase!=='active'||!await this.probe.dispatchConfirmed(definition))return {...base,state:'unconfirmed',...(definition.effect?{effect:unconfirmedEffect('row-not-active')}:{}),nextAction:'check-runtime',diagnostic:'COMPONENT_RUNTIME_UNCONFIRMED'};
  // A module that declares no runtime probe has no running-version fact to prove. It is a config-only
  // contribution, never a ready runtime; readiness would overclaim what this inventory can observe.
  if(definition.runtime===null)return {...base,state:'config-only',nextAction:'none',diagnostic:'COMPONENT_CONFIG_ONLY'};
  // The module is part of the Suite: the running module reporting another version proves the running
  // bytes are still the previous Suite, which is a pending restart and never readiness.
  if(loadedVersion!==null&&loadedVersion!==carriedVersion)return {...base,state:'restart-required',nextAction:'restart',diagnostic:'COMPONENT_RESTART_PENDING'};
  if(definition.effect){
   let effect:ComponentEffectSnapshot|null=null;
   try {effect=await this.probe.effectSnapshot?.(definition)??null;}catch{/* An optional reporter failure must remain unconfirmed, not fail the whole inventory. */}
   if(!validEffectSnapshot(effect)||loadedVersion===null)effect=unconfirmedEffect('effect-unavailable');
   // Project only the declared public whitelist, never arbitrary reporter properties.
   effect={protocol:1,scope:'live-agent-bindings',state:effect.state,complete:effect.complete,total:effect.total,covered:effect.covered,waiting:effect.waiting,rejected:effect.rejected,unknown:effect.unknown,reasons:[...effect.reasons],...(effect.policy===undefined?{}:{policy:effect.policy===null?null:{checkpointTokens:effect.policy.checkpointTokens,safetyTokens:effect.policy.safetyTokens,timeoutMs:effect.policy.timeoutMs}})};
   return {...base,effect,state:effect.state,nextAction:['covered','waiting','retired','policy-disabled'].includes(effect.state)?'none':'check-runtime',diagnostic:'COMPONENT_EFFECT_'+effect.state.toUpperCase().replaceAll('-','_')};
  }
  return {...base,state:'ready',nextAction:'none',diagnostic:'COMPONENT_READY'};
 }
}
