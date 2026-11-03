import {OcrRefusal,channelsFor,validateRequest} from './ocr-contract.js';
import type {OcrChannel,OcrImage,OcrLine,OcrMode,OcrProvider,OcrProviderDescriptor} from './ocr-types.js';
import type {RasterPage} from './ocr-raster.js';
import type {UsageEntry,UsageLedger} from './ocr-usage.js';

export interface OcrCoreDeps{
 providers:()=>OcrProvider[];
 resolveCredential?:(ref:string)=>Promise<string|undefined>;
 recordUsage?:(entry:UsageEntry)=>Promise<UsageLedger|void>;
 now?:()=>number;
}

export interface OcrChannelResult{channel:OcrChannel;lines:OcrLine[];requestId:string|null;ms:number;}
export interface OcrRunResult{provider:string;channels:OcrChannelResult[];lines:OcrLine[];usageRecorded:boolean;}

export function findProvider(providers:OcrProvider[],id:string):OcrProvider|null{
 return providers.find(provider=>provider.descriptor.id===id)??null;
}

export function describeProviders(providers:OcrProvider[]):OcrProviderDescriptor[]{
 return providers.map(provider=>provider.descriptor);
}

/** Runs the requested channels of ONE provider. There is no cross-provider fallback: a failing channel fails
 * the run with its own code (ADR-036 D3), because substituting another source would fake agreement. */
export async function recognizeOnce(deps:OcrCoreDeps,input:{provider:string;mode:OcrMode;page:RasterPage;refs:Record<string,string>}):Promise<OcrRunResult>{
 const providers=deps.providers();
 const provider=findProvider(providers,input.provider);
 const image:OcrImage={bytes:input.page.bytes,mediaType:input.page.mediaType};
 validateRequest(provider,{mode:input.mode,image});
 const resolved:Record<string,string>={};
 for(const [key,ref] of Object.entries(input.refs)){
  const value=await deps.resolveCredential?.(ref);
  if(typeof value!=='string'||value.length===0)throw new OcrRefusal('OCR_CREDENTIAL_MISSING','credential reference "'+ref+'" did not resolve');
  resolved[key]=value;
 }
 const now=deps.now??(()=>Date.now());
 const results:OcrChannelResult[]=[];
 let usageRecorded=false;
 for(const channel of channelsFor(input.mode)){
  const outcome=await provider!.recognize({channel,image:input.page,credentials:resolved});
  results.push({channel,lines:outcome.lines,requestId:outcome.requestId,ms:outcome.ms});
  if(deps.recordUsage!==undefined){
   await deps.recordUsage({at:new Date(now()).toISOString(),provider:provider!.descriptor.id,channel,pages:1,lines:outcome.lines.length,ms:outcome.ms});
   usageRecorded=true;
  }
 }
 return {provider:provider!.descriptor.id,channels:results,lines:results.flatMap(result=>result.lines),usageRecorded};
}
