/** 自有 agent-teams 行（模块名 → 行 id 由用户 profile 决定，不写死）。
 *
 * 极限模式的状态与配置都住在这条自定义行里（ADR-062）：行 schema 声明 `limitMode`（volatile），
 * Host 只在运行期读它，不复制默认值。团队成员卡退役后（ADR-093），本模块是这条行唯一的 Host 读入口。
 */
export const AGENT_TEAMS_ROW_NAME='@omnisurge/dsh-suite/agent-teams';

const asRecord=(value:unknown):Record<string,unknown>|null=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null;
const asString=(value:unknown):string=>typeof value==='string'?value:'';

export interface AgentTeamsRow {rowId:string;name:string;config:Record<string,unknown>;}

/** 按模块名发现 agent-teams 行：行 id 由用户 profile 决定，不猜。 */
export function agentTeamsRowOf(entries:readonly {id?:unknown;name?:unknown;config?:unknown}[]|null|undefined):AgentTeamsRow|null{
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
