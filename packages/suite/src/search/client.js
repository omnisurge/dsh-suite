import * as React from 'react';
import {ActionGroup,Banner,Button,Checkbox,ConfigPage,Disclosure,Field,FormGrid,injectStyles,registerSettingsPluginCard,Select,StatusLine,TextInput} from '@omnisurge/dsh-ui';
  const h=React.createElement,NS='omnisurge-web-search-searxng',LOCALE='omnisurge.searxng';
  const groups=['default','auto','en','zh','custom'];
  const en={title:'Web Search (SearXNG)',summary:'Connect an existing SearXNG instance. Basic authentication is supported.',baseUrl:"SearXNG URL",auth:'Authentication',none:'No authentication',basic:'Username and password (Basic)',username:'Username',password:'Password',replace:'Set / replace username and password',keep:'Keep the configured credential; blank fields do not clear it.',configured:'Credential configured (not read back)',missing:'Credential missing',loading:'Checking credential presence…',unknown:'Credential state unavailable',readonly:'Existing credential comes from a read-only source; replacement creates a separate credential.',advanced:'Advanced settings',basicAuthEnv:'Credential reference (reuse only)',engineGroup:'Engine group',customEngines:'Custom engines',timeoutMs:'Timeout (ms)',group_default:'Server defaults',group_auto:'Automatic by query language',group_en:'English engines',group_zh:'Chinese engines',group_custom:'Custom engines',hint:"Use your existing SearXNG URL. A blank address disables search. Passwords are stored only by the official credential store, never in plugin settings.",save:'Save',saveTest:'Save and test',cancel:'Discard edits / reload',saving:'Working…',saved:'Saved',httpWarning:'HTTP Basic is only encoded, not encrypted. Prefer HTTPS for a public service.',httpConsent:'I understand and allow credentials to be sent over HTTP to this address.',inspect:'Inspect configuration',check:'Check selected engine group',diag:'Connection result',scope:"Tests only the saved SearXNG instance. Global web_search selection is not verified; check the official web provider setting before use.",raw:'Technical diagnostic details',schema:'Installed schema and defaults',staleReport:'Saved settings changed; the result below is from an earlier check. Repeat diagnostics.',passed:"Search check passed",degraded:'Search works with warnings',blocked:'The instance did not pass the check',cancelled:'Check cancelled or timed out',busy:'Another check is already running',inspected:'Configuration inspected',disabled:'No endpoint configured; search is disabled',unsupported:'This Suite version does not support self-service credentials or setup diagnostics. Update the Suite and reopen the app.'};
  const zh={title:'联网搜索（SearXNG）',summary:'接入已有 SearXNG 实例，支持账号密码认证。',baseUrl:"实例地址",auth:'认证方式',none:'无需认证',basic:'账号密码（Basic）',username:'用户名',password:'密码',replace:'设置／更换账号密码',keep:'保留已设置凭据；输入框留空不会清除它。',configured:'凭据已设置（不回读秘值）',missing:'尚未设置凭据',loading:'正在检查凭据状态…',unknown:'暂无法确认凭据状态',readonly:'现有凭据来自只读来源；更换会创建独立凭据，不覆盖原值。',advanced:'高级设置',basicAuthEnv:'凭据引用（仅复用现有凭据）',engineGroup:'引擎组',customEngines:'自定义引擎',timeoutMs:'超时（毫秒）',group_default:'服务默认引擎',group_auto:'按查询语言自动选择',group_en:'英文引擎',group_zh:'中文引擎',group_custom:'自定义引擎',hint:"填写已有 SearXNG 地址；留空会禁用搜索。账号密码仅由官方凭据管理保存，不进入插件设置。",save:'保存',saveTest:'保存并测试',cancel:'丢弃修改／重新载入',saving:'处理中…',saved:'已保存',httpWarning:'HTTP Basic 只是编码，不是加密；公网实例建议使用 HTTPS。',httpConsent:'我理解并允许向此地址通过 HTTP 发送凭据。',inspect:'检查配置状态',check:'测试已选引擎组',diag:'连接结果',scope:"仅检查已保存的 SearXNG 实例，不代表全局联网搜索已选择它；使用前请核对官方联网搜索提供方设置。",raw:'技术诊断详情',schema:'已安装字段与默认值',staleReport:'已保存设置发生变化；以下为之前的检查结果，请重新检查。',passed:"搜索检查通过",degraded:'搜索可用，但有警告',blocked:'当前实例未通过检查',cancelled:'检查已取消或超时',busy:'已有检查正在进行',inspected:'配置状态已检查',disabled:'尚未配置地址，搜索已禁用',unsupported:'当前套件版本不支持自助凭据和检查功能；请更新套件并重新打开应用。'};
  const messages={
   SAVED:['Saved','已保存'],STALE:['Settings changed. Reload before retrying; no old draft overwrite is allowed.','配置已变化，请重新载入后操作；旧草稿未覆盖新值。'],INVALID:['Invalid settings. Check URL, reference, engine names and timeout.','配置不合法，请检查地址、引用、引擎和超时。'],BASIC_REQUIRED:['Enter a username and password or reuse a configured reference.','请设置账号密码，或复用已配置的凭据引用。'],BASIC_INVALID:['Enter both fields. The username cannot contain a colon or a line break.','请完整输入用户名和密码；用户名不能含冒号或换行。'],CREDENTIAL_MISSING:['This reference has no credential. Set username and password here.','此引用没有凭据，请在本页设置账号密码。'],CREDENTIAL_STATE_UNKNOWN:['Credential presence could not be confirmed; nothing was written.','无法确认凭据状态，尚未写入。'],CREDENTIAL_REFERENCE_COLLISION:['Could not allocate a fresh writable credential reference. Reload and retry.','无法分配独立可写引用，请重新载入。'],CREDENTIAL_WRITE_REJECTED:['Credential write was refused; settings were not changed.','凭据写入被拒绝，设置未变化。'],CREDENTIAL_WRITE_UNCONFIRMED:['Credential write could not be confirmed; settings were not switched. Reload before retrying.','无法确认凭据是否已保存；设置未切换，请先重新载入。'],CREDENTIAL_STORED_SETTINGS_STALE:['New credential stored, but settings changed elsewhere. Original reference was not overwritten. Reload to review.','新凭据已保存，但设置已在别处变化；未覆盖原凭据引用，请重新载入确认。'],CREDENTIAL_STORED_SETTINGS_UNCONFIRMED:['New credential stored; settings save could not be confirmed. Reload to review. Do not blindly retry or delete credentials.','新凭据已保存，但无法确认设置是否提交；请重新载入核对，不要盲目重试或删除凭据。'],SETTINGS_UNCONFIRMED:['Settings save could not be confirmed. Reload to review before retrying.','无法确认设置是否提交，请先重新载入核对。'],CANCELLED:['Operation cancelled; no further writes will be started.','操作已取消，不再发起后续写入。'],CREDENTIAL_STORED_CANCELLED:['Operation cancelled after a credential or settings write. Reload to review the outcome.','凭据或配置写入后操作被取消，请重新载入核对结果。'],HTTP_CONSENT_REQUIRED:['Use HTTPS or explicitly acknowledge HTTP credential transport.','请使用 HTTPS，或明确确认通过 HTTP 发送凭据的风险。'],NAMESPACE_UNAVAILABLE:['The Host is not serving this search namespace yet, so no check was started. Enable the component row, then reload and retry.','Host 尚未提供该搜索命名空间，未发起检查；请启用组件行后重新载入再试。'],UNAVAILABLE:['Settings are unavailable or read-only in this connection.','当前连接的设置不可用或只读。'],DIAGNOSTIC_UNAVAILABLE:['Diagnostic response unavailable; no check result is confirmed.','无法取得诊断响应，未确认检查结果。'],SETUP_BUILD_UNSUPPORTED:[en.unsupported,zh.unsupported]
  };
  const diagnostics={CONFIG_MISSING:['Configure a service address.','请填写服务地址。'],CUSTOM_ENGINES_MISSING:['Set custom engines before selecting custom mode.','选择自定义引擎时需填写名称。'],CREDENTIAL_MISSING:['Set the required username and password.','请设置所需账号密码。'],CREDENTIAL_LOOKUP_FAILED:['Credential presence lookup failed.','凭据状态检查失败。'],CREDENTIAL_ERROR:['Credential lookup or Basic format failed; replace username and password.','凭据解析或 Basic 格式失败，请核对或更换账号密码。'],UNENCRYPTED_TRANSPORT:['HTTP traffic is not encrypted. Prefer HTTPS for credentials or private queries.','HTTP 通信未加密；发送凭据或私密查询时建议使用 HTTPS。'],HTTP_AUTH_REQUIRED:['HTTP 401: check username/password and proxy authentication.','HTTP 401：请检查账号密码和代理认证。'],HTTP_FORBIDDEN:['HTTP 403: check access policy and SearXNG JSON permission; the cause is not proven.','HTTP 403：请检查访问策略和 JSON 权限，不能仅凭此状态确定原因。'],HTTP_ERROR:['Server/proxy returned an HTTP error.','服务器或代理返回 HTTP 错误。'],RESPONSE_NOT_JSON:['The service returned non-JSON data; check the URL, proxy and JSON output setting.','服务未返回 JSON，请检查地址、代理和 JSON 输出设置。'],RESPONSE_SHAPE_INVALID:['The response is not a compatible SearXNG results object.','响应不是兼容的 SearXNG 搜索结果。'],RESPONSE_TOO_LARGE:['The response exceeds the 2 MiB safety limit.','响应超过 2 MiB 安全限制。'],NETWORK_FAILED:['Connection failed; check connectivity, TLS and service status.','连接失败，请检查网络、TLS 和服务状态。'],EMPTY_RESULTS:['No results; review engine selection and language routing.','没有结果，请检查引擎和语言选择。'],QUALITY_SUSPECT:['Results did not match the expected calibration domain; HTTP 200 is not relevance proof.','校准结果未命中预期域名；HTTP 200 不代表结果相关。'],ENGINE_DEGRADED:['Some engines did not respond.','部分引擎未响应。'],FALLBACK_USED:['Selected engines were empty; one controlled fallback was planned (auto: other language; explicit: server defaults).','所选引擎没有结果，计划一次受控回退（auto：另一语言；显式组：服务默认）。'],EXPECTED_CONFIGURATION_MISMATCH:['Saved settings changed before the Host began. No search was sent; reload and confirm.','Host 开始检查前配置已变化，未发搜索请求；请重新载入确认。'],CONFIGURATION_CHANGED:['Settings changed during the check; repeat with current settings.','检查期间配置变化，请按当前设置重新检查。'],CHECK_BUSY:[en.busy,zh.busy],CHECK_TIMEOUT:['The diagnostic budget expired.','诊断预算已耗尽。'],CHECK_CANCELLED:['The check was cancelled.','检查已取消。'],SETUP_CLOSED:['The plugin owner is unloaded.','插件已停用。'],INSPECTION_CANCELLED:['Credential inspection was cancelled.','凭据状态检查已取消。']};
  Object.assign(diagnostics,{ENGINE_CONFIG_UNAVAILABLE:['Explicit engine selection needs the same instance /config catalogue; check proxy access or explicitly choose server defaults.','显式引擎选择需要该实例 /config 清单；请检查代理权限，或明确选择服务默认。'],ENGINE_CONFIG_INVALID:['The /config catalogue must declare exact engine names and enabled flags. Search hits alone do not prove this.','/config 清单须声明精确引擎名称和 enabled 状态；搜索有结果并不能证明名字有效。'],ENGINE_NAME_UNKNOWN:['A custom name is not declared by this instance. Correct it from /config; no search or silent default fallback was sent.','该实例未声明某个自定义名称；请从 /config 核对修正。本次未发搜索或静默默认回退。'],ENGINE_GROUP_UNAVAILABLE:['No enabled candidates exist for this language group; review server engines, known custom names or explicitly choose defaults.','该语言组没有已启用候选；请核对服务端引擎、有效自定义名称，或明确选择默认。'],CUSTOM_ENGINES_INVALID:['Enter valid nonempty custom names.','请填写合法且非空的自定义名称。']});
  const bounded=(promise,signal)=>new Promise((resolve,reject)=>{const abort=()=>{cleanup();reject(new Error('OPERATION_UNCONFIRMED'));};const timer=setTimeout(abort,10000);const cleanup=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);};signal.addEventListener('abort',abort,{once:true});promise.then(value=>{cleanup();resolve(value);},()=>{cleanup();reject(new Error('OPERATION_UNCONFIRMED'));});if(signal.aborted)abort();});
/** The services this contribution uses, declared at its own entry (ADR-028 §11.4). The Suite starts it
 * with a context declaring exactly this list, so an undeclared access is refused by Cordis instead of
 * silently disabling the settings card. This is the only declaration of the set: a second hand-kept copy
 * drifted once (it lost `remote.credentials`) and every credential read failed as "unknown" in a real
 * window while both fixtures stayed green. */
export const inject=['slots','locale','configForms','settingsSchema','remote','remote.credentials'];
export function apply(ctx,inputs={}){
 // The generated Remote namespace and the self-service flow are supplied by the owning entry: the Suite
 // Client is bundled into one module, so the entry is the single place that knows their build paths.
 const REMOTE=inputs.remote??null,FLOW=inputs.flow??null;
   // Namespace truthiness is not readiness: each entry used by this Client must exist.
   const remoteReady=['inspect','check','checkSaved'].every(method=>REMOTE?.descriptors?.some(d=>d.service==='omnisurgeSearxngSetup'&&d.namespace==='omnisurgeSearxngSetup'&&d.method===method))
   const flowReady=['saveConnection','requiresHttpConsent'].every(method=>typeof FLOW?.[method]==='function');
   // Stamped by the fixed build entry; a raw legacy copy keeps the placeholder and null Remote/Flow.
   ctx.provide('omnisurgeSearxngClientBuild',{revision:'__OMNISURGE_CLIENT_REVISION__',protocol:'__OMNISURGE_BUILD_PROTOCOL__',capabilities:{clientRemote:remoteReady,clientFlow:flowReady}});
   ctx.effect(()=>ctx.locale.register(LOCALE,{en,zh}),'searxng: client locale');
   // 共享库的 token 样式表只注入一次；缺了它，同一套 class 会退化成浏览器默认外观。
   ctx.effect(()=>{injectStyles();},'searxng: shared ui token sheet');
   const form=ctx.configForms.get(NS),subscribe=listener=>form.subscribe(listener),snapshot=()=>form.getSnapshot();let setupRemote;
   function Result({t,report,revision,reportRevision}){
    const index=t('title')===zh.title?1:0,inspection=report?.inspection??report;
    if(!report)return null;
    const codes=[...new Set([...(inspection.codes??[]),...(report.codes??[]),...(report.probes??[]).flatMap(p=>p.codes)])];
    const verdict=report.state==='ready'?'passed':report.state==='degraded'?'degraded':report.state==='blocked'?'blocked':report.state==='cancelled'?'cancelled':report.state==='busy'?'busy':inspection.configuration.endpointConfigured?'inspected':'disabled';
    return h('section',{'data-testid':'searxng-setup-result','aria-label':t('diag'),className:'omni-ui-stack'},
     h('h3',null,t('diag')),
     h(StatusLine,{'data-testid':'searxng-connection-summary',tone:report.state==='ready'?'ok':'warn',role:report.state==='ready'?'status':'alert'},t(verdict)),
     reportRevision!==revision&&h(Banner,{'data-testid':'searxng-stale-report'},t('staleReport')),
     codes.length>0&&h('ul',null,...codes.map(code=>h('li',{key:code},'['+code+'] '+(diagnostics[code]?.[index]??code)))),
     ...(report.probes??[]).map(probe=>h('p',{key:probe.language,className:'omni-ui-hint'},(probe.language==='zh'?(index?'中文':'Chinese'):(index?'英文':'English'))+': '+probe.sourceCount+' '+(index?'条结果':'results')+' · '+probe.elapsedMs+' ms · HTTP '+(probe.httpStatus??'—'))),
     h('p',{className:'omni-ui-hint'},t('scope')),
     h(Disclosure,{title:t('raw')},
      h('pre',{'data-testid':'searxng-setup-report',className:'omni-ui-excerpt'},JSON.stringify({...report,schemaJson:undefined,inspection:report.inspection?{...report.inspection,schemaJson:undefined}:undefined},null,2)),
      h(Disclosure,{title:t('schema')},h('pre',{className:'omni-ui-excerpt'},inspection.schemaJson))));
   }
   function Form({t,view}){
    const live=React.useSyncExternalStore(subscribe,snapshot,snapshot),[edit,setEdit]=React.useState(null),[auth,setAuth]=React.useState(null),[credentialEditor,setCredentialEditor]=React.useState(false),[username,setUsername]=React.useState(''),[password,setPassword]=React.useState(''),[httpConsent,setHttpConsent]=React.useState(''),[notice,setNotice]=React.useState(''),[busy,setBusy]=React.useState(false),[report,setReport]=React.useState(null),[reportRevision,setReportRevision]=React.useState(null),[presence,setPresence]=React.useState({ref:'',state:'unknown',writable:true});
    const mounted=React.useRef(true),lock=React.useRef(false),operation=React.useRef(null),index=t('title')===zh.title?1:0;
    const clearSecrets=()=>{if(mounted.current){setUsername('');setPassword('');}};
    React.useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;operation.current?.abort();};},[]);
    // 0.2.1 removed the snapshot's host/memory split: `writable` is the single answer to "may this page
    // write the Host document", so requiring a `mode` field that no longer exists left every form disabled.
    const ready=live.status==='ready'&&live.writable,value=edit?.value??live.value??{},authMode=auth??(value.basicAuthEnv?'basic':'none'),ref=value.basicAuthEnv??'';
    React.useEffect(()=>{let active=true;const controller=new AbortController();
     const refresh=async()=>{if(!ref){if(active)setPresence({ref,state:'missing',writable:true});return;}if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(ref)){setPresence({ref,state:'unknown',writable:false});return;}
      setPresence({ref,state:'loading',writable:true});try{const r=await bounded(ctx.remote.credentials.describe([ref]),controller.signal);if(active)setPresence({ref,state:r.ok&&r.value[ref]?(r.value[ref].configured?'configured':'missing'):'unknown',writable:r.ok?r.value[ref]?.writable!==false:false});}catch(_){if(active)setPresence({ref,state:'unknown',writable:false});}};
     void refresh();const off=ctx.remote.$on('credentials/reference-updated',changed=>{if(changed===ref)void refresh();});return()=>{active=false;controller.abort();off();};
    },[ref]);
    const pinDraft=()=>setEdit(previous=>previous??{value:{...live.value},revision:live.revision,changed:[]});
    const change=(field,next)=>{setNotice('');if(field==='baseUrl'||field==='basicAuthEnv')setHttpConsent('');setEdit(previous=>({value:{...(previous?.value??live.value),[field]:next},revision:previous?.revision??live.revision,changed:[...new Set([...(previous?.changed??[]),field])]}));};
    const discard=()=>{clearSecrets();setEdit(null);setAuth(null);setCredentialEditor(false);setHttpConsent('');setNotice('');};
    const diagnose=async(action,signal,revision)=>{const saved=snapshot();if(saved.revision!==revision)throw new Error('EXPECTED_CONFIGURATION_MISMATCH');const v=saved.value,expected={baseUrl:v.baseUrl,basicAuthEnv:v.basicAuthEnv,engineGroup:v.engineGroup,customEngines:v.customEngines,timeoutMs:v.timeoutMs};const response=action==='check'?await setupRemote.checkSaved(expected,signal):await setupRemote.inspect(signal);if(!response.ok)throw new Error('DIAGNOSTIC_UNAVAILABLE');if(mounted.current){setReport(response.value);setReportRevision(revision);}};
    const run=async action=>{if(lock.current)return;lock.current=true;setBusy(true);setNotice('');setReport(null);setReportRevision(null);const controller=new AbortController();operation.current=controller;try{if(!remoteReady)throw new Error('SETUP_BUILD_UNSUPPORTED');if(!setupRemote){if(mounted.current)setNotice('NAMESPACE_UNAVAILABLE');return;}const saved=snapshot().value;if(action==='check'&&flowReady&&FLOW.requiresHttpConsent(saved,saved.basicAuthEnv?'basic':'none')&&httpConsent!==saved.baseUrl){setNotice('HTTP_CONSENT_REQUIRED');return;}await diagnose(action,controller.signal,snapshot().revision);}catch(_){if(mounted.current)setNotice(remoteReady?'DIAGNOSTIC_UNAVAILABLE':'SETUP_BUILD_UNSUPPORTED');}finally{lock.current=false;if(mounted.current)setBusy(false);}};
    const validateSettings=next=>{const section=ctx.configForms.describe().getSnapshot().view?.namespaces.find(row=>row.ns===NS);return !!section&&ctx.settingsSchema.validate(ctx.settingsSchema.rehydrate(section.schema),next)===undefined&&(next.engineGroup!=='custom'||!!String(next.customEngines??'').trim());};
    const save=async(testAfter)=>{
     if(lock.current)return;lock.current=true;setBusy(true);setNotice('');if(testAfter){setReport(null);setReportRevision(null);}const controller=new AbortController();operation.current=controller;
     try{
      if(!flowReady){
       // Defined legacy downgrade: keep ordinary ConfigForms saves, never advertise credential writes/tests.
       if(!ready||!edit){setNotice('SETUP_BUILD_UNSUPPORTED');return;}
       if(snapshot().revision!==edit.revision){setNotice('STALE');return;}
       if(!validateSettings(edit.value)){setNotice('INVALID');return;}
       const accepted=await bounded(form.mutate(edit.changed.map(field=>({op:'set',path:[field],value:edit.value[field]})),edit.revision),controller.signal);
       if(mounted.current){setNotice(accepted?'SAVED':'SETTINGS_UNCONFIRMED');if(accepted)setEdit(null);}return;
      }
      const outcome=await FLOW.saveConnection({value,changed:edit?.changed??[],expectedRevision:edit?.revision??live.revision,authMode,username,password,signal:controller.signal,httpConsent:httpConsent===value.baseUrl},{snapshot,clearSecrets,newRef:()=> 'OMNISURGE_SEARXNG_AUTH_'+crypto.randomUUID().replaceAll('-','').toUpperCase(),validate:validateSettings,describe:reference=>bounded(ctx.remote.credentials.describe([reference]),controller.signal),set:(reference,literal)=>bounded(ctx.remote.credentials.set(reference,literal),controller.signal),mutate:(ops,revision)=>bounded(form.mutate(ops,revision),controller.signal)});
      if(!mounted.current)return;setNotice(outcome.code);
      if(outcome.committed){setEdit(null);setAuth(null);setCredentialEditor(false);if(testAfter){if(!remoteReady){setNotice('SETUP_BUILD_UNSUPPORTED');return;}if(snapshot().revision!==outcome.revision){setNotice('STALE');return;}await diagnose('check',controller.signal,outcome.revision);}}
     }catch(_){if(mounted.current)setNotice('DIAGNOSTIC_UNAVAILABLE');}finally{clearSecrets();lock.current=false;if(mounted.current)setBusy(false);}
    };
    if(view==='summary')return t('summary');
    const dirty=edit!==null||auth!==null||username!==''||password!=='';
    const needsReview=/UNCONFIRMED|CREDENTIAL_STORED_/.test(notice);
    const unsafeHttp=flowReady&&FLOW.requiresHttpConsent(value,authMode);
    // 每个字段都是「库的 Field + 库的控件」：label/hint 关联、禁用态与外观由库统一负责，
    // 本页不再自带样式表，也不再手搓 input/select/button。
    const input=field=>h(Field,{key:field,label:t(field)},
     field==='engineGroup'
      ?h(Select,{name:field,value:value[field]??'default',disabled:!ready||busy,onChange:e=>change(field,e.target.value)},...groups.map(group=>h('option',{key:group,value:group},t('group_'+group))))
      :h(TextInput,{name:field,type:field==='timeoutMs'?'number':'text',value:value[field]??'',disabled:!ready||busy,autoComplete:'off',spellCheck:false,min:field==='timeoutMs'?100:undefined,max:field==='timeoutMs'?60000:undefined,step:field==='timeoutMs'?1:undefined,onChange:e=>{change(field,field==='timeoutMs'?Number(e.target.value):e.target.value);if(flowReady&&field==='basicAuthEnv'&&e.target.value)setAuth('basic');}}));
    const saveStatus=(!ready||notice)
      ?h(StatusLine,{'data-testid':'searxng-save-result',tone:notice&&notice!=='SAVED'?'warn':'ok',role:notice&&notice!=='SAVED'?'alert':'status'},'['+(notice||'UNAVAILABLE')+'] '+(messages[notice||'UNAVAILABLE']?.[index]??notice))
      :null;
    const credentialBlock=h('fieldset',{disabled:!ready||busy||!flowReady,className:'omni-ui-stack'},
     h('legend',null,t('basic')),
     h(StatusLine,{'data-testid':'searxng-credential-status'},t(presence.ref===ref?presence.state:'unknown')),
     presence.state==='configured'&&presence.writable===false&&h('p',{className:'omni-ui-hint'},t('readonly')),
     h('p',{className:'omni-ui-hint'},t('keep')),
     h(ActionGroup,null,h(Button,{onClick:()=>{pinDraft();clearSecrets();setCredentialEditor(!credentialEditor);}},t('replace'))),
     (credentialEditor||!ref)&&h(FormGrid,null,
      h(Field,{label:t('username')},h(TextInput,{name:'basicUsername',type:'text',value:username,autoComplete:'off',spellCheck:false,onChange:e=>{pinDraft();setUsername(e.target.value);}})),
      h(Field,{label:t('password')},h(TextInput,{name:'basicPassword',type:'password',value:password,autoComplete:'new-password',onChange:e=>{pinDraft();setPassword(e.target.value);}}))));
    return h('form',{onSubmit:e=>{e.preventDefault();void save(false);},noValidate:true,'aria-label':t('title')},
     h(ConfigPage,{available:true,writable:ready,dirty,saving:busy,failed:needsReview,
       labels:{unavailable:t('disabled'),readOnly:t('readonly'),saveFailed:t('INVALID'),saving:t('saving'),save:t('save')},
       onSave:()=>void save(false),onDiscard:discard},
      h(Banner,null,t('hint')),
      h(FormGrid,null,
       input('baseUrl'),
       h(Field,{label:t('auth')},h(Select,{name:'authentication','aria-label':t('auth'),value:authMode,disabled:!ready||busy||!flowReady,onChange:e=>{pinDraft();setAuth(e.target.value);clearSecrets();setHttpConsent('');setNotice('');setCredentialEditor(e.target.value==='basic'&&!ref);}},h('option',{value:'none'},t('none')),h('option',{value:'basic'},t('basic'))))),
      authMode==='basic'&&credentialBlock,
      unsafeHttp&&h(Banner,{role:'note'},h('p',null,t('httpWarning')),h(Checkbox,{label:t('httpConsent'),checked:httpConsent===value.baseUrl,disabled:busy,onChange:e=>setHttpConsent(e.target.checked?value.baseUrl:'')})),
      h(Disclosure,{'data-testid':'searxng-advanced',title:t('advanced')},h(FormGrid,null,...['engineGroup','customEngines','timeoutMs','basicAuthEnv'].map(input))),
      saveStatus,
      h(ActionGroup,null,
       h(Button,{disabled:!ready||busy||!flowReady||needsReview,onClick:()=>void save(true)},t('saveTest')),
       h(Button,{variant:'ghost',disabled:busy||!dirty,onClick:discard},t('cancel'))),
      (!remoteReady||!flowReady)&&h(Banner,{'data-testid':'searxng-setup-unsupported'},'SETUP_BUILD_UNSUPPORTED — '+t('unsupported')),
      h('section',{'data-testid':'searxng-setup-panel',className:'omni-ui-stack'},
       h(ActionGroup,null,
        h(Button,{disabled:busy||!remoteReady,onClick:()=>void run('inspect')},t('inspect')),
        h(Button,{disabled:busy||!remoteReady||dirty||(flowReady&&FLOW.requiresHttpConsent(live.value,live.value?.basicAuthEnv?'basic':'none')&&httpConsent!==live.value?.baseUrl),onClick:()=>void run('check')},t('check'))),
       h(Result,{t,report,revision:live.revision,reportRevision}))));
   }
   // One settings card per settings namespace (ADR-028 §11.4): the official settings page slot
   // `plugins.item`, registered through the shared library. The retired row-config entrance was keyed
   // `<owner bundle>#<namespace>` and needed arbitration because one namespace could be answered by two
   // independently registering instances; with a single registration site there is nothing to arbitrate,
   // so the bound/settingsOwner dance is gone rather than retuned.
   // Bind the translator while this context is active: the served-state callback may run later, and a
   // lazy lookup inside it fails with "cannot get required service locale in inactive context".

   const contribute=inner=>{
     const t=inner.locale.bind(LOCALE);
     inner.effect(()=>inner.configForms.whileServed([NS],()=>{
       // whileServed is the sole served-state owner: a non-void disposer prevents repeat registration,
       // removes the card when the Host stops serving NS, and permits registration on re-enable.
       // A plugin-lifetime boolean would retain a dead card (or suppress its replacement) instead.
       return registerSettingsPluginCard(inner,{id:NS,order:20,label:()=>t('title'),locale:LOCALE,inject:()=>({t})},Form);
     }),'searxng: self-service configuration (one settings card per settings namespace)');
   };
   // Three separate facts, in this order and never as each other's precondition (ADR-028 §11.4 / §5.8):
   // the build can do self-service, the descriptors are mounted, the namespace is reachable. A Host that
   // is not reachable, still starting, or has the component row switched off must still leave the user a
   // card that explains itself, so the entry is registered from the served-settings fact alone.
   if(remoteReady)ctx.effect(async()=>{await ctx.remote.$mount(REMOTE);},'searxng: mount the generated Remote descriptors');
   ctx.effect(()=>ctx.inject(['remote','remote.omnisurgeSearxngSetup'],scope=>{
     setupRemote=scope.remote.omnisurgeSearxngSetup;
     return()=>{setupRemote=undefined;};
   }),'searxng: hold the Remote namespace while the Host serves it');
   contribute(ctx);
 }
