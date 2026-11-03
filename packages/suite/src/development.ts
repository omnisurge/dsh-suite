import {spawn} from 'node:child_process';
import {access,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import type {BuildResult} from './types.js';
import {verifyBuildReceipt,bootstrapRequired,RECEIPT_PREFIX,ERROR_PREFIX} from './build-protocol.js';
export {SUITE_DEVELOPMENT_PROTOCOL,REQUIRED_CAPABILITIES,verifyBuildReceipt} from './build-protocol.js';
const MAX_OUTPUT=65536;
const TERMINATE_GRACE_MS=2000;
function aborted(signal:AbortSignal):Error{return Error('BUILD_ABORTED: '+String(signal.reason instanceof Error?signal.reason.message:signal.reason??'manager cancelled the build'));}
/** A queued claim is cancellable without waiting for HMR FIFO progress. Once entered, only the
 * operation's real cleanup can settle it. The immutable round signal guards late callbacks. */
export function runCancellableExclusive<T>(exclusive:((work:()=>Promise<T>)=>Promise<T>)|undefined,work:()=>Promise<T>,signal:AbortSignal):Promise<T>{
 return new Promise<T>((resolve,reject)=>{
  let started=false,settled=false;
  const finish=(error:unknown,value?:T)=>{if(settled)return;settled=true;signal.removeEventListener('abort',onAbort);if(error)reject(error);else resolve(value as T);};
  const onAbort=()=>{if(!started)finish(aborted(signal));};
  signal.addEventListener('abort',onAbort,{once:true});
  if(signal.aborted){onAbort();return;}
  const enter=()=>{if(signal.aborted)throw aborted(signal);started=true;return work();};
  try{const pending=exclusive?exclusive(enter):enter();Promise.resolve(pending).then(value=>finish(null,value),error=>finish(error));}catch(error){finish(error);}
 });
}
/** Run current fixed-entry bytes. Only this detached POSIX process group is signalled. Abort
 * rejection is a close/cleanup barrier, not an early race which releases the HMR owner. */
export function runFixedBuildEntry(root:string,state:string,signal:AbortSignal):Promise<BuildResult>{
 return new Promise<BuildResult>((settle,reject)=>{
  let done=false,live:ReturnType<typeof spawn>|undefined,killTimer:ReturnType<typeof setTimeout>|undefined,killError:Error|undefined;
  const finish=(error:Error|null,value?:BuildResult)=>{if(done)return;done=true;if(killTimer)clearTimeout(killTimer);signal.removeEventListener('abort',onAbort);if(error)reject(error);else settle(value as BuildResult);};
  const killGroup=(name:NodeJS.Signals)=>{const pid=live?.pid;if(!pid)return;try{process.kill(-pid,name);}catch(error){if((error as NodeJS.ErrnoException).code!=='ESRCH')killError=Error('BUILD_TREE_STOP_FAILED: '+String(error));}};
  const onAbort=()=>{if(!live){finish(aborted(signal));return;}killGroup('SIGTERM');killTimer=setTimeout(()=>killGroup('SIGKILL'),TERMINATE_GRACE_MS);};
  signal.addEventListener('abort',onAbort,{once:true});
  if(signal.aborted){onAbort();return;}
  void (async()=>{
   try{await mkdir(state,{recursive:true});await mkdir(join(state,'entry-home'),{recursive:true});await access(join(root,'scripts','build','build-target.mjs'));}
   catch{finish(bootstrapRequired('the fixed build entry is missing or unreadable'));return;}
   if(done)return;
   const env:NodeJS.ProcessEnv={PATH:'/usr/bin:/bin:/usr/local/bin',HOME:join(state,'entry-home'),TMPDIR:state,LANG:'C.UTF-8',ELECTRON_RUN_AS_NODE:'1',NODE_NO_WARNINGS:'1',GIT_CONFIG_NOSYSTEM:'1'};
   try{live=spawn(process.execPath,[join(root,'scripts','build','build-target.mjs'),'--root',root,'--state',state],{cwd:root,env,detached:true,stdio:['ignore','pipe','pipe']});}
   catch{finish(bootstrapRequired('the fixed build entry could not be started'));return;}
   const running=live;let stdout='',stderr='',spawnError:Error|undefined;
   running.stdout?.on('data',chunk=>{stdout=(stdout+String(chunk)).slice(-MAX_OUTPUT);});
   running.stderr?.on('data',chunk=>{stderr=(stderr+String(chunk)).slice(-MAX_OUTPUT);});
   running.once('error',error=>{spawnError=error;});
   const outcome=await new Promise<{code:number|null;signal:NodeJS.Signals|null}>(resolve=>running.once('close',(code,signalName)=>resolve({code,signal:signalName})));
   if(signal.aborted){
    killGroup('SIGKILL');const error=killError??aborted(signal);
    // Cancellation must not hide a child's partial-publication/recovery diagnosis.
    const diagnostic=stderr.split('\n').find(line=>line.startsWith(ERROR_PREFIX));
    if(diagnostic)error.message+='; '+diagnostic.slice(ERROR_PREFIX.length);
    if(outcome.signal==='SIGKILL')error.message+='; BUILD_OUTCOME_UNCONFIRMED: forced termination cannot guarantee finally; inspect the owned lease and generation recovery material before retrying';
    finish(error);return;
   }
   if(spawnError){finish(bootstrapRequired('the fixed build entry could not be started ('+spawnError.message+')'));return;}
   const errorLine=stderr.split('\n').find(line=>line.startsWith(ERROR_PREFIX));
   // A valid receipt can never turn a failed or signal-killed process into a successful build.
   if(outcome.code!==0||outcome.signal!==null){finish(Error('BUILD_ENTRY_FAILED: exited '+outcome.code+'/'+outcome.signal+'\n'+(errorLine?errorLine.slice(ERROR_PREFIX.length):stderr)));return;}
   const receiptLine=stdout.split('\n').find(line=>line.startsWith(RECEIPT_PREFIX));
   if(!receiptLine){finish(bootstrapRequired('the fixed build entry returned no receipt'));return;}
   let parsed:unknown;try{parsed=JSON.parse(receiptLine.slice(RECEIPT_PREFIX.length));}catch{finish(bootstrapRequired('the fixed build entry returned an unreadable receipt'));return;}
   try{finish(null,verifyBuildReceipt(parsed));}catch(error){finish(error as Error);}
  })();
 });
}
