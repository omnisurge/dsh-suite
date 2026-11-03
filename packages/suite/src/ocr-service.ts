import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename,join} from 'node:path';
import {OcrRefusal} from './ocr-contract.js';
import {recognizeOnce,describeProviders} from './ocr-core.js';
import {DEFAULT_DPI,inspectSource,rasterizePage,renderRegion,parsePageRange,type RasterPage,type RasterSource} from './ocr-raster.js';
import {TencentOcr} from './ocr-tencent.js';
import {BaiduOcr} from './ocr-baidu.js';
import {readUsage,recordUsage} from './ocr-usage.js';
import {polygonToPoints,reconcileLines,type ReconciledLine} from './ocr-reconcile.js';
import type {OcrCapabilities,OcrChannel,OcrImageAttachment,OcrLine,OcrMode,OcrProvider,OcrProviderState} from './ocr-types.js';
export type {OcrCapabilities} from './ocr-types.js';

export interface CropBox{x0:number;y0:number;x1:number;y1:number;}
export interface OcrRecognizeResult{
 provider:string;pages:number[];
 dpi:number;
 channels:{channel:OcrChannel;lines:OcrLine[];ms:number}[];
 lines:OcrLine[];
 reconciled:ReconciledLine[];
 usageRecorded:boolean;
}
export interface OcrRenderResult{path:string;width:number;height:number;dpi:number;box:{x0:number;y0:number;x1:number;y1:number}|null;temporary:boolean;}

/** One provider's config view. The Host passes the complete config; tests may omit provider-specific keys
 * and still exercise the legacy single-provider path. */
export interface OcrConfigView{
 secretIdRef:string;
 secretKeyRef:string;
 baiduApiKeyRef?:string;
 baiduSecretKeyRef?:string;
 maxPages:number;
 provider?:string;
}
export interface OcrServiceDeps{
 config:()=>OcrConfigView;
 profileDirectory:()=>Promise<string|null>;
 resolveCredential?:(ref:string)=>Promise<string|undefined>;
 describeCredential?:(ref:string)=>Promise<{configured:boolean;writable:boolean}|undefined>;
 providers?:OcrProvider[];
 now?:()=>number;
 /** The user's switch, held by one owner (the profile state file); off refuses instead of spending quota. */
 readState?:()=>Promise<{enabled:boolean;provider?:string}>;
 /** The card's selected provider is saved in the same state file. */
 writeState?:(next:{enabled:boolean;provider?:string})=>Promise<void>;
 /** The agent tool reads a durable attachment through the official attachment service. */
 readAttachment?:(attachment:OcrImageAttachment)=>Promise<RasterPage>;
 /** Overridable seams so the service can be tested without a real PDF or a real supplier. */
 inspect?:(path:string)=>Promise<RasterSource>;
 rasterize?:(source:RasterSource,page:number,budget:{maxPages:number})=>Promise<RasterPage>;
 render?:(source:RasterSource,page:number,box:CropBox|undefined,dpi?:number)=>Promise<{bytes:Uint8Array;width:number;height:number}>;
}
export interface OcrService{
 capabilities():Promise<OcrCapabilities>;
 recognize(input:{path?:string;attachment?:OcrImageAttachment;mode:OcrMode;provider?:string;page?:number;pages?:string;reconcile?:boolean}):Promise<OcrRecognizeResult>;
 render(input:{path:string;page:number;box?:CropBox;dpi?:number;polygon?:{x:number;y:number}[];sourceDpi?:number;outputDirectory?:string}):Promise<OcrRenderResult>;
}

export function createOcrService(deps:OcrServiceDeps):OcrService{
 const providers=deps.providers??[new TencentOcr(),new BaiduOcr()];
 const root=async():Promise<string|null>=>{
  const profile=await deps.profileDirectory();
  return typeof profile==='string'&&profile.length>0?join(profile,'omnisurge','ocr'):null;
 };
 const ledgerPath=async():Promise<string|null>=>{const directory=await root();return directory===null?null:join(directory,'usage.json');};
 const inspect=deps.inspect??inspectSource;
 const rasterize=deps.rasterize??((source:RasterSource,page:number,budget:{maxPages:number})=>rasterizePage(source,page,{maxPages:budget.maxPages}));
 const refsFor=(id:string,config:OcrConfigView):Record<string,string>=>{
  if(id==='baidu')return {apiKey:config.baiduApiKeyRef??'',secretKey:config.baiduSecretKeyRef??''};
  return {secretId:config.secretIdRef,secretKey:config.secretKeyRef};
 };
 const selectedProvider=(config:OcrConfigView,state:{enabled:boolean;provider?:string}):string=>{
  const wanted=state.provider??config.provider;
  return providers.some(provider=>provider.descriptor.id===wanted)?String(wanted):(providers[0]?.descriptor.id??'tencent');
 };
 const stateFor=async(provider:OcrProvider,config:OcrConfigView,path:string|null):Promise<OcrProviderState>=>{
  const refs=refsFor(provider.descriptor.id,config);
  let credentials:Record<string,{configured:boolean;writable:boolean}>|null=null;
  if(deps.describeCredential!==undefined){
   credentials={};
   for(const [role,ref] of Object.entries(refs)){
    const info=await deps.describeCredential(ref);
    credentials[role]=info??{configured:false,writable:false};
   }
  }
  const configured=credentials===null?Object.values(refs).every(value=>value.length>0):Object.values(credentials).every(info=>info.configured);
  return {id:provider.descriptor.id,refs,configured,credentials,usage:path===null?null:(await readUsage(path)).providers[provider.descriptor.id]??null};
 };
 return {
  async capabilities(){
   const config=deps.config();
   const path=await ledgerPath();
   const state=await (deps.readState??(async()=>({enabled:false})))();
   const providerStates:Record<string,OcrProviderState>={};
   for(const provider of providers)providerStates[provider.descriptor.id]=await stateFor(provider,config,path);
   const selected=selectedProvider(config,state);
   const chosen=providerStates[selected];
   const firstRole=(roles:Record<string,string>,name:string):string=>roles[name]??'';
   const legacyCredentials=chosen?.credentials===null||chosen===undefined?null:{
    secretId:chosen.credentials.secretId??chosen.credentials.apiKey??{configured:false,writable:false},
    secretKey:chosen.credentials.secretKey??{configured:false,writable:false},
   };
   return {
    providers:describeProviders(providers),
    providerStates,
    selectedProvider:selected,
    enabled:state.enabled,
    refs:{secretId:firstRole(chosen?.refs??{},'secretId')||firstRole(chosen?.refs??{},'apiKey'),secretKey:firstRole(chosen?.refs??{},'secretKey')},
    provider:selected,
    configured:chosen?.configured??false,
    maxPages:config.maxPages,
    usage:chosen?.usage??null,
    credentials:legacyCredentials,
   };
  },
  async recognize(input){
   const config=deps.config();
   const state=await (deps.readState??(async()=>({enabled:false})))();
   if(!state.enabled)throw new OcrRefusal('OCR_DISABLED','this capability is switched off in settings; turn it on before recognizing');
   const selected=input.provider??selectedProvider(config,state);
   const refs=refsFor(selected,config);
   if(Object.values(refs).some(value=>value.length===0)){
    throw new OcrRefusal('OCR_CREDENTIAL_MISSING','no credential reference is configured for the selected OCR supplier');
   }
   let source:RasterSource|null=null;
   let pages:number[];
   let attachmentPage:RasterPage|null=null;
   if(input.attachment!==undefined){
    if(deps.readAttachment===undefined)throw new OcrRefusal('OCR_IMAGE_UNSUPPORTED','this Host cannot read conversation image attachments');
    attachmentPage=await deps.readAttachment(input.attachment);
    pages=[1];
   }else{
    if(typeof input.path!=='string'||input.path.length===0)throw new OcrRefusal('PDF_UNREADABLE','recognize requires a file path or a conversation image attachment');
    source=await inspect(input.path);
    pages=input.pages!==undefined?parsePageRange(input.pages,source.pages):
     (input.page!==undefined?[input.page]:(source.kind==='image'?[1]:Array.from({length:source.pages},(_,index)=>index+1)));
   }
   if(pages.length>config.maxPages)throw new OcrRefusal('PDF_PAGE_BUDGET_EXCEEDED','this request asks for '+pages.length+' pages, the budget is '+config.maxPages+'; narrow pages (for example 1-20) or raise maxPages');
   const path=await ledgerPath();
   const aggregated:Map<OcrChannel,{channel:OcrChannel;lines:OcrLine[];ms:number}>=new Map();
   const reconciled:ReconciledLine[]=[];
   let usageRecorded=false;
   for(const page of pages){
    const raster=attachmentPage??await rasterize(source!,page,{maxPages:config.maxPages});
    const result=await recognizeOnce({
     providers:()=>providers,
     resolveCredential:deps.resolveCredential,
     recordUsage:path===null?undefined:async entry=>{await recordUsage(path,entry);usageRecorded=true;},
     now:deps.now,
    },{provider:selected,mode:input.mode,page:raster,refs});
    for(const channel of result.channels){
     const previous=aggregated.get(channel.channel);
     aggregated.set(channel.channel,{channel:channel.channel,lines:[...(previous?.lines??[]),...channel.lines],ms:(previous?.ms??0)+channel.ms});
    }
    if(input.reconcile===true)reconciled.push(...reconcileLines(page,result.channels));
   }
   const collected=[...aggregated.values()];
   return {provider:selected,pages,dpi:DEFAULT_DPI,channels:collected,lines:collected.flatMap(channel=>channel.lines),reconciled,usageRecorded};
  },
  async render(input){
   const source=await inspect(input.path);
   const temporary=input.outputDirectory===undefined;
   const directory=temporary?await mkdtemp(join(tmpdir(),'omnisurge-ocr-crop-')):String(input.outputDirectory);
   await mkdir(directory,{recursive:true,mode:0o700});
   const box=input.box??(Array.isArray(input.polygon)&&input.polygon.length>=3?polygonToPoints(input.polygon,input.sourceDpi??DEFAULT_DPI):undefined);
   const rendered=await (deps.render??((current:RasterSource,page:number,box:CropBox|undefined,dpi?:number)=>renderRegion(current,page,box,{dpi})))(source,input.page,box,input.dpi);
   const target=join(directory,basename(input.path).replace(/[^A-Za-z0-9._-]/g,'_')+'-p'+input.page+'-'+Date.now()+'.png');
   await writeFile(target,Buffer.from(rendered.bytes),{mode:0o600});
   return {path:target,width:rendered.width,height:rendered.height,dpi:input.dpi??DEFAULT_DPI,box:box??null,temporary};
  },
 };
}
