/**
 * Suite self-upgrade transport, runtime fallback, and bounded on-disk readback controller
 * (ADR-043/047/059/079/087). Extracted from packages/suite/src/client.js per ADR-117 D4.
 */
import {CLIENT_READ_TIMEOUT_MS,RemoteTimeoutError,withTimeout} from '../remote-timeout.js';
import {assertRemoteEnvelope} from '../shared/client-remote.js';

const reason=error=>error&&typeof error==='object'?String(error.code??error.name??'REMOTE_ERROR')+': '+String(error.message??error):String(error);

export function createSuiteTransport({wire,remoteState,observedRuntime}){
 // 安装后的读回是有界重试：用对象而不是两个裸常量，保留可命中的 `attempts` 变异锚点。
 const UPGRADE_READBACK={attempts:12,delayMs:1000};
 const call=async(method,...args)=>{
  const namespace=wire.namespace;
  if(!namespace||typeof namespace[method]!=='function')throw Error('SUITE_NAMESPACE_MISSING '+method+(remoteState.mountError?' (owned Remote mount failed: '+remoteState.mountError+')':' (the Host namespace is not mounted in this window)'));
  const result=await namespace[method](...args);
  return assertRemoteEnvelope(result,method,{
   onInvalid:()=>Error('SUITE_RESULT_INVALID '+method+' did not answer a RemoteResult envelope'),
   onRefused:error=>{
    const refused=Error('SUITE_HOST_REFUSED '+method+' \u2192 '+reason(error));
    refused.code=typeof error?.code==='string'&&error.code.length>0?error.code:'SUITE_HOST_REFUSED';
    refused.method=method;
    return refused;
   },
  });
 };
 const readFailure=method=>{const error=new Error('SUITE_REMOTE_TIMEOUT '+method+' (no answer within '+Math.round(CLIENT_READ_TIMEOUT_MS/1000)+'s)');error.code='SUITE_REMOTE_TIMEOUT';return error;};
 const callRead=async(method,...args)=>{try{return await withTimeout(()=>call(method,...args),CLIENT_READ_TIMEOUT_MS,{code:'SUITE_REMOTE_TIMEOUT',message:'SUITE_REMOTE_TIMEOUT '+method});}catch(issue){if(issue instanceof RemoteTimeoutError)throw readFailure(method);throw issue;}};
 let staleHost=false;
 const callWithRuntime=async(method,...required)=>{
  try{const value=await call(method,...required,observedRuntime());staleHost=false;return value;}
  catch(issue){
   const raw=String((issue&&issue.message)||issue);
   if(!raw.includes('gateway/arguments-invalid')){staleHost=false;throw issue;}
   const value=await call(method,...required);
   staleHost=true;
   return value;
  }
 };
 const callWithRuntimeRead=async(method,...args)=>{try{return await withTimeout(()=>callWithRuntime(method,...args),CLIENT_READ_TIMEOUT_MS,{code:'SUITE_REMOTE_TIMEOUT',message:'SUITE_REMOTE_TIMEOUT '+method});}catch(issue){if(issue instanceof RemoteTimeoutError)throw readFailure(method);throw issue;}};
 const upgradeOutcome=async version=>{
  let receipt=null,failure=null;
  const couldDispatch=Boolean(wire.namespace&&typeof wire.namespace.upgradeSuite==='function');
  await callWithRuntime('upgradeSuite',version).then(value=>{receipt=value;},issue=>{failure=issue;});
  const transport=failure===null?null:String((failure&&failure.message)||failure);
  const refusalCode=failure&&typeof failure.code==='string'&&failure.code.length>0?failure.code:null;
  const code=receipt&&typeof receipt.code==='string'?receipt.code:null;
  const operations=receipt&&Array.isArray(receipt.operations)?receipt.operations:[];
  const diagnostic=(receipt&&typeof receipt.diagnostic==='string'?receipt.diagnostic:null)??transport;
  const onDisk=receipt&&typeof receipt.onDisk==='string'?receipt.onDisk:null;
  const unconfirmed=Boolean(receipt&&receipt.activationUnconfirmed);
  const receiptRecord=receipt&&receipt.lastInstall&&typeof receipt.lastInstall==='object'?receipt.lastInstall:null;
  const TRANSPORT_LOSS=new Set(['gateway/cancelled','SUITE_HOST_REFUSED']);
  const heardVerdict=(code!==null&&!TRANSPORT_LOSS.has(code))||(refusalCode!==null&&!TRANSPORT_LOSS.has(refusalCode));
  if(code==='SUITE_UPGRADE_RESTART_REQUIRED')return {state:'restart',code,operations,diagnostic,target:version,onDisk,activationUnconfirmed:unconfirmed,readback:false};
  if(heardVerdict&&code!==null)return {state:'failed',code,operations,diagnostic,target:version,onDisk:onDisk??null,activationUnconfirmed:false,readback:false};
  if(heardVerdict&&refusalCode!==null)return {state:'failed',code:refusalCode,operations,diagnostic,target:version,onDisk:onDisk??null,activationUnconfirmed:false,readback:false};
  if(receiptRecord!==null&&receiptRecord.target===version&&receiptRecord.phase==='written')
   return {state:'restart',code:'SUITE_UPGRADE_RESTART_REQUIRED',operations,diagnostic,target:version,onDisk:receiptRecord.onDisk??onDisk??version,activationUnconfirmed:true,readback:false,record:true};
  if(!heardVerdict&&onDisk!==null&&onDisk===version)
   return {state:'restart',code:'SUITE_UPGRADE_RESTART_REQUIRED',operations,diagnostic,target:version,onDisk,activationUnconfirmed:true,readback:false};
  if(!couldDispatch)return {state:'failed',code:'SUITE_NAMESPACE_MISSING',operations,diagnostic,target:version,onDisk:onDisk??null,activationUnconfirmed:false,readback:false};
  if(wire.namespace===null&&!heardVerdict)return {state:'submitted',code:'SUITE_UPGRADE_SUBMITTED',operations,diagnostic,target:version,onDisk:onDisk??null,activationUnconfirmed:true,readback:false};
  const readbackBudget=heardVerdict?1:UPGRADE_READBACK.attempts;
  const recordWrittenStatus=status=>status!==null&&typeof status==='object'&&status.lastInstall!==null&&typeof status.lastInstall==='object'?status.lastInstall:null;
  let installed=null,record=null,namespaceLost=false;
  for(let attempt=0;attempt<readbackBudget;attempt+=1){
   try{const status=await callWithRuntimeRead('upgradeStatus');installed=status&&typeof status.currentVersion==='string'?status.currentVersion:null;record=recordWrittenStatus(status);}
   catch(issue){
    installed=null;record=null;
    if(/^SUITE_NAMESPACE_MISSING/.test(String((issue&&issue.message)||issue))){namespaceLost=true;break;}
   }
   if(installed!==null&&installed===version)break;
   if(record!==null&&record.target===version&&record.phase==='written')break;
   if(attempt<readbackBudget-1)await new Promise(resolve=>setTimeout(resolve,UPGRADE_READBACK.delayMs));
  }
  const recordSaysWritten=record!==null&&record.target===version&&record.phase==='written';
  const settled=[diagnostic,installed===null?null:'installed '+installed,record===null?null:'record '+record.phase].filter(Boolean).join('; ')||null;
  if(installed!==null&&installed===version)return {state:'restart',code:'SUITE_UPGRADE_RESTART_REQUIRED',operations,diagnostic:settled,target:version,onDisk:installed,activationUnconfirmed:false,readback:true};
  if(recordSaysWritten)return {state:'restart',code:'SUITE_UPGRADE_RESTART_REQUIRED',operations,diagnostic:settled,target:version,onDisk:record.onDisk??version,activationUnconfirmed:true,readback:true,record:true};
  if(namespaceLost&&!heardVerdict)return {state:'submitted',code:'SUITE_UPGRADE_SUBMITTED',operations,diagnostic:settled,target:version,onDisk:onDisk??installed,activationUnconfirmed:true,readback:true};
  return {state:'unknown',code:'SUITE_UPGRADE_UNCONFIRMED',operations,diagnostic:settled,target:version,onDisk:onDisk??installed,activationUnconfirmed:true,readback:true};
 };
 return {
  call,
  callRead,
  callWithRuntime,
  callWithRuntimeRead,
  upgradeOutcome,
  isStaleHost:()=>staleHost,
  markStaleHost:()=>{staleHost=true;},
 };
}
