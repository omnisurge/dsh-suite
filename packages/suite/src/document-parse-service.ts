import {mkdir,readFile,rename,writeFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {DocumentParseRefusal} from './document-parse-types.js';
import type {DocumentParseCapabilities, DocumentParseModeDescriptor, DocumentParseProvider, DocumentParseProviderState, DocumentParseRequest, DocumentParseResult, DocumentParseService as DocumentParseServiceInterface, DocumentParseState} from './document-parse-types.js';
import {MineruDocumentParse} from './document-parse-mineru.js';
import {PaddleOcrDocumentParse} from './document-parse-paddle.js';

export interface DocumentParseConfigView {mineruApiKeyRef:string; paddleOcrTokenRef:string;}
export interface DocumentParseUsage {calls:number; pages:number; lastAt:string|null;}
export interface DocumentParseServiceDeps {
 config:()=>DocumentParseConfigView;
 profileDirectory:()=>Promise<string|null>;
 resolveCredential?:(ref:string)=>Promise<string|undefined>;
 describeCredential?:(ref:string)=>Promise<{configured:boolean;writable:boolean}|undefined>;
 providers?:DocumentParseProvider[];
 readState?:()=>Promise<DocumentParseState>;
 writeState?:(state:DocumentParseState)=>Promise<void>;
 now?:()=>number;
}
const DEFAULT_STATE:DocumentParseState={enabled:false};
const refsFor=(provider:string,config:DocumentParseConfigView):Record<string,string>=>provider==='mineru'?{apiKey:config.mineruApiKeyRef}:{token:config.paddleOcrTokenRef};
const usagePath=async(deps:DocumentParseServiceDeps):Promise<string|null>=>{const profile=await deps.profileDirectory();return profile===null?null:join(profile,'omnisurge','document-parse','usage.json');};
const readUsage=async(path:string|null):Promise<Record<string,DocumentParseUsage>>=>{if(path===null)return {};try{const parsed=JSON.parse(await readFile(path,'utf8')) as {providers?:Record<string,DocumentParseUsage>};return parsed?.providers??{};}catch{return {};}};
const recordUsage=async(path:string|null,provider:string,pages:number,now:number):Promise<void>=>{if(path===null)return; const current=await readUsage(path); const previous=current[provider]??{calls:0,pages:0,lastAt:null}; const next={...current,[provider]:{calls:previous.calls+1,pages:previous.pages+pages,lastAt:new Date(now).toISOString()}}; await mkdir(dirname(path),{recursive:true,mode:0o700}); const pending=join(dirname(path),'.document-parse-'+randomUUID()+'.pending'); await writeFile(pending,JSON.stringify({protocol:1,providers:next},null,2)+'\n',{mode:0o600}); await rename(pending,path);};
const modeAvailable=(provider:DocumentParseProvider,mode:DocumentParseModeDescriptor,configured:boolean):boolean=>mode.auth==='none'||configured;
const providerConfigured=(provider:DocumentParseProvider,credentials:{configured:boolean}):boolean=>provider.descriptor.id==='mineru'?true:credentials.configured;

export function createDocumentParseService(deps:DocumentParseServiceDeps):DocumentParseServiceInterface {
 const providers=deps.providers??[new MineruDocumentParse(), new PaddleOcrDocumentParse()];
 const state=()=>deps.readState?.()??Promise.resolve(DEFAULT_STATE);
 const stateFor=async(provider:DocumentParseProvider):Promise<DocumentParseProviderState>=>{
  const config=deps.config(); const refs=refsFor(provider.descriptor.id,config); let credentials:Record<string,{configured:boolean;writable:boolean}>|null=null;
  if(deps.describeCredential!==undefined){credentials={};for(const [role,ref] of Object.entries(refs)){credentials[role]=(await deps.describeCredential(ref))??{configured:false,writable:false};}}
  const configured=provider.descriptor.id==='mineru'?true:credentials!==null&&Object.values(credentials).every(item=>item.configured);
  const currentState=await state();
  return {id:provider.descriptor.id,refs,configured,credentials,usage:null,lastError:currentState.lastErrors?.[provider.descriptor.id]??null};
 };
 const availableModes=async():Promise<{provider:DocumentParseProvider;mode:DocumentParseModeDescriptor}[]>=>{
  const result: {provider:DocumentParseProvider;mode:DocumentParseModeDescriptor}[]=[];
  for(const provider of providers){const providerState=await stateFor(provider);for(const mode of provider.descriptor.modes){
   const credentialReady=mode.auth==='none'||mode.credentialRoles.every(role=>providerState.credentials?.[role]?.configured===true);
   if(modeAvailable(provider,mode,credentialReady))result.push({provider,mode});
  }}
  return result;
 };
 return {
  async capabilities(){
   const currentState=await state(); const usage=await readUsage(await usagePath(deps)); const providerStates:Record<string,DocumentParseProviderState>={};
   for(const provider of providers){const item=await stateFor(provider);providerStates[provider.descriptor.id]={...item,usage:usage[provider.descriptor.id]??null};}
   return {providers:providers.map(provider=>provider.descriptor),providerStates,enabled:currentState.enabled};
  },
  async parse(input:DocumentParseRequest):Promise<DocumentParseResult>{
   const currentState=await state(); if(!currentState.enabled)throw new DocumentParseRefusal('DOCUMENT_PARSE_DISABLED','document parsing is switched off in settings');
   const modes=await availableModes();
   const requestedProvider=input.provider;
   const requestedMode=input.mode;
   const candidates=modes.filter(item=>(requestedProvider===undefined||item.provider.descriptor.id===requestedProvider)&&(requestedMode===undefined||item.mode.id===requestedMode));
   let selected=candidates.length===1?candidates[0]:undefined;
   if(candidates.length>1)throw new DocumentParseRefusal('DOCUMENT_PARSE_SELECTION_REQUIRED','multiple provider/mode combinations are available',{alternatives:candidates.map(item=>item.provider.descriptor.id+':'+item.mode.id)});
   if(selected===undefined){
    const exact=providers.find(provider=>provider.descriptor.id===requestedProvider); const mode=exact?.descriptor.modes.find(candidate=>candidate.id===requestedMode);
    const exactState=exact===undefined?null:await stateFor(exact);
    const credentialReady=mode!==undefined&&mode.credentialRoles.every(role=>exactState?.credentials?.[role]?.configured===true);
    if(mode!==undefined&&mode.auth==='credential'&&!credentialReady)throw new DocumentParseRefusal('DOCUMENT_PARSE_CREDENTIAL_MISSING','document parsing credential is not configured',{provider:requestedProvider,mode:requestedMode});
    throw new DocumentParseRefusal('DOCUMENT_PARSE_PROVIDER_UNKNOWN','provider/mode is not available',{provider:requestedProvider,mode:requestedMode});
   }
   const provider=selected.provider; const mode=selected.mode; const config=deps.config(); const refs=refsFor(provider.descriptor.id,config); const credentials:Record<string,string>={};
   for(const [role,ref] of Object.entries(refs)){if(ref.length===0)continue;const value=await deps.resolveCredential?.(ref);if(typeof value==='string'&&value.length>0)credentials[role]=value;}
   const remember=async(code:string,retryAfter:number|null,modeId:string)=>{try{const latest=await state();await deps.writeState?.({...latest,lastErrors:{...(latest.lastErrors??{}),[provider.descriptor.id]:{code,at:new Date(deps.now?.()??Date.now()).toISOString(),retryAfter,mode:modeId}}});}catch{}};
   const started=Date.now();
   try{
    const result=await provider.parse({...input,provider:provider.descriptor.id,mode:mode.id},credentials);
    try{await recordUsage(await usagePath(deps),provider.descriptor.id,result.pages?.extracted??0,deps.now?.()??Date.now());}catch{}
    return {...result,provider:provider.descriptor.id,mode:mode.id,state:'done' as const,warnings:result.warnings??[]};
   }catch(error){
    if(error instanceof DocumentParseRefusal){
     const alternatives=modes.filter(item=>!(item.provider.descriptor.id===provider.descriptor.id&&item.mode.id===mode.id)).map(item=>item.provider.descriptor.id+':'+item.mode.id);
     const detail={provider:provider.descriptor.id,mode:mode.id,alternatives,...error.detail};
     await remember(error.code,error.detail.retryAfter??null,mode.id);
     throw new DocumentParseRefusal(error.code,error.message,detail);
    }
    await remember('DOCUMENT_PARSE_PROVIDER_ERROR',null,mode.id);
    throw new DocumentParseRefusal('DOCUMENT_PARSE_PROVIDER_ERROR',String((error as Error)?.message??error),{provider:provider.descriptor.id,mode:mode.id});
   }
  },
  async setEnabled(enabled:boolean){const current=await state();const next={...current,enabled};await deps.writeState?.(next);return this.capabilities();},
 };
}
