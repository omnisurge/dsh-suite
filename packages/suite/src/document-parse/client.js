import * as React from 'react';
import {ActionGroup,Badge,Button,Field,Select,SettingsCard,StatusLine,Switch,TextInput} from '@omnisurge/dsh-ui';

/** The second multimodal subcard (ADR-086). It follows the handwrite card's provider-card anatomy:
 * title row with status + configure/test actions, inset body, then the shared credentials note. */
const PROVIDER_KEY_LINKS={
 mineru:{href:'https://mineru.net/apiManage/token',labelKey:'documentParseMineruKey'},
 paddleocr:{href:'https://aistudio.baidu.com/account/accessToken',labelKey:'documentParsePaddleKey'},
};

export function DocumentParseCard({t,wire}) {
 const [caps,setCaps]=React.useState(null);
 const [issue,setIssue]=React.useState(null);
 const [enabledBusy,setEnabledBusy]=React.useState(false);
 const [expanded,setExpanded]=React.useState(null);
 const [drafts,setDrafts]=React.useState({});
 const [save,setSave]=React.useState(null);
 const [saveNotice,setSaveNotice]=React.useState(null);
 const [tests,setTests]=React.useState({});
 const [modes,setModes]=React.useState({});
 React.useEffect(()=>{
  let cancelled=false;
  wire.documentParseCapabilities().then(value=>{if(!cancelled)setCaps(value);}).catch(failure=>{if(!cancelled){setIssue(failure&&failure.code?String(failure.code):'DOCUMENT_PARSE_STATUS_UNAVAILABLE');}});
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
 const saveCredentials=async option=>{
  const state=caps?.providerStates?.[option.id];
  setSaveNotice(null);
  if(!state){setSave({provider:option.id,phase:'failed'});setSaveNotice({tone:'warn',text:t('documentParseSaveFailed')});return;}
  const values=Object.entries(state.refs??{}).map(([role])=>drafts[option.id]?.[role]).filter(value=>typeof value==='string'&&value.length>0);
  if(values.length===0){setSave({provider:option.id,phase:'failed',code:'EMPTY'});setSaveNotice({tone:'warn',text:t('saveEmpty')});return;}
  setSave({provider:option.id,phase:'busy'});
  try{
   for(const [role,ref] of Object.entries(state.refs??{})){const value=drafts[option.id]?.[role];if(typeof value==='string'&&value.length>0)await wire.setCredential(ref,value);}
   setCaps(await wire.documentParseCapabilities());setDrafts(current=>({...current,[option.id]:{}}));setSave({provider:option.id,phase:'done'});setSaveNotice({tone:'ok',text:t('documentParseSaved')});setExpanded(null);
  }catch{setSave({provider:option.id,phase:'failed'});setSaveNotice({tone:'warn',text:t('documentParseSaveFailed')});}
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
 const setEnabled=async next=>{setEnabledBusy(true);try{setCaps(await wire.documentParseSetEnabled(next));setIssue(null);}catch{setIssue('DOCUMENT_PARSE_SWITCH_FAILED');}finally{setEnabledBusy(false);}};
 const credentialForm=(option,state)=>React.createElement('div',{className:'omni-ui-stack','data-testid':'document-parse-credentials-'+option.id},
  Object.entries(state.refs??{}).map(([role])=>React.createElement(Field,{key:role,label:role==='apiKey'?'API Key':'Token',hint:t('documentParseCredentialHint')},
   React.createElement(TextInput,{type:'password',value:drafts[option.id]?.[role]??'','data-testid':'document-parse-credential-'+role,placeholder:state.credentials?.[role]?.configured===true?t('documentParseConfigured'):t('documentParseNotConfigured'),onChange:event=>setDraft(option.id,role,event.target.value)}))),
  (()=>{const link=PROVIDER_KEY_LINKS[option.id];return link?React.createElement('p',{className:'omni-ui-hint','data-testid':'document-parse-provider-key-link-'+option.id},t('documentParseNeedKey'),' ',React.createElement('a',{className:'omni-ui-link',href:link.href,target:'_blank',rel:'noreferrer','data-testid':'document-parse-provider-key-'+option.id},t(link.labelKey))):null;})(),
  React.createElement(ActionGroup,null,React.createElement(Button,{'data-testid':'document-parse-save-'+option.id,variant:'primary',busy:save!==null&&save.provider===option.id&&save.phase==='busy',onClick:()=>void saveCredentials(option)},save!==null&&save.provider===option.id&&save.phase==='busy'?t('documentParseSaveBusy'):t('documentParseSave'))),
  save!==null&&save.provider===option.id&&save.phase==='done'?React.createElement(StatusLine,{tone:'ok'},t('documentParseSaved')):null,
  save!==null&&save.provider===option.id&&save.phase==='failed'?React.createElement(StatusLine,{tone:'warn',role:'alert'},save.code==='EMPTY'?t('documentParseNotConfigured'):t('documentParseSaveFailed')):null);
 const providerRows=(caps?.providers??[]).map(option=>{
  const state=caps?.providerStates?.[option.id];
  const configured=state?.configured===true;
  const open=expanded===option.id;
  const mode=selectedMode(option);
  const usage=state?.usage;
  const usageText=usage===null||usage===undefined?t('documentParseUsageEmpty'):String(t('documentParseUsage')).replace('{calls}',String(Number(usage.calls)||0)).replace('{pages}',String(Number(usage.pages)||0));
  const errorText=state?.lastError&&state.lastError.mode===mode?String(t('documentParseLastError')).replace('{code}',String(state.lastError.code)):null;
  const rawTest=tests[option.id];
  const test=rawTest!==undefined&&rawTest.mode===mode?rawTest:undefined;
  const testLine=test===undefined?null:test.phase==='busy'?React.createElement(StatusLine,{tone:'muted','data-testid':'document-parse-test-result-'+option.id},t('documentParseTestRunning')):test.phase==='done'?React.createElement(StatusLine,{tone:'ok','data-testid':'document-parse-test-result-'+option.id},String(t('documentParseTestDone')).replace('{mode}',String(test.mode??'')).replace('{pages}',test.pages===null?t('documentParseTestPagesUnknown'):String(test.pages)+' '+t('documentParseTestPageUnit')).replace('{seconds}',String(test.seconds??'0.0'))):React.createElement(StatusLine,{tone:'warn',role:'alert','data-testid':'document-parse-test-result-'+option.id},test.code==='DOCUMENT_PARSE_DISABLED'?t('documentParseTestNeedEnabled'):(test.code==='DOCUMENT_PARSE_TEST_TIMEOUT'||test.code==='DOCUMENT_PARSE_TIMEOUT')?(test.mode==='mineru-agent'?String(t('documentParseTestTimeoutAgent')).replace('{seconds}',String(test.timeoutSeconds??300)):String(t('documentParseTestTimeout')).replace('{seconds}',String(test.timeoutSeconds??300))):String(t('documentParseTestFailed')).replace('{code}',String(test.code??'DOCUMENT_PARSE_PROVIDER_ERROR')));
  return React.createElement('div',{className:'omni-ui-card omni-ui-cardStatic',key:option.id,'data-testid':'document-parse-provider-'+option.id},
   React.createElement('div',{className:'omni-ui-cardTitleRow'},
    React.createElement('div',{className:'omni-ui-badgeRow'},
     React.createElement('span',{className:'omni-ui-cardTitle'},providerName(option)),
     React.createElement(Badge,{tone:configured?'ok':'warn','data-testid':'document-parse-provider-status-'+option.id},configured?t('documentParseConfigured'):t('documentParseNotConfigured'))),
    React.createElement(ActionGroup,null,
     React.createElement(Button,{'data-testid':'document-parse-configure-'+option.id,onClick:()=>setExpanded(open?null:option.id)},open?t('hideCredentials'):t('configureCredentials')),
     React.createElement(Button,{'data-testid':'document-parse-test-'+option.id,variant:'primary',busy:test!==undefined&&test.phase==='busy',disabled:!configured||test?.phase==='busy',onClick:()=>void testProvider(option)},test!==undefined&&test.phase==='busy'?t('documentParseTestRunning'):t('statusTestButton')))),
   React.createElement('div',{className:'omni-ui-cardBodyInset'},
    React.createElement(Field,{label:t('documentParseMode')},React.createElement(Select,{value:mode??'','data-testid':'document-parse-mode-'+option.id,onChange:event=>setMode(option.id,event.target.value)},...(option.modes??[]).map(item=>React.createElement('option',{key:item.id,value:item.id},modeLabel(item))))),
    React.createElement('p',{className:'omni-ui-hint','data-testid':'document-parse-usage-'+option.id},usageText),
    React.createElement('p',{className:'omni-ui-hint'},t('documentParseTestHint')),
    testLine,
    errorText===null?null:React.createElement(StatusLine,{tone:'warn',role:'alert','data-testid':'document-parse-last-error-'+option.id},errorText),
    open&&state!==undefined?credentialForm(option,state):null));
 });
 const configured=(caps?.providers??[]).some(option=>caps?.providerStates?.[option.id]?.configured===true);
 const issueLine=issue===null?null:React.createElement(StatusLine,{tone:'warn',role:'alert','data-testid':'document-parse-issue'},issue==='DOCUMENT_PARSE_SWITCH_FAILED'?t('documentParseSwitchFailed'):String(t('documentParseLoadFailed')).replace('{code}',issue));
 const card=React.createElement(SettingsCard,{collapsible:true,defaultOpen:true,'data-testid':'document-parse-card',title:t('documentParseTitle'),description:t('documentParseSubtitle'),badge:React.createElement(Badge,{tone:caps?.enabled===true&&configured?'ok':'warn','data-testid':'document-parse-status'},caps?.enabled===true&&configured?t('documentParseConfigured'):t('documentParseNotConfigured'))},
  React.createElement(Switch,{'data-testid':'document-parse-enabled',checked:caps?.enabled===true,disabled:enabledBusy||caps===null,label:t('documentParseSwitch'),description:t('documentParseSwitchHint'),onChange:event=>void setEnabled(event.target.checked)}),
  issueLine,
  React.createElement('div',{className:'omni-ui-stack','data-testid':'document-parse-provider-access'},
   React.createElement('p',{className:'omni-ui-cardTitle'},t('providerAccessTitle')),
   React.createElement('p',{className:'omni-ui-hint'},t('documentParseProviderAccessHint')),
   providerRows,
   saveNotice===null?null:React.createElement(StatusLine,{tone:saveNotice.tone,role:'status','data-testid':'document-parse-save-notice'},saveNotice.text)),
  React.createElement('div',{className:'omni-ui-stack','data-testid':'document-parse-credentials-note'},
   React.createElement('p',{className:'omni-ui-cardTitle'},t('credentialsTitle')),
   React.createElement('p',{className:'omni-ui-hint'},t('credentialsHidden'))),
  React.createElement('p',{className:'omni-ui-hint','data-testid':'document-parse-caveat'},t('documentParseCaveat')));
 return card;
}
