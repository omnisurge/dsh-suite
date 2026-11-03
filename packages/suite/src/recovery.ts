import {mkdir,open,readFile,realpath,rename,unlink} from 'node:fs/promises';
import {dirname,isAbsolute,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import type {RecoveryReceipt} from './types.js';

/** The one resolver for the Suite's own profile state directory: each level is validated before the
 * next is created, so an aliased parent never receives a directory of ours outside the profile. */
export async function profileStateDirectory(base:string):Promise<string>{
 if(!isAbsolute(base))throw Error('BOOT_STATE_DIRECTORY_INVALID');
 const profile=await realpath(base);
 const owner=join(profile,'.omnisurge-suite');
 await mkdir(owner,{recursive:true,mode:0o700});
 if(await realpath(owner)!==owner)throw Error('BOOT_STATE_DIRECTORY_ALIAS');
 const directory=join(owner,'state');
 await mkdir(directory,{recursive:true,mode:0o700});
 if(await realpath(directory)!==directory)throw Error('BOOT_STATE_DIRECTORY_ALIAS');
 return directory;
}
/** The one atomic writer for the Suite's own profile state: temp file in the same directory, fsync, then
 * rename, and a target that may never leave that directory. The start-up healer shares it rather than
 * opening a second write path to profile state. */
export async function writeProfileState(directory:string,name:string,value:unknown):Promise<void>{
 const target=join(directory,name);
 if(dirname(target)!==directory)throw Error('BOOT_STATE_TARGET_INVALID');
 const pending=join(directory,'.'+name+'.'+randomUUID()+'.pending');
 const file=await open(pending,'wx',0o600);
 try{await file.writeFile(JSON.stringify(value,null,2)+'\n');await file.sync();}finally{await file.close();}
 try{await rename(pending,target);}finally{try{await unlink(pending);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}}
}
export interface BootSentinel {pid:number;startedAt:string;phase:'loading'|'ready'|'closed';components:string[];}
export interface DeclaredComponent {id:string;rowId:string;module:string;}
export interface DisabledRow {id:string;rowId:string;application:string;code:string|null;}
export interface RecoveryOutcome {recovered:boolean;receipt:RecoveryReceipt|null;diagnostic:string|null;}

/** The one fact this module owns: whether the previous process reached readiness, and therefore
 * whether the rows it enabled may be the reason that process died. It is a derived fact about a
 * process generation, never a second installed/ready store, and it lives only in the Suite's own
 * profile state directory. Recovery is row-level and idempotent; the profile-wide recovery that
 * disables every third-party plugin stays official-owned. */
export class BootGuard {
 private timer:NodeJS.Timeout|null=null;
 private ready=false;
 private disposed=false;
 /** Every write this guard starts, so disposal can join it instead of racing profile teardown. */
 private readonly writes=new Set<Promise<unknown>>();
 private readonly receiptPath:string;
 private readonly sentinelPath:string;
 constructor(private readonly stateDirectory:()=>Promise<string>,private readonly disable:(component:DeclaredComponent)=>Promise<{application:string;code:string|null}>,private readonly notify:(message:string,detail:Record<string,unknown>)=>void,private readonly graceMs=30000){
  this.sentinelPath='boot.json';
  this.receiptPath='recovery.json';
 }
 private async directory():Promise<string>{
  return profileStateDirectory(await this.stateDirectory());
 }
 private async readState<T>(directory:string,name:string):Promise<T|null>{
  try{return JSON.parse(await readFile(join(directory,name),'utf8')) as T;}
  catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT'||error instanceof SyntaxError)return null;throw error;}
 }
 private async writeState(directory:string,name:string,value:unknown):Promise<void>{
  await writeProfileState(directory,name,value);
 }
 private track<T>(operation:Promise<T>):Promise<T>{
  const tracked=operation.finally(()=>{this.writes.delete(tracked);});
  this.writes.add(tracked);
  return tracked;
 }
 /** The only door to profile state: a disposed guard refuses new writes, and every started write is
  * owned by this guard, so a caller that awaits disposal can never observe a late mutation. */
 private async write(directory:string,name:string,value:unknown):Promise<void>{
  if(this.disposed)return;
  await this.track(this.writeState(directory,name,value));
 }
 /** Record this process generation and, when the previous one died without ever becoming ready,
  * disable exactly the declared component rows once. Returns the durable receipt so callers can
  * report it. A generation that unloaded cleanly is not a death: it says so in `dispose`, so the
  * next generation must not punish rows the user enabled for a shutdown that worked. */
 async begin(components:DeclaredComponent[]):Promise<RecoveryOutcome>{
  if(this.disposed)return {recovered:false,receipt:null,diagnostic:'BOOT_GUARD_DISPOSED'};
  let directory:string;
  try{directory=await this.directory();}
  catch(error){return {recovered:false,receipt:null,diagnostic:String((error as Error)?.message??error)};}
  const previous=await this.readState<BootSentinel>(directory,this.sentinelPath);
  let receipt:RecoveryReceipt|null=null;
  if(previous!==null&&previous.phase==='loading'&&previous.pid!==process.pid){
   const rows:DisabledRow[]=[];
   for(const component of components){
    try{const outcome=await this.disable(component);rows.push({id:component.id,rowId:component.rowId,application:outcome.application,code:outcome.code});}
    catch(error){rows.push({id:component.id,rowId:component.rowId,application:'failed',code:String((error as Error)?.message??error)});}
   }
   const changed=rows.filter(row=>row.application==='applied');
   receipt={at:new Date().toISOString(),previousPid:previous.pid,reason:'BOOT_INCOMPLETE',rows,action:changed.length>0?'rows-disabled':'none'};
   if(changed.length>0){
    // The official row toggle reloads immediately, so the recovered state needs no restart; the
    // receipt stays durable because the page may be opened long after this boot.
    this.notify('SUITE_BOOT_RECOVERY: the previous process did not reach readiness; disabled the declared component rows it had enabled',{previousPid:previous.pid,disabled:changed.map(row=>row.rowId)});
   }
   await this.write(directory,this.receiptPath,receipt);
  }
  await this.write(directory,this.sentinelPath,{pid:process.pid,startedAt:new Date().toISOString(),phase:'loading',components:components.map(component=>component.id)} satisfies BootSentinel);
  this.timer=setTimeout(()=>{void this.markReady();},this.graceMs);
  this.timer.unref?.();
  return {recovered:receipt!==null,receipt,diagnostic:null};
 }
 /** The readiness checkpoint: the process survived its own boot and this Suite kept serving. */
 async markReady():Promise<void>{
  if(this.timer){clearTimeout(this.timer);this.timer=null;}
  if(this.disposed||this.ready)return;
  try{
   const directory=await this.directory(),sentinel=await this.readState<BootSentinel>(directory,this.sentinelPath);
   if(sentinel!==null&&sentinel.pid!==process.pid)return;
   await this.write(directory,this.sentinelPath,{pid:process.pid,startedAt:sentinel?.startedAt??new Date().toISOString(),phase:'ready',components:sentinel?.components??[]} satisfies BootSentinel);
   this.ready=true;
  }catch{}
 }
 /** The latest durable recovery receipt, so a page opened long after the recovery still sees it. */
 async latestReceipt():Promise<RecoveryReceipt|null>{
  try{return await this.readState<RecoveryReceipt>(await this.directory(),this.receiptPath);}
  catch{return null;}
 }
 /** Unload: stop the readiness timer, record that this generation unloaded cleanly, then refuse
  * every later write and join the writes already started. A process that dies never runs this, so a
  * missing checkpoint still means death; but a clean unload is not a failed boot, and treating it as
  * one made every restart shortly after a reload disable the rows the user had enabled. */
 async dispose():Promise<void>{
  if(!this.disposed&&!this.ready){
   try{
    const directory=await this.directory(),sentinel=await this.readState<BootSentinel>(directory,this.sentinelPath);
    if(sentinel!==null&&sentinel.pid===process.pid)await this.write(directory,this.sentinelPath,{pid:process.pid,startedAt:sentinel.startedAt,phase:'closed',components:sentinel.components} satisfies BootSentinel);
   }catch{}
  }
  this.disposed=true;
  if(this.timer){clearTimeout(this.timer);this.timer=null;}
  await Promise.allSettled([...this.writes]);
 }
}
