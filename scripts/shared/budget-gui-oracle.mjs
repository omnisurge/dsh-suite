/** Test-only native-GUI oracle. No hook installation, service unwrapping or product state writes. */
import assert from 'node:assert/strict';
const MARKER=Symbol.for('omnisurge.compaction-budget.owner.v1');
const descriptorKeys=['value','get','set','writable','enumerable','configurable'];
export function sameBudgetDescriptor(a,b){
 if(a===undefined||b===undefined)return a===b;
 return descriptorKeys.every(key=>Object.hasOwn(a,key)===Object.hasOwn(b,key)&&a[key]===b[key]);
}
function methodDescriptor(service){
 for(let current=service,depth=0;current!==null&&depth<16;current=Object.getPrototypeOf(current),depth++){
  const own=Object.getOwnPropertyDescriptor(current,'summarize');
  if(own!==undefined)return own;
 }
 throw Error('BUDGET_ORACLE_METHOD_UNAVAILABLE');
}
function copyDescriptor(value){return value===undefined?undefined:Object.freeze({...value});}
function markedDescriptor(own){
 const value=own?.value;
 const mark=typeof value==='function'?Object.getOwnPropertyDescriptor(value,MARKER)?.value:undefined;
 // The marker supplies identity/admission only. Always inspect the actual own descriptor independently.
 return !!mark&&mark.version===1&&typeof mark.owner==='object'&&mark.owner!==null
  &&own.writable===true&&own.configurable===true&&own.enumerable===false;
}
export function createBudgetGuiOracle({listAgents,serviceFor,bindingFor,maxCuts=4}){
 assert.ok(Number.isSafeInteger(maxCuts)&&maxCuts>0&&maxCuts<=8);
 const identities=new Map(),originals=new Map(),wrappers=new Map();let serial=0;
 const identity=value=>{assert.ok(value!==undefined&&value!==null,'BUDGET_ORACLE_BINDING_REVISION_UNAVAILABLE');if(!identities.has(value))identities.set(value,++serial);return identities.get(value);};
 function binding(agent){
  assert.equal(typeof agent.id,'string','BUDGET_ORACLE_AGENT_ID_REQUIRED');
  const retained=bindingFor(agent),bindingToken=identity(retained.parentScope),scopeToken=identity(retained.scope),agentToken=identity(agent);
  const service=serviceFor(agent);
  return {agent,service,key:JSON.stringify([agent.id,agentToken,scopeToken,bindingToken]),id:agent.id,sessionId:agent.session?.id??null,
   agentToken,scopeToken,bindingToken,preset:retained.preset??null,status:typeof agent.status==='string'?agent.status:null,
   own:service===undefined?undefined:Object.getOwnPropertyDescriptor(service,'summarize'),
   method:service===undefined?undefined:methodDescriptor(service)};
 }
 function roster(){
  const agents=Array.from(listAgents()),ids=new Set();
  return agents.map(agent=>{assert.ok(!ids.has(agent.id),'BUDGET_ORACLE_DUPLICATE_AGENT_ID');ids.add(agent.id);return binding(agent);}).sort((a,b)=>a.key.localeCompare(b.key));
 }
 function sameCut(a,b){return a.length===b.length&&a.every((row,i)=>row.key===b[i].key&&row.sessionId===b[i].sessionId&&row.status===b[i].status
  &&(row.service===undefined)===(b[i].service===undefined)&&sameBudgetDescriptor(row.own,b[i].own)&&sameBudgetDescriptor(row.method,b[i].method));}
 function remember(row){
  if(row.service===undefined||originals.has(row.key))return;
  assert.ok(!markedDescriptor(row.own),'BUDGET_ORACLE_ORIGINAL_ALREADY_WRAPPED');
  assert.equal(typeof row.method?.value,'function','BUDGET_ORACLE_ORIGINAL_METHOD_REQUIRED');
  if(!originals.has(row.key))originals.set(row.key,{...row,own:copyDescriptor(row.own),method:copyDescriptor(row.method)});
 }
 // A fixture-owned Agent must be remembered BEFORE agents.enter/any discovery event can install a hook.
 function rememberAgent(agent){remember(binding(agent));}
 function restoration(){
  return [...originals.values()].map(row=>({key:row.key,id:row.id,bindingToken:row.bindingToken,
   ownRestored:sameBudgetDescriptor(Object.getOwnPropertyDescriptor(row.service,'summarize'),row.own),
   methodRestored:sameBudgetDescriptor(methodDescriptor(row.service),row.method)}));
 }
 function observe(readStatus){
  for(let attempt=1;attempt<=maxCuts;attempt++){
   const before=roster(),status=readStatus(),after=roster();
   if(!sameCut(before,after))continue;
   if(!status.available)for(const row of before)remember(row);
   const backendIds=new Set();let complete=true;
   const bindings=before.map(row=>{
    const original=originals.get(row.key),marked=markedDescriptor(row.own),current=row.own?.value;
    if(marked)backendIds.add(identity(current)); // Raw own descriptor function, never service proxy ===.
    if(status.available&&marked&&!wrappers.has(row.key))wrappers.set(row.key,current);
    const sameWrapper=marked&&wrappers.get(row.key)===current;
    if(row.service===undefined||!original||!marked||!sameWrapper)complete=false;
    return {key:row.key,id:row.id,sessionId:row.sessionId,agentToken:row.agentToken,scopeToken:row.scopeToken,bindingToken:row.bindingToken,preset:row.preset,status:row.status,
     backendPresent:row.service!==undefined,backendIdentity:marked?identity(current):null,originalKnown:!!original,marked,sameWrapper};
   });
   const restored=restoration();
   return {...status,oracle:{stable:true,attempts:attempt,roster:bindings,total:bindings.length,
    expected:bindings.length===0?'waiting':'covered',complete:bindings.length===0||complete,
    uniqueBackends:status.available&&complete?backendIds.size:null,
    originals:restored,allRestored:restored.every(row=>row.ownRestored&&row.methodRestored)}};
  }
  throw Error('BUDGET_ORACLE_UNSTABLE_ROSTER_OR_BINDING');
 }
 function resetIdentity(){wrappers.clear();}
 return {observe,rememberAgent,resetIdentity};
}
export function assertBudgetGuiObservation(observed,expected){
 const {oracle,effect}=observed;
 assert.equal(oracle?.stable,true,'BUDGET_ORACLE_STABLE_CUT_REQUIRED');
 if(expected==='absent'){
  assert.equal(observed.available,false,'BUDGET_OWNER_MUST_BE_ABSENT');
  assert.equal(oracle.allRestored,true,'BUDGET_ALL_ORIGINAL_DESCRIPTORS_MUST_RESTORE');
  assert.ok(oracle.originals.every(row=>row.ownRestored&&row.methodRestored),'BUDGET_ALL_ORIGINAL_DESCRIPTORS_MUST_RESTORE');
  return;
 }
 assert.equal(observed.available,true,'BUDGET_OWNER_REQUIRED');
 assert.equal(expected,oracle.expected,'BUDGET_ROSTER_DETERMINES_EXPECTED_STATE');
 assert.equal(oracle.complete,true,'BUDGET_ALL_LIVE_BINDINGS_MUST_HAVE_ORIGINAL_AND_WRAPPER');
 assert.equal(effect?.protocol,1,'BUDGET_OWNER_PROTOCOL_REQUIRED');
 assert.equal(effect?.scope,'live-agent-bindings','BUDGET_OWNER_SCOPE_REQUIRED');
 assert.equal(effect?.complete,true,'BUDGET_OWNER_ENUMERATION_MUST_BE_COMPLETE');
 assert.equal(effect?.state,expected,'BUDGET_OWNER_MUST_MATCH_INDEPENDENT_ROSTER');
 assert.equal(effect?.total,oracle.total,'BUDGET_COVERAGE_COUNTS_AGENT_BINDINGS_NOT_BACKENDS');
 assert.equal(effect?.covered,oracle.total,'BUDGET_EVERY_AGENT_BINDING_MUST_BE_COVERED');
 assert.equal(effect?.waiting,0,'BUDGET_NO_MISSING_BACKEND_IS_COVERED');
 assert.equal(effect?.rejected,0,'BUDGET_NO_REJECTED_BINDING_IS_COVERED');
 assert.equal(effect?.unknown,0,'BUDGET_UNKNOWN_COVERAGE_MUST_FAIL');
}
export function budgetRosterKeys(observed){return observed.oracle.roster.map(row=>row.key).sort();}
export function assertBudgetOwnedTarget(before,after,ownedId){
 assert.equal(typeof ownedId,'string','BUDGET_OWNED_TARGET_ID_REQUIRED');
 const added=after.oracle.roster.filter(row=>!budgetRosterKeys(before).includes(row.key));
 assert.equal(added.length,1,'BUDGET_ONLY_ONE_OWNED_TARGET_MAY_BE_ADDED');
 assert.equal(added[0].id,ownedId,'BUDGET_ADDED_TARGET_MUST_BE_FIXTURE_OWNED');
 assert.deepEqual(after.oracle.roster.filter(row=>row.id!==ownedId).map(row=>row.key).sort(),budgetRosterKeys(before),'BUDGET_EXISTING_ROSTER_MUST_NOT_CHANGE');
}
// Test-only cross-boundary observation: an inactive namespace is not a read-only served form.
export function assertBudgetInactivePage(observed){
 assert.equal(observed.rowDisabled,true,'BUDGET_INACTIVE_ROW_REQUIRED');
 assert.equal(observed.settings,null,'BUDGET_INACTIVE_NAMESPACE_MUST_BE_ABSENT');
 assert.equal(observed.revision,null,'BUDGET_INACTIVE_REVISION_MUST_BE_ABSENT');
 assert.equal(observed.pageCount,1,'BUDGET_INACTIVE_PAGE_MUST_REMAIN_UNIQUE');
 assert.equal(observed.statusCount,1,'BUDGET_INACTIVE_EXACT_HINT_REQUIRED');
 for(const key of ['fields','advanced','save','cancel'])assert.equal(observed[key],0,'BUDGET_INACTIVE_CONTROLS_MUST_NOT_EXIST:'+key);
}
// Stage receipts are test evidence, never product state or a substitute for running the GUI.
export const BUDGET_NATIVE_REQUIRED = Object.freeze({
 warm: ['roster','editCancel','configurationSave','nextSummary','invalidAtomicity','casReload','inflightSnapshot','rowDisable','heldWriteRefused','reenable','nativeBundleLifecycle','cleanup'],
 cold: ['roster','persistedConfiguration','nextSummary','rowDisable','reenable','cleanup'],
});
export function assertBudgetConfigurationUnchanged(before,after){
 for(const value of [before,after]){
  assert.match(value.patchSha256??'',/^[a-f0-9]{64}$/,'BUDGET_CONFIGURATION_FILE_EVIDENCE_REQUIRED');
  assert.ok(Number.isSafeInteger(value.revision),'BUDGET_CONFIGURATION_REVISION_EVIDENCE_REQUIRED');
  assert.equal(typeof value.rowDisabled,'boolean','BUDGET_ROW_SWITCH_EVIDENCE_REQUIRED');
  for(const field of ['checkpointTokens','safetyTokens','timeoutMs'])assert.ok(Number.isSafeInteger(value.policy?.[field]),'BUDGET_EFFECTIVE_POLICY_EVIDENCE_REQUIRED');
 }
 assert.equal(after.patchSha256,before.patchSha256,'BUDGET_CONFIGURATION_FILE_MUST_NOT_CHANGE');
 assert.equal(after.revision,before.revision,'BUDGET_CONFIGURATION_REVISION_MUST_NOT_CHANGE');
 assert.deepEqual(after.policy,before.policy,'BUDGET_EFFECTIVE_POLICY_MUST_NOT_CHANGE');
 assert.equal(after.rowDisabled,before.rowDisabled,'BUDGET_ROW_SWITCH_MUST_NOT_CHANGE');
 assert.deepEqual(budgetRosterKeys(after.snapshot),budgetRosterKeys(before.snapshot),'BUDGET_CONFIGURATION_BINDINGS_MUST_NOT_CHANGE');
 for(const row of before.snapshot.oracle.roster){const next=after.snapshot.oracle.roster.find(x=>x.key===row.key);assert.equal(next?.backendIdentity,row.backendIdentity,'BUDGET_CONFIGURATION_WRAPPER_MUST_NOT_CHANGE');}
}
export function budgetNativeCompletion(phases,{acceptedCoverageException=null,evidence=[]}={}){
 const waiting=phases.some(phase=>phase.waiting==='verified')?'verified':'unverified';
 const lifecycle=phases.length===2&&['warm','cold'].every(name=>phases.filter(phase=>phase.phase===name).length===1);
 const missing=[];
 for(const [name,required] of Object.entries(BUDGET_NATIVE_REQUIRED)){
  const matching=phases.filter(phase=>phase.phase===name);
  if(matching.length!==1){missing.push(name+':unique-phase');continue;}
  for(const key of required){const receipt=matching[0].receipts?.[key];
   if(receipt?.verified!==true||receipt?.surface!=='native-ui'||receipt.evidenceStage!=='budget-'+name+'-'+key||!evidence.some(item=>item.stage===receipt.evidenceStage))missing.push(name+':'+key);
  }
 }
 const exceptionAccepted=acceptedCoverageException?.decision==='ADR-110'&&acceptedCoverageException?.accepted===true&&typeof acceptedCoverageException?.source==='string'&&acceptedCoverageException.source.length>0;
 const stateFor=key=>phases.find(phase=>phase.phase==='warm')?.receipts?.[key]?.verified===true&&!missing.includes('warm:'+key)?'verified':'unverified';
 const configurationSave=stateFor('configurationSave'),invalidAtomicity=stateFor('invalidAtomicity');
 const defaultLifecycleAcceptance=lifecycle&&(waiting==='verified'||exceptionAccepted);
 const releaseAcceptance=defaultLifecycleAcceptance&&missing.length===0;
 return {waiting,lifecycle,configurationSave,invalidAtomicity,missing,acceptedCoverageException:exceptionAccepted?{...acceptedCoverageException,coverage:waiting}:null,
  defaultLifecycleAcceptance,releaseAcceptance,reason:!lifecycle?'BUDGET_NATIVE_LIFECYCLE_INCOMPLETE':waiting!=='verified'&&!exceptionAccepted?'BUDGET_NATIVE_WAITING_UNVERIFIED':missing.length?'BUDGET_NATIVE_REQUIRED_EVIDENCE_INCOMPLETE':null};
}
