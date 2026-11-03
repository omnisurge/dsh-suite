/** Engine intent, not deployment admission. Unknown names can be ignored by SearXNG;
 * HTTP 200/nonempty results are NOT name proof. Explicit requests require the same
 * endpoint's /config catalogue. Built-ins use its enabled candidate intersection;
 * custom is exact declared membership (an explicit disabled name is user intent).
 * No catalogue is kept between operations; default never needs or sends engines. */
export type EngineGroupId = 'auto' | 'default' | 'en' | 'zh' | 'custom';
export const ENGINE_GROUP_IDS: readonly EngineGroupId[] = ['auto','default','en','zh','custom'];
export const DEFAULT_ENGINE_GROUP: EngineGroupId = 'default';
/** Self-contained native schema callback; old all keeps server-default semantics. */
export function normalizeEngineGroup(value: string): EngineGroupId {
 if(value==='all')return 'default';
 if(['auto','default','en','zh','custom'].includes(value))return value as EngineGroupId;
 throw new TypeError('Unknown SearXNG engine group');
}
const KANA=/[\u3040-\u309F\u30A0-\u30FF]/u;
const HANGUL=/[\u1100-\u11FF\uAC00-\uD7AF]/u;
const HAN=/[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u{20000}-\u{2A6DF}]/u;
/** Kana/Hangul precede Han. Pure-Han Japanese is a known ambiguous case. */
export function detectQueryLanguage(query:string):'zh'|'intl'{
 if(KANA.test(query)||HANGUL.test(query))return 'intl';return HAN.test(query)?'zh':'intl';
}
export function effectiveEngineGroup(group:EngineGroupId,query:string):Exclude<EngineGroupId,'auto'>{
 const normalized=normalizeEngineGroup(group);
 return normalized==='auto'?(detectQueryLanguage(query)==='zh'?'zh':'en'):normalized;
}
/** Correct upstream names are candidates only; not historical live-admission claims. */
export const EN_ENGINES:readonly string[]=['google','bing','reddit','presearch','google news','bing news','github','stackoverflow'];
export const ZH_ENGINES:readonly string[]=['baidu','360search','bilibili','sogou','sogou wechat','quark'];
/** Shared schema/runtime grammar. Spaces inside a name are significant. */
export const CUSTOM_ENGINES_PATTERN=/^(?:\s*[A-Za-z0-9_.-]+(?: +[A-Za-z0-9_.-]+)*(?:\s*,\s*[A-Za-z0-9_.-]+(?: +[A-Za-z0-9_.-]+)*)*\s*)?$/;
export function isEngineGroupId(value:string):value is EngineGroupId{return (ENGINE_GROUP_IDS as readonly string[]).includes(value);}
export function parseCustomEngines(value:string):string[]|undefined{
 if(!CUSTOM_ENGINES_PATTERN.test(value))return undefined;
 const tokens:string[]=[];for(const raw of value.split(',')){const token=raw.trim();if(token&&!tokens.includes(token))tokens.push(token);}return tokens;
}
/** /config contract: names and server disabled flags, not remote engine health.
 * Source: searxng d7e8b7cd1 searx/webapp.py config(): name, enabled=!disabled. */
export interface EngineCapability{name:string;enabled:boolean;}
export class EngineSelectionError extends Error{
 constructor(readonly code:'ENGINE_CONFIG_INVALID'|'ENGINE_NAME_UNKNOWN'|'ENGINE_GROUP_UNAVAILABLE'|'CUSTOM_ENGINES_INVALID'){super(code);}
}
export function parseEngineCatalogue(payload:unknown):EngineCapability[]{
 if(!payload||typeof payload!=='object'||!Array.isArray((payload as {engines?:unknown}).engines))throw new EngineSelectionError('ENGINE_CONFIG_INVALID');
 const engines:EngineCapability[]=[],names=new Set<string>();
 for(const entry of (payload as {engines:unknown[]}).engines){
  if(!entry||typeof entry!=='object')throw new EngineSelectionError('ENGINE_CONFIG_INVALID');
  const {name,enabled}=entry as Partial<EngineCapability>;
  if(typeof name!=='string'||!name.trim()||name!==name.trim()||name.includes(',')||typeof enabled!=='boolean'||names.has(name))throw new EngineSelectionError('ENGINE_CONFIG_INVALID');
  names.add(name);engines.push({name,enabled});
 }
 return engines;
}
/** undefined means ONLY server-default omission; invalid/missing admission throws. */
export function enginesParamFor(group:Exclude<EngineGroupId,'auto'>,customEngines?:string,catalogue?:readonly EngineCapability[]):string|undefined{
 if(group==='default')return undefined;
 if(!catalogue)throw new EngineSelectionError('ENGINE_CONFIG_INVALID');
 const known=new Set(catalogue.map(entry=>entry.name)),enabled=new Set(catalogue.filter(entry=>entry.enabled).map(entry=>entry.name));
 if(group==='custom'){
  const tokens=parseCustomEngines(customEngines??'');if(!tokens?.length)throw new EngineSelectionError('CUSTOM_ENGINES_INVALID');
  if(tokens.some(name=>!known.has(name)))throw new EngineSelectionError('ENGINE_NAME_UNKNOWN');return tokens.join(',');
 }
 const selected=(group==='en'?EN_ENGINES:ZH_ENGINES).filter(name=>enabled.has(name));
 if(!selected.length)throw new EngineSelectionError('ENGINE_GROUP_UNAVAILABLE');return selected.join(',');
}
