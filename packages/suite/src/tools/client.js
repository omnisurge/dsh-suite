/**
 * The "Skills & MCP" sidebar panel: one whole-page surface with two management tabs.
 *
 * Entry and page are one contribution (ADR-023): the sidebar slot supplies the button and its own SVG
 * glyph, and the keyed main slot supplies the page under the same id. The official shell owns the button
 * and the panel switch; this page never calls selectPanel or rewrites panelInfo.
 *
 * Both tabs are independent management surfaces with their own read chain (ADR-025): each keeps its own
 * last-read receipt, busy state, failure fact and last good result, and the state object is created here at
 * registration time so switching tabs never loses or repeats a read. The Host sends machine facts only;
 * every sentence belongs to this Client's dictionaries (AGENTS section 5.10).
 *
 * The MCP tab lists SERVERS, not tools (ADR-025 D4): the 0.1.4/0.1.5 flat tool wall had no reading value at
 * hundreds of model-facing names. A row's identity for editing/removing is the Loader/patch rowId; a public
 * tool name is never parsed back into (serverName, rawName) (ADR-024 correction 2).
 *
 * remote.omnisurgeSuiteDev is a Cordis service, not a field: it is read only inside the inject scope that
 * declares it. Registration never waits for the handle, so a Host that is unreachable, still starting, or
 * failed to mount its generated Remote still leaves the user a page that names the reason (AGENTS 5.8).
 */
import * as React from 'react';
import {PageHead,SectionTabs,injectStyles} from '@omnisurge/dsh-ui';
import {CLIENT_ACTION_TIMEOUT_MS,CLIENT_READ_TIMEOUT_MS,RemoteTimeoutError,boundedRemoteCall} from '../remote-timeout.js';
import {assertRemoteEnvelope} from '../shared/client-remote.js';
import {clock,codeOf,failure,reason,refusalKind} from './client-format.js';
import {MCP_OAUTH_REQUEST_TIMEOUT_MS,mcpOauthCall} from './oauth-control.js';
import {en,zh,skillsEn,skillsZh} from './locale.js';
import {SkillsTab} from './skills-tab.js';
import {McpTab} from './mcp-tab.js';

export {MCP_OAUTH_REQUEST_TIMEOUT_MS,mcpOauthCall};

/** Sidebar id and main-panel key are the same value: the shell dispatches one by the other. */
export const TOOLS_PANEL_ID='omnisurge-skills-mcp';
export const TOOLS_LOCALE_NS='omnisurge.tools';
/** The 0.1.3 skills dictionary keeps its namespace and its exact 30 keys; the tab still reads from it. */
export const SKILLS_LOCALE_NS='omnisurge.skills';

const h=React.createElement;
const NAMESPACE_INJECT=['remote','remote.omnisurgeSuiteDev'];
const SKILLS_METHOD='listSkills';
const MCP_METHOD='listMcpServers';
const MCP_PURPOSES_METHOD='readMcpPurposes';
const SIDEBAR_SLOT='sidebar.panellist';
const MAIN_SLOT='main';

export function ToolsPanelIcon({size=18,active=false}){
  return h('svg',{
    xmlns:'http://www.w3.org/2000/svg',
    viewBox:'0 0 24 24',
    width:size,
    height:size,
    fill:'none',
    stroke:'currentColor',
    strokeWidth:active?2.2:1.8,
    strokeLinecap:'round',
    strokeLinejoin:'round',
    'aria-hidden':'true',
    focusable:'false',
    'data-testid':'tools-icon',
    'data-active':active?'true':'false',
  },
  h('path',{key:'spark',d:'M9 3.2l1.1 2.9 2.9 1.1-2.9 1.1L9 11.2 7.9 8.3 5 7.2l2.9-1.1z'}),
  h('rect',{key:'socket',x:12.2,y:10.2,width:7.6,height:6.4,rx:1.6}),
  h('path',{key:'prongs',d:'M14.4 16.6v2.2M17.6 16.6v2.2'}),
  h('path',{key:'cable',d:'M20 13.4h1.6'}));
}

/** No reader face (a headless fixture mounted the page without its contribution): render and name it. */
const DETACHED_ISSUE={kind:'namespace',raw:'SUITE_NAMESPACE_MISSING tools panel (the page was mounted without its reader)'};
const DETACHED={tab:'skills',skills:{data:null,complete:null,lastRead:null,phase:'idle',started:true,issue:DETACHED_ISSUE},mcp:{data:null,purposes:null,purposesIssue:DETACHED_ISSUE,lastRead:null,phase:'idle',started:true,issue:DETACHED_ISSUE}};
const noopSubscribe=()=>()=>{};
const zeroRevision=()=>0;

/** The whole page: one head, two tabs, and each tab's own read chain. */
export function ToolsPanel(props){
  const t=typeof props.t==='function'?props.t:key=>typeof en[key]==='string'?en[key]:key;
  const tSkills=typeof props.tSkills==='function'?props.tSkills:key=>typeof skillsEn[key]==='string'?skillsEn[key]:key;
  const panel=props.panel??DETACHED;
  const subscribe=typeof props.subscribe==='function'?props.subscribe:noopSubscribe;
  const getRevision=typeof props.getRevision==='function'?props.getRevision:zeroRevision;
  const start=typeof props.start==='function'?props.start:()=>undefined;
  const notify=typeof props.notify==='function'?props.notify:()=>undefined;
  // The registration-time state object is the only store: switching tabs re-renders, it never re-reads.
  React.useSyncExternalStore(subscribe,getRevision,getRevision);
  const tab=panel.tab==='mcp'?'mcp':'skills';
  // "This tab already ran its first read" is this page's own fact, keyed by tab: it must not depend on the identity
  // of the slot object the Host/registration store owns, and it must survive switching tabs (this component stays
  // mounted while the tab content swaps). The slot keeps its own started flag for the store's readers.
  const firstReadRef=React.useRef({skills:false,mcp:false});
  React.useEffect(()=>{
    const slot=panel[tab];
    if(slot&&firstReadRef.current[tab]!==true){
      firstReadRef.current[tab]=true;
      slot.started=true;
      start(tab);
    }
  },[tab,panel,start]);
  const select=id=>{if(panel.tab===id)return;panel.tab=id;notify();};
  // A main-panel page root, not the settings column: .omni-ui-page fills the panel and carries the page
  // padding (.omni-ui is the 760px settings bar width — using it here is what shifted 0.1.4's content).
  return h('div',{className:'omni-ui-tokens omni-ui-page','data-testid':'tools-panel'},
    h('div',{'data-testid':'skills-page-head'},h(PageHead,{title:t('title'),description:t('intro')})),
    h(SectionTabs,{value:tab,ariaLabel:t('tabsLabel'),options:[{id:'skills',label:t('tabSkills')},{id:'mcp',label:t('tabMcp')}],onChange:select}),
    tab==='mcp'
      ?h(McpTab,{t,panel:panel.mcp,start:()=>start('mcp'),mutate:typeof props.mutate==='function'?props.mutate:async()=>{throw failure('namespace','SUITE_MUTATE_MISSING the page was mounted without its writer');}})
      :h(SkillsTab,{t,skillsT:tSkills,panel:panel.skills,start:()=>start('skills'),mutate:typeof props.mutate==='function'?props.mutate:async()=>{throw failure('namespace','SUITE_MUTATE_MISSING the page was mounted without its writer');}}));
}

/**
 * Owns the two dictionaries, the token sheet, the Remote handle, one state object with both read chains,
 * and the sidebar + main registrations.
 *
 * Expected call (the Suite Client entry owns the mounting decision):
 *   applyToolsPanel(ctx,{mountError:()=>mountFailureOrNull})
 * with a context that declares slots and locale.
 */
export function applyToolsPanel(ctx,options={}){
  const mountError=typeof options.mountError==='function'?options.mountError:()=>null;
  const mountFact=()=>{
    try{
      const value=mountError();
      if(typeof value!=='string'||value.length===0)return null;
      return value;
    }catch(issue){return String(issue&&issue.message?issue.message:issue);}
  };

  ctx.effect(()=>ctx.locale.register(TOOLS_LOCALE_NS,{en,zh}),'omnisurge: tools locale dictionaries');
  ctx.effect(()=>ctx.locale.register(SKILLS_LOCALE_NS,{en:skillsEn,zh:skillsZh}),'omnisurge: skills locale dictionaries');
  ctx.effect(()=>{injectStyles();},'omnisurge: skills-mcp ui token sheet');

  // One state object created at registration, handed to the page through inject: the tab, each tab's last
  // good result, receipt, busy phase and failure fact. Switching tabs reads nothing; returning to a tab
  // reuses what this object already holds, and an application restart is the only reset.
  let disposed=false,revision=0;
  const listeners=new Set();
  const controllers=new Set();
  const panel={
    tab:'skills',
    skills:{data:null,complete:null,lastRead:null,phase:'idle',started:false,issue:null},
    mcp:{data:null,purposes:null,purposesIssue:null,lastRead:null,phase:'idle',started:false,issue:null},
  };
  const subscribe=listener=>{listeners.add(listener);return()=>{listeners.delete(listener);};};
  const getRevision=()=>revision;
  const notify=()=>{revision+=1;for(const listener of [...listeners])listener();};

  // The namespaced Remote is a service, not a field: it may be read only from a context that declares it.
  const wire={namespace:null};
  ctx.effect(()=>{
    const scoped=ctx.inject(NAMESPACE_INJECT,inner=>{
      wire.namespace=inner.remote.omnisurgeSuiteDev;
      return()=>{wire.namespace=null;};
    });
    return()=>{wire.namespace=null;void scoped.dispose();};
  },'omnisurge: hold the tools Remote namespace while the Host serves it');
  // Owner-level cancellation: a disabled or unloaded component stops its in-flight reads and keeps no timer.
  ctx.effect(()=>()=>{
    disposed=true;
    for(const controller of controllers)controller.abort();
    controllers.clear();
    listeners.clear();
  },'omnisurge: release the skills-mcp panel state');

  // One unary call: the documented RemoteResult envelope is the only answer shape. The three transport
  // facts stay distinct -- not mounted, carrier/owned-Remote failure, unreadable answer -- and a Host
  // refusal keeps its machine code for the raw disclosure instead of becoming prose.
  const callInternal=async(method,args,signal,timeoutMs=CLIENT_ACTION_TIMEOUT_MS)=>{
    const namespace=wire.namespace;
    if(!namespace||typeof namespace[method]!=='function'){
      const mount=mountFact();
      const message='SUITE_NAMESPACE_MISSING '+method+(mount!==null?' (owned Remote mount failed: '+mount+')':' (the Host namespace is not mounted in this window)');
      throw failure(mount===null?'namespace':'mount',message);
    }
    let result;
    try{result=await boundedRemoteCall(namespace,method,args,{timeoutMs,code:'SUITE_REMOTE_TIMEOUT',message:'SUITE_REMOTE_TIMEOUT '+method,signal});}
    catch(issue){
      if(issue instanceof RemoteTimeoutError)throw failure('timeout','SUITE_REMOTE_TIMEOUT '+method+' '+issue.code,'SUITE_REMOTE_TIMEOUT');
      throw failure('refused','SUITE_CARRIER_FAILED '+method+' \u2192 '+reason(issue));
    }
    return assertRemoteEnvelope(result,method,{
      onInvalid:()=>failure('answer','SUITE_RESULT_INVALID '+method+' did not answer a RemoteResult envelope'),
      onRefused:error=>{
        const code=codeOf(error);
        const refused=failure(code===null?'refused':refusalKind(code),'SUITE_HOST_REFUSED '+method+' \u2192 '+reason(error),code===null?undefined:code);
        // Machine-readable refusal details (RemoteError.details) stay structured for the sentence layer; the raw
        // disclosure keeps the Host's own diagnostic string.
        if(error&&error.details!==undefined&&error.details!==null)refused.details=error.details;
        return refused;
      },
    });
  };
  // Writes keep their natural duration: a restart or a profile mutation may legitimately outlive the read
  // budget. Only the page's reads (and the OAuth control plane) are bounded (P2-17).
  const call=(method,...args)=>callInternal(method,args,undefined,0);
  const readSkills=async signal=>{
    const value=await callInternal(SKILLS_METHOD,[{}],signal,CLIENT_READ_TIMEOUT_MS);
    if(!value||typeof value!=='object'||!Array.isArray(value.skills))throw failure('answer','SUITE_RESULT_INVALID '+SKILLS_METHOD+' answered without a skills array');
    const roots=value.roots!==null&&typeof value.roots==='object'?value.roots:{};
    return {skills:value.skills,complete:value.complete===true,roots:{
      ...(typeof roots.user==='string'&&roots.user.length>0?{user:roots.user}:{}),
      ...(typeof roots.project==='string'&&roots.project.length>0?{project:roots.project}:{}),
    }};
  };
  const readMcpServers=async signal=>{
    const value=await callInternal(MCP_METHOD,[],signal,CLIENT_READ_TIMEOUT_MS);
    if(!value||typeof value!=='object'||!Array.isArray(value.servers))throw failure('answer','SUITE_RESULT_INVALID '+MCP_METHOD+' answered without a servers array');
    const issue=value.issue&&typeof value.issue==='object'&&typeof value.issue.code==='string'
      ?{code:value.issue.code,raw:typeof value.issue.raw==='string'?value.issue.raw:''}
      :null;
    return {servers:value.servers,reload:value.reload==='live'?'live':'manual',authority:value.authority==='official'?'official':'unsupported',issue};
  };
  const readMcpPurposes=async signal=>{
    const value=await callInternal(MCP_PURPOSES_METHOD,[],signal,CLIENT_READ_TIMEOUT_MS);
    if(!value||typeof value!=='object'||typeof value.routing!=='boolean'||!Number.isFinite(value.revision)||!value.purposes||typeof value.purposes!=='object')throw failure('answer','SUITE_RESULT_INVALID '+MCP_PURPOSES_METHOD+' answered without a purpose snapshot');
    return {
      routing:value.routing,
      revision:value.revision,
      purposes:value.purposes,
      servers:Array.isArray(value.servers)?value.servers:[],
      unreadable:value.unreadable&&typeof value.unreadable==='object'?value.unreadable:null,
    };
  };
  /** One user-triggered MCP read: the server list and the purpose snapshot are independent facts, so a purpose
   * read that is refused keeps the list (and vice versa) instead of blanking the whole tab. */
  const readMcpTab=async signal=>{
    const servers=await readMcpServers(signal);
    try{return {servers,purposes:await readMcpPurposes(signal),purposesIssue:null};}
    catch(failed){return {servers,purposes:null,purposesIssue:failed&&failed.failure?failed.failure:{kind:'refused',raw:String(failed&&failed.message?failed.message:failed)}};}
  };

  /** One user-visible read chain per tab: in place, no polling, failure keeps the last good result. */
  const read=tab=>{
    const slot=panel[tab];
    if(disposed||slot===undefined||slot.phase==='loading')return;
    slot.started=true;
    slot.phase='loading';
    notify();
    const controller=new AbortController();
    controllers.add(controller);
    const settle=()=>{controllers.delete(controller);};
    const pending=tab==='skills'?readSkills(controller.signal):readMcpTab(controller.signal);
    pending.then(value=>{
      settle();
      if(disposed||controller.signal.aborted)return;
      if(tab==='skills'){slot.data={skills:value.skills,roots:value.roots};slot.complete=value.complete;}
      else{
        slot.data={servers:value.servers.servers,reload:value.servers.reload,authority:value.servers.authority,issue:value.servers.issue};
        slot.purposes=value.purposes;
        slot.purposesIssue=value.purposesIssue;
      }
      slot.issue=null;
      slot.lastRead=clock();
      slot.phase='idle';
      notify();
    },failed=>{
      settle();
      if(disposed||controller.signal.aborted)return;
      slot.issue=failed&&failed.failure?failed.failure:{kind:'refused',raw:String(failed&&failed.message?failed.message:failed)};
      slot.phase='idle';
      notify();
    });
  };

  const t=ctx.locale.bind(TOOLS_LOCALE_NS);
  const tSkills=ctx.locale.bind(SKILLS_LOCALE_NS);
  const face={panel,subscribe,getRevision,start:read,notify,tSkills,mutate:call};

  // One page entry and one sidebar cell under the same id; the shell owns the switch between them.
  ctx.effect(()=>ctx.slots.inject(MAIN_SLOT,()=>ctx.slots.register({
    name:MAIN_SLOT,
    key:TOOLS_PANEL_ID,
    locale:TOOLS_LOCALE_NS,
    inject:()=>face,
  },ToolsPanel)),'omnisurge: skills-mcp main panel');
  ctx.effect(()=>ctx.slots.inject(SIDEBAR_SLOT,()=>ctx.slots.register({
    name:SIDEBAR_SLOT,
    id:TOOLS_PANEL_ID,
    order:5,
    label:()=>t('nav'),
    locale:TOOLS_LOCALE_NS,
  },ToolsPanelIcon)),'omnisurge: skills-mcp sidebar entry');
}
