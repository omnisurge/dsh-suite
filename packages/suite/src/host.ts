import type {Context} from '@deepseek-ai/cordis';
import {DEFAULT_RELEASE_DIRECTORY,normalizeOcrConfig,normalizeUpdateSource} from './config.js';
import type {Config as SuiteConfig} from './config.js';
// ADR-068: type-only, so this manager module has no load-time dependency on the network capability. The
// package entry (the module that owns the dynamic import boundary) hands the factory in; a Host built
// without it has no external update source at all, which is exactly the pre-ADR-068 behaviour.
import type {ReleaseFetcherOptions,ReleaseFetchOutcome} from './github-release.js';
import type {} from '@deepseek-ai/dsh-api-gateway';
import type {} from '@deepseek-ai/dsh-app-boot';
import type {PluginInstallRequestId} from '@deepseek-ai/dsh-plugin-manager';
import type {PeerScope} from '@deepseek-ai/dsh-typert-protocol';
import {TypertRemoteService, Remote, RemoteError} from '@deepseek-ai/dsh-typert-protocol';
import z from '@deepseek-ai/schemastery';
import {randomUUID} from 'node:crypto';
import {readFile,realpath,lstat,mkdir} from 'node:fs/promises';
import {homedir} from 'node:os';
import {dirname,resolve,join,sep,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runFixedBuildEntry,runCancellableExclusive} from './development.js';
// ADR-079: the install record shares the profile-state resolver and the atomic writer the boot guard and the
// healer already use — a second write path to profile state is exactly what that module exists to prevent.
import {profileStateDirectory,writeProfileState} from './recovery.js';
import type {UpgradeInstallRecord} from './types.js';
import {resolveDshHome} from './dsh-home.js';
import {SUITE_DEVELOPMENT_PROTOCOL,CAPABILITY_OWNERS,REQUIRED_CAPABILITIES} from './build-protocol.js';
import {ComponentInventory,readReleaseComponents,SUITE_PACKAGE} from './components.js';
import type {ComponentRuntimeProbe} from './components.js';
import {createOcrService,type OcrService} from './ocr-service.js';
import {OcrRefusal} from './ocr-contract.js';
import {createDocumentParseService} from './document-parse-service.js';
import type {DocumentParseCapabilities,DocumentParseRequest,DocumentParseResult,DocumentParseService,DocumentParseState} from './document-parse-types.js';
import {registerComponentTool,registerEnvironmentTool,registerOcrTool,registerUpgradeTool} from './tool.js';
import {registerDocumentParseTool} from './document-parse-tool.js';
import {BootGuard} from './recovery.js';
import {StartupHealer} from './heal.js';
import {SuiteUpgrade} from './upgrade.js';
import {readSkillsCatalog} from './skills-catalog.js';
import {CLIENT_ADAPTERS,addMcpServer,loopbackOrigin,mcpRowsOf,migrateLegacyClientRows,migrateStaticHttpRows,probeMcpServer,readMcpServers,removeMcpServer,updateMcpServer,withProfileLock} from './mcp-servers.js';
import {PURPOSE_SECTION_NAME,PURPOSE_SECTION_ORDER,createPurposeStore,purposeUnavailable} from './mcp-purpose.js';
import {LIMIT_MODE_ORDER,LIMIT_MODE_SECTION,firstReadableSelection,limitModeSectionText,matchesLimitModels,normalizeLimitMode,selectionOf} from './limit-mode.js';
import type {LimitModeConfig} from './limit-mode.js';
import {readTeamStatus} from './teams.js';
import {ENVIRONMENT_NOTES_ORDER,ENVIRONMENT_NOTES_SECTION,appendEnvironmentEntry,notesPathOf,notesSectionTextSync,readNotes,writeNotes} from './environment-notes.js';
import {AGENT_TEAMS_ROW_NAME,TEAM_CONFIG_MAX_MEMBERS_LIMIT,agentTeamsRowOf,planTeamConfig,teamConfigFields,teamRowsOf,writeTeamConfigs} from './team-config.js';
import type {TeamConfigRow} from './team-config.js';
import type {PurposeStore} from './mcp-purpose.js';
import type {LoaderLike,ToolsLike} from './mcp-servers.js';
import {createSkill,readSkill,removeSkill,updateSkill} from './skills-manage.js';
import type {SkillContext,SkillRegistryLike} from './skills-manage.js';
import type {SkillsCatalog,McpMigrationResult,McpProbeResult,McpPurposeServer,McpPurposeSnapshot,McpPurposeWriteResult,McpServerCatalog,McpServerDraft,McpServerMutation,SkillDocument,SkillDraft,SkillMutation,SkillScope} from './types.js';
import type {OcrCapabilities,OcrImageAttachment,OcrRecognizeResult,OcrRenderResult} from './ocr-types.js';
import type {ComponentDefinition,ComponentSetStatus,DevelopmentOperation,DevelopmentStatus,EnvironmentNotesState,HealRecord,HostRuntimeBuild,LimitModeStatus,TeamConfigPatch,TeamConfigState,TeamConfigWrite,TeamStatus,UpgradeResult,UpgradeStatus} from './types.js';
export type {ComponentDefinition,ComponentStatus,ComponentSetStatus,RecoveryReceipt,UpgradeStatus,UpgradeResult,BuildCapabilities,BuildResult,ClientRuntimeBuild,DevelopmentOperation,DevelopmentStatus,HostRuntimeBuild} from './types.js';
/**
 * Everything that touches the plugin API lives here on purpose: this module is imported dynamically by the
 * package entry, so an official export rename or removal inside these imports fails *here*, where the entry
 * can name it, instead of failing the entry module itself (a load failure there leaves the plugin row with
 * an opaque error and no explanation of what to do next).
 */
/** The optional release-fetcher capability (ADR-068). Structural on purpose: this module knows the
 * "check and land a verified directory" contract, and the capability module owns how that is done. */
export interface ReleaseFetcher {ensure(request?:{currentVersion?:string}):Promise<ReleaseFetchOutcome>;}
export type ReleaseFetcherFactory=(options:ReleaseFetcherOptions)=>ReleaseFetcher;
export function startHost(ctx:Context,config?:SuiteConfig,releaseFetcher?:ReleaseFetcherFactory):void{new SuiteDevelopment(ctx,config,releaseFetcher);}
declare module '@deepseek-ai/cordis' {interface Context {omnisurgeSuiteDev:SuiteDevelopment;}}
/** Read what the loaded business Host advertises; a missing or legacy advertisement is never treated as ready. */
function runtimeBuild(provided:unknown):HostRuntimeBuild|null{
 if(!provided||typeof provided!=='object')return null;
 const value=provided as Partial<HostRuntimeBuild>,capabilities=value.capabilities;
 if(typeof value.revision!=='string'||typeof value.protocol!=='string'||!capabilities)return null;
 return {revision:value.revision,protocol:value.protocol,capabilities:{hostStamped:capabilities.hostStamped===true,hostRemote:capabilities.hostRemote===true}};
}
export class SuiteDevelopment extends TypertRemoteService {
 private operation:DevelopmentOperation={epoch:0,phase:'idle',error:null,target:null};
 private closing=false;
 private abort=new AbortController();
 private pending:Promise<void>|undefined;
 private componentAbort=new AbortController();
 private upgradeAbort=new AbortController();
 private readonly skillsAbort=new AbortController();
 private upgradePending:Promise<UpgradeResult>|undefined;
 /** ADR-040: the running DSH release as the page last observed it in its boot manifest. The boot manifest is
  * the only public fact that names the running release (no Host service carries it), so the Host keeps the
  * value the page asserted and never re-derives a range of its own. Empty means "not observed yet". */
 private assertedRuntime='';
 /** ADR-032: the bypass-file store. The file is the write authority; this snapshot is the only read path. */
 private readonly purposes:PurposeStore;
 /** ADR-058：极限模式的配置快照读取器。volatile 配置每一步重读，不在构造时冻结。 */
 private readonly limitModeConfig:()=>LimitModeConfig;
 private readonly inventory:ComponentInventory;
 private readonly probe:ComponentRuntimeProbe;
 private readonly guard:BootGuard;
 private readonly healer:StartupHealer;
 private boot:Promise<void>|null=null;
 /** The one containment pass of this generation; every status read settles it. */
 private heal:Promise<unknown>|null=null;
 private readonly upgrade:SuiteUpgrade;
 /** ADR-068: the one release fetcher of this generation, or null when the package entry supplied no
  * capability (then the external source does not exist and the local channel is all there is). */
 private readonly fetcher:ReleaseFetcher|null;
 private readonly releaseDirectory:()=>string;
 /** ADR-036: which OCR supplier, its two credential references, and the per-call page budget. */
 private readonly ocrConfig:()=>ReturnType<typeof normalizeOcrConfig>;
 /** One service feeds both the tool and the card, so they read the same ledger and budget. */
 private readonly ocr:OcrService;
 /** ADR-086: document parsing is a separate service and tool; it only shares the Host credential store. */
 private readonly documentParseService:DocumentParseService;
 constructor(ctx:Context,config?:SuiteConfig,releaseFetcher?:ReleaseFetcherFactory){
  super(ctx,'omnisurgeSuiteDev');
  this.releaseDirectory=()=>readConfigured(config?.releaseDirectory);
   this.ocrConfig=()=>normalizeOcrConfig(config?.multimodal);
   this.ocr=createOcrService({
    config:()=>{const current=this.ocrConfig();return {provider:current.provider,secretIdRef:current.secretIdRef,secretKeyRef:current.secretKeyRef,baiduApiKeyRef:current.baiduApiKeyRef,baiduSecretKeyRef:current.baiduSecretKeyRef,maxPages:current.maxPages};},
    profileDirectory:async()=>{const profile=this.ctx.get('profileContext') as {dir?:string}|undefined;return typeof profile?.dir==='string'?profile.dir:null;},
    resolveCredential:ref=>this.resolveOcrCredential(ref),
    describeCredential:ref=>this.describeOcrCredential(ref),
    readState:()=>this.readOcrState(),
    writeState:next=>this.writeOcrState(next),
    readAttachment:async attachment=>{
     const attachments=this.ctx.get('attachments') as {readImage?:(ref:OcrImageAttachment,signal?:AbortSignal)=>Promise<{data:Uint8Array;ref:{mediaType:string;width:number;height:number}}>}|undefined;
     if(typeof attachments?.readImage!=='function')throw new OcrRefusal('OCR_IMAGE_UNSUPPORTED','this Host has no durable attachment service');
     const stored=await attachments.readImage(attachment);
     const mediaType=stored.ref.mediaType==='image/jpeg'?'image/jpeg':'image/png';
     if(stored.ref.mediaType!=='image/png'&&stored.ref.mediaType!=='image/jpeg')throw new OcrRefusal('OCR_IMAGE_UNSUPPORTED','conversation attachment media type '+stored.ref.mediaType+' is not PNG/JPEG');
     return {bytes:stored.data,mediaType,page:1,width:stored.ref.width,height:stored.ref.height};
    },
   });
   this.documentParseService=createDocumentParseService({
    config:()=>{const current=this.ocrConfig();return {mineruApiKeyRef:current.mineruApiKeyRef,paddleOcrTokenRef:current.paddleOcrTokenRef};},
    profileDirectory:async()=>{const profile=this.ctx.get('profileContext') as {dir?:string}|undefined;return typeof profile?.dir==='string'?profile.dir:null;},
    resolveCredential:ref=>this.resolveOcrCredential(ref),
    describeCredential:ref=>this.describeOcrCredential(ref),
    readState:()=>this.readDocumentParseState(),
    writeState:next=>this.writeDocumentParseState(next),
   });
   this.ocrConfig=()=>normalizeOcrConfig(config?.multimodal);
  // ADR-062：极限模式的权威事实搬到 agent-teams 行（卡片自己拥有它编辑的配置），套件行不再持有它。
  this.limitModeConfig=()=>normalizeLimitMode(this.agentTeamsRow()?.config.limitMode);
  this.probe={
   loadedVersion:definition=>{
    const runtime=definition.runtime;
    if(runtime===null)return null;
    const advertised=ctx.get(runtime.service) as Record<string,unknown>|undefined,value=advertised?.[runtime.versionField];
    return typeof value==='string'&&value.length>0&&!value.startsWith('__')?value:null;
   },
   dispatchConfirmed:async definition=>{
    const dispatch=definition.runtime?.dispatch;
    if(!dispatch)return true;
    const key=dispatch.namespace+'/'+dispatch.method;
    if(!ctx.get(dispatch.namespace)||!ctx.typert.local.get(key)||!ctx.typert.local.hasSeen(key))return false;
    // A gateway invocation must name the Peer it speaks for: the Gateway never supplies a default. An
    // in-process owner Peer is the official statement of what the old absent-Peer default meant, and the
    // Context that creates it disposes it with this plugin, so one Peer covers every probe of this load.
    const connection=ctx.get('connection') as {createPeer?:(options:{principal:{kind:'owner'}})=>PeerScope}|undefined;
    const peer=connection?.createPeer?.({principal:{kind:'owner'}});
    // Without a Connection a Host-only composition cannot carry this dispatch at all: the static wiring
    // checks above are then the whole verdict, which is what this probe claimed before a live call existed.
    if(!peer)return true;
    await ctx.typertGateway.invoke({namespace:dispatch.namespace,method:dispatch.method,args:{},peer});
    return true;
   },
  };
  this.inventory=new ComponentInventory(ctx.pluginManager,this.probe);
  const state=async():Promise<string>=>{
   const profile=await realpath(ctx.profileContext.dir),directory=join(profile,'.omnisurge-suite','state');
   await mkdir(directory,{recursive:true,mode:0o700});
   if(await realpath(directory)!==directory)throw Error('BOOT_STATE_DIRECTORY_ALIAS');
   return profile;
  };
  this.guard=new BootGuard(async()=>{const profile=await state();return profile;},async component=>{
   const plugins=await ctx.pluginManager.listPlugins();
   const row=plugins.find(item=>item.patchId===component.rowId&&item.moduleName===component.module);
   if(!row)return {application:'absent',code:'BOOT_ROW_ABSENT'};
   if(row.readOnlyReason)return {application:'refused',code:row.readOnlyReason};
   if(!row.enabled)return {application:'skipped',code:'BOOT_ROW_ALREADY_DISABLED'};
   const changed=await ctx.pluginManager.setPluginEnabled(row.entryId,false);
   return {application:changed.application,code:changed.error?.code??null};
  },(message,detail)=>{ctx.logger?.warn?.(message,detail);},30000);
  this.healer=new StartupHealer({
   stateDirectory:async()=>{const profile=await state();return profile;},
   inventory:async()=>ctx.pluginManager.listPlugins(),
   toggle:async(entry,enabled)=>{
    const row=(await ctx.pluginManager.listPlugins()).find(item=>item.entryId===entry.entryId&&item.moduleName===entry.moduleName);
    if(!row)return {application:'absent',code:'HEAL_ENTRY_ABSENT'};
    const changed=await ctx.pluginManager.setPluginEnabled(row.entryId,enabled);
    // The diagnostic is forwarded verbatim: the failure text exists nowhere else, and the page decides
    // how to say it (AGENTS §5.10). The healer trims it before it reaches the durable log.
    return {application:changed.application,code:changed.error?.code??null,diagnostic:changed.error?.diagnostic??null};
   },
   notify:(message,detail)=>{ctx.logger?.warn?.(message,detail);},
   ownModules:async()=>{
    try{return (await this.definitions()).map(definition=>definition.module);}
    catch{return [];}
   },
  });
  // ADR-068: the update source is configuration, and the fetched root is derived from the official
  // DSH_HOME. The fetcher is wired before the upgrader because the upgrader's status read is what asks it
  // to check; the arrow back into `this.upgrade.inspect` resolves at call time, never at construction.
  const fetchedDirectory=()=>this.fetchedDirectory();
  this.fetcher=releaseFetcher===undefined?null:releaseFetcher({
   source:()=>normalizeUpdateSource(config?.updateSource),
   fetchedDirectory,
   currentVersion:async()=>String(JSON.parse(await readFile(join(await this.packageRoot(),'package.json'),'utf8')).version),
   // The candidate check is the install path's own code (ADR-068 D2): the fetcher records what it says.
   inspect:directory=>this.upgrade.inspect(directory),
   resolveCredential:ref=>this.resolveReleaseCredential(ref),
   lifetime:this.upgradeAbort.signal,
   logger:(message,detail)=>{ctx.logger?.warn?.(message,detail);},
  });
  const fetcher=this.fetcher;
  this.upgrade=new SuiteUpgrade({
   releaseDirectory:this.releaseDirectory,
   fetchedDirectory,
   // ADR-080 D2/D5: the factory source is the public GitHub repository; a local shelf that was never
   // created is then not a closed channel.
   sourceKind:()=>normalizeUpdateSource(config?.updateSource).kind,
   ...(fetcher===null?{}:{fetchRelease:request=>fetcher.ensure(request)}),
   currentManifest:async()=>{
    const manifest=JSON.parse(await readFile(join(await this.packageRoot(),'package.json'),'utf8'));
    return {version:String(manifest.version),peers:{...(manifest.peerDependencies??{})}};
   },
   installSuite:(archivePath,signal)=>this.installSuiteArchive(archivePath,signal),
   // ADR-047 D3: what the profile holds after the transaction is the authority for "did the bytes
   // land"; the install call's own reply can be lost while the plugin tree reloads.
   installedVersion:async()=>{
    const profile=this.ctx.get('profileContext') as {dir?:string}|undefined;
    const dir=typeof profile?.dir==='string'&&profile.dir.length>0?profile.dir:null;
    if(dir===null)return null;
    try{
     const manifest=JSON.parse(await readFile(join(dir,'node_modules',SUITE_PACKAGE,'package.json'),'utf8'));
     return typeof manifest.version==='string'?manifest.version:null;
    }catch{return null;}
   },
   scratch:state,
   runtimeVersion:()=>this.assertedRuntime,
   installRecord:this.installRecordStore(),
  },()=>this.upgradeMode(),(message,detail)=>{ctx.logger?.warn?.(message,detail);});
  ctx.effect(()=>async()=>{
   this.closing=true;this.abort.abort();this.componentAbort.abort();this.upgradeAbort.abort();this.skillsAbort.abort();
   // Package transactions belong to PluginManager and may await this fiber's disposal.
   // Signal cancellation, but never await that same reload transaction from its disposer.
   await this.pending;
  },'suite manager: cancel owned compiler/component/upgrade request; await compiler cleanup');
  // The boot sentinel is written once this Suite actually loads, and a previous generation that never
  // reached readiness turns into one row-level recovery. Nothing here writes outside the Suite's own
  // profile state directory, and the profile-wide official recovery stays Desktop-owned.
  ctx.effect(()=>{
   // Started here, never in a later tick: the sentinel write must be ordered before anything that
   // reads status, so `boot` is assigned synchronously and every reader joins it.
   this.boot=this.beginBootGuard().catch(error=>{ctx.logger?.warn?.('SUITE_BOOT_GUARD_FAILED',{message:String((error as Error)?.message??error)});});
   // Disposal joins the guard's own writes and refuses later ones; it is never a readiness
   // checkpoint, so an unload before the checkpoint still leaves the next boot its recovery.
   return ()=>this.guard.dispose();
  },'suite boot guard: readiness sentinel and row-level recovery of a boot that never became ready');
  // Start-up containment: the official inventory is the only authority on which entries failed, and this
  // pass contains them so the next reload is clean. It runs after the loader settles, never inside it.
  ctx.effect(()=>{
   this.heal=this.healer.begin().catch((error:unknown)=>{ctx.logger?.warn?.('SUITE_HEAL_FAILED',{message:String((error as Error)?.message??error)});});
   return ()=>this.healer.dispose();
  },'suite start-up healer: contain the entries the official inventory reports as failed');
  // ADR-032 D2: apply reads the bypass file exactly once; the section then only ever reads this snapshot.
  // ctx.get, never a property access: a caller that builds this class on a context which never injected
  // profileContext (the lifecycle fixture, any future embedder) must not be answered with
  // 'cannot get property "profileContext" without inject' — the store degrades to its fail-closed state.
  this.purposes=createPurposeStore({
   profileDir:()=>{
    const profile=ctx.get('profileContext') as {dir?:string}|undefined;
    return typeof profile?.dir==='string'&&profile.dir.length>0?profile.dir:null;
   },
   loader:()=>ctx.get('loader'),
   // One row-identification rule for the whole plugin: the catalog's own, never a second table (D3).
   rowsOf:loader=>mcpRowsOf(loader as LoaderLike|undefined),
  });
  // The read belongs to the plugin's effect scope, not to the constructor body: no IO at construction, and a
  // construction torn down before the read resolves disposes with the plugin. Still exactly one read.
  ctx.effect(()=>{
   void this.purposes.load();
   return ()=>{};
  },'omnisurge:mcp-purpose: the bypass file is read once, at apply time');
  this.registerPurposeSection(ctx);
  this.registerLimitModeSection(ctx);
  this.registerEnvironmentNotesSection(ctx);
  registerComponentTool(ctx,{componentsStatus:()=>this.componentsStatusCore()});
  registerUpgradeTool(ctx,{
   upgradeStatus:()=>this.upgradeStatusCore(),
   upgradeSuite:(expectedVersion,signal)=>this.upgradeOperation(expectedVersion,signal),
  });
  // ADR-065：让 lead 把任务中学到的环境/基础设施事实记进环境笔记（结构化、非秘；秘值只写引用）。
  registerEnvironmentTool(ctx,{remember:(kind,name,detail)=>this.rememberEnvironment(kind,name,detail)});
   registerOcrTool(ctx,{
    capabilities:()=>this.ocr.capabilities(),
    recognize:input=>this.ocr.recognize(input),
    render:input=>this.ocr.render(input),
   });
   registerDocumentParseTool(ctx,{
    capabilities:()=>this.documentParseService.capabilities(),
    parse:input=>this.documentParseService.parse(input),
   });
 }
 private async beginBootGuard():Promise<void>{
  const definitions=await this.definitions(),outcome=await this.guard.begin(definitions.map(definition=>({id:definition.id,rowId:definition.rowId,module:definition.module})));
  if(outcome.diagnostic)this.ctx.logger?.warn?.('SUITE_BOOT_GUARD_DEGRADED',{diagnostic:outcome.diagnostic});
 }
 private async packageRoot():Promise<string>{return realpath(resolve(dirname(fileURLToPath(import.meta.url)),'..'));}
 /** The declared component set: the shipped manifest in release mode, the same declaration file in
  * source mode. Adding a component is data, never a second code path. */
 private async definitions():Promise<ComponentDefinition[]>{
  const root=await this.sourceRoot();
  if(root===null)return readReleaseComponents(await this.packageRoot());
  // Source-linked development reads the repository's own declaration; both origins describe the same
  // module set, and a module that is not a Suite subpath is refused where it is read.
  const declared=JSON.parse(await readFile(join(root,'packages/suite/components.json'),'utf8'));
  if(!Array.isArray(declared)||declared.length===0)throw Error('COMPONENT_MANIFEST_INVALID');
  return declared.map((item:{id:string;export?:string;rowId:string;display?:{en?:string;zh?:string};runtime?:ComponentDefinition['runtime']})=>{
   if(!item.export)throw Error('COMPONENT_MANIFEST_INVALID');
   return {id:item.id,module:SUITE_PACKAGE+'/'+item.export.replace(/^\.\//,''),rowId:item.rowId,display:{en:String(item.display?.en??item.id),zh:String(item.display?.zh??item.id)},runtime:item.runtime??null};
  });
 }
 private async carriedVersion():Promise<string>{
  const manifest=JSON.parse(await readFile(join(await this.packageRoot(),'package.json'),'utf8'));
  return String(manifest.version);
 }
 private definitionById(definitions:ComponentDefinition[],id:string):ComponentDefinition{
  const definition=definitions.find(item=>item.id===id);
  if(!definition)throw Error('COMPONENT_UNKNOWN: '+id);
  return definition;
 }
 /** One canonical owner for the plugin page Remote and the agent tools; the decorators only transport. */
 private async componentsStatusCore():Promise<ComponentSetStatus>{
  const definitions=await this.definitions(),components=[];
  const carriedVersion=await this.carriedVersion();
  for(const definition of definitions)components.push(await this.inventory.inspect(definition,carriedVersion));
  // Serving a status request proves this generation booted: checkpoint readiness durably before
  // answering, so a later crash cannot be blamed on rows this process already proved it survived.
  await this.boot;
  await this.guard.markReady();
  // A status read also settles the containment pass: the page must not see a half-finished one.
  await this.heal?.catch(()=>undefined);
  await this.healer.scan();
  return {components,recovery:await this.guard.latestReceipt(),heal:await this.healer.list()};
 }
 @Remote
 async componentsStatus():Promise<ComponentSetStatus>{return this.componentsStatusCore();}
 @Remote
 async ocrCapabilities():Promise<OcrCapabilities>{return this.ocr.capabilities();}
 @Remote
 async ocrSetEnabled(enabled:boolean):Promise<OcrCapabilities>{
  await this.writeOcrState({enabled:enabled===true});
  return this.ocr.capabilities();
 }
 @Remote
 async ocrSetProvider(provider:string):Promise<OcrCapabilities>{
  if(provider!=='tencent'&&provider!=='baidu')throw new Error('OCR_PROVIDER_UNKNOWN: '+provider);
  await this.writeOcrState({provider});
  return this.ocr.capabilities();
 }
 @Remote
 async ocrRecentImages():Promise<{attachment:OcrImageAttachment;label:string}[]>{return this.recentOcrImages();}
 @Remote
 async ocrRecognize(input:{path?:string;attachment?:OcrImageAttachment;mode:'accurate'|'handwriting'|'both';provider?:string;page?:number;pages?:string;reconcile?:boolean}):Promise<OcrRecognizeResult>{return this.ocr.recognize(input);}
 @Remote
 async ocrRender(input:{path:string;page:number;box?:{x0:number;y0:number;x1:number;y1:number};dpi?:number;polygon?:{x:number;y:number}[];sourceDpi?:number;outputDirectory?:string}):Promise<OcrRenderResult>{return this.ocr.render(input);}
 @Remote
 async documentParseCapabilities():Promise<DocumentParseCapabilities>{return this.documentParseService.capabilities();}
 @Remote
 async documentParse(input:DocumentParseRequest):Promise<DocumentParseResult>{return this.documentParseService.parse(input);}
 @Remote
 async documentParseSetEnabled(enabled:boolean):Promise<DocumentParseCapabilities>{const current=await this.readDocumentParseState();await this.writeDocumentParseState({...current,enabled:enabled===true});return this.documentParseService.capabilities();}
 @Remote
 async healAcknowledge(entryId:string):Promise<{acknowledged:boolean}>{return {acknowledged:await this.healer.acknowledge(entryId)};}
 @Remote
 async healScan():Promise<HealRecord[]>{return this.healer.scan();}
 @Remote
 async listSkills(options:{cwd?:string}):Promise<SkillsCatalog>{
  // ADR-027: the catalog merges the registry's global layer with a local-root scan; both need the same
  // workspace selector, and the scan needs the harness config root the writes use.
  return readSkillsCatalog(this.ctx.get('skills'),{
   cwd:typeof options?.cwd==='string'&&options.cwd.length>0?options.cwd:this.workspaceDirectory(),
   dshHome:resolveDshHome(undefined,process.env),

   signal:this.skillsAbort.signal
  });
 }
 /** The server rows the page shows: live Loader facts plus the profile patch that owns them. */
 @Remote
 async listMcpServers():Promise<McpServerCatalog>{
  return readMcpServers(this.mcpContext());
 }
 /** Add one server row to the profile patch; the runtime reloads it (patchReload: live) or reports pending. */
 @Remote
 async addMcpServer(draft:McpServerDraft):Promise<McpServerMutation>{
  return addMcpServer(this.mcpContext(),draft);
 }
 /** Replace the fields the page owns on one profile-owned row. */
 @Remote
 async updateMcpServer(rowId:string,draft:McpServerDraft):Promise<McpServerMutation>{
  return updateMcpServer(this.mcpContext(),rowId,draft);
 }
 /** Remove a profile row, or disable a bundle-provided row through the documented override. */
 @Remote
 async removeMcpServer(rowId:string):Promise<McpServerMutation>{
  return removeMcpServer(this.mcpContext(),rowId);
 }
 /** ADR-032 D5: the purpose snapshot (memory, never a re-read of the bypass file) plus the current rows,
  * disabled ones included so the page can edit them. */
 @Remote
 async readMcpPurposes():Promise<McpPurposeSnapshot>{
  // F1: the page's read waits for the one apply-time read instead of answering with a fail-closed placeholder;
  // load() is idempotent, so this is still exactly one disk read per process.
  await this.purposes.load();
  return this.purposes.view(await this.purposeServers());
 }
 /** ADR-032 D5: per-key CAS write. An empty or whitespace-only purpose clears the key through the same CAS. */
 @Remote
 async writeMcpPurpose(input:{rowId:string;purpose:string;expectedRevision:number}):Promise<McpPurposeWriteResult>{
  return this.withPurposeLock(async()=>this.purposes.writePurpose(input,await this.purposeServers()));
 }
 /** ADR-032 D5/D7: the explicit "I filled something in, do not inject it yet" switch. */
 @Remote
 async setMcpRouting(input:{routing:boolean;expectedRevision:number}):Promise<McpPurposeWriteResult>{
  return this.withPurposeLock(()=>this.purposes.setRouting(input));
 }
 /** User-triggered live probe of one row's client report (ADR-030 D3): a real round trip, shown with a receipt. */
 @Remote
 async probeMcpServer(rowId:string):Promise<McpProbeResult>{
  return probeMcpServer(this.mcpContext(),rowId);
 }
 /** Move official static-HTTP rows onto the v2-capable client (ADR-030 D5); next process picks it up. */
 @Remote
 async migrateMcpServers():Promise<McpMigrationResult>{
  return migrateStaticHttpRows(this.mcpContext());
 }
 /** Move rows that name the historical external dual client onto the Suite subpath (ADR-033 D4); next process
  * loads it, so the receipt says restartRequired rather than claiming the running one changed. */
 @Remote
 async migrateMcpClients():Promise<McpMigrationResult>{
  return migrateLegacyClientRows(this.mcpContext());
 }
 /** The body behind one editable skill row; the page calls this only after the user asks to edit. */
 @Remote
 async readSkill(name:string,scope?:SkillScope):Promise<SkillDocument>{
  return readSkill(this.skillContext(),name,scope);
 }
 @Remote
 async createSkill(draft:SkillDraft):Promise<SkillMutation>{
  return createSkill(this.skillContext(),draft);
 }
 @Remote
 async updateSkill(name:string,draft:SkillDraft):Promise<SkillMutation>{
  return updateSkill(this.skillContext(),name,draft);
 }
 @Remote
 async removeSkill(name:string,scope?:SkillScope):Promise<SkillMutation>{
  return removeSkill(this.skillContext(),name,scope);
 }
 /** The page has no Session binding, so the only workspace fact it can honestly share is the deployment
  * directory the public `workingDirectory` service was configured with: that is what makes project-root
  * discovery and project writes reachable at all (ADR-026 D1, ADR-027). */
 private workspaceDirectory():string|undefined{
  const service=this.ctx.get('workingDirectory') as {defaultDirectory?:unknown}|undefined;
  const declared=service?service.defaultDirectory:undefined;
  return typeof declared==='string'&&isAbsolute(declared)?declared:undefined;
 }
 /** Writes need the same workspace selector the catalog read uses (ADR-026). */
 private skillContext():SkillContext{
  return {
   cwd:this.workspaceDirectory(),
   dshHome:resolveDshHome(undefined,process.env),

   skills:this.ctx.get('skills') as SkillRegistryLike|undefined,
   signal:this.skillsAbort.signal,
  };
 }
 /** ADR-032 D3: register the named section on the plugin's own ctx — global, disposed with the plugin, and
  * evaluated on every assemble. A host whose runtime has no `systemPrompt` simply never runs the callback. */
 private registerPurposeSection(ctx:Context):void{
  type PromptSectionHost={section(input:{name:string;order:number;text:()=>string;interpolate:boolean}):()=>void;};
  const injectable=ctx as unknown as {inject(keys:string[],callback:(promptCtx:{effect:(fn:()=>unknown,name?:string)=>unknown;systemPrompt:PromptSectionHost})=>void):void;};
  injectable.inject(['systemPrompt'],promptCtx=>{
   promptCtx.effect(()=>{
    try{
     return promptCtx.systemPrompt.section({
      name:PURPOSE_SECTION_NAME,
      order:PURPOSE_SECTION_ORDER,
      // ADR-032 D4: no interpolation — `{{`/`}}` stay exactly as the user typed them.
      interpolate:false,
      text:()=>this.purposes.sectionText(),
     });
    }catch(error){
     // A section that cannot register degrades to "no section": the session must never fail because of it.
     ctx.logger?.warn?.('SUITE_MCP_SECTION_UNAVAILABLE',{message:String((error as Error)?.message??error)});
     return ()=>{};
    }
   },'omnisurge:mcp-purpose');
  });
 }
 private registerLimitModeSection(ctx:Context):void{
  type PromptSectionHost={section(input:{name:string;order:number;text:(context?:unknown)=>string;interpolate:boolean}):()=>void;};
  const injectable=ctx as unknown as {inject(keys:string[],callback:(promptCtx:{effect:(fn:()=>unknown,name?:string)=>unknown;systemPrompt:PromptSectionHost})=>void):void;};
  injectable.inject(['systemPrompt'],promptCtx=>{
   promptCtx.effect(()=>{
    try{
     return promptCtx.systemPrompt.section({
      name:LIMIT_MODE_SECTION,
      order:LIMIT_MODE_ORDER,
      interpolate:false,
      // ADR-058 D2：按 agent 判定，每次组装重算；不命中返回空串，等价于没有这一段。
      text:(context?:unknown)=>limitModeSectionText(this.limitModeConfig(),selectionOf({get:name=>this.lookup(name)},(context as {agent?:unknown}|undefined)?.agent)).text,
     });
    }catch(error){
     ctx.logger?.warn?.('SUITE_LIMIT_MODE_UNAVAILABLE',{message:String((error as Error)?.message??error)});
     return ()=>{};
    }
   },'omnisurge:limit-mode');
  });
 }
 /** ADR-061：环境笔记段的注册。与 mcp-purpose 同一纪律：注册失败只记 warn，绝不因为一段笔记让会话起不来。 */
 private registerEnvironmentNotesSection(ctx:Context):void{
  type PromptSectionHost={section(input:{name:string;order:number;text:()=>string;interpolate:boolean}):()=>void;};
  const injectable=ctx as unknown as {inject(keys:string[],callback:(promptCtx:{effect:(fn:()=>unknown,name?:string)=>unknown;systemPrompt:PromptSectionHost})=>void):void;};
  injectable.inject(['systemPrompt'],promptCtx=>{
   promptCtx.effect(()=>{
    try{
     return promptCtx.systemPrompt.section({
      name:ENVIRONMENT_NOTES_SECTION,
      order:ENVIRONMENT_NOTES_ORDER,
      interpolate:false,
      text:()=>notesSectionTextSync(notesPathOf(this.profileDir())),
     });
    }catch(error){
     ctx.logger?.warn?.('SUITE_ENVIRONMENT_NOTES_UNAVAILABLE',{message:String((error as Error)?.message??error)});
     return ()=>{};
    }
   },'omnisurge:environment-notes');
  });
 }
 /** 环境笔记的读：文件是权威，读失败如实报不可用。 */
 @Remote
 async environmentNotes():Promise<EnvironmentNotesState>{
  const notes=await readNotes(notesPathOf(this.profileDir()));
  return {available:notes.available,code:notes.code,text:notes.text,bytes:notes.bytes};
 }
 /** 环境笔记的写：超限/非法拒绝，原子替换；写成功后下一步提示词就带上新内容（无需重启）。 */
 @Remote
 async saveEnvironmentNotes(text:string):Promise<EnvironmentNotesState>{
  const notes=await writeNotes(notesPathOf(this.profileDir()),text);
  return {available:notes.available,code:notes.code,text:notes.text,bytes:notes.bytes};
 }
   /** 记一条环境事实（ADR-065）：结构化追加到环境笔记文件；同名同类替换旧块，避免重复；超限/无 profile 如实报错。 */
  private async rememberEnvironment(kind:string,name:string,detail:string):Promise<{saved:boolean;code:string|null;bytes:number}> {
   const path=notesPathOf(this.profileDir());
   if(path===null)return {saved:false,code:'ENVIRONMENT_NOTES_PROFILE_UNKNOWN',bytes:0};
   const current=await readNotes(path);
   if(!current.available)return {saved:false,code:current.code,bytes:current.bytes};
   const text=appendEnvironmentEntry(current.text??'',kind,name,detail);
   const written=await writeNotes(path,text);
   if(written.code!==null)return {saved:false,code:written.code,bytes:written.bytes};
   return {saved:true,code:null,bytes:written.bytes};
  }
/** 读一次运行期服务；缺服务返回 undefined，由调用方决定怎么降级，不在这里抛。 */
 private lookup(name:string):unknown{return (this.ctx as unknown as {get(name:string):unknown}).get(name);}
 @Remote
 async limitModeStatus():Promise<LimitModeStatus>{
  const config=this.limitModeConfig();
  const prompt=this.lookup('systemPrompt');
  const available=prompt!==undefined&&prompt!==null;
  const agents=this.lookup('agents') as {list?:()=>unknown[]}|undefined;
  // ADR-069 D2 (0.2.2-3): reading only list[0] printed "model unknown" on a real profile whose first
  // agent had no selection yet, and the page turned that into a false "current model does not match".
  // The traversal lives in limit-mode.ts so the rule is unit-tested, not restated here.
  const selection=firstReadableSelection({get:(name:string)=>this.lookup(name)},agents);
  return {available,code:available?null:'LIMIT_MODE_UNAVAILABLE',enabled:config.enabled,models:config.models,textLength:config.text.trim().length,text:config.text,selection,matched:matchesLimitModels(config.models,selection)};
 }
 @Remote
 async teamStatus():Promise<TeamStatus>{
  return readTeamStatus({get:name=>this.lookup(name)},agent=>selectionOf({get:name=>this.lookup(name)},agent));
 }
 /** ADR-054 D1/D4 的配置读：只报官方行里当前生效的事实，外加能不能写的独立判据。 */
 @Remote
 async teamConfig():Promise<TeamConfigState>{
  // ADR-064：两个配置键分属两个官方行。字段值按各自归属行解析；客户端不再猜 rows[0]。
  const officialRows=this.teamRows();
  const rows=officialRows.map(row=>({rowId:row.rowId,name:row.name,maxMembers:typeof row.config.maxMembers==='number'?row.config.maxMembers:null,freshProvider:typeof row.config.freshProvider==='string'?row.config.freshProvider:null,otherKeys:Object.keys(row.config).filter(key=>key!=='maxMembers'&&key!=='freshProvider')}));
  const fields=teamConfigFields(officialRows);
  return {available:rows.length>0,code:rows.length>0?null:'TEAM_CONFIG_ROW_NOT_FOUND',profileKnown:this.profileDir()!==null,rows,maxMembersLimit:TEAM_CONFIG_MAX_MEMBERS_LIMIT,maxMembers:fields.maxMembers,freshProvider:fields.freshProvider};
 }
 /** 写入口是 profile patch 文件（见 team-config.ts 抬头），写前备份、只改声明键、结果明示需要重启。
  *  ADR-064：调用方只给字段，Host 按字段路由到各自归属的官方行，多行一次写盘、一份备份。 */
 @Remote
 async saveTeamConfig(patch:TeamConfigPatch):Promise<TeamConfigWrite>{
  const officialRows=this.teamRows();
  const planned=planTeamConfig(officialRows,{...(patch??{})});
  if(planned.code!==null)return {changed:false,backupPath:null,restartRequired:false,code:planned.code,changedKeys:[],maxMembers:null,freshProvider:null};
  if(planned.plans.length===0)return {changed:false,backupPath:null,restartRequired:false,code:null,changedKeys:[],maxMembers:teamConfigFields(officialRows).maxMembers,freshProvider:teamConfigFields(officialRows).freshProvider};
  const stamp=new Date().toISOString().replace(/[:.]/gu,'-');
  return writeTeamConfigs(this.profileDir(),planned.plans,officialRows,stamp,planned.changedKeys);
 }
 /** 极限模式配置的宿主行（ADR-062）：按模块名发现，找不到就是找不到。 */
 private agentTeamsRow(){
  const loader=this.lookup('loader') as {entries?:()=>Iterable<{options?:{id?:unknown;name?:unknown;config?:unknown}}>}|undefined;
  if(typeof loader?.entries!=='function')return null;
  const entries=[...loader.entries()].map(entry=>{const options=entry?.options??{};return {id:options.id,name:options.name,config:options.config};});
  return agentTeamsRowOf(entries as unknown as {id?:unknown;name?:unknown;config?:unknown}[]);
 }
 /** 官方 Agent Teams 行：按模块名发现，不猜 row id；条目只能来自 loader，不自己造表。 */
 private teamRows():TeamConfigRow[]{
  const loader=this.lookup('loader') as {entries?:()=>Iterable<{options?:{id?:unknown;name?:unknown;config?:unknown}}>}|undefined;
  if(typeof loader?.entries!=='function')return [];
  const entries=[...loader.entries()].map(entry=>{const options=entry?.options??{};return {id:options.id,name:options.name,config:options.config};});
  return teamRowsOf(entries as unknown as {id?:unknown;name?:unknown;config?:unknown}[]);
 }
 /** 运行进程的 profile 目录；没有就是没有，不猜固定路径。 */
 /** The one owner of the user switch. It is read on every operation, so flipping it needs no restart. */
 private async readOcrState():Promise<{enabled:boolean;provider?:string}>{
  const directory=this.profileDir();
  if(directory===null)return {enabled:false};
  try{
   const parsed=JSON.parse(await readFile(join(await profileStateDirectory(directory),'ocr.json'),'utf8')) as {enabled?:unknown;provider?:unknown};
   const provider=typeof parsed?.provider==='string'&&(parsed.provider==='tencent'||parsed.provider==='baidu')?parsed.provider:undefined;
   return {enabled:parsed!==null&&typeof parsed==='object'&&parsed.enabled===true,...(provider===undefined?{}:{provider})};
  }catch{return {enabled:false};}
 }
 private async writeOcrState(next:{enabled?:boolean;provider?:string}):Promise<void>{
  const directory=this.profileDir();
  if(directory===null)throw new Error('OCR_STATE_UNWRITABLE: this Host has no profile directory to store the switch in');
  const current=await this.readOcrState();
  const provider=next.provider==='tencent'||next.provider==='baidu'?next.provider:current.provider;
  await writeProfileState(await profileStateDirectory(directory),'ocr.json',{enabled:next.enabled??current.enabled,...(provider===undefined?{}:{provider})});
 }
 /** ADR-086: document parsing has its own switch and last-error witness; never shares OCR state. */
 private async readDocumentParseState():Promise<DocumentParseState>{
  const directory=this.profileDir();
  if(directory===null)return {enabled:false};
  try{
   const parsed=JSON.parse(await readFile(join(await profileStateDirectory(directory),'document-parse.json'),'utf8')) as {enabled?:unknown;lastErrors?:unknown};
   const lastErrors=parsed!==null&&typeof parsed==='object'&&parsed.lastErrors!==null&&typeof parsed.lastErrors==='object'?parsed.lastErrors as Record<string,{code:string;at:string;retryAfter:number|null;mode?:string|null}>:undefined;
   return {enabled:parsed!==null&&typeof parsed==='object'&&parsed.enabled===true,...(lastErrors===undefined?{}:{lastErrors})};
  }catch{return {enabled:false};}
 }
 private async writeDocumentParseState(next:DocumentParseState):Promise<void>{
  const directory=this.profileDir();
  if(directory===null)throw new Error('DOCUMENT_PARSE_STATE_UNWRITABLE: this Host has no profile directory to store the switch in');
  const current=await this.readDocumentParseState();
  await writeProfileState(await profileStateDirectory(directory),'document-parse.json',{...current,...next});
 }
 /** Latest durable conversation images, newest first. The card uses these as the sample for its one "try it";
  * no image bytes are copied or uploaded. Missing session service is a readable empty list, not an error. */
 private async recentOcrImages():Promise<{attachment:OcrImageAttachment;label:string}[]>{
  const sessions=this.ctx.get('sessions') as {list?:()=>Array<{id:string;snapshotEvents?:()=>readonly {type?:string;data?:unknown}[]}>}|undefined;
  if(typeof sessions?.list!=='function')return [];
  const found:{attachment:OcrImageAttachment;label:string}[]=[];
  const seen=new Set<string>();
  for(const session of [...sessions.list()].reverse()){
   const events=typeof session.snapshotEvents==='function'?session.snapshotEvents():[];
   for(const event of [...events].reverse()){
    const payload=event.type==='user/message'?event.data:(event.data as {message?:unknown}|undefined)?.message;
    const content=(payload as {content?:unknown}|undefined)?.content;
    if(!Array.isArray(content))continue;
    for(const block of content as {type?:unknown;attachment?:OcrImageAttachment}[]){
     if(block?.type!=='image'||block.attachment===undefined)continue;
     const attachment=block.attachment;
     if(typeof attachment.attachmentId!=='string'||seen.has(attachment.attachmentId))continue;
     if(attachment.mediaType!=='image/png'&&attachment.mediaType!=='image/jpeg')continue;
     seen.add(attachment.attachmentId);
     found.push({attachment,label:attachment.name??attachment.attachmentId.slice(0,24)});
     if(found.length>=5)return found;
    }
   }
  }
  return found;
 }
 private profileDir():string|null{
  const profile=this.lookup('profileContext') as {dir?:unknown}|undefined;
  return typeof profile?.dir==='string'&&profile.dir.length>0?profile.dir:null;
 }
 /** ADR-032 D5: the page's row list for key validation — the catalog's rows, disabled included. */
 private async purposeServers():Promise<McpPurposeServer[]>{
  const catalog=await readMcpServers(this.mcpContext());
  return catalog.servers.map(server=>({rowId:server.rowId,serverName:server.name,enabled:server.state!=='disabled'}));
 }
 /** ADR-032 D5: no profile means no lock and no bypass file; the write is refused with the code the page knows. */
 private async withPurposeLock<T>(work:()=>Promise<T>):Promise<T>{
  const profile=this.ctx.get('profileContext') as {patchPath?:string}|undefined;
  const patchPath=typeof profile?.patchPath==='string'?profile.patchPath:null;
  if(patchPath===null)throw purposeUnavailable();
  return withProfileLock(patchPath,work);
 }
 private mcpContext(){
  const profile=this.ctx.get('profileContext') as {patchPath?:string;dir?:string}|undefined;
  return {
   loader:this.ctx.get('loader') as LoaderLike|undefined,
   tools:this.ctx.get('tools') as ToolsLike|undefined,
   patchPath:typeof profile?.patchPath==='string'?profile.patchPath:null,
   profileDir:typeof profile?.dir==='string'?profile.dir:null,
   purposes:this.purposes,
   signal:this.skillsAbort.signal,
   // With no loopback origin there is nothing to ask, so the reader is absent: the page must not offer a probe
   // that can only come back empty (ADR-030 D3).
   runtime:loopbackOrigin(this.webServerOrigin())===null?undefined:(clientPackage:string,serverName:string,action:'status'|'probe')=>this.readMcpRuntime(clientPackage,serverName,action),
  };
 }
 /** The official web server's own origin (bound listener). Reading it keeps the loopback status query off any
  * guessed port: no web server, or one that has not bound yet, simply means "no status to read". */
 private webServerOrigin():string|null{
  const service=this.ctx.get('webServer') as {getOrigin?:()=>string}|undefined;
  try{
   const origin=service?.getOrigin?.();
   return typeof origin==='string'&&origin.length>0?origin:null;
  }catch{
   return null;
  }
 }
 /** One client plugin's connection report through its own loopback control plane (ADR-030 D2). Bounded, and
  * any failure is reported as "no status" — a broken client must never break the server list. */
 private async readMcpRuntime(clientPackage:string,serverName:string,action:'status'|'probe'):Promise<unknown|null>{
  const adapter=CLIENT_ADAPTERS[clientPackage];
  if(!adapter)return null;
  const origin=loopbackOrigin(this.webServerOrigin());
  if(origin===null)return null;
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),1200);
  try{
   const response=await fetch(origin+adapter.prefix+'/'+encodeURIComponent(serverName)+'/'+action,{signal:controller.signal,headers:{accept:'application/json'}});
   if(!response.ok)return null;
   // The raw body crosses back; `mcp-servers` is the single place it becomes the public type (ADR-030 D2).
   return (await response.json()) as unknown;
  }catch{
   return null;
  }finally{
   clearTimeout(timer);
  }
 }
 /** ADR-079: where the durable install record lives. The reply of a self-replacing install can be lost with
  * the plugin tree, so the attempt itself is recorded in profile state before the official transaction runs
  * and settled at every exit; a reader that never received a reply reads this instead. */
 private installRecordStore(){
  return {
   read:async():Promise<UpgradeInstallRecord|null>=>{
    const directory=await this.profileStatePath();
    if(directory===null)return null;
    try{
     const parsed=JSON.parse(await readFile(join(directory,'upgrade.json'),'utf8'));
     // A record that does not match the shape is not a record: `schema` and the phase enum are the two
     // fields every reader branches on, so a hand-edited or half-written file must read as "no record".
     const ok=parsed!==null&&typeof parsed==='object'&&parsed.schema===1&&typeof parsed.target==='string'&&['installing','written','failed','interrupted'].includes(parsed.phase);
     return ok?parsed as UpgradeInstallRecord:null;
    }catch{return null;}
   },
   write:async(record:UpgradeInstallRecord):Promise<void>=>{
    const directory=await this.profileStatePath();
    if(directory===null)throw Error('UPGRADE_RECORD_NO_PROFILE');
    await writeProfileState(directory,'upgrade.json',record);
   },
  };
 }
 /** The profile's own state directory, or null when this Host has no profile (a fixture). */
 private async profileStatePath():Promise<string|null>{
  const profile=this.ctx.get('profileContext') as {dir?:string}|undefined;
  const dir=typeof profile?.dir==='string'&&profile.dir.length>0?profile.dir:null;
  if(dir===null)return null;
  try{return await profileStateDirectory(dir);}catch{return null;}
 }
 private async upgradeStatusCore():Promise<UpgradeStatus>{return this.upgrade.status();}
 /** One place decides what the running release is: the page's own observation, kept for the rest of the
  * process so the agent tool asks the same question as the card. A shape check stops a broken or foreign
  * value from becoming a fact; an absent value stays absent and is refused, never guessed. */
 private noteRuntimeVersion(reported?:string):void{
  if(typeof reported!=='string')return;
  const value=reported.trim();
  if(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value))this.assertedRuntime=value;
 }
 @Remote
 async upgradeStatus(runtimeVersion?:string):Promise<UpgradeStatus>{this.noteRuntimeVersion(runtimeVersion);return this.upgradeStatusCore();}
 /** ADR-068 D5: the explicit check of the configured external source. Networking happens only here, when a
  * caller asks for it: a page render, an agent status read and an install receipt read the disk only. The
  * answer keeps the `UpgradeStatus` shape the card already renders, with the fetch's own machine code in
  * `refusals` when nothing could be landed ("no update", never a half-landed candidate). */
 @Remote
 async checkRelease(runtimeVersion?:string):Promise<UpgradeStatus>{this.noteRuntimeVersion(runtimeVersion);return this.upgrade.check();}
 @Remote
 async upgradeSuite(expectedVersion:string,runtimeVersion?:string,signal?:AbortSignal):Promise<UpgradeResult>{this.noteRuntimeVersion(runtimeVersion);return this.upgradeOperation(expectedVersion,signal);}
 private upgradeOperation(expectedVersion:string,signal?:AbortSignal):Promise<UpgradeResult>{
  if(this.closing)throw Error('MANAGER_CLOSING: upgrade owner is stopping');
  if(this.operation.phase==='building')throw Error('UPGRADE_BUSY: the source target is building');
  if(this.upgradePending)throw Error('UPGRADE_BUSY: another upgrade batch is running');
  const work=this.upgrade.upgrade(expectedVersion,combined(signal,this.upgradeAbort.signal));
  this.upgradePending=work;
  return work.finally(()=>{if(this.upgradePending===work)this.upgradePending=undefined;});
 }
 /** The Suite is a profile dependency: only the official install transaction may replace it, and the
  * new bytes load in a new process. No profile manifest or patch file is ever written here. */
 private async installSuiteArchive(archivePath:string,signal:AbortSignal){
  const requestId=('omnisurge-suite-'+randomUUID()) as PluginInstallRequestId;
  let cancellation:Promise<unknown>|undefined,cancellationError:unknown;
  const cancel=()=>{cancellation=this.ctx.pluginManager.cancelInstall(requestId).catch(error=>{cancellationError=error;});};
  signal.addEventListener('abort',cancel,{once:true});
  try{
   const changed=await this.ctx.pluginManager.installBundle(archivePath,{requestId});
   return {application:changed.application,changed:changed.changed,code:changed.error?.code??null,diagnostic:changed.error?.diagnostic??null};
  }finally{
   signal.removeEventListener('abort',cancel);await cancellation;if(cancellationError)throw Error('UPGRADE_CANCEL_UNCONFIRMED: '+String(cancellationError));
  }
 }
 /** ADR-068 D1: the append-only fetched root, derived from the official DSH_HOME. Without that fact there
  * is no honest second root to read, so the fetcher stays off and the local channel behaves exactly as it
  * did before this batch. Nothing here ever names the release directory: the fetcher must not become a
  * second writer on the publish shelf (AGENTS 5.9). */
 private fetchedDirectory():string|null{
  // The shipped desktop Host runs with HOME only — no DSH_HOME — so reading the env var alone silently
  // turned the whole GitHub channel off while every gate stayed green (review 0.2.2-1 F1). The official
  // precedence (explicit path, non-blank DSH_HOME, then ~/.dsh) lives in dsh-home.ts and is shared with
  // the skills roots, so the two cannot drift.
  let root:string;
  try{root=resolveDshHome(undefined,process.env);}catch{return null;}
  if(!isAbsolute(root))return null;
  return join(root,'omnisurge','fetched');
 }
 /** ADR-068 D4: a repository token is resolved per operation through the official credential service, by
  * reference. The value never leaves this method — no log, no receipt, no page — and a Host without that
  * service degrades to "public repositories only": the reference is refused instead of being used as if it
  * were the secret. `ctx.get` (never a property access) keeps a fixture or embedder without the service
  * working; that is the degradation this capability promises. */
 /** The presence half of the same service: configured/writable facts, never the value. */
 private async describeOcrCredential(ref:string):Promise<{configured:boolean;writable:boolean}|undefined>{
  const credentials=this.ctx.get('credentials') as {describe?:(reference:string)=>Promise<{configured?:boolean;writable?:boolean}>}|undefined;
  if(typeof credentials?.describe!=='function')return undefined;
  const info=await credentials.describe(ref);
  return {configured:info?.configured===true,writable:info?.writable===true};
 }
 /** ADR-036 D4: the OCR supplier's two references resolve through the same official service. A Host without
  * it answers "not configured" instead of inventing a value, so the tool refuses readably. */
 private async resolveOcrCredential(ref:string):Promise<string|undefined>{
  const credentials=this.ctx.get('credentials') as {resolve?:(reference:string)=>Promise<{value?:string}|undefined>|{value?:string}|undefined}|undefined;
  if(typeof credentials?.resolve!=='function')return undefined;
  const resolved=await credentials.resolve(ref);
  return typeof resolved?.value==='string'?resolved.value:undefined;
 }
 private async resolveReleaseCredential(ref:string):Promise<string|undefined>{
  const credentials=this.ctx.get('credentials') as {resolve?:(reference:string)=>Promise<{value?:string}|undefined>|{value?:string}|undefined}|undefined;
  if(typeof credentials?.resolve!=='function')throw Error('CREDENTIAL_SERVICE_UNAVAILABLE');
  const resolved=await credentials.resolve(ref);
  return typeof resolved?.value==='string'?resolved.value:undefined;
 }
 /** The single derivation of the upgrade mode: `sourceRoot()` is asynchronous, so comparing its promise
  * to null would answer `source` for every install and silently close the release channel. */
 private async upgradeMode():Promise<'release'|'source'>{return (await this.sourceRoot())===null?'release':'source';}
 private async sourceRoot():Promise<string|null>{
  const packageRoot=await this.packageRoot(),root=resolve(packageRoot,'../..');
  try{const manifest=JSON.parse(await readFile(join(root,'package.json'),'utf8'));return manifest.name==='@omnisurge/dsh-suite-workspace'&&await realpath(join(root,'packages/suite'))===packageRoot?root:null;}
  catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;return null;}
 }
 @Remote
 async status():Promise<DevelopmentStatus>{
  const root=await this.sourceRoot(),hmr=this.ctx.get('hmr');
  // The Suite is the only target: HMR coverage is proved against the Suite's own generation.
  const output=root?join(root,'packages/suite/lib'):null;
  // Public baseDir owns relative root resolution. Coverage alone cannot prove ignored glob
  // semantics: without a public matcher, a nonempty ignored list is conservatively unconfirmed.
  let hostHmr=false;
  if(output&&typeof hmr?.baseDir==='string'&&isAbsolute(hmr.baseDir)&&Array.isArray(hmr.config?.root)&&Array.isArray(hmr.config?.ignored)&&hmr.config.ignored.length===0){
   try{const owner=await realpath(output);for(const path of hmr.config.root){if(typeof path!=='string')continue;try{const watched=await realpath(resolve(hmr.baseDir,path));if(owner===watched||owner.startsWith(watched+sep)){hostHmr=true;break;}}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}}}
   catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  }
  const host=runtimeBuild(this.ctx.get('omnisurgeSearxngHostBuild'));
  const capable=Boolean(host&&host.protocol===SUITE_DEVELOPMENT_PROTOCOL&&REQUIRED_CAPABILITIES.filter(name=>CAPABILITY_OWNERS[name]==='host').every(name=>host.capabilities[name as keyof HostRuntimeBuild['capabilities']]));
  return {linked:root!==null,sourceRoot:root,hostPid:process.pid,hostHmr,managerProtocol:SUITE_DEVELOPMENT_PROTOCOL,hostRevision:host?.revision??null,hostProtocol:host?.protocol??null,hostCapabilities:host?.capabilities??null,operation:{...this.operation,target:this.operation.target?{...this.operation.target}:null},// Facts cross the Remote boundary as codes; the Client owns every user-visible sentence and its
  // language. Prose written here would be rendered verbatim in a page whose locale is not English.
  notice:{code:root?(capable?(hostHmr?'HMR_ENABLED':'HMR_UNCONFIRMED'):'HOST_PROTOCOL_OLD'):'RELEASE_PACKAGE'}};
 }
 private claim(expectedEpoch:number):void {
  if(this.closing)throw Error('MANAGER_CLOSING: operation owner is stopping');
  if(this.upgradePending||this.operation.epoch!==expectedEpoch||this.operation.phase==='building')throw Error('BUILD_BUSY: another operation was claimed while validating source');
 }
 @Remote
 async build(expectedEpoch:number):Promise<DevelopmentStatus>{
  if(!Number.isSafeInteger(expectedEpoch)||expectedEpoch!==this.operation.epoch)throw Error('STALE_OPERATION: refresh status before retrying');
  if(this.closing)throw Error('MANAGER_CLOSING: operation owner is stopping');
  if(this.upgradePending||this.operation.phase==='building')throw Error('BUILD_BUSY: another window already owns a management operation');
  const root=await this.sourceRoot();if(!root)throw Error('RELEASE_PACKAGE: only the linked source target may be built');
  const scratch=join(root,'.scratch');try{if((await lstat(scratch)).isSymbolicLink())throw Error('STATE_ALIAS: scratch must not redirect outside the source');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  this.claim(expectedEpoch);
  this.operation={epoch:expectedEpoch+1,phase:'building',error:null,target:null};
  const controller=this.abort,signal=controller.signal;
  const timeout=setTimeout(()=>controller.abort(Error('BUILD_TIMEOUT: compiler exceeded 60 seconds')),60000);
  const run=async()=>{try{
   const compile=()=>runFixedBuildEntry(root,join(scratch,'suite-manager'),signal),hmr=this.ctx.get('hmr');
   const target=await runCancellableExclusive(hmr?work=>hmr.runExclusive(work):undefined,compile,signal);
   this.operation={...this.operation,phase:'published',target};
  }catch(error){this.operation={...this.operation,phase:'failed',error:String((error as Error).message)};}finally{clearTimeout(timeout);if(!this.closing)this.abort=new AbortController();}};
  this.pending=run();await this.pending;return this.status();
 }
}
/** Capture the configured release directory once per read; an explicitly blank value disables it. */
function readConfigured(value:unknown):string{
 if(typeof value==='string')return value.trim();
 const resolved=(value as {get?:()=>unknown}|undefined)?.get?.();
 return typeof resolved==='string'?resolved.trim():DEFAULT_RELEASE_DIRECTORY;
}
/** Combine an optional caller signal with the owner's lifetime signal without dropping either. */
function combined(signal:AbortSignal|undefined,lifetime:AbortSignal):AbortSignal{
 return signal?AbortSignal.any([signal,lifetime]):lifetime;
}