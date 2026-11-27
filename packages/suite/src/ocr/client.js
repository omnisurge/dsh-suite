import * as React from 'react';
import {ActionGroup,Badge,Banner,Button,CapsuleSwitch,EmptyState,Field,ListRow,SettingsCard,StatusLine,Switch,TextInput,injectStyles,registerSettingsPluginCard,showToast} from '@omnisurge/dsh-ui';
import {DocumentParseCard} from '../document-parse/client.js';
import {CLIENT_ACTION_TIMEOUT_MS,CLIENT_READ_TIMEOUT_MS,withTimeout} from '../remote-timeout.js';
import {fillTemplate as fill} from '../shared/client-copy.js';
import {unwrapRemoteResult as unwrap} from '../shared/client-remote.js';
import {DiagnosticDisclosure} from '../shared/DiagnosticDisclosure.js';
import {CREDENTIAL_SAVE_BLOCKED,CREDENTIAL_SAVE_EMPTY,CREDENTIAL_SAVE_FAILED,CREDENTIAL_SAVE_OK,CREDENTIAL_SAVE_PARTIAL,credentialRolesText,saveCredentialRoles} from '../credential-save.js';

/** The multimodal capability card. The host draws the outer settings card; this component is its body.
 * Supplier selection belongs to the agent at recognition time; the card only configures which suppliers
 * are connected and holds their credentials. */
export const inject=['slots','locale','remote','remote.credentials'];
const NS='omnisurge.ocr';
const REMOTE='omnisurgeSuiteDev';
const ROOT='omni-ui-tokens omni-ui-stack';
const PROVIDER_LINKS={
 tencent:{service:'https://console.cloud.tencent.com/ocr/general',keys:'https://console.cloud.tencent.com/cam/capi'},
 baidu:{service:'https://console.bce.baidu.com/ai-engine/ocr/overview/index',keys:'https://console.bce.baidu.com/ai-engine/ocr/app/list'},
};

const en={
 title:'Multimodal input',
 description:'Handwriting and scanned-document recognition. Credentials are saved in system credential management and will not be shown here again.',
 axisLabel:'Capability axis',axisInput:'Multimodal input',axisOutput:'Multimodal output',
 axisEmptyTitle:'No multimodal output capability yet',
 axisEmptyDesc:'Image generation, video generation, and similar capabilities will appear here once available.',
 handwritingTitle:'Handwriting recognition',handwritingSubtitle:'Handwriting and scanned-document recognition · multimodal input',
 providerLabel:'Provider',providerTencent:'Tencent Cloud',providerBaidu:'Baidu Intelligent Cloud',
 providerAccessTitle:'Provider access',
 providerAccessHint:'During recognition, the assistant chooses from configured providers automatically; unconfigured ones are not used.',
 providerConfigured:'Configured',providerNotConfigured:'Not configured',capabilityAvailable:'Available',capabilityNeedsSetup:'Needs setup',capabilityDisabled:'Not enabled',
 configureCredentials:'Configure credentials',hideCredentials:'Hide credentials',cancel:'Cancel',closeToast:'Close',rawDetails:'Original technical diagnostics',
 credentialsTitle:'Credentials',
 credentialsHidden:'Credentials are hidden by default for privacy. Select Configure credentials on a provider to enter them; the form collapses after saving.',
 credentialHint:'Paste the credential from the provider console. Stored by reference only, never in the configuration file.',
 credentialPresent:'saved',credentialAbsent:'not set',save:'Save credentials',saveBusy:'Saving…',
 officialLinkHint:'Need a key?',openService:'Open console',openKeys:'Request an API key',
 saveDone:'Saved to system credential management; plain values will not be shown here again.',saveDoneRoles:'Saved {roles} to system credential management; plain values will not be shown here again.',saveFailed:'Could not save credentials. Please try again later.',saveEmpty:'Enter at least one credential before saving.',saveBlocked:'Nothing was saved: these credential values cannot be written from this page ({roles}).',saveFailedRole:'Nothing was saved: {role} was refused. Check the value and retry.',savePartial:'Saved {saved}; not saved {failed}. Enter the failed value and retry.',
 usageTitle:'Usage',
 quotaValue:'{calls} calls · {pages} pages · {lines} lines on this machine. Check the provider console for remaining quota.',
 providerUsage:'This machine: {calls} calls · {pages} pages · {lines} lines',
 providerUsageEmpty:'No calls recorded on this machine yet',
 statusTestTitle:'Status test',
 statusTestButton:'Test status',statusTestBusy:'Testing…',
 statusTestHint:'Uses the most recent conversation image to call this provider and consumes 1 recognition quota unit.',
 statusTestNoImage:'No conversation image is available for a status test.',statusTestNeedEnabled:'Turn handwriting recognition on before running a test.',statusTestTimeout:'The test timed out after 30 seconds. Check your network or provider status and try again.',
 statusTestDone:'Last test: {lines} line(s) · {seconds}s',
 statusTestFailed:'The status test did not complete. Check the credentials, then try again.',
 channelAccurate:'High precision',channelHandwriting:'Handwriting',
 switchLabel:'Turn this capability on',switchHint:'Off by default. When enabled, images are sent to the selected provider and may consume quota.',switchFailed:'Could not change the switch. Please try again.',
 loadFailedCode:'Could not read the current state. Reopen the settings panel and try again.',loadFailed:'Could not read the current state. Reopen the settings panel and try again.',loadFailedNamespace:'Temporarily unable to reach the background service. Reopen the settings panel and try again.',loading:'Reading current state…',
 summaryReady:'Ready {ready} · Not configured {missing}',
 summaryOn:'On (ready {ready} · not configured {missing})',summaryOff:'Off',summaryUnavailable:'unavailable',
 summaryHandwriting:'Handwriting: {state}',summaryDocumentParse:'Document parsing: {state}',summaryPair:'{handwriting} · {documentParse}',
 caveat:'Handwriting recognition can be affected by messy or joined strokes. The assistant uses context to fill gaps, but please verify names, numbers, and key conclusions against the original page image.',
};
const zh={
 title:'多模态能力',
 description:'手写与扫描件识别。凭据值由系统凭据管理保存，本页此后不再显示。',
 axisLabel:'能力轴',axisInput:'多模态输入',axisOutput:'多模态输出',
 axisEmptyTitle:'多模态输出还没有可用能力',
 axisEmptyDesc:'图片生成、视频生成等能力上线后会显示在这里。',
 handwritingTitle:'手写识别',handwritingSubtitle:'手写与扫描件识别 · 多模态输入',
 providerLabel:'服务商',providerTencent:'腾讯云',providerBaidu:'百度智能云',
 providerAccessTitle:'服务商接入',
 providerAccessHint:'识别时，助手会自动从已配置的服务商中选择调用，未配置的服务商不会参与。',
 providerConfigured:'已配置',providerNotConfigured:'未配置',capabilityAvailable:'可用',capabilityNeedsSetup:'待配置',capabilityDisabled:'未启用',
 configureCredentials:'配置凭据',hideCredentials:'收起凭据',cancel:'取消',closeToast:'关闭',rawDetails:'原始技术诊断',
 credentialsTitle:'凭据',
 credentialsHidden:'为保护隐私，密钥默认隐藏。点击对应服务商的「配置凭据」即可填写，保存后会自动收起。',
 credentialHint:'把服务商控制台里的凭据粘进来。仅按引用保存，不会写入配置文件。',
 credentialPresent:'已保存',credentialAbsent:'未设置',save:'保存凭据',saveBusy:'保存中…',
 officialLinkHint:'还没有密钥？',openService:'打开控制台',openKeys:'申请 API 密钥',
 saveDone:'已妥善保存至系统凭据管理，本页面不会再显示明文。',saveDoneRoles:'已保存 {roles}。凭据值由系统凭据管理保存，本页面不会再显示明文。',saveFailed:'这次凭据没有保存成功，请稍后重试。',saveEmpty:'请至少填写一项凭据再保存。',saveBlocked:'没有写入任何值：这些凭据在当前页面不可写（{roles}）。',saveFailedRole:'没有写入任何值：{role} 被拒绝。请核对后重试。',savePartial:'已保存 {saved}；未保存 {failed}。请补填未保存的值后重试。',
 usageTitle:'用量',
 quotaValue:'本机已调用 {calls} 次 · {pages} 页 · {lines} 行。剩余额度以服务商控制台为准。',
 providerUsage:'本机：{calls} 次 · {pages} 页 · {lines} 行',
 providerUsageEmpty:'本机暂无调用记录',
 statusTestTitle:'状态测试',
 statusTestButton:'测试状态',statusTestBusy:'测试中…',
 statusTestHint:'测试会使用最近一次对话中的图片调用该服务商，并消耗 1 次识别额度。',
 statusTestNoImage:'当前没有可用于状态测试的会话图片。',statusTestNeedEnabled:'请先开启手写识别开关再测试。',statusTestTimeout:'测试超过 30 秒未响应，请检查网络或服务商状态后重试。',
 statusTestDone:'上次测试：识别 {lines} 行 · 用时 {seconds} 秒',
 statusTestFailed:'状态测试没有完成，请检查凭据后重试。',
 channelAccurate:'高精度',channelHandwriting:'手写体',
 switchLabel:'启用这项能力',switchHint:'默认关闭。开启后，识别内容会发送至所选服务商并消耗相应额度，建议按需启用。',switchFailed:'开关没有改成功，请重试。',
 loadFailedCode:'读不到当前状态，请重新打开设置面板后再试。',loadFailed:'读不到当前状态，请重新打开设置面板后再试。',loadFailedNamespace:'页面暂时连不上后台服务，请重新打开设置面板后再试。',loading:'正在读取当前状态…',
 summaryReady:'可用 {ready} · 未配置 {missing}',
 summaryOn:'已启用（可用 {ready} · 未配置 {missing}）',summaryOff:'未启用',summaryUnavailable:'暂不可读',
 summaryHandwriting:'手写识别：{state}',summaryDocumentParse:'文档解析：{state}',summaryPair:'{handwriting} · {documentParse}',
 caveat:'手写识别易受字迹潦草或连笔影响，难以做到完全准确。助手会结合上下文尽量补全，但涉及人名、数字和验收结论时，仍建议对照原图核对。',
};
/** Exposed for the mount fixture only: the card is registered with this same dictionary pair. */
export const OCR_LOCALE={en,zh};
Object.assign(en,{
 documentParseTitle:'Document parsing',documentParseSubtitle:'Parse PDF and image documents into Markdown, JSON or artifacts.',documentParseSwitch:'Turn document parsing on',documentParseSwitchHint:'Off by default. When enabled, documents are sent to the selected provider for parsing and may consume quota.',
 providerMineru:'MinerU',providerPaddleOcr:'PaddleOCR',documentParseMode:'Mode',documentParseConfigured:'Configured',documentParseNotConfigured:'Not configured',documentParseAgentReady:'Agent ready (no key)',documentParseApiNeedsKey:'Configure an API Key before testing API mode.',
 modeMineruAgent:'Agent, no token (default)',modeMineruApi:'API, requires API key',modePaddleVl16:'PaddleOCR-VL-1.6',modePaddleOcrv6:'PP-OCRv6',modePaddleStructureAsync:'PP-StructureV3 async',
 documentParseSave:'Save credentials',documentParseSaveBusy:'Saving…',documentParseSaved:'Saved to system credential management; plain values will not be shown here again.',documentParseSaveDoneRoles:'Saved {roles} to system credential management; plain values will not be shown here again.',documentParseSaveFailed:'Could not save credentials. Please try again later.',documentParseSaveBlocked:'Nothing was saved: these credential references cannot be written from this page ({roles}).',documentParseSaveFailedRole:'Nothing was saved: {role} was refused. Check the value and retry.',documentParseSavePartial:'Saved {saved}; not saved {failed}. Enter the failed value and retry.',documentParseCredentialHint:'Stored by reference; this page never shows the value again.',
 documentParseUsage:'This machine: {calls} tasks · {pages} pages',documentParseUsageEmpty:'No parse tasks recorded on this machine yet',documentParseTest:'Test status',documentParseTestHint:'Calls the selected provider with a public sample PDF and may consume quota.',documentParseTestUnsupported:'Add a sample file in the conversation before testing.',documentParseTestRunning:'Testing…',documentParseTestDone:'Last test: {mode} · {pages} · {seconds}s',documentParseTestPageUnit:'page(s)',documentParseTestPagesUnknown:'page count unavailable',documentParseTestFailed:'Last status test did not pass. Check your credentials and try again.',documentParseTestNeedEnabled:'Turn document parsing on before running a test.',documentParseSwitchFailed:'The document parsing switch could not be changed. Try again.',documentParseTestTimeout:'The test timed out after {seconds} seconds. Check your network or provider status and try again.',documentParseTestTimeoutAgent:'MinerU shared queue did not respond within {seconds} seconds. Switch to API mode or try again later.',documentParseLastError:'Last attempt did not complete. Expand diagnostics below for details.',documentParseLoadFailed:'Could not read document parsing status. Reopen the settings panel and try again.',documentParseProviderAccessHint:'During parsing, the assistant selects from configured providers and modes; unconfigured ones are not used. MinerU Agent is a shared token-free queue and may wait; configuring an API Key prioritizes API mode.',documentParseCaveat:'Document parsing quality depends on the source layout; verify names, numbers and conclusions against the original.',documentParseNeedKey:'Need a key?',documentParseMineruKey:'Get a MinerU API Key',documentParsePaddleKey:'Get a PaddleOCR Token',
});
Object.assign(zh,{
 documentParseTitle:'文档解析',documentParseSubtitle:'把 PDF 和图片文档解析为 Markdown、JSON 或可下载结果。',documentParseSwitch:'启用文档解析',documentParseSwitchHint:'默认关闭。开启后，文档会发送至所选服务商进行解析，可能消耗对应额度。',
 providerMineru:'MinerU',providerPaddleOcr:'PaddleOCR',documentParseMode:'模式',documentParseConfigured:'已配置',documentParseNotConfigured:'未配置',documentParseAgentReady:'Agent 免密可用',documentParseApiNeedsKey:'API 精准模式需要先配置 API Key 再测试。',
 modeMineruAgent:'Agent 免密（默认）',modeMineruApi:'API 精准（需 API Key）',modePaddleVl16:'PaddleOCR-VL-1.6',modePaddleOcrv6:'PP-OCRv6',modePaddleStructureAsync:'PP-StructureV3 异步',
 documentParseSave:'保存凭据',documentParseSaveBusy:'保存中…',documentParseSaved:'已妥善保存至系统凭据管理，本页面不会再显示明文。',documentParseSaveDoneRoles:'已保存 {roles}。凭据值由系统凭据管理保存，本页面不会再显示明文。',documentParseSaveFailed:'这次凭据没有保存成功，请稍后重试。',documentParseSaveBlocked:'没有写入任何值：这些凭据引用在当前页面不可写（{roles}）。',documentParseSaveFailedRole:'没有写入任何值：{role} 被拒绝。请核对后重试。',documentParseSavePartial:'已保存 {saved}；未保存 {failed}。请补填未保存的值后重试。',documentParseCredentialHint:'只保存引用；本页不会再次显示凭据值。',
 documentParseUsage:'本机：{calls} 个任务 · {pages} 页',documentParseUsageEmpty:'本机暂无文档解析记录',documentParseTest:'测试状态',documentParseTestHint:'测试会使用公开示例 PDF 调用所选服务商，可能消耗一次额度。',documentParseTestUnsupported:'请先在对话中提供一份样本文档。',documentParseTestRunning:'测试中…',documentParseTestDone:'最近测试：{mode} · {pages} · {seconds} 秒',documentParseTestPageUnit:'页',documentParseTestPagesUnknown:'页数未提供',documentParseTestFailed:'最近一次状态测试未通过，请检查凭据后重试。',documentParseTestNeedEnabled:'请先开启文档解析开关再测试。',documentParseSwitchFailed:'文档解析开关没有改成功，请重试。',documentParseTestTimeout:'测试超过 {seconds} 秒未响应，请检查网络或服务商状态后重试。',documentParseTestTimeoutAgent:'MinerU 公共免密队列超过 {seconds} 秒未响应，请切换到 API 精准模式或稍后重试。',documentParseLastError:'最近一次测试未通过，可展开下方诊断查看详情。',documentParseLoadFailed:'读不到文档解析状态，请重新打开设置面板后再试。',documentParseProviderAccessHint:'解析时，助手会从已配置的服务商和模式中选择调用；未配置的不参与。MinerU Agent 是公共免密队列，可能需要排队；配置 API Key 后优先使用 API 精准模式。',documentParseCaveat:'文档解析结果受版面质量影响；人名、数字、验收结论等关键内容请对照原文确认。',documentParseNeedKey:'还没有密钥？',documentParseMineruKey:'获取 MinerU API Key',documentParsePaddleKey:'获取 PaddleOCR Token',
});
const roleLabel=role=>role==='apiKey'?'API Key':role==='secretId'?'SecretId':role==='secretKey'?'SecretKey':role;
const channelLabel=(channel,t)=>channel==='handwriting'?t('channelHandwriting'):t('channelAccurate');
const countReady=providerStates=>{
 const list=providerStates?Object.values(providerStates):[];
 const ready=list.filter(state=>state?.configured===true).length;
 return {total:list.length,ready,missing:Math.max(0,list.length-ready)};
};
export function OcrCard({t,wire,view}){
 const [caps,setCaps]=React.useState(null);
 const [docCaps,setDocCaps]=React.useState(null);
 const [docPhase,setDocPhase]=React.useState(()=>view==='summary'&&typeof wire?.documentParseCapabilities==='function'?'loading':'absent');
 const [issue,setIssue]=React.useState(null);
 const [loadCode,setLoadCode]=React.useState(null);
 const [switchCode,setSwitchCode]=React.useState(null);
 const [loadPhase,setLoadPhase]=React.useState('loading');
 const [axis,setAxis]=React.useState('input');
 const [expanded,setExpanded]=React.useState(null);
 const [drafts,setDrafts]=React.useState({});
 const [save,setSave]=React.useState(null);
 const [saveNotice,setSaveNotice]=React.useState(null);
 const [samples,setSamples]=React.useState([]);
 const [tests,setTests]=React.useState({});
 const [toggling,setToggling]=React.useState(false);
 React.useEffect(()=>{
  let cancelled=false;
  wire.capabilities().then(value=>{if(!cancelled){setCaps(value);setIssue(null);setLoadCode(null);setLoadPhase('ready');}},failure=>{if(!cancelled){setIssue('loadFailed');setLoadCode(failure&&failure.code?String(failure.code):null);setLoadPhase('failed');}});
  return()=>{cancelled=true;};
 },[wire]);
 React.useEffect(()=>{
  if(view!=='summary')return undefined;
  if(typeof wire?.documentParseCapabilities!=='function'){
   setDocCaps(null);
   setDocPhase('absent');
   return undefined;
  }
  let cancelled=false;
  setDocPhase('loading');
  wire.documentParseCapabilities().then(
   value=>{if(!cancelled){setDocCaps(value);setDocPhase('ready');}},
   ()=>{if(!cancelled){setDocCaps(null);setDocPhase('failed');}},
  );
  return()=>{cancelled=true;};
 },[wire,view]);
 React.useEffect(()=>{
  if(view==='summary'||typeof wire?.recentImages!=='function')return undefined;
  let cancelled=false;
  wire.recentImages().then(value=>{if(!cancelled&&Array.isArray(value))setSamples(value);}).catch(()=>{});
  return()=>{cancelled=true;};
 },[wire,view]);
 const loadText=()=>loadCode==='OCR_NAMESPACE_UNAVAILABLE'?t('loadFailedNamespace'):loadCode===null?t('loadFailed'):t('loadFailedCode');
 if(view==='summary'){
  const hwCounts=countReady(caps?.providerStates);
  const ready=hwCounts.total>0?hwCounts.ready:(caps?.configured===true?1:0);
  const missing=hwCounts.total>0?hwCounts.missing:(caps?.configured===true?0:1);
  const docCounts=countReady(docCaps?.providerStates);
  let line;
  if(loadPhase==='loading'||docPhase==='loading'){
   line=t('loading');
  }else if(loadPhase==='failed'&&(docPhase==='absent'||docPhase==='failed')){
   line=loadText();
  }else{
   const hwState=caps===null?t('summaryUnavailable'):(caps.enabled===true?fill(t('summaryOn'),{ready,missing}):t('summaryOff'));
   const dpState=docCaps===null?t('summaryUnavailable'):(docCaps.enabled===true?fill(t('summaryOn'),{ready:docCounts.ready,missing:docCounts.missing}):t('summaryOff'));
   line=fill(t('summaryPair'),{
    handwriting:fill(t('summaryHandwriting'),{state:hwState}),
    documentParse:fill(t('summaryDocumentParse'),{state:dpState}),
   });
  }
  return React.createElement('p',{className:'omni-ui-hint','data-testid':'ocr-summary'},line);
 }
 const providers=caps&&Array.isArray(caps.providers)&&caps.providers.length>0?caps.providers:[{id:caps?.provider??'tencent',displayKey:'providerTencent',channels:['accurate','handwriting']}];
 const states=caps?.providerStates??{};
 const providerName=option=>{
  const key=option.displayKey??(option.id==='baidu'?'providerBaidu':'providerTencent');
  const translated=t(key);
  return translated===key?(option.id==='baidu'?t('providerBaidu'):t('providerTencent')):translated;
 };
 const providerState=option=>states[option.id]??(option.id===(caps?.provider??'tencent')&&caps?{id:option.id,refs:caps.refs??{},configured:caps.configured===true,credentials:caps.credentials??null,usage:caps.usage??null}:null);
 const setDraft=(provider,role,value)=>setDrafts(current=>({...current,[provider]:{...(current[provider]??{}),[role]:value}}));
 const cancelCredentialForm=providerId=>{
  setExpanded(null);
  setDrafts(current=>({...current,[providerId]:{}}));
  setSave(current=>current&&current.provider===providerId?null:current);
 };
 const saveProvider=async option=>{
  const state=providerState(option);
  setSaveNotice(null);
  if(state===null){setSave({provider:option.id,phase:'failed'});setSaveNotice({tone:'err',text:t('saveFailed')});return;}
  const entries=Object.entries(state.refs).map(([role,ref])=>({role,ref,value:drafts[option.id]?.[role]}));
  setSave({provider:option.id,phase:'busy'});
  const outcome=await saveCredentialRoles(entries,{describe:wire.describeCredentials,set:wire.set});
  if(outcome.status===CREDENTIAL_SAVE_EMPTY){setSave({provider:option.id,phase:'failed',code:'EMPTY'});setSaveNotice({tone:'err',text:t('saveEmpty')});return;}
  if(outcome.status===CREDENTIAL_SAVE_BLOCKED){
   setSave({provider:option.id,phase:'failed',code:'PRECHECK',roles:outcome.blockedRoles});
   setSaveNotice({tone:'err',text:fill(t('saveBlocked'),{roles:credentialRolesText(outcome.blockedRoles,roleLabel)})});
   return;
  }
  if(outcome.status===CREDENTIAL_SAVE_FAILED){
   setSave({provider:option.id,phase:'failed',failedRole:outcome.failedRole});
   setSaveNotice({tone:'err',text:fill(t('saveFailedRole'),{role:roleLabel(outcome.failedRole)})});
   return;
  }
  const refresh=async()=>{try{const next=await wire.capabilities();setCaps(next);}catch{}};
  if(outcome.status===CREDENTIAL_SAVE_PARTIAL){
   setSave({provider:option.id,phase:'partial',roles:outcome.savedRoles,failedRole:outcome.failedRole});
   setSaveNotice({tone:'err',text:fill(t('savePartial'),{saved:credentialRolesText(outcome.savedRoles,roleLabel),failed:roleLabel(outcome.failedRole)})});
   const saved=new Set(outcome.savedRoles);
   setDrafts(current=>({...current,[option.id]:Object.fromEntries(Object.entries(current[option.id]??{}).filter(([role])=>!saved.has(role)))}));
   await refresh();
   return;
  }
  if(outcome.status===CREDENTIAL_SAVE_OK){
   await refresh();
   const savedText=fill(t('saveDoneRoles'),{roles:credentialRolesText(outcome.savedRoles,roleLabel)});
   setDrafts(current=>({...current,[option.id]:{}}));setSave({provider:option.id,phase:'done'});setSaveNotice({tone:'ok',text:savedText});setExpanded(null);
   showToast({tone:'ok',kind:'ocr-credentials-'+option.id,text:savedText,closeLabel:t('closeToast')});
   return;
  }
  setSave({provider:option.id,phase:'failed',code:outcome.reason??'FAILED'});setSaveNotice({tone:'err',text:t('saveFailed')});
 };
 const credentialForm=(option,state)=>{
  const saveBusy=save!==null&&save.provider===option.id&&save.phase==='busy';
  return React.createElement('div',{className:'omni-ui-roleForm','data-testid':'ocr-credentials-'+option.id},
   Object.entries(state.refs).map(([role])=>React.createElement(Field,{key:role,label:roleLabel(role),hint:t('credentialHint')},
    React.createElement(TextInput,{type:'password',autoComplete:'new-password',value:drafts[option.id]?.[role]??'','data-testid':'ocr-credential-'+role,placeholder:state.credentials&&state.credentials[role]?.configured===true?t('credentialPresent'):t('credentialAbsent'),onChange:event=>setDraft(option.id,role,event.target.value)}))),
   (()=>{const links=PROVIDER_LINKS[option.id];return links?React.createElement('p',{className:'omni-ui-hint','data-testid':'ocr-provider-links-'+option.id},
    t('officialLinkHint'),' ',
    React.createElement('a',{className:'omni-ui-link',href:links.service,target:'_blank',rel:'noreferrer','data-testid':'ocr-provider-service-'+option.id},t('openService')),
    ' · ',
    React.createElement('a',{className:'omni-ui-link',href:links.keys,target:'_blank',rel:'noreferrer','data-testid':'ocr-provider-keys-'+option.id},t('openKeys'))):null;})(),
   React.createElement(ActionGroup,{align:'start'},
    React.createElement(Button,{'data-testid':'ocr-save-'+option.id,variant:'primary',size:'sm',busy:saveBusy,onClick:()=>void saveProvider(option)},saveBusy?t('saveBusy'):t('save')),
    React.createElement(Button,{'data-testid':'ocr-cancel-'+option.id,variant:'ghost',size:'sm',disabled:saveBusy,onClick:()=>cancelCredentialForm(option.id)},t('cancel'))),
   save!==null&&save.provider===option.id&&save.phase==='done'?React.createElement(StatusLine,{tone:'ok'},t('saveDone')):null,
   save!==null&&save.provider===option.id&&save.phase==='failed'?React.createElement(StatusLine,{tone:'err',role:'alert'},save.code==='EMPTY'?t('saveEmpty'):t('saveFailed')):null);
 };
 const testProvider=async option=>{
  if(caps?.enabled!==true){setTests(current=>({...current,[option.id]:{phase:'failed',code:'OCR_DISABLED'}}));return;}
  const sample=samples[0]??null;
  if(sample===null){setTests(current=>({...current,[option.id]:{phase:'failed',code:'OCR_NO_IMAGE'}}));return;}
  setTests(current=>({...current,[option.id]:{phase:'busy'}}));
  try{
   const result=await withTimeout(()=>wire.recognize({attachment:sample.attachment,mode:'both',reconcile:true,provider:option.id}),30000,{code:'OCR_TEST_TIMEOUT',message:'OCR_TEST_TIMEOUT'});
   const seconds=((result.channels??[]).reduce((sum,channel)=>sum+(Number(channel.ms)||0),0)/1000).toFixed(1);
   setTests(current=>({...current,[option.id]:{phase:'done',lines:(result.lines??[]).length,seconds}}));
  }catch(failure){setTests(current=>({...current,[option.id]:{phase:'failed',code:failure&&failure.code?String(failure.code):'OCR_FAILED'}}));}
 };
 const testLine=option=>{
  const result=tests[option.id];
  if(result===undefined)return null;
  if(result.phase==='busy')return React.createElement(StatusLine,{tone:'loading','data-testid':'ocr-test-result-'+option.id},t('statusTestBusy'));
  if(result.phase==='done')return React.createElement(StatusLine,{tone:'ok','data-testid':'ocr-test-result-'+option.id},fill(t('statusTestDone'),result));
  const message=result.code==='OCR_NO_IMAGE'?t('statusTestNoImage'):result.code==='OCR_DISABLED'?t('statusTestNeedEnabled'):result.code==='OCR_TEST_TIMEOUT'?t('statusTestTimeout'):t('statusTestFailed');
  return React.createElement('div',{className:'omni-ui-stack','data-testid':'ocr-test-failure-'+option.id},
   React.createElement(StatusLine,{tone:'err',role:'alert','data-testid':'ocr-test-result-'+option.id},message),
   result.code?React.createElement(DiagnosticDisclosure,{testId:'ocr-test-raw-'+option.id,title:t('rawDetails'),text:String(result.code)}):null);
 };
 const providerRows=providers.map(option=>{
  const state=providerState(option);
  const configured=state?.configured===true;
  const open=expanded===option.id;
  const usage=state?.usage;
  const usageText=usage===null||usage===undefined?t('providerUsageEmpty'):fill(t('providerUsage'),{calls:Number(usage.calls)||0,pages:Number(usage.pages)||0,lines:Number(usage.lines)||0});
  const channelsText=(option.channels??[]).map(channel=>channelLabel(channel,t)).join(' · ');
  const test=tests[option.id];
  const metaNode=React.createElement('span',null,
   channelsText?React.createElement('span',{key:'channels'},channelsText):null,
   channelsText?' · ':null,
   React.createElement('span',{key:'usage','data-testid':'ocr-usage-'+option.id},usageText));
  const actionsNode=React.createElement(ActionGroup,null,
   React.createElement(Button,{variant:'default',size:'sm','data-testid':'ocr-configure-'+option.id,onClick:()=>open?cancelCredentialForm(option.id):setExpanded(option.id)},open?t('hideCredentials'):t('configureCredentials')),
   React.createElement(Button,{variant:'default',size:'sm','data-testid':'ocr-test-status-'+option.id,busy:test!==undefined&&test.phase==='busy',disabled:!configured||caps?.enabled!==true||test?.phase==='busy',onClick:()=>void testProvider(option)},test!==undefined&&test.phase==='busy'?t('statusTestBusy'):t('statusTestButton')));
  return React.createElement(ListRow,{
   key:option.id,
   'data-testid':'ocr-provider-'+option.id,
   title:providerName(option),
   badge:React.createElement(Badge,{tone:configured?'ok':'warn','data-testid':'ocr-provider-status-'+option.id},configured?t('providerConfigured'):t('providerNotConfigured')),
   meta:metaNode,
   actions:actionsNode,
  },
  React.createElement('div',{className:'omni-ui-listFacts','data-testid':'ocr-facts-'+option.id},
   React.createElement('p',{className:'omni-ui-hint'},t('statusTestHint')),
   caps?.enabled!==true?React.createElement('p',{className:'omni-ui-hint','data-testid':'ocr-test-disabled-hint-'+option.id},t('statusTestNeedEnabled')):null,
   testLine(option),
   open&&state!==null?credentialForm(option,state):null));
 });
 const setEnabled=async next=>{
  setToggling(true);
  try{const nextCaps=await wire.setEnabled(next);setCaps(nextCaps);setIssue(null);setSwitchCode(null);}
  catch(failure){setIssue('switchFailed');setSwitchCode(failure&&failure.code?String(failure.code):null);}
  finally{setToggling(false);}
 };
 const issueDiagnostic=issue==='loadFailed'?loadCode:switchCode;
 const issueLine=issue===null?null:React.createElement(Banner,{tone:'err',role:'alert','data-testid':'ocr-issue'},
  React.createElement('span',{'data-testid':'ocr-issue-message'},issue==='loadFailed'?loadText():t(issue)),
  issueDiagnostic?React.createElement(DiagnosticDisclosure,{testId:'ocr-issue-raw',title:t('rawDetails'),text:String(issueDiagnostic)}):null);
 const configuredStates=caps?.providerStates?Object.values(caps.providerStates):[];
 const hasConfigured=configuredStates.length>0?configuredStates.some(state=>state?.configured===true):caps?.configured===true;
 const enabled=caps?.enabled===true;
 const statusTone=!enabled?'muted':hasConfigured?'ok':'warn';
 const statusText=!enabled?t('capabilityDisabled'):hasConfigured?t('capabilityAvailable'):t('capabilityNeedsSetup');
 const card=React.createElement(SettingsCard,{collapsible:true,defaultOpen:true,'data-testid':'ocr-capability-card',title:t('handwritingTitle'),description:t('handwritingSubtitle'),badge:React.createElement(Badge,{tone:statusTone,'data-testid':'ocr-status'},statusText)},
  React.createElement(Switch,{'data-testid':'ocr-enabled',align:'between',busy:toggling,checked:enabled,disabled:toggling||caps===null,label:t('switchLabel'),description:t('switchHint'),onChange:event=>void setEnabled(event.target.checked)}),
  loadPhase==='loading'?React.createElement(StatusLine,{tone:'loading','data-testid':'ocr-loading'},t('loading')):null,
  issueLine,
  React.createElement('div',{className:'omni-ui-stack','data-testid':'ocr-provider-access'},
   React.createElement('p',{className:'omni-ui-cardTitle'},t('providerAccessTitle')),
   React.createElement('p',{className:'omni-ui-hint'},t('providerAccessHint')),
   React.createElement('ul',{className:'omni-ui-list omni-ui-list--flush','data-testid':'ocr-provider-list'},...providerRows),
   saveNotice===null?null:React.createElement(StatusLine,{tone:saveNotice.tone,role:saveNotice.tone==='err'?'alert':'status','data-testid':'ocr-save-notice'},saveNotice.text)),
  React.createElement('div',{className:'omni-ui-stack','data-testid':'ocr-credentials-note'},
   React.createElement('p',{className:'omni-ui-cardTitle'},t('credentialsTitle')),
   React.createElement('p',{className:'omni-ui-hint'},t('credentialsHidden'))),
  React.createElement('p',{className:'omni-ui-hint','data-testid':'ocr-caveat'},t('caveat')));
 const documentParseCard=React.createElement(DocumentParseCard,{t,wire});
 const body=axis==='output'
  ?React.createElement('div',{'data-testid':'ocr-axis-empty'},React.createElement(EmptyState,{surface:'inline',align:'center',title:t('axisEmptyTitle'),description:t('axisEmptyDesc')}))
  :React.createElement('div',{className:'omni-ui-cardList'},card,documentParseCard);
 return React.createElement('section',{className:ROOT,'data-testid':'ocr-card'},
  React.createElement('div',{'data-testid':'ocr-axis-switch'},React.createElement(CapsuleSwitch,{options:[{id:'input',label:t('axisInput')},{id:'output',label:t('axisOutput')}],value:axis,onChange:setAxis,'aria-label':t('axisLabel')})),
  body);
}
/** The page-side transport seam. Exported for the mount fixture: the production apply() passes the live
 * namespace and the official credential service, while a fixture can pass a stalled namespace and prove
 * that every read settles with a readable timeout instead of a permanent loading state. */
export function createOcrWire({namespace,credentials,readTimeoutMs=CLIENT_READ_TIMEOUT_MS,actionTimeoutMs=CLIENT_ACTION_TIMEOUT_MS}){
 const remote=()=>{const value=typeof namespace==='function'?namespace():namespace;if(value===undefined||value===null)throw Object.assign(new Error('OCR_NAMESPACE_UNAVAILABLE'),{code:'OCR_NAMESPACE_UNAVAILABLE'});return value;};
 const credential=()=>{if(credentials===undefined||credentials===null||typeof credentials.set!=='function')throw Object.assign(new Error('OCR_CREDENTIALS_UNAVAILABLE'),{code:'OCR_CREDENTIALS_UNAVAILABLE'});return credentials;};
 const call=async(operation,task,timeoutMs)=>unwrap(await withTimeout(task,timeoutMs,{code:'OCR_REMOTE_TIMEOUT',message:'OCR_REMOTE_TIMEOUT '+operation}));
 const json=async(...args)=>JSON.parse(JSON.stringify(await call(...args)));
 const setCredential=async(reference,value)=>{await call('credential-set',()=>credential().set(reference,value),actionTimeoutMs);};
 return {
  capabilities:()=>json('capabilities',()=>remote().ocrCapabilities(),readTimeoutMs),
  recentImages:async()=>{const value=typeof namespace==='function'?namespace():namespace;if(value===undefined||value===null||typeof value.ocrRecentImages!=='function')return [];return json('recentImages',()=>value.ocrRecentImages(),readTimeoutMs);},
  recognize:input=>json('recognize',()=>remote().ocrRecognize(input),actionTimeoutMs),
  set:setCredential,
  setCredential,
  describeCredentials:references=>json('credential-describe',()=>{const service=credential();if(typeof service.describe!=='function')throw Object.assign(new Error('OCR_CREDENTIALS_DESCRIBE_UNAVAILABLE'),{code:'OCR_CREDENTIALS_DESCRIBE_UNAVAILABLE'});return service.describe(references);},readTimeoutMs),
  setEnabled:enabled=>json('setEnabled',()=>remote().ocrSetEnabled(enabled),actionTimeoutMs),
  documentParseCapabilities:()=>json('documentParseCapabilities',()=>remote().documentParseCapabilities(),readTimeoutMs),
  documentParse:input=>json('documentParse',()=>remote().documentParse(input),300000),
  documentParseSetEnabled:enabled=>json('documentParseSetEnabled',()=>remote().documentParseSetEnabled(enabled),actionTimeoutMs),
 };
}
export function apply(ctx){
 ctx.effect(()=>ctx.locale.register(NS,{en,zh}),'omnisurge: OCR card locale');
 ctx.effect(()=>{injectStyles();},'omnisurge: OCR card token sheet');
 const namespaceRef={current:null};
 ctx.effect(()=>{
  const scoped=ctx.inject(['remote','remote.omnisurgeSuiteDev'],inner=>{namespaceRef.current=inner.remote[REMOTE];return()=>{namespaceRef.current=null;};});
  return()=>{namespaceRef.current=null;void scoped.dispose();};
 },'omnisurge: hold the OCR Remote namespace while the Host serves it');
 ctx.inject(['slots','locale','remote','remote.credentials'],inner=>{
  const t=inner.locale.bind(NS);
  const wire=createOcrWire({namespace:()=>namespaceRef.current,credentials:inner.remote.credentials});
  registerSettingsPluginCard(inner,{id:NS,order:40,label:()=>t('title'),locale:NS,inject:()=>({t,wire})},OcrCard);
 });
}
