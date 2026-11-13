import * as React from 'react';
import {ActionGroup,Badge,Button,CapsuleSwitch,EmptyState,Field,SettingsCard,StatusLine,Switch,TextInput,registerSettingsPluginCard} from '@omnisurge/dsh-ui';
import {DocumentParseCard} from '../document-parse/client.js';

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
 description:'Handwriting and scanned-document recognition. Values are stored by the official credential store; this page never shows them again.',
 axisLabel:'Capability axis',axisInput:'Multimodal input',axisOutput:'Multimodal output',
 axisEmptyTitle:'No multimodal output capability yet',
 axisEmptyDesc:'Image generation, video generation and similar capabilities will appear here when they land; no placeholder cards or fake switches.',
 handwritingTitle:'Handwriting recognition',handwritingSubtitle:'Handwriting and scanned-document recognition · multimodal input',
 providerLabel:'Supplier',providerTencent:'Tencent Cloud',providerBaidu:'Baidu Intelligent Cloud',
 providerAccessTitle:'Supplier access',
 providerAccessHint:'When the assistant recognizes, it chooses among configured suppliers. Unconfigured suppliers do not participate.',
 providerConfigured:'Configured',providerNotConfigured:'Not configured',capabilityAvailable:'Available',
 configureCredentials:'Configure credentials',hideCredentials:'Hide credentials',
 credentialsTitle:'Credentials',
 credentialsHidden:'Hidden by default. Choose Configure credentials on a supplier to enter its two values; saving collapses the form.',
 credentialHint:'Paste the value from the supplier console. Stored by reference, never in the configuration file.',
 credentialPresent:'saved',credentialAbsent:'not set',save:'Save credentials',saveBusy:'Saving…',
 officialLinkHint:'Need a key?',openService:'Open the OCR console',openKeys:'Request an API key',
 saveDone:'Saved. Values are in the credential store; this page will not show them again.',saveFailed:'The credential store refused the write.',saveEmpty:'Enter at least one credential before saving.',
 usageTitle:'Usage',
 quotaValue:'{calls} calls · {pages} pages · {lines} lines on this machine. Remaining quota is shown in the supplier console.',
 providerUsage:'This machine: {calls} calls · {pages} pages · {lines} lines',
 providerUsageEmpty:'No calls recorded on this machine yet',
 statusTestTitle:'Status test',
 statusTestButton:'Test status',statusTestBusy:'Testing…',
 statusTestHint:'Calls this supplier interface using the most recent conversation image and spends one quota unit.',
 statusTestNoImage:'No conversation image is available for a status test.',statusTestNeedEnabled:'Turn this capability on before running a status test.',statusTestTimeout:'The status test timed out after 30 seconds; check the provider and try again.',
 statusTestDone:'Last test: {lines} line(s) · {seconds}s',
 statusTestFailed:'The status test did not complete: {code}. Check the credentials, then try again.',
 channelAccurate:'High precision',channelHandwriting:'Handwriting',
 switchLabel:'Turn this capability on',switchHint:'Off by default: recognition sends the page to the supplier and spends your quota. Turn it on only when you need it.',switchFailed:'Could not change the switch.',
 loadFailedCode:'Could not read the current state ({code}).',loadFailed:'Could not read the current state.',loadFailedNamespace:'The page is not connected to the Host service ({code}). Reopen the settings panel and try again.',
 summaryReady:'Ready {ready} · Not configured {missing}',
 summaryOn:'On (ready {ready} · not configured {missing})',summaryOff:'Switched off',
 caveat:'Handwriting recognition is limited by loose or joined strokes and cannot reproduce the page exactly. The assistant in the conversation recovers most unclear passages from context, but for names, numbers and acceptance conclusions, check the page image yourself.',
};
const zh={
 title:'多模态能力',
 description:'手写与扫描件识别。值由官方凭据库保存，这个页面此后不再显示它。',
 axisLabel:'能力轴',axisInput:'多模态输入',axisOutput:'多模态输出',
 axisEmptyTitle:'多模态输出还没有可用能力',
 axisEmptyDesc:'生图、生视频等能力落地后会出现在这里；不预埋空卡、不显示假开关。',
 handwritingTitle:'手写识别',handwritingSubtitle:'手写与扫描件识别 · 多模态输入',
 providerLabel:'供应商',providerTencent:'腾讯云',providerBaidu:'百度智能云',
 providerAccessTitle:'供应商接入',
 providerAccessHint:'识别时由 agent 在已接入的供应商中选择；未接入的不参与。',
 providerConfigured:'已配置',providerNotConfigured:'未配置',capabilityAvailable:'可用',
 configureCredentials:'配置凭据',hideCredentials:'收起凭据',
 credentialsTitle:'凭据',
 credentialsHidden:'默认不显示。点击对应供应商的「配置凭据」后展开两个值；保存后自动收起。',
 credentialHint:'把供应商控制台里的值粘进来。按引用保存，不写进配置文件。',
 credentialPresent:'已保存',credentialAbsent:'未设置',save:'保存凭据',saveBusy:'保存中…',
 officialLinkHint:'还没有密钥？',openService:'开通服务',openKeys:'申请 API 密钥',
 saveDone:'已保存。值在凭据库里，这个页面不会再显示它。',saveFailed:'凭据库拒绝了这次写入。',saveEmpty:'请至少填写一项凭据再保存。',
 usageTitle:'用量',
 quotaValue:'本机已调用 {calls} 次 · {pages} 页 · {lines} 行。剩余额度以供应商控制台为准。',
 providerUsage:'本机：{calls} 次 · {pages} 页 · {lines} 行',
 providerUsageEmpty:'本机暂无调用记录',
 statusTestTitle:'状态测试',
 statusTestButton:'测试状态',statusTestBusy:'测试中…',
 statusTestHint:'会调用该供应商接口，并使用最近一张会话图片，消耗一次额度。',
 statusTestNoImage:'当前没有可用于状态测试的会话图片。',statusTestNeedEnabled:'请先启用这项能力再测试。',statusTestTimeout:'状态测试 30 秒未返回，请检查供应商后重试。',
 statusTestDone:'上次测试：识别 {lines} 行 · 用时 {seconds} 秒',
 statusTestFailed:'状态测试没有完成：{code}。请检查凭据后重试。',
 channelAccurate:'高精度',channelHandwriting:'手写体',
 switchLabel:'启用这项能力',switchHint:'默认关闭：识别会把页面发到供应商并消耗你的额度。需要时再打开。',switchFailed:'开关没有改成功。',
 loadFailedCode:'读不到当前状态（{code}）。',loadFailed:'读不到当前状态。',loadFailedNamespace:'页面没有连接到后台服务（{code}），请重新打开设置面板后再试。',
 summaryReady:'可用 {ready} · 未配置 {missing}',
 summaryOn:'已启用（可用 {ready} · 未配置 {missing}）',summaryOff:'开关已关闭',
 caveat:'手写识别受书写潦草与连笔限制，无法百分百还原原文。对话中的助手能凭上下文补回大部分读不通的地方，但人名、数字、验收结论这类关键内容，仍建议你对着原图确认。',
};
Object.assign(en,{
 documentParseTitle:'Document parsing',documentParseSubtitle:'Parse PDF and image documents into Markdown, JSON or artifacts.',documentParseSwitch:'Turn document parsing on',documentParseSwitchHint:'Off by default: a parse sends the document to the selected provider and may spend its quota.',
 providerMineru:'MinerU',providerPaddleOcr:'PaddleOCR',documentParseMode:'Mode',documentParseConfigured:'Configured',documentParseNotConfigured:'Not configured',
 modeMineruAgent:'Agent, no token (default)',modeMineruApi:'API, requires API key',modePaddleVl16:'PaddleOCR-VL-1.6',modePaddleOcrv6:'PP-OCRv6',modePaddleStructureAsync:'PP-StructureV3 async',
 documentParseSave:'Save credentials',documentParseSaveBusy:'Saving…',documentParseSaved:'Saved. The value is held by the credential store.',documentParseSaveFailed:'The credential store refused the write.',documentParseCredentialHint:'Stored by reference; this page never shows the value again.',
 documentParseUsage:'This machine: {calls} tasks · {pages} pages',documentParseUsageEmpty:'No parse tasks recorded on this machine yet',documentParseTest:'Test status',documentParseTestHint:'A test calls the selected provider with the public demo PDF and may spend quota.',documentParseTestUnsupported:'Add a sample file in the conversation before testing.',documentParseTestRunning:'Testing…',documentParseTestDone:'Last test: {mode} · {pages} · {seconds}s',documentParseTestPageUnit:'page(s)',documentParseTestPagesUnknown:'page count unavailable',documentParseTestFailed:'Last test failed: {code}',documentParseTestNeedEnabled:'Turn document parsing on before running a test.',documentParseSwitchFailed:'The document parsing switch could not be changed. Try again.',documentParseTestTimeout:'The status test timed out after {seconds} seconds; try again later.',documentParseTestTimeoutAgent:'MinerU public Agent queue stayed pending for {seconds} seconds; switch to the API mode or try again later.',documentParseLastError:'Last attempt: {code}',documentParseLoadFailed:'Could not read document parsing status ({code}).',documentParseProviderAccessHint:'At parse time the assistant chooses one configured provider and mode; unconfigured providers do not participate. MinerU Agent is a shared token-free queue and may wait; when an API key is configured, the API mode is preferred.',documentParseCaveat:'Document parsing quality depends on the source layout; verify names, numbers and conclusions against the original.',documentParseNeedKey:'Need a key?',documentParseMineruKey:'Get a MinerU API Key',documentParsePaddleKey:'Get a PaddleOCR Token',
});
Object.assign(zh,{
 documentParseTitle:'文档解析',documentParseSubtitle:'把 PDF 和图片文档解析为 Markdown、JSON 或可下载结果。',documentParseSwitch:'启用文档解析',documentParseSwitchHint:'默认关闭：解析会把文档发到所选供应商，可能消耗其额度。',
 providerMineru:'MinerU',providerPaddleOcr:'PaddleOCR',documentParseMode:'模式',documentParseConfigured:'已配置',documentParseNotConfigured:'未配置',
 modeMineruAgent:'Agent 免密（默认）',modeMineruApi:'API 精准（需 API Key）',modePaddleVl16:'PaddleOCR-VL-1.6',modePaddleOcrv6:'PP-OCRv6',modePaddleStructureAsync:'PP-StructureV3 异步',
 documentParseSave:'保存凭据',documentParseSaveBusy:'保存中…',documentParseSaved:'已保存，值由凭据服务持有。',documentParseSaveFailed:'凭据服务拒绝了这次写入。',documentParseCredentialHint:'只保存引用；本页不会再次显示凭据值。',
 documentParseUsage:'本机：{calls} 个任务 · {pages} 页',documentParseUsageEmpty:'本机暂无文档解析记录',documentParseTest:'测试状态',documentParseTestHint:'测试会用公开示例 PDF 调用所选供应商，可能消耗额度。',documentParseTestUnsupported:'请先在对话中提供一份样本文档。',documentParseTestRunning:'测试中…',documentParseTestDone:'最近测试：{mode} · {pages} · {seconds} 秒',documentParseTestPageUnit:'页',documentParseTestPagesUnknown:'页数未提供',documentParseTestFailed:'最近测试失败：{code}',documentParseTestNeedEnabled:'请先启用文档解析再测试。',documentParseSwitchFailed:'文档解析开关没有改成功，请重试。',documentParseTestTimeout:'状态测试 {seconds} 秒未返回，请稍后重试。',documentParseTestTimeoutAgent:'MinerU 公共免密队列 {seconds} 秒未返回，请切换到 API 精准模式或稍后重试。',documentParseLastError:'最近一次：{code}',documentParseLoadFailed:'读不到文档解析状态（{code}）。',documentParseProviderAccessHint:'解析时由助手在已接入的供应商和模式中选择；未接入的不参与。MinerU Agent 是公共免密队列，可能长时间排队；配置 API Key 后优先使用 API 精准模式。',documentParseCaveat:'文档解析结果受版面质量影响；人名、数字、验收结论等关键内容请对照原文确认。',documentParseNeedKey:'还没有密钥？',documentParseMineruKey:'获取 MinerU API Key',documentParsePaddleKey:'获取 PaddleOCR Token',
});
const fill=(template,values)=>String(template).replace(/\{(\w+)\}/g,(match,key)=>(key in values?String(values[key]):match));
const roleLabel=role=>role==='apiKey'?'API Key':role==='secretId'?'SecretId':role==='secretKey'?'SecretKey':role;
const channelLabel=(channel,t)=>channel==='handwriting'?t('channelHandwriting'):t('channelAccurate');
function OcrCard({t,wire,view}){
 const [caps,setCaps]=React.useState(null);
 const [issue,setIssue]=React.useState(null);
 const [loadCode,setLoadCode]=React.useState(null);
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
  wire.capabilities().then(value=>{if(!cancelled)setCaps(value);}).catch(failure=>{if(!cancelled){setIssue('loadFailed');setLoadCode(failure&&failure.code?String(failure.code):null);}});
  return()=>{cancelled=true;};
 },[wire]);
 React.useEffect(()=>{
  if(view==='summary'||typeof wire.recentImages!=='function')return undefined;
  let cancelled=false;
  wire.recentImages().then(value=>{if(!cancelled&&Array.isArray(value))setSamples(value);}).catch(()=>{});
  return()=>{cancelled=true;};
 },[wire,view]);
 if(view==='summary'){
  const states=caps&&caps.providerStates?Object.values(caps.providerStates):[];
  const ready=states.length>0?states.filter(state=>state.configured===true).length:(caps?.configured===true?1:0);
  const missing=states.length>0?states.length-ready:(caps?.configured===true?0:1);
  const loadText=()=>loadCode==='OCR_NAMESPACE_UNAVAILABLE'?fill(t('loadFailedNamespace'),{code:loadCode}):loadCode===null?t('loadFailed'):fill(t('loadFailedCode'),{code:loadCode});
  const line=caps===null?loadText():caps.enabled===true?fill(t('summaryOn'),{ready,missing}):t('summaryOff');
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
 const saveProvider=async option=>{
  const state=providerState(option);
  setSaveNotice(null);
  if(state===null){setSave({provider:option.id,phase:'failed'});setSaveNotice({tone:'warn',text:t('saveFailed')});return;}
  const values=Object.entries(state.refs).map(([role])=>drafts[option.id]?.[role]).filter(value=>typeof value==='string'&&value.length>0);
  if(values.length===0){setSave({provider:option.id,phase:'failed',code:'EMPTY'});setSaveNotice({tone:'warn',text:t('saveEmpty')});return;}
  setSave({provider:option.id,phase:'busy'});
  try{
   for(const [role,ref] of Object.entries(state.refs)){
    const value=drafts[option.id]?.[role];
    if(typeof value==='string'&&value.length>0)await wire.set(ref,value);
   }
   const next=await wire.capabilities();
   setCaps(next);setDrafts(current=>({...current,[option.id]:{}}));setSave({provider:option.id,phase:'done'});setSaveNotice({tone:'ok',text:t('saveDone')});setExpanded(null);
  }catch{setSave({provider:option.id,phase:'failed'});setSaveNotice({tone:'warn',text:t('saveFailed')});}
 };
 const credentialForm=(option,state)=>React.createElement('div',{className:'omni-ui-stack','data-testid':'ocr-credentials-'+option.id},
  Object.entries(state.refs).map(([role,ref])=>React.createElement(Field,{key:role,label:roleLabel(role),hint:t('credentialHint')},
   React.createElement(TextInput,{type:'password',value:drafts[option.id]?.[role]??'','data-testid':'ocr-credential-'+role,placeholder:state.credentials&&state.credentials[role]?.configured===true?t('credentialPresent'):t('credentialAbsent'),onChange:event=>setDraft(option.id,role,event.target.value)}))),
  (()=>{const links=PROVIDER_LINKS[option.id];return links?React.createElement('p',{className:'omni-ui-hint','data-testid':'ocr-provider-links-'+option.id},
   t('officialLinkHint'),' ',
   React.createElement('a',{className:'omni-ui-link',href:links.service,target:'_blank',rel:'noreferrer','data-testid':'ocr-provider-service-'+option.id},t('openService')),
   ' · ',
   React.createElement('a',{className:'omni-ui-link',href:links.keys,target:'_blank',rel:'noreferrer','data-testid':'ocr-provider-keys-'+option.id},t('openKeys'))):null;})(),
  React.createElement(ActionGroup,null,React.createElement(Button,{'data-testid':'ocr-save-'+option.id,variant:'primary',busy:save!==null&&save.provider===option.id&&save.phase==='busy',onClick:()=>void saveProvider(option)},save!==null&&save.provider===option.id&&save.phase==='busy'?t('saveBusy'):t('save'))),
  save!==null&&save.provider===option.id&&save.phase==='done'?React.createElement(StatusLine,{tone:'ok'},t('saveDone')):null,
  save!==null&&save.provider===option.id&&save.phase==='failed'?React.createElement(StatusLine,{tone:'warn',role:'alert'},save.code==='EMPTY'?t('saveEmpty'):t('saveFailed')):null);
 const testProvider=async option=>{
  if(caps?.enabled!==true){setTests(current=>({...current,[option.id]:{phase:'failed',code:'OCR_DISABLED'}}));return;}
  const sample=samples[0]??null;
  if(sample===null){setTests(current=>({...current,[option.id]:{phase:'failed',code:'OCR_NO_IMAGE'}}));return;}
  setTests(current=>({...current,[option.id]:{phase:'busy'}}));
  let settled=false;
  const timer=setTimeout(()=>{if(settled)return;settled=true;setTests(current=>({...current,[option.id]:{phase:'failed',code:'OCR_TEST_TIMEOUT'}}));},30000);
  try{
   const result=await wire.recognize({attachment:sample.attachment,mode:'both',reconcile:true,provider:option.id});
   if(settled)return;
   settled=true;clearTimeout(timer);
   const seconds=((result.channels??[]).reduce((sum,channel)=>sum+(Number(channel.ms)||0),0)/1000).toFixed(1);
   setTests(current=>({...current,[option.id]:{phase:'done',lines:(result.lines??[]).length,seconds}}));
  }catch(failure){if(settled)return;settled=true;clearTimeout(timer);setTests(current=>({...current,[option.id]:{phase:'failed',code:failure&&failure.code?failure.code:'OCR_FAILED'}}));}
 };
 const testLine=option=>{
  const result=tests[option.id];
  if(result===undefined||result.phase==='busy')return null;
  if(result.phase==='done')return React.createElement(StatusLine,{tone:'ok'},fill(t('statusTestDone'),result));
  return React.createElement(StatusLine,{tone:'warn',role:'alert'},result.code==='OCR_NO_IMAGE'?t('statusTestNoImage'):result.code==='OCR_DISABLED'?t('statusTestNeedEnabled'):result.code==='OCR_TEST_TIMEOUT'?t('statusTestTimeout'):fill(t('statusTestFailed'),{code:result.code}));
 };
 const providerRows=providers.map(option=>{
  const state=providerState(option);
  const configured=state?.configured===true;
  const open=expanded===option.id;
  const usage=state?.usage;
  const usageText=usage===null||usage===undefined?t('providerUsageEmpty'):fill(t('providerUsage'),{calls:Number(usage.calls)||0,pages:Number(usage.pages)||0,lines:Number(usage.lines)||0});
  const test=tests[option.id];
  return React.createElement('div',{className:'omni-ui-card omni-ui-cardStatic',key:option.id,'data-testid':'ocr-provider-'+option.id},
   React.createElement('div',{className:'omni-ui-cardTitleRow'},
    React.createElement('div',{className:'omni-ui-badgeRow'},
     React.createElement('span',{className:'omni-ui-cardTitle'},providerName(option)),
     React.createElement(Badge,{tone:configured?'ok':'warn','data-testid':'ocr-provider-status-'+option.id},configured?t('providerConfigured'):t('providerNotConfigured'))),
    React.createElement(ActionGroup,null,
     React.createElement(Button,{'data-testid':'ocr-configure-'+option.id,onClick:()=>setExpanded(open?null:option.id)},open?t('hideCredentials'):t('configureCredentials')),
     React.createElement(Button,{'data-testid':'ocr-test-status-'+option.id,variant:'primary',busy:test!==undefined&&test.phase==='busy',disabled:!configured||test?.phase==='busy',onClick:()=>void testProvider(option)},test!==undefined&&test.phase==='busy'?t('statusTestBusy'):t('statusTestButton')))),
   React.createElement('div',{className:'omni-ui-cardBodyInset'},
    React.createElement('div',{className:'omni-ui-badgeRow'},...(option.channels??[]).map(channel=>React.createElement(Badge,{key:channel},channelLabel(channel,t)))),
    React.createElement('p',{className:'omni-ui-hint','data-testid':'ocr-usage-'+option.id},usageText),
    React.createElement('p',{className:'omni-ui-hint'},t('statusTestHint')),
    testLine(option),
    open&&state!==null?credentialForm(option,state):null));
 });
 const setEnabled=async next=>{setToggling(true);try{const nextCaps=await wire.setEnabled(next);setCaps(nextCaps);setIssue(null);}catch{setIssue('switchFailed');}finally{setToggling(false);}};
 const loadText=()=>loadCode==='OCR_NAMESPACE_UNAVAILABLE'?fill(t('loadFailedNamespace'),{code:loadCode}):loadCode===null?t('loadFailed'):fill(t('loadFailedCode'),{code:loadCode});
 const issueLine=issue===null?null:React.createElement(StatusLine,{tone:'warn',role:'alert','data-testid':'ocr-issue'},issue==='loadFailed'?loadText():t(issue));
 const configuredStates=caps?.providerStates?Object.values(caps.providerStates):[];
 const ready=caps?.enabled===true&&(configuredStates.length>0?configuredStates.some(state=>state.configured===true):caps?.configured===true);
 const card=React.createElement(SettingsCard,{collapsible:true,defaultOpen:true,'data-testid':'ocr-capability-card',title:t('handwritingTitle'),description:t('handwritingSubtitle'),badge:React.createElement(Badge,{tone:ready?'ok':'warn','data-testid':'ocr-status'},ready?t('capabilityAvailable'):t('providerNotConfigured'))},
  React.createElement(Switch,{'data-testid':'ocr-enabled',checked:caps!==null&&caps.enabled===true,disabled:toggling||caps===null,label:t('switchLabel'),description:t('switchHint'),onChange:event=>void setEnabled(event.target.checked)}),
  issueLine,
  React.createElement('div',{className:'omni-ui-stack','data-testid':'ocr-provider-access'},
   React.createElement('p',{className:'omni-ui-cardTitle'},t('providerAccessTitle')),
   React.createElement('p',{className:'omni-ui-hint'},t('providerAccessHint')),
   providerRows,
   saveNotice===null?null:React.createElement(StatusLine,{tone:saveNotice.tone,role:'status','data-testid':'ocr-save-notice'},saveNotice.text)),
  React.createElement('div',{className:'omni-ui-stack','data-testid':'ocr-credentials-note'},
   React.createElement('p',{className:'omni-ui-cardTitle'},t('credentialsTitle')),
   React.createElement('p',{className:'omni-ui-hint'},t('credentialsHidden'))),
  React.createElement('p',{className:'omni-ui-hint','data-testid':'ocr-caveat'},t('caveat')));
 const documentParseCard=React.createElement(DocumentParseCard,{t,wire});
 const body=axis==='output'?React.createElement('div',{'data-testid':'ocr-axis-empty'},React.createElement(EmptyState,{title:t('axisEmptyTitle'),description:t('axisEmptyDesc')})):React.createElement(React.Fragment,null,card,documentParseCard);
 return React.createElement('section',{className:ROOT,'data-testid':'ocr-card'},
  React.createElement('div',{'data-testid':'ocr-axis-switch'},React.createElement(CapsuleSwitch,{options:[{id:'input',label:t('axisInput')},{id:'output',label:t('axisOutput')}],value:axis,onChange:setAxis,'aria-label':t('axisLabel')})),
  body);
}
export function apply(ctx){
 ctx.effect(()=>ctx.locale.register(NS,{en,zh}),'omnisurge: OCR card locale');
 const namespaceRef={current:null};
 ctx.effect(()=>{
  const scoped=ctx.inject(['remote','remote.omnisurgeSuiteDev'],inner=>{namespaceRef.current=inner.remote[REMOTE];return()=>{namespaceRef.current=null;};});
  return()=>{namespaceRef.current=null;void scoped.dispose();};
 },'omnisurge: hold the OCR Remote namespace while the Host serves it');
 ctx.inject(['slots','locale','remote','remote.credentials'],inner=>{
  const t=inner.locale.bind(NS);
  const unwrap=result=>{if(result&&result.ok===true)return result.value;const code=result&&result.error&&(result.error.code||result.error.name);const failure=new Error(typeof code==='string'?code:'REMOTE_FAILED');failure.code=typeof code==='string'?code:'REMOTE_FAILED';throw failure;};
  const remote=()=>{const namespace=namespaceRef.current;if(namespace===undefined||namespace===null)throw Object.assign(new Error('OCR_NAMESPACE_UNAVAILABLE'),{code:'OCR_NAMESPACE_UNAVAILABLE'});return namespace;};
  const wire={
   capabilities:async()=>JSON.parse(JSON.stringify(unwrap(await remote().ocrCapabilities()))),
   recentImages:async()=>{const namespace=namespaceRef.current;if(namespace===undefined||namespace===null||typeof namespace.ocrRecentImages!=='function')return [];return JSON.parse(JSON.stringify(unwrap(await namespace.ocrRecentImages())));},
   recognize:async input=>JSON.parse(JSON.stringify(unwrap(await remote().ocrRecognize(input)))),
   set:async(reference,value)=>{unwrap(await inner.remote.credentials.set(reference,value));},
   setCredential:async(reference,value)=>{unwrap(await inner.remote.credentials.set(reference,value));},
   setEnabled:async enabled=>JSON.parse(JSON.stringify(unwrap(await remote().ocrSetEnabled(enabled)))),
   documentParseCapabilities:async()=>JSON.parse(JSON.stringify(unwrap(await remote().documentParseCapabilities()))),
   documentParse:async input=>JSON.parse(JSON.stringify(unwrap(await remote().documentParse(input)))),
   documentParseSetEnabled:async enabled=>JSON.parse(JSON.stringify(unwrap(await remote().documentParseSetEnabled(enabled)))),
  };
  registerSettingsPluginCard(inner,{id:NS,order:40,label:()=>t('title'),locale:NS,inject:()=>({t,wire})},OcrCard);
 });
}
