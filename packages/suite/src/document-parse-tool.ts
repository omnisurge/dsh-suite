import type {Context} from '@deepseek-ai/cordis';
import {defineTool} from '@deepseek-ai/dsh-tools';
import {DocumentParseRefusal} from './document-parse-types.js';
import type {DocumentParseOptions,DocumentParseService} from './document-parse-types.js';

export interface DocumentParseToolOwner {
 capabilities:()=>Promise<unknown>;
 parse:(input:{path?:string;url?:string;provider?:string;mode?:string;options?:DocumentParseOptions})=>Promise<unknown>;
}

/** Agent-facing entry for document parsing. A provider/quota failure is returned as a machine-readable
 * alternative list, never as a silent provider switch. */
export function registerDocumentParseTool(ctx:Context,owner:DocumentParseToolOwner):void{
 ctx.tools.register(defineTool({
  name:'document_parse',
  description:'Parse a PDF or image document into Markdown, JSON or artifacts (ADR-086). capabilities: list providers, modes, credential state and local usage. parse: choose provider and mode explicitly when more than one combination is available; the service auto-selects only a unique available combination and returns DOCUMENT_PARSE_SELECTION_REQUIRED otherwise. MinerU modes: mineru-agent (public token-free queue, may wait) and mineru-api (API key; prefer this when a key is configured). PaddleOCR modes: paddleocr-vl-1.6-async, paddleocr-pp-ocrv6-async and paddleocr-pp-structurev3-async (token). If a provider reports quota/rate exhaustion, use alternatives and retry explicitly; this tool never switches providers itself.',
  parameters:{
   action:{type:'string',enum:['capabilities','parse'],required:true,description:'capabilities is read-only; parse spends one provider task.'},
   path:{type:'string',description:'Absolute local PDF/image path for parse.'},
   url:{type:'string',description:'Remote PDF/image URL for parse.'},
   provider:{type:'string',description:'Provider id from capabilities: mineru or paddleocr.'},
   mode:{type:'string',description:'Mode id from capabilities, for example mineru-agent or paddleocr-vl-1.6-async.'},
   options:{type:'object',additionalProperties:true,description:'Provider-specific options. MinerU: modelVersion, language, pageRange, isOcr, enableTable, enableFormula. PaddleOCR: useDocOrientationClassify, useDocUnwarping, useChartRecognition.'},
  },
  output:{schema:{type:'object',additionalProperties:true,properties:{action:{type:'string',required:true},result:{type:'json'},error:{type:'json'}}},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]},
  timeoutMs:600000,
  isConcurrencySafe:args=>args.action==='capabilities',
  execute:async(args)=>{
   if(args.action==='capabilities')return {action:'capabilities' as const,result:JSON.parse(JSON.stringify(await owner.capabilities()))} as any;
   try {
    if((typeof args.path!=='string'||args.path.length===0)&&(typeof args.url!=='string'||args.url.length===0))throw new DocumentParseRefusal('DOCUMENT_PARSE_INPUT_REQUIRED','document_parse parse requires path or url');
    return {action:'parse' as const,result:JSON.parse(JSON.stringify(await owner.parse({path:args.path,url:args.url,provider:args.provider,mode:args.mode,options:args.options})))} as any;
   } catch(error) {
    if(error instanceof DocumentParseRefusal) return {action:'parse' as const,error:{code:error.code,message:error.message,provider:error.detail.provider??args.provider,mode:error.detail.mode??args.mode,alternatives:error.detail.alternatives??[],retryAfter:error.detail.retryAfter??null}} as any;
    throw error;
   }
  },
 }));
}
