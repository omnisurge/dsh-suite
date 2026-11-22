/**
 * Pure formatters, machine-code-to-locale mappers, and draft error translators
 * for the Skills & MCP panel (extracted from tools/client.js per ADR-117 D4).
 */
import {fillTemplate as fill} from '../shared/client-copy.js';

/** Source values the Host documents; any other value is shown verbatim, never invented into an enum. */
export const SOURCE_WORDS=new Map([
  ['project-dsh','sourceProjectDsh'],
  ['project-agents','sourceProjectAgents'],
  ['user-dsh','sourceUserDsh'],
  ['user-agents','sourceUserAgents'],
  ['custom','sourceCustom'],
  ['bundled','sourceBundled'],
  ['runtime','providerRuntime'],
]);

/** A failure fact: the kind chooses the one sentence, the raw text goes to the technical disclosure. */
export const failure=(kind,message,code)=>{const error=new Error(message);error.failure={kind,raw:message};if(typeof code==='string'&&code.length>0)error.code=code;return error;};
export const reason=error=>error&&typeof error==='object'?String(error.code??error.name??'REMOTE_ERROR')+': '+String(error.message??error):String(error);

/** The code is the machine fact; the sentence is chosen from it and nothing else. */
export const SKILLS_CODES=new Map([['skills/registry-unavailable','registry']]);
export const MCP_CODES=new Map([['mcp/profile-unavailable','profile-unavailable'],['mcp/profile-patch-unreadable','patch-unreadable']]);
export const refusalKind=code=>SKILLS_CODES.get(code)??MCP_CODES.get(code)??'refused';
export const codeOf=error=>error&&typeof error==='object'&&typeof error.code==='string'&&error.code.length>0?error.code:null;

/** HH:MM only: the receipt is a clock reading, not a locale-formatted date sentence. */
export const clock=()=>{
  try{return new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',hour12:false});}
  catch{return new Date().toTimeString().slice(0,5);}
};

export const skillsSentence=(t,issue)=>issue===null?null:
  issue.kind==='namespace'?t('notConnected'):
  issue.kind==='mount'?t('componentNotStarted'):
  issue.kind==='registry'?t('registryUnavailable'):
  issue.kind==='answer'?t('answerUnreadable'):
  issue.kind==='timeout'?t('readTimedOut'):
  t('componentNotStarted');

export const mcpSentence=(t,issue)=>issue===null?null:
  issue.kind==='namespace'?t('notConnected'):
  issue.kind==='mount'?t('componentNotStarted'):
  issue.kind==='profile-unavailable'?t('mcpProfileUnavailable'):
  issue.kind==='patch-unreadable'?t('mcpPatchUnreadable'):
  issue.kind==='catalog-unreadable'?t('mcpCatalogUnreadable'):
  issue.kind==='answer'?t('answerUnreadable'):
  issue.kind==='timeout'?t('readTimedOut'):
  t('componentNotStarted');

/** The four server states the Host reports; an unknown value is shown verbatim, never guessed into a state. */
export const MCP_STATE_KEYS=new Map([['running','mcpStateRunning'],['failed','mcpStateFailed'],['disabled','mcpStateDisabled'],['pending','mcpStatePending']]);
export const MCP_STATE_TONES=new Map([['running','ok'],['failed','err'],['disabled','muted'],['pending','muted']]);
export const MCP_RUNTIME_KEYS=new Map([
  ['connected','mcpRuntimeConnected'],
  ['failed','mcpRuntimeFailed'],
  ['not-connected','mcpRuntimeNotConnected'],
  ['needs-login','mcpRuntimeNeedsLogin'],
  ['unknown','mcpRuntimeUnknown'],
]);
export const MCP_RUNTIME_TONES=new Map([['connected','ok'],['failed','err'],['not-connected','warn'],['needs-login','warn'],['unknown','warn']]);

/** The protocol word is derived from the Host's protocolSupport fact (ADR-030 D4/ADR-031). */
export const mcpProtocolOf=server=>{
  if(server.protocolSupport==='unknown')return null;
  if(server.protocolSupport==='v1-only')return {key:'mcpProtocolOnlyV1'};
  if(server.state==='failed')return null;
  if(server.state!=='running')return null;
  const runtime=server.runtime;
  if(runtime===null||runtime===undefined)return null;
  if(runtime.state!=='connected')return null;
  if(runtime.protocolEra==='modern')return {key:'mcpProtocolV2'};
  if(runtime.protocolEra==='legacy')return {key:'mcpProtocolV1'};
  return {key:'mcpProtocolNegotiating'};
};

/** Write refusals, each with its own sentence; machine code travels only to the technical disclosure. */
export const MCP_MUTATION_ERRORS=new Map([
  ['mcp/draft-invalid','mcpDraftInvalid'],
  ['mcp/server-exists','mcpServerExists'],
  ['mcp/server-missing','mcpServerMissing'],
  ['mcp/server-not-editable','mcpServerNotEditable'],
  ['mcp/server-inherited','mcpServerInherited'],
  ['mcp/profile-unavailable','mcpProfileUnavailable'],
  ['mcp/profile-patch-unreadable','mcpPatchUnreadable'],
  ['mcp/write-locked','mcpWriteLocked'],
  ['mcp/write-failed','mcpWriteFailed'],
  ['mcp/probe-unavailable','mcpProbeUnavailable'],
  ['mcp/row-missing','mcpServerMissing'],
  ['mcp/unsupported','mcpUnsupported'],
  ['mcp/managed-unavailable','mcpManagedUnavailable'],
  ['mcp/managed-write-failed','mcpWriteFailed'],
]);

/** ADR-032 purpose refusals: conflict and key-unknown are refreshable. */
export const MCP_PURPOSE_ERRORS=new Map([
  ['mcp/purpose-conflict','mcpPurposeConflict'],
  ['mcp/purpose-key-unknown','mcpPurposeKeyUnknown'],
  ['mcp/purpose-invalid','mcpPurposeInvalid'],
  ['mcp/purpose-write-failed','mcpPurposeWriteFailed'],
  ['mcp/purpose-unavailable','mcpPurposeUnavailable'],
  ['mcp/purpose-partial','mcpPurposePartial'],
]);

export const mcpPurposeSentence=(t,failed)=>{
  const code=failed&&typeof failed==='object'?codeOf(failed):null;
  const key=code===null?undefined:MCP_PURPOSE_ERRORS.get(code);
  return key===undefined?t('mcpPurposeWriteFailed'):t(key);
};

export const mcpPurposeRefreshable=failed=>{
  const code=failed&&typeof failed==='object'?codeOf(failed):null;
  return code==='mcp/purpose-conflict'||code==='mcp/purpose-key-unknown';
};

export const mcpMutationSentence=(t,failed)=>{
  const code=failed&&typeof failed==='object'?codeOf(failed):null;
  const key=code===null?undefined:MCP_MUTATION_ERRORS.get(code);
  return key===undefined?t('mcpSaveFailed'):t(key);
};

/** Draft field names (the Host's machine facts) to the label the form already shows for that field. */
export const MCP_DRAFT_FIELD_LABELS=new Map([
  ['name','mcpServerName'],
  ['serverName','mcpServerName'],
  ['rowId','mcpRow'],
  ['row','mcpRow'],
  ['kind','mcpKind'],
  ['transport','mcpTransport'],
  ['url','mcpUrl'],
  ['command','mcpCommand'],
  ['args','mcpArgs'],
  ['cwd','mcpCwd'],
  ['toolCallTimeoutMs','mcpTimeout'],
  ['failOnStartupError','mcpFailOnStartup'],
  ['staticClientId','mcpStaticClientId'],
  ['authorizationTimeoutMs','mcpAuthTimeout'],
  ['headers','mcpHeaders'],
  ['env','mcpEnv'],
]);

/** One sentence per machine reason; `out-of-range` additionally names the interval the Host reported. */
export const MCP_DRAFT_REASONS=new Map([
  ['required','mcpDraftRequired'],
  ['pattern','mcpDraftPattern'],
  ['invalid-value','mcpDraftInvalidValue'],
  ['wrong-type','mcpDraftWrongType'],
  ['not-allowed','mcpDraftNotAllowed'],
  ['out-of-range','mcpDraftOutOfRange'],
  ['kind-conflict','mcpDraftKindConflict'],
  ['transport-mismatch','mcpDraftTransportMismatch'],
  ['not-unique','mcpDraftNotUnique'],
  ['not-editable','mcpDraftNotEditable'],
]);

export const mcpDraftInvalidSentence=(t,failed)=>{
  if(codeOf(failed)!=='mcp/draft-invalid')return null;
  const details=failed&&typeof failed==='object'?failed.details:null;
  if(!details||typeof details!=='object')return null;
  const reasonName=typeof details.reason==='string'?details.reason:null;
  const field=typeof details.field==='string'?details.field:null;
  const labelKey=field===null?undefined:MCP_DRAFT_FIELD_LABELS.get(field);
  const reasonKey=reasonName===null?undefined:MCP_DRAFT_REASONS.get(reasonName);
  if(reasonKey===undefined||labelKey===undefined)return null;
  const label=t(labelKey);
  if(reasonName==='out-of-range'){
    if(!Number.isFinite(details.min)||!Number.isFinite(details.max))return null;
    return fill(t(reasonKey),{label,min:String(details.min),max:String(details.max)});
  }
  return fill(t(reasonKey),{label});
};

export const mutationRaw=failed=>failed&&failed.failure&&typeof failed.failure.raw==='string'?failed.failure.raw:String(failed&&failed.message?failed.message:failed);

export const mcpActionSentence=(t,failed,fallbackKey)=>{
  const code=failed&&typeof failed==='object'?codeOf(failed):null;
  const key=code===null?undefined:MCP_MUTATION_ERRORS.get(code);
  return key===undefined?t(fallbackKey):t(key);
};

export const SKILLS_MUTATION_ERRORS=new Map([
  ['skills/name-taken','skillsNameTaken'],
  ['skills/not-editable','skillsNotEditable'],
  ['skills/invalid-draft','skillsInvalidDraft'],
  ['skills/path-escape','skillsPathEscape'],
  ['skills/write-failed','skillsWriteFailed'],
]);

export const skillsMutationSentence=(t,failed)=>{
  const code=failed&&typeof failed==='object'?codeOf(failed):null;
  const key=code===null?undefined:SKILLS_MUTATION_ERRORS.get(code);
  return key===undefined?t('skillsSaveFailed'):t(key);
};

/** One draft line is a non-empty name plus its value; blank lines are "keep the existing value". */
export const pairList=rows=>rows
  .filter(pair=>pair&&typeof pair.key==='string'&&pair.key.trim().length>0&&typeof pair.value==='string'&&pair.value.length>0)
  .map(pair=>({key:pair.key.trim(),value:pair.value}));
