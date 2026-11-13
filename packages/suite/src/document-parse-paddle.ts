import {readFile,stat} from 'node:fs/promises';
import {basename} from 'node:path';
import {DocumentParseRefusal, type DocumentParseModeDescriptor, type DocumentParseProvider, type DocumentParseProviderDescriptor, type DocumentParseProviderResult, type DocumentParseRequest} from './document-parse-types.js';

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
const JOB_URL = 'https://paddleocr.aistudio-app.com/api/v2/ocr/jobs';
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const MODES: DocumentParseModeDescriptor[] = [
 {id: 'paddleocr-vl-1.6-async', provider: 'paddleocr', displayKey: 'modePaddleVl16', auth: 'credential', credentialRoles: ['token'], transport: 'async', inputs: ['pdf', 'image', 'url'], outputs: ['markdown', 'json', 'images'], maxBytes: 200 * 1024 * 1024, maxPages: 1000},
 {id: 'paddleocr-pp-ocrv6-async', provider: 'paddleocr', displayKey: 'modePaddleOcrv6', auth: 'credential', credentialRoles: ['token'], transport: 'async', inputs: ['pdf', 'image', 'url'], outputs: ['images'], maxBytes: 200 * 1024 * 1024, maxPages: 1000},
 {id: 'paddleocr-pp-structurev3-async', provider: 'paddleocr', displayKey: 'modePaddleStructureAsync', auth: 'credential', credentialRoles: ['token'], transport: 'async', inputs: ['pdf', 'image', 'url'], outputs: ['markdown', 'json', 'images'], maxBytes: 200 * 1024 * 1024, maxPages: 1000},
];
export const PADDLE_DESCRIPTOR: DocumentParseProviderDescriptor = {id: 'paddleocr', displayKey: 'providerPaddleOcr', modes: MODES};

function throwFor(response: Response, payload: any, provider = 'PaddleOCR'): void {
 if (response.ok && (payload?.errorCode === undefined || payload.errorCode === 0 || payload.errorCode === '0')) return;
 const status = response.status;
 const code = status === 401 || status === 403 ? 'DOCUMENT_PARSE_AUTH_FAILED' : status === 429 ? 'DOCUMENT_PARSE_QUOTA_EXHAUSTED' : 'DOCUMENT_PARSE_PROVIDER_ERROR';
 throw new DocumentParseRefusal(code, provider + ' refused with HTTP ' + status + (payload?.errorMsg ? ': ' + String(payload.errorMsg) : ''));
}
async function json(fetcher: FetchLike, url: string, init: RequestInit): Promise<any> {
 const response = await fetcher(url, init);
 let payload: any = null;
 try { payload = await response.json(); } catch { payload = null; }
 throwFor(response, payload);
 return payload;
}
function optionalPayload(request: DocumentParseRequest): Record<string, unknown> {
 const raw = request.options ?? {};
 return {
  ...(typeof raw.useDocOrientationClassify === 'boolean' ? {useDocOrientationClassify: raw.useDocOrientationClassify} : {}),
  ...(typeof raw.useDocUnwarping === 'boolean' ? {useDocUnwarping: raw.useDocUnwarping} : {}),
  ...(typeof raw.useChartRecognition === 'boolean' ? {useChartRecognition: raw.useChartRecognition} : {}),
 };
}
function markdownFromLayoutResults(results: any[]): {markdown: string | null; artifacts: {name: string; url: string; mediaType: string | null}[]; pages: number} {
 const markdown: string[] = [];
 const artifacts: {name: string; url: string; mediaType: string | null}[] = [];
 for (const [index, result] of results.entries()) {
  if (typeof result?.markdown?.text === 'string') markdown.push(result.markdown.text);
  const images = result?.markdown?.images;
  if (images && typeof images === 'object') for (const [name, url] of Object.entries(images)) if (typeof url === 'string') artifacts.push({name: name || 'page-' + (index + 1) + '.png', url, mediaType: 'image/png'});
  for (const [name, url] of Object.entries(result?.outputImages ?? {})) if (typeof url === 'string') artifacts.push({name: name + '-' + (index + 1) + '.jpg', url, mediaType: 'image/jpeg'});
 }
 return {markdown: markdown.length === 0 ? null : markdown.join('\n\n'), artifacts, pages: results.length};
}

export class PaddleOcrDocumentParse implements DocumentParseProvider {
 readonly descriptor = PADDLE_DESCRIPTOR;
 constructor(private readonly fetcher: FetchLike = fetch, private readonly timeoutMs = 300000) {}

 async parse(request: DocumentParseRequest, credentials: Record<string, string>): Promise<DocumentParseProviderResult> {
  const started = Date.now();
  const mode = MODES.find(candidate => candidate.id === request.mode);
  if (mode === undefined) throw new DocumentParseRefusal('DOCUMENT_PARSE_MODE_UNKNOWN', 'unknown PaddleOCR mode ' + request.mode);
  const token = credentials.token ?? '';
  if (token.length === 0) throw new DocumentParseRefusal('DOCUMENT_PARSE_CREDENTIAL_MISSING', 'PaddleOCR requires a token');
  const model = mode.id === 'paddleocr-vl-1.6-async' ? 'PaddleOCR-VL-1.6' : mode.id === 'paddleocr-pp-ocrv6-async' ? 'PP-OCRv6' : 'PP-StructureV3';
  const options = optionalPayload(request);
  const timeoutMs = typeof request.options?.timeoutMs === 'number' && Number.isFinite(request.options.timeoutMs) && request.options.timeoutMs > 0 ? request.options.timeoutMs : this.timeoutMs;
  if (!request.path && !request.url) throw new DocumentParseRefusal('DOCUMENT_PARSE_INPUT_REQUIRED', 'PaddleOCR requires a file path or URL');
  const headers: Record<string, string> = {authorization: 'bearer ' + token};
  let submitted: any;
  if (request.url) {
   submitted = await json(this.fetcher, JOB_URL, {method: 'POST', headers: {...headers, 'content-type': 'application/json'}, body: JSON.stringify({fileUrl: request.url, model, optionalPayload: options})});
  } else {
   const info = await stat(request.path!);
   if (info.size > mode.maxBytes!) throw new DocumentParseRefusal('DOCUMENT_PARSE_TOO_LARGE', 'PaddleOCR accepts up to 200MB');
   const bytes = await readFile(request.path!);
   const form = new FormData();
   form.set('model', model);
   form.set('optionalPayload', JSON.stringify(options));
   form.set('file', new Blob([bytes as unknown as BlobPart], {type: 'application/octet-stream'}), basename(request.path!));
   submitted = await json(this.fetcher, JOB_URL, {method: 'POST', headers, body: form});
  }
  const jobId = String(submitted?.data?.jobId ?? '');
  if (jobId.length === 0) throw new DocumentParseRefusal('DOCUMENT_PARSE_PROVIDER_ERROR', 'PaddleOCR returned no job id');
  let state = '';
  let jsonUrl: string | null = null;
  let pages: {extracted: number; total: number} | null = null;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
   const answer = await json(this.fetcher, JOB_URL + '/' + encodeURIComponent(jobId), {headers: {...headers}});
   const data = answer?.data ?? {};
   state = String(data.state ?? '');
   const progress = data.extractProgress;
   if (progress && typeof progress === 'object') pages = {extracted: Number(progress.extractedPages) || 0, total: Number(progress.totalPages) || 0};
   if (state === 'done') { jsonUrl = typeof data.resultUrl?.jsonUrl === 'string' ? data.resultUrl.jsonUrl : null; break; }
   if (state === 'failed') throw new DocumentParseRefusal('DOCUMENT_PARSE_TASK_FAILED', String(data.errorMsg ?? 'PaddleOCR task failed'));
   await sleep(1500);
  }
  if (state !== 'done') throw new DocumentParseRefusal('DOCUMENT_PARSE_TIMEOUT', 'PaddleOCR task did not finish in time');
  if (jsonUrl === null) throw new DocumentParseRefusal('DOCUMENT_PARSE_PROVIDER_ERROR', 'PaddleOCR returned no result URL');
  const response = await this.fetcher(jsonUrl);
  if (!response.ok) throw new DocumentParseRefusal('DOCUMENT_PARSE_RESULT_DOWNLOAD_FAILED', 'PaddleOCR result download failed');
  const lines = (await response.text()).trim().split('\n').filter(Boolean);
  const layout: any[] = [];
  const artifacts: {name: string; url: string; mediaType: string | null}[] = [];
  for (const line of lines) {
   let parsed: any;
   try { parsed = JSON.parse(line); } catch { continue; }
   const result = parsed?.result;
   if (Array.isArray(result?.layoutParsingResults)) layout.push(...result.layoutParsingResults);
   if (Array.isArray(result?.ocrResults)) for (const [index, item] of result.ocrResults.entries()) if (typeof item?.ocrImage === 'string') artifacts.push({name: 'ocr-' + (index + 1) + '.jpg', url: item.ocrImage, mediaType: 'image/jpeg'});
  }
  const normalized = markdownFromLayoutResults(layout);
  return {pages, markdown: normalized.markdown, artifacts: [...normalized.artifacts, ...artifacts], requestId: jobId, ms: Date.now() - started};
 }
}
