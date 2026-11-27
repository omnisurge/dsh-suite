import * as React from 'react';
import {ActionGroup,Badge,Banner,Button,Field,ListRow,Select,SettingsCard,StatusLine,Switch,TextInput,showToast} from '@omnisurge/dsh-ui';
import {CREDENTIAL_SAVE_BLOCKED,CREDENTIAL_SAVE_EMPTY,CREDENTIAL_SAVE_FAILED,CREDENTIAL_SAVE_OK,CREDENTIAL_SAVE_PARTIAL,credentialRolesText,saveCredentialRoles} from '../credential-save.js';
import {fillTemplate as fill} from '../shared/client-copy.js';
import {DiagnosticDisclosure} from '../shared/DiagnosticDisclosure.js';

const roleLabel=role=>role==='apiKey'?'API Key':role==='token'?'Token':role;

/** The second multimodal subcard (ADR-086). Renders a single collapsible SettingsCard containing
 * flush ListRow entries per provider (zero 3rd-layer card borders). */
const PROVIDER_KEY_LINKS={
 mineru:{href:'https://mineru.net/apiManage/token',labelKey:'documentParseMineruKey'},
 paddleocr:{href:'https://aistudio.baidu.com/account/accessToken',labelKey:'documentParsePaddleKey'},
};

export function DocumentParseCard({t,wire}) {
 const [caps,setCaps]=React.useState(null);
 const [loadPhase,setLoadPhase]=React.useState('loading');
 const [issue,setIssue]=React.useState(null);
 const [switchCode,setSwitchCode]=React.useState(null);
 const [enabledBusy,setEnabledBusy]=React.useState(false);
 const [expanded,setExpanded]=React.useState(null);
 const [drafts,setDrafts]=React.useState({});
 const [save,setSave]=React.useState(null);
 const [saveNotice,setSaveNotice]=React.useState(null);
 const [tests,setTests]=React.useState({});
 const [modes,setModes]=React.useState({});
 React.useEffect(()=>{
  let cancelled=false;
  wire.documentParseCapabilities().then(
   value=>{if(!cancelled){setCaps(value);setIssue(null);setSwitchCode(null);setLoadPhase('ready');}},
   failure=>{if(!cancelled){setIssue(failure&&failure.code?String(failure.code):'DOCUMENT_PARSE_STATUS_UNAVAILABLE');setLoadPhase('failed');}},
  );
  return()=>{cancelled=true;};
 },[wire]);
 const providerName=option=>{
  const translated=t(option.displayKey??('provider'+(option.id==='mineru'?'Mineru':'PaddleOcr')));
  return translated===option.displayKey?(option.id==='mineru'?'MinerU':'PaddleOCR'):translated;
 };
 const modeLabel=mode=>{
  const translated=t(mode.displayKey);
  return translated===mode.displayKey?mode.id:translated;
 };
 const selectedMode=option=>{
  const wanted=modes[option.id];
  if(option.modes.some(mode=>mode.id===wanted))return wanted;
  // Prefer the precise API when its key is already configured; the shared agent queue has no SLA.
  if(option.id==='mineru'&&caps?.providerStates?.mineru?.credentials?.apiKey?.configured===true){
   const api=option.modes.find(mode=>mode.id==='mineru-api');
   if(api!==undefined)return api.id;
  }
  return option.modes[0]?.id;
 };
 const setMode=(provider,mode)=>setModes(current=>({...current,[provider]:mode}));
 const setDraft=(provider,role,value)=>setDrafts(current=>({...current,[provider]:{...(current[provider]??{}),[role]:value}}));
 const cancelCredentialForm=providerId=>{
  setExpanded(null);
  setDrafts(current=>({...current,[providerId]:{}}));
  setSave(current=>current&&current.provider===providerId?null:current);
 };
 const saveCredentials=async option=>{
  const state=caps?.providerStates?.[option.id];
  setSaveNotice(null);
  if(!state){setSave({provider:option.id,phase:'failed'});setSaveNotice({tone:'err',text:t('documentParseSaveFailed')});return;}
  const entries=Object.entries(state.refs??{}).map(([role,ref])=>({role,ref,value:drafts[option.id]?.[role]}));
  setSave({provider:option.id,phase:'busy'});
  const outcome=await saveCredentialRoles(entries,{describe:wire.describeCredentials,set:wire.setCredential});
  if(outcome.status===CREDENTIAL_SAVE_EMPTY){setSave({provider:option.id,phase:'failed',code:'EMPTY'});setSaveNotice({tone:'err',text:t('saveEmpty')});return;}
  if(outcome.status===CREDENTIAL_SAVE_BLOCKED){
   setSave({provider:option.id,phase:'failed',code:'PRECHECK',roles:outcome.blockedRoles});
   setSaveNotice({tone:'err',text:fill(t('documentParseSaveBlocked'),{roles:credentialRolesText(outcome.blockedRoles,roleLabel)})});
   return;
  }
  if(outcome.status===CREDENTIAL_SAVE_FAILED){
   setSave({provider:option.id,phase:'failed',failedRole:outcome.failedRole});
   setSaveNotice({tone:'err',text:fill(t('documentParseSaveFailedRole'),{role:roleLabel(outcome.failedRole)})});
   return;
  }
  const refresh=async()=>{try{setCaps(await wire.documentParseCapabilities());}catch{}};
  if(outcome.status===CREDENTIAL_SAVE_PARTIAL){
   setSave({provider:option.id,phase:'partial',roles:outcome.savedRoles,failedRole:outcome.failedRole});
   setSaveNotice({tone:'err',text:fill(t('documentParseSavePartial'),{saved:credentialRolesText(outcome.savedRoles,roleLabel),failed:roleLabel(outcome.failedRole)})});
   const saved=new Set(outcome.savedRoles);
   setDrafts(current=>({...current,[option.id]:Object.fromEntries(Object.entries(current[option.id]??{}).filter(([role])=>!saved.has(role)))}));
   await refresh();
   return;
  }
  if(outcome.status===CREDENTIAL_SAVE_OK){
   await refresh();
   const savedText=fill(t('documentParseSaveDoneRoles'),{roles:credentialRolesText(outcome.savedRoles,roleLabel)});
   setDrafts(current=>({...current,[option.id]:{}}));setSave({provider:option.id,phase:'done'});setSaveNotice({tone:'ok',text:savedText});setExpanded(null);
   showToast({tone:'ok',kind:'document-parse-credentials-'+option.id,text:savedText,closeLabel:t('closeToast')});
   return;
  }
  setSave({provider:option.id,phase:'failed',code:outcome.reason??'FAILED'});setSaveNotice({tone:'err',text:t('documentParseSaveFailed')});
 };
 const testProvider=async option=>{
  const mode=selectedMode(option);
  if(caps?.enabled!==true){setTests(current=>({...current,[option.id]:{phase:'failed',code:'DOCUMENT_PARSE_DISABLED',mode}}));return;}
  setTests(current=>({...current,[option.id]:{phase:'busy',mode}}));
  try{
   const answer=await wire.documentParse({url:'https://cdn-mineru.openxlab.org.cn/demo/example.pdf',provider:option.id,mode});
   if(answer&&answer.error)setTests(current=>({...current,[option.id]:{phase:'failed',code:String(answer.error.code??'DOCUMENT_PARSE_PROVIDER_ERROR'),mode}}));
   else {const result=answer?.result??answer??{};const pages=result?.pages?.extracted;setTests(current=>({...current,[option.id]:{phase:'done',pages:typeof pages==='number'?pages:null,seconds:((Number(result?.ms)||0)/1000).toFixed(1),mode}}));}
  }catch(failure){setTests(current=>({...current,[option.id]:{phase:'failed',code:String(failure?.code??'DOCUMENT_PARSE_PROVIDER_ERROR'),mode}}));}
  try{setCaps(await wire.documentParseCapabilities());}catch{}
 };
 const setEnabled=async next=>{
  setEnabledBusy(true);
  try{setCaps(await wire.documentParseSetEnabled(next));setIssue(null);setSwitchCode(null);}
  catch(failure){setIssue('DOCUMENT_PARSE_SWITCH_FAILED');setSwitchCode(failure&&failure.code?String(failure.code):null);}
  finally{setEnabledBusy(false);}
 };
 const credentialForm=(option,state)=>{
  const saveBusy=save!==null&&save.provider===option.id&&save.phase==='busy';
  return React.createElement('div',{className:'omni-ui-roleForm','data-testid':'document-parse-credentials-'+option.id},
   Object.entries(state.refs??{}).map(([role])=>React.createElement(Field,{key:role,label:role==='apiKey'?'API Key':'Token',hint:t('documentParseCredentialHint')},
    React.createElement(TextInput,{type:'password',autoComplete:'new-password',value:drafts[option.id]?.[role]??'','data-testid':'document-parse-credential-'+role,placeholder:state.credentials?.[role]?.configured===true?t('documentParseConfigured'):t('documentParseNotConfigured'),onChange:event=>setDraft(option.id,role,event.target.value)}))),
   (()=>{const link=PROVIDER_KEY_LINKS[option.id];return link?React.createElement('p',{className:'omni-ui-hint','data-testid':'document-parse-provider-key-link-'+option.id},t('documentParseNeedKey'),' ',React.createElement('a',{className:'omni-ui-link',href:link.href,target:'_blank',rel:'noreferrer','data-testid':'document-parse-provider-key-'+option.id},t(link.labelKey))):null;})(),
   React.createElement(ActionGroup,{align:'start'},
    React.createElement(Button,{'data-testid':'document-parse-save-'+option.id,variant:'primary',size:'sm',busy:saveBusy,onClick:()=>void saveCredentials(option)},saveBusy?t('documentParseSaveBusy'):t('documentParseSave')),
    React.createElement(Button,{'data-testid':'document-parse-cancel-'+option.id,variant:'ghost',size:'sm',disabled:saveBusy,onClick:()=>cancelCredentialForm(option.id)},t('cancel'))),
   save!==null&&save.provider===option.id&&save.phase==='done'?React.createElement(StatusLine,{tone:'ok'},t('documentParseSaved')):null,
   save!==null&&save.provider===option.id&&save.phase==='failed'?React.createElement(StatusLine,{tone:'err',role:'alert'},save.code==='EMPTY'?t('saveEmpty'):t('documentParseSaveFailed')):null);
 };
 const enabled=caps?.enabled===true;
 const providerRows=(caps?.providers??[]).map(option=>{
  const state=caps?.providerStates?.[option.id];
  const configured=state?.configured===true;
  const open=expanded===option.id;
  const mode=selectedMode(option);
  const modeDescriptor=(option.modes??[]).find(item=>item.id===mode);
  const modeRequiresCred=modeDescriptor?.auth==='credential';
  const modeRolesConfigured=modeRequiresCred&&Array.isArray(modeDescriptor?.credentialRoles)&&modeDescriptor.credentialRoles.length>0&&state?.credentials
   ?modeDescriptor.credentialRoles.every(role=>state.credentials?.[role]?.configured===true)
   :configured;
  const canTest=enabled&&configured&&(!modeRequiresCred||modeRolesConfigured);
  const usage=state?.usage;
  const usageText=usage===null||usage===undefined?t('documentParseUsageEmpty'):fill(t('documentParseUsage'),{calls:Number(usage.calls)||0,pages:Number(usage.pages)||0});
  const hasLastError=Boolean(state?.lastError&&state.lastError.mode===mode);
  const rawTest=tests[option.id];
  const test=rawTest!==undefined&&rawTest.mode===mode?rawTest:undefined;
  const testLine=test===undefined?null:test.phase==='busy'
   ?React.createElement(StatusLine,{tone:'loading','data-testid':'document-parse-test-result-'+option.id},t('documentParseTestRunning'))
   :test.phase==='done'
    ?React.createElement(StatusLine,{tone:'ok','data-testid':'document-parse-test-result-'+option.id},fill(t('documentParseTestDone'),{mode:String(test.mode??''),pages:test.pages===null?t('documentParseTestPagesUnknown'):String(test.pages)+' '+t('documentParseTestPageUnit'),seconds:String(test.seconds??'0.0')}))
    :React.createElement('div',{className:'omni-ui-stack','data-testid':'document-parse-test-failure-'+option.id},
     React.createElement(StatusLine,{tone:'err',role:'alert','data-testid':'document-parse-test-result-'+option.id},test.code==='DOCUMENT_PARSE_DISABLED'?t('documentParseTestNeedEnabled'):(test.code==='DOCUMENT_PARSE_TEST_TIMEOUT'||test.code==='DOCUMENT_PARSE_TIMEOUT')?(test.mode==='mineru-agent'?fill(t('documentParseTestTimeoutAgent'),{seconds:String(test.timeoutSeconds??300)}):fill(t('documentParseTestTimeout'),{seconds:String(test.timeoutSeconds??300)})):t('documentParseTestFailed')),
     test.code?React.createElement(DiagnosticDisclosure,{testId:'document-parse-test-raw-'+option.id,title:t('rawDetails'),text:String(test.code)}):null);
  const hasApiKey=state?.credentials?.apiKey?.configured===true;
  const providerBadgeTone=!configured?'warn':'ok';
  const providerBadgeText=option.id==='mineru'
   ?(!configured?t('documentParseNotConfigured'):hasApiKey?t('documentParseConfigured'):t('documentParseAgentReady'))
   :(configured?t('documentParseConfigured'):t('documentParseNotConfigured'));
  const actionsNode=React.createElement(ActionGroup,null,
   React.createElement(Button,{variant:'default',size:'sm','data-testid':'document-parse-configure-'+option.id,onClick:()=>open?cancelCredentialForm(option.id):setExpanded(option.id)},open?t('hideCredentials'):t('configureCredentials')),
   React.createElement(Button,{variant:'default',size:'sm','data-testid':'document-parse-test-'+option.id,busy:test!==undefined&&test.phase==='busy',disabled:!canTest||test?.phase==='busy',onClick:()=>void testProvider(option)},test!==undefined&&test.phase==='busy'?t('documentParseTestRunning'):t('statusTestButton')));
  return React.createElement(ListRow,{
   key:option.id,
   'data-testid':'document-parse-provider-'+option.id,
   title:providerName(option),
   badge:React.createElement(Badge,{tone:providerBadgeTone,'data-testid':'document-parse-provider-status-'+option.id},providerBadgeText),
   meta:React.createElement('span',{'data-testid':'document-parse-usage-'+option.id},usageText),
   actions:actionsNode,
  },
  React.createElement('div',{className:'omni-ui-listFacts','data-testid':'document-parse-facts-'+option.id},
   React.createElement(Field,{label:t('documentParseMode')},React.createElement(Select,{value:mode??'','data-testid':'document-parse-mode-'+option.id,onChange:event=>setMode(option.id,event.target.value)},...(option.modes??[]).map(item=>React.createElement('option',{key:item.id,value:item.id},modeLabel(item))))),
   React.createElement('p',{className:'omni-ui-hint'},t('documentParseTestHint')),
   !enabled?React.createElement('p',{className:'omni-ui-hint','data-testid':'document-parse-test-disabled-hint-'+option.id},t('documentParseTestNeedEnabled')):(configured&&modeRequiresCred&&!modeRolesConfigured?React.createElement('p',{className:'omni-ui-hint','data-testid':'document-parse-api-key-hint-'+option.id},t('documentParseApiNeedsKey')):null),
   testLine,
   hasLastError?React.createElement('div',{className:'omni-ui-stack','data-testid':'document-parse-last-error-block-'+option.id},
    React.createElement(StatusLine,{tone:'err',role:'alert','data-testid':'document-parse-last-error-'+option.id},t('documentParseLastError')),
    state.lastError?.code?React.createElement(DiagnosticDisclosure,{testId:'document-parse-last-error-raw-'+option.id,title:t('rawDetails'),text:String(state.lastError.code)}):null):null,
   open&&state!==undefined?credentialForm(option,state):null));
 });
 const configured=(caps?.providers??[]).some(option=>caps?.providerStates?.[option.id]?.configured===true);
 const statusTone=!enabled?'muted':configured?'ok':'warn';
 const statusText=!enabled?t('capabilityDisabled'):configured?t('capabilityAvailable'):t('capabilityNeedsSetup');
 const issueDiagnostic=issue==='DOCUMENT_PARSE_SWITCH_FAILED'?switchCode:issue;
 const issueLine=issue===null?null:React.createElement(Banner,{tone:'err',role:'alert','data-testid':'document-parse-issue'},
  React.createElement('span',{'data-testid':'document-parse-issue-message'},issue==='DOCUMENT_PARSE_SWITCH_FAILED'?t('documentParseSwitchFailed'):t('documentParseLoadFailed')),
  issueDiagnostic?React.createElement(DiagnosticDisclosure,{testId:'document-parse-issue-raw',title:t('rawDetails'),text:String(issueDiagnostic)}):null);
 const card=React.createElement(SettingsCard,{collapsible:true,defaultOpen:true,'data-testid':'document-parse-card',title:t('documentParseTitle'),description:t('documentParseSubtitle'),badge:React.createElement(Badge,{tone:statusTone,'data-testid':'document-parse-status'},statusText)},
  React.createElement(Switch,{'data-testid':'document-parse-enabled',align:'between',busy:enabledBusy,checked:enabled,disabled:enabledBusy||caps===null,label:t('documentParseSwitch'),description:t('documentParseSwitchHint'),onChange:event=>void setEnabled(event.target.checked)}),
  loadPhase==='loading'?React.createElement(StatusLine,{tone:'loading','data-testid':'document-parse-loading'},t('loading')):null,
  issueLine,
  React.createElement('div',{className:'omni-ui-stack','data-testid':'document-parse-provider-access'},
   React.createElement('p',{className:'omni-ui-cardTitle'},t('providerAccessTitle')),
   React.createElement('p',{className:'omni-ui-hint'},t('documentParseProviderAccessHint')),
   providerRows.length>0?React.createElement('ul',{className:'omni-ui-list omni-ui-list--flush','data-testid':'document-parse-provider-list'},...providerRows):null,
   saveNotice===null?null:React.createElement(StatusLine,{tone:saveNotice.tone,role:saveNotice.tone==='err'?'alert':'status','data-testid':'document-parse-save-notice'},saveNotice.text)),
  React.createElement('div',{className:'omni-ui-stack','data-testid':'document-parse-credentials-note'},
   React.createElement('p',{className:'omni-ui-cardTitle'},t('credentialsTitle')),
   React.createElement('p',{className:'omni-ui-hint'},t('credentialsHidden'))),
  React.createElement('p',{className:'omni-ui-hint','data-testid':'document-parse-caveat'},t('documentParseCaveat')));
 return card;
}
