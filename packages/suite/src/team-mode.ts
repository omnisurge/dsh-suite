/** 团队模式的 Lead 协作提示（ADR-097）。
 *
 * 官方 `@deepseek-ai/dsh-tool-agent-team` 已注入 TEAM_POLICY（任务板、owner、wait 等机制）。
 * 这里只补一段产品决策偏好：复杂且可拆分的工作优先用团队成员，简单/顺序/强耦合留在 Lead。
 *
 * 纪律：只在团队模式开启且当前是根会话（Team Lead）时注入；注册失败只降级为没有这一段，
 * 不阻断会话启动。提示词是产品常量，不是用户可编辑文本。
 */
import limits from './limits.json' with {type:'json'};

export const TEAM_MODE_SECTION='omnisurge:team-mode-guidance';
/** 官方 TEAM_POLICY 的 SECTION_ORDERS 值为 600；601 保证紧随其后。 */
export const TEAM_MODE_ORDER=601;
export const TEAM_MODE_GUIDANCE:string=limits.teamModePromptText;

export interface AgentTeamEntryLike{options?:{id?:unknown;name?:unknown;config?:unknown;disabled?:unknown;};disabled?:unknown;}

const asRecord=(value:unknown):Record<string,unknown>|null=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null;
const asString=(value:unknown):string=>typeof value==='string'?value:'';

/** 从 Loader 的 active entries 里找官方 agent-team 行。
 *
 * 不能按行 id 猜：用户 profile 可以让行 id 不同；官方包名才是模块身份。旧实验行
 * `@deepseek-ai/dsh-experimental-agent-team` 不匹配；如果同包名有多个 active 条目，
 * 只接受唯一有 canonical `agent-team` id 的那一条，否则如实返回 null（不猜）。
 */
export function officialAgentTeamEntryOf(entries:Iterable<AgentTeamEntryLike>|null|undefined):AgentTeamEntryLike|null{
 if(entries===null||entries===undefined)return null;
 // 读失败必须与“没有这一行”分开：让调用方把 entries() 抛错映射成独立的不可读码，
 // 不能把异常吞成 null 然后告诉用户“官方行不存在”。
 const candidates=[...entries].filter(entry=>entry?.disabled!==true&&entry?.options?.disabled!==true&&asString(entry?.options?.name)==='@deepseek-ai/dsh-agent-team');
 if(candidates.length===0)return null;
 const canonical=candidates.find(entry=>asString(entry.options?.id)==='agent-team');
 if(canonical!==undefined)return canonical;
 return candidates.length===1?candidates[0]:null;
}

export function teamModeDefaultOf(entry:AgentTeamEntryLike):boolean{
 return asRecord(entry.options?.config)?.defaultEnabled===true;
}

export function teamModeSectionText(enabled:boolean,isLead:boolean):string{
 return enabled===true&&isLead===true?TEAM_MODE_GUIDANCE:'';
}
