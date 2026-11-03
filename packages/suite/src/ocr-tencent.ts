import {createHash,createHmac} from 'node:crypto';
import {OcrRefusal} from './ocr-contract.js';
import type {OcrChannel,OcrImage,OcrLine,OcrProvider,OcrProviderDescriptor,OcrRefusalCode} from './ocr-types.js';

/** Tencent Cloud OCR over the official JSON API (TC3-HMAC-SHA256). The private switches ADR-036 D2 keeps
 * out of the public contract (WordsType, EnableDetectSplit) are never sent: the recorded measurement shows
 * they make handwriting recognition worse, so they do not exist here at all. */
export const TENCENT_HOST='ocr.tencentcloudapi.com';
export const TENCENT_VERSION='2018-11-19';
export const TENCENT_REGION='ap-shanghai';
const SERVICE='ocr';
const ACTIONS:Record<OcrChannel,string>={accurate:'GeneralAccurateOCR',handwriting:'GeneralHandwritingOCR'};
const RETRYABLE=new Set(['RequestLimitExceeded','LimitExceeded','InternalError']);

export const TENCENT_DESCRIPTOR:OcrProviderDescriptor={
 id:'tencent',displayKey:'providerTencent',channels:['accurate','handwriting'],inputs:['image','pdf'],
 returnsConfidence:true,returnsPolygon:true,maxBytes:5*1024*1024,
};

const sha256Hex=(value:string):string=>createHash('sha256').update(value,'utf8').digest('hex');
const hmac=(key:Buffer|string,value:string):Buffer=>createHmac('sha256',key).update(value,'utf8').digest();

export interface TencentSignedRequest{headers:Record<string,string>;body:string;}

/** The canonical request, string-to-sign and Authorization header of TC3. Exported because the signature is
 * the one part a fake transport cannot prove: the test pins it against an independent implementation. */
export function signTencent(input:{secretId:string;secretKey:string;action:string;payload:string;timestamp:number;host?:string}):TencentSignedRequest{
 const host=input.host??TENCENT_HOST;
 const date=new Date(input.timestamp*1000).toISOString().slice(0,10);
 const canonicalHeaders='content-type:application/json; charset=utf-8\nhost:'+host+'\n';
 const signedHeaders='content-type;host';
 const canonicalRequest=['POST','/','',canonicalHeaders,signedHeaders,sha256Hex(input.payload)].join('\n');
 const scope=date+'/'+SERVICE+'/tc3_request';
 const stringToSign=['TC3-HMAC-SHA256',String(input.timestamp),scope,sha256Hex(canonicalRequest)].join('\n');
 const signing=hmac(hmac(hmac('TC3'+input.secretKey,date),SERVICE),'tc3_request');
 const signature=createHmac('sha256',signing).update(stringToSign,'utf8').digest('hex');
 return {
  body:input.payload,
  headers:{
   'authorization':'TC3-HMAC-SHA256 Credential='+input.secretId+'/'+scope+', SignedHeaders='+signedHeaders+', Signature='+signature,
   'content-type':'application/json; charset=utf-8',
   'host':host,
   'x-tc-action':input.action,
   'x-tc-version':TENCENT_VERSION,
   'x-tc-region':TENCENT_REGION,
   'x-tc-timestamp':String(input.timestamp),
  },
 };
}

export function refusalFor(code:string):OcrRefusalCode{
 if(code.startsWith('AuthFailure'))return 'OCR_CREDENTIAL_INVALID';
 if(code==='RequestLimitExceeded'||code==='LimitExceeded')return 'OCR_RATE_LIMITED';
 if(code==='FailedOperation.ImageNoText')return 'OCR_NO_TEXT';
 if(code==='FailedOperation.OcrFailed')return 'OCR_UPSTREAM_ERROR';
 return 'OCR_UPSTREAM_ERROR';
}

interface Detection{DetectedText?:unknown;Confidence?:unknown;Polygon?:unknown;}
interface Envelope{Response?:{TextDetections?:unknown;RequestId?:unknown;Error?:{Code?:unknown;Message?:unknown;};};}

export function normalizeDetections(raw:unknown):OcrLine[]{
 if(!Array.isArray(raw))return [];
 const lines:OcrLine[]=[];
 for(const entry of raw as Detection[]){
  if(entry===null||typeof entry!=='object')continue;
  const text=entry.DetectedText;
  if(typeof text!=='string'||text.length===0)continue;
  const confidence=typeof entry.Confidence==='number'&&Number.isFinite(entry.Confidence)?entry.Confidence:0;
  const polygon=Array.isArray(entry.Polygon)
   ?(entry.Polygon as {X?:unknown;Y?:unknown}[]).filter(point=>typeof point?.X==='number'&&typeof point?.Y==='number').map(point=>({x:Number(point.X),y:Number(point.Y)}))
   :[];
  lines.push({text,confidence,polygon});
 }
 return lines;
}

export interface TencentDeps{
 fetch?:(url:string,init:RequestInit)=>Promise<Response>;
 now?:()=>number;
 sleep?:(ms:number)=>Promise<void>;
 maxAttempts?:number;
 host?:string;
}

export class TencentOcr implements OcrProvider{
 readonly descriptor=TENCENT_DESCRIPTOR;
 constructor(private readonly deps:TencentDeps={}){}

 async recognize(request:{channel:OcrChannel;image:OcrImage;credentials:Record<string,string>}):Promise<{channel:OcrChannel;lines:OcrLine[];requestId:string|null;ms:number}>{
  const secretId=request.credentials['secretId'];
  const secretKey=request.credentials['secretKey'];
  if(typeof secretId!=='string'||secretId.length===0||typeof secretKey!=='string'||secretKey.length===0){
   throw new OcrRefusal('OCR_CREDENTIAL_MISSING','the tencent provider needs both credential references resolved');
  }
  const transport=this.deps.fetch??((url:string,init:RequestInit)=>fetch(url,init));
  const now=this.deps.now??(()=>Date.now());
  const sleep=this.deps.sleep??((ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms)));
  const attempts=Math.max(1,this.deps.maxAttempts??4);
  const payload=JSON.stringify({ImageBase64:Buffer.from(request.image.bytes).toString('base64')});
  const url='https://'+(this.deps.host??TENCENT_HOST)+'/';
  let lastCode='ResponseFailure';
  for(let attempt=0;attempt<attempts;attempt+=1){
   const started=now();
   const signed=signTencent({secretId,secretKey,action:ACTIONS[request.channel],payload,timestamp:Math.floor(now()/1000),host:this.deps.host});
   let envelope:Envelope;
   try{
    const response=await transport(url,{method:'POST',headers:signed.headers,body:signed.body});
    envelope=await response.json() as Envelope;
   }catch(error){
    lastCode='TransportFailure';
    if(attempt+1<attempts){await sleep(250*2**attempt);continue;}
    throw new OcrRefusal('OCR_UPSTREAM_ERROR','the tencent endpoint could not be reached ('+(error as Error).message+')');
   }
   const error=envelope.Response?.Error;
   const code=typeof error?.Code==='string'?error.Code:'';
   if(code.length===0){
    if(envelope.Response===undefined||envelope.Response===null)throw new OcrRefusal('OCR_UPSTREAM_ERROR','the provider answered without a Response envelope');
    if(envelope.Response.TextDetections===undefined)throw new OcrRefusal('OCR_UPSTREAM_ERROR','the provider answered without TextDetections (a shape we do not recognise)');
    const lines=normalizeDetections(envelope.Response.TextDetections);
    if(lines.length===0)throw new OcrRefusal('OCR_NO_TEXT','the provider returned no text lines');
    const requestId=typeof envelope.Response?.RequestId==='string'?envelope.Response.RequestId:null;
    return {channel:request.channel,lines,requestId,ms:now()-started};
   }
   lastCode=code;
   if(RETRYABLE.has(code)&&attempt+1<attempts){await sleep(250*2**attempt);continue;}
   throw new OcrRefusal(refusalFor(code),'tencent refused with '+code);
  }
  throw new OcrRefusal(refusalFor(lastCode),'tencent failed after '+attempts+' attempts with '+lastCode);
 }
}
