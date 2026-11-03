import {mkdir,readFile,rename,writeFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import type {OcrChannel} from './ocr-types.js';

/** Local usage ledger. The provider's own quota API is not assumed to exist (spec 2): this file is the only
 * place the Suite counts what it spent, so the page must say so instead of implying a provider figure. */
export interface UsageEntry{at:string;provider:string;channel:OcrChannel;pages:number;lines:number;ms:number;}
export interface ProviderUsage{calls:number;pages:number;lines:number;lastAt:string|null;entries:UsageEntry[];}
export interface UsageLedger{protocol:1;providers:Record<string,ProviderUsage>;}
const MAX_ENTRIES=200;
const empty=():UsageLedger=>({protocol:1,providers:{}});

export async function readUsage(path:string):Promise<UsageLedger>{
 try{
  const parsed=JSON.parse(await readFile(path,'utf8')) as Partial<UsageLedger>;
  if(parsed===null||typeof parsed!=='object'||parsed.protocol!==1||typeof parsed.providers!=='object'||parsed.providers===null)return empty();
  return {protocol:1,providers:parsed.providers as Record<string,ProviderUsage>};
 }catch{return empty();}
}

export async function recordUsage(path:string,entry:UsageEntry):Promise<UsageLedger>{
 const ledger=await readUsage(path);
 const previous=ledger.providers[entry.provider]??{calls:0,pages:0,lines:0,lastAt:null,entries:[]};
 const next:ProviderUsage={
  calls:previous.calls+1,
  pages:previous.pages+entry.pages,
  lines:previous.lines+entry.lines,
  lastAt:entry.at,
  entries:[...previous.entries,entry].slice(-MAX_ENTRIES),
 };
 const updated:UsageLedger={protocol:1,providers:{...ledger.providers,[entry.provider]:next}};
 await mkdir(dirname(path),{recursive:true,mode:0o700});
 const pending=join(dirname(path),'.usage-'+randomUUID()+'.pending');
 await writeFile(pending,JSON.stringify(updated,null,2)+'\n',{mode:0o600});
 await rename(pending,path);
 return updated;
}
