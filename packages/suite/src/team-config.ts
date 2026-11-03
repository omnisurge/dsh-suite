/** B1：Agent Teams 的配置写入（ADR-054 D1/D4）。
 *
 * 写入口不是官方 service（`pluginManager` 没有 config 写入方法，`configForms.mutate` 只能写自己这一行），
 * 而是**profile patch 文件**：App 的 `applyEntryPatches` 对非 insert 补丁按键整体覆盖
 * （`target[key]=value`，`config` 不做深合并），我们仓的 MCP 行写入器走的就是这条路。
 *
 * 三条纪律：
 * - 写前必修：先用 loader 里的**当前生效**行读出 `name` 与完整 `config`，只改声明过的键，其余原样带回，
 *   因为 patch 是整键覆盖——少带一个键就等于删掉它。
 * - 备份是前置条件：备份写不出来，patch 文件一个字节都不动。
 * - 生效时机如实说：写盘后需要重启才生效，接口回 `restartRequired:true`，不假装已经热更新。
 */
import {copyFile,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {parse as parseYaml,stringify as stringifyYaml} from 'yaml';
import type {TeamConfigState,TeamConfigWrite} from './types.js';
// 上限只有一处声明（limits.json）：页面提示、Host 写入闸门读同一份。
import limits from './limits.json' with {type:'json'};

export const TEAM_CONFIG_PATCH='cordis.patch.yml';
export const TEAM_CONFIG_KEYS=['maxMembers','freshProvider'] as const;
/** 两个配置键分属两个不同的官方行（名来自目标运行时契约快照，不猜）：
 *  - maxMembers   在 agent-team 行；
 *  - freshProvider 在 tool-agent-team 行。
 *  0.2.1-2 把名字写成不带 -experimental- 的旧名，真机上一行都找不到，整块表单不渲染。 */
export const TEAM_CONFIG_MAX_MEMBERS_ROW='@deepseek-ai/dsh-experimental-agent-team';
export const TEAM_CONFIG_FRESH_PROVIDER_ROW='@deepseek-ai/dsh-experimental-tool-agent-team';
export const TEAM_CONFIG_ROW_NAMES=[TEAM_CONFIG_MAX_MEMBERS_ROW,TEAM_CONFIG_FRESH_PROVIDER_ROW] as const;
/** 字段→归属行：写的时候按字段路由，绝不把某行的键塞进另一行（那行不认，静默无效）。 */
export const TEAM_CONFIG_FIELD_ROW={maxMembers:TEAM_CONFIG_MAX_MEMBERS_ROW,freshProvider:TEAM_CONFIG_FRESH_PROVIDER_ROW} as const;
export const TEAM_CONFIG_MAX_MEMBERS_LIMIT=limits.maxTeamMembers;

/** 模块内部的行形状（完整 config 只在 Host 进程里用）；跨线缆的是 types.ts 里的 TeamConfigRowView。 */
export interface TeamConfigRow {rowId:string;name:string;config:Record<string,unknown>;}
export type {TeamConfigState,TeamConfigWrite};

type LoaderEntry={id?:unknown;name?:unknown;config?:unknown;group?:unknown;include?:unknown};
const asRecord=(value:unknown):Record<string,unknown>|null=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null;
const asString=(value:unknown):string=>typeof value==='string'?value:'';

/** 官方行按模块名发现，不猜 row id：名字不符就是没找到，宁可不写也不写到别的行上。 */
export function teamRowsOf(entries:readonly LoaderEntry[]|null|undefined):TeamConfigRow[]{
 if(!Array.isArray(entries))return [];
 const rows:TeamConfigRow[]=[];
 for(const entry of entries){
  const record=asRecord(entry);
  if(record===null)continue;
  const name=asString(record.name),rowId=asString(record.id);
  if(rowId.length===0||!(TEAM_CONFIG_ROW_NAMES as readonly string[]).includes(name))continue;
  rows.push({rowId,name,config:asRecord(record.config)??{}});
 }
 return rows;
}

/** 校验 + 合并。只接受声明过的键；`config` 整体覆盖，所以返回值必须是"当前全部键 + 新值"。 */
export function mergeTeamConfig(current:Record<string,unknown>,patch:Record<string,unknown>):{code:string|null;config:Record<string,unknown>;changedKeys:string[]}{
 const next={...current};
 const changedKeys:string[]=[];
 for(const [key,value] of Object.entries(patch)){
  if(!(TEAM_CONFIG_KEYS as readonly string[]).includes(key))return {code:'TEAM_CONFIG_KEY_UNKNOWN',config:current,changedKeys:[]};
  if(key==='maxMembers'){
   if(!Number.isInteger(value)||(value as number)<1||(value as number)>TEAM_CONFIG_MAX_MEMBERS_LIMIT)return {code:'TEAM_CONFIG_MAX_MEMBERS_OUT_OF_RANGE',config:current,changedKeys:[]};
   if(current[key]!==value)changedKeys.push(key);
   next[key]=value;
   continue;
  }
  if(typeof value!=='string'||value.trim().length===0)return {code:'TEAM_CONFIG_FRESH_PROVIDER_INVALID',config:current,changedKeys:[]};
  if(current[key]!==value.trim())changedKeys.push(key);
  next[key]=value.trim();
 }
 return {code:null,config:next,changedKeys};
}

/** 在 patch 列表里 upsert 这个行的补丁条目：已有同 id 条目只改 config，没有就追加一条。 */
export function upsertPatchEntry(list:unknown,row:TeamConfigRow,config:Record<string,unknown>):{list:Record<string,unknown>[];changed:boolean}{
 const entries=Array.isArray(list)?list.filter((item):item is Record<string,unknown>=>asRecord(item)!==null):[];
 let changed=false;
 const target=entries.find(item=>item.id===row.rowId);
 if(target){
  const existingName=asString(target.name);
  if(existingName.length>0&&existingName!==row.name)throw Error('TEAM_CONFIG_ROW_NAME_MISMATCH');
  // 已有条目可能带别的键（enabled/group…），只换 config；值没变就不重写（不制造无意义备份与字节变化）。
  changed=JSON.stringify(target.config)!==JSON.stringify(config);
  target.config=config;
  return {list:entries,changed};
 }
 entries.push({id:row.rowId,name:row.name,config});
 changed=true;
 return {list:entries,changed};
}

export async function writeTeamConfig(profileDir:string|null,row:TeamConfigRow,next:Record<string,unknown>,stamp:string,changedKeys:string[]=[]):Promise<TeamConfigWrite>{
 if(profileDir===null||profileDir.length===0)return {changed:false,backupPath:null,restartRequired:false,code:'TEAM_CONFIG_PROFILE_UNKNOWN',changedKeys:[],maxMembers:null,freshProvider:null};
 const path=join(profileDir,TEAM_CONFIG_PATCH);
 let text:string;
 try{text=await readFile(path,'utf8');}
 catch{return {changed:false,backupPath:null,restartRequired:false,code:'TEAM_CONFIG_PATCH_MISSING',changedKeys:[],maxMembers:null,freshProvider:null};}
 const before=parseYaml(text);
 const {list,changed}=upsertPatchEntry(before,row,next);
 if(!changed)return {changed:false,backupPath:null,restartRequired:false,code:null,changedKeys:[],maxMembers:typeof next.maxMembers==='number'?next.maxMembers:null,freshProvider:typeof next.freshProvider==='string'?next.freshProvider:null};
 // 备份是前置条件：写不出来就一个字节都不动。
 const backupPath=path+'.bak-team-config-rolling';
 try{await copyFile(path,backupPath);}
 catch{return {changed:false,backupPath:null,restartRequired:false,code:'TEAM_CONFIG_BACKUP_FAILED',changedKeys:[],maxMembers:null,freshProvider:null};}
 try{await writeFile(path,stringifyYaml(list),'utf8');}
 catch{return {changed:false,backupPath,restartRequired:false,code:'TEAM_CONFIG_WRITE_FAILED',changedKeys:[],maxMembers:null,freshProvider:null};}
 return {changed:true,backupPath,restartRequired:true,code:null,changedKeys,maxMembers:typeof next.maxMembers==='number'?next.maxMembers:null,freshProvider:typeof next.freshProvider==='string'?next.freshProvider:null};
}

/** 从两行里取各自字段的当前值：缺失的行/键就是 null，不拿另一行的值冒充。 */
export function teamConfigFields(rows:TeamConfigRow[]):{maxMembers:number|null;freshProvider:string|null}{
 const byName=new Map(rows.map(row=>[row.name,row]));
 const maxRow=byName.get(TEAM_CONFIG_MAX_MEMBERS_ROW);
 const freshRow=byName.get(TEAM_CONFIG_FRESH_PROVIDER_ROW);
 const maxMembers=maxRow&&typeof maxRow.config.maxMembers==='number'?maxRow.config.maxMembers as number:null;
 const freshProvider=freshRow&&typeof freshRow.config.freshProvider==='string'?freshRow.config.freshProvider as string:null;
 return {maxMembers,freshProvider};
}

/** 把 patch 按字段路由到各自归属的行，逐行 merge；任一行缺失即失败（不改别的行）。 */
export function planTeamConfig(rows:TeamConfigRow[],patch:Record<string,unknown>):{code:string|null;plans:{row:TeamConfigRow;next:Record<string,unknown>}[];changedKeys:string[]}{
 const byName=new Map(rows.map(row=>[row.name,row]));
 const plans:{row:TeamConfigRow;next:Record<string,unknown>}[]=[];
 const changedKeys:string[]=[];
 for(const [key,value] of Object.entries(patch)){
  const owner=(TEAM_CONFIG_FIELD_ROW as Record<string,string>)[key];
  if(owner===undefined||!(TEAM_CONFIG_KEYS as readonly string[]).includes(key))return {code:'TEAM_CONFIG_KEY_UNKNOWN',plans:[],changedKeys:[]};
  const row=byName.get(owner);
  if(!row)return {code:'TEAM_CONFIG_ROW_NOT_FOUND',plans:[],changedKeys:[]};
  const merged=mergeTeamConfig(row.config,{[key]:value});
  if(merged.code!==null)return {code:merged.code,plans:[],changedKeys:[]};
  changedKeys.push(...merged.changedKeys);
  plans.push({row,next:merged.config});
 }
 return {code:null,plans,changedKeys};
}

/** 多行一次写盘：一个备份、一次写入；每行整键覆盖并带回旧键。no change 不重写。 */
export async function writeTeamConfigs(profileDir:string|null,plans:{row:TeamConfigRow;next:Record<string,unknown>}[],allRows:TeamConfigRow[],stamp:string,changedKeys:string[]=[]):Promise<TeamConfigWrite>{
 if(profileDir===null||profileDir.length===0)return {changed:false,backupPath:null,restartRequired:false,code:'TEAM_CONFIG_PROFILE_UNKNOWN',changedKeys:[],maxMembers:null,freshProvider:null};
 const path=join(profileDir,TEAM_CONFIG_PATCH);
 let text:string;
 try{text=await readFile(path,'utf8');}
 catch{return {changed:false,backupPath:null,restartRequired:false,code:'TEAM_CONFIG_PATCH_MISSING',changedKeys:[],maxMembers:null,freshProvider:null};}
 let list=parseYaml(text);
 let changed=false;
 for(const plan of plans){const result=upsertPatchEntry(list,plan.row,plan.next);list=result.list;changed=changed||result.changed;}
 // 字段值以「改后的合并态」为准：被改的行用 next，未改的行用原 config。
 const mergedRows=allRows.map(row=>{const plan=plans.find(item=>item.row.name===row.name);return plan?{...row,config:plan.next}:row;});
 const fields=teamConfigFields(mergedRows);
 if(!changed)return {changed:false,backupPath:null,restartRequired:false,code:null,changedKeys:[],maxMembers:fields.maxMembers,freshProvider:fields.freshProvider};
 const backupPath=path+'.bak-team-config-rolling';
 try{await copyFile(path,backupPath);}
 catch{return {changed:false,backupPath:null,restartRequired:false,code:'TEAM_CONFIG_BACKUP_FAILED',changedKeys:[],maxMembers:null,freshProvider:null};}
 try{await writeFile(path,stringifyYaml(list),'utf8');}
 catch{return {changed:false,backupPath,restartRequired:false,code:'TEAM_CONFIG_WRITE_FAILED',changedKeys:[],maxMembers:null,freshProvider:null};}
 return {changed:true,backupPath,restartRequired:true,code:null,changedKeys,maxMembers:fields.maxMembers,freshProvider:fields.freshProvider};
}

export const AGENT_TEAMS_ROW_NAME='@omnisurge/dsh-suite/agent-teams';


/** 按模块名发现 agent-teams 行：行 id 由用户 profile 决定，不写死。 */
export function agentTeamsRowOf(entries:readonly {id?:unknown;name?:unknown;config?:unknown}[]|null|undefined):TeamConfigRow|null{
 if(!Array.isArray(entries))return null;
 for(const entry of entries){
  if(!entry||typeof entry!=='object')continue;
  if(asString(entry.name)!==AGENT_TEAMS_ROW_NAME)continue;
  const rowId=asString(entry.id);
  if(rowId.length===0)continue;
  return {rowId,name:AGENT_TEAMS_ROW_NAME,config:asRecord(entry.config)??{}};
 }
 return null;
}

