/** MCP server management tab for the Capabilities & Connections panel (ADR-025/032/046/052/094/095/122/123). Extracted per ADR-117 D4. */
import * as React from 'react';
import {ActionGroup,Badge,Banner,Button,CapsuleSwitch,Card,Drawer,EmptyState,Field,ListRow,NumberInput,Select,StatusLine,Switch,TextArea,TextInput,showConfirm,showToast} from '@omnisurge/dsh-ui';
import {fillTemplate as fill} from '../shared/client-copy.js';
import {DiagnosticDisclosure} from '../shared/DiagnosticDisclosure.js';
import {MCP_RUNTIME_KEYS,MCP_RUNTIME_TONES,MCP_STATE_KEYS,MCP_STATE_TONES,codeOf,failure,mcpActionSentence,mcpDraftInvalidSentence,mcpFormDirty,mcpMutationSentence,mcpProtocolOf,mcpPurposeRefreshable,mcpPurposeSentence,mcpSentence,mcpSourceKey,mutationRaw,pairList} from './client-format.js';
import {MCP_OAUTH_POLL_MS,mcpAuthorizationOf,mcpOauthPost,mcpOauthStatus,mcpOauthStatusOf,mcpOauthWaitBudgetMs,mcpRedactCode} from './oauth-control.js';

const h=React.createElement;
const MCP_PURPOSES_METHOD='readMcpPurposes';
const MCP_PURPOSE_WRITE='writeMcpPurpose';
const MCP_ROUTING_WRITE='setMcpRouting';
const MCP_PURPOSE_MAX=200;
function PencilIcon(){
  return h('svg',{xmlns:'http://www.w3.org/2000/svg',viewBox:'0 0 14 14',width:14,height:14,fill:'none',stroke:'currentColor',strokeWidth:1.4,strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':'true',focusable:'false','data-testid':'pencil-icon'},
    h('path',{d:'M2.2 11.8 L2.9 9.1 L9.4 2.6 L11.4 4.6 L4.9 11.1 Z'}),
    h('path',{d:'M8.9 3.1 L10.9 5.1'}));
}

/**
 * The MCP tab: two-card overview + unified server list (ADR-123) and Drawer form (ADR-125 D1).
 *
 * The 0.1.4/0.1.5 flat tool wall is gone (ADR-025 D4): hundreds of model-facing tool names had no reading
 * value. A row carries the server facts only — name (mono), transport, state and the number of tools the
 * server currently contributes. Row identity is the Loader/patch rowId, never a name parsed back out of a
 * public tool name (ADR-024 correction 2).
 *
 * Add and edit open a native right-hand Drawer (<Drawer size="lg" placement="right">) while keeping the
 * background overview and server list mounted underneath (with the edited row selected). Credential values
 * are write-only: the form starts from counts, never from plaintext, omits headers/env entirely unless the
 * user resets them, and a reset submits the complete list the user typed. Editing never shows or asks for the
 * row's plugin package — the Host derives that from the profile.
 */
export function McpTab(props){
  const t=props.t,slot=props.panel,start=props.start;
  const mutate=props.mutate;
  const busy=slot.phase==='loading';
  const catalog=slot.data;
  const servers=catalog!==null&&catalog!==undefined&&Array.isArray(catalog.servers)?catalog.servers:[];
  // A catalog that is absent, old, or explicitly unsupported is read-only: only the official manager is a
  // writable authority in 0.3.0 (ADR-095 D3).
  const authority=catalog!==null&&catalog!==undefined&&catalog.authority==='official'?'official':'unsupported';
  const unsupported=authority==='unsupported';
  const catalogIssue=catalog!==null&&catalog!==undefined&&catalog.issue&&typeof catalog.issue==='object'?catalog.issue:null;
  // F6 reuses the existing read-failure surface: a catalog issue is another read failure, not a new block.
  const failureIssue=slot.issue??(catalogIssue!==null?{kind:'catalog-unreadable',raw:catalogIssue.raw}:null);
  const sentence=mcpSentence(t,failureIssue);
  const receipt=slot.lastRead===null?null:h('span',{className:'omni-ui-hint','data-testid':'mcp-checked'},fill(t('checkedAt'),{time:slot.lastRead}));
  const [form,setForm]=React.useState(null);
  const [values,setValues]=React.useState(null);
  const [initialValues,setInitialValues]=React.useState(null);
  const [savePhase,setSavePhase]=React.useState('idle');
  const [saveIssue,setSaveIssue]=React.useState(null);
  const [actionIssue,setActionIssue]=React.useState(null);
  const [removing,setRemoving]=React.useState(null);
  const [toggling,setToggling]=React.useState(null);
  const [probing,setProbing]=React.useState(null);
  const [probeIssue,setProbeIssue]=React.useState(null);
  const [runtimeOverrides,setRuntimeOverrides]=React.useState({});
  // One OAuth session at a time: the pasted code lives here only until the submit succeeds, and a catalog read
  // (the page's own refresh) drops it rather than keeping a credential-shaped value in long-lived state.
  const [oauthSession,setOauthSession]=React.useState(null);
  // ADR-032: the Host owns the purpose snapshot; this page keeps only the edit buffer, the busy row and the
  // last refusal. A write answer replaces the local snapshot facts directly — the page never re-reads the disk.
  const [purposeSnapshot,setPurposeSnapshot]=React.useState(null);
  const purposeSnapshotRef=React.useRef(null);
  const [purposeEditing,setPurposeEditing]=React.useState(null);
  const [purposeDraft,setPurposeDraft]=React.useState('');
  const [purposeBusy,setPurposeBusy]=React.useState(null);
  const [purposeIssue,setPurposeIssue]=React.useState(null);
  const purposeRowRefs=React.useRef(new Map());
  const purposeFocusReturn=React.useRef(null);
  const confirmRef=React.useRef(null);
  const openerRef=React.useRef(null);
  const wasFormOpenRef=React.useRef(false);
  const onDirtyChangeRef=React.useRef(props.onDirtyChange);
  onDirtyChangeRef.current=props.onDirtyChange;
  const dirty=form!==null&&mcpFormDirty(values,initialValues);
  const formOpen=form!==null&&values!==null;
  React.useEffect(()=>{onDirtyChangeRef.current?.(dirty);},[dirty]);
  React.useEffect(()=>{
    if(formOpen){
      wasFormOpenRef.current=true;
      return;
    }
    if(!wasFormOpenRef.current)return;
    wasFormOpenRef.current=false;
    const opener=openerRef.current;
    openerRef.current=null;
    if(opener!==null&&opener.isConnected&&!opener.disabled&&typeof opener.focus==='function'){
      opener.focus({preventScroll:true});
    }
  },[formOpen]);
  // A probe result is the row's newest connection fact until the next list read replaces the catalog: keep the
  // override in immutable state, never by mutating the row object the registration store handed us.
  const catalogRef=React.useRef(catalog);
  // ADR-052 D3: one bounded timer owns the OAuth wait. The generation token makes every late answer
  // (a poll that was already in flight when the wait stopped) a no-op, so a cancelled, completed or
  // unmounted wait can neither schedule another read nor land a stale sentence or toast.
  const oauthPollTimer=React.useRef(null);
  const oauthPollToken=React.useRef(0);
  const oauthSessionRef=React.useRef(null);
  // The start request is the one OAuth step the page itself holds open: its controller is what makes the
  // starting state cancellable instead of a dead spinner (P2-20).
  const oauthStartAbort=React.useRef(null);
  React.useEffect(()=>{oauthSessionRef.current=oauthSession;},[oauthSession]);
  const stopOauthWait=()=>{
    oauthPollToken.current+=1;
    if(oauthPollTimer.current!==null){clearTimeout(oauthPollTimer.current);oauthPollTimer.current=null;}
  };
  // Leaving the tab/panel unmounts this component: a background poll must never outlive its page. Clearing the
  // timer is not enough — a read already in flight returns to a live closure whose session ref still points at
  // the old session, so it would schedule the next round for a page that no longer exists. Bumping the generation
  // is what turns that answer into a no-op (review B3).
  React.useEffect(()=>()=>{
    onDirtyChangeRef.current?.(false);
    stopOauthWait();
    if(oauthStartAbort.current!==null){oauthStartAbort.current.abort();oauthStartAbort.current=null;}
  },[]);
  // ADR-046 task-72: when a purpose editor closes, return keyboard focus to the value button that opened it.
  // The trigger is re-rendered by this same state transition, so the effect reads the row after commit.
  React.useEffect(()=>{
    const id=purposeFocusReturn.current;
    if(id===null||purposeEditing!==null)return;
    purposeFocusReturn.current=null;
    const row=purposeRowRefs.current.get(id);
    const button=row===undefined?null:row.querySelector('[data-testid="mcp-purpose-edit-'+id+'"]');
    if(button!==null&&typeof button.focus==='function')button.focus({preventScroll:true});
  },[purposeEditing]);
  React.useEffect(()=>{
    if(catalogRef.current!==catalog){
      catalogRef.current=catalog;
      setRuntimeOverrides({});
      // The row set changed underneath the wait, so the session it belonged to is gone with it.
      stopOauthWait();
      setOauthSession(null);
    }
  },[catalog]);
  React.useEffect(()=>{
    const answered=slot.purposes===undefined?null:slot.purposes;
    if(answered!==purposeSnapshotRef.current){
      purposeSnapshotRef.current=answered;
      setPurposeSnapshot(answered);
    }
  },[slot.purposes]);
  const runtimeOf=server=>Object.prototype.hasOwnProperty.call(runtimeOverrides,String(server.rowId))?runtimeOverrides[String(server.rowId)]:server.runtime;
  const hasRuntimeInfo=servers.length===0||servers.some(server=>{
    const rt=runtimeOf(server);
    return rt!==null&&rt!==undefined;
  });
  const connectedCount=servers.filter(server=>server.state==='running'&&runtimeOf(server)?.state==='connected').length;
  const runningCount=servers.filter(server=>server.state==='running').length;
  const toolCount=servers.reduce((total,server)=>total+(Number.isFinite(server.toolCount)?server.toolCount:0),0);
  const summary=catalog===null
    ?(busy?t('mcpReading'):t('summaryPending'))
    :catalogIssue!==null
      ?t('mcpCatalogSummaryUnreadable')
      :hasRuntimeInfo
        ?fill(t('mcpServersSummaryConnected'),{servers:servers.length,connected:connectedCount,tools:toolCount})
        :fill(t('mcpServersSummaryRunning'),{servers:servers.length,running:runningCount,tools:toolCount});
  // The local snapshot wins until the next Host read hands over a new object: a write answer is fresher than
  // the registration store's last read, and the sync effect above adopts every genuinely new read.
  const purposes=purposeSnapshot??slot.purposes;
  const purposesIssue=slot.purposesIssue??null;
  const purposesUnreadable=purposes!==null&&purposes.unreadable!==null&&purposes.unreadable!==undefined;
  const purposeTextOf=rowId=>purposes!==null&&purposes.purposes!==null&&typeof purposes.purposes[rowId]==='string'?purposes.purposes[rowId]:'';
  // A host confirm layer outlives this component; the owner closes it so a tab switch cannot leave it behind.
  React.useEffect(()=>()=>{if(confirmRef.current!==null){confirmRef.current.close();confirmRef.current=null;}},[]);
  const setValue=(key,value)=>setValues(current=>current===null?current:{...current,[key]:value});
  const updatePair=(kind,index,key,value)=>setValues(current=>current===null?current:{...current,[kind]:current[kind].map((pair,position)=>position===index?{...pair,[key]:value}:pair)});
  const addPair=kind=>setValues(current=>current===null?current:{...current,[kind]:[...current[kind],{key:'',value:''}]});
  const removePair=(kind,index)=>setValues(current=>current===null?current:{...current,[kind]:current[kind].filter((_,position)=>position!==index)});
  const closeForm=()=>{
    setForm(null);setValues(null);setInitialValues(null);setSaveIssue(null);setSavePhase('idle');
    onDirtyChangeRef.current?.(false);
  };
  const requestCloseForm=()=>{
    if(savePhase==='saving')return;
    if(!dirty){closeForm();return;}
    if(confirmRef.current!==null)confirmRef.current.close();
    confirmRef.current=showConfirm({
      title:t('unsavedTitle'),
      text:t('unsavedMcpText'),
      cancelLabel:t('keepEditing'),
      confirmLabel:t('discardChanges'),
      tone:'danger',
      onCancel:()=>{confirmRef.current=null;},
      onConfirm:()=>{confirmRef.current=null;closeForm();},
    });
  };
  const openAdd=event=>{
    openerRef.current=event?.currentTarget instanceof HTMLElement?event.currentTarget:null;
    setActionIssue(null);setSaveIssue(null);
    const snapshot={
      name:'',kind:'static',transport:'streamable-http',url:'',command:'',args:'',cwd:'',timeoutMs:'',
      staticClientId:'',authTimeoutMs:'',
      endpointOpen:true,
      // ADR-055: a fresh row starts with `failOnStartupError` on — a server that cannot start should say so on
      // the row instead of looking healthy with no tools.
      failOnStartupError:true,failDirty:false,
      // 新增的官方条目默认启用；编辑时才显示并只在改动后提交。
      enabled:true,enabledDirty:false,
      // ADR-055 tri-state: 'keep' sends nothing, 'clear' sends an empty list, 'replace' sends the typed rows.
      headersMode:'keep',envMode:'keep',headers:[{key:'',value:''}],env:[{key:'',value:''}],
    };
    setValues(snapshot);
    setInitialValues(snapshot);
    setForm({mode:'add',server:null});
  };
  const openEdit=(server,event)=>{
    openerRef.current=event?.currentTarget instanceof HTMLElement?event.currentTarget:null;
    setActionIssue(null);setSaveIssue(null);
    const snapshot={
      name:typeof server.name==='string'?server.name:'',
      // The kind is the row's own client fact; an edit never sends it, but the form reads it to decide whether
      // the transport may still be changed at all.
      kind:server.kind==='oauth'?'oauth':'static',
      transport:server.transport==='stdio'?'stdio':'streamable-http',
      // An HTTP endpoint is never echoed (a URL may carry a credential): the section starts collapsed and an
      // empty buffer submits nothing. A stdio launch line is *not* a secret (ADR-055), so a stdio row echoes
      // its command, arguments and working directory — that is the only way the user can see what is configured.
      url:'',command:typeof server.command==='string'?server.command:'',
      args:Array.isArray(server.args)?server.args.join('\n'):'',
      cwd:typeof server.cwd==='string'?server.cwd:'',
      timeoutMs:'',
      staticClientId:typeof server.staticClientId==='string'?server.staticClientId:'',
      authTimeoutMs:typeof server.authorizationTimeoutMs==='number'?String(server.authorizationTimeoutMs):'',
      // A stdio row arrives with its launch line already filled in, so the section opens where the values are.
      endpointOpen:false,
      failOnStartupError:typeof server.failOnStartupError==='boolean'?server.failOnStartupError:false,failDirty:false,
      enabled:server.enabled!==false,enabledDirty:false,
      headersMode:'keep',envMode:'keep',headers:[{key:'',value:''}],env:[{key:'',value:''}],
    };
    setValues(snapshot);
    setInitialValues(snapshot);
    setForm({mode:'edit',server});
  };
  const buildDraft=()=>{
    const draft={name:String(values.name).trim()};
    // ADR-033 D1: the kind picks which carried client the Host writes; an edit keeps the row's existing client
    // and its transport, so neither key is named by an edit — the row is the fact (0.2.0-5 key-set rule).
    if(form.mode==='add'){draft.kind=values.kind==='oauth'?'oauth':'static';draft.transport=values.transport;}
    else if(form.server!==null&&values.transport!==(form.server.transport==='stdio'?'stdio':'streamable-http')){
      // R5: the edit form offers a transport switch for rows whose client allows it, but the draft used to omit
      // the changed transport and the Host kept the stored one. Name it only when the user actually changed it.
      draft.transport=values.transport;
    }
    // A collapsed endpoint sends no url/command/args/cwd, so the Host keeps the existing values untouched.
    if(form.mode==='add'||values.endpointOpen){
      // "Blank submits nothing": an opened-but-empty endpoint field keeps the existing endpoint instead of
      // overwriting it with an empty string (the same rule the credential blocks follow).
      if(values.transport==='streamable-http'){
        const url=String(values.url).trim();
        if(url.length>0)draft.url=url;
      }else{
        const command=String(values.command).trim();
        if(command.length>0)draft.command=command;
        const args=String(values.args).split('\n').map(line=>line.trim()).filter(line=>line.length>0);
        if(args.length>0)draft.args=args;
        const cwd=String(values.cwd).trim();
        if(cwd.length>0)draft.cwd=cwd;
      }
    }
    const timeoutText=String(values.timeoutMs).trim();
    if(timeoutText.length>0){
      const timeout=Number(timeoutText);
      if(Number.isFinite(timeout)&&timeout>0)draft.toolCallTimeoutMs=timeout;
    }
    // An untouched switch must not overwrite a value this page cannot see; only a known or user-set value is sent.
    // 官方目标（新增 static 落 config.servers，或编辑 managed 行）没有该字段，连草稿都不命名。
    const officialTarget=form.mode==='add'
      ?(authority==='official'&&values.kind!=='oauth')
      :form.server!==null&&form.server.managed===true;
    if(!officialTarget&&(form.mode==='add'||values.failDirty||typeof form.server?.failOnStartupError==='boolean'))draft.failOnStartupError=values.failOnStartupError;
    // 官方条目的 durable enabled：只在用户动过开关时命名，避免把未见的并发改动写回去。
    if(form.mode==='edit'&&form.server!==null&&form.server.managed===true&&values.enabledDirty)draft.enabled=values.enabled;
    // ADR-055 tri-state, one rule for both fields: 'keep' names nothing (the Host leaves the stored object
    // alone), 'clear' names an empty list (the Host writes `{}`), 'replace' names exactly the typed rows.
    // A named empty list means *clear*, so 'replace' with every row blank is the same request as 'clear'.
    for(const kind of ['headers','env']){
      if(values.kind==='oauth')continue;
      const mode=values[kind+'Mode'];
      if(mode==='clear')draft[kind]=[];
      else if(mode==='replace')draft[kind]=pairList(values[kind]);
    }
    // OAuth-only optional facts (0.2.0-5): a pre-registered client ID for services without dynamic registration,
    // and how long the client waits for the browser authorization. "Naming is changing": a blank field is not a
    // value, and in an edit an unchanged field is not named either — the Host keeps what it already stored.
    if(values.kind==='oauth'){
      const knownClientId=form.mode==='edit'&&form.server!==null&&typeof form.server.staticClientId==='string'?form.server.staticClientId:'';
      const clientId=String(values.staticClientId).trim();
      if(clientId.length>0&&clientId!==knownClientId)draft.staticClientId=clientId;
      const knownAuthTimeout=form.mode==='edit'&&form.server!==null&&typeof form.server.authorizationTimeoutMs==='number'?String(form.server.authorizationTimeoutMs):'';
      const authText=String(values.authTimeoutMs).trim();
      if(authText.length>0){
        // The page decides only "blank = unnamed". A non-blank value travels as the user typed it: numeric text as
        // a number (0/negative/out-of-range included), anything else verbatim, so the Host's own validation
        // answers with a readable mcp/draft-invalid instead of the page silently dropping the input.
        const authNumber=Number(authText);
        const authValue=Number.isFinite(authNumber)?authNumber:authText;
        if(knownAuthTimeout===''||String(authValue)!==knownAuthTimeout)draft.authorizationTimeoutMs=authValue;
      }
    }
    return draft;
  };
  const announce=(mutation,fallbackName,actionKey,tone)=>{
    const action=t(actionKey);
    const state=mutation&&mutation.applied==='live'?t('mcpApplied'):t('mcpPending');
    const name=mutation&&typeof mutation.name==='string'?mutation.name:String(fallbackName);
    showToast({text:fill(t('mutationToast'),{action,state,name}),kind:'mcp-mutation',...(tone===undefined?{}:{tone}),closeLabel:t('closeToast')});
  };
  const submit=async()=>{
    if(savePhase==='saving'||form===null)return;
    setSavePhase('saving');setSaveIssue(null);
    try{
      const draft=buildDraft();
      const mutation=form.mode==='add'
        ?await mutate('addMcpServer',draft)
        :await mutate('updateMcpServer',String(form.server.rowId),draft);
      announce(mutation,values.name,form.mode==='add'?'mcpAdded':'mcpUpdated',mutation?.applied==='live'?'ok':'neutral');
      closeForm();
      start();
    }catch(failed){
      setSaveIssue({sentence:mcpDraftInvalidSentence(t,failed)??mcpMutationSentence(t,failed),raw:mutationRaw(failed)});
    }finally{
      setSavePhase('idle');
    }
  };
  const remove=async server=>{
    setActionIssue(null);setRemoving(String(server.rowId));
    try{
      const mutation=await mutate('removeMcpServer',String(server.rowId));
      announce(mutation,server.name,'mcpRemoved',mutation&&mutation.applied==='live'?'ok':'warn');
      start();
    }catch(failed){
      setActionIssue({sentence:mcpMutationSentence(t,failed),raw:mutationRaw(failed)});
    }finally{
      setRemoving(null);
    }
  };
  const setServerEnabled=async(server,enabled)=>{
    const id=String(server.rowId);
    if(toggling!==null||removing!==null)return;
    setActionIssue(null);setToggling(id);
    try{
      const mutation=await mutate('setMcpServerEnabled',id,enabled);
      announce(mutation,server.name,enabled?'mcpEnable':'mcpDisable',mutation&&mutation.applied==='live'?'ok':'warn');
      start();
    }catch(failed){
      setActionIssue({sentence:mcpMutationSentence(t,failed),raw:mutationRaw(failed)});
    }finally{
      setToggling(null);
    }
  };
  const probe=async server=>{
    const id=String(server.rowId);
    if(probing!==null)return;
    setProbeIssue(null);setProbing(id);
    try{
      const result=await mutate('probeMcpServer',id);
      const runtime=result!==null&&typeof result==='object'&&result.runtime!==null&&typeof result.runtime==='object'?result.runtime:null;
      setRuntimeOverrides(current=>({...current,[id]:runtime}));
      if(runtime===null){
        showToast({text:t('mcpProbeNoAnswer'),kind:'mcp-probe',closeLabel:t('closeToast')});
      }else{
        const key=MCP_RUNTIME_KEYS.get(runtime.state)??'mcpRuntimeNotConnected';
        showToast({text:fill(t('mcpProbeDone'),{state:t(key)}),kind:'mcp-probe',...(runtime.state==='connected'?{tone:'ok'}:{}),closeLabel:t('closeToast')});
      }
    }catch(failed){
      setProbeIssue({sentence:mcpActionSentence(t,failed,'mcpProbeFailed'),raw:mutationRaw(failed)});
    }finally{
      setProbing(null);
    }
  };
  /** ADR-052 D3: the wait is observed by a bounded poll of the read-only status, never by holding the login
   * request open. Each scheduled read carries the generation token, so a cancelled or completed wait cannot land
   * a stale sentence, toast or extra read. */
  const startOauthWait=(rowId,serverName,authorizationTimeoutMs)=>{
    stopOauthWait();
    const token=oauthPollToken.current;
    // ADR-052 D3: the budget is the row's own authorization timeout, not a fixed number of ticks. A row may be
    // configured up to 600000 ms, and a page that gave up after a hard-coded 300 s would stop watching while the
    // Host was still waiting — leaving the row busy with no cancel button and no poll (review S1).
    const deadline=Date.now()+mcpOauthWaitBudgetMs({authorizationTimeoutMs});
    let attempts=0;
    const expired=()=>Date.now()>=deadline;
    const schedule=()=>{
      oauthPollTimer.current=setTimeout(()=>{
        oauthPollTimer.current=null;
        void (async()=>{
          if(oauthPollToken.current!==token)return;
          attempts+=1;
          let view=null;
          let unreadable=null;
          try{view=await mcpOauthStatus(serverName);}catch(failed){unreadable=mutationRaw(failed);}
          if(oauthPollToken.current!==token)return;
          const current=oauthSessionRef.current;
          if(current===null||current.rowId!==rowId)return;
          if(unreadable!==null){
            // A read that failed is not a finished wait: one unreadable answer is retried inside the same budget,
            // and only the budget running out turns it into the row's sentence.
            if(expired()){
              setOauthSession(value=>value===null?value:{...value,waiting:false,phase:null,issue:{sentence:t('mcpOauthWaitUnreadable'),raw:unreadable}});
              return;
            }
            schedule();
            return;
          }
          const authorization=mcpAuthorizationOf(view);
          const status=mcpOauthStatusOf(view);
          if(status==='connected'){
            stopOauthWait();
            setOauthSession(null);
            showToast({text:t('mcpOauthConnected'),kind:'mcp-oauth',tone:'ok',closeLabel:t('closeToast')});
            start();
            return;
          }
          if(authorization.state==='waiting'&&!expired()){schedule();return;}
          stopOauthWait();
          setOauthSession(value=>value===null?value:{...value,waiting:false,phase:null,issue:{
            sentence:t(authorization.state==='waiting'?'mcpOauthWaitTimeout':'mcpOauthIncomplete'),
            raw:'OAUTH_CONTROL status='+status+' authorization='+authorization.state+' attempts='+attempts}});
        })();
      },MCP_OAUTH_POLL_MS);
    };
    schedule();
  };
  const startOauthLogin=async(server,replaceFailed=false)=>{
    const id=String(server.rowId);
    const serverName=String(server.name);
    // One interaction at a time: while a session exists (starting, waiting, awaiting the code, submitting,
    // signing out) the page never starts a second control-plane interaction unless retrying a failed session.
    if(oauthSession!==null&&!(replaceFailed&&oauthSession.rowId===id&&oauthSession.phase===null&&oauthSession.issue!==null))return;
    stopOauthWait();
    setOauthSession({rowId:id,serverName,authorizationUrl:null,prefer:null,waiting:false,code:'',phase:'starting',issue:null});
    const controller=new AbortController();
    oauthStartAbort.current=controller;
    try{
      // ADR-052 D1/D3: ask for the auto flow and defer the wait. The Host resolves auto to loopback on a GUI
      // platform (it opens the listener and the browser) and answers at once; only a no-GUI host resolves to
      // paste, and only then does this page offer the code box.
      const view=await mcpOauthPost(serverName,'login',{prefer:'auto',deferWait:true},{signal:controller.signal});
      const authorization=mcpAuthorizationOf(view);
      if(authorization.authorizationUrl===null)throw failure('answer','OAUTH_CONTROL login answered without an authorizationUrl');
      const waiting=authorization.state==='waiting';
      setOauthSession({rowId:id,serverName,authorizationUrl:authorization.authorizationUrl,prefer:authorization.prefer,waiting,code:'',phase:null,issue:null});
      if(waiting)startOauthWait(id,serverName,server.authorizationTimeoutMs);
    }catch(failed){
      if(controller.signal.aborted)return;
      const sentence=codeOf(failed)==='OAUTH_CONTROL_TIMEOUT'?t('mcpOauthTimeout'):t('mcpOauthLoginFailed');
      setOauthSession({rowId:id,serverName,authorizationUrl:null,prefer:null,waiting:false,code:'',phase:null,issue:{sentence,raw:mutationRaw(failed)}});
    }finally{
      if(oauthStartAbort.current===controller)oauthStartAbort.current=null;
    }
  };
  const copyOauthLink=async url=>{
    if(typeof navigator!=='undefined'&&navigator.clipboard&&typeof navigator.clipboard.writeText==='function'){
      try{
        await navigator.clipboard.writeText(url);
        showToast({text:t('mcpOauthLinkCopied'),kind:'mcp-oauth-copy',tone:'ok',closeLabel:t('closeToast')});
      }catch{
        // Clipboard access was refused; do not claim success.
      }
    }
  };
  const openOauthUrl=url=>{
    if(typeof window!=='undefined'&&typeof window.open==='function'){
      window.open(url,'_blank','noopener,noreferrer');
    }
  };
  /** ADR-052 D2: cancel ends the Host's wait (it closes the loopback listener and writes the tombstone) and the
   * row returns to an actionable needs_login. The button never guesses: a refusal is shown with its raw reason. */
  const cancelOauthLogin=async()=>{
    const session=oauthSession;
    if(session===null||(session.phase!==null&&session.phase!=='starting'))return;
    // While the start request is still the only thing this page holds, cancelling aborts it locally and
    // clears the session; there is no server-side wait to end yet, so the user gets an immediate retry path.
    if(session.phase==='starting'){
      if(oauthStartAbort.current!==null){oauthStartAbort.current.abort();oauthStartAbort.current=null;}
      setOauthSession(null);
      showToast({text:t('mcpOauthCancelled'),kind:'mcp-oauth',closeLabel:t('closeToast')});
      return;
    }
    setOauthSession({...session,phase:'cancelling',issue:null});
    stopOauthWait();
    try{
      await mcpOauthPost(session.serverName,'cancel',{});
      setOauthSession(null);
      showToast({text:t('mcpOauthCancelled'),kind:'mcp-oauth',closeLabel:t('closeToast')});
      start();
    }catch(failed){
      setOauthSession(current=>current===null?current:{...current,phase:null,waiting:false,issue:{sentence:t('mcpOauthCancelFailed'),raw:mutationRaw(failed)}});
    }
  };
  const submitOauthCode=async()=>{
    const session=oauthSession;
    if(session===null||session.phase!==null)return;
    const code=String(session.code).trim();
    if(code.length===0)return;
    setOauthSession({...session,phase:'submitting',issue:null});
    try{
      await mcpOauthPost(session.serverName,'submit',{code});
      // The code is dropped with the session: success is the only moment the page still held it.
      setOauthSession(null);
      showToast({text:t('mcpOauthSubmitted'),kind:'mcp-oauth',tone:'ok',closeLabel:t('closeToast')});
      start();
    }catch(failed){
      const raw=mcpRedactCode(mutationRaw(failed),code);
      setOauthSession(current=>current===null?current:{...current,phase:null,issue:{sentence:t('mcpOauthSubmitFailed'),raw}});
    }
  };
  const logoutOauth=async server=>{
    const id=String(server.rowId);
    if(oauthSession!==null)return;
    setOauthSession({rowId:id,serverName:String(server.name),authorizationUrl:null,code:'',phase:'logging-out',issue:null});
    try{
      await mcpOauthPost(String(server.name),'logout',{});
      setOauthSession(null);
      showToast({text:t('mcpOauthLoggedOut'),kind:'mcp-oauth',tone:'ok',closeLabel:t('closeToast')});
      start();
    }catch(failed){
      setOauthSession({rowId:id,serverName:String(server.name),authorizationUrl:null,code:'',phase:null,issue:{sentence:t('mcpOauthLogoutFailed'),raw:mutationRaw(failed)}});
    }
  };
  /** A write answer carries the new snapshot facts; apply them instead of guessing or re-reading. */
  const applyPurposeFacts=value=>{
    if(!value||typeof value!=='object')return;
    const next={
      routing:value.routing===true,
      revision:Number.isFinite(value.revision)?value.revision:(purposes!==null?purposes.revision:0),
      purposes:value.purposes&&typeof value.purposes==='object'?value.purposes:{},
      servers:purposes!==null&&Array.isArray(purposes.servers)?purposes.servers:[],
      unreadable:null,
    };
    purposeSnapshotRef.current=next;
    setPurposeSnapshot(next);
  };
  /** Conflict and unknown-key answers name a stale revision: ask the Host for the current snapshot (still the
   * in-memory one), never re-read the file. */
  const reloadPurposes=async()=>{
    try{
      const value=await mutate(MCP_PURPOSES_METHOD);
      if(!value||typeof value!=='object'||typeof value.routing!=='boolean')throw failure('answer','SUITE_RESULT_INVALID '+MCP_PURPOSES_METHOD+' answered without a purpose snapshot');
      purposeSnapshotRef.current=value;
      setPurposeSnapshot(value);
    }catch(failed){
      setPurposeIssue({sentence:t('mcpPurposeReadFailed'),raw:mutationRaw(failed)});
    }
  };
  const savePurpose=async(rowId,explicit)=>{
    if(unsupported||purposes===null||purposesUnreadable||purposeBusy!==null)return;
    const purpose=(explicit===undefined?String(purposeDraft):String(explicit)).trim();
    setPurposeBusy(rowId);setPurposeIssue(null);
    try{
      const value=await mutate(MCP_PURPOSE_WRITE,{rowId,purpose,expectedRevision:purposes.revision});
      applyPurposeFacts(value);
      setPurposeEditing(null);setPurposeDraft('');
      showToast({text:purpose.length===0?t('mcpPurposeCleared'):t('mcpPurposeSaved'),kind:'mcp-purpose',tone:'ok',closeLabel:t('closeToast')});
    }catch(failed){
      if(mcpPurposeRefreshable(failed))await reloadPurposes();
      setPurposeIssue({rowId,sentence:mcpPurposeSentence(t,failed),raw:mutationRaw(failed)});
    }finally{setPurposeBusy(null);}
  };
  const saveRouting=async next=>{
    if(unsupported||purposes===null||purposesUnreadable||purposeBusy!==null)return;
    setPurposeBusy('routing');setPurposeIssue(null);
    try{
      // An explicit off is the routing:false fact; nothing else in the section changes.
      const value=await mutate(MCP_ROUTING_WRITE,{routing:next===true,expectedRevision:purposes.revision});
      applyPurposeFacts(value);
      showToast({text:t('mcpRoutingSaved'),kind:'mcp-routing',tone:'ok',closeLabel:t('closeToast')});
    }catch(failed){
      if(mcpPurposeRefreshable(failed))await reloadPurposes();
      setPurposeIssue({sentence:mcpPurposeSentence(t,failed),raw:mutationRaw(failed)});
    }finally{setPurposeBusy(null);}
  };
  const askRemove=server=>{
    if(confirmRef.current!==null)confirmRef.current.close();
    confirmRef.current=showConfirm({
      title:t('mcpDeleteTitle'),
      text:fill(t('mcpDeleteTextProfile'),{name:String(server.name)}),
      cancelLabel:t('cancel'),
      confirmLabel:t('remove'),
      tone:'danger',
      onCancel:()=>{confirmRef.current=null;},
      onConfirm:()=>{confirmRef.current=null;void remove(server);},
    });
  };
  const askDisable=server=>{
    if(confirmRef.current!==null)confirmRef.current.close();
    confirmRef.current=showConfirm({
      title:t('mcpDisableTitle'),
      text:fill(t('mcpDisableTextLoaded'),{name:String(server.name)}),
      cancelLabel:t('cancel'),
      confirmLabel:t('mcpDisableConfirm'),
      tone:'danger',
      onCancel:()=>{confirmRef.current=null;},
      onConfirm:()=>{confirmRef.current=null;void setServerEnabled(server,false);},
    });
  };
  const row=server=>{
    const id=String(server.rowId);
    // ADR-122 D2/ADR-095 F2a: only a Suite bundle-provided MCP row gets the row-level toggle; official-client
    // static rows and non-Suite clients stay read-only even when the Loader lists them outside insert rows.
    // Non-MCP rows never reach the page because readMcpServers requires a resolvable MCP serverName.
    const loaded=server.origin==='loaded'&&server.clientSource==='suite';
    const disabled=server.state==='disabled';
    const runtime=runtimeOf(server);
    const transport=server.transport==='streamable-http'?t('mcpTransportHttp'):server.transport==='stdio'?t('mcpTransportStdio'):String(server.transport);
    const kindWord=server.kind==='oauth'?t('mcpKindOauth'):t('mcpKindStatic');
    // Connection state replaces the Loader word only while the row is actually running/failed and the client
    // published a status face; a disabled/pending row keeps the four Loader words and shows no connection state.
    const connected=(server.state==='running'||server.state==='failed')&&runtime!==null&&runtime!==undefined;
    const stateKey=MCP_STATE_KEYS.get(server.state);
    let stateWord;
    let stateTone;
    if(connected){
      if(server.state==='failed'){
        // ADR-034 D3: a failed row says it failed. A stale status face (e.g. still 'connected' from before the
        // failure) must not re-word the row as healthy — one fact, one word.
        stateTone='err';
        stateWord=t('mcpRuntimeFailed');
      }else{
        stateTone=MCP_RUNTIME_TONES.get(runtime.state)??'warn';
        // The connection word never carries a count: the row keeps exactly one tool count, the Loader badge below.
        stateWord=t(MCP_RUNTIME_KEYS.get(runtime.state)??'mcpRuntimeNotConnected');
      }
    }else{
      stateWord=stateKey===undefined?String(server.state):t(stateKey);
      stateTone=MCP_STATE_TONES.get(server.state)??'muted';
    }
    const protocol=mcpProtocolOf({...server,runtime});
    const count=Number.isFinite(server.toolCount)?server.toolCount:0;
    // Whether a row can run a user-triggered check is a Host fact (control face + HTTP row + loopback available).
    const probeable=server.probeAvailable===true;
    // One session belongs to one row: the paste panel and its busy states only render on the row that started it.
    const oauthRow=server.kind==='oauth';
    // The five OAuth controls are addressed by serverName (the G5 contract), not by the profile row id.
    const serverName=String(server.name);
    const session=oauthSession!==null&&oauthSession.rowId===id?oauthSession:null;
    const sessionBusy=session!==null&&session.phase!==null;
    const detail=[];
    // Only a running row can be missing its connection fact; a failed row already says 启动失败 and must not stack
    // a second failure-flavoured line on top (ADR-031 D4).
    if(connected&&runtime.state==='failed'&&typeof runtime.error==='string'&&runtime.error.length>0){
      detail.push(h(DiagnosticDisclosure,{key:'runtime-raw',testId:'mcp-runtime-raw-'+id,title:t('rawDetails'),text:runtime.error}));
    }
    if(session!==null&&session.phase==='starting'){
      detail.push(h(Card,{key:'oauth-starting',as:'div',variant:'subtle','data-testid':'mcp-login-starting-'+serverName},
        h(StatusLine,{tone:'loading',role:'status','data-testid':'mcp-login-starting-status-'+serverName},t('mcpOauthStarting')),
        h(ActionGroup,{align:'start'},
          h(Button,{variant:'ghost',size:'sm',onClick:()=>{void cancelOauthLogin();},'data-testid':'mcp-login-cancel-'+serverName},t('mcpOauthCancel')))));
    }
    if(session!==null&&session.authorizationUrl!==null){
      const pasteOnly=session.prefer==='paste';
      detail.push(h(Card,{key:'oauth-panel',as:'div',variant:'subtle','data-testid':'mcp-login-panel-'+serverName},
        // ADR-052 D1/D3: the wait is the default. The sentence states what the page is doing (it checks by
        // itself) so the user is not told to paste a code that only the no-GUI downgrade ever asks for.
        session.waiting?h(StatusLine,{tone:'loading',role:'status','data-testid':'mcp-login-waiting-'+serverName},t('mcpOauthWaiting'))
          :pasteOnly?null
          :h('p',{className:'omni-ui-hint'},t('mcpOauthWaitingHint')),
        session.waiting?h('p',{className:'omni-ui-hint'},t('mcpOauthWaitingHint')):null,
        pasteOnly?h('p',{className:'omni-ui-hint'},t('mcpOauthPasteHint')):null,
        // The authorization URL is a real link (new window), paired with open & copy actions inside the subtle card.
        h('a',{href:session.authorizationUrl,target:'_blank',rel:'noreferrer',className:'omni-ui-oauthUrl','data-testid':'mcp-login-url-'+serverName},session.authorizationUrl),
        // The code box is the documented no-GUI downgrade only: with a live loopback wait there is nothing to paste.
        pasteOnly?h(Field,{label:t('mcpOauthCodeLabel'),hint:t('mcpOauthCodeHint')},
          h(TextInput,{name:'oauthCode',autoComplete:'off',className:'omni-ui-mono',value:session.code,disabled:sessionBusy,onChange:event=>setOauthSession(current=>current===null?current:{...current,code:event.target.value}),'data-testid':'mcp-login-code-'+serverName})):null,
        h(ActionGroup,{align:'start'},
          h(Button,{variant:'default',size:'sm',onClick:()=>{openOauthUrl(session.authorizationUrl);},'data-testid':'mcp-login-open-'+serverName},t('mcpOauthOpen')),
          h(Button,{variant:'default',size:'sm',onClick:()=>{void copyOauthLink(session.authorizationUrl);},'data-testid':'mcp-login-copy-'+serverName},t('mcpOauthCopyLink')),
          session.waiting?h(Button,{variant:'ghost',size:'sm',busy:session.phase==='cancelling',disabled:sessionBusy&&session.phase!=='cancelling',onClick:()=>{void cancelOauthLogin();},'data-testid':'mcp-login-cancel-'+serverName},t('mcpOauthCancel')):null,
          pasteOnly?h(Button,{variant:'primary',size:'sm',busy:session.phase==='submitting',disabled:sessionBusy||String(session.code).trim().length===0,onClick:()=>{void submitOauthCode();},'data-testid':'mcp-login-submit-'+serverName},t('mcpOauthSubmit')):null)));
    }
    if(session!==null&&session.issue!==null){
      detail.push(h(Card,{key:'oauth-issue',as:'div',variant:'subtle','data-testid':'mcp-login-failure-'+serverName},
        h(StatusLine,{tone:'err',role:'alert','data-testid':'mcp-login-error-'+serverName},session.issue.sentence),
        h(DiagnosticDisclosure,{testId:'mcp-login-raw-'+serverName,title:t('rawDetails'),text:session.issue.raw}),
        h(ActionGroup,{align:'start'},
          h(Button,{variant:'default',size:'sm',onClick:()=>{void startOauthLogin(server,true);},'data-testid':'mcp-login-retry-'+serverName},t('mcpOauthRetry')),
          h(Button,{variant:'ghost',size:'sm',onClick:()=>{stopOauthWait();setOauthSession(null);},'data-testid':'mcp-login-dismiss-'+serverName},t('mcpOauthDismiss')))));
    }
    // ADR-032: the purpose is one line per row. It renders once — either the stored value or the edit buffer —
    // and it renders at all only while the snapshot is readable. A broken or absent snapshot is not "no purpose":
    // the file cannot be trusted, so the row shows nothing here and the panel states the reason once, above.
    const purposeReadable=purposes!==null&&!purposesUnreadable&&!unsupported;
    const purposeText=purposeTextOf(id);
    const startPurposeEdit=()=>{
      if(unsupported||purposeBusy!==null)return;
      purposeFocusReturn.current=id;
      setPurposeEditing(id);setPurposeDraft(purposeText);
    };
    // ADR-046 / task-74: the design draft's "click anywhere on this row to start filling" is a pointer shortcut.
    // It is deliberately not a control: the row stays out of the tab order and the value button remains the only
    // keyboard path. Clicks inside an interactive child — row actions, nested OAuth card, a link/code box, a
    // switch label or a disclosure — keep their own behaviour and never open the purpose editor.
    const purposeRowClick=purposeReadable?event=>{
      if(purposeEditing!==null||purposeBusy!==null)return;
      const target=event.target;
      if(target===null||typeof target.closest!=='function')return;
      const nestedCard=target.closest('.omni-ui-card');
      if(nestedCard!==null&&event.currentTarget.contains(nestedCard))return;
      const control=target.closest('button,a,input,select,textarea,label,summary,details,[role="button"],[role="tab"],[contenteditable="true"],.omni-ui-inlineEdit,.omni-ui-listActions,.omni-ui-disclosure,.omni-ui-card--subtle');
      if(control!==null)return;
      startPurposeEdit();
    }:undefined;
    if(purposeReadable){
      const purposeHere=purposeEditing===id;
      // 可见文案只算一次：可访问名必须**包含**可见标签（WCAG 2.5.3），所以两者由同一个串派生。
      const purposeShown=fill(t('mcpPurposeLine'),{text:purposeText.length>0?purposeText:t('mcpPurposeUnfilled')});
      detail.push(h('div',{key:'purpose',ref:node=>{if(node===null)purposeRowRefs.current.delete(id);else purposeRowRefs.current.set(id,node);},className:'omni-ui-stack','data-testid':'mcp-purpose-'+id},
        purposeHere
          ?h(React.Fragment,null,
            h(Field,{label:t('mcpPurpose'),hint:t('mcpPurposeHint'),counter:purposeDraft.length+'/'+MCP_PURPOSE_MAX},
              h(TextInput,{
                name:'purpose',
                autoComplete:'off',
                autoFocus:true,
                maxLength:MCP_PURPOSE_MAX,
                value:purposeDraft,
                disabled:purposeBusy!==null,
                onChange:event=>setPurposeDraft(event.target.value),
                onKeyDown:event=>{
                  if(event.key==='Enter'&&!event.nativeEvent?.isComposing){
                    event.preventDefault();
                    void savePurpose(id);
                  }else if(event.key==='Escape'){
                    event.preventDefault();
                    setPurposeEditing(null);
                    setPurposeDraft('');
                  }
                },
                'data-testid':'mcp-purpose-input-'+id,
              })),
            h(ActionGroup,{align:'start'},
              h(Button,{variant:'primary',size:'sm',busy:purposeBusy===id,disabled:purposeBusy!==null,onClick:()=>{void savePurpose(id);},'data-testid':'mcp-purpose-save-'+id},t('save')),
              purposeText.length>0?h(Button,{variant:'ghost',size:'sm',disabled:purposeBusy!==null,onClick:()=>{void savePurpose(id,'');},'data-testid':'mcp-purpose-clear-'+id},t('mcpPurposeClear')):null,
              h(Button,{variant:'ghost',size:'sm',disabled:purposeBusy!==null,onClick:()=>{setPurposeEditing(null);setPurposeDraft('');},'data-testid':'mcp-purpose-cancel-'+id},t('cancel'))))
          :h('div',{className:'omni-ui-valueLine','data-testid':'mcp-purpose-line-'+id},
            h(Button,{
              variant:'link',
              className:'omni-ui-valueText',
              'data-testid':'mcp-purpose-edit-'+id,
              'aria-label':fill(t('mcpPurposeEditValue'),{text:purposeShown}),
              onClick:startPurposeEdit,
            },h('span',{'data-testid':'mcp-purpose-text-'+id},purposeShown)),
            // 铅笔是**装饰**：22×22 的 span（不是 button），既没有第二套语义，也不会进 tab 顺序，
            // 更不会和 `.omni-ui-iconBtn` 抢同一组 width/height 声明（0.2.0-9 第 5 轮审查 B2）。鼠标点它等于点值。
            // 触屏没有 hover，所以由 `@media (hover:none)` 让它常显；键盘用值按钮。
            h('span',{className:'omni-ui-inlineEdit'},h('span',{
              className:'omni-ui-pencilBtn',
              'data-testid':'mcp-purpose-pencil-'+id,
              'aria-hidden':'true',
              onClick:startPurposeEdit,
            },PencilIcon())))));
    }
    if(purposeIssue!==null&&purposeIssue.rowId===id){
      detail.push(h('div',{key:'purpose-issue',className:'omni-ui-stack','data-testid':'mcp-purpose-failure-'+id},
        h(StatusLine,{tone:'err',role:'alert','data-testid':'mcp-purpose-error-'+id},purposeIssue.sentence),
        h(DiagnosticDisclosure,{testId:'mcp-purpose-raw-'+id,title:t('rawDetails'),text:purposeIssue.raw})));
    }
    // One grey line instead of five chips; each fact keeps its own testid so the gates can still read it.
    const sourceKey=mcpSourceKey(server,loaded);
    const mcpMeta=()=>{
      const parts=[
        h('span',{key:'transport','data-testid':'mcp-transport-'+id},transport),
        h('span',{key:'kind','data-testid':'mcp-kind-'+id},kindWord),
      ];
      if(protocol!==null)parts.push(h('span',{key:'protocol','data-testid':'mcp-protocol-'+id},t(protocol.key)));
      // ADR-046 task-71: no status face is one more meta fact, not a second line under the row.
      if(server.state==='running'&&(runtime===null||runtime===undefined))parts.push(h('span',{key:'runtime-none',className:'omni-ui-hint','data-testid':'mcp-runtime-none-'+id},t('mcpRuntimeNone')));
      // One count per row, always the Loader/tool-table fact; the connection word never repeats it.
      parts.push(h('span',{key:'tools','data-testid':'mcp-toolcount-'+id},fill(t('mcpToolCount'),{count})));
      if(sourceKey!==null)parts.push(h('span',{key:'source','data-testid':'mcp-source-'+id},t(sourceKey)));
      return h('span',null,parts.flatMap((part,index)=>index===0?[part]:[' · ',part]));
    };
    const normalActions=[
      loaded&&disabled?h(Button,{key:'enable',variant:'ghost',busy:toggling===id,disabled:(toggling!==null&&toggling!==id)||removing!==null,onClick:()=>{void setServerEnabled(server,true);},'data-testid':'mcp-toggle-'+id},t('mcpEnable')):null,
      oauthRow&&runtime!==null&&runtime!==undefined&&(runtime.state==='needs-login'||runtime.state==='failed')?h(Button,{key:'login',variant:'ghost',busy:session!==null,onClick:()=>{void startOauthLogin(server);},'data-testid':'mcp-login-'+serverName},t('mcpOauthLogin')):null,
      oauthRow&&runtime!==null&&runtime!==undefined&&runtime.state==='connected'?h(Button,{key:'logout',variant:'ghost',busy:sessionBusy&&session.phase==='logging-out',onClick:()=>{void logoutOauth(server);},'data-testid':'mcp-logout-'+serverName},t('mcpOauthLogout')):null,
      probeable?h(Button,{key:'probe',variant:'ghost',busy:probing===id,onClick:()=>{void probe(server);},'data-testid':'mcp-probe-'+id},t('mcpCheckConnection')):null,
      server.editable===true?h(Button,{key:'edit',variant:'ghost','data-testid':'mcp-edit-'+id,onClick:event=>openEdit(server,event)},t('mcpSettings')):null,
    ].filter(Boolean);
    const disableButton=loaded&&!disabled?h(Button,{variant:'danger-ghost',busy:toggling===id,disabled:(toggling!==null&&toggling!==id)||removing!==null,onClick:()=>{askDisable(server);},'data-testid':'mcp-toggle-'+id},t('mcpDisable')):null;
    const deleteButton=server.editable===true?h(Button,{variant:'danger-ghost',busy:removing===id,'data-testid':'mcp-delete-'+id,onClick:()=>askRemove(server)},t('remove')):null;
    const dangerAction=disableButton!==null&&deleteButton!==null
      ?[React.cloneElement(disableButton,{key:'disable'}),React.cloneElement(deleteButton,{key:'delete'})]
      :(disableButton??deleteButton);
    const rowActions=unsupported||(normalActions.length===0&&dangerAction===null)
      ?null
      :h(ActionGroup,{danger:dangerAction},normalActions);
    return h(ListRow,{
      key:id,
      'data-testid':'mcp-server-'+id,
      selected:form!==null&&form.mode==='edit'&&form.server!==null&&String(form.server.rowId)===id,
      onClick:purposeRowClick,
      title:h('span',{className:'omni-ui-mono','data-testid':'mcp-name-'+id},String(server.name)),
      // ADR-049 D1: one badge, and only for the fact with consequences (connection state). Transport, kind,
      // protocol and tool count are background: five equal-weight chips flattened "已连接" into the noise.
      badge:h(Badge,{key:'state',tone:stateTone,'data-testid':'mcp-state-'+id},stateWord),
      meta:mcpMeta(),
      children:detail.length>0?h('div',{className:'omni-ui-listFacts','data-testid':'mcp-facts-zone-'+id},detail):undefined,
      actions:rowActions,
    });
  };
  const pairEditor=(kind,rows)=>h('div',{className:'omni-ui-stack','data-testid':'mcp-'+kind+'-editor'},
    rows.map((pair,index)=>h('div',{key:index,className:'omni-ui-kvEditorRow','data-testid':'mcp-'+kind+'-row-'+index},
      h(TextInput,{name:kind+'-key-'+index,autoComplete:'off','aria-label':t('mcpKeyLabel'),placeholder:t('mcpKeyPlaceholder'),value:pair.key,onChange:event=>updatePair(kind,index,'key',event.target.value),'data-testid':'mcp-'+kind+'-key-'+index}),
      h(TextInput,{type:'password',name:kind+'-value-'+index,autoComplete:'new-password','aria-label':t('mcpValueLabel'),placeholder:t('mcpValuePlaceholder'),value:pair.value,onChange:event=>updatePair(kind,index,'value',event.target.value),'data-testid':'mcp-'+kind+'-value-'+index}),
      h(Button,{variant:'danger-ghost',disabled:rows.length===1,onClick:()=>removePair(kind,index),'data-testid':'mcp-'+kind+'-remove-'+index},t('mcpRemoveRow')))),
    h(Button,{variant:'default',size:'sm',className:'omni-ui-kvAdd',onClick:()=>addPair(kind),'data-testid':'mcp-'+kind+'-add-row'},t('mcpAddRow')));
  /** ADR-055: `env`/`headers` are written in one of three ways, and the page states which one before saving —
   * keeping the stored object, clearing it, or replacing it with exactly the rows below. "Untouched" is the
   * default, so merely opening an edit never destroys values this page cannot echo. */
  const pairBlock=(kind,label,count,isAdd)=>{
    const mode=values[kind+'Mode'];
    const replace=mode==='replace';
    const hint=replace?(isAdd?t('mcpPairsHint'):t('mcpPairsHintEdit')):mode==='clear'?t('mcpPairsClearHint'):fill(t('mcpConfiguredCount'),{count});
    const field={
      label,
      hint,
      // The switch is wrapped, not annotated: CapsuleSwitch does not forward extra props, and a testid that
      // silently disappears would make the gate address nothing.
      action:h('div',{'data-testid':'mcp-'+kind+'-mode'},
        h(CapsuleSwitch,{
          options:[{id:'keep',label:t('mcpPairsKeep')},{id:'clear',label:t('mcpPairsClear')},{id:'replace',label:t('mcpPairsReplace')}],
          value:mode,
          onChange:id=>setValue(kind+'Mode',id),
          'aria-label':label,
        })),
    };
    return h(Field,field,replace?pairEditor(kind,values[kind]):null);
  };
  const formSection=()=>{
    const add=form.mode==='add';
    const server=form.server;
    // A row loaded by an HTTP-only client (the Suite's own dual/OAuth subpaths) can never be a stdio row, and the
    // Host refuses that switch: the page must not offer a path that is guaranteed to be rejected. Historical
    // external rows are read-only under either authority, so they never reach this form.
    const httpOnlyClient=!add&&server!==null&&(server.clientSource==='suite'||values.kind==='oauth');
    // ADR-094 D4：官方 manager 托管的条目与套件自有客户端共用一张表单，但官方 schema 没有的字段不出现。
    const managed=!add&&server!==null&&server.managed===true;
    const officialTarget=add?(authority==='official'&&values.kind!=='oauth'):managed;
    return h(Drawer,{
      open:true,
      size:'lg',
      placement:'right',
      'data-testid':'mcp-form-section',
      title:add?t('mcpAddTitle'):t('mcpEditTitle'),
      badge:h('span',{hidden:!dirty,'data-testid':'mcp-form-dirty'},h(Badge,{tone:'warn'},t('unsavedBadge'))),
      closeLabel:t('closeToast'),
      busy:savePhase==='saving',
      onClose:()=>requestCloseForm(),
      footer:h(ActionGroup,{align:'end',stackOnMobile:true},
        h(Button,{variant:'ghost',disabled:savePhase==='saving',onClick:requestCloseForm,'data-testid':'mcp-form-cancel'},t('cancel')),
        h(Button,{variant:'primary',busy:savePhase==='saving',onClick:()=>{void submit();},'data-testid':'mcp-form-save'},savePhase==='saving'?t('saving'):t('save'))),
    },
      h('div',{className:'omni-ui-stack','data-testid':'mcp-form'},
        h(Card,{title:t('mcpFormIdentityTitle'),'data-testid':'mcp-form-identity-card'},
          h(Field,{label:t('mcpServerName'),hint:t('mcpServerNameHint'),required:true},
            h(TextInput,{name:'serverName',autoComplete:'off',className:'omni-ui-mono',value:values.name,readOnly:managed,onChange:event=>setValue('name',event.target.value),'data-testid':'mcp-form-name'})),
          add?h('div',{'data-testid':'mcp-form-kind'},h(Field,{label:t('mcpKind')},
            // Both arms are real now (ADR-033 D1): CapsuleSwitch is this library's segmented control that lets the
            // page switch the carried client; OAuth rows are HTTP-only, so that arm fixes the transport.
            h(CapsuleSwitch,{options:[{id:'static',label:t('mcpKindStatic')},{id:'oauth',label:t('mcpKindOauth')}],value:values.kind,onChange:id=>setValues(current=>({...current,kind:id,...(id==='oauth'?{transport:'streamable-http',headersMode:'keep',envMode:'keep'}:{})})),'aria-label':t('mcpKind')}),
            values.kind==='oauth'?h('p',{className:'omni-ui-hint','data-testid':'mcp-form-kind-oauth-note'},t('mcpOauthFlowHint')):null)):null,
          httpOnlyClient
            ?h('div',{'data-testid':'mcp-form-transport-hint'},h(Field,{label:t('mcpTransport'),hint:t('mcpHttpOnlyClientHint')},null))
            :values.kind==='oauth'?null:h('div',{'data-testid':'mcp-form-transport'},h(Field,{label:t('mcpTransport')},
            h(CapsuleSwitch,{options:[{id:'streamable-http',label:t('mcpTransportHttp')},{id:'stdio',label:t('mcpTransportStdio')}],value:values.transport,onChange:id=>setValues(current=>({
              ...current,
              transport:id,
              // Changing transport changes what an endpoint even means, so the new endpoint must be typed here.
              ...(form!==null&&form.mode==='edit'&&form.server!==null&&id!==form.server.transport?{endpointOpen:true}:{}),
            })),'aria-label':t('mcpTransport')})))),
        h(Card,{title:t('mcpFormEndpointTitle'),'data-testid':'mcp-form-endpoint-card'},
          // ADR-055 wording: a stdio row has a launch command, not an "endpoint"; the same section serves both, so
          // the label follows the transport instead of calling a command line an address.
          add?null:h(Field,{label:values.transport==='stdio'?t('mcpStartCommand'):t('mcpEndpoint'),hint:values.endpointOpen?(values.transport==='stdio'?t('mcpStartCommandReplaceHint'):t('mcpEndpointReplaceHint')):(values.transport==='stdio'?t('mcpStartCommandConfigured'):t('mcpEndpointConfigured'))},
            h(Switch,{label:values.transport==='stdio'?t('mcpStartCommandReplace'):t('mcpEndpointReplace'),align:'between',checked:values.endpointOpen,onChange:event=>setValue('endpointOpen',event.target.checked),'data-testid':'mcp-endpoint-replace'})),
          add||values.endpointOpen
            ?values.transport==='streamable-http'
              ?h(Field,{label:t('mcpUrl'),hint:t('mcpUrlHint'),required:true},
                h(TextInput,{name:'url',inputMode:'url',autoComplete:'off',className:'omni-ui-mono',value:values.url,onChange:event=>setValue('url',event.target.value),'data-testid':'mcp-form-url'}))
              :h(React.Fragment,null,
                h(Field,{label:t('mcpCommand'),hint:t('mcpCommandHint'),required:true},
                  h(TextInput,{name:'command',autoComplete:'off',className:'omni-ui-mono',value:values.command,onChange:event=>setValue('command',event.target.value),'data-testid':'mcp-form-command'})),
                h(Field,{label:t('mcpArgs'),hint:t('mcpArgsHint'),optionalLabel:t('optional')},
                  h(TextArea,{name:'args',rows:4,className:'omni-ui-mono',value:values.args,onChange:event=>setValue('args',event.target.value),'data-testid':'mcp-form-args'})),
                h(Field,{label:t('mcpCwd'),hint:add?t('mcpCwdHint'):t('mcpCwdHintEdit'),optionalLabel:t('optional')},
                  h(TextInput,{name:'cwd',autoComplete:'off',className:'omni-ui-mono',value:values.cwd,onChange:event=>setValue('cwd',event.target.value),'data-testid':'mcp-form-cwd'})))
            :null,
          values.kind==='oauth'?h(Field,{label:t('mcpStaticClientId'),hint:add?t('mcpStaticClientIdHint'):t('mcpStaticClientIdHintEdit'),optionalLabel:t('optional')},
            h(TextInput,{name:'staticClientId',autoComplete:'off',className:'omni-ui-mono',value:values.staticClientId,onChange:event=>setValue('staticClientId',event.target.value),'data-testid':'mcp-form-static-client-id'})):null,
          values.kind==='oauth'?h(Field,{label:t('mcpAuthTimeout'),hint:add?t('mcpAuthTimeoutHint'):t('mcpAuthTimeoutHintEdit'),optionalLabel:t('optional')},
            h(NumberInput,{name:'authorizationTimeoutMs',min:1000,step:1,value:values.authTimeoutMs,onChange:event=>setValue('authTimeoutMs',event.target.value),'data-testid':'mcp-form-auth-timeout'})):null),
        h(Card,{title:t('mcpFormRuntimeTitle'),'data-testid':'mcp-form-runtime-card'},
          h(Field,{label:t('mcpTimeout'),hint:add?t('mcpTimeoutHint'):t('mcpTimeoutHintEdit'),optionalLabel:t('optional')},
            h(NumberInput,{name:'toolCallTimeoutMs',min:1,step:1,value:values.timeoutMs,onChange:event=>setValue('timeoutMs',event.target.value),'data-testid':'mcp-form-timeout'})),
          managed?h(Switch,{label:t('mcpEnabled'),description:t('mcpEnabledHint'),align:'between',checked:values.enabled,onChange:event=>setValues(current=>({...current,enabled:event.target.checked,enabledDirty:true})),'data-testid':'mcp-form-enabled'}):null,
          officialTarget?null:h(Switch,{label:t('mcpFailOnStartup'),description:add?t('mcpFailOnStartupHint'):t('mcpKeepUnlessChanged'),align:'between',checked:values.failOnStartupError,onChange:event=>setValues(current=>({...current,failOnStartupError:event.target.checked,failDirty:true})),'data-testid':'mcp-form-fail-on-startup'}),
          values.transport==='streamable-http'&&values.kind!=='oauth'?pairBlock('headers',t('mcpHeaders'),server?server.headerCount:0,add):null,
          // ADR-034/0.2.0-5: the OAuth client's Config carries neither headers nor env; the Host refuses that
          // combination, so the page never offers it.
          values.kind!=='oauth'?pairBlock('env',t('mcpEnv'),server?server.envCount:0,add):null),
        saveIssue===null?null:h(Banner,{tone:'err',role:'alert','data-testid':'mcp-save-failure'},
          h('span',{'data-testid':'mcp-save-error'},saveIssue.sentence),
          h(DiagnosticDisclosure,{testId:'mcp-save-raw',title:t('rawDetails'),text:saveIssue.raw}))));
  };
  return h('section',{className:'omni-ui-stack','data-testid':'mcp-section','aria-label':t('tabMcp')},
    h(Card,{
      'data-testid':'mcp-overview-card',
      title:t('mcpOverviewTitle'),
      meta:receipt,
      headerActions:h(ActionGroup,null,h(Button,{'data-testid':'mcp-refresh',busy,onClick:()=>start()},busy?t('refreshing'):t('refresh'))),
    },
      h(StatusLine,{'data-testid':'mcp-summary',tone:catalog===null&&busy?'loading':catalogIssue!==null?'err':'neutral'},summary),
      purposes!==null&&!purposesUnreadable
        ?h('div',{'data-testid':'mcp-routing-row'},
          h(Switch,{
            label:t('mcpRouting'),
            description:t('mcpRoutingHint'),
            align:'between',
            busy:purposeBusy==='routing',
            checked:purposes.routing===true,
            disabled:unsupported||purposeBusy!==null,
            onChange:event=>{void saveRouting(event.target.checked);},
            'data-testid':'mcp-routing',
          }))
        :null,
      catalog!==null&&unsupported?h(Banner,{tone:'warn',role:'status','data-testid':'mcp-unsupported'},t('mcpUnsupported')):null,
      sentence===null?null:h(Banner,{tone:'err',role:'alert','data-testid':'mcp-failure-block'},
        h('span',{'data-testid':'mcp-failure'},sentence),
        h(DiagnosticDisclosure,{testId:'mcp-failure-raw',title:t('rawDetails'),text:String(failureIssue.raw??'')})),
      purposesIssue===null?null:h(Banner,{tone:'err',role:'alert','data-testid':'mcp-purpose-read-failure'},
        h('span',{'data-testid':'mcp-purpose-read-error'},t('mcpPurposeReadFailed')),
        h(DiagnosticDisclosure,{testId:'mcp-purpose-read-raw',title:t('rawDetails'),text:purposesIssue.raw})),
      purposes!==null&&purposesUnreadable
        ?h(Banner,{tone:'err',role:'alert','data-testid':'mcp-purpose-unreadable'},
          h('span',{'data-testid':'mcp-purpose-unreadable-line'},t('mcpPurposeUnreadable')),
          h(DiagnosticDisclosure,{testId:'mcp-purpose-unreadable-raw',title:t('rawDetails'),text:String(purposes.unreadable.code??'')+'\n'+String(purposes.unreadable.raw??'')}))
        :null,
      actionIssue===null?null:h(Banner,{tone:'err',role:'alert','data-testid':'mcp-action-failure'},
        h('span',{'data-testid':'mcp-action-error'},actionIssue.sentence),
        h(DiagnosticDisclosure,{testId:'mcp-action-raw',title:t('rawDetails'),text:actionIssue.raw})),
      probeIssue===null?null:h(Banner,{tone:'err',role:'alert','data-testid':'mcp-probe-failure'},
        h('span',{'data-testid':'mcp-probe-error'},probeIssue.sentence),
        h(DiagnosticDisclosure,{testId:'mcp-probe-raw',title:t('rawDetails'),text:probeIssue.raw}))),
    h(Card,{
      'data-testid':'mcp-custom-card',
      title:t('mcpServersCardTitle'),
      description:t('mcpServersCardDesc'),
      headerActions:servers.length>0&&!unsupported?h(ActionGroup,null,h(Button,{variant:'primary',onClick:event=>openAdd(event),'data-testid':'mcp-add-server'},t('mcpAdd'))):null,
    },
      catalog===null&&busy
        ?h('ul',{className:'omni-ui-list omni-ui-list--flush','data-testid':'mcp-loading-list'},
          h(ListRow,{key:'loading-0',loading:true,title:''}),
          h(ListRow,{key:'loading-1',loading:true,title:''}),
          h(ListRow,{key:'loading-2',loading:true,title:''}))
        :catalog===null&&!busy&&sentence!==null
          ?h('p',{className:'omni-ui-hint','data-testid':'mcp-read-failed-hint'},t('mcpReadFailedBody'))
          :servers.length>0
            ?h('ul',{className:'omni-ui-list omni-ui-list--flush','data-testid':'mcp-server-list-custom'},servers.map(row))
            :catalog!==null&&servers.length===0&&sentence===null
              ?h('div',{'data-testid':'mcp-empty'},
                h(EmptyState,{
                  surface:'inline',
                  align:'center',
                  title:t('mcpEmptyTitle'),
                  description:unsupported?t('mcpEmptyReadonlyDesc'):t('mcpEmptyDescription'),
                  action:unsupported?undefined:h(Button,{variant:'primary',onClick:event=>openAdd(event),'data-testid':'mcp-empty-add'},t('mcpAdd')),
                }))
              :catalog!==null&&servers.length===0&&sentence!==null
                ?h('p',{className:'omni-ui-hint','data-testid':'mcp-read-failed-hint'},t('mcpReadFailedBody'))
                :null),
    form!==null&&values!==null?formSection():null);
}
