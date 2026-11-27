import * as React from 'react';
import {
  ActionGroup, Banner, Button, Checkbox, ConfigPage, Disclosure, Field, FormGrid,
  NumberInput, Select, StatusLine, TextInput, injectStyles, registerSettingsPluginCard,
  showConfirm, showToast,
} from '@omnisurge/dsh-ui';
import {CLIENT_READ_TIMEOUT_MS,withTimeout} from '../remote-timeout.js';
import {DiagnosticDisclosure} from '../shared/DiagnosticDisclosure.js';
import {fillTemplate} from '../shared/client-copy.js';
import {createRemoteCaller,unwrapRemoteResult} from '../shared/client-remote.js';
  const h=React.createElement,NS='omnisurge-web-search-searxng',LOCALE='omnisurge.searxng';
  const groups=['default','auto','en','zh','custom'];
  const en={title:'Web Search (SearXNG)',summary:'Connect an existing SearXNG instance. Basic authentication is supported.',baseUrl:"SearXNG URL",baseUrlHint:'For example https://search.example.internal; leave blank to disable.',auth:'Authentication',none:'No authentication',basic:'Username and password (Basic)',username:'Username',password:'Password',replace:'Replace credentials',collapseCredential:'Hide credential inputs',clearCredential:'Clear credential ref',clearCredentialTitle:'Clear credential reference?',clearCredentialText:'This clears the configured credential reference and draft inputs without deleting shared system credentials. Enter new credentials or switch authentication before saving.',clearCredentialConfirm:'Clear reference',keep:'Keep the configured credential; blank fields do not clear it.',configured:'Credentials configured (values are not shown)',missing:'Credential missing',loading:'Checking credential presence…',unknown:'Credential state unavailable',readonly:'Existing credential comes from a read-only source; replacement creates a separate credential.',readOnlySettings:'Settings are unavailable or read-only in this connection.',advanced:'Advanced settings',optional:'Optional',basicAuthEnv:'Credential reference',basicAuthEnvHint:'Only fill this in to reuse an existing system credential reference.',engineGroup:'Engine group',customEngines:'Custom engines',timeoutMs:'Timeout (ms)',group_default:'Server defaults',group_auto:'Automatic by query language',group_en:'English engines',group_zh:'Chinese engines',group_custom:'Custom engines',hint:"Enter your existing SearXNG URL (leave blank to disable web search). Credentials are saved only in system credential management, never in plain settings.",save:'Save',cancel:'Cancel',saving:'Saving…',saved:'Saved',reload:'Reload',reloadedToast:'Latest settings reloaded',footerStale:'Unsaved changes; reload before saving',cleanState:'No unsaved changes',unsavedChanges:'Unsaved changes',closeToast:'Close',saveFailedFallback:'Settings were not saved. Check the fields and try again.',httpWarning:'HTTP connections do not encrypt your username or password. Prefer HTTPS for public instances.',httpConsent:'I understand and allow credentials to be sent over HTTP to this address.',diagTitle:'Connection and diagnostics',lastCheckedAt:'Last checked {time}',lastCheckedNever:'Not checked yet',dirtyDiagHint:'You have unsaved changes. Save settings before testing the saved instance.',inspect:'Inspect configuration',check:'Test connection',diag:'Connection result',scope:"Manages only this SearXNG instance connection. To use it by default in conversations, set the app default web search source to this instance.",raw:'Original technical diagnostics',schema:'Installed schema and defaults',staleReport:'Saved settings changed; the result below is from an earlier check. Repeat diagnostics.',passed:"Connection test passed",degraded:'Search works with warnings',blocked:'Connection test failed',cancelled:'Check cancelled or timed out',busy:'Another check is already running',inspected:'Configuration inspected',disabled:'No endpoint configured; search is disabled',unknownDiagnostic:'Diagnostic notice reported; expand original technical diagnostics for details.',diagFailedFallback:'Could not complete the diagnostic check. Please try again.',unsupported:'This Suite version does not support self-service credentials or setup diagnostics. Update the Suite and reopen the app.'};
  const zh={title:'联网搜索（SearXNG）',summary:'接入已有 SearXNG 实例，支持账号密码认证。',baseUrl:"实例地址",baseUrlHint:'例如 https://search.example.internal；留空可停用此搜索实例。',auth:'认证方式',none:'无需认证',basic:'账号密码（Basic）',username:'用户名',password:'密码',replace:'替换凭据',collapseCredential:'收起输入',clearCredential:'清除凭据引用',clearCredentialTitle:'清除当前凭据引用？',clearCredentialText:'确定清除当前凭据引用吗？仅解绑配置中的引用并清空草稿，不会删除系统凭据库中的共享凭据；保存前请重新填写账号密码或改选无需认证。',clearCredentialConfirm:'确认清除',keep:'保留已设置凭据；输入框留空不会清除它。',configured:'凭据已设置（不会回显内容）',missing:'尚未设置凭据',loading:'正在检查凭据状态…',unknown:'暂无法确认凭据状态',readonly:'现有凭据来自只读来源；更换会创建独立凭据，不覆盖原值。',readOnlySettings:'当前连接的设置不可用或只读。',advanced:'高级设置',optional:'可选',basicAuthEnv:'凭据引用',basicAuthEnvHint:'仅在需要复用已有系统凭据引用时填写。',engineGroup:'引擎组',customEngines:'自定义引擎',timeoutMs:'超时（毫秒）',group_default:'服务器默认引擎',group_auto:'按查询语言自动选择',group_en:'英文引擎',group_zh:'中文引擎',group_custom:'自定义引擎',hint:"输入已部署的 SearXNG 服务地址（留空则关闭联网搜索）。账号密码仅存于系统凭据管理，不会写入普通配置文件。",save:'保存',cancel:'取消',saving:'保存中…',saved:'已保存',reload:'重新载入',reloadedToast:'已重新载入最新配置',footerStale:'有未保存的修改，请先重新载入',cleanState:'当前无未保存修改',unsavedChanges:'有未保存的修改',closeToast:'关闭',saveFailedFallback:'设置未保存成功，请核对后重试。',httpWarning:'HTTP 连接不会加密账号密码；若使用公网实例，建议改用 HTTPS 以保障安全。',httpConsent:'我理解并允许向此地址通过 HTTP 发送凭据。',diagTitle:'连接与诊断',lastCheckedAt:'最近检查 {time}',lastCheckedNever:'尚未检查',dirtyDiagHint:'当前有未保存的修改；请先保存配置，再测试已保存实例的连接状态。',inspect:'检查配置状态',check:'测试连接',diag:'连接结果',scope:"本页仅管理 SearXNG 实例连接。如需在对话中默认使用此实例，请前往官方「网页搜索与获取」设置中将其设为搜索来源。",raw:'原始技术诊断',schema:'已安装字段与默认值',staleReport:'已保存设置发生变化；以下为之前的检查结果，请重新检查。',passed:"连接测试通过",degraded:'搜索可用，但存在警告',blocked:'未通过连接测试',cancelled:'检查已取消或超时',busy:'已有检查正在进行',inspected:'配置状态已检查',disabled:'尚未配置地址，搜索已禁用',unknownDiagnostic:'发现诊断异常，请展开下方原始技术诊断查看详情。',diagFailedFallback:'暂时无法完成检查，请稍后重试。',unsupported:'当前套件版本不支持自助凭据和检查功能；请更新套件并重新打开应用。'};
  const messages={
   SAVED:['Saved','已保存'],STALE:['Settings changed elsewhere. Nothing was saved to avoid overwriting; reload before editing again.','编辑期间配置已在别处变更，本次未保存以避免覆盖；请先重新载入后再修改。'],INVALID:['Invalid settings. Check URL, reference, engine names and timeout.','配置不合法，请检查地址、引用、引擎和超时。'],BASIC_REQUIRED:['Enter a username and password or reuse a configured reference.','请设置账号密码，或复用已配置的凭据引用。'],BASIC_INVALID:['Enter both fields. The username cannot contain a colon or a line break.','请完整输入用户名和密码；用户名不能含冒号或换行。'],CREDENTIAL_MISSING:['This reference has no credential. Set username and password here.','此引用没有凭据，请在本页设置账号密码。'],CREDENTIAL_STATE_UNKNOWN:['Credential presence could not be confirmed; nothing was written.','无法确认凭据状态，尚未写入。'],CREDENTIAL_REFERENCE_COLLISION:['Could not allocate a fresh writable credential reference. Reload and retry.','无法分配独立可写引用，请重新载入。'],CREDENTIAL_WRITE_REJECTED:['Could not save credentials; settings were not changed. Please try again later.','这次凭据没有保存成功，设置未变化，请稍后重试。'],CREDENTIAL_WRITE_UNCONFIRMED:['Credential write could not be confirmed; settings were not switched. Reload before retrying.','无法确认凭据是否已保存；设置未切换，请先重新载入。'],CREDENTIAL_STORED_SETTINGS_STALE:['New credential stored, but settings changed elsewhere. Original reference was not overwritten. Reload to review.','新凭据已保存，但设置已在别处变化；未覆盖原凭据引用，请重新载入确认。'],CREDENTIAL_STORED_SETTINGS_UNCONFIRMED:['New credential stored; settings save could not be confirmed. Reload to review. Do not blindly retry or delete credentials.','新凭据已保存，但无法确认设置是否提交；请重新载入核对，不要盲目重试或删除凭据。'],SETTINGS_UNCONFIRMED:['Settings save could not be confirmed. Reload to review before retrying.','无法确认设置是否提交，请先重新载入核对。'],CANCELLED:['Operation cancelled; no further writes will be started.','操作已取消，不再发起后续写入。'],CREDENTIAL_STORED_CANCELLED:['Operation cancelled after a credential or settings write. Reload to review the outcome.','凭据或配置写入后操作被取消，请重新载入核对结果。'],HTTP_CONSENT_REQUIRED:['Use HTTPS or explicitly acknowledge HTTP credential transport.','请使用 HTTPS，或明确确认通过 HTTP 发送凭据的风险。'],NAMESPACE_UNAVAILABLE:['Web search is currently unavailable, so no check was started. Confirm Web Search is enabled on the official Plugins page, then reopen settings.','搜索功能暂不可用，这次没有发起检查。请到官方插件页确认「联网搜索」已启用，再重新打开设置。'],UNAVAILABLE:['Settings are unavailable or read-only in this connection.','当前连接的设置不可用或只读。'],DIAGNOSTIC_UNAVAILABLE:['Diagnostic response unavailable; no check result is confirmed.','无法取得诊断响应，未确认检查结果。'],SETUP_BUILD_UNSUPPORTED:[en.unsupported,zh.unsupported]
  };
  const diagnostics={CONFIG_MISSING:['Configure a service address.','请填写服务地址。'],CUSTOM_ENGINES_MISSING:['Set custom engines before selecting custom mode.','选择自定义引擎时需填写名称。'],CREDENTIAL_MISSING:['Set the required username and password.','请设置所需账号密码。'],CREDENTIAL_LOOKUP_FAILED:['Credential presence lookup failed.','凭据状态检查失败。'],CREDENTIAL_ERROR:['Credential lookup or Basic format failed; replace username and password.','凭据解析或 Basic 格式失败，请核对或更换账号密码。'],UNENCRYPTED_TRANSPORT:['HTTP traffic is not encrypted. Prefer HTTPS for credentials or private queries.','HTTP 通信未加密；发送凭据或私密查询时建议使用 HTTPS。'],HTTP_AUTH_REQUIRED:['HTTP 401: check username/password and proxy authentication.','HTTP 401：请检查账号密码和代理认证。'],HTTP_FORBIDDEN:['HTTP 403: check access policy and SearXNG JSON permission; the cause is not proven.','HTTP 403：请检查访问策略和 JSON 权限，不能仅凭此状态确定原因。'],HTTP_ERROR:['Server/proxy returned an HTTP error.','服务器或代理返回 HTTP 错误。'],RESPONSE_NOT_JSON:['The instance returned non-JSON data. Check the URL, proxy, and JSON output setting.','实例未返回 JSON，请检查服务地址、代理和 JSON 输出设置。'],RESPONSE_SHAPE_INVALID:['The response is not a compatible SearXNG results object.','响应不是兼容的 SearXNG 搜索结果。'],RESPONSE_TOO_LARGE:['The response exceeds the 2 MiB safety limit.','响应超过 2 MiB 安全限制。'],NETWORK_FAILED:['Connection failed. Check your network, TLS, and instance status.','连接失败，请检查网络、TLS 和实例状态。'],EMPTY_RESULTS:['No results; review engine selection and language routing.','没有结果，请检查引擎和语言选择。'],QUALITY_SUSPECT:['The instance responded, but results did not match expectations. Check its search engine settings.','实例虽有响应，但返回结果与预期不符，请检查实例的搜索引擎配置。'],ENGINE_DEGRADED:['Some engines did not respond.','部分引擎未响应。'],FALLBACK_USED:['No results from the selected engines; tried a fallback engine group (auto: other language; explicit group: server defaults).','所选引擎暂无结果，系统已尝试切换至备用引擎组重新检索（自动组换语言；指定组用服务器默认）。'],EXPECTED_CONFIGURATION_MISMATCH:['Saved settings changed before the check started, so no search was sent. Reload and confirm.','检查开始前配置已变化，没有发出搜索请求；请重新载入后确认。'],CONFIGURATION_CHANGED:['Settings changed during the check; repeat with current settings.','检查期间配置变化，请按当前设置重新检查。'],CHECK_BUSY:[en.busy,zh.busy],CHECK_TIMEOUT:['Connection test timed out. Check your network or instance responsiveness and try again.','连接测试超时，请检查网络或实例响应速度后重试。'],CHECK_CANCELLED:['The check was cancelled.','检查已取消。'],SETUP_CLOSED:['The plugin owner is unloaded.','插件已停用。'],INSPECTION_CANCELLED:['Credential inspection was cancelled.','凭据状态检查已取消。']};
  Object.assign(diagnostics,{ENGINE_CONFIG_UNAVAILABLE:['Explicit engine selection needs this instance\'s /config catalogue. Check proxy access or choose server defaults.','指定引擎模式需要读取该实例的 /config 清单；请检查代理权限，或改选服务器默认引擎。'],ENGINE_CONFIG_INVALID:['The /config catalogue must declare exact engine names and enabled flags. Search hits alone do not prove this.','/config 清单须声明精确引擎名称和 enabled 状态；搜索有结果并不能证明名字有效。'],ENGINE_NAME_UNKNOWN:['A custom name is not declared by this instance. Correct it from /config; no search or silent default fallback was sent.','该实例未声明某个自定义名称；请从 /config 核对修正。本次未发搜索或静默默认回退。'],ENGINE_GROUP_UNAVAILABLE:['No enabled engines exist for this language group. Review server engines, custom names, or choose server defaults.','该语言组没有可用引擎；请核对服务器引擎列表、自定义引擎名称，或改选服务器默认引擎。'],CUSTOM_ENGINES_INVALID:['Enter valid nonempty custom names.','请填写合法且非空的自定义名称。']});
  const bounded=(promise,signal)=>withTimeout(promise,CLIENT_READ_TIMEOUT_MS,{signal,code:'OPERATION_UNCONFIRMED',message:'OPERATION_UNCONFIRMED',abortCode:'OPERATION_UNCONFIRMED'}).catch(()=>{throw new Error('OPERATION_UNCONFIRMED');});
  const formatClock=()=>{const now=new Date();return String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0');};
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
   const form=ctx.configForms.get(NS),subscribe=listener=>form.subscribe(listener),snapshot=()=>form.getSnapshot();
   const setupWire={namespace:null};
   // The generated methods consume the AbortSignal themselves; the Host check owns its deadline.
   const callSetup=createRemoteCaller(setupWire,{timeoutMs:0});
   function Result({t,report,revision,reportRevision}){
    const index=t('title')===zh.title?1:0,inspection=report?.inspection??report;
    if(!report)return null;
    const codes=[...new Set([...(inspection?.codes??[]),...(report.codes??[]),...(report.probes??[]).flatMap(p=>p.codes)])];
    const verdict=report.state==='ready'?'passed':report.state==='degraded'?'degraded':report.state==='blocked'?'blocked':report.state==='cancelled'?'cancelled':report.state==='busy'?'busy':inspection?.configuration?.endpointConfigured?'inspected':'disabled';
    const tone=report.state==='ready'?'ok':report.state==='blocked'?'err':report.state?'warn':(inspection?.configuration?.endpointConfigured&&codes.length===0?'ok':'warn');
    const role=tone==='ok'?'status':'alert';
    return h('section',{'data-testid':'searxng-setup-result','aria-label':t('diag'),className:'omni-ui-stack'},
     h(StatusLine,{'data-testid':'searxng-connection-summary',tone,role},t(verdict)),
     reportRevision!==revision&&h(Banner,{tone:'warn',role:'status','data-testid':'searxng-stale-report'},t('staleReport')),
     codes.length>0&&h('ul',{className:'omni-ui-stack'},...codes.map(code=>h('li',{key:code,className:'omni-ui-hint'},diagnostics[code]?.[index]??t('unknownDiagnostic')))),
     ...(report.probes??[]).map(probe=>h('p',{key:probe.language,className:'omni-ui-hint'},(probe.language==='zh'?(index?'中文':'Chinese'):(index?'英文':'English'))+': '+probe.sourceCount+' '+(index?'条结果':'results')+' · '+probe.elapsedMs+' ms · HTTP '+(probe.httpStatus??'—'))),
     h(DiagnosticDisclosure,{title:t('raw'),preTestId:'searxng-setup-report',text:JSON.stringify({...report,schemaJson:undefined,inspection:report.inspection?{...report.inspection,schemaJson:undefined}:undefined},null,2)},
      inspection?.schemaJson?h(DiagnosticDisclosure,{title:t('schema'),text:inspection.schemaJson}):null));
   }
   function SearchPage({t}){
    const live=React.useSyncExternalStore(subscribe,snapshot,snapshot),[edit,setEdit]=React.useState(null),[auth,setAuth]=React.useState(null),[credentialEditor,setCredentialEditor]=React.useState(false),[username,setUsername]=React.useState(''),[password,setPassword]=React.useState(''),[httpConsent,setHttpConsent]=React.useState(''),[notice,setNotice]=React.useState(''),[activeOp,setActiveOp]=React.useState(null),[report,setReport]=React.useState(null),[reportRevision,setReportRevision]=React.useState(null),[setupError,setSetupError]=React.useState(null),[lastChecked,setLastChecked]=React.useState(null),[presence,setPresence]=React.useState({ref:'',state:'unknown',writable:true});
    const mounted=React.useRef(true),lock=React.useRef(false),operation=React.useRef(null),confirmRef=React.useRef(null),toastRef=React.useRef(null),index=t('title')===zh.title?1:0;
    const busy=activeOp!==null,isStale=notice==='STALE'||notice==='CREDENTIAL_STORED_SETTINGS_STALE';
    const clearSecrets=()=>{if(mounted.current){setUsername('');setPassword('');}};
    React.useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;operation.current?.abort();confirmRef.current?.close();toastRef.current?.close();};},[]);
    // 0.2.1 removed the snapshot's host/memory split: `writable` is the single answer to "may this page
    // write the Host document", so requiring a `mode` field that no longer exists left every form disabled.
    const ready=live.status==='ready'&&live.writable,value=edit?.value??live.value??{},authMode=auth??(value.basicAuthEnv?'basic':'none'),ref=value.basicAuthEnv??'';
    React.useEffect(()=>{let active=true;const controller=new AbortController();
     const refresh=async()=>{if(!ref){if(active)setPresence({ref,state:'missing',writable:true});return;}if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(ref)){setPresence({ref,state:'unknown',writable:false});return;}
      setPresence({ref,state:'loading',writable:true});try{const values=unwrapRemoteResult(await bounded(ctx.remote.credentials.describe([ref]),controller.signal));if(active)setPresence({ref,state:values[ref]?(values[ref].configured?'configured':'missing'):'unknown',writable:values[ref]?.writable!==false});}catch(_){if(active)setPresence({ref,state:'unknown',writable:false});}};
     void refresh();const off=ctx.remote.$on('credentials/reference-updated',changed=>{if(changed===ref)void refresh();});return()=>{active=false;controller.abort();off();};
    },[ref]);
    const pinDraft=()=>setEdit(previous=>previous??{value:{...live.value},revision:live.revision,changed:[]});
    const change=(field,next)=>{if(!isStale)setNotice('');if(field==='baseUrl'||field==='basicAuthEnv')setHttpConsent('');setEdit(previous=>({value:{...(previous?.value??live.value),[field]:next},revision:previous?.revision??live.revision,changed:[...new Set([...(previous?.changed??[]),field])]}));};
    const discard=()=>{confirmRef.current?.close();confirmRef.current=null;clearSecrets();setEdit(null);setAuth(null);setCredentialEditor(false);setHttpConsent('');setNotice('');};
    const reload=()=>{discard();toastRef.current?.close();toastRef.current=showToast({kind:NS,text:t('reloadedToast'),tone:'ok',closeLabel:t('closeToast')});};
    const diagnose=async(action,signal,revision)=>{const saved=snapshot();if(saved.revision!==revision)throw new Error('EXPECTED_CONFIGURATION_MISMATCH');const v=saved.value,expected={baseUrl:v.baseUrl,basicAuthEnv:v.basicAuthEnv,engineGroup:v.engineGroup,customEngines:v.customEngines,timeoutMs:v.timeoutMs};const nextReport=action==='check'?await callSetup('checkSaved',expected,signal):await callSetup('inspect',signal);if(mounted.current){setReport(nextReport);setReportRevision(revision);setLastChecked(formatClock());}};
    const run=async action=>{if(lock.current)return;lock.current=true;setActiveOp(action);setSetupError(null);setReport(null);setReportRevision(null);const controller=new AbortController();operation.current=controller;try{if(!remoteReady){setSetupError({code:'SETUP_BUILD_UNSUPPORTED',raw:'SETUP_BUILD_UNSUPPORTED'});return;}if(!setupWire.namespace){if(mounted.current)setSetupError({code:'NAMESPACE_UNAVAILABLE',raw:'SUITE_NAMESPACE_MISSING '+(action==='check'?'checkSaved':'inspect')});return;}const saved=snapshot().value;if(action==='check'&&flowReady&&FLOW.requiresHttpConsent(saved,saved.basicAuthEnv?'basic':'none')&&httpConsent!==saved.baseUrl){setSetupError({code:'HTTP_CONSENT_REQUIRED',raw:'HTTP_CONSENT_REQUIRED'});return;}await diagnose(action,controller.signal,snapshot().revision);}catch(issue){if(mounted.current){const raw=issue&&issue.message?String(issue.message):String(issue??'');const code=!remoteReady?'SETUP_BUILD_UNSUPPORTED':raw==='EXPECTED_CONFIGURATION_MISMATCH'?'EXPECTED_CONFIGURATION_MISMATCH':'DIAGNOSTIC_UNAVAILABLE';setSetupError({code,raw:raw||code});}}finally{lock.current=false;if(mounted.current)setActiveOp(null);}};
    const validateSettings=next=>{const section=ctx.configForms.describe().getSnapshot().view?.namespaces.find(row=>row.ns===NS);return !!section&&ctx.settingsSchema.validate(ctx.settingsSchema.rehydrate(section.schema),next)===undefined&&(next.engineGroup!=='custom'||!!String(next.customEngines??'').trim());};
    const save=async()=>{
     if(lock.current||isStale)return;lock.current=true;setActiveOp('save');setNotice('');const controller=new AbortController();operation.current=controller;
     try{
      if(!flowReady){
       // Defined legacy downgrade: keep ordinary ConfigForms saves, never advertise credential writes/tests.
       if(!ready||!edit){setNotice('SETUP_BUILD_UNSUPPORTED');return;}
       if(snapshot().revision!==edit.revision){setNotice('STALE');return;}
       if(!validateSettings(edit.value)){setNotice('INVALID');return;}
       const accepted=await bounded(form.mutate(edit.changed.map(field=>({op:'set',path:[field],value:edit.value[field]})),edit.revision),controller.signal);
       if(mounted.current){setNotice(accepted?'SAVED':'SETTINGS_UNCONFIRMED');if(accepted){setEdit(null);toastRef.current?.close();toastRef.current=showToast({kind:NS,text:messages.SAVED[index],tone:'ok',closeLabel:t('closeToast')});}}return;
      }
      const outcome=await FLOW.saveConnection({value,changed:edit?.changed??[],expectedRevision:edit?.revision??live.revision,authMode,username,password,signal:controller.signal,httpConsent:httpConsent===value.baseUrl},{snapshot,clearSecrets,newRef:()=>'OMNISURGE_SEARXNG_AUTH_'+crypto.randomUUID().replaceAll('-','').toUpperCase(),validate:validateSettings,describe:reference=>bounded(ctx.remote.credentials.describe([reference]),controller.signal),set:(reference,literal)=>bounded(ctx.remote.credentials.set(reference,literal),controller.signal),mutate:(ops,revision)=>bounded(form.mutate(ops,revision),controller.signal)});
      if(!mounted.current)return;setNotice(outcome.code);
      if(outcome.committed){setEdit(null);setAuth(null);setCredentialEditor(false);toastRef.current?.close();toastRef.current=showToast({kind:NS,text:messages.SAVED[index],tone:'ok',closeLabel:t('closeToast')});}
     }catch(_){if(mounted.current)setNotice('SETTINGS_UNCONFIRMED');}finally{clearSecrets();lock.current=false;if(mounted.current)setActiveOp(null);}
    };
    const askClearCredential=(trigger=null)=>{
     if(!ready||busy||!flowReady||!ref)return;
     confirmRef.current?.close();
     confirmRef.current=showConfirm({
      title:t('clearCredentialTitle'),
      text:t('clearCredentialText'),
      cancelLabel:t('cancel'),
      confirmLabel:t('clearCredentialConfirm'),
      tone:'danger',
      returnFocusTo:trigger,
      onCancel:()=>{confirmRef.current=null;},
      onConfirm:()=>{
       confirmRef.current=null;
       pinDraft();
       setAuth('basic');
       clearSecrets();
       setHttpConsent('');
       if(!isStale)setNotice('');
       setCredentialEditor(true);
       setEdit(previous=>({
        value:{...(previous?.value??live.value),basicAuthEnv:''},
        revision:previous?.revision??live.revision,
        changed:[...new Set([...(previous?.changed??[]),'basicAuthEnv'])],
       }));
      },
     });
    };
    const dirty=edit!==null||auth!==null||username!==''||password!=='';
    const unsafeHttp=flowReady&&FLOW.requiresHttpConsent(value,authMode);
    const savedHttpConsentMissing=flowReady&&FLOW.requiresHttpConsent(live.value??{},live.value?.basicAuthEnv?'basic':'none')&&httpConsent!==live.value?.baseUrl;
    const draftHttpConsentMissing=unsafeHttp&&httpConsent!==value.baseUrl;
    const httpConsentMissing=savedHttpConsentMissing||draftHttpConsentMissing;
    const credStateKey=presence.ref===ref?presence.state:'unknown';
    const credTone=credStateKey==='configured'?'ok':credStateKey==='missing'?'warn':credStateKey==='loading'?'loading':'err';
    const saveStatus=!ready
     ?h(StatusLine,{'data-testid':'searxng-save-result',tone:'warn',role:'alert'},messages.UNAVAILABLE[index])
     :notice==='SAVED'
      ?h(StatusLine,{'data-testid':'searxng-save-result',tone:'ok',role:'status'},messages.SAVED[index])
      :isStale
       ?h(StatusLine,{'data-testid':'searxng-footer-status',tone:'warn',role:'status'},t('footerStale'))
       :notice
        ?h('div',{className:'omni-ui-stack'},
          h(StatusLine,{'data-testid':'searxng-save-result',tone:notice==='CANCELLED'?'warn':'err',role:'alert'},messages[notice]?.[index]??t('saveFailedFallback')),
          h(DiagnosticDisclosure,{testId:'searxng-save-raw',title:t('raw'),text:notice}))
        :h(StatusLine,{'data-testid':'searxng-save-result',tone:'neutral',role:'status'},dirty?t('unsavedChanges'):t('cleanState'));
    const credentialBlock=h('section',{className:'omni-ui-stack omni-ui-sectionDivider','aria-label':t('basic')},
     h(StatusLine,{'data-testid':'searxng-credential-status',tone:credTone},t(credStateKey)),
     presence.ref===ref&&presence.state==='configured'&&presence.writable===false&&h('p',{className:'omni-ui-hint'},t('readonly')),
     h('p',{className:'omni-ui-hint'},t('keep')),
     h(ActionGroup,{align:'start'},
      h(Button,{variant:'default',size:'sm','data-testid':'searxng-toggle-credential',disabled:!ready||busy||!flowReady,onClick:()=>{pinDraft();clearSecrets();setCredentialEditor(previous=>!ref?true:!previous);}},ref&&credentialEditor?t('collapseCredential'):t('replace')),
      ref&&h(Button,{variant:'danger-ghost',size:'sm','data-testid':'searxng-clear-credential',disabled:!ready||busy||!flowReady,onClick:e=>askClearCredential(e.currentTarget)},t('clearCredential'))),
     (credentialEditor||!ref)&&h(FormGrid,{columns:'2'},
      h(Field,{label:t('username')},h(TextInput,{name:'basicUsername',type:'text',value:username,disabled:!ready||busy||!flowReady,autoComplete:'off',spellCheck:false,onChange:e=>{pinDraft();setUsername(e.target.value);}})),
      h(Field,{label:t('password')},h(TextInput,{name:'basicPassword',type:'password',value:password,disabled:!ready||busy||!flowReady,autoComplete:'new-password',onChange:e=>{pinDraft();setPassword(e.target.value);}}))),
     unsafeHttp&&h(Banner,{tone:'warn',role:'note'},
      h('p',null,t('httpWarning')),
      h(Checkbox,{label:t('httpConsent'),checked:httpConsent===value.baseUrl,disabled:!ready||busy,onChange:e=>setHttpConsent(e.target.checked?value.baseUrl:'')})));
    return h('form',{className:'omni-ui-tokens omni-ui-stack',onSubmit:e=>{e.preventDefault();if(!busy&&ready&&dirty&&!isStale)void save();},noValidate:true,'aria-label':t('title')},
     h(ConfigPage,{
       available:true,
       writable:ready,
       dirty,
       invalid:!ready||busy||isStale,
       saving:busy,
       labels:{unavailable:t('disabled'),readOnly:t('readOnlySettings'),saveFailed:t('saveFailedFallback'),saving:activeOp==='save'?t('saving'):t('save'),save:t('save'),cancel:t('cancel')},
       onSave:()=>void save(),
       onCancel:discard,
       onDiscard:discard,
       footerLead:saveStatus,
      },
      h(Banner,{tone:'neutral',role:'note'},t('hint')),
      (!remoteReady||!flowReady)&&h(Banner,{tone:'warn',role:'status','data-testid':'searxng-setup-unsupported'},
       h('p',null,t('unsupported')),
       h(DiagnosticDisclosure,{title:t('raw'),text:'SETUP_BUILD_UNSUPPORTED'})),
      ready&&isStale&&h(Banner,{tone:'warn',role:'status','data-testid':'searxng-save-stale'},
       h('div',{className:'omni-ui-stack'},
        h('span',{'data-testid':'searxng-save-result'},messages[notice]?.[index]??t('saveFailedFallback')),
        h(ActionGroup,{align:'start'},
         h(Button,{'data-testid':'searxng-reload',variant:'default',size:'sm',disabled:busy,onClick:reload},t('reload'))),
        h(DiagnosticDisclosure,{testId:'searxng-save-raw',title:t('raw'),text:notice}))),
      h(FormGrid,{columns:'2'},
       h(Field,{label:t('baseUrl'),hint:t('baseUrlHint')},
        h(TextInput,{name:'baseUrl',type:'text',inputMode:'url',className:'omni-ui-mono',placeholder:'https://search.example.internal',value:value.baseUrl??'',disabled:!ready||busy,autoComplete:'off',spellCheck:false,onChange:e=>change('baseUrl',e.target.value)})),
       h(Field,{label:t('auth')},
        h(Select,{name:'authentication','aria-label':t('auth'),value:authMode,disabled:!ready||busy||!flowReady,onChange:e=>{pinDraft();setAuth(e.target.value);clearSecrets();setHttpConsent('');if(!isStale)setNotice('');setCredentialEditor(e.target.value==='basic'&&!ref);}},
         h('option',{value:'none'},t('none')),
         h('option',{value:'basic'},t('basic'))))),
      authMode==='basic'&&credentialBlock,
      h(Disclosure,{'data-testid':'searxng-advanced',title:t('advanced'),defaultOpen:false},
       h(FormGrid,{columns:'2'},
        h(Field,{label:t('engineGroup')},
         h(Select,{name:'engineGroup',value:value.engineGroup??'default',disabled:!ready||busy,onChange:e=>change('engineGroup',e.target.value)},
          ...groups.map(group=>h('option',{key:group,value:group},t('group_'+group))))),
        h(Field,{label:t('customEngines'),optionalLabel:value.engineGroup==='custom'?undefined:t('optional')},
         h(TextInput,{name:'customEngines',type:'text',value:value.customEngines??'',disabled:!ready||busy,autoComplete:'off',spellCheck:false,onChange:e=>change('customEngines',e.target.value)})),
        h(Field,{label:t('timeoutMs')},
         h(NumberInput,{name:'timeoutMs',value:value.timeoutMs??'',disabled:!ready||busy,autoComplete:'off',min:100,max:60000,step:1,onChange:e=>change('timeoutMs',e.target.value===''?'':Number(e.target.value))})),
        h(Field,{label:t('basicAuthEnv'),optionalLabel:t('optional'),hint:t('basicAuthEnvHint')},
         h(TextInput,{name:'basicAuthEnv',type:'text',className:'omni-ui-mono',value:value.basicAuthEnv??'',disabled:!ready||busy,autoComplete:'off',spellCheck:false,onChange:e=>{change('basicAuthEnv',e.target.value);if(flowReady&&e.target.value)setAuth('basic');}})))),
      h('p',{className:'omni-ui-hint'},t('scope'))),
     h('section',{'data-testid':'searxng-setup-panel',className:'omni-ui-stack omni-ui-sectionDivider'},
      h('div',{className:'omni-ui-cardTitleRow'},
       h('h4',{className:'omni-ui-subhead'},t('diagTitle')),
       h('span',{className:'omni-ui-cardMeta','data-testid':'searxng-last-checked'},lastChecked?fillTemplate(t('lastCheckedAt'),{time:lastChecked}):t('lastCheckedNever'))),
      dirty&&h(Banner,{tone:'warn',role:'status','data-testid':'searxng-dirty-diagnostic-hint'},t('dirtyDiagHint')),
      h(ActionGroup,{align:'start'},
       h(Button,{variant:'default',busy:activeOp==='check',disabled:busy||!remoteReady||dirty||!value.baseUrl||httpConsentMissing,'data-testid':'searxng-check-btn',onClick:()=>void run('check')},t('check')),
       h(Button,{variant:'ghost',busy:activeOp==='inspect',disabled:busy||!remoteReady,'data-testid':'searxng-inspect-btn',onClick:()=>void run('inspect')},t('inspect'))),
      setupError!==null&&h(Banner,{tone:'err',role:'alert','data-testid':'searxng-setup-error'},
       h('span',null,messages[setupError.code]?.[index]??diagnostics[setupError.code]?.[index]??t('diagFailedFallback')),
       h(DiagnosticDisclosure,{title:t('raw'),preTestId:'searxng-setup-report',text:setupError.raw})),
      h(Result,{t,report,revision:live.revision,reportRevision})));
   }
   function Form({t,view}){
    if(view==='summary')return t('summary');
    if(view!==undefined&&view!=='page')return null;
    return h(SearchPage,{t});
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
     setupWire.namespace=scope.remote.omnisurgeSearxngSetup;
     return()=>{setupWire.namespace=null;};
   }),'searxng: hold the Remote namespace while the Host serves it');
   contribute(ctx);
 }
