import {OcrRefusal} from './ocr-contract.js';
import type {OcrChannel,OcrImage,OcrLine,OcrProvider,OcrProviderDescriptor,OcrRefusalCode} from './ocr-types.js';

/** Baidu Intelligent Cloud OCR over the public `rest/2.0/ocr/v1` endpoints. The bearer form is the
 * API-key credential pair Baidu documents for server-side calls; no OAuth token is cached here because the
 * bearer credential is already the long-lived secret pair. Provider-private parameters stay inside this file
 * (ADR-036 D2). */
export const BAIDU_HOST='aip.baidubce.com';
const ENDPOINTS:Record<OcrChannel,string>={accurate:'accurate',handwriting:'handwriting'};
const RETRYABLE=new Set([18,19]);
const AUTH_CODES=new Set([6,110,111]);
const RATE_CODES=new Set([17,18,19]);

export const BAIDU_DESCRIPTOR:OcrProviderDescriptor={
 id:'baidu',displayKey:'providerBaidu',channels:['accurate','handwriting'],inputs:['image','pdf'],
 returnsConfidence:true,returnsPolygon:true,maxBytes:4*1024*1024,
};

export function refusalForBaidu(code:number):OcrRefusalCode{
 if(AUTH_CODES.has(code))return 'OCR_CREDENTIAL_INVALID';
 if(RATE_CODES.has(code))return 'OCR_RATE_LIMITED';
 return 'OCR_UPSTREAM_ERROR';
}

interface BaiduWord{words?:unknown;probability?:{average?:unknown};location?:{left?:unknown;top?:unknown;width?:unknown;height?:unknown};}
interface BaiduEnvelope{words_result?:unknown;error_code?:unknown;error_msg?:unknown;log_id?:unknown;}

export function normalizeBaiduWords(raw:unknown):OcrLine[]{
 if(!Array.isArray(raw))return [];
 const lines:OcrLine[]=[];
 for(const entry of raw as BaiduWord[]){
  if(entry===null||typeof entry!=='object')continue;
  const text=entry.words;
  if(typeof text!=='string'||text.length===0)continue;
  const average=entry.probability?.average;
  const confidence=typeof average==='number'&&Number.isFinite(average)?Math.round(average*1000)/10:0;
  const location=entry.location;
  const polygon=location!==undefined
   &&typeof location.left==='number'&&typeof location.top==='number'&&typeof location.width==='number'&&typeof location.height==='number'
   ?[{x:location.left,y:location.top},{x:location.left+location.width,y:location.top},{x:location.left+location.width,y:location.top+location.height},{x:location.left,y:location.top+location.height}]
   :[];
  lines.push({text,confidence,polygon});
 }
 return lines;
}

export interface BaiduDeps{
 fetch?:(url:string,init:RequestInit)=>Promise<Response>;
 now?:()=>number;
 sleep?:(ms:number)=>Promise<void>;
 maxAttempts?:number;
 host?:string;
}

export class BaiduOcr implements OcrProvider{
 readonly descriptor=BAIDU_DESCRIPTOR;
 constructor(private readonly deps:BaiduDeps={}){}

 async recognize(request:{channel:OcrChannel;image:OcrImage;credentials:Record<string,string>}):Promise<{channel:OcrChannel;lines:OcrLine[];requestId:string|null;ms:number}>{
  const apiKey=request.credentials['apiKey'];
  const secretKey=request.credentials['secretKey'];
  if(typeof apiKey!=='string'||apiKey.length===0||typeof secretKey!=='string'||secretKey.length===0){
   throw new OcrRefusal('OCR_CREDENTIAL_MISSING','the baidu provider needs both credential references resolved');
  }
  const transport=this.deps.fetch??((url:string,init:RequestInit)=>fetch(url,init));
  const now=this.deps.now??(()=>Date.now());
  const sleep=this.deps.sleep??((ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms)));
  const attempts=Math.max(1,this.deps.maxAttempts??4);
  const body=new URLSearchParams({
   image:Buffer.from(request.image.bytes).toString('base64'),
   language_type:'CHN_ENG',
   detect_direction:'true',
   probability:'true',
  }).toString();
  const url='https://'+(this.deps.host??BAIDU_HOST)+'/rest/2.0/ocr/v1/'+ENDPOINTS[request.channel];
  let lastCode=0;
  for(let attempt=0;attempt<attempts;attempt+=1){
   const started=now();
   let envelope:BaiduEnvelope;
   try{
    const response=await transport(url,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded',authorization:'Bearer bce-v3/ALTAK-'+apiKey+'/'+secretKey},body});
    envelope=await response.json() as BaiduEnvelope;
   }catch(error){
    if(attempt+1<attempts){await sleep(250*2**attempt);continue;}
    throw new OcrRefusal('OCR_UPSTREAM_ERROR','the baidu endpoint could not be reached ('+(error as Error).message+')');
   }
   const code=typeof envelope.error_code==='number'?envelope.error_code:Number(envelope.error_code??0);
   if(Number.isFinite(code)&&code!==0){
    lastCode=code;
    if(RETRYABLE.has(code)&&attempt+1<attempts){await sleep(250*2**attempt);continue;}
    const detail=typeof envelope.error_msg==='string'?envelope.error_msg:'provider refusal';
    throw new OcrRefusal(refusalForBaidu(code),'baidu refused with '+code+': '+detail);
   }
   if(!Array.isArray(envelope.words_result))throw new OcrRefusal('OCR_UPSTREAM_ERROR','the provider answered without words_result (a shape we do not recognise)');
   const lines=normalizeBaiduWords(envelope.words_result);
   if(lines.length===0)throw new OcrRefusal('OCR_NO_TEXT','the provider returned no text lines');
   const requestId=typeof envelope.log_id==='string'?envelope.log_id:null;
   return {channel:request.channel,lines,requestId,ms:now()-started};
  }
  throw new OcrRefusal(refusalForBaidu(lastCode),'baidu failed after '+attempts+' attempts with '+lastCode);
 }
}
