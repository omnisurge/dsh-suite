/** MCP server management: read the live server rows, and route writes to the owner of the runtime.
 *
 * Two facts decide the design. (1) The write target depends on the runtime: rc.2+ delegates generic static
 * servers to the official `mcp-manager` (`mcp-managed.ts`), while rc.1 and the Suite's own OAuth/dual clients
 * still write the profile patch. The capability check picks exactly one owner; there is no second write path.
 * (2) The Loader and the tool table know `running`/`failed`/`disabled`/`pending` plus a tool count. Client
 * plugins that DO publish a loopback control plane (the dual v2 client and the OAuth client) add the kind and
 * the negotiated protocol era, read from their own `status`/`probe` endpoints (ADR-030).
 *
 * Secrets: `headers`/`env` values exist only inside the write path. They are never returned, logged, or
 * embedded in an error message; the catalog carries counts only. */
import {RemoteError} from '@deepseek-ai/dsh-typert-protocol';
import type {} from '@deepseek-ai/dsh-typert-protocol/types';
import {copyFile,mkdir,open,readFile,rename,unlink,writeFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {isMap,isSeq,parseDocument} from 'yaml';
import {MANAGED_ROW_PREFIX,managedCatalog,managedEntryFromDraft,managedProbe,managedStatusOf,managedWrite} from './mcp-managed.js';
import type {ManagedAuthority} from './mcp-managed.js';
import {failureOf,fileStateOf} from './mcp-purpose.js';
import type {PurposeRemoval,PurposeStoreLike} from './mcp-purpose.js';
import type {McpDraftInvalidDetail,McpMigrationResult,McpProbeResult,McpPurposePartialDetail,McpPurposeWriteFailureDetail,McpRuntimeState,McpRuntimeStatus,McpServerCatalog,McpServerDraft,McpServerEntry,McpServerKind,McpServerMutation,McpServerState,McpServerTransport,McpWriteFailureDetail} from './types.js';
export type {McpMigrationResult,McpProbeResult,McpRuntimeStatus,McpServerCatalog,McpServerDraft,McpServerEntry,McpServerMutation} from './types.js';

declare module '@deepseek-ai/dsh-typert-protocol/types'{
 interface RemoteErrorDetailsMap{
  'mcp/profile-unavailable':{};
  'mcp/profile-patch-unreadable':{};
  'mcp/draft-invalid':{};
  'mcp/server-exists':{};
  'mcp/server-missing':{};
  'mcp/server-not-editable':{};
  'mcp/client-package-unknown':{};
  'mcp/write-locked':{};
  'mcp/managed-unavailable':{};
  'mcp/managed-write-failed':{reason:'refused';detail?:string};
  'mcp/write-failed':McpWriteFailureDetail;
  'mcp/row-missing':{};
  'mcp/probe-unavailable':{};
  'mcp/migration-unavailable':{};
  'mcp/purpose-conflict':{};
  'mcp/purpose-key-unknown':{};
  'mcp/purpose-invalid':{};
  'mcp/purpose-write-failed':McpPurposeWriteFailureDetail;
  'mcp/purpose-unavailable':{};
  'mcp/purpose-partial':McpPurposePartialDetail;
 }
}

/** Verified against the target runtime's cordis typings (`lib/types/fiber.d.ts`): the enum is inlined, so
 * these numbers are the ABI. Only ACTIVE/FAILED/DISPOSED/UNLOADING are distinguished; everything earlier
 * than ACTIVE is reported as `pending`. */
const FIBER_ACTIVE=2;
const FIBER_FAILED=3;
const FIBER_DISPOSED=4;
const FIBER_UNLOADING=5;

const SERVER_NAME_PATTERN=/^[A-Za-z0-9_-]{1,32}$/;
/** The client packages whose own loopback control plane this build can read (ADR-030 D1/D2). The prefix is
 * the plugin's public path on the official webServer; nothing here guesses a port, and an unlisted package
 * is reported as "no connection status to read" instead of being probed on an invented path. */
export const CLIENT_ADAPTERS:Readonly<Record<string,{prefix:string;kind:McpServerKind}>>=Object.freeze({
 // ADR-033: the Suite now carries both clients as subpath modules. The external package names stay listed
 // with the same prefix/kind so a row written before the migration keeps being described (read-only
 // compatibility): the adapter table is about what a row loads, not about which file ships it.
 '@omnisurge/dsh-mcp-dual-client':{prefix:'/mcp-dual-client',kind:'static'},
 '@omnisurge/dsh-suite/mcp-dual':{prefix:'/mcp-dual-client',kind:'static'},
 '@omnisurge/dsh-mcp-oauth-client':{prefix:'/mcp-oauth-client',kind:'oauth'},
 '@omnisurge/dsh-suite/mcp-oauth':{prefix:'/mcp-oauth-client',kind:'oauth'},
});
/** The historical external name of the v2-capable static client (SDK v2 + version negotiation, ADR-041 in
 * omnidsh). Kept as the read-compatible identity of old rows; new rows are written with SUITE_V2_CLIENT. */
export const V2_CLIENT='@omnisurge/dsh-mcp-dual-client';
/** The subpath the Suite carries (ADR-033): the only name a migration writes. */
export const SUITE_V2_CLIENT='@omnisurge/dsh-suite/mcp-dual';
export const SUITE_OAUTH_CLIENT='@omnisurge/dsh-suite/mcp-oauth';
/** The one profile-level package (ADR-033): it carries both client subpaths, so a profile that depends on it
 * can load either without naming an external package anywhere. */
export const SUITE_PACKAGE='@omnisurge/dsh-suite';
/** The historical external name of the OAuth client (ADR-033 D4): read-compatible, and a migration source. */
export const OAUTH_CLIENT='@omnisurge/dsh-mcp-oauth-client';
const V2_CLIENTS:ReadonlySet<string>=new Set([V2_CLIENT,SUITE_V2_CLIENT]);
/** The two historical names and the subpath each one moves to (ADR-033 D4). One table: the row fact
 * (`clientSource`) and the migration both read it, so a legacy name cannot move without also being labelled.
 */
const LEGACY_TO_SUITE:Readonly<Record<string,string>>=Object.freeze({[V2_CLIENT]:SUITE_V2_CLIENT,[OAUTH_CLIENT]:SUITE_OAUTH_CLIENT});
/** The official client: initialize only, so its rows are v1 and it has no status endpoint. */
export const OFFICIAL_CLIENT='@deepseek-ai/dsh-mcp-client';
/** ADR-033 D4: which layer provides a row's client. Derived from the same constants the adapter table and the
 * migration use, so the page never keeps its own package-name list. */
export function clientSourceOf(clientPackage:string):McpServerEntry['clientSource']{
 if(clientPackage===OFFICIAL_CLIENT)return 'official';
 if(LEGACY_TO_SUITE[clientPackage]!==undefined)return 'external-legacy';
 if(clientPackage===SUITE_V2_CLIENT||clientPackage===SUITE_OAUTH_CLIENT)return 'suite';
 return 'unknown';
}
/** A reader answers the client plugin's own raw body. `mcp-servers` is the only place it becomes the public
 * type; `normalizeRuntime` stays idempotent so a caller that passes a normalized value back cannot lose its
 * state (the double-normalization bug G5 found, ADR-030 D2). */
export type McpRuntimeReader=(clientPackage:string,serverName:string,action:'status'|'probe')=>Promise<unknown|null>;
/** One bounded timeout for every loopback status read (ADR-030 D2). */
export const RUNTIME_TIMEOUT_MS=1200;
/** At most this many loopback reads are in flight at once (ADR-030 D2). */
export const RUNTIME_CONCURRENCY=4;
/** A web server bound off-loopback is not asked for status: the answer belongs to this machine only (ADR-030 D2).
 * The predicate itself lives in shared/loopback-origin so the carried MCP clients can read the same rule. */
import {loopbackOrigin} from './loopback-origin.js';
export {loopbackOrigin};
export function kindOf(clientPackage:string):McpServerKind{
 return CLIENT_ADAPTERS[clientPackage]?.kind==='oauth'?'oauth':'static';
}
/** Why a check could not be offered, in the two shapes the page and the Remote both name. The available
 * branch carries the reader the predicate already proved exists, so the action cannot re-check it. */
type ProbeUnavailableReason='not-running'|'not-probeable';
type ProbeAvailability={available:true;reader:McpRuntimeReader}|{available:false;reason:ProbeUnavailableReason};
/** The ONE availability predicate (ADR-031 D3): an adapter package, an HTTP row, a loopback to ask, and a
 * row the Loader actually started. The catalog renders the action from it and probeMcpServer refuses from
 * it, so the button and the Remote can never disagree — a stdio row, a disabled row and a pending row are
 * all "no check" for the same reason on both sides (ADR-030 D3). */
function probeAvailability(ctx:McpServerContext,transport:McpServerTransport,clientPackage:string,state:McpServerState):ProbeAvailability{
 const reader=ctx.runtime;
 // Transport/adapter/loopback first: without a control plane there is no endpoint to ask at all.
 if(CLIENT_ADAPTERS[clientPackage]===undefined||transport!=='streamable-http'||reader===undefined)return {available:false,reason:'not-probeable'};
 // Then the row: a disabled or not-yet-loaded row has no live client that could answer.
 if(state!=='running'&&state!=='failed')return {available:false,reason:'not-running'};
 return {available:true,reader};
}
/** What the row could negotiate at best. An unknown client package is `unknown`: not the same as v1-only, and
 * the page must not claim a protocol nobody promised (ADR-030 D4). */
export function protocolSupportOf(clientPackage:string,transport:McpServerTransport):'v1-only'|'negotiable'|'unknown'{
 const adapter=CLIENT_ADAPTERS[clientPackage];
 if(adapter!==undefined)return V2_CLIENTS.has(clientPackage)&&transport==='streamable-http'?'negotiable':'v1-only';
 if(clientPackage===OFFICIAL_CLIENT)return 'v1-only';
 return 'unknown';
}
const LOCK_SUFFIX='.omnisurge.lock';
const BACKUP_SUFFIX='.omnisurge-backup';
const RELOAD_WAIT_MS=8000;

/** The slice of the Loader entry this module reads; only declared fields are named. */
export interface LoaderEntryLike {
 options:{id:string;name?:string;config?:Record<string,unknown>;disabled?:boolean};
 fiber?:{state?:number};
 parent?:{tree?:{ctx?:{fiber?:{entry?:{id?:string}}}}};
}
export interface LoaderLike{entries():Iterable<LoaderEntryLike>;}
export interface ToolSchemaLike{name?:string;}
export interface ToolsLike{schemas():readonly ToolSchemaLike[];}

export interface McpServerContext {
 loader:LoaderLike|undefined;
 tools:ToolsLike|undefined;
 /** Profile patch file; null when the running process has no profile context. */
 patchPath:string|null;
 /** Profile directory, used only to find which installed package backs MCP rows. */
 profileDir:string|null;
 signal?:AbortSignal;
 /** How long a mutation waits for the runtime to reload the row; tests pass 0. */
 reloadWaitMs?:number;
 /** Reads one client plugin's connection report through its loopback control plane (ADR-030).
  * Absent (or returning null) means "no connection status to read" — never an error for the page. */
 runtime?:McpRuntimeReader;
 /** ADR-032 D5: the purpose bypass file, so a row deletion cleans its key inside the same lock. Absent means
  * this caller owns no purposes (tests and older callers) and the deletion stays patch-only. */
 purposes?:PurposeStoreLike;
 /** ADR-094: the official MCP manager is the authority when this runtime provides it. Absent means the
  * runtime predates it and the profile-patch path below stays the only write target. */
 managed?:ManagedAuthority;
}

const unreadable=()=>new RemoteError('mcp/profile-patch-unreadable','MCP_PROFILE_PATCH_UNREADABLE: the profile patch is not a YAML sequence this build can edit',{});
const unavailable=()=>new RemoteError('mcp/profile-unavailable','MCP_PROFILE_UNAVAILABLE: this process has no profile patch to write',{});
/** A refusal carries the machine fact the page renders (field + reason, and the range when the value has one)
 * next to the readable diagnostic: the Host owns the fact, the Client owns the sentence (AGENTS §5.10). The
 * second parameter is required so no validation path can refuse without naming what it refused. */
const invalid=(detail:string,fact:McpDraftInvalidDetail)=>new RemoteError('mcp/draft-invalid','MCP_DRAFT_INVALID: '+detail,fact);

const sleep=(ms:number)=>new Promise<void>(resolve=>{setTimeout(resolve,ms);});

function codeOf(error:unknown):string|undefined {
 return typeof error==='object'&&error!==null&&typeof (error as NodeJS.ErrnoException).code==='string'?(error as NodeJS.ErrnoException).code:undefined;
}

function toPlain(node:unknown):unknown {
 const value=node as {toJSON?:()=>unknown}|null|undefined;
 return value&&typeof value.toJSON==='function'?value.toJSON():node;
}

function includeScope(entry:LoaderEntryLike):boolean {
 // Addressable profile rows live under the profile's `include` row, exactly as the official editor scopes them.
 const id=entry.parent?.tree?.ctx?.fiber?.entry?.id;
 return id===undefined||id==='include';
}

function readConfig(entry:LoaderEntryLike):Record<string,unknown>|null {
 const config=entry.options.config;
 return config&&typeof config==='object'?config:null;
}

function transportOf(config:Record<string,unknown>):McpServerTransport|null {
 const value=config.transport;
 if(value==='stdio'||value==='streamable-http')return value;
 if(typeof config.command==='string')return 'stdio';
 if(typeof config.url==='string')return 'streamable-http';
 return null;
}

export function serverNameOf(entry:LoaderEntryLike):string|null {
 const config=readConfig(entry);
 if(!config)return null;
 const name=config.serverName;
 return typeof name==='string'&&name.length>0&&transportOf(config)!==null?name:null;
}

/** Unique addressable entries: the same id twice is not addressable, matching the official editor rule. */
export function loadedEntries(loader:LoaderLike|undefined):LoaderEntryLike[] {
 if(!loader)return [];
 const candidates=[...loader.entries()].filter(includeScope);
 const counts=new Map<string,number>();
 for(const entry of candidates)counts.set(entry.options.id,(counts.get(entry.options.id)??0)+1);
 return candidates.filter(entry=>counts.get(entry.options.id)===1);
}

/** ADR-032 D3: the row set the purpose section may name. It reuses the catalog's own identification
 * (`loadedEntries` + `serverNameOf` + `stateOf`) instead of adding a second table; `enabled:false` rows are
 * still addressable by the page, they are just never shown in the section. */
export function mcpRowsOf(loader:LoaderLike|undefined):{rowId:string;serverName:string;enabled:boolean}[] {
 const rows:{rowId:string;serverName:string;enabled:boolean}[]=[];
 for(const entry of loadedEntries(loader)){
  const rowId=typeof entry.options.id==='string'?entry.options.id:null;
  if(rowId===null)continue;
  const serverName=serverNameOf(entry);
  if(serverName===null)continue;
  rows.push({rowId,serverName,enabled:stateOf(entry)!=='disabled'});
 }
 return rows;
}
function stateOf(entry:LoaderEntryLike):McpServerState {
 if(entry.options.disabled===true)return 'disabled';
 const state=entry.fiber?.state;
 if(state===FIBER_DISPOSED||state===FIBER_UNLOADING)return 'disabled';
 if(state===FIBER_FAILED)return 'failed';
 if(state===FIBER_ACTIVE)return 'running';
 return 'pending';
}

function toolCountOf(toolNames:readonly string[],serverName:string):number {
 const prefix='mcp__'+serverName+'__';
 let count=0;
 for(const name of toolNames)if(name.startsWith(prefix))count+=1;
 return count;
}

function toolNamesOf(tools:ToolsLike|undefined):string[] {
 const names:string[]=[];
 if(!tools)return names;
 for(const schema of tools.schemas()){
  const name=schema?.name;
  if(typeof name==='string')names.push(name);
 }
 return names;
}

interface PatchRow {rowId:string;config:Record<string,unknown>;serverName:string|null;packageName:string|null;outerIndex:number;innerIndex:number;disabled:boolean;}

function insertRows(doc:ReturnType<typeof parseDocument>):PatchRow[] {
 const rows:PatchRow[]=[];
 const contents=doc.contents;
 if(!isSeq(contents))return rows;
 // A row can also be switched off from outside its insert list: "- id: X, disabled: true" is the
 // override form this build writes for rows an installed bundle owns. An override is folded into the insert
 // row it disables; an orphan override (no insert, and no loaded row) is NOT a server the page can describe --
 // it has no config, so showing it would invent one. Inserts without an override stay enabled.
 const overrides=new Map<string,boolean>();
 contents.items.forEach(item=>{
  if(!isMap(item)||item.has('insert'))return;
  const id=toPlain(item.get('id'));
  if(typeof id==='string')overrides.set(id,item.get('disabled')===true);
 });
 contents.items.forEach((outer,outerIndex)=>{
  if(!isMap(outer)||!outer.has('insert'))return;
  const insert=outer.get('insert');
  if(!isSeq(insert))return;
  insert.items.forEach((inner,innerIndex)=>{
   if(!isMap(inner))return;
   const id=toPlain(inner.get('id'));
   const config=toPlain(inner.get('config'));
   if(typeof id!=='string')return;
   const plain=config&&typeof config==='object'&&!Array.isArray(config)?config as Record<string,unknown>:{};
   const name=plain.serverName;
   const declared=inner.get('name');
   const disabled=inner.get('disabled')===true||overrides.get(id)===true;
   rows.push({rowId:id,config:plain,serverName:typeof name==='string'?name:null,packageName:typeof declared==='string'?declared:null,outerIndex,innerIndex,disabled});
  });
 });
 return rows;
}

/** yaml types keys as nodes on a parsed map; the runtime accepts plain string keys. */
function setMapValue(map:unknown,key:string,value:unknown):void {
 (map as {set:(key:string,value:unknown)=>void}).set(key,value);
}

function parsePatch(text:string){
 // An absent or emptied profile patch is an empty sequence, not a parse failure.
 const source=text.trim().length===0?'[]\n':text;
 const doc=parseDocument(source,{customTags:[{tag:'tag:yaml.org,2002:js',resolve:(value:string)=>value}]});
 if(doc.errors.length>0)throw unreadable();
 if(!isSeq(doc.contents))throw unreadable();
 return doc;
}

async function readPatchText(path:string):Promise<string> {
 try{
  return await readFile(path,'utf8');
 }catch(error){
  if(codeOf(error)==='ENOENT')return '[]\n';
  throw unavailable();
 }
}

export function reloadModeOf(profilePackage:Record<string,unknown>|null):'live'|'manual' {
 const dsh=profilePackage?.dsh;
 const profile=typeof dsh==='object'&&dsh!==null?(dsh as Record<string,unknown>).profile:undefined;
 const mode=typeof profile==='object'&&profile!==null?(profile as Record<string,unknown>).patchReload:undefined;
 return mode==='live'?'live':'manual';
}

export async function readProfilePackage(profileDir:string|null):Promise<Record<string,unknown>|null> {
 if(!profileDir)return null;
 try{
  return JSON.parse(await readFile(join(profileDir,'package.json'),'utf8')) as Record<string,unknown>;
 }catch{
  return null;
 }
}

/** The live server list. `origin` and `reload` come from the profile patch itself, not from a cache. */
export async function readMcpServers(ctx:McpServerContext):Promise<McpServerCatalog> {
 ctx.signal?.throwIfAborted();
 const entries=loadedEntries(ctx.loader);
 const toolNames=toolNamesOf(ctx.tools);
 const profilePackage=await readProfilePackage(ctx.profileDir);
 const reload=reloadModeOf(profilePackage);
 const rows=ctx.patchPath?insertRows(parsePatch(await readPatchText(ctx.patchPath))):[];
 const profileRowIds=new Set(rows.map(row=>row.rowId));
 const rowPackages=new Map(rows.map(row=>[row.rowId,row.packageName] as const));
 const dualAvailable=v2ClientAvailable(profilePackage,rowPackages.values(),entries);
 const servers:McpServerEntry[]=[],seen=new Set<string>(),seenRows=new Set<string>();
 for(const entry of entries){
  seenRows.add(entry.options.id);
  const name=serverNameOf(entry);
  if(name===null||seen.has(name))continue;
  seen.add(name);
  const config=readConfig(entry)??{};
  const transport=transportOf(config)??'streamable-http';
  const headers=config.headers;
  const env=config.env;
  const clientPackage=typeof entry.options.name==='string'&&entry.options.name.length>0?entry.options.name:rowPackages.get(entry.options.id)??'';
  const state=stateOf(entry);
  servers.push({
   name,
   transport,
   state,
   toolCount:toolCountOf(toolNames,name),
   rowId:entry.options.id,
   origin:profileRowIds.has(entry.options.id)?'profile':'loaded',
   managed:false,
   editable:profileRowIds.has(entry.options.id),
   headerCount:headers&&typeof headers==='object'&&!Array.isArray(headers)?Object.keys(headers).length:0,
   envCount:env&&typeof env==='object'&&!Array.isArray(env)?Object.keys(env).length:0,
   ...stdioFactsOf(transport,config),
   clientPackage,
   clientSource:clientSourceOf(clientPackage),
   kind:kindOf(clientPackage),
   ...oauthFactsOf(clientPackage,config),
   runtime:null,
   upgradable:false,
   probeAvailable:probeAvailability(ctx,transport,clientPackage,state).available,
   protocolSupport:protocolSupportOf(clientPackage,transport),
  });
 }
 // Rows written to the profile that the Loader has not picked up yet (or that are switched off) are still
 // rows the user must be able to see, edit and delete: a write that never loads must not vanish silently.
 for(const row of rows){
  if(seenRows.has(row.rowId))continue;
  seenRows.add(row.rowId);
  const name=row.serverName??row.rowId;
  const headers=row.config.headers;
  const env=row.config.env;
  const clientPackage=row.packageName??'';
  // A patch row the Loader has no entry for is either switched off or not mounted yet: neither has a live
  // client, so neither may offer a check (ADR-031 D3).
  const state:McpServerState=row.disabled?'disabled':'pending';
  servers.push({
   name,
   transport:transportOf(row.config)??'streamable-http',
   state,
   toolCount:row.serverName===null?0:toolCountOf(toolNames,row.serverName),
   rowId:row.rowId,
   origin:'profile',
   managed:false,
   editable:true,
   headerCount:headers&&typeof headers==='object'&&!Array.isArray(headers)?Object.keys(headers).length:0,
   envCount:env&&typeof env==='object'&&!Array.isArray(env)?Object.keys(env).length:0,
   ...stdioFactsOf(transportOf(row.config)??'streamable-http',row.config),
   clientPackage,
   clientSource:clientSourceOf(clientPackage),
   kind:kindOf(clientPackage),
   ...oauthFactsOf(clientPackage,row.config),
   runtime:null,
   upgradable:false,
   probeAvailable:probeAvailability(ctx,transportOf(row.config)??'streamable-http',clientPackage,state).available,
   protocolSupport:protocolSupportOf(clientPackage,transportOf(row.config)??'streamable-http'),
  });
 }
 // ADR-094：官方 manager 的条目与状态是权威；rowId 用 managed:<name> 与 profile 行区分，写操作据此路由。
 if(ctx.managed){
  for(const row of managedCatalog(ctx.managed)){
   const transport=transportOf(row.entry)??'streamable-http';
   const status=managedStatusOf(row.view);
   const headers=row.entry.headers;
   const env=row.entry.env;
   servers.push({
    name:row.name,
    transport,
    state:status.state,
    toolCount:toolCountOf(toolNames,row.name),
    rowId:MANAGED_ROW_PREFIX+row.name,
    origin:'profile',
    managed:true,
    enabled:row.entry.enabled!==false,
    editable:true,
    headerCount:headers&&typeof headers==='object'&&!Array.isArray(headers)?Object.keys(headers).length:0,
    envCount:env&&typeof env==='object'&&!Array.isArray(env)?Object.keys(env).length:0,
    ...stdioFactsOf(transport,row.entry),
    clientPackage:OFFICIAL_CLIENT,
    clientSource:'official',
    kind:'static',
    // The official manager's diagnostic is a client report like any other: mask endpoints and truncate it at
    // the same boundary the legacy path uses (ADR-030 D2), instead of passing raw text through.
    runtime:status.runtime===null?null:{...status.runtime,...(typeof status.runtime.error==='string'?{error:sanitizeDiagnostic(status.runtime.error)}:{})},
    upgradable:false,
    probeAvailable:true,
    protocolSupport:protocolSupportOf(OFFICIAL_CLIENT,transport),
   });
  }
 }
 servers.sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);
 // The v2 migration is offered only where it can work: an official static-HTTP row in a profile that
 // already carries the v2-capable client package (ADR-030 D5).
 for(const server of servers){
  // 官方 manager 托管的行不参与 v2 迁移：迁移动作只改 profile 行，托管行的权威是 config.servers（ADR-094）。
  server.upgradable=dualAvailable&&server.transport==='streamable-http'&&server.clientPackage===OFFICIAL_CLIENT&&!server.rowId.startsWith(MANAGED_ROW_PREFIX);
 }
 await readRuntimes(ctx,servers);
 return {servers,reload,authority:ctx.managed?'official':'rows'};
}

/** The one availability predicate for the v2 client: profile dependency/bundle, a stored row, or a loaded row.
 * Both the catalog (which offers the migration) and the action (which performs it) read this same fact. */
export function v2ClientAvailable(profilePackage:Record<string,unknown>|null,rowPackages:Iterable<string|null>,entries:Iterable<LoaderEntryLike>):boolean{
 // The Suite carries both subpaths: a clean profile depends on '@omnisurge/dsh-suite' and holds no MCP row at
 // all, so the external names can never be the only witness (ADR-033 D1).
 if(hasClientPackage(profilePackage,SUITE_PACKAGE))return true;
 for(const name of V2_CLIENTS)if(hasClientPackage(profilePackage,name))return true;
 for(const name of rowPackages)if(name!==null&&(V2_CLIENTS.has(name)||name===SUITE_PACKAGE))return true;
 for(const entry of entries){const name=entry.options.name;if(typeof name==='string'&&(V2_CLIENTS.has(name)||name===SUITE_PACKAGE))return true;}
 return false;
}
/** 该包是否已在 profile 里声明（依赖或 `dsh.profile.bundles`）；迁移只在这个事实成立时提供。 */
function hasClientPackage(profilePackage:Record<string,unknown>|null,name:string):boolean{
 if(!profilePackage)return false;
 const dependencies=profilePackage.dependencies;
 if(dependencies&&typeof dependencies==='object'&&Object.hasOwn(dependencies,name))return true;
 const dsh=profilePackage.dsh;
 const profile=dsh&&typeof dsh==='object'?(dsh as Record<string,unknown>).profile:undefined;
 const bundles=profile&&typeof profile==='object'?(profile as Record<string,unknown>).bundles:undefined;
 return Array.isArray(bundles)&&bundles.includes(name);
}
/** Every status read is bounded and non-fatal: a slow or broken client plugin degrades that one row to
/** `runtime: null`, never the whole list (ADR-030 D2). */
async function withDeadline<T>(work:Promise<T>,timeoutMs:number):Promise<T|null>{
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{
  return await Promise.race([work,new Promise<null>(resolve=>{timer=setTimeout(()=>resolve(null),timeoutMs);})]);
 }catch{
  return null;
 }finally{
  if(timer!==undefined)clearTimeout(timer);
 }
}
async function readRuntimes(ctx:McpServerContext,servers:McpServerEntry[]):Promise<void>{
 const reader=ctx.runtime;
 if(!reader)return;
 // A row the Loader never started (disabled/pending) has no live connection to report, and the page does not show
 // a connection word for it: asking would be a request nobody reads (ADR-030 D2).
 const rows=servers.filter(server=>server.transport==='streamable-http'&&CLIENT_ADAPTERS[server.clientPackage]!==undefined&&(server.state==='running'||server.state==='failed'));
 let cursor=0;
 const worker=async()=>{
  while(cursor<rows.length){
   const server=rows[cursor];cursor+=1;
   // 状态不是本模块的事实来源：客户端插件说什么就是什么，读失败就是不读（null），不推断、不重试到绿。
   const runtime=await withDeadline(reader(server.clientPackage,server.name,'status'),RUNTIME_TIMEOUT_MS);
   server.runtime=runtime===null?null:normalizeRuntime(runtime);
  }
 };
 await Promise.all(Array.from({length:Math.min(RUNTIME_CONCURRENCY,rows.length)},()=>worker()));
}
/** Reduce one client plugin's report to the public facts: state/era/tool count/raw error only. */
const RUNTIME_STATES:ReadonlySet<string>=new Set(['connected','failed','not-connected','needs-login','unknown']);
/** Diagnostics may quote the endpoint they failed on — as a URL or as `host:port` (dial errors do). Mask both
 * shapes before the value can reach a Remote result, and cap the length. */
function sanitizeDiagnostic(text:string):string{
 return text
  .replace(/[a-zA-Z][a-zA-Z0-9+.-]*:\/\/\S+/gu,'<endpoint>')
  // A bare `host:port` is masked too, but only where the host is unmistakably a host (a dotted name,
  // `localhost`, or a bracketed IPv6): a clock reading like `09:15` must stay readable.
  .replace(/(?<![0-9A-Za-z])(?:[A-Za-z0-9][A-Za-z0-9-]*(?:\.[A-Za-z0-9-]+)+|(?!T\d{2}:\d{2}\b)[A-Za-z][A-Za-z0-9-]*|\[[0-9a-fA-F:]+\]):\d{2,5}/gu,'<endpoint>')
  .slice(0,300);
}
export function normalizeRuntime(body:unknown):McpRuntimeStatus|null{
 if(!body||typeof body!=='object')return null;
 const value=body as Record<string,unknown>;
 // Idempotent by contract: the Host reader already normalizes one client report, and a caller that passes that
 // value back in must not lose the state it already carries (a second pass used to collapse it to `unknown`).
 const normalized=typeof value.state==='string'&&RUNTIME_STATES.has(value.state);
 const raw=normalized?String(value.state):typeof value.status==='string'?value.status:'unknown';
 const state:McpRuntimeState=normalized?raw as McpRuntimeState:raw==='connected'?'connected':raw==='error'?'failed':raw==='needs_login'?'needs-login':raw==='idle'?'not-connected':'unknown';
 const era=value.protocolEra==='modern'||value.protocolEra==='legacy'?value.protocolEra:undefined;
 const toolCount=typeof value.toolCount==='number'&&Number.isFinite(value.toolCount)?value.toolCount:undefined;
 // A client's error text is a diagnostic, not a place for endpoints: URLs are masked before the value can
 // reach a Remote result or a rendered disclosure (ADR-030 D2, AGENTS §1.1).
 const error=typeof value.error==='string'&&value.error.length>0?sanitizeDiagnostic(value.error):undefined;
 const result:McpRuntimeStatus={state};
 if(toolCount!==undefined)result.toolCount=toolCount;
 if(era!==undefined)result.protocolEra=era;
 if(error!==undefined)result.error=error;
 return result;
}
/** User-triggered live probe of one row (ADR-030 D3): reads the client plugin's `probe` endpoint, which is a
 * real round trip; the page shows a busy state and a receipt, and never presents it as a background poll. */
export async function probeMcpServer(ctx:McpServerContext,rowId:string):Promise<McpProbeResult>{
 const managedName=managedNameOf(rowId);
 if(managedName!==null){
  if(!ctx.managed)throw managedMissing();
  const runtime=await managedProbe(ctx.managed,managedName);
  return {rowId,name:managedName,runtime:runtime===null?null:{...runtime,...(typeof runtime.error==='string'?{error:sanitizeDiagnostic(runtime.error)}:{})}};
 }
 if(!ctx.patchPath)throw unavailable();
 const rows=insertRows(parsePatch(await readPatchText(ctx.patchPath)));
 const entry=loadedEntries(ctx.loader).find(item=>item.options.id===rowId);
 const row=rows.find(item=>item.rowId===rowId);
 // The state a check must be judged on: a loaded row reports its own fiber state, a stored row the Loader
 // never mounted is pending by definition.
 const state:McpServerState=entry!==undefined?stateOf(entry):'pending';
 const name=entry?serverNameOf(entry):row?.serverName??null;
 const clientPackage=entry?.options.name??row?.packageName??'';
 if(name===null)throw new RemoteError('mcp/row-missing','MCP_ROW_MISSING: this row is not a loaded or stored MCP server',{});
 // The same predicate the catalog renders the action from (ADR-031 D3): refusing here with a different
 // judgement is what let a running stdio row be probed over the Remote while the page offered no button.
 const transport=transportOf(entry?readConfig(entry)??{}:row?.config??{})??'streamable-http';
 const availability=probeAvailability(ctx,transport,clientPackage,state);
 if(!availability.available){
  const detail=availability.reason==='not-running'
   ?'this row is not running, so no client can answer a check'
   :'this row has no control plane this process can ask (no adapter, no loopback, or a non-HTTP transport)';
  throw new RemoteError('mcp/probe-unavailable','MCP_PROBE_UNAVAILABLE: '+detail,{});
 }
 const runtime=await availability.reader(clientPackage,name,'probe');
 return {rowId,name,runtime:runtime===null?null:normalizeRuntime(runtime)};
}
/** Rewrite official static-HTTP rows onto the v2-capable client (ADR-030 D5). Id/s/url/headers stay byte-
 * identical: only the row's package name changes, the backup is named for the action, and the effect is
 * next-process (the running process already loaded the old client). Idempotent: a second call is `changed:false`. */
export async function migrateStaticHttpRows(ctx:McpServerContext):Promise<McpMigrationResult>{
 if(!ctx.patchPath)throw unavailable();
 const path=ctx.patchPath;
 return withPatchLock(path,async()=>{
  const profilePackage=await readProfilePackage(ctx.profileDir);
  const text=await readPatchText(path);
  const doc=parsePatch(text);
  // The availability predicate is the same one the catalog uses, so a row the page marks upgradable never gets a
  // refusal from the action (AGENTS §8.3: one semantic for every entry point).
  const rowsHere=insertRows(doc);
  const dualAvailable=v2ClientAvailable(profilePackage,rowsHere.map(row=>row.packageName),loadedEntries(ctx.loader));
  if(!dualAvailable){
   throw new RemoteError('mcp/migration-unavailable','MCP_MIGRATION_UNAVAILABLE: the profile carries no v2-capable MCP client',{});
  }
  const changed:string[]=[];
  const contents=doc.contents;
  if(isSeq(contents)){
   for(const outer of contents.items){
    if(!isMap(outer)||!outer.has('insert'))continue;
    const insert=outer.get('insert');
    if(!isSeq(insert))continue;
    for(const inner of insert.items){
     if(!isMap(inner))continue;
     if(toPlain(inner.get('name'))!==OFFICIAL_CLIENT)continue;
     const config=toPlain(inner.get('config'));
     if(!config||typeof config!=='object'||Array.isArray(config))continue;
     const plain=config as Record<string,unknown>;
     if(transportOf(plain)!=='streamable-http')continue;
     setMapValue(inner,'name',SUITE_V2_CLIENT);
     const id=toPlain(inner.get('id'));
     if(typeof id==='string')changed.push(id);
    }
   }
  }
  if(changed.length===0)return {changed:false,rows:[],backupPath:null,restartRequired:false};
  const backup=path+'.bak-mcp-v2-'+new Date().toISOString().replace(/[:.]/gu,'-');
  // The backup is a precondition, not a courtesy: if it cannot be written, the patch is NOT touched.
  try{
   await copyFile(path,backup);
  }catch(error){
   throw writeFailure('the pre-migration backup could not be written, so the patch was left unchanged',error);
  }
  await writePatchAtomic(path,String(doc));
  return {changed:true,rows:changed,backupPath:backup,restartRequired:true};
 });
}
/** ADR-033 D4: rewrite historical external-package rows onto the subpath the Suite carries. Only `name` changes:
 * id and config stay byte-identical, the backup is written before the patch is touched, a second call reports
 * `changed:false`, and the effect is next-process (the running process already loaded the old module). */
export async function migrateLegacyClientRows(ctx:McpServerContext):Promise<McpMigrationResult>{
 if(!ctx.patchPath)throw unavailable();
 const path=ctx.patchPath;
 return withPatchLock(path,async()=>{
  const doc=parsePatch(await readPatchText(path));
  const changed:string[]=[];
  const contents=doc.contents;
  if(isSeq(contents)){
   for(const outer of contents.items){
    if(!isMap(outer)||!outer.has('insert'))continue;
    const insert=outer.get('insert');
    if(!isSeq(insert))continue;
    for(const inner of insert.items){
     if(!isMap(inner))continue;
     const rawName=toPlain(inner.get('name'));
     const suiteName=typeof rawName==='string'?LEGACY_TO_SUITE[rawName]:undefined;
     if(suiteName===undefined)continue;
     setMapValue(inner,'name',suiteName);
     const id=toPlain(inner.get('id'));
     if(typeof id==='string')changed.push(id);
    }
   }
  }
  if(changed.length===0)return {changed:false,rows:[],backupPath:null,restartRequired:false};
  const backup=path+'.bak-mcp-client-'+new Date().toISOString().replace(/[:.]/gu,'-');
  // The backup is a precondition, not a courtesy: if it cannot be written, the patch is NOT touched.
  try{
   await copyFile(path,backup);
  }catch(error){
   throw writeFailure('the pre-migration backup could not be written, so the patch was left unchanged',error);
  }
  await writePatchAtomic(path,String(doc));
  return {changed:true,rows:changed,backupPath:backup,restartRequired:true};
 });
}
async function withPatchLock<T>(path:string,work:()=>Promise<T>):Promise<T> {
 const lock=path+LOCK_SUFFIX;
 let handle:Awaited<ReturnType<typeof open>>|undefined;
 for(let attempt=0;attempt<20&&!handle;attempt+=1){
  try{
   handle=await open(lock,'wx');
  }catch(error){
   // A lock that cannot even be created (permissions, read-only profile dir) is a write refusal, not a crash:
   // the caller must never see a raw fs error instead of a code it can explain.
   if(codeOf(error)!=='EEXIST')throw new RemoteError('mcp/write-locked','MCP_PROFILE_LOCK_BUSY: the profile patch lock could not be created',{});
   await sleep(50);
  }
 }
 if(!handle)throw new RemoteError('mcp/write-locked','MCP_PROFILE_LOCK_BUSY: another writer is editing the profile patch',{});
 try{
  return await work();
 }finally{
  await handle.close().catch(()=>undefined);
  await unlink(lock).catch(()=>undefined);
 }
}

/** The same lock the patch writer uses, exported so a caller that writes another profile file can serialize
 * with it (ADR-032 D5: one lock, two files, one transaction). */
export const withProfileLock=withPatchLock;

/** A patch write refusal that keeps the underlying code/message: the detail must name EPERM, never the suite's
 * own wrapper code (ADR-032 D5: the original failure is never swallowed). */
function writeFailure(detail:string,error:unknown):RemoteError {
 const cause=failureOf(error);
 return new RemoteError('mcp/write-failed','MCP_PROFILE_WRITE_FAILED: '+detail,{code:cause.code,message:cause.message});
}
/** Stage a patch replacement without renaming it: the caller may need to write a second file first and rename
 * both in a fixed order (ADR-032 D5). `commit` renames; `rollback` only drops the temporary file. */
async function stagePatchText(path:string,text:string):Promise<{commit:()=>Promise<void>;rollback:()=>Promise<void>}> {
 await mkdir(dirname(path),{recursive:true});
 const backup=path+BACKUP_SUFFIX;
 const temporary=path+'.omnisurge-'+String(process.pid)+'.tmp';
 let hadFile=false;
 try{
  await copyFile(path,backup);
  hadFile=true;
 }catch(error){
  if(codeOf(error)!=='ENOENT')throw error;
 }
 try{
  await writeFile(temporary,text,'utf8');
  parsePatch(text);
 }catch(error){
  await unlink(temporary).catch(()=>undefined);
  if(error instanceof RemoteError)throw error;
  throw writeFailure('the profile patch was not changed',error);
 }
 return {
  commit:async():Promise<void>=>{
   try{
    await rename(temporary,path);
   }catch(error){
    await unlink(temporary).catch(()=>undefined);
    if(hadFile){
     try{
      await copyFile(backup,path);
     }catch{/* the rollback is best effort; the error below names the original cause */}
    }
    if(error instanceof RemoteError)throw error;
    throw writeFailure('the profile patch was not changed',error);
   }
  },
  rollback:async():Promise<void>=>{await unlink(temporary).catch(()=>undefined);},
 };
}

/** The one-shot form: stage, then commit. */
async function writePatchAtomic(path:string,text:string):Promise<void> {
 const staged=await stagePatchText(path,text);
 await staged.commit();
}

/** Only the fields the draft actually names; an absent field is "leave the stored value alone". */
const AUTHORIZATION_TIMEOUT_MIN_MS=1000;
const AUTHORIZATION_TIMEOUT_MAX_MS=600_000;
/** The stdio launch facts an edit form may show (ADR-055, 0.2.0-13). A launch command is not a credential:
 * the secret in a stdio row is its env values, and those stay counts. Every row in this catalog is one this
 * profile may edit (a row outside the profile's own scope is not listed at all — the official editor's scope
 * rule, see `loadedEntries`), so "may show" and "is listed" are the same fact here; a second flag would be a
 * second copy of it. An HTTP row gets none of the three keys rather than three empty ones, so "absent" and
 * "empty" stay distinguishable on the page. */
function stdioFactsOf(transport:McpServerTransport,config:Record<string,unknown>):{command?:string;args?:string[];cwd?:string} {
 if(transport!=='stdio')return {};
 const command=typeof config.command==='string'?config.command:'';
 const args=Array.isArray(config.args)?config.args.filter((arg):arg is string=>typeof arg==='string'):[];
 const cwd=typeof config.cwd==='string'?config.cwd:'';
 return {command,args,...(cwd!==''?{cwd}:{})};
}
/** The two non-secret facts an OAuth row exposes so its edit form can show and change them (0.2.0-5). A client id
 * is not a credential — the secret stays in the credential service — so the catalog may carry it. Every other row
 * omits both keys instead of inventing a default, and `credentialId` is never part of this shape. */
function oauthFactsOf(clientPackage:string,config:Record<string,unknown>):{staticClientId?:string;authorizationTimeoutMs?:number} {
 if(clientPackage!==SUITE_OAUTH_CLIENT&&clientPackage!==OAUTH_CLIENT)return {};
 const staticClientId=typeof config.staticClientId==='string'?config.staticClientId:'';
 const timeout=config.authorizationTimeoutMs;
 return {staticClientId,...(typeof timeout==='number'&&Number.isFinite(timeout)?{authorizationTimeoutMs:timeout}:{})};
}
/** The one list-to-object fold for headers/env (ADR-035 controlled exception: an entry without a usable
 * key is an empty form row and is skipped; a non-string value becomes an empty string). An all-empty list
 * folds to an empty object, which is a named, empty field — never "not named" (ADR-055). */
function pairsObject(pairs:Array<{key:string;value:string}>):Record<string,string> {
 const out:Record<string,string>={};
 for(const entry of pairs)if(entry&&typeof entry.key==='string'&&entry.key.length>0)out[entry.key]=typeof entry.value==='string'?entry.value:'';
 return out;
}
/** A draft field is "named" when it carries a value: `undefined`, `null` and a blank string all mean "not named"
 * (ADR-035 D3). Every field uses this one predicate so "named but invalid" cannot differ per field. The single
 * deliberate exception is `transport`, whose blank string is a value no row may have — see `updateConfig`. */
const draftNames=(value:unknown):boolean=>value!==undefined&&value!==null&&!(typeof value==='string'&&value.trim()==='');
/** `kind` is the row's fact, resolved by the caller: an add takes it from the draft (the page names it), an edit
 * derives it from the stored row's package (ADR-035 D3). Reading `draft.kind` here would make the edit path a
 * second, silently different semantic. */
function draftFacts(draft:McpServerDraft,kind:McpServerKind|undefined):{name:string;transport:McpServerTransport|null;config:Record<string,unknown>} {
 const name=typeof draft?.name==='string'?draft.name.trim():'';
 if(!SERVER_NAME_PATTERN.test(name))throw invalid('serverName must match [A-Za-z0-9_-]{1,32}',{field:'name',reason:'pattern'});
 const raw=draft?.transport;
 const transport=raw==='stdio'||raw==='streamable-http'?raw:null;
 const config:Record<string,unknown>={};
 if(typeof draft.url==='string'&&draft.url.trim().length>0)config.url=draft.url.trim();
 if(typeof draft.command==='string'&&draft.command.trim().length>0)config.command=draft.command.trim();
 if(Array.isArray(draft.args))config.args=draft.args.filter(arg=>typeof arg==='string');
 if(typeof draft.cwd==='string'&&draft.cwd.trim().length>0)config.cwd=draft.cwd.trim();
 if(typeof draft.toolCallTimeoutMs==='number'&&Number.isFinite(draft.toolCallTimeoutMs)&&draft.toolCallTimeoutMs>0)config.toolCallTimeoutMs=Math.trunc(draft.toolCallTimeoutMs);
 if(typeof draft.failOnStartupError==='boolean')config.failOnStartupError=draft.failOnStartupError;
 // CONTROLLED EXCEPTION (ADR-035 D3 boundary, maintained with the spec layer): element shape is retained rather
 // than refused. An entry without a usable key is an empty form row and is skipped; a non-string value is stored
 // as an empty string. Rejecting either would couple this validator to the page form, so it is a named exception
 // with its own test anchor instead of a silent filter; the named field itself is validated before this runs.
 // ADR-055 (0.2.0-13): a NAMED list is written even when it is empty. It used to be dropped as "nothing
 // to write", which left the stored object untouched — so a user who cleared every row had no way to empty
 // the field at all (the spec already says an empty array is a named, empty field). One semantic for both
 // arrays: named means the field's new value is exactly what the draft says, empty included.
 if(Array.isArray(draft.headers))config.headers=pairsObject(draft.headers);
 if(Array.isArray(draft.env))config.env=pairsObject(draft.env);
 // The OAuth client is the only one with these two facts (0.2.0-5): a pre-registered client id for an AS that
 // refuses dynamic registration, and how long the browser/callback wait may last.
 if(kind==='oauth'){
  if(typeof draft.staticClientId==='string'&&draft.staticClientId.trim().length>0)config.staticClientId=draft.staticClientId.trim();
  if(draftNames(draft.authorizationTimeoutMs))config.authorizationTimeoutMs=draft.authorizationTimeoutMs;
 }
 return {name,transport,config};
}

/** Which fields a row may name depends on the client that loads it (0.2.0-5): the OAuth client has no env/headers,
 * and the dual/official clients have no client id or authorization timeout. A named field must be valid for the
 * row or be refused — silently dropping it would be a second hidden semantic (ADR-035 D3, AGENTS §8.3).
 *
 * This reads the draft itself, never the filtered config: a field that is present but empty or wrongly typed is
 * still named. `undefined`, `null` and a blank string are the only ways to say "not named". Messages name the
 * field and the expectation and never echo the value. One semantic for add and edit: the page hides those fields,
 * but Remote is a public entry point. */
function assertDraftShape(draft:McpServerDraft,kind:McpServerKind|undefined):void {
 const named=draftNames;
 const oauth=kind==='oauth';
 const clientId=draft.staticClientId;
 const timeout=draft.authorizationTimeoutMs;
 if(oauth){
  if(named(draft.headers))throw invalid('an OAuth row has no custom headers: remove the named field',{field:'headers',reason:'not-allowed'});
  if(named(draft.env))throw invalid('an OAuth row has no environment variables: remove the named field',{field:'env',reason:'not-allowed'});
  if(named(clientId)&&typeof clientId!=='string')throw invalid('staticClientId must be a string when it is named',{field:'staticClientId',reason:'wrong-type'});
  if(named(timeout)){
   if(typeof timeout!=='number'||!Number.isInteger(timeout)||timeout<AUTHORIZATION_TIMEOUT_MIN_MS||timeout>AUTHORIZATION_TIMEOUT_MAX_MS)throw invalid('authorizationTimeoutMs must be an integer from 1000 to 600000',{field:'authorizationTimeoutMs',reason:'out-of-range',min:AUTHORIZATION_TIMEOUT_MIN_MS,max:AUTHORIZATION_TIMEOUT_MAX_MS});
  }
  return;
 }
 // A named list must be a list on every row: an object or a scalar used to be filtered away as if it were
 // absent, which is the same hidden second semantic this function exists to remove.
 if(named(draft.headers)&&!Array.isArray(draft.headers))throw invalid('headers must be a list of {key,value} entries',{field:'headers',reason:'wrong-type'});
 if(named(draft.env)&&!Array.isArray(draft.env))throw invalid('env must be a list of {key,value} entries',{field:'env',reason:'wrong-type'});
 if(named(clientId)){
  if(typeof clientId!=='string')throw invalid('staticClientId must be a string when it is named',{field:'staticClientId',reason:'wrong-type'});
  if(clientId.trim().length>0)throw invalid('staticClientId belongs to an OAuth row only',{field:'staticClientId',reason:'not-allowed'});
 }
 if(named(timeout)){
  if(typeof timeout!=='number')throw invalid('authorizationTimeoutMs must be a number when it is named',{field:'authorizationTimeoutMs',reason:'wrong-type'});
  throw invalid('authorizationTimeoutMs belongs to an OAuth row only',{field:'authorizationTimeoutMs',reason:'not-allowed'});
 }
}
/** A new row must name its transport and its endpoint: there is nothing stored to fall back on. */
function createConfig(draft:McpServerDraft):{name:string;transport:McpServerTransport;config:Record<string,unknown>} {
 // `kind` is a named field here too: a value that is neither documented kind is refused, never silently treated
 // as static. The edit path refuses a conflicting kind the same way — one semantic for both entries (AGENTS §8.3).
 if(draftNames(draft.kind)&&draft.kind!=='static'&&draft.kind!=='oauth')throw invalid('kind must be static or oauth',{field:'kind',reason:'invalid-value'});
 const facts=draftFacts(draft,draft.kind);
 const transport=facts.transport;
 if(transport===null)throw invalid('transport must be stdio or streamable-http',{field:'transport',reason:'required'});
 // One semantic for every entry point (AGENTS §8.3): the page forces OAuth rows onto HTTP, and a direct Remote
 // call must not silently produce an official static stdio row instead — that is a different row than asked for.
 if(draft.kind==='oauth'&&transport==='stdio')throw invalid('an OAuth row only supports the HTTP transport',{field:'transport',reason:'transport-mismatch'});
 assertDraftShape(draft,draft.kind);
 if(transport==='streamable-http'&&typeof facts.config.url!=='string')throw invalid('the HTTP transport needs a URL',{field:'url',reason:'required'});
 if(transport==='stdio'&&typeof facts.config.command!=='string')throw invalid('the stdio transport needs a command',{field:'command',reason:'required'});
 return {name:facts.name,transport,config:{transport,serverName:facts.name,...facts.config}};
}

/** An edit replaces only what it names. The page never receives the stored endpoint or credential values, so
 * requiring them here would force every edit to retype facts the user cannot see. */
/** An edit draft carries no `kind` (the page only sends it on add), so the row's package decides which fields the
 * row may name — the same source the adapter table uses for transport and client identity. */
function updateConfig(draft:McpServerDraft,row:PatchRow,kind:McpServerKind):{name:string;transport:McpServerTransport;config:Record<string,unknown>} {
 // `kind` is a new-row fact: an edit that names a different one is a conflict, not a no-op to swallow. It is
 // checked first because it decides which row this draft is describing at all.
 if(draftNames(draft.kind)&&draft.kind!==kind)throw invalid('kind is a new-row fact: an edit must not name a different one',{field:'kind',reason:'kind-conflict'});
 const facts=draftFacts(draft,kind);
 assertDraftShape(draft,kind);
 // A named transport must be one of the two the row may have. `''` is refused here rather than treated as "not
 // named": no row may carry it, and the add path already refuses it — the asymmetry would be a second semantic.
 // Everything else follows `draftNames`, where a blank string means "not named".
 if(draft.transport!==undefined&&draft.transport!==null&&draft.transport!=='stdio'&&draft.transport!=='streamable-http')throw invalid('transport must be stdio or streamable-http',{field:'transport',reason:'invalid-value'});
 const stored=transportOf(row.config)??'streamable-http';
 const transport=facts.transport??stored;
 if(transport!==stored){
  if(transport==='streamable-http'&&typeof facts.config.url!=='string')throw invalid('switching to the HTTP transport needs a URL',{field:'url',reason:'required'});
  if(transport==='stdio'&&typeof facts.config.command!=='string')throw invalid('switching to the stdio transport needs a command',{field:'command',reason:'required'});
 }
 return {name:facts.name,transport,config:{transport,serverName:facts.name,...facts.config}};
}

/** ADR-033 D1: which client a NEW row loads, chosen from what the row is — never from whatever happens to be
 * loaded. A profile may still hold rows naming the old external packages (uninstalled later) and a fresh profile
 * holds no MCP row at all; neither may decide. The carried dual client only speaks `streamable-http`, so a stdio
 * row stays on the official client; an OAuth draft takes the OAuth subpath; every other HTTP row takes the v2
 * subpath the Suite carries. This is the one rule: the migration writes the same two subpaths. */
function clientPackageForDraft(draft:McpServerDraft):string{
 if(draft.transport==='stdio')return OFFICIAL_CLIENT;
 if(draft.kind==='oauth')return SUITE_OAUTH_CLIENT;
 return SUITE_V2_CLIENT;
}

function nextRowId(base:string,used:Set<string>):string {
 if(!used.has(base))return base;
 for(let index=2;index<1000;index+=1){
  const candidate=base+'-'+String(index);
  if(!used.has(candidate))return candidate;
 }
 throw invalid('cannot derive a unique row id',{field:'rowId',reason:'not-unique'});
}

async function waitFor(loader:LoaderLike|undefined,predicate:(entries:LoaderEntryLike[])=>boolean,timeoutMs=RELOAD_WAIT_MS):Promise<boolean> {
 const deadline=Date.now()+timeoutMs;
 for(;;){
  if(predicate(loadedEntries(loader)))return true;
  if(Date.now()>=deadline)return false;
  await sleep(200);
 }
}

const managedNameOf=(rowId:string):string|null=>rowId.startsWith(MANAGED_ROW_PREFIX)?rowId.slice(MANAGED_ROW_PREFIX.length):null;

function managedMissing():RemoteError{
 return new RemoteError('mcp/server-not-editable','MCP_SERVER_NOT_EDITABLE: this server is managed by the official MCP manager',{});
}

/** ADR-094: the official manager owns generic servers. The draft keeps its existing shape; only the storage
 *  (config.servers via the Settings revision fence) differs from the legacy profile-patch path. */
async function addManagedServer(ctx:McpServerContext,draft:McpServerDraft):Promise<McpServerMutation>{
 const authority=ctx.managed;
 if(!authority)throw unavailable();
 const {name,transport}=createConfig(draft);
 if(managedCatalog(authority).some(row=>row.name===name)||loadedEntries(ctx.loader).some(entry=>serverNameOf(entry)===name))throw new RemoteError('mcp/server-exists','MCP_SERVER_EXISTS: a server with this name already exists',{});
 await managedWrite(authority,name,managedEntryFromDraft(null,draft,transport));
 return {mode:'added',rowId:MANAGED_ROW_PREFIX+name,name,applied:'live'};
}

async function updateManagedServer(ctx:McpServerContext,name:string,rowId:string,draft:McpServerDraft):Promise<McpServerMutation>{
 const authority=ctx.managed;
 if(!authority)throw managedMissing();
 const row=managedCatalog(authority).find(item=>item.name===name);
 if(!row)throw new RemoteError('mcp/server-missing','MCP_SERVER_MISSING: no such managed server exists',{});
 if(typeof draft?.name==='string'&&draft.name.trim().length>0&&draft.name.trim()!==name)throw invalid('renaming a managed server is not supported; delete it and add the new name',{field:'name',reason:'not-editable'});
 // ADR-094: a managed row is a static server. An edit that names another kind is the same conflict the
 // patch path refuses; it must not be silently accepted as a static update.
 if(draftNames(draft.kind)&&draft.kind!=='static')throw invalid('kind is a new-row fact: a managed server is static',{field:'kind',reason:'kind-conflict'});
 assertDraftShape(draft,'static');
 if(draft.transport!==undefined&&draft.transport!==null&&draft.transport!=='stdio'&&draft.transport!=='streamable-http')throw invalid('transport must be stdio or streamable-http',{field:'transport',reason:'invalid-value'});
 const transport=draft.transport==='stdio'||draft.transport==='streamable-http'?draft.transport:transportOf(row.entry)??'streamable-http';
 const command=typeof draft.command==='string'&&draft.command.trim().length>0?draft.command:row.entry.command;
 const url=typeof draft.url==='string'&&draft.url.trim().length>0?draft.url:row.entry.url;
 // The official schema rejects an empty endpoint; name the missing field here instead of letting the write
 // fail as a generic managed-write-failed (the patch path already reports draft-invalid for the same fact).
 if(transport==='stdio'&&(typeof command!=='string'||command.trim().length===0))throw invalid('the stdio transport needs a command',{field:'command',reason:'required'});
 if(transport==='streamable-http'&&(typeof url!=='string'||url.trim().length===0))throw invalid('the HTTP transport needs a URL',{field:'url',reason:'required'});
 await managedWrite(authority,name,managedEntryFromDraft(row.entry,draft,transport));
 return {mode:'updated',rowId,name,applied:'live'};
}

export async function addMcpServer(ctx:McpServerContext,draft:McpServerDraft):Promise<McpServerMutation> {
 if(ctx.managed&&draft?.kind!=='oauth')return addManagedServer(ctx,draft);
 const path=ctx.patchPath;
 if(!path)throw unavailable();
 const {name,config}=createConfig(draft);
 // ADR-094: an OAuth row still lives in the profile patch, but its name must not shadow an official
 // managed entry — the two would register the same serverName and collide at the tool table.
 if(ctx.managed&&managedCatalog(ctx.managed).some(row=>row.name===name))throw new RemoteError('mcp/server-exists','MCP_SERVER_EXISTS: the official MCP manager already has this name',{});
 return withPatchLock(path,async()=>{
  const text=await readPatchText(path);
  const doc=parsePatch(text);
  const entries=loadedEntries(ctx.loader);
  if(entries.some(entry=>serverNameOf(entry)===name))throw new RemoteError('mcp/server-exists','MCP_SERVER_EXISTS: a server with this name is already loaded',{});
  const rows=insertRows(doc);
  if(rows.some(row=>row.serverName===name))throw new RemoteError('mcp/server-exists','MCP_SERVER_EXISTS: this name is already in the profile patch',{});
  const used=new Set<string>([...entries.map(entry=>entry.options.id),...rows.map(row=>row.rowId)]);
  const rowId=nextRowId('mcp-'+name,used);
  const packageName=clientPackageForDraft(draft);
  if(!isSeq(doc.contents))throw unreadable();
  (doc.contents as {add:(value:unknown)=>void}).add({insert:[{id:rowId,name:packageName,config}]});
  await writePatchAtomic(path,String(doc));
  // A row that is merely present is still settling: the loader has not finished mounting it, so the
  // mutation must report `pending` until its state leaves `pending` (running/failed/disabled are all
  // settled facts — a failed start is still an applied reload, and the list shows that state).
  const applied=await waitFor(ctx.loader,list=>list.some(entry=>entry.options.id===rowId&&serverNameOf(entry)===name&&stateOf(entry)!=='pending'),ctx.reloadWaitMs);
  return {mode:'added',rowId,name,applied:applied?'live':'pending'};
 });
}

export async function updateMcpServer(ctx:McpServerContext,rowId:string,draft:McpServerDraft):Promise<McpServerMutation> {
 const managedName=managedNameOf(rowId);
 if(managedName!==null)return updateManagedServer(ctx,managedName,rowId,draft);
 const path=ctx.patchPath;
 if(!path)throw unavailable();
 return withPatchLock(path,async()=>{
  const text=await readPatchText(path);
  const doc=parsePatch(text);
  const row=insertRows(doc).find(item=>item.rowId===rowId);
  if(!row)throw new RemoteError('mcp/server-not-editable','MCP_SERVER_NOT_EDITABLE: this row is not owned by the profile patch',{});
  const kind=kindOf(row.packageName??'');
  const {name,config}=updateConfig(draft,row,kind);
  // Same semantic as the add path (AGENTS §8.3): a row loaded by an adapter client only speaks streamable-http,
  // so editing it into stdio would write a row that cannot start. The package is the row's fact, not the draft's.
  if(config.transport==='stdio'&&CLIENT_ADAPTERS[row.packageName??'']!==undefined)throw invalid('this row is loaded by an HTTP-only client: delete it and add a stdio row instead',{field:'row',reason:'not-editable'});
  const contents=doc.contents;
  if(!isSeq(contents))throw unreadable();
  const outer=contents.items[row.outerIndex];
  if(!isMap(outer))throw unreadable();
  const insert=outer.get('insert');
  if(!isSeq(insert))throw unreadable();
  const inner=insert.items[row.innerIndex];
  if(!isMap(inner))throw unreadable();
  // Keep fields this page does not own; only the keys the draft names are replaced. A transport switch also
  // drops the endpoint keys of the transport being left behind, so the row never carries two endpoints.
  const merged:Record<string,unknown>={...row.config,...config};
  if((transportOf(row.config)??'streamable-http')!==(config.transport as string)){
   if(config.transport==='stdio')delete merged.url;
   else{delete merged.command;delete merged.args;delete merged.cwd;}
  }
  setMapValue(inner,'config',doc.createNode(merged));
  await writePatchAtomic(path,String(doc));
  // A row that is merely present is still settling: the loader has not finished mounting it, so the
  // mutation must report `pending` until its state leaves `pending` (running/failed/disabled are all
  // settled facts — a failed start is still an applied reload, and the list shows that state).
  const applied=await waitFor(ctx.loader,list=>list.some(entry=>entry.options.id===rowId&&serverNameOf(entry)===name&&stateOf(entry)!=='pending'),ctx.reloadWaitMs);
  return {mode:'updated',rowId,name,applied:applied?'live':'pending'};
 });
}

export async function removeMcpServer(ctx:McpServerContext,rowId:string):Promise<McpServerMutation> {
 const managedName=managedNameOf(rowId);
 if(managedName!==null){
  if(!ctx.managed)throw managedMissing();
  // ADR-032 D5：旁路文件里的用途键随条目一起删。官方条目与旁路文件不是同一份存储，先提交旁路、
  // 再删条目；条目删除失败就把旁路回滚（服务器仍在，用途也仍在），不留“服务器没了、用途还在”的半态。
  const removal=ctx.purposes?await ctx.purposes.removal(rowId):null;
  if(removal)await removal.commit();
  try{
   await managedWrite(ctx.managed,managedName,null);
  }catch(error){
   if(removal){
    const rollback=await removal.rollback();
    if(!rollback.ok)throw new RemoteError('mcp/managed-write-failed','MCP_MANAGED_WRITE_FAILED: the official MCP manager refused this change and the purpose file could not be restored',{reason:'refused',detail:'purpose rollback failed'});
   }
   throw error;
  }
  if(removal){removal.settle();await removal.cleanup();}
  return {mode:'removed',rowId,name:managedName,applied:'live'};
 }
 const path=ctx.patchPath;
 if(!path)throw unavailable();
 return withPatchLock(path,async()=>{
  const text=await readPatchText(path);
  const doc=parsePatch(text);
  const contents=doc.contents;
  if(!isSeq(contents))throw unreadable();
  const entry=loadedEntries(ctx.loader).find(item=>item.options.id===rowId);
  const row=insertRows(doc).find(item=>item.rowId===rowId);
  if(!row&&!entry)throw new RemoteError('mcp/server-missing','MCP_SERVER_MISSING: no such server row is loaded or patch-owned',{});
  const name=row?.serverName??(entry?serverNameOf(entry):null)??rowId;
  if(row){
   const outer=contents.items[row.outerIndex];
   if(!isMap(outer))throw unreadable();
   const insert=outer.get('insert');
   if(!isSeq(insert))throw unreadable();
   if(insert.items.length<=1)contents.items.splice(row.outerIndex,1);
   else insert.items.splice(row.innerIndex,1);
  }else{
   // Bundle-provided rows are disabled through the documented override rather than by editing the bundle.
   const override=contents.items.find(item=>isMap(item)&&toPlain(item.get('id'))===rowId);
   const overridden=override!==undefined&&isMap(override);
   const overrideMap=override as unknown as {get:(key:string)=>unknown}|undefined;
   // Deleting something already deleted is not a second write: an override that already disables the row and
   // a Loader entry that already reports disabled mean the user's intent is satisfied. Rewriting would churn
   // the patch bytes and report a change that did not happen.
   if(overridden&&toPlain(overrideMap?.get('disabled'))===true&&(entry===undefined||stateOf(entry)==='disabled'))return {mode:'removed',rowId,name,applied:'live'};
   if(overridden){
    // An override that says disabled:false is the user (or the official page) explicitly enabling a bundle
    // row: removing it means flipping that override, not appending a second one. Leaving it untouched was the
    // one branch that reported success while changing nothing.
    setMapValue(override,'disabled',true);
   }else{
    (contents as {add:(value:unknown)=>void}).add({id:rowId,disabled:true});
   }
  }
  // ADR-032 D5: deleting a row is one transaction over two files — the cleaned purposes and the patch. Both
  // temporary files exist before either rename, the purpose file is renamed first, and a failed patch rename
  // rolls the purpose file back. A rollback that also fails is reported as a partial deletion with both files'
  // current state; it is never retried over the user's bytes and never reported as success.
  const patch=await stagePatchText(path,String(doc));
  const removal:PurposeRemoval|null=ctx.purposes?await ctx.purposes.removal(rowId):null;
  if(removal){
   try{
    await removal.commit();
   }catch(error){
    await patch.rollback();
    // The purpose rename is the first rename, so nothing was renamed: both files keep their old bytes. The
    // caller sees one code for "the deletion did not happen", with the failing step and its reason inside.
    // ADR-037 D5: a deletion that lost the CAS is the same semantics as a stale write, so it carries the same
    // outer code (mcp/purpose-conflict). One code per semantics — the page must not read details to know it is a
    // conflict, and the generic failure sentence must not stand in for it.
    if(failureOf(error).code==='mcp/purpose-conflict')throw error;
    throw new RemoteError('mcp/purpose-write-failed','MCP_PURPOSE_WRITE_FAILED: the deletion was not applied; both files keep their old bytes',{step:'purpose-rename',...failureOf(error)});
   }
  }
  try{
   await patch.commit();
  }catch(error){
   await patch.rollback();
   if(removal){
    const rolled=await removal.rollback();
    if(!rolled.ok){
     const detail:McpPurposePartialDetail={patch:await fileStateOf(path,text,String(doc)),purpose:await fileStateOf(removal.path,removal.oldText,removal.newText)};
     throw new RemoteError('mcp/purpose-partial','MCP_PURPOSE_PARTIAL: the row was not removed and the bypass file may be half-written',detail);
    }
    // Both files are back to their old bytes: same outcome state as a first-rename failure, so the same code.
    throw new RemoteError('mcp/purpose-write-failed','MCP_PURPOSE_WRITE_FAILED: the deletion was rolled back; both files keep their old bytes',{step:'patch-rename',...failureOf(error)});
   }
   throw error;
  }
  removal?.settle();
 // F3: the purpose backup was this transaction's rollback source, not an artifact the user asked for; the patch
 // backup stays, because the migration Remotes surface that path to the user.
 await removal?.cleanup();
  // Deleting a bundle row can leave a disabled entry in the Loader rather than removing the id; both "gone"
  // and "disabled" are the effect the user asked for, so waiting only for absence would report pending
  // forever on the profile shape the desktop actually uses.
  const applied=await waitFor(ctx.loader,list=>!list.some(item=>item.options.id===rowId&&stateOf(item)!=='disabled'),ctx.reloadWaitMs);
  return {mode:'removed',rowId,name,applied:applied?'live':'pending'};
 });
}