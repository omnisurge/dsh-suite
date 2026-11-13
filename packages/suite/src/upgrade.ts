import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,readFile,readdir,realpath,rm,writeFile} from 'node:fs/promises';
import {isAbsolute,join,resolve} from 'node:path';
import {readTarGz} from './tar.js';
import type {ComponentDefinition,UpgradeCandidate,UpgradeInstallRecord,UpgradeResult,UpgradeStatus} from './types.js';
// ADR-068: the fetcher's outcome and the facts the canonical candidate check returns to it. Type-only: the
// fetcher imports this module's value exports (the version comparison and the checksum parser), so the two
// modules stay one dependency direction at runtime.
import type {ReleaseFetchOutcome,ReleaseInspection} from './github-release.js';

export const SUITE_PACKAGE='@omnisurge/dsh-suite';
/** Official pnpm refuses a profile whose node_modules was linked from another store major. The code is
 * stable in pnpm's output; the sentence is the fallback when the log is translated. This is a profile
 * fact, not a Suite failure: the bytes never changed, and only the official installer may repair them
 * (AGENTS 1.7), so the page names the fact and the next step instead of pretending it can rewrite them. */
const PROFILE_STORE_MISMATCH=/ERR_PNPM_UNEXPECTED_STORE|Unexpected store location/;
const installFailureCode=(installed:{code:string|null;diagnostic:string|null}):string=>PROFILE_STORE_MISMATCH.test([installed.code,installed.diagnostic].filter(Boolean).join('\n'))?'UPGRADE_PROFILE_STORE_MISMATCH':'UPGRADE_SUITE_INCOMPLETE';
export interface UpgradeDeps {
 /** Configured release directory, or an empty string when the profile must not self-upgrade. */
 releaseDirectory:()=>string;
 /** The running Suite's own manifest, for its version and its pinned official peers. */
 currentManifest:()=>Promise<{version:string;peers:Record<string,string>}>;
 /** Official package transaction for the Suite itself; this module never writes a profile manifest. */
 installSuite:(archivePath:string,signal:AbortSignal)=>Promise<{application:string;changed:boolean;code:string|null;diagnostic:string|null}>;
 /** Owned scratch area for extracting the candidate's component archives before preparation. */
 scratch:()=>Promise<string>;
 /** The running DSH release, as the page observed it in its boot manifest (ADR-040). Empty when no page has
  * asserted it yet in this process: an unknown runtime is refused rather than assumed compatible. */
 runtimeVersion?:()=>string;
 /** Version the profile actually holds right now, read from disk (ADR-047 D3). The install call's own
  * outcome is never the authority for whether the bytes landed; a fixture without a profile omits this. */
 installedVersion?:()=>Promise<string|null>;
 /** ADR-068 D1: the second, append-only candidate root the release fetcher writes. Absent when this Host
  * has no fetched root (a local-only source), so discovery reads exactly one root as it always did. */
 fetchedDirectory?:()=>string|null;
 /** ADR-080 D2: which source the profile is configured to use. With the public GitHub source the fetched
  * root is the actual update channel, so a local release directory that was never created is normal rather
  * than a closed channel; the local source keeps today's unreadable-directory answer. */
 sourceKind?:()=>'local'|'github';
 /** ADR-068: check the configured external source once and land a verified `<version>/` directory. It is a
  * check, never an install, and it must answer instead of throwing: a failed check is "no update" plus a
  * machine code that the status read reports beside the directory refusals. */
 fetchRelease?:(request:{currentVersion:string})=>Promise<ReleaseFetchOutcome>;
 /** ADR-079: where the durable install record lives, implemented by the Host with the profile's own atomic
  * writer. Absent in fixtures without a profile: the record then does not exist and the reply stays the only
  * witness — which is exactly the limitation this dependency removes in production. */
 installRecord?:{read:()=>Promise<UpgradeInstallRecord|null>;write:(record:UpgradeInstallRecord)=>Promise<void>};
}
interface VerifiedComponent {definition:ComponentDefinition;}
interface VerifiedCandidate {
 version:string;filename:string;directory:string;suitePath:string;suiteSha256:string;suiteBytes:number;components:VerifiedComponent[];
}
const sha256=(bytes:Uint8Array):string=>createHash('sha256').update(bytes).digest('hex');

/** Compare two x.y.z[-pre] versions. Numeric identifiers compare numerically, a release outranks its
 * own prereleases, and anything unparsable is refused instead of guessed. */
export function compareVersions(left:string,right:string):number{
 const parse=(value:string)=>{
  const match=/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(value);
  if(!match)throw Error('VERSION_INVALID: '+value);
  return {core:[Number(match[1]),Number(match[2]),Number(match[3])],pre:match[4]?match[4].split('.'):null};
 };
 const a=parse(left),b=parse(right);
 for(let index=0;index<3;index+=1)if(a.core[index]!==b.core[index])return a.core[index]<b.core[index]?-1:1;
 if(a.pre===null&&b.pre===null)return 0;
 if(a.pre===null)return 1;
 if(b.pre===null)return -1;
 for(let index=0;index<Math.max(a.pre.length,b.pre.length);index+=1){
  const left=a.pre[index],right=b.pre[index];
  if(left===undefined)return -1;
  if(right===undefined)return 1;
  if(left===right)continue;
  const numeric=/^\d+$/.test(left)&&/^\d+$/.test(right);
  if(numeric)return Number(left)<Number(right)?-1:1;
  if(/^\d+$/.test(left))return -1;
  if(/^\d+$/.test(right))return 1;
  return left<right?-1:1;
 }
 return 0;
}
/** Parse a SHA256SUMS file: one `<64hex>  <filename>` line per artifact, binary-mode markers allowed. */
export function parseSums(text:string):Map<string,string>{
 const sums=new Map<string,string>();
 for(const raw of text.split('\n')){
  const line=raw.trim();if(!line)continue;
  const match=/^([a-f0-9]{64})\s+\*?(.+)$/.exec(line);
  if(!match)throw Error('SUM_LINE_INVALID: '+line.slice(0,80));
  sums.set(match[2].trim(),match[1]);
 }
 return sums;
}

/** Discovery and the one authorized batch that replaces the Suite and every declared component.
 * Candidates are read-only verified against their own SHA256SUMS plus the fixed manifest they carry;
 * a downgrade, an unlisted archive, a foreign package or a differently pinned runtime is refused. */
export class SuiteUpgrade {
 constructor(private readonly deps:UpgradeDeps,private readonly mode:()=>Promise<'release'|'source'>,private readonly logger:(message:string,detail:Record<string,unknown>)=>void){}
 async status():Promise<UpgradeStatus>{return this.statusCore(null);}
 /** ADR-068 D5: checking the external source is a caller's explicit act. A status read — page render, agent
  * tool, install receipt — never starts network work; it reports the directories that are on disk. The
  * check's own answer is a status with the fetch's refusal appended, so a caller that asked gets the code
  * in the same shape it already renders, and a later read does not keep repeating a stale network result. */
 async check():Promise<UpgradeStatus>{
  // A source-linked Host installs nothing from a release, so there is nothing to check for: spending network
  // on bytes that cannot be installed would be a second answer about the same fact.
  if((await this.mode())!=='release')return this.statusCore(null);
  const fetched=this.deps.fetchedDirectory?.()??null;
  let fetchRefusal:UpgradeStatus['refusals'][number]|null=null;
  if(fetched!==null&&this.deps.fetchRelease!==undefined){
   const currentVersion=(await this.deps.currentManifest()).version;
   // The fetcher promises an outcome instead of throwing; the catch is the belt for an injected
   // implementation that breaks that promise. Either way a failed check is "no update" plus a code.
   const outcome=await this.deps.fetchRelease({currentVersion}).catch((error:unknown):ReleaseFetchOutcome=>({version:null,code:'FETCH_NETWORK_UNREACHABLE',diagnostic:String((error as Error)?.message??error),directory:fetched}));
   if(outcome.code!==null)fetchRefusal={directory:outcome.directory??fetched,code:outcome.code,diagnostic:outcome.diagnostic};
  }
  return this.statusCore(fetchRefusal);
 }
 private async readOnDisk():Promise<string|null>{
  try{return this.deps.installedVersion===undefined?null:await this.deps.installedVersion();}
  catch{return null;}
 }
 private async readRecord():Promise<UpgradeInstallRecord|null>{
  try{return this.deps.installRecord===undefined?null:await this.deps.installRecord.read();}
  catch{return null;}
 }
 /** A record that cannot be written must never change the install's own outcome: it is a witness, not a step. */
 private async writeRecord(record:UpgradeInstallRecord):Promise<void>{
  try{await this.deps.installRecord?.write(record);}
  catch(error){this.logger('SUITE_UPGRADE_RECORD_UNWRITTEN',{message:String((error as Error)?.message??error),phase:record.phase,target:record.target});}
 }
 /** ADR-079: settle a record the previous process could not close. `installing` means the process was gone
  * before it could say what happened; the disk answers instead. A written/failed record is left alone. */
 private async reconcileRecord(onDisk:string|null):Promise<UpgradeInstallRecord|null>{
  const record=await this.readRecord();
  if(record===null||record.phase!=='installing')return record;
  // ADR-079 D6 (review R4): a record stamped with this process's pid belongs to an attempt that is still
  // running here. Settling it would replace a live `installing` with `interrupted` — telling every reader a
  // still-open attempt is dead, and leaving the record permanently wrong if this process then exits.
  if(typeof record.pid==='number'&&record.pid===process.pid)return record;
  const landed=onDisk!==null&&onDisk===record.target;
  const settled:UpgradeInstallRecord={...record,phase:landed?'written':'interrupted',code:landed?'SUITE_UPGRADE_RESTART_REQUIRED':'UPGRADE_RECORD_INTERRUPTED',onDisk,finishedAt:new Date().toISOString()};
  // Two readers may reconcile at once; both write the same bytes, and re-reading keeps a real transition from
  // being overwritten by a decision taken on a stale snapshot.
  const again=await this.readRecord();
  if(again!==null&&again.phase!=='installing')return again;
  await this.writeRecord(settled);
  this.logger('SUITE_UPGRADE_RECORD_RECONCILED',{target:record.target,phase:settled.phase,onDisk});
  return settled;
 }
 private async statusCore(fetchRefusal:UpgradeStatus['refusals'][number]|null):Promise<UpgradeStatus>{
  // The mode is derived from a filesystem fact, so it can only be answered asynchronously; reading it
  // without awaiting a promise is how a release install was misreported as a source checkout.
  let mode:'release'|'source'='release';
  try{mode=await this.mode();}catch{}
  const directory=this.deps.releaseDirectory();
  // The loaded package may have been replaced on disk while this Host is still the old generation. Its
  // packageRoot can briefly point at bytes the installer has already moved; that must not hide the durable
  // install record. Fall back to the profile's installed version, which is exactly the fact the record
  // reconciles against.
  let currentVersion:string|null=null;
  try{currentVersion=(await this.deps.currentManifest()).version;}catch{}
  const onDisk=await this.readOnDisk();
  // ADR-079: reading status is also the reconciliation point. An `installing` record left behind by a
  // process that died mid-transaction is settled against the disk here, so no reader ever sees a forever-
  // pending attempt. The write only happens on a phase transition, so polling status is not a write path.
  const lastInstall=await this.reconcileRecord(onDisk);
  // currentVersion stays the *running* version. An unreadable old package means "running version unknown",
  // not "runs the bytes now on disk": the Client decides "installed, restart required" from lastInstall,
  // and conflating the two would make the restart banner disappear before the app actually restarts.
  const base={mode,currentVersion:currentVersion??'',releaseDirectory:directory,lastInstall};
  if(currentVersion===null&&onDisk===null)return {...base,latest:null,refusals:[{directory,code:'UPGRADE_CURRENT_UNREADABLE',diagnostic:'the current Suite manifest and the profile-installed version are both unreadable'}],canUpgrade:false};
  // Candidate discovery compares against what the profile will load, so the disk is the right proxy here.
  const effectiveVersion=currentVersion??onDisk!;
  // A source-linked Host installs nothing from the release directory, but an empty answer hides the reason:
  // the page must be able to say why no candidate is in play, including when the Host and the page disagree
  // about whether a source is linked at all.
  if(mode!=='release')return {...base,latest:null,refusals:[{directory,code:'UPGRADE_SOURCE_MODE',diagnostic:'this Host reports a linked source tree, so release candidates are not installable from here'}],canUpgrade:false};
  if(!directory||!isAbsolute(directory))return {...base,latest:null,refusals:[{directory,code:'UPGRADE_DIRECTORY_INVALID',diagnostic:'the release directory must be an absolute path'}],canUpgrade:false};
  const {candidates,refusals,unreadable}=await this.discover(directory,effectiveVersion,this.deps.sourceKind?.()??'local');
  const listed=fetchRefusal===null?refusals:[...refusals,fetchRefusal];
  if(unreadable!==null)return {...base,latest:null,refusals:fetchRefusal===null?[unreadable]:[unreadable,fetchRefusal],canUpgrade:false};
  const latest=candidates[0]??null;
  return {...base,latest:latest===null?null:this.wire(latest),refusals:listed,canUpgrade:latest!==null};
 }
 private wire(candidate:VerifiedCandidate):UpgradeCandidate{
  return {version:candidate.version,filename:candidate.filename,directory:candidate.directory,suiteSha256:candidate.suiteSha256,suiteBytes:candidate.suiteBytes,components:candidate.components.map(component=>({id:component.definition.id,module:component.definition.module,rowId:component.definition.rowId}))};
 }
 /** The one discovery core both status and the authorized batch use: every candidate directory is
  * verified, every refusal keeps its own diagnostic code, and an unreadable directory is reported
  * rather than collapsed into a generic failure. */
 private async discover(directory:string,currentVersion:string,sourceKind:'local'|'github'='local'):Promise<{candidates:VerifiedCandidate[];refusals:UpgradeStatus['refusals'];unreadable:UpgradeStatus['refusals'][number]|null}>{
  // ADR-068 D1: the fetched root is one more candidate root, read exactly like the release directory. It
  // is created on first download, so not existing yet is normal; the configured release directory is the
  // user's own and an unreadable one is still the answer they get. ADR-080 D2: with the public GitHub
  // source, the local shelf is optional too -- the fetched root is the channel, so a missing shelf is not
  // a closed channel (a present-but-unreadable one is still reported as a refusal beside the candidates).
  const fetched=this.deps.fetchedDirectory?.()??null;
  const roots=fetched===null||fetched===directory?[directory]:[directory,fetched];
  let unreadable:UpgradeStatus['refusals'][number]|null=null;
  const candidates:VerifiedCandidate[]=[],refusals:UpgradeStatus['refusals']=[];
  // Reading the roots and judging their entries are two phases on purpose: the roots differ only in what a
  // missing one means, while the verdict is the same code for every directory whichever root holds it.
  const pending:string[]=[];
  for(const [index,root] of roots.entries()){
   let entries;
   try{entries=await readdir(root,{withFileTypes:true});}
   catch(error){
    const diagnostic=String((error as Error)?.message??error);
    const notCreated=(error as NodeJS.ErrnoException).code==='ENOENT';
    // Only "not created yet" is normal for the fetched root. Under the GitHub source the local shelf is
    // optional too; under the local source its absence/inaccessibility remains the channel answer. A path
    // that exists but is not a directory is a misconfiguration the page must be able to see, not silence.
    if(index>0&&notCreated)continue;
    if(index===0&&sourceKind==='github'){
     if(notCreated)continue;
     refusals.push({directory:root,code:'UPGRADE_DIRECTORY_UNREADABLE',diagnostic});
     continue;
    }
    if(index===0){unreadable={directory:root,code:'UPGRADE_DIRECTORY_UNREADABLE',diagnostic};continue;}
    refusals.push({directory:root,code:'UPGRADE_DIRECTORY_UNREADABLE',diagnostic});
    continue;
   }
   for(const entry of entries){
    if(!entry.isDirectory()||entry.name.startsWith('.'))continue;
    pending.push(join(root,entry.name));
   }
  }
  for(const path of pending){
   try{candidates.push(await this.verify(path,currentVersion));}
   catch(error){
    const failure=error as {code?:string;message?:string};
    // Only the Suite's own codes are control-plane facts a page may render. A filesystem errno is evidence
    // for the technical view, never the reason a user is shown: `ENOENT` says nothing about their Suite.
    const declaredCode=/^UPGRADE_[A-Z0-9_]+$/.test(String(failure.code??''))?String(failure.code):undefined;
    const code=declaredCode??/^UPGRADE_[A-Z0-9_]+/.exec(String(failure.message??''))?.[0]??'UPGRADE_CANDIDATE_INVALID';
    refusals.push({directory:path,code,diagnostic:String(failure.message??error)});
   }
  }
  // One version is one candidate however many roots hold it: the release directory is asked first, so a
  // copy on the shelf outranks an identical download, and the fetched root only fills versions it lacks.
  const versions=new Set<string>(),unique:VerifiedCandidate[]=[];
  for(const candidate of candidates){
   if(versions.has(candidate.version))continue;
   versions.add(candidate.version);
   unique.push(candidate);
  }
  unique.sort((left,right)=>compareVersions(right.version,left.version));
  return {candidates:unique,refusals,unreadable};
 }
 /** Verify one candidate directory against its own records and the fixed manifest it carries. */
 private async verify(directory:string,currentVersion:string):Promise<VerifiedCandidate>{
  const root=await realpath(directory);
  if(await realpath(directory)!==root)throw Error('UPGRADE_CANDIDATE_ALIAS');
  // The release directory is shared with whatever else the user keeps there, so "this is not a candidate"
  // is decided before any record is read. Otherwise an unrelated directory (a legacy layout, a foreign
  // folder) surfaces a raw filesystem errno as the control-plane code the page has to explain.
  const names=await readdir(root);
  const archiveName=names.find(name=>/^omnisurge-dsh-suite-.+\.tgz$/.test(name));
  if(!names.includes('manifest.json')&&archiveName===undefined)throw Error('UPGRADE_NOT_A_CANDIDATE');
  const sumsBytes=await readFile(join(root,'SHA256SUMS'),'utf8').catch((error:NodeJS.ErrnoException)=>{if(error.code==='ENOENT'||error.code==='EISDIR')return null;throw error;});
  if(sumsBytes===null)throw Error('UPGRADE_SUMS_MISSING');
  const sums=parseSums(sumsBytes);
  const record=await readFile(join(root,'manifest.json'),'utf8').then(JSON.parse).catch((error:NodeJS.ErrnoException)=>{if(error.code==='ENOENT')return null;throw error;}) as {packages?:Array<{name?:string;filename?:string;sha256?:string;bytes?:number}>}|null;
  const declared=record?.packages?.find((item:{name?:string})=>item?.name===SUITE_PACKAGE)??null;
  const filename=typeof declared?.filename==='string'?declared.filename:archiveName;
  if(typeof filename!=='string'||filename.includes('/'))throw Error('UPGRADE_SUITE_ARCHIVE_MISSING');
  const expected=sums.get(filename);
  if(!expected)throw Error('UPGRADE_SUITE_NOT_IN_SUMS');
  const bytes=await readFile(join(root,filename));
  const digest=sha256(bytes);
  if(digest!==expected)throw Error('UPGRADE_SUITE_BYTE_DRIFT');
  if(declared!==null&&(declared.sha256!==digest||declared.bytes!==bytes.length))throw Error('UPGRADE_SUITE_RECORD_DRIFT');
  const files=new Map(readTarGz(bytes).filter(entry=>entry.type==='file').map(entry=>[entry.name,entry.bytes]));
  const manifestBytes=files.get('package/package.json');
  if(!manifestBytes)throw Error('UPGRADE_SUITE_MANIFEST_MISSING');
  const manifest=JSON.parse(Buffer.from(manifestBytes).toString('utf8'));
  if(manifest.name!==SUITE_PACKAGE)throw Error('UPGRADE_SUITE_NAME_MISMATCH');
  if(typeof manifest.version!=='string')throw Error('UPGRADE_SUITE_VERSION_MISSING');
  if(compareVersions(manifest.version,currentVersion)<=0)throw Error('UPGRADE_NOT_NEWER');
  const currentPeers=(await this.deps.currentManifest()).peers;
  for(const [name,pin] of Object.entries(manifest.peerDependencies??{}))if(name.startsWith('@deepseek-ai/dsh')&&currentPeers[name]!==pin)throw Error('UPGRADE_RUNTIME_MISMATCH: '+name+' '+String(pin)+' != '+String(currentPeers[name]));
  // ADR-040: a candidate states the runtimes it was actually exercised on, and installing it on any other
  // release is refused here, per candidate. `engines.dsh` deliberately stays the loader's wide admission:
  // narrowing it would stop the row from loading after a DSH update and take this very page's upgrade path
  // with it, which is the dead end this gate exists to avoid.
  // A candidate that carries the field but no readable entry is *not* silently downgraded to the legacy
  // `targetDsh`: "the format is not understood" must never read as "there is a declaration" (ADR-040 D3).
  const declaredField=(manifest?.omnisurge as {verifiedRuntimes?:unknown}|undefined)?.verifiedRuntimes;
  const acceptedRuntimes=declaredField===undefined
   ?typeof (record as {targetDsh?:unknown}|null)?.targetDsh==='string'?[(record as {targetDsh:string}).targetDsh.trim()].filter((value:string)=>value!==''):[]
   :Array.isArray(declaredField)?declaredField.map((entry:{version?:unknown})=>typeof entry?.version==='string'?entry.version.trim():'').filter((value:string)=>value!=='') :[];
  if(acceptedRuntimes.length===0)throw Error('UPGRADE_RUNTIME_UNDECLARED');
  const runningRuntime=String(this.deps.runtimeVersion?.()??'').trim();
  if(!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(runningRuntime))throw Error('UPGRADE_RUNTIME_UNKNOWN');
  if(!acceptedRuntimes.includes(runningRuntime))throw Error('UPGRADE_RUNTIME_UNVERIFIED: '+runningRuntime+' is not one of '+acceptedRuntimes.join(', '));
  const componentBytes=files.get('package/components/manifest.json');
  if(!componentBytes)throw Error('UPGRADE_COMPONENTS_MISSING');
  const componentManifest=JSON.parse(Buffer.from(componentBytes).toString('utf8'));
  if(componentManifest?.protocol!==2||!Array.isArray(componentManifest.components)||componentManifest.components.length===0)throw Error('UPGRADE_COMPONENTS_INVALID');
  const components:VerifiedComponent[]=[];
  for(const item of componentManifest.components){
   if(!item||typeof item.id!=='string'||typeof item.module!=='string'||typeof item.rowId!=='string')throw Error('UPGRADE_COMPONENTS_INVALID');
   if(item.module!==SUITE_PACKAGE&&!item.module.startsWith(SUITE_PACKAGE+'/'))throw Error('UPGRADE_COMPONENT_MODULE_NOT_OWNED: '+item.id);
   components.push({definition:{id:item.id,module:item.module,rowId:item.rowId,display:{en:String(item.display?.en??item.id),zh:String(item.display?.zh??item.id)},runtime:item.runtime??null}});
  }
  return {version:manifest.version,filename,directory:root,suitePath:join(root,filename),suiteSha256:digest,suiteBytes:bytes.length,components};
 }
 /** ADR-068 D2: the candidate check exposed, never copied. The release fetcher must produce directories this
  * exact code admits, so a download cannot introduce a second, weaker verdict about what is installable.
  * It returns the facts the check produced (identity, digest, size); the fetcher records those, and the
  * install path re-runs this same check on the same bytes. */
 async inspect(directory:string):Promise<ReleaseInspection>{
  const candidate=await this.verify(directory,(await this.deps.currentManifest()).version);
  return {version:candidate.version,filename:candidate.filename,suiteSha256:candidate.suiteSha256,suiteBytes:candidate.suiteBytes};
 }
 /** One authorized batch: every declared component through the canonical core, then the Suite itself.
  * Both load only in a new process, so the receipt is a restart requirement, never a success claim. */
 async upgrade(expectedVersion:string,signal:AbortSignal):Promise<UpgradeResult>{
  const operations:UpgradeResult['operations']=[];
  const readOnDisk=async():Promise<string|null>=>{
   try{return this.deps.installedVersion===undefined?null:await this.deps.installedVersion();}
   catch{return null;}
  };
  // ADR-079: the record is written BEFORE the transaction and finalized at every exit, so the fact of an
  // install survives the reply being lost with the plugin tree. `record` stays null until a candidate is
  // actually about to be installed, which keeps every refusal path free of a profile write.
  let record:UpgradeInstallRecord|null=null;
  let recordClosed=false;
  // Review R6: `interrupted` is reserved for a record the NEXT process had to close (the only case where
  // nobody knows what happened). An exit this process observed is `written` when the bytes landed and `failed`
  // otherwise — collapsing both into one word is how a failed install started reading as a dead process.
  const closeRecord=async(code:string,onDisk:string|null):Promise<UpgradeInstallRecord|null>=>{
   if(record===null||recordClosed)return record;
   recordClosed=true;
   const phase:UpgradeInstallRecord['phase']=code==='SUITE_UPGRADE_RESTART_REQUIRED'?'written':'failed';
   record={...record,phase,code,onDisk,finishedAt:new Date().toISOString()};
   await this.writeRecord(record);
   return record;
  };
  const finish=async(code:string,diagnostic:string|null=null,target:string|null=null,extra:Partial<UpgradeResult>={}):Promise<UpgradeResult>=>{
   const onDisk=await readOnDisk();
   const lastInstall=await closeRecord(code,onDisk);
   // The receipt's status read reports what is on disk; starting a network check here would make an
   // install depend on the network and spend bytes on a fact the batch already decided (ADR-068 D5).
   try{return {code,target,onDisk,operations,diagnostic,status:await this.statusCore(null),lastInstall,...extra};}
   catch(error){return {code,target,onDisk,operations,status:null,lastInstall,diagnostic:[diagnostic,'UPGRADE_STATUS_UNCONFIRMED: '+String((error as Error)?.message??error)].filter(Boolean).join('; ')};}
  };
  // ADR-047 D3 + review B2: every exit goes through one judgement. The profile's bytes are the fact, so a
  // cancellation or an exception that happens after the bytes landed at the target is a restart, never a
  // failure -- the caller must not be told the install failed when the disk says otherwise.
  const settle=async(code:string,diagnostic:string|null=null,target:string|null=null,extra:Partial<UpgradeResult>={}):Promise<UpgradeResult>=>{
   if(code!=='UPGRADE_FAILED'&&code!=='UPGRADE_CANCELLED')return finish(code,diagnostic,target,extra);
   const onDisk=await readOnDisk();
   if(target!==null&&onDisk===target){
    this.logger('SUITE_UPGRADE_RESTART_REQUIRED',{target,activationUnconfirmed:true,reported:code});
    return finish('SUITE_UPGRADE_RESTART_REQUIRED',[diagnostic,'install transaction reported '+code].filter(Boolean).join('; '),target,{activationUnconfirmed:true,...extra});
   }
   return finish(code,diagnostic,target,extra);
  };

  let scratch:string|null=null;
  try{
   signal.throwIfAborted();
   if((await this.mode())!=='release')return finish('UPGRADE_SOURCE_MODE_REFUSED');
   const directory=this.deps.releaseDirectory();
   if(!directory||!isAbsolute(directory))return finish('UPGRADE_DIRECTORY_INVALID');
   const current=(await this.deps.currentManifest()).version;
   const {candidates}=await this.discover(directory,current,this.deps.sourceKind?.()??'local');
   const candidate=candidates[0];
   if(!candidate)return finish('UPGRADE_NO_CANDIDATE');
   if(candidate.version!==expectedVersion)return finish('UPGRADE_STALE_CONFIRMATION',null,candidate.version);
   const root=await this.deps.scratch();
   scratch=join(root,'upgrade-'+candidate.version.replace(/[^0-9A-Za-z.-]/g,'_')+'-'+process.pid+'-'+Date.now());
   await mkdir(scratch,{recursive:true,mode:0o700});
   if(await realpath(scratch)!==scratch)throw Error('UPGRADE_SCRATCH_ALIAS');
   // The declared modules ship inside the Suite package: they are not profile dependencies, so the
   // batch installs the Suite once and the modules load from it in the new process.
   signal.throwIfAborted();
   // ADR-079 D1: the intent is durable BEFORE the transaction starts. From here on, a lost reply (or a
   // killed process) is answerable from this profile instead of from a channel that may not survive.
   record={schema:1,target:candidate.version,sha256:candidate.suiteSha256,phase:'installing',startedAt:new Date().toISOString(),finishedAt:null,code:null,onDisk:null,pid:process.pid};
   await this.writeRecord(record);
   const installed=await this.deps.installSuite(candidate.suitePath,signal);
   operations.push({stage:'suite-install',target:SUITE_PACKAGE+'@'+candidate.version,application:installed.application,changed:installed.changed,code:installed.code,diagnostic:installed.diagnostic});
   // ADR-047 D3: the profile's bytes decide whether the install happened. Activation normally needs a new
   // process, and the official transaction can lose its own reply while it reloads the plugin tree.
   const modules=candidate.components.map(component=>component.definition.module);
   if(installed.application!=='applied'&&installed.application!=='restart-required'){
    const onDisk=await readOnDisk();
    if(onDisk!==candidate.version)return finish(installFailureCode(installed),[installed.diagnostic??installed.code,onDisk===null?null:'on disk: '+onDisk].filter(Boolean).join('; '),candidate.version);
    this.logger('SUITE_UPGRADE_RESTART_REQUIRED',{target:candidate.version,modules,activationUnconfirmed:true,application:installed.application,code:installed.code});
    return finish('SUITE_UPGRADE_RESTART_REQUIRED',[installed.diagnostic,installed.code===null?null:'install transaction reported '+installed.code].filter(Boolean).join('; ')||null,candidate.version,{activationUnconfirmed:true});
   }
   signal.throwIfAborted();
   this.logger('SUITE_UPGRADE_RESTART_REQUIRED',{target:candidate.version,modules});
   return finish('SUITE_UPGRADE_RESTART_REQUIRED',null,candidate.version);
  }catch(error){
   return settle(signal.aborted?'UPGRADE_CANCELLED':'UPGRADE_FAILED',String((error as Error)?.message??error),expectedVersion);
  }finally{
   if(scratch!==null)await rm(scratch,{recursive:true,force:true}).catch(()=>undefined);
  }
 }
}
