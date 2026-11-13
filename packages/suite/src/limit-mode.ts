/** 极限模式：一段**用户自定义**的系统提示段（ADR-058）。
 *
 * 三个决定都必须在这里落地，而不是散在 Host 与页面之间：
 * - 判定按 agent：同一进程里不同会话可以有不同模型，所以段文本每次组装时按 `context.agent` 重新判定，
 *   而不是注册时判定（注册时判定等于 profile 级，ADR-058 D2 已否掉）。
 * - 失败即不注入：读不到模型选择、配置非法、文本为空，一律返回空文本，绝不猜一个"可能命中"。
 * - 只读字段：优先读官方 `agent.model`（rc.2.2 指定入口），退化读 `modelSelection.pending ?? lastUsed`；不读消息正文、prompt、工具参数、凭据。
 */
import type {LimitModeSelection,LimitModeStatus} from './types.js';
// 唯一声明处（limits.json）：Host、行 schema、Client 三方读同一份数据（tsc 会把它带进 lib/，esbuild 内联进两个 bundle）。
import limits from './limits.json' with {type:'json'};
export type {LimitModeSelection,LimitModeStatus};

export const LIMIT_MODE_SECTION='omnisurge:limit-mode';
/** 默认值与上限的唯一声明处是 limits.json（node / tsc / esbuild 都能直接读）。 */
export const LIMIT_MODE_DEFAULT_MODELS:readonly string[]=[...limits.defaultModels];
/** 内置提示词（ADR-065 D4）：不是用户可编辑文本，随产品发布；explicit '' 仍视为用户清空。 */
export const LIMIT_MODE_DEFAULT_TEXT:string=limits.extremePromptText;
export const LIMIT_MODE_MAX_MODELS=limits.maxModels;
export const LIMIT_MODE_MAX_TEXT=limits.maxText;
/** 与 `omnisurge:mcp-purpose`(40) 分离，且排在工具说明前后都不影响缓存键。 */
export const LIMIT_MODE_ORDER=56;

export interface LimitModeConfig{enabled:boolean;models:string[];text:string;}
export type ModelSelection=LimitModeSelection;
export interface LimitModeSection{code:string|null;text:string;}
interface CtxLike{get(name:string):unknown;}

const asRecord=(value:unknown):Record<string,unknown>|null=>value!==null&&typeof value==='object'?value as Record<string,unknown>:null;
const asString=(value:unknown):string|null=>typeof value==='string'&&value.length>0?value:null;

/**
 * 解开 schemastery 的 volatile 引用（`.volatile()` 字段解析后是 `{get()}` 而不是普通对象）。
 * 识别用 cosmokit 的跨副本协议符号，不 import 对方的实现：官方 `isVolatile` 也只看这一个符号。
 * 不认识的形状原样返回，交给 `normalizeLimitMode` 按"缺字段"处理——绝不因为形状陌生就抛错。
 */
const VOLATILE_WRITE=Symbol.for('cosmokit.volatile.write');
export function unwrapVolatile<T>(value:T):T{
 const record=asRecord(value);
 if(record===null)return value;
 if(!(VOLATILE_WRITE in record))return value;
 const read=record.get;
 return typeof read==='function'?(read.call(record) as T):value;
}
/** 配置可能来自任何一代 schema（旧 profile 缺字段）：缺什么就用默认值，绝不让"缺"变成"全命中"。 */
export function normalizeLimitMode(value:unknown):LimitModeConfig{
 // `.volatile()` 字段解析后是引用（`{get()}`）：先解开再当普通对象读，否则所有字段都读成缺省。
 const source=asRecord(unwrapVolatile(value));
 const enabled=source?.enabled===true;
 const rawModels=Array.isArray(source?.models)?source.models:null;
 const models=rawModels===null?[...LIMIT_MODE_DEFAULT_MODELS]:rawModels.filter((item):item is string=>typeof item==='string'&&item.trim().length>0).map(item=>item.trim());
 // ADR-065 D4：缺省（undefined）→ 内置文案；显式空串 '' 是用户清空意图，保留。
 const text=typeof source?.text==='string'?source.text:LIMIT_MODE_DEFAULT_TEXT;
 return {enabled,models,text};
}

/** 归一化模型名：小写 + 去掉所有非字母数字字符（空格/连字符/点/下划线/斜杠忽略）。
 *  这样 "deepseek v4.1 flash"、"deepseek-v4.1-flash"、"workbuddy/deepseek-v4.1-flash" 归一后都含 deepseek+flash。 */
export function normalizeModelName(value:string):string{
 return value.toLowerCase().replace(/[^a-z0-9]/gu,'');
}

/** 命中判定（ADR-065 D4）：模型名归一化后**同时包含所有模式**（AND）才命中；空模式列表永远不命中。
 *  从 ADR-058 的"任一条命中(OR)"改为 AND，是"极限模式只针对 DeepSeek Flash"的产品收窄。 */
export function matchesLimitModels(models:readonly string[],selection:ModelSelection|null):boolean{
 if(selection===null)return false;
 const patterns=models.map(normalizeModelName).filter(pattern=>pattern.length>0);
 if(patterns.length===0)return false;
 const model=normalizeModelName(selection.model);
 return patterns.every(pattern=>model.includes(pattern));
}

const selectionFrom=(value:unknown):ModelSelection|null=>{
 const record=asRecord(value);
 const provider=asString(record?.provider),model=asString(record?.model);
 return provider!==null&&model!==null?{provider,model}:null;
};
/** rc.2.2 的 AgentModel.current() / 直接 selection 形状；当前 rc.5 没有它时返回 null。 */
const selectionFromAgentModel=(agent:unknown):ModelSelection|null=>{
 const model=asRecord(agent)?.model;
 if(model===undefined||model===null)return null;
 try{
  if(typeof model==='function')return selectionFrom((model as()=>unknown)());
  const record=asRecord(model);
  if(record===null)return selectionFrom(model);
  if(typeof record.current==='function')return selectionFrom((record.current as()=>unknown).call(record));
  return selectionFrom(record.current??record);
 }catch{return null;}
};
/** 从官方读面读当前 agent 的下一跳选择；读不到就是读不到，不拿 provider 空串冒充。
 *  rc.2.2 优先 agent.model；当前 rc.5 的 AgentModel 不可用则读 raw state 的 pending ?? lastUsed
 *  （state 的 `next` 只存在于 wire view，stateOf 永远没有 next）。 */
export function selectionOf(ctx:CtxLike,agent:unknown):ModelSelection|null{
 let fromAgent:ModelSelection|null=null;
 try{fromAgent=selectionFromAgentModel(agent);}catch{fromAgent=null;}
 if(fromAgent!==null)return fromAgent;
 const session=asRecord(agent)?.session;
 if(session===undefined||session===null)return null;
 const projections=ctx.get('sessionProjections') as {stateOf?:(session:unknown,key:string)=>unknown}|undefined;
 if(typeof projections?.stateOf!=='function')return null;
 let state:unknown;
 try{state=projections.stateOf(session,'modelSelection');}
 catch{return null;}
 const record=asRecord(state);
 return selectionFrom(record?.pending) ?? selectionFrom(record?.lastUsed);
}

/** 从 agents 列表里取第一个能读出的选择（ADR-069 D2，0.2.2-3）。
 *  只读 list[0] 会把「第一条还没有选择」误报成「模型未知」，页面再把它写成「不命中」——把读不到说成事实。
 *  全读不到就返回 null（页面显示无法判断），不拿最后一条或空串凑答案。 */
export function firstReadableSelection(ctx:CtxLike,agents:unknown):ModelSelection|null{
 // The agents service is a class instance: its `list` is a prototype method that reads `this.store`.
 // Calling it detached (const f=svc.list; f()) throws "Cannot read properties of undefined" — and the
 // catch below would turn that into a silent "unreadable" that looks exactly like a real answer of null.
 // Keep the receiver: call through the service object, never through a bare function reference.
 const service=asRecord(agents);
 const list=(service?.list as (()=>unknown[])|undefined);
 if(typeof list!=='function')return null;
 let rows:unknown[];
 try{rows=list.call(service);}
 catch{return null;}
 if(!Array.isArray(rows))return null;
 for(const agent of rows){
  const found=selectionOf(ctx,agent);
  if(found!==null)return found;
 }
 return null;
}

/** 段的实际文本：返回空串等价于"这次不注入"，调用方不需要再判断一遍。 */
export function limitModeSectionText(config:LimitModeConfig,selection:ModelSelection|null):LimitModeSection{
 if(!config.enabled)return {code:null,text:''};
 if(config.models.length===0)return {code:'LIMIT_MODE_MODELS_EMPTY',text:''};
 if(selection===null)return {code:'LIMIT_MODE_NO_MODEL',text:''};
 if(!matchesLimitModels(config.models,selection))return {code:null,text:''};
 const text=config.text.trim();
 if(text.length===0)return {code:'LIMIT_MODE_TEXT_EMPTY',text:''};
 return {code:null,text};
}
