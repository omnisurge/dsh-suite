import {copyFile,mkdir,readFile,rename,unlink,writeFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {RemoteError} from '@deepseek-ai/dsh-typert-protocol';
import type {McpPurposePartialDetail,McpPurposeServer,McpPurposeSnapshot,McpPurposeUnreadable,McpPurposeWriteFailureDetail,McpPurposeWriteResult} from './types.js';

/**
 * ADR-032: the MCP "purpose" bypass file and the prompt section built from it.
 *
 * The file is the only authority for what a user wrote (`<profile>/.omnisurge/mcp-purpose.json`); the in-memory
 * snapshot is the only read path for the prompt section, so a session can never be held up by disk IO or by a
 * broken file. Every write replaces the file atomically first and only then swaps the snapshot (D2).
 */

export const PURPOSE_DIRECTORY='.omnisurge';
export const PURPOSE_FILE_NAME='mcp-purpose.json';
export const PURPOSE_VERSION=1;
export const PURPOSE_MAX_CHARS=200;
export const PURPOSE_SECTION_NAME='omnisurge:mcp';
export const PURPOSE_SECTION_ORDER=3110;
const RAW_LIMIT=2000;
/** M1/ADR-037 D5: a staged name only this call may use. The pid separates processes; the counter and a random
 * tail separate callers inside one process, where two writes used to share one temporary file and stomp each
 * other. The row-deletion transaction stages its own pair the same way. */
let uniqueCounter=0;
function uniqueName(path:string,kind:'tmp'|'backup'):string{
 return path+'.omnisurge-'+String(process.pid)+'-'+String(uniqueCounter++)+'-'+Math.random().toString(36).slice(2,8)+'.'+kind;
}

/** One row the purpose editor may address: the catalog's identity (rowId), never the server name (D1/D5). */
export interface McpPurposeRow {rowId:string;serverName:string;enabled:boolean;}
/** The in-memory truth. `unreadable` means the file exists but could not be trusted (D6). */
export interface PurposeState {routing:boolean;purposes:Record<string,string>;revision:number;unreadable?:McpPurposeUnreadable;}
/** The loader shape this module needs; the row identification itself is supplied by the caller (one table, D3). */
export interface PurposeLoaderLike {entries():Iterable<unknown>;}

const codeOf=(error:unknown):string|undefined=>(error as NodeJS.ErrnoException|undefined)?.code;
/** The underlying failure is never swallowed: the code keeps its step and the original message. A refusal that
 * already carries machine facts (a RemoteError) is unwrapped to the failure underneath it, so a detail never
 * reports the suite's own wrapper code where the operating system's code belongs (ADR-032 D5). */
export const failureOf=(error:unknown):{code:string;message:string}=>{
 const details=(error as {details?:{code?:unknown;message?:unknown}}|undefined)?.details;
 if(details!==null&&typeof details==='object'){
  const code=details.code,message=details.message;
  if(typeof code==='string'&&code.length>0&&typeof message==='string'&&message.length>0)return {code,message};
 }
 const code=(error as {code?:unknown}|undefined)?.code;
 return {code:typeof code==='string'&&code.length>0?code:'unknown',message:error instanceof Error?error.message:String(error)};
};
const failed=(step:McpPurposeWriteFailureDetail['step'],detail:string,error?:unknown):RemoteError=>{
 const cause=failureOf(error);
 const detailValue:McpPurposeWriteFailureDetail={step,code:cause.code,message:error===undefined?detail:cause.message};
 return new RemoteError('mcp/purpose-write-failed','MCP_PURPOSE_WRITE_FAILED: '+detail,detailValue);
};
const conflict=()=>new RemoteError('mcp/purpose-conflict','MCP_PURPOSE_CONFLICT: the purposes changed since they were read',{});
const unknownKey=()=>new RemoteError('mcp/purpose-key-unknown','MCP_PURPOSE_KEY_UNKNOWN: no such MCP row',{});
const invalidPurpose=(detail:string)=>new RemoteError('mcp/purpose-invalid','MCP_PURPOSE_INVALID: '+detail,{});
/** ADR-032 D5/D6: no profile, or a file that must not be written (unreadable) — both refuse the write. */
export const purposeUnavailable=()=>new RemoteError('mcp/purpose-unavailable','MCP_PURPOSE_UNAVAILABLE: the purposes cannot be written in this state',{});

export function purposeFilePath(profileDir:string):string{return join(profileDir,PURPOSE_DIRECTORY,PURPOSE_FILE_NAME);}

/** ADR-032 D1: one line, at most 200 characters, control characters folded to spaces, `{{`/`}}` kept verbatim.
 * Folding is not rewriting the user's words: it removes line breaks and runs of whitespace only. */
export function normalizePurpose(input:string):{ok:true;value:string}|{ok:false;reason:'too-long'} {
 const folded=input.replace(/[\u0000-\u001f\u007f-\u009f]/gu,' ').replace(/ {2,}/gu,' ').trim();
 return folded.length>PURPOSE_MAX_CHARS?{ok:false,reason:'too-long'}:{ok:true,value:folded};
}

function excerpt(text:string):string{return text.length<=RAW_LIMIT?text:text.slice(0,RAW_LIMIT);}

/** Parse the stored shape. Anything this build does not recognize is `unreadable` — never "close enough" (D6). */
export function parsePurposeFile(text:string):PurposeState|{unreadable:McpPurposeUnreadable} {
 let parsed:unknown;
 try{parsed=JSON.parse(text);}catch{return {unreadable:{code:'bad-json',raw:excerpt(text)}};}
 if(parsed===null||typeof parsed!=='object'||Array.isArray(parsed))return {unreadable:{code:'bad-shape',raw:excerpt(text)}};
 const record=parsed as Record<string,unknown>;
 if(typeof record.version!=='number'||!Number.isSafeInteger(record.version))return {unreadable:{code:'bad-shape',raw:excerpt(text)}};
 if(record.version!==PURPOSE_VERSION)return {unreadable:{code:'version-unknown',raw:excerpt(text)}};
 if(typeof record.revision!=='number'||!Number.isSafeInteger(record.revision)||record.revision<0)return {unreadable:{code:'bad-shape',raw:excerpt(text)}};
 if(typeof record.routing!=='boolean')return {unreadable:{code:'bad-shape',raw:excerpt(text)}};
 const stored=record.purposes;
 if(stored===null||typeof stored!=='object'||Array.isArray(stored))return {unreadable:{code:'bad-shape',raw:excerpt(text)}};
 const purposes:Record<string,string>={};
 for(const [key,value] of Object.entries(stored as Record<string,unknown>)){
  if(typeof value!=='string')return {unreadable:{code:'bad-shape',raw:excerpt(text)}};
  purposes[key]=value;
 }
 return {routing:record.routing,purposes,revision:record.revision};
}

export function serializePurposeFile(state:PurposeState):string{
 return JSON.stringify({version:PURPOSE_VERSION,revision:state.revision,routing:state.routing,purposes:state.purposes},null,2)+'\n';
}

/** Read once, at apply time (D2). A missing file is empty truth; a present but untrustworthy file is `unreadable`. */
export async function readPurposeFile(path:string):Promise<PurposeState> {
 let text:string;
 try{text=await readFile(path,'utf8');}
 catch(error){
  if(codeOf(error)==='ENOENT')return {routing:true,purposes:{},revision:0};
  return {routing:true,purposes:{},revision:0,unreadable:{code:'read-failed',raw:excerpt(String(codeOf(error)??'unreadable'))}};
 }
 const parsed=parsePurposeFile(text);
 return 'unreadable' in parsed?{routing:true,purposes:{},revision:0,unreadable:parsed.unreadable}:parsed;
}

/** Replace the file atomically: write a temporary file, keep the previous bytes as a backup, then rename. */
async function writeAtomic(path:string,text:string):Promise<void> {
 await mkdir(dirname(path),{recursive:true});
 const backup=uniqueName(path,'backup');
 const temporary=uniqueName(path,'tmp');
 let had=false;
 try{await copyFile(path,backup);had=true;}
 catch(error){
  if(codeOf(error)!=='ENOENT'){
   await unlink(backup).catch(()=>undefined); // L1/ADR-037 D4: a half-written backup is debris, never an artifact
   throw failed('purpose-backup','the current purposes could not be backed up',error);
  }
 }
 try{
  await writeFile(temporary,text,'utf8');
  await rename(temporary,path);
 }catch(error){
  await unlink(temporary).catch(()=>undefined);
  // L1/ADR-037 D4: the rollback runs before anything is rethrown, so no failure path can leave the backup behind.
  const kept=had&&!await restorePrevious(path,backup);
  if(error instanceof RemoteError)throw error;
  if(kept)throw failed('purpose-rename','the bypass file was not changed and the previous bytes could not be restored; they are kept at '+backup,error);
  throw failed('purpose-rename','the bypass file was not changed',error);
 }
 // F3: the backup exists for this call's own rollback only. Once the new bytes are in place it is garbage, and a
 // user's profile directory must not accumulate backups. Best effort: the write already landed.
 await unlink(backup).catch(()=>undefined);
}

/** L1/ADR-037 D4: a failed write must leave exactly the bypass file behind. The rename either replaced the
 * bytes or it did not, so read the file back: while the previous bytes are still in place nothing has to be
 * restored and the backup is already debris; only a target that moved is copied back. Either way the backup is
 * consumed here. False only when the previous bytes are gone and could not be copied back — then the backup is
 * the only copy left, so it is kept and the caller names it in the refusal. */
async function restorePrevious(path:string,backup:string):Promise<boolean> {
 const previous=await readFile(backup,'utf8').catch(()=>null);
 const current=await readFile(path,'utf8').catch(()=>null);
 if(previous!==null&&current===previous){await unlink(backup).catch(()=>undefined);return true;}
 const restored=await copyFile(backup,path).then(()=>true,()=>false);
 if(restored)await unlink(backup).catch(()=>undefined);
 return restored;
}

/** A staged purpose-file change: the temporary file and the backup exist, nothing is renamed yet. */
export interface PurposeRemoval {
 path:string;
 oldText:string;
 newText:string;
 /** Renames the cleaned file over the old one (first rename of the ADR-032 D5 transaction). */
 commit():Promise<void>;
 /** Restores the bytes from before the rename. Never throws: the caller must report a partial state instead. */
 rollback():Promise<{ok:boolean}>;
 /** Drops the backup once the whole transaction has committed. Best effort: the caller reports the outcome. */
 cleanup():Promise<void>;
 /** Adopts the cleaned state in memory; call only after both files are committed. */
 settle():void;
}

export interface PurposeStore {
 /** Reads the file once into memory (apply time). Failure to read is itself a state, not an exception. */
 load():Promise<void>;
 snapshot():PurposeState;
 /** The prompt section text. Zero IO, never throws (D2/D3). */
 sectionText():string;
 /** The snapshot as the page sees it: orphan keys filtered, rows supplied by the caller (D5). */
 view(servers:McpPurposeServer[]):McpPurposeSnapshot;
 writePurpose(input:{rowId:string;purpose:string;expectedRevision:number},servers:McpPurposeServer[]):Promise<McpPurposeWriteResult>;
 setRouting(input:{routing:boolean;expectedRevision:number}):Promise<McpPurposeWriteResult>;
 /** The staged key cleanup for a row deletion, or null when there is nothing to clean (D5). */
 removal(rowId:string):Promise<PurposeRemoval|null>;
}

/** The narrow dependency the MCP catalog module needs from this store (row deletion, ADR-032 D5). */
export interface PurposeStoreLike {removal(rowId:string):Promise<PurposeRemoval|null>;}

export interface PurposeStoreDeps {
 /** null = this process has no profile: writes are refused with `mcp/purpose-unavailable` (D5). */
 profileDir:()=>string|null;
 loader:()=>PurposeLoaderLike|undefined;
 /** The one row-identification rule, supplied by the MCP catalog module (D3: no second table). */
 rowsOf:(loader:PurposeLoaderLike|undefined)=>McpPurposeRow[];
}

const HEADER=[
 '# MCP 旁路工具',
 '这些是按用途标注的可选工具，不是当前项目，也不是你的身份；当前工作区的文件优先。',
 '用户点名这台服务、或问题正落在它的语料上时再用；检索落空就停，不要把服务器目录当待办。',
].join('\n');

export function createPurposeStore(deps:PurposeStoreDeps):PurposeStore {
 let state:PurposeState={routing:true,purposes:{},revision:0};
 // F1: the one apply-time read is a promise every entry point waits for. Until it settles this store has no
 // truth, so the synchronous accessors answer with a fail-closed state instead of a revision:0 default a CAS
 // would accept, and every write/removal waits for the read before it compares revisions.
 let ready:Promise<void>|null=null;
 let settled=false;
 const notLoaded=():PurposeState=>({routing:true,purposes:{},revision:0,unreadable:{code:'read-failed',raw:'not-loaded'}});
 const current=():PurposeState=>(settled?state:notLoaded());
 const pathOf=():{dir:string;path:string}|null=>{const dir=deps.profileDir();return typeof dir==='string'&&dir.length>0?{dir,path:purposeFilePath(dir)}:null;};
 const load=async():Promise<void>=>{
  if(ready!==null)return ready;
  ready=(async()=>{
   try{
    const target=pathOf();
    // No profile directory means the truth cannot even be named, let alone read: fail closed exactly like an
    // unreadable file (no section, both writes refused) instead of presenting an empty default as fact.
    if(target===null){state={routing:true,purposes:{},revision:0,unreadable:{code:'read-failed',raw:'no-profile'}};return;}
    state=await readPurposeFile(target.path);
   }catch(error){
    // A read that throws is a state too: load() never hands its caller an exception.
    state={routing:true,purposes:{},revision:0,unreadable:{code:'read-failed',raw:excerpt(String(codeOf(error)??'unreadable'))}};
   }finally{settled=true;}
  })();
  return ready;
 };
 // M1/ADR-037 D5: every write is serialized inside this store and the CAS is re-checked against the bytes on
 // disk right before the rename. Two callers that both read revision N can therefore not both land: the second
 // is refused with mcp/purpose-conflict instead of silently overwriting the first — the file is the authority
 // (ADR-032 D2) and the in-memory snapshot may already be older than the disk.
 let queue:Promise<unknown>=Promise.resolve();
 const serialized=<T>(work:()=>Promise<T>):Promise<T>=>{
  const run=queue.then(work,work);
  queue=run.then(()=>undefined,()=>undefined);
  return run;
 };
 /** Bytes that moved since this write was prepared are refused, never replaced (M1/ADR-037 D5). */
 const commitIfUnchanged=async(target:{dir:string;path:string},next:PurposeState,base:number):Promise<void>=>{
  const fresh=await readPurposeFile(target.path);
  if(fresh.unreadable!==undefined||fresh.revision!==base)throw conflict();
  await writeAtomic(target.path,serializePurposeFile(next));
  state=next;
 };
 const filter=(purposes:Record<string,string>,servers:McpPurposeServer[]):Record<string,string>=>{
  const known=new Set(servers.map(server=>server.rowId));
  const kept:Record<string,string>={};
  for(const [key,value] of Object.entries(purposes))if(known.has(key))kept[key]=value;
  return kept;
 };
 const store:PurposeStore={
  load,
  snapshot(){return current();},
  sectionText(){
   // Never throws and never touches the disk: one broken file or one broken loader must not fail an assemble.
   try{
    const truth=current();
    if(truth.unreadable!==undefined||truth.routing===false)return '';
    const rows=deps.rowsOf(deps.loader()).filter(row=>row.enabled);
    const filled=rows.some(row=>{const purpose=truth.purposes[row.rowId];return typeof purpose==='string'&&purpose.length>0;});
    if(!filled)return '';
    const lines=rows.map(row=>{const purpose=truth.purposes[row.rowId];return '- '+row.serverName+'：'+(typeof purpose==='string'&&purpose.length>0?purpose:'未填用途');});
    return HEADER+'\n'+lines.join('\n');
   }catch{return '';}
  },
  view(servers){
   const truth=current();
   const view:McpPurposeSnapshot={routing:truth.routing,purposes:filter(truth.purposes,servers),servers,revision:truth.revision};
   if(truth.unreadable!==undefined)view.unreadable=truth.unreadable;
   return view;
  },
  async writePurpose(input,servers){
   // F1: a caller that never awaited the first read still cannot compare against a fabricated revision 0 — this
   // waits for the one read, so a stale expectation loses as a conflict instead of overwriting the file.
   await load();
   // M1: the whole compare-and-write runs inside the store's serialization, and the last check before the rename
   // is against the file itself.
   return serialized(async()=>{
    const target=pathOf();
    if(target===null||state.unreadable!==undefined)throw purposeUnavailable();
    if(!Number.isSafeInteger(input?.expectedRevision)||input.expectedRevision!==state.revision)throw conflict();
    if(typeof input?.rowId!=='string'||!servers.some(server=>server.rowId===input.rowId))throw unknownKey();
    if(typeof input.purpose!=='string')throw invalidPurpose('purpose must be a string');
    const normalized=normalizePurpose(input.purpose);
    if(!normalized.ok)throw invalidPurpose('a purpose is at most '+String(PURPOSE_MAX_CHARS)+' characters');
    const purposes={...state.purposes};
    // An empty (or whitespace-only) purpose clears the key — through the same CAS as any other write.
    if(normalized.value.length===0)delete purposes[input.rowId];
    else purposes[input.rowId]=normalized.value;
    const next:PurposeState={routing:state.routing,purposes,revision:state.revision+1};
    await commitIfUnchanged(target,next,state.revision);
    return {revision:next.revision,routing:next.routing,purposes:{...next.purposes}};
   });
  },
  async setRouting(input){
   await load();
   return serialized(async()=>{
    const target=pathOf();
    if(target===null||state.unreadable!==undefined)throw purposeUnavailable();
    if(!Number.isSafeInteger(input?.expectedRevision)||input.expectedRevision!==state.revision)throw conflict();
    if(typeof input?.routing!=='boolean')throw invalidPurpose('routing must be a boolean');
    const next:PurposeState={routing:input.routing,purposes:{...state.purposes},revision:state.revision+1};
    await commitIfUnchanged(target,next,state.revision);
    return {revision:next.revision,routing:next.routing,purposes:{...next.purposes}};
   });
  },
  async removal(rowId){
   await load();
   return serialized(async()=>{
    const target=pathOf();
    // A file that could not be trusted is never overwritten (D6); the stale key stays and the orphan filter hides it.
    if(target===null||state.unreadable!==undefined)return null;
    if(!Object.prototype.hasOwnProperty.call(state.purposes,rowId))return null;
    const purposes={...state.purposes};
    delete purposes[rowId];
    const next:PurposeState={routing:state.routing,purposes,revision:state.revision+1};
    const oldText=serializePurposeFile(state);
    const newText=serializePurposeFile(next);
    const base=state.revision;
    const backup=uniqueName(target.path,'backup');
    const temporary=uniqueName(target.path,'tmp');
    await mkdir(dirname(target.path),{recursive:true});
    try{await copyFile(target.path,backup);}
    catch(error){
     if(codeOf(error)!=='ENOENT'){
      await unlink(backup).catch(()=>undefined); // L1/ADR-037 D4: a half-written backup is debris
      throw failed('purpose-backup','the current purposes could not be backed up',error);
     }
    }
    try{await writeFile(temporary,newText,'utf8');}
    catch(error){
     // L1/ADR-037 D4: a transaction that never reached its rename leaves no backup and no staged file.
     await unlink(temporary).catch(()=>undefined);
     await unlink(backup).catch(()=>undefined);
     throw failed('purpose-stage','the cleaned purposes could not be staged',error);
    }
    return {
     path:target.path,
     oldText,
     newText,
     async commit(){
      // M1/ADR-037 D5: the staged bytes were computed from `base`. If the file moved since, replacing it would
      // drop the newer write: drop this transaction's staged files and refuse instead of overwriting.
      return serialized(async()=>{
       const fresh=await readPurposeFile(target.path);
       if(fresh.unreadable!==undefined||fresh.revision!==base){
        await unlink(temporary).catch(()=>undefined);
        await unlink(backup).catch(()=>undefined);
        throw conflict();
       }
       try{await rename(temporary,target.path);}
       catch(error){
        // L1-1/ADR-037 D4: this is the first of the two renames, so the purpose file still holds its old bytes —
        // the backup has nothing left to roll back and the caller is not obliged to call rollback(). Consume both
        // staged files here, so a failed deletion cannot leave residue in the user's profile.
        await unlink(temporary).catch(()=>undefined);
        await unlink(backup).catch(()=>undefined);
        throw failed('purpose-rename','the bypass file was not replaced',error);
       }
      });
     },
     async rollback(){
      return serialized(async()=>{
       await unlink(temporary).catch(()=>undefined);
       const current=await readFile(target.path,'utf8').catch(()=>null);
       if(current!==null&&current!==oldText&&current!==newText){
        // A newer write landed after this transaction: never clobber it. The backup holds bytes older than the
        // file, so it is not recovery material either — drop it (L1/ADR-037 D4).
        await unlink(backup).catch(()=>undefined);
        return {ok:false};
       }
       if(current===oldText){await unlink(backup).catch(()=>undefined);return {ok:true};}
       const restored=await copyFile(backup,target.path).then(()=>true,()=>false);
       if(restored)await unlink(backup).catch(()=>undefined);
       return {ok:restored};
      });
     },
     settle(){state=next;},
     async cleanup(){await unlink(backup).catch(()=>undefined);},
    };
   });
  },
 };
 return store;
}

/** Which of the two files a failed transaction left behind: `other` = neither the old nor the new bytes. */
export async function fileStateOf(path:string,oldText:string|null,newText:string|null):Promise<'old'|'new'|'other'|'unknown'> {
 try{
  const current=await readFile(path,'utf8');
  if(newText!==null&&current===newText)return 'new';
  if(oldText!==null&&current===oldText)return 'old';
  return 'other';
 }catch(error){
  if(codeOf(error)==='ENOENT')return oldText===null?'old':'unknown';
  return 'unknown';
 }
}

export type {McpPurposePartialDetail};
