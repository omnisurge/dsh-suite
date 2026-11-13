/** 官方 MCP 管理器（0.2.2-rc.2+）作为服务器权威时的 Host 适配层（ADR-094）。
 *
 * 权威是官方的两样东西：`config.servers`（volatile，Settings 文档的一部分）与 `ctx.mcpManager`。
 * 本模块只做三件事：把官方条目/状态翻成本套件既有的目录行形状、把用户草稿翻成官方条目、
 * 通过官方 Settings 的修订栅栏写回。它不缓存、不复制条目，也不写 profile patch。
 *
 * 不用官方 TypeScript 类型：这些形状随 rc 线变化，Host 只按公开方法名与字段名读取，缺失即视为不可用。
 */
import {RemoteError} from '@deepseek-ai/dsh-typert-protocol';
import type {McpRuntimeStatus,McpServerDraft,McpServerState,McpServerTransport} from './types.js';

export const MCP_MANAGER_MODULE='@deepseek-ai/dsh-mcp-manager';
/** 目录里官方托管条目的稳定定位键；用户条目的定位键仍是 profile 行 id。 */
export const MANAGED_ROW_PREFIX='managed:';

export type ManagedPathOp={op:'set';path:readonly string[];value:unknown}|{op:'unset';path:readonly string[]};

export interface ManagedViewLike{name?:unknown;configured?:unknown;status?:unknown;}
export interface ManagedManagerLike{
 list():ManagedViewLike[];
 probe(name:string,options?:{signal?:AbortSignal}):Promise<unknown>;
 restart(name:string):Promise<void>;
}
export interface ManagedDescriptorLike{ns?:unknown;revision?:unknown;value?:unknown;}
export interface ManagedSettingsLike{
 describe(options?:{redactSecrets?:boolean}):ManagedDescriptorLike[];
 mutate(ns:string,ops:readonly ManagedPathOp[],expectedRevision?:number):Promise<void>;
}
export interface ManagedAuthority{
 /** 官方 mcp-manager 行的 entry id：Settings 命名空间就是它，不是固定常量。 */
 namespace:string;
 manager:ManagedManagerLike;
 settings:ManagedSettingsLike;
}

export interface ManagedCatalogRow{name:string;entry:Record<string,unknown>;view:ManagedViewLike|null;}

const asRecord=(value:unknown):Record<string,unknown>|null=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null;

/** 读官方命名空间的当前值；读不到就是读不到，不伪造空表。 */
export function managedDescriptor(authority:ManagedAuthority):{revision:number;servers:Record<string,Record<string,unknown>>}|null{
 let list:ManagedDescriptorLike[];
 try{list=authority.settings.describe({redactSecrets:false});}
 catch{return null;}
 const found=list.find(item=>asRecord(item)!==null&&item.ns===authority.namespace);
 const section=asRecord(found);
 if(section===null)return null;
 const value=asRecord(section.value);
 const servers=asRecord(value?.servers);
 const revision=typeof section.revision==='number'?section.revision:0;
 const out:Record<string,Record<string,unknown>>={};
 for(const [name,entry] of Object.entries(servers??{})){
  const record=asRecord(entry);
  if(record!==null)out[name]=record;
 }
 return {revision,servers:out};
}

export function managedViews(authority:ManagedAuthority):Map<string,ManagedViewLike>{
 const map=new Map<string,ManagedViewLike>();
 try{
  for(const view of authority.manager.list()){
   const record=asRecord(view);
   if(record!==null&&typeof record.name==='string'&&record.name.length>0)map.set(record.name,view);
  }
 }catch{/* 读不到状态不等于没有服务器：目录仍按条目列出，状态行交由页面显示“查不到”。 */}
 return map;
}

function transportOf(entry:Record<string,unknown>):McpServerTransport{
 return entry.transport==='stdio'?'stdio':'streamable-http';
}

/** 官方状态 → 条目状态 + 连接态。映射只认官方公开的 state 名，未知状态一律“未就绪”，不猜。 */
export function managedStatusOf(view:ManagedViewLike|null):{state:McpServerState;runtime:McpRuntimeStatus|null}{
 const status=asRecord(view?.status);
 if(status===null)return {state:'pending',runtime:null};
 const lastError=typeof status.lastError==='string'?status.lastError:undefined;
 switch(status.state){
  case 'disabled':return {state:'disabled',runtime:null};
  case 'connected':return {state:'running',runtime:{state:'connected',...(typeof status.toolCount==='number'?{toolCount:status.toolCount}:{})}};
  case 'connecting':return {state:'pending',runtime:{state:'not-connected'}};
  case 'reconnecting':return {state:'pending',runtime:{state:'not-connected',...(lastError===undefined?{}:{error:lastError})}};
  // waiting-credentials 是官方 manager 在等凭据服务，不是我们 OAuth 客户端的登录流程：不映射成 needs-login，
  // 否则页面会显示“需要登录”却没有登录入口（managed 行没有登录动作）。
  case 'waiting-credentials':return {state:'pending',runtime:{state:'not-connected',...(lastError===undefined?{}:{error:lastError})}};
  case 'closed':return {state:'pending',runtime:{state:'not-connected'}};
  case 'failed':{
   const detail=typeof status.reason==='string'?status.reason:undefined;
   return {state:'failed',runtime:{state:'failed',...(lastError??detail)===undefined?{}:{error:lastError??detail}}};
  }
  default:return {state:'pending',runtime:{state:'unknown'}};
 }
}

/** 目录行：条目来自 config.servers，状态来自 mcpManager；两个来源都读不到时条目照列、状态未知。 */
export function managedCatalog(authority:ManagedAuthority):ManagedCatalogRow[]{
 const descriptor=managedDescriptor(authority);
 if(descriptor===null)return [];
 const views=managedViews(authority);
 return Object.entries(descriptor.servers)
  .map(([name,entry])=>({name,entry,view:views.get(name)??null}))
  .sort((left,right)=>left.name<right.name?-1:left.name>right.name?1:0);
}

function pairsToObject(pairs:unknown):Record<string,string>{
 const out:Record<string,string>={};
 if(!Array.isArray(pairs))return out;
 for(const pair of pairs)if(pair&&typeof pair.key==='string'&&pair.key.length>0)out[pair.key]=typeof pair.value==='string'?pair.value:'';
 return out;
}

/** 用户草稿 → 官方条目。已有条目保留 enabled 与未命名字段；切换 transport 时清掉另一侧字段，
 *  因为官方校验会拒绝跨 transport 的字段（`url` 在 stdio 上、`command` 在 http 上）。 */
export function managedEntryFromDraft(existing:Record<string,unknown>|null,draft:McpServerDraft,transport:McpServerTransport):Record<string,unknown>{
 const entry:Record<string,unknown>={
  transport,
  command:typeof existing?.command==='string'?existing.command:'',
  args:Array.isArray(existing?.args)?existing.args.filter((arg):arg is string=>typeof arg==='string'):[],
  env:asRecord(existing?.env)??{},
  cwd:typeof existing?.cwd==='string'?existing.cwd:'',
  url:typeof existing?.url==='string'?existing.url:'',
  headers:asRecord(existing?.headers)??{},
  enabled:existing?.enabled!==false,
  ...(typeof existing?.toolCallTimeoutMs==='number'?{toolCallTimeoutMs:existing.toolCallTimeoutMs}:{}),
  ...(typeof existing?.startupTimeoutMs==='number'?{startupTimeoutMs:existing.startupTimeoutMs}:{}),
  ...(typeof existing?.closeTimeoutMs==='number'?{closeTimeoutMs:existing.closeTimeoutMs}:{}),
  ...(asRecord(existing?.reconnect)!==null?{reconnect:existing?.reconnect}:{}),
 };
 if(typeof draft.url==='string'&&draft.url.trim().length>0)entry.url=draft.url.trim();
 if(typeof draft.command==='string'&&draft.command.trim().length>0)entry.command=draft.command.trim();
 if(Array.isArray(draft.args))entry.args=draft.args.filter((arg):arg is string=>typeof arg==='string');
 if(typeof draft.cwd==='string'&&draft.cwd.trim().length>0)entry.cwd=draft.cwd.trim();
 if(typeof draft.toolCallTimeoutMs==='number'&&Number.isFinite(draft.toolCallTimeoutMs)&&draft.toolCallTimeoutMs>0)entry.toolCallTimeoutMs=Math.trunc(draft.toolCallTimeoutMs);
 // 命名即覆盖：用户清空 headers/env 就是空对象（与 patch 路径的 ADR-055 语义一致）。
 if(Array.isArray(draft.headers))entry.headers=pairsToObject(draft.headers);
 if(Array.isArray(draft.env))entry.env=pairsToObject(draft.env);
 // durable enable flag：只有草稿明确命名时才改，未命名保留已存值（与 patch 路径的“只改命名字段”一致）。
 if(typeof draft.enabled==='boolean')entry.enabled=draft.enabled;
 // 官方条目没有 failOnStartupError；它按状态行报告启动失败，所以该开关写不进官方配置。
 if(transport==='stdio'){entry.url='';entry.headers={};}
 else{entry.command='';entry.args=[];entry.env={};entry.cwd='';}
 return entry;
}

function writeFailure(error:unknown):RemoteError{
 const message=typeof (error as {message?:unknown})?.message==='string'?(error as {message:string}).message:'';
 return new RemoteError('mcp/managed-write-failed','MCP_MANAGED_WRITE_FAILED: the official MCP manager refused this change',{reason:'refused',...(message.length>0&&message.length<=400?{detail:message}:{})});
}

/** 写官方 config.servers：带 describe 读到的修订号做 CAS；条目写入即生效（volatile）。 */
export async function managedWrite(authority:ManagedAuthority,name:string,entry:Record<string,unknown>|null):Promise<void>{
 const descriptor=managedDescriptor(authority);
 if(descriptor===null)throw new RemoteError('mcp/managed-unavailable','MCP_MANAGED_UNAVAILABLE: the official MCP manager has no served settings namespace',{});
 try{
  await authority.settings.mutate(authority.namespace,entry===null?[{op:'unset',path:['servers',name]}]:[{op:'set',path:['servers',name],value:entry}],descriptor.revision);
 }catch(error){
  // 修订冲突与“写锁”是同一用户语义：配置在读取后变了，重新加载再试。页面已有该码的文案。
  if((error as {code?:unknown})?.code==='SETTINGS_CONFLICT')throw new RemoteError('mcp/write-locked','MCP_WRITE_LOCKED: the configuration changed since it was read; reload and retry',{});
  throw writeFailure(error);
 }
}

/** 用户触发的探测：走官方 manager.probe，不碰运行中的实例。 */
export async function managedProbe(authority:ManagedAuthority,name:string):Promise<McpRuntimeStatus|null>{
 let result:unknown;
 try{result=await authority.manager.probe(name,{});}
 catch(error){
  const message=typeof (error as {message?:unknown})?.message==='string'?(error as {message:string}).message:'probe failed';
  return {state:'failed',error:message.length<=2000?message:message.slice(0,2000)};
 }
 const record=asRecord(result);
 if(record===null)return null;
 if(record.ok===true){
  const toolNames=Array.isArray(record.toolNames)?record.toolNames:[];
  return {state:'connected',toolCount:toolNames.length};
 }
 const message=typeof record.message==='string'?record.message:'probe failed';
 return {state:'failed',error:message.length<=2000?message:message.slice(0,2000)};
}

/** 官方行发现：按模块名找 entry id（行 id 由用户 profile 决定），再确认两个服务都在。
 *  缺任何一半都返回 null——UI 退回旧路径（ADR-092 D4：同一运行时只允许一个 owner）。 */
export function discoverManagedAuthority(entries:readonly {id?:unknown;name?:unknown}[],lookup:(name:string)=>unknown):ManagedAuthority|null{
 for(const entry of entries){
  if(entry===null||typeof entry!=='object')continue;
  if(entry.name!==MCP_MANAGER_MODULE)continue;
  const namespace=typeof entry.id==='string'?entry.id:'';
  if(namespace.length===0)continue;
  const manager=lookup('mcpManager') as ManagedManagerLike|undefined;
  const settings=lookup('settings') as ManagedSettingsLike|undefined;
  if(!manager||typeof manager.list!=='function'||typeof manager.probe!=='function')return null;
  if(!settings||typeof settings.describe!=='function'||typeof settings.mutate!=='function')return null;
  return {namespace,manager,settings};
 }
 return null;
}
