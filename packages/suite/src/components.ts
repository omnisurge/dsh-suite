import type {PluginManager} from '@deepseek-ai/dsh-plugin-manager';
import {readFile, realpath} from 'node:fs/promises';
import {join} from 'node:path';
import type {ComponentDefinition, ComponentStatus} from './types.js';

export const SUITE_PACKAGE='@omnisurge/dsh-suite';
type Manager=Pick<PluginManager,'listBundles'|'listPlugins'|'setPluginEnabled'|'setBundleEnabled'>;
/** What the running component modules actually advertise. Injected by the Host entry so this module
 * stays a pure consumer of official inventory plus declared probes. */
export interface ComponentRuntimeProbe {
 loadedVersion(definition:ComponentDefinition):string|null;
 dispatchConfirmed(definition:ComponentDefinition):Promise<boolean>;
}

/** The Suite's declared module set, read from the fixed manifest it carries. The members are modules
 * inside the Suite package itself, so this is release identity plus row identity, never an
 * installed-state store: installed/loaded facts stay official-owned. */
export async function readReleaseComponents(packageRoot:string):Promise<ComponentDefinition[]>{
 const root=await realpath(packageRoot),record=JSON.parse(await readFile(join(root,'components/manifest.json'),'utf8'));
 if(!record||typeof record!=='object'||Array.isArray(record)||record.protocol!==2||!Array.isArray(record.components)||record.components.length===0)throw Error('COMPONENT_MANIFEST_INVALID');
 const definitions:ComponentDefinition[]=[];
 for(const entry of record.components){
  if(!entry||typeof entry!=='object'||Array.isArray(entry))throw Error('COMPONENT_MANIFEST_INVALID');
  if(typeof entry.id!=='string'||!/^[a-z0-9][a-z0-9-]*$/.test(entry.id)||typeof entry.rowId!=='string'||typeof entry.module!=='string')throw Error('COMPONENT_MANIFEST_INVALID');
  // The row must load a subpath of the Suite package: the official installer refuses insert-only
  // packages, and Node resolution never enters a nested node_modules, so any other module name would
  // be unreachable inside a profile.
  if(entry.module!==SUITE_PACKAGE&&!entry.module.startsWith(SUITE_PACKAGE+'/'))throw Error('COMPONENT_MODULE_NOT_OWNED');
  const display=entry.display;
  if(!display||typeof display.en!=='string'||!display.en||typeof display.zh!=='string'||!display.zh)throw Error('COMPONENT_MANIFEST_INVALID');
  const runtime=entry.runtime??null;
  if(runtime!==null&&(typeof runtime.service!=='string'||typeof runtime.versionField!=='string'))throw Error('COMPONENT_MANIFEST_INVALID');
  definitions.push({id:entry.id,rowId:entry.rowId,module:entry.module,display:{en:display.en,zh:display.zh},runtime:runtime===null?null:{service:runtime.service,versionField:runtime.versionField,dispatch:runtime.dispatch??null}});
 }
 const identifiers=new Set();
 for(const definition of definitions){if(identifiers.has(definition.id))throw Error('COMPONENT_MANIFEST_INVALID');identifiers.add(definition.id);}
 return definitions;
}

/** Read-only inventory of the declared modules over official plugin inventory plus the declared
 * runtime probe. There is no preparation: a declared module ships inside the Suite, so installing,
 * upgrading or removing it separately is not a supported user path. */
export class ComponentInventory {
 constructor(private readonly manager:Manager,private readonly probe:ComponentRuntimeProbe){}
 async inspect(definition:ComponentDefinition,carriedVersion:string):Promise<ComponentStatus>{
  const loadedVersion=this.probe.loadedVersion(definition);
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
  if(owner.fiberPhase!=='active'||!await this.probe.dispatchConfirmed(definition))return {...base,state:'unconfirmed',nextAction:'check-runtime',diagnostic:'COMPONENT_RUNTIME_UNCONFIRMED'};
  // The module is part of the Suite: the running module reporting another version proves the running
  // bytes are still the previous Suite, which is a pending restart and never readiness.
  if(loadedVersion!==null&&loadedVersion!==carriedVersion)return {...base,state:'restart-required',nextAction:'restart',diagnostic:'COMPONENT_RESTART_PENDING'};
  return {...base,state:'ready',nextAction:'none',diagnostic:'COMPONENT_READY'};
 }
}
