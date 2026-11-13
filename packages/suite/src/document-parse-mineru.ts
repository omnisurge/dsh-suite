import {readFile,stat} from 'node:fs/promises';
import {basename} from 'node:path';
import {inflateRawSync} from 'node:zlib';
import {DocumentParseRefusal, type DocumentParseModeDescriptor, type DocumentParseProvider, type DocumentParseProviderDescriptor, type DocumentParseProviderResult, type DocumentParseRequest} from './document-parse-types.js';

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
const AGENT_BASE = 'https://mineru.net/api/v1/agent';
const API_BASE = 'https://mineru.net/api/v4';
/** The public flash API uses the same source header as the official mineru-open-sdk. */
const FLASH_SOURCE = 'open-api-sdk-js';
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const MODE_AGENT: DocumentParseModeDescriptor = {
 id: 'mineru-agent', provider: 'mineru', displayKey: 'modeMineruAgent', auth: 'none', credentialRoles: [],
 transport: 'async', inputs: ['pdf', 'image', 'office', 'url'], outputs: ['markdown'], maxBytes: 10 * 1024 * 1024, maxPages: 20,
};
const MODE_API: DocumentParseModeDescriptor = {
 id: 'mineru-api', provider: 'mineru', displayKey: 'modeMineruApi', auth: 'credential', credentialRoles: ['apiKey'],
 transport: 'async', inputs: ['pdf', 'image', 'office', 'url'], outputs: ['markdown', 'json', 'zip'], maxBytes: 200 * 1024 * 1024, maxPages: 200,
};
export const MINERU_DESCRIPTOR: DocumentParseProviderDescriptor = {id: 'mineru', displayKey: 'providerMineru', modes: [MODE_AGENT, MODE_API]};

interface MineruOptions { modelVersion?: 'pipeline' | 'vlm' | 'MinerU-HTML'; language?: string; pageRange?: string; isOcr?: boolean; enableTable?: boolean; enableFormula?: boolean; timeoutMs?: number; }

const BUSINESS_ERRORS: Record<string, {code: string; retryAfter?: number}> = {
 'A0202': {code: 'DOCUMENT_PARSE_AUTH_FAILED'},
 'A0211': {code: 'DOCUMENT_PARSE_AUTH_FAILED'},
 '-30001': {code: 'DOCUMENT_PARSE_TOO_LARGE'},
 '-30002': {code: 'DOCUMENT_PARSE_UNSUPPORTED'},
 '-30003': {code: 'DOCUMENT_PARSE_TOO_MANY_PAGES'},
 '-30004': {code: 'DOCUMENT_PARSE_PROVIDER_ERROR'},
 '-60005': {code: 'DOCUMENT_PARSE_TOO_LARGE'},
 '-60006': {code: 'DOCUMENT_PARSE_TOO_MANY_PAGES'},
 '-60007': {code: 'DOCUMENT_PARSE_PROVIDER_ERROR', retryAfter: 300},
 '-60009': {code: 'DOCUMENT_PARSE_PROVIDER_QUEUE_UNAVAILABLE', retryAfter: 300},
 '-60010': {code: 'DOCUMENT_PARSE_TASK_FAILED'},
 '-60011': {code: 'DOCUMENT_PARSE_UPLOAD_FAILED'},
 '-60018': {code: 'DOCUMENT_PARSE_QUOTA_EXHAUSTED', retryAfter: 86400},
 '-60019': {code: 'DOCUMENT_PARSE_QUOTA_EXHAUSTED', retryAfter: 86400},
};
const option = (request: DocumentParseRequest): MineruOptions => {
 const raw = request.options ?? {};
 const modelVersion = raw.modelVersion === 'vlm' || raw.modelVersion === 'MinerU-HTML' ? raw.modelVersion : 'pipeline';
 return {
  modelVersion,
  ...(typeof raw.language === 'string' ? {language: raw.language} : {}),
  ...(typeof raw.pageRange === 'string' ? {pageRange: raw.pageRange} : {}),
  ...(typeof raw.isOcr === 'boolean' ? {isOcr: raw.isOcr} : {}),
  ...(typeof raw.enableTable === 'boolean' ? {enableTable: raw.enableTable} : {}),
  ...(typeof raw.enableFormula === 'boolean' ? {enableFormula: raw.enableFormula} : {}),
  ...(typeof raw.timeoutMs === 'number' && Number.isFinite(raw.timeoutMs) && raw.timeoutMs > 0 ? {timeoutMs: raw.timeoutMs} : {}),
 };
};

function throwFor(response: Response, payload: any): void {
 if (response.ok && (!payload || payload.code === undefined || payload.code === 0 || payload.code === '0')) return;
 const status = response.status;
 const business = payload?.code === undefined ? undefined : BUSINESS_ERRORS[String(payload.code)];
 const code = business?.code ?? (status === 401 || status === 403 ? 'DOCUMENT_PARSE_AUTH_FAILED' : status === 429 ? 'DOCUMENT_PARSE_RATE_LIMITED' : 'DOCUMENT_PARSE_PROVIDER_ERROR');
 const retryAfter = business?.retryAfter ?? (status === 429 ? 60 : null);
 throw new DocumentParseRefusal(code, 'MinerU refused with HTTP ' + status + (payload?.msg ? ': ' + String(payload.msg) : ''), retryAfter === null ? undefined : {retryAfter});
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
 let timer: ReturnType<typeof setTimeout> | undefined;
 try { return await Promise.race([promise, new Promise<T>((_resolve, reject) => { timer = setTimeout(() => reject(new DocumentParseRefusal('DOCUMENT_PARSE_TIMEOUT', 'MinerU request timed out')), timeoutMs); })]);}
 finally { if (timer !== undefined) clearTimeout(timer); }
}

async function json(fetcher: FetchLike, url: string, init: RequestInit, timeoutMs = 300000): Promise<any> {
 const response = await withTimeout(fetcher(url, init), timeoutMs);
 let payload: any = null;
 try { payload = await withTimeout(response.json(), timeoutMs); } catch (error) { if (error instanceof DocumentParseRefusal) throw error; payload = null; }
 throwFor(response, payload);
 return payload;
}

async function putBytes(fetcher: FetchLike, url: string, bytes: Uint8Array, timeoutMs = 300000): Promise<void> {
 const response = await withTimeout(fetcher(url, {method: 'PUT', body: bytes as unknown as BodyInit}), timeoutMs);
 if (!response.ok) throw new DocumentParseRefusal('DOCUMENT_PARSE_UPLOAD_FAILED', 'MinerU file upload failed with HTTP ' + response.status);
}

async function downloadText(fetcher: FetchLike, url: string, timeoutMs: number): Promise<string> {
 const response = await withTimeout(fetcher(url), timeoutMs);
 if (!response.ok) throw new DocumentParseRefusal('DOCUMENT_PARSE_RESULT_DOWNLOAD_FAILED', 'MinerU markdown download failed');
 return withTimeout(response.text(), timeoutMs);
}

/** A result ZIP can contain the source PDF; cap what we pull into memory. */
const MAX_RESULT_ZIP_BYTES = 64 * 1024 * 1024;
const MAX_MARKDOWN_BYTES = 8 * 1024 * 1024;

interface ZipEntry {name:string;method:number;compressedSize:number;uncompressedSize:number;localOffset:number;}

function zipEntries(bytes:Uint8Array): ZipEntry[] {
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 const len=bytes.byteLength;
 if(len<22)throw new Error('ZIP is too short');
 let eocd=-1;
 const lower=Math.max(0,len-22-0xffff);
 for(let at=len-22;at>=lower;at-=1){
  if(view.getUint32(at,true)===0x06054b50){eocd=at;break;}
 }
 if(eocd<0)throw new Error('ZIP end-of-central-directory not found');
 const count=view.getUint16(eocd+10,true);
 const cdSize=view.getUint32(eocd+12,true);
 const cdOffset=view.getUint32(eocd+16,true);
 if(count===0xffff||cdOffset===0xffffffff||cdSize===0xffffffff)throw new Error('ZIP64 is not supported');
 if(cdOffset+cdSize>len)throw new Error('ZIP central directory is out of bounds');
 const entries:ZipEntry[]=[];
 let offset=cdOffset;
 for(let index=0;index<count;index+=1){
  if(offset+46>len||view.getUint32(offset,true)!==0x02014b50)throw new Error('ZIP central directory entry is invalid');
  const method=view.getUint16(offset+10,true);
  const compressedSize=view.getUint32(offset+20,true);
  const uncompressedSize=view.getUint32(offset+24,true);
  const nameLength=view.getUint16(offset+28,true);
  const extraLength=view.getUint16(offset+30,true);
  const commentLength=view.getUint16(offset+32,true);
  const localOffset=view.getUint32(offset+42,true);
  if(offset+46+nameLength+extraLength+commentLength>len)throw new Error('ZIP entry name is out of bounds');
  const name=new TextDecoder().decode(bytes.subarray(offset+46,offset+46+nameLength));
  entries.push({name,method,compressedSize,uncompressedSize,localOffset});
  offset+=46+nameLength+extraLength+commentLength;
 }
 return entries;
}

function zipEntryBytes(bytes:Uint8Array,entry:ZipEntry): Uint8Array {
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 const local=entry.localOffset;
 if(local+30>bytes.byteLength||view.getUint32(local,true)!==0x04034b50)throw new Error('ZIP local entry is invalid');
 const nameLength=view.getUint16(local+26,true);
 const extraLength=view.getUint16(local+28,true);
 const start=local+30+nameLength+extraLength;
 const end=start+entry.compressedSize;
 if(start>bytes.byteLength||end>bytes.byteLength)throw new Error('ZIP entry data is out of bounds');
 const compressed=bytes.subarray(start,end);
 if(entry.method===0){
  if(compressed.byteLength>MAX_MARKDOWN_BYTES)throw new Error('ZIP entry exceeds the size limit');
  return compressed;
 }
 if(entry.method===8){
  const output=inflateRawSync(compressed,{maxOutputLength:MAX_MARKDOWN_BYTES});
  if(output.byteLength>MAX_MARKDOWN_BYTES)throw new Error('ZIP entry exceeds the size limit');
  return new Uint8Array(output);
 }
 throw new Error('ZIP compression method is not supported');
}

function zipText(bytes:Uint8Array,entries:ZipEntry[],matcher:(name:string)=>boolean): {name:string;text:string}|null {
 const entry=entries.find(candidate=>matcher(candidate.name));
 if(entry===undefined)return null;
 if(entry.uncompressedSize>MAX_MARKDOWN_BYTES)throw new Error('ZIP entry is too large');
 const text=new TextDecoder().decode(zipEntryBytes(bytes,entry));
 return {name:entry.name,text};
}

function zipPages(bytes:Uint8Array,entries:ZipEntry[]): {extracted:number;total:number}|null {
 const content=zipText(bytes,entries,name=>/(^|\/)content_list\.json$/i.test(name));
 if(content!==null){
  try{
   const parsed=JSON.parse(content.text);
   if(Array.isArray(parsed)){
    const indexes=[...new Set(parsed.map(item=>Number((item as Record<string,unknown>)?.page_idx)).filter(Number.isFinite))];
    if(indexes.length>0)return {extracted:indexes.length,total:Math.max(...indexes)+1};
   }
  }catch{}
 }
 const layout=zipText(bytes,entries,name=>/(^|\/)layout\.json$/i.test(name));
 if(layout!==null){
  try{
   const parsed=JSON.parse(layout.text);
   if(Array.isArray(parsed?.pdf_info))return {extracted:parsed.pdf_info.length,total:parsed.pdf_info.length};
  }catch{}
 }
 return null;
}

async function downloadBytes(fetcher:FetchLike,url:string,timeoutMs:number):Promise<Uint8Array>{
 let response:Response;
 try{response=await withTimeout(fetcher(url),timeoutMs);}
 catch(error){if(error instanceof DocumentParseRefusal)throw error;throw new DocumentParseRefusal('DOCUMENT_PARSE_RESULT_DOWNLOAD_FAILED','MinerU result ZIP download failed');}
 if(!response.ok)throw new DocumentParseRefusal('DOCUMENT_PARSE_RESULT_DOWNLOAD_FAILED','MinerU result ZIP download failed');
 const declared=Number(response.headers.get('content-length')??0);
 if(Number.isFinite(declared)&&declared>MAX_RESULT_ZIP_BYTES)throw new DocumentParseRefusal('DOCUMENT_PARSE_RESULT_DOWNLOAD_FAILED','MinerU result ZIP is too large');
 let buffer:ArrayBuffer;
 try{buffer=await withTimeout(response.arrayBuffer(),timeoutMs);}
 catch(error){if(error instanceof DocumentParseRefusal)throw error;throw new DocumentParseRefusal('DOCUMENT_PARSE_RESULT_DOWNLOAD_FAILED','MinerU result ZIP download failed');}
 if(buffer.byteLength>MAX_RESULT_ZIP_BYTES)throw new DocumentParseRefusal('DOCUMENT_PARSE_RESULT_DOWNLOAD_FAILED','MinerU result ZIP is too large');
 return new Uint8Array(buffer);
}

interface Polled {state: string; markdownUrl: string | null; zipUrl: string | null; pages: {extracted: number; total: number} | null; error: string | null; errorCode: string | null; requestId: string | null;}
async function poll(fetcher: FetchLike, url: string, headers: Record<string, string>, timeoutMs: number, batch = false, queueMessage = 'MinerU task stayed in the provider queue and did not start in time'): Promise<Polled> {
 const started = Date.now();
 let lastState = '';
 let lastPages: {extracted: number; total: number} | null = null;
 while (Date.now() - started <= timeoutMs) {
  const payload = await json(fetcher, url, {headers}, timeoutMs);
  const envelope = payload?.data ?? {};
  const data = batch ? (Array.isArray(envelope.extract_result) ? envelope.extract_result[0] ?? {} : {}) : envelope;
  const state = String(data.state ?? '');
  lastState = state;
  const progress = data.extract_progress ?? data.extractProgress;
  const pages: {extracted: number; total: number} | null = progress === undefined ? lastPages : {extracted: Number(progress.extracted_pages ?? progress.extractedPages ?? 0) || 0, total: Number(progress.total_pages ?? progress.totalPages ?? 0) || 0};
  lastPages = pages;
  if (state === 'done') return {state, markdownUrl: typeof data.markdown_url === 'string' ? data.markdown_url : (typeof data.markdownUrl === 'string' ? data.markdownUrl : null), zipUrl: typeof data.full_zip_url === 'string' ? data.full_zip_url : (typeof data.zipUrl === 'string' ? data.zipUrl : null), pages, error: null, errorCode: null, requestId: typeof data.task_id === 'string' ? data.task_id : (typeof envelope.batch_id === 'string' ? envelope.batch_id : null)};
  if (state === 'failed') return {state, markdownUrl: null, zipUrl: null, pages, error: String(data.err_msg ?? data.errorMsg ?? 'MinerU task failed'), errorCode: data.err_code === undefined && data.errorCode === undefined ? null : String(data.err_code ?? data.errorCode), requestId: typeof data.task_id === 'string' ? data.task_id : null};
  await sleep(3000);
 }
 if (lastState === 'pending') throw new DocumentParseRefusal('DOCUMENT_PARSE_PROVIDER_QUEUE_UNAVAILABLE', queueMessage, {retryAfter: 300});
 throw new DocumentParseRefusal('DOCUMENT_PARSE_TIMEOUT', 'MinerU task did not finish in time');
}

export class MineruDocumentParse implements DocumentParseProvider {
 readonly descriptor = MINERU_DESCRIPTOR;
 constructor(private readonly fetcher: FetchLike = fetch, private readonly timeoutMs = 300000) {}

 async parse(request: DocumentParseRequest, credentials: Record<string, string>): Promise<DocumentParseProviderResult> {
  const started = Date.now();
  const mode = request.mode;
  if (mode !== 'mineru-agent' && mode !== 'mineru-api') throw new DocumentParseRefusal('DOCUMENT_PARSE_MODE_UNKNOWN', 'unknown MinerU mode ' + mode);
  const opts = option(request);
  const timeoutMs = opts.timeoutMs ?? this.timeoutMs;
  const modelVersion = mode === 'mineru-api' ? (opts.modelVersion ?? 'pipeline') : 'pipeline';
  const agentCommon: Record<string, unknown> = {
   ...(opts.language === undefined ? {} : {language: opts.language}),
   ...(opts.pageRange === undefined ? {} : {page_range: opts.pageRange}),
   ...(opts.isOcr === undefined ? {} : {is_ocr: opts.isOcr}),
   ...(opts.enableTable === undefined ? {} : {enable_table: opts.enableTable}),
   ...(opts.enableFormula === undefined ? {} : {enable_formula: opts.enableFormula}),
  };
  const apiCommon: Record<string, unknown> = {
   ...(opts.language === undefined ? {} : {language: opts.language}),
   ...(opts.pageRange === undefined ? {} : {page_ranges: opts.pageRange}),
   ...(opts.isOcr === undefined ? {} : {is_ocr: opts.isOcr}),
   ...(opts.enableTable === undefined ? {} : {enable_table: opts.enableTable}),
   ...(opts.enableFormula === undefined ? {} : {enable_formula: opts.enableFormula}),
  };
  const apiBatchCommon: Record<string, unknown> = {
   ...(opts.language === undefined ? {} : {language: opts.language}),
   ...(opts.enableTable === undefined ? {} : {enable_table: opts.enableTable}),
   ...(opts.enableFormula === undefined ? {} : {enable_formula: opts.enableFormula}),
  };
  let task: Polled;
  if (mode === 'mineru-agent') {
   if (request.url) {
    const submitted = await json(this.fetcher, AGENT_BASE + '/parse/url', {method: 'POST', headers: {'content-type': 'application/json', source: FLASH_SOURCE, accept: '*/*'}, body: JSON.stringify({url: request.url, file_name: basename(new URL(request.url).pathname), ...agentCommon})}, timeoutMs);
    const taskId = String(submitted?.data?.task_id ?? '');
    if (!taskId) throw new DocumentParseRefusal('DOCUMENT_PARSE_PROVIDER_ERROR', 'MinerU did not return a task id');
    task = await poll(this.fetcher, AGENT_BASE + '/parse/' + encodeURIComponent(taskId), {}, timeoutMs, false, 'MinerU public Agent queue did not start the task in time');
   } else {
    if (!request.path) throw new DocumentParseRefusal('DOCUMENT_PARSE_INPUT_REQUIRED', 'MinerU requires a file path or URL');
    const info = await stat(request.path);
    if (info.size > MODE_AGENT.maxBytes!) throw new DocumentParseRefusal('DOCUMENT_PARSE_TOO_LARGE', 'MinerU agent mode accepts up to 10MB');
    const bytes = await readFile(request.path);
    const submitted = await json(this.fetcher, AGENT_BASE + '/parse/file', {method: 'POST', headers: {'content-type': 'application/json', source: FLASH_SOURCE, accept: '*/*'}, body: JSON.stringify({file_name: basename(request.path), ...agentCommon})}, timeoutMs);
    const taskId = String(submitted?.data?.task_id ?? '');
    const uploadUrl = String(submitted?.data?.file_url ?? '');
    if (!taskId || !uploadUrl) throw new DocumentParseRefusal('DOCUMENT_PARSE_PROVIDER_ERROR', 'MinerU did not return an upload URL');
    await putBytes(this.fetcher, uploadUrl, bytes, timeoutMs);
    task = await poll(this.fetcher, AGENT_BASE + '/parse/' + encodeURIComponent(taskId), {}, timeoutMs, false, 'MinerU public Agent queue did not start the task in time');
   }
  } else {
   const headers: Record<string, string> = {'content-type': 'application/json', authorization: 'Bearer ' + (credentials.apiKey ?? '')};
   if (request.url) {
    const submitted = await json(this.fetcher, API_BASE + '/extract/task', {method: 'POST', headers, body: JSON.stringify({url: request.url, model_version: modelVersion, ...apiCommon})}, timeoutMs);
    const taskId = String(submitted?.data?.task_id ?? '');
    if (!taskId) throw new DocumentParseRefusal('DOCUMENT_PARSE_PROVIDER_ERROR', 'MinerU did not return a task id');
    task = await poll(this.fetcher, API_BASE + '/extract/task/' + encodeURIComponent(taskId), {authorization: headers.authorization}, timeoutMs);
   } else {
    if (!request.path) throw new DocumentParseRefusal('DOCUMENT_PARSE_INPUT_REQUIRED', 'MinerU requires a file path or URL');
    const info = await stat(request.path);
    if (info.size > MODE_API.maxBytes!) throw new DocumentParseRefusal('DOCUMENT_PARSE_TOO_LARGE', 'MinerU API mode accepts up to 200MB');
    const bytes = await readFile(request.path);
    const submitted = await json(this.fetcher, API_BASE + '/file-urls/batch', {method: 'POST', headers, body: JSON.stringify({files: [{
     name: basename(request.path),
     ...(opts.pageRange === undefined ? {} : {page_ranges: opts.pageRange}),
     ...(opts.isOcr === undefined ? {} : {is_ocr: opts.isOcr}),
    }], model_version: modelVersion, ...apiBatchCommon})}, timeoutMs);
    const batchId = String(submitted?.data?.batch_id ?? '');
    const uploadUrl = String(submitted?.data?.file_urls?.[0] ?? '');
    if (!batchId || !uploadUrl) throw new DocumentParseRefusal('DOCUMENT_PARSE_PROVIDER_ERROR', 'MinerU did not return an upload URL');
    await putBytes(this.fetcher, uploadUrl, bytes, timeoutMs);
    task = await poll(this.fetcher, API_BASE + '/extract-results/batch/' + encodeURIComponent(batchId), {authorization: headers.authorization}, timeoutMs, true);
   }
  }
  if (task.error !== null) {
   const mapped = task.errorCode === null ? undefined : BUSINESS_ERRORS[task.errorCode];
   throw new DocumentParseRefusal(mapped?.code ?? 'DOCUMENT_PARSE_TASK_FAILED', task.error, mapped?.retryAfter === undefined ? undefined : {retryAfter: mapped.retryAfter});
  }
  if ((task.markdownUrl === null || task.markdownUrl.trim().length === 0) && (task.zipUrl === null || task.zipUrl.trim().length === 0)) throw new DocumentParseRefusal('DOCUMENT_PARSE_RESULT_MISSING', 'MinerU reported done without a markdown or zip result URL');
  const maxPages = mode === 'mineru-agent' ? MODE_AGENT.maxPages : MODE_API.maxPages;
  if (task.pages !== null && maxPages !== null && task.pages.total > maxPages) throw new DocumentParseRefusal('DOCUMENT_PARSE_TOO_MANY_PAGES', 'MinerU document exceeds the mode page limit');
  let markdown = task.markdownUrl === null ? null : await downloadText(this.fetcher, task.markdownUrl, timeoutMs);
  let pages = task.pages;
  const warnings: string[] = [];
  if (markdown === null && task.zipUrl !== null) {
   try {
    const bytes = await downloadBytes(this.fetcher, task.zipUrl, timeoutMs);
    const entries = zipEntries(bytes);
    const full = zipText(bytes, entries, name => /(^|\/)full\.md$/i.test(name));
    if (full === null || full.text.trim().length === 0) throw new Error('MinerU result ZIP has no full.md');
    markdown = full.text;
    const fromZip = zipPages(bytes, entries);
    if (fromZip !== null) {
     pages = pages === null ? fromZip : {extracted: Math.max(pages.extracted, fromZip.extracted), total: Math.max(pages.total, fromZip.total)};
     if (pages !== null && maxPages !== null && pages.total > maxPages) throw new DocumentParseRefusal('DOCUMENT_PARSE_TOO_MANY_PAGES', 'MinerU document exceeds the mode page limit');
    }
   } catch (error) {
    // Transport/provider failures stay failures. Only an unreadable ZIP body falls back to the ZIP artifact + warning.
    if (error instanceof DocumentParseRefusal) throw error;
    warnings.push('DOCUMENT_PARSE_ZIP_EXTRACT_FAILED');
   }
  }
  return {pages, markdown, artifacts: task.zipUrl === null ? [] : [{name: 'mineru-result.zip', url: task.zipUrl, mediaType: 'application/zip'}], requestId: task.requestId, ms: Date.now() - started, ...(warnings.length === 0 ? {} : {warnings})};
 }
}
