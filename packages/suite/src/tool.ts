import type {Context} from '@deepseek-ai/cordis';
import {defineTool} from '@deepseek-ai/dsh-tools';
import type {ComponentSetStatus,UpgradeResult,UpgradeStatus} from './types.js';
import type {OcrImageAttachment} from './ocr-types.js';

/** The agent-facing adapter of the one canonical inventory. It holds no state and no mutation path: a
 * declared module ships inside the Suite package, so there is nothing to install, upgrade or deselect
 * per module, and the only row action left is the official plugin-page switch. */
export interface ComponentToolOwner {
 componentsStatus:()=>Promise<ComponentSetStatus>;
}
export interface UpgradeToolOwner {
 upgradeStatus:()=>Promise<UpgradeStatus>;
 upgradeSuite:(expectedVersion:string,signal?:AbortSignal)=>Promise<UpgradeResult>;
}

/** Agent-facing recorder for the environment/infrastructure facts the lead learns during work
 * (servers and how to reach them, local CLI tools, paths, project conventions). It appends a structured
 * entry to the same profile file the environment-notes card edits, so the lead does not have to edit the
 * card and the fact survives restarts. Non-secret facts only: passwords/keys/tokens must be stored in the
 * credential store by the user and referenced here by name (e.g. $NAS_PASSWORD), never written inline. */
export interface EnvironmentToolOwner {
 remember:(kind:string,name:string,detail:string)=>Promise<{saved:boolean;code:string|null;bytes:number}>;
}

export function registerEnvironmentTool(ctx:Context,owner:EnvironmentToolOwner):void{
 ctx.tools.register(defineTool({
  name:'remember_environment',
  description:'Record an environment/infrastructure fact you learned during the task so later sessions know it. Use it when the user reveals: servers (hostname/IP), how to connect (SSH alias/command, key path, passwordless), local CLI tools, common paths, or project conventions. Record only the NON-secret part; never write passwords, private keys or tokens inline — store the secret with the credential store and reference it by name here (e.g. $NAS_PASSWORD). Each call appends one structured entry to the profile environment-notes file (outside git); it applies from the next step.',
  parameters:{
   kind:{type:'string',enum:['server','cli','path','convention'],required:true,description:'Fact class: server (a machine and how to reach it), cli (a local command/tool), path (an important path), convention (a working rule/preference).'},
   name:{type:'string',required:true,description:'Short identifier, e.g. the server alias or tool name ("nas", "pnpm").'},
   detail:{type:'string',required:true,description:'The non-secret facts: hostname/IP, ssh alias or command, key path or passwordless note, usage, caveats. Reference credentials by name, never inline secret values.'},
  },
  output:{schema:{type:'object',additionalProperties:false,properties:{saved:{type:'boolean',required:true},code:{type:'string'},bytes:{type:'number',required:true}}},render:(_a,v)=>[{type:'text',text:JSON.stringify(v)}]},
  timeoutMs:30000,
  isConcurrencySafe:()=>false,
  execute:async(args,_exec)=>{
   const kind=String(args.kind),name=String(args.name).trim(),detail=String(args.detail).trim();
   if(!name)throw new Error('remember_environment requires a non-empty name');
   if(!detail)throw new Error('remember_environment requires a non-empty detail');
   const result=await owner.remember(kind,name,detail);
   return result.code===null ? {saved:result.saved,bytes:result.bytes} : {saved:result.saved,code:result.code,bytes:result.bytes};
  },
 }));
}

export function registerComponentTool(ctx:Context,owner:ComponentToolOwner):void{
 ctx.tools.register(defineTool({
  name:'suite_component',
  description:'Omnisurge Suite module inventory for the declared module set an installed Suite release carries. status is read-only: every declared module id with its display name, the Suite version that carries it, the version the running module advertises for itself, the Suite-owned row state, the one remaining user action and the latest boot-recovery receipt. There is no per-module install, upgrade or deselection: a declared module ships inside the Suite package, so installing or upgrading the Suite is what delivers it, and the previous bytes stay loaded until the application restarts.',
  parameters:{
   action:{type:'string',enum:['status'],required:true,description:'status reads official inventory and every declared module status without any write.'},
  },
  output:{schema:{type:'object',additionalProperties:false,properties:{action:{type:'string',enum:['status'],required:true},result:{type:'json',required:true}}},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]},
  timeoutMs:180000,
  isConcurrencySafe:()=>true,
  execute:async(args,_exec)=>{
   if(Object.keys(args).some(key=>key!=='action'))throw new Error('suite_component accepts only the action argument');
   if(args.action!=='status')throw new Error('suite_component supports only status: a declared module is part of the Suite and is never installed separately');
   return {action:'status' as const,result:JSON.parse(JSON.stringify(await owner.componentsStatus()))};
  },
 }));
}

export function registerUpgradeTool(ctx:Context,owner:UpgradeToolOwner):void{
 ctx.tools.register(defineTool({
  name:'suite_upgrade',
  description:'Omnisurge Suite self-upgrade: status is read-only and lists the configured release directory, the newest verified candidate (Suite version, SHA256, and every component archive it carries) and why other candidate directories were refused. upgrade installs that candidate in one authorized batch: each declared component goes through the same canonical preparation the page uses, then the Suite package itself is replaced by the official package transaction. Every candidate is verified against its own SHA256SUMS, the fixed component manifest inside the archive and the running runtime peer pins; a downgrade, an unlisted archive, a foreign package or a differently pinned runtime is refused. The replaced packages load only in a new process, so a completed batch reports SUITE_UPGRADE_RESTART_REQUIRED instead of readiness, and upgrade requires the exact target version reported by status.',
  parameters:{
   action:{type:'string',enum:['status','upgrade'],required:true,description:'status verifies candidates without any write; upgrade installs the reported candidate version and every component it carries.'},
   expectedVersion:{type:'string',description:'Required for upgrade: the exact target Suite version shown by status. A missing or different value is refused without any write.'},
  },
  output:{schema:{type:'object',additionalProperties:false,properties:{action:{type:'string',enum:['status','upgrade'],required:true},result:{type:'json',required:true}}},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]},
  timeoutMs:300000,
  isConcurrencySafe:args=>args.action==='status',
  execute:async(args,exec)=>{
   if(Object.keys(args).some(key=>!['action','expectedVersion'].includes(key)))throw new Error('suite_upgrade accepts action and expectedVersion only; no path, URL, package spec or restart argument');
   if(args.action==='status'){
    if(args.expectedVersion!==undefined)throw new Error('suite_upgrade status accepts no expectedVersion argument');
    return {action:args.action,result:JSON.parse(JSON.stringify(await owner.upgradeStatus()))};
   }
   const consent=args.expectedVersion;
   if(typeof consent!=='string'||!consent)throw new Error('suite_upgrade upgrade requires expectedVersion consent; read the target version from status first');
   return {action:args.action,result:JSON.parse(JSON.stringify(await owner.upgradeSuite(consent,exec.signal)))};
  },
 }));
}
/** ADR-036 D1/D3: the agent sees the provider list and its usage, asks one provider to recognize, can ask
 * for a crop to look at itself. Nothing here rewrites a reading. */
export interface OcrToolOwner{
 capabilities:()=>Promise<unknown>;
 recognize:(input:{path?:string;attachment?:OcrImageAttachment;mode:'accurate'|'handwriting'|'both';provider?:string;page?:number;pages?:string;reconcile?:boolean})=>Promise<unknown>;
 render:(input:{path:string;page:number;box?:{x0:number;y0:number;x1:number;y1:number};dpi?:number;polygon?:{x:number;y:number}[];sourceDpi?:number})=>Promise<{path:string;width:number;height:number;dpi:number;box:{x0:number;y0:number;x1:number;y1:number}|null}>;
}
export function registerOcrTool(ctx:Context,owner:OcrToolOwner):void{
 ctx.tools.register(defineTool({
  name:'ocr_recognize',
  description:'Handwriting and document recognition (ADR-036). capabilities: supplier, configured flag, page budget, local usage. recognize: ONE image or PDF page range; returns every channel\'s lines and, with reconcile=true, where the channels disagree. If the image is already in the conversation, pass its durable attachment reference instead of uploading a second copy. render: saves a page or a crop as a PNG and returns its path. Pass box in PDF points, or pass polygon (the corners a recognize returned) and the dpi it reported and the crop converts them for you. Look at the image yourself when readings disagree.',
  parameters:{
   action:{type:'string',enum:['capabilities','recognize','render'],required:true,description:'capabilities is read-only; recognize spends one supplier call per page and channel; render saves a crop.'},
   path:{type:'string',description:'Absolute path to a PNG/JPEG image or a PDF. Required for recognize and render unless attachment is supplied.'},
   attachment:{type:'object',additionalProperties:false,properties:{attachmentId:{type:'string',required:true},mediaType:{type:'string',required:true},bytes:{type:'number',required:true},width:{type:'number',required:true},height:{type:'number',required:true},name:{type:'string'}},description:'Durable image attachment reference from the conversation. Use this instead of path for a screenshot/image the user already sent; do not upload a second copy.'},
   mode:{type:'string',enum:['accurate','handwriting','both'],description:'accurate is the general high-precision channel, handwriting the dedicated one, both runs the two in order. Default accurate.'},
   provider:{type:'string',description:'Supplier id from capabilities. Defaults to the supplier selected in settings.'},
   page:{type:'number',description:'Single 1-based page. Required for render.'},
   pages:{type:'string',description:'Page range such as 1-10,12. Takes precedence over page.'},
   reconcile:{type:'boolean',description:'Align the two channels line by line and report disagreements instead of one merged text.'},
   box:{type:'string',description:'Crop box in PDF points, "x0,y0,x1,y1". Omit to render the whole page.'},
   polygon:{type:'string',description:'Corners a recognize returned for a line, as "x,y;x,y;x,y;x,y", in the dpi that result reported. The crop converts them to points for you; do not convert them yourself.'},
   sourceDpi:{type:'number',description:'The dpi the polygon was measured in (recognize reports it). Default 300.'},
   dpi:{type:'number',description:'Render resolution for render. Default 300.'},
  },
  output:{schema:{type:'object',additionalProperties:false,properties:{action:{type:'string',enum:['capabilities','recognize','render'],required:true},result:{type:'json',required:true}}},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]},
  timeoutMs:300000,
  isConcurrencySafe:args=>args.action==='capabilities',
  execute:async(args,exec)=>{
   if(args.action==='capabilities')return {action:'capabilities' as const,result:JSON.parse(JSON.stringify(await owner.capabilities()))};
   if(args.action==='render'&&args.attachment!==undefined)throw new Error('ocr_recognize render works on files and PDF pages, not on conversation image attachments');
   if(args.attachment===undefined&&(typeof args.path!=='string'||args.path.length===0))throw new Error('ocr_recognize '+args.action+' requires path or attachment');
   if(args.action==='render'){
    if(typeof args.page!=='number')throw new Error('ocr_recognize render requires page');
    const box=typeof args.box==='string'?(()=>{const parts=args.box.split(',').map(value=>Number(value.trim()));if(parts.length!==4||parts.some(value=>!Number.isFinite(value)))throw new Error('ocr_recognize box must be "x0,y0,x1,y1"');return {x0:parts[0]!,y0:parts[1]!,x1:parts[2]!,y1:parts[3]!};})():undefined;
    const polygon=typeof args.polygon==='string'?(()=>{const points=args.polygon.split(';').map(pair=>{const parts=pair.split(',').map(value=>Number(value.trim()));if(parts.length!==2||parts.some(value=>!Number.isFinite(value)))throw new Error('ocr_recognize polygon must be "x,y;x,y;..."');return {x:parts[0]!,y:parts[1]!};});if(points.length<3)throw new Error('ocr_recognize polygon needs at least three corners');return points;})():undefined;
    return {action:'render' as const,result:await owner.render({path:args.path!,page:args.page,box,dpi:args.dpi,polygon,sourceDpi:args.sourceDpi})};
   }
   const mode=args.mode===undefined?'accurate':args.mode;
   const result=await owner.recognize({path:args.path,attachment:args.attachment as OcrImageAttachment|undefined,mode,provider:args.provider,page:args.page,pages:args.pages,reconcile:args.reconcile});
   return {action:'recognize' as const,result:JSON.parse(JSON.stringify(result))};
  },
 }));
}
