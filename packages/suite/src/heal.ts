import {join} from 'node:path';
import {readFile} from 'node:fs/promises';
import type {HealRecord} from './types.js';
import {profileStateDirectory,writeProfileState} from './recovery.js';

/** The fields this module reads off the official inventory. They are the contract, not a copy of it. */
export interface InventoryEntry {
 entryId:string;
 moduleName:string;
 enabled:boolean;
 fiberPhase:'pending'|'loading'|'active'|'failed'|'unloading'|null;
 patchId?:string;
 readOnlyReason?:'management-required'|'unaddressable';
}
export interface ToggleOutcome {
 application:string;
 code:string|null;
 enabled?:boolean;
 /** The official operation diagnostic. It is the only public place that carries the failure text:
  *  the inventory reports enablement and fiber phase, never the error itself. */
 diagnostic?:string|null;
}
export interface HealPorts {
 /** The active profile directory; the Suite's own state directory is resolved from it, exactly as
  * `BootGuard` does, so both write through one resolver and one writer. */
 stateDirectory:()=>Promise<string>;
 /** The official inventory. Called again after a toggle: the official fact decides, not our intent. */
 /** The official inventory. Called again after a toggle: the official fact decides, not our intent. */
 inventory:()=>Promise<InventoryEntry[]>;
 /** Toggle exactly this target. The port re-resolves the branded entry id from the official
  * inventory, so this module never reconstructs an identity it did not read. */
 toggle:(entry:InventoryEntry,enabled:boolean)=>Promise<ToggleOutcome>;
 notify:(message:string,detail:Record<string,unknown>)=>void;
 /** Module specifiers this Suite ships; a failure in one of our own rows is still ours to contain.
  * Read lazily: this constructor is not async and the answer must be current. */
 ownModules:()=>Promise<string[]>;
}
export interface HealOptions {
 /** Official packages: never disabled automatically, whatever they do. Detection still reports them. */
 protectedPrefixes?:string[];
 /** How long to let the official loader settle before reading the inventory for the first time. */
 settleMs?:number;
}

const DEFAULT_PROTECTED=['@deepseek-ai/','cordis','@cordisjs/'];
const RECORD_FILE='heal.json';
/** How many judgements a target gets in total: the containment, then one re-open on a later boot.
 *  One constant, because "how many times may we touch the user's row" is one budget — the loop bound and
 *  the re-open bound were two numbers for the same counter and drifted (0.2.2-3 review P2). */
export const ATTEMPT_LIMIT=2;
/** A wedged module must not hold the pass (and the page that reads it) open forever. */
export const RETRY_TIMEOUT_MS=15000;

/** One bounded official call; null means the bound was hit, which is a diagnosis, not a success. */
async function bounded<T>(work:Promise<T>,ms:number):Promise<T|null>{
 let timer:ReturnType<typeof setTimeout>|undefined;
 const timeout=new Promise<null>(resolve=>{timer=setTimeout(()=>resolve(null),ms);(timer as {unref?:()=>void}).unref?.();});
 try{return await Promise.race([work,timeout]);}
 finally{if(timer!==undefined)clearTimeout(timer);}
}

/**
 * The failure reason, from the official operation diagnostic rather than from a stack trace.
 * Its shape is "dsh: warning: N entries did not activate" followed by one line per entry,
 * "<row-id> (<module>): <error>". The last line is the module and its error; the preamble is noise here.
 */
/**
 * Strip the shapes a credential can take inside an error string. The reason is written to heal.json and
 * crosses the Remote boundary to the page, so it is outside where secrets may live (AGENTS §1.1): the
 * diagnostic is not ours to trust. Conservative on purpose — over-redacting a message is cheaper than
 * shipping a token to a log and a browser.
 */
export function redactDiagnostic(text:string):string{
 return text
  .replace(/([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)[^/@\s]+@/gu,'$1***@')
  .replace(/\b(Bearer)\s+[A-Za-z0-9._~+/=-]{8,}/giu,'$1 ***')
  .replace(/\b(api[-_]?key|token|secret|password|passwd|authorization|credential[s]?)\b\s*[:=]\s*[^\s,;&]+/giu,'$1=***');
}

export function summarizeDiagnostic(diagnostic:string|null|undefined,code:string|null):{code:string;text:string}|undefined{
 if(typeof diagnostic!=='string')return undefined;
 const lines=diagnostic.split(/\r?\n/gu).map(line=>line.trim()).filter(line=>line.length>0);
 if(lines.length===0)return undefined;
 return {code:code??'OPERATION_ERROR',text:redactDiagnostic(lines[lines.length-1]).slice(0,400)};
}

/**
 * Whether a module belongs to the official installation. It is a policy list, not a guess about the
 * failure: the official kernel and its packages are reported to the user and never written to.
 */
export function isProtectedModule(moduleName:string,protectedPrefixes:string[]=DEFAULT_PROTECTED):boolean{
 return protectedPrefixes.some(prefix=>moduleName===prefix||moduleName.startsWith(prefix.endsWith('/')?prefix:prefix+'/')||moduleName.startsWith(prefix+'@'));
}

/**
 * The entries worth acting on: the official inventory says the entry is enabled and its fiber failed.
 * `pending`/`loading` are not failures -- an entry waiting for its services is a legitimate state, and
 * turning that into a disable would punish a slow boot. `active` is never touched.
 */
export function failedEntries(inventory:InventoryEntry[]):InventoryEntry[]{
 return inventory.filter(entry=>entry.fiberPhase==='failed'&&entry.enabled===true);
}

function sameTarget(record:HealRecord,entry:InventoryEntry):boolean{
 return record.entryId===entry.entryId&&record.moduleName===entry.moduleName;
}

/**
 * Start-up containment. One fact is owned here: what this Suite did about entries the *official*
 * inventory reported as failed, and whether the user has been told. The inventory remains the only
 * authority on enablement and failure; this class never caches a copy of it as "current state", and it
 * writes only through the official toggle for the exact entry id it was given.
 *
 * Two things it must never do: disable an official package (policy), and report a disable that the
 * official answer did not apply (honesty). Both are enforced below and have reversal tests.
 */
export class StartupHealer {
 private readonly protectedPrefixes:string[];
 private readonly settleMs:number;
 private records:HealRecord[]|null=null;
 private scanning:Promise<HealRecord[]>|null=null;
 private disposed=false;
 /** Identity of this process' boot. A re-open is allowed once per boot, not once per pass: the page
  *  polls componentsStatus every ~750 ms, and "each pass may re-open" made that a 750 ms loop of
  *  official writes to the user's profile (0.2.2-3 review P0-3). */
 private readonly bootId=`${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;
 constructor(private readonly ports:HealPorts,options:HealOptions={}){
  this.protectedPrefixes=options.protectedPrefixes??DEFAULT_PROTECTED;
  this.settleMs=options.settleMs??1200;
 }
 private async directory():Promise<string>{
  return profileStateDirectory(await this.ports.stateDirectory());
 }
 /** Durable act log. A missing or unreadable file is an empty log, never a crash of the Suite. */
 async load():Promise<HealRecord[]>{
  if(this.records!==null)return this.records;
  try{
   const parsed=JSON.parse(await readFile(join(await this.directory(),RECORD_FILE),'utf8')) as unknown;
   this.records=Array.isArray(parsed)?(parsed as HealRecord[]):[];
  }catch{this.records=[];}
  return this.records;
 }
 private async persist():Promise<void>{
  if(this.records===null||this.disposed)return;
  await writeProfileState(await this.directory(),RECORD_FILE,this.records);
 }
 /** Wait out the loader's own settling, then scan once. Never throws into the caller's boot path. */
 async begin():Promise<HealRecord[]>{
  await new Promise(resolve=>{const timer=setTimeout(resolve,this.settleMs);timer.unref?.();});
  return this.scan();
 }
 /**
  * One pass. Every action is derived from a fresh inventory read, and a toggle is only recorded as
  * `disabled` after the official inventory stops reporting the entry as enabled.
  */
 async scan():Promise<HealRecord[]>{
  if(this.disposed)return this.load();
  if(this.scanning!==null)return this.scanning;
  const run=(async()=>{
   const records=await this.load();
   let inventory:InventoryEntry[];
   try{inventory=await this.ports.inventory();}
   catch(error){this.ports.notify('SUITE_HEAL_INVENTORY_FAILED',{message:String((error as Error)?.message??error)});return records;}
   const added:HealRecord[]=[];
   // Re-open pass (0.2.2-3): an entry this Suite contained is not condemned forever. It gets one more
   // try on a later boot, bounded by RETRY_LIMIT, and the outcome is recorded either way. Without this
   // a transient first-boot failure (an install racing the loader) disabled a user row permanently.
   let reopened=false;
   let dirty=false;
   const retriedThisPass=new Set<string>();
   for(const record of records){
    if(record.outcome!=='disabled'||record.attempts>=ATTEMPT_LIMIT||record.bootId===this.bootId)continue;
    const row=inventory.find(item=>item.entryId===record.entryId&&item.moduleName===record.moduleName);
    if(row===undefined||row.enabled!==false)continue;
    // The budget moves here and only here for a re-open: this pass spent one judgement on this row,
    // whatever the answer was. Not counting it let a failing enable be retried on every pass forever.
    record.attempts+=1;
    record.bootId=this.bootId;
    record.at=new Date().toISOString();
    dirty=true;
    try{
     const answer=await bounded(this.ports.toggle(row,true),RETRY_TIMEOUT_MS);
     if(answer===null)record.code='HEAL_RETRY_TIMEOUT';
     else if(answer.application!=='applied'){
      record.code=answer.code??answer.application;
      const reason=summarizeDiagnostic(answer.diagnostic,record.code);
      if(reason)record.reason=reason;
     }
    }catch{record.code='HEAL_RETRY_THREW';}
    retriedThisPass.add(record.entryId);
    reopened=true;
   }
   if(reopened){
    try{inventory=await this.ports.inventory();}
    catch(error){this.ports.notify('SUITE_HEAL_INVENTORY_FAILED',{message:String((error as Error)?.message??error)});return records;}
    // A re-open that actually brought the entry back is a recovery, and the receipt must say so:
    // the entry is running while the log still claims this Suite disabled it would be a lie.
    for(const record of records){
     if(record.outcome!=='disabled'||!retriedThisPass.has(record.entryId))continue;
     const row=inventory.find(item=>item.entryId===record.entryId&&item.moduleName===record.moduleName);
     if(row!==undefined&&row.enabled===true&&row.fiberPhase==='active'){
      record.outcome='recovered';
      record.code=null;
      record.reason=undefined;
      record.at=new Date().toISOString();
     }
    }
   }
   // Resolved only when a record is actually created: a healthy boot must not read the component
   // manifest on every status poll just to know who owns a failure that does not exist.
   let ownModules:string[]|null=null;
   const ownerOf=async(moduleName:string):Promise<'suite'|'third-party'>=>{
    if(ownModules===null)ownModules=await this.ports.ownModules().catch(()=>[]);
    return ownModules.includes(moduleName)?'suite':'third-party';
   };

   for(const entry of failedEntries(inventory)){
    const previous=records.find(record=>sameTarget(record,entry));
    if(previous){
     // An entry the user has since re-enabled, or one whose package changed, gets a fresh
     // judgement: "an upgrade is another try" is why a containment must not be permanent.
     if(previous.outcome==='disabled'){
      if(inventory.some(item=>item.entryId===entry.entryId&&item.enabled===false))continue;
      // Our containment was undone (the user re-enabled it, or an upgrade re-declared the row): that is a
      // new failure episode, so the automatic-retry budget starts over. Keeping the spent budget would
      // mean a row that fails a month later is never contained again.
      if(!retriedThisPass.has(entry.entryId))previous.attempts=0;
     }else if(previous.outcome==='protected'||previous.outcome==='refused-readonly'||previous.outcome==='absent'){
      continue;
     }else if(previous.attempts>=ATTEMPT_LIMIT){
      continue;
     }
     // A row this very pass already re-opened has spent its judgement there; counting it again here
     // would burn the whole budget in one pass and make "one more try next boot" false.
     if(!retriedThisPass.has(entry.entryId))previous.attempts+=1;
     // Judging a row stamps THIS boot: the budget we just spent belongs to this start, so the poll
     // this page runs a second later must not spend it again.
     previous.bootId=this.bootId;
     previous.at=new Date().toISOString();
     previous.code=null;
     previous.outcome='not-disabled';
     // The user dismissed the old notice; a fresh failure after a re-enable is new information.
     previous.acknowledged=false;
    }

    const record:HealRecord=previous??{entryId:entry.entryId,moduleName:entry.moduleName,owner:await ownerOf(entry.moduleName),outcome:'not-disabled',code:null,at:new Date().toISOString(),acknowledged:false,attempts:1,bootId:this.bootId};
    if(isProtectedModule(entry.moduleName,this.protectedPrefixes)){
     // Reported, never touched: an official package that fails to load is a kernel/version problem, and
     // disabling it would hide it.
     record.outcome='protected';
    }else if(entry.readOnlyReason!==undefined){
     record.outcome='refused-readonly';
     record.code=entry.readOnlyReason;
    }else if(entry.patchId===undefined){
     record.outcome='absent';
     record.code='HEAL_PATCH_ID_ABSENT';
    }else{
     // One re-apply through the official API before containing anything. It is two things at once:
     // the retry a transient failure deserves, and the only public source of *why* it failed —
     // setPluginEnabled answers with {application:'failed', error:{diagnostic}} and the inventory
     // never carries the error. A retry that applies and comes up active is a recovery, not a disable.
     try{
      // The re-open pass already paid for this attempt on this very entry; asking twice in one pass
      // would double the boot cost and produce the same answer. The sentinel keeps the branches below
      // identical: it simply is neither a timeout nor an applied answer.
      const retry=retriedThisPass.has(entry.entryId)?{application:'reopened',code:null,diagnostic:null}:await bounded(this.ports.toggle(entry,true),RETRY_TIMEOUT_MS);
      if(retry===null){
       record.code='HEAL_RETRY_TIMEOUT';
      }else if(retry.application==='applied'){
       // The retry's answer is not the fact: re-read and judge the row by what the inventory says now.
       // Only "still failed" earns a containment. A row that is merely slow (loading) or already gone is
       // not a failure, and switching it off would repeat exactly the harm this batch exists to fix.
       let phase='unknown';
       try{
        const after=await this.ports.inventory();
        const now=after.find(item=>item.entryId===entry.entryId);
        inventory=after;
        phase=now===undefined?'absent':(now.fiberPhase==='failed'?'failed':(now.fiberPhase==='active'?'active':'other'));
       }catch{phase='unknown';}
       if(phase==='active'){
        record.outcome='recovered';
        record.code=null;
        record.reason=undefined;
        if(previous===undefined)records.push(record);
        added.push(record);
        continue;
       }
       if(phase!=='failed'){
        // Not a failure (loading / unknown / gone): record the fact and leave the switch alone.
        record.outcome='not-disabled';
        record.code='HEAL_NOT_FAILED';
        record.at=new Date().toISOString();
        if(previous===undefined)records.push(record);
        added.push(record);
        continue;
       }
      }else{
       const reason=summarizeDiagnostic(retry.diagnostic,retry.code??null);
       if(reason)record.reason=reason;
      }
     }catch(error){
      record.reason={code:'HEAL_RETRY_THREW',text:String((error as Error)?.message??error).slice(0,400)};
     }
     try{
      // The containment call gets the same bound as the retry: a wedged module must not hold the pass
      // (and the page that polls it) open. An unanswered attempt is recorded as such, never as done.
      const outcome=await bounded(this.ports.toggle(entry,false),RETRY_TIMEOUT_MS);
      if(outcome===null){
       record.outcome='not-disabled';
       record.code='HEAL_DISABLE_TIMEOUT';
      }else if(outcome.application!=='applied'){
       record.code=outcome.code??outcome.application;
       record.outcome='toggle-failed';
      }else{
       record.code=outcome.code??outcome.application;
       // The official answer is not the fact yet: re-read, and only then call it disabled.
       let confirmed=false;
       try{
        inventory=await this.ports.inventory();
        confirmed=inventory.some(item=>item.entryId===entry.entryId&&item.enabled===false);
       }catch{confirmed=false;}
       record.outcome=confirmed?'disabled':'not-disabled';
       if(!confirmed)record.code='HEAL_UNCONFIRMED';
      }
     }catch(error){
      record.outcome='toggle-failed';
      record.code=String((error as Error)?.message??error);
     }
    }
    if(previous===undefined)records.push(record);
    added.push(record);
   }

   // Persist when this pass changed anything. The old condition looked at `added`, which only the
   // failed-entry loop fills — so a pass whose only act was a re-open (the row came back, so it is no
   // longer a failed entry) wrote nothing, and the log kept claiming "switched off" for a running row.
   if(added.length>0||dirty){
    await this.persist();
    for(const record of added){
     this.ports.notify('SUITE_HEAL_ACTION',{entryId:record.entryId,moduleName:record.moduleName,owner:record.owner,outcome:record.outcome,code:record.code});
    }
    // One machine-readable line per pass: the page owns the wording, the Host owns only the facts.
    this.ports.notify('SUITE_HEAL_SUMMARY',{acted:added.length,disabled:added.filter(record=>record.outcome==='disabled').length});
   }
   return records;
  })();
  this.scanning=run;
  try{return await run;}finally{this.scanning=null;}
 }
 /** Unload: no further record may be written, and an in-flight pass finishes on its own. */
 async dispose():Promise<void>{
  // Order matters: the pass already running must finish and record its own outcome *before* this flag
  // refuses writes. Marking first would let an official toggle that already happened go unrecorded --
  // a silent disable. New passes are refused by scan(), so no write can arrive after unload.
  await this.scanning?.catch(()=>undefined);
  this.disposed=true;
 }
 /** The durable act log, for the page. Read-only: acknowledging is the only mutation. */
 async list():Promise<HealRecord[]>{
  return [...await this.load()];
 }
 /** The user dismissed a notice. It is never shown again; the record itself stays as evidence. */
 async acknowledge(entryId:string):Promise<boolean>{
  const records=await this.load();
  const record=records.find(item=>item.entryId===entryId&&item.acknowledged===false);
  if(!record)return false;
  record.acknowledged=true;
  await this.persist();
  return true;
 }
}
