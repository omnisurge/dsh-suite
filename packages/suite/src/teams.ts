/** Agent Teams 诊断（ADR-054 D1/D6）：只读官方事实，不给团队运行时加第二个权威 owner。
 *
 * 事实源只有两处，都是官方的：
 * - 成员与失败原因：`sessionProjections.stateOf(session,'agentTeam')`（成员快照含 `phase` 与 `error`）。
 * - 名额：`agentTeams.config.maxMembers`（官方部署限制，schema 默认 16、profile patch 常设 8）。
 *
 * 白名单之外的字段一律不读、不返回：成员消息正文、会话正文、prompt、凭据、tool 参数都不在返回体里。
 * 读不到就如实降级（`TEAM_STATUS_UNAVAILABLE` / 原因不可得），不猜、不渲染空表冒充"没有成员"。
 */
import type {TeamMemberPhase,TeamMemberRow,TeamPrecheck,TeamRow,TeamStatus} from './types.js';
export type {TeamMemberPhase,TeamMemberRow,TeamPrecheck,TeamRow,TeamStatus};

export const TEAM_STATUS_UNAVAILABLE='TEAM_STATUS_UNAVAILABLE';
export const TEAM_PRECHECK_UNVERIFIED='TEAM_PRECHECK_UNVERIFIED';

interface CtxLike{get(name:string):unknown;}
const asRecord=(value:unknown):Record<string,unknown>|null=>value!==null&&typeof value==='object'?value as Record<string,unknown>:null;
const asString=(value:unknown):string=>typeof value==='string'?value:'';
/** 失败原因可能很长；卡片只给可读的一段，完整串留在原始诊断里。 */
const MAX_ERROR=400;

const phaseOf=(value:unknown):TeamMemberPhase=>value==='active'||value==='failed'?'failed'===value?'failed':'active':value==='provisioning'?'provisioning':'provisioning';

/** 成员行的字段白名单就是这张表的字段：新增字段必须先补 ADR（specs/agent-teams-card.md）。 */
export function memberRowOf(value:unknown):TeamMemberRow|null{
 const member=asRecord(value);
 if(member===null)return null;
 const id=asString(member.id),name=asString(member.name);
 if(id.length===0||name.length===0)return null;
 const error=asString(member.error).slice(0,MAX_ERROR);
 return {
  id,name,
  description:asString(member.description),
  provider:asString(member.provider),
  context:asString(member.context),
  phase:phaseOf(member.phase),
  error:error.length>0?error:null,
 };
}

export function readTeamStatus(ctx:CtxLike,selectionOf:(agent:unknown)=>unknown):TeamStatus{
 const projections=ctx.get('sessionProjections') as {stateOf?:(session:unknown,key:string)=>unknown}|undefined;
 const agents=ctx.get('agents') as {list?:()=>unknown[]}|undefined;
 const list=typeof agents?.list==='function'?agents.list():null;
 if(typeof projections?.stateOf!=='function'||list===null)return {available:false,code:TEAM_STATUS_UNAVAILABLE,maxMembers:null,teams:[],precheck:{state:'unknown',provider:null,model:null,failedMembers:0,code:TEAM_STATUS_UNAVAILABLE,providerVerified:false}};
 const rawLimit=asRecord(ctx.get('agentTeams'))?.config;
 const limit=asRecord(rawLimit)?.maxMembers;
 const maxMembers=typeof limit==='number'&&Number.isFinite(limit)&&limit>0?limit:null;
 const teams:TeamRow[]=[];
 for(const agent of list){
  const session=asRecord(agent)?.session;
  if(session===undefined||session===null)continue;
  let state:unknown;
  try{state=projections.stateOf(session,'agentTeam');}
  catch{continue;}
  if(state===undefined||state===null)continue;
  const record=asRecord(state);
  if(record===null)continue;
  const members=Array.isArray(record.members)?record.members.map(memberRowOf).filter((row):row is TeamMemberRow=>row!==null):[];
  const failure=asString(record.failure);
  teams.push({
   rootId:asString(asRecord(session)?.id),
   members,
   failed:members.filter(row=>row.phase==='failed').length,
   code:failure.length>0?'TEAM_PROJECTION_FAILED':null,
  });
 }
 const failedMembers=teams.reduce((total,team)=>total+team.failed,0);
 const firstAgent=list.find(agent=>asRecord(asRecord(agent)?.session)!==null)??null;
 const selection=asRecord(selectionOf(firstAgent));
 const provider=asString(selection?.provider),model=asString(selection?.model);
 // 「provider 已下线」需要一个官方的模型目录服务；本运行时没有公开该能力，所以只报事实、不冒充校验过。
 return {
  available:true,code:null,maxMembers,teams,
  precheck:{
   state:failedMembers>0?'warn':'ok',
   provider:provider.length>0?provider:null,
   model:model.length>0?model:null,
   failedMembers,
   code:failedMembers>0?'TEAM_PRECHECK_FAILED_MEMBERS':TEAM_PRECHECK_UNVERIFIED,
   providerVerified:false,
  },
 };
}
