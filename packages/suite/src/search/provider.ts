import { WebError, type WebSearchProvider, type WebSearchRequest, type WebSearchResult, type WebSearchSource } from '@deepseek-ai/dsh-web';
import { isEndpoint, type Snapshot } from './config.js';
import type { EngineGroupId } from './engines.js';
import { effectiveEngineGroup, enginesParamFor, parseEngineCatalogue, parseCustomEngines, EngineSelectionError } from './engines.js';
import { diagnoseSearch, normalizeUnresponsive, type SearchDiagnosis } from './diagnosis.js';

export const SEARXNG_PROVIDER_ID = 'searxng';
export const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
export interface ProviderOptions {
  readConfig(): Snapshot;
  resolveCredential(ref: string): Promise<string | undefined>;
  lifetime?: AbortSignal;
  onDiagnosis?(diagnosis: SearchDiagnosis, attempt: number): void;
  onFallback?(event: {reason: 'group-empty'; from: EngineGroupId; to: EngineGroupId; attempt: 2}): void;
  /** Numeric/format evidence only: never upstream text or response headers. */
  onResponse?(event: {status: number | null; json: 'unknown' | 'valid' | 'invalid'}): void;
}
export function mapSearxngResponse(payload: unknown, limit: number): WebSearchResult {
  if (!payload || typeof payload !== 'object' || !Array.isArray((payload as {results?: unknown}).results)) throw new WebError('SearXNG returned no results array', 'WEB_PROVIDER_ERROR');
  const sources: WebSearchSource[] = [];
  for (const item of (payload as {results: unknown[]}).results) {
    if (!item || typeof item !== 'object') continue;
    const hit = item as Record<string, unknown>;
    if (typeof hit.url !== 'string' || !URL.canParse(hit.url) || !['http:', 'https:'].includes(new URL(hit.url).protocol)) continue;
    sources.push({url: hit.url, ...(typeof hit.title === 'string' && hit.title ? {title: hit.title} : {}), ...(typeof hit.content === 'string' && hit.content ? {snippet: hit.content} : {}), ...(typeof hit.publishedDate === 'string' && hit.publishedDate ? {publishedAt: hit.publishedDate} : {})});
  }
  return {sources: sources.slice(0, limit), truncated: sources.length > limit};
}
async function readJson(response: Response, observed?: (state: 'valid' | 'invalid') => void): Promise<unknown> {
  if (!response.body) throw new WebError('SearXNG returned an empty body', 'WEB_PROVIDER_ERROR');
  const reader = response.body.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new WebError('SearXNG response exceeds 2 MiB', 'WEB_RESPONSE_TOO_LARGE');
      chunks.push(value);
    }
    let parsed: unknown;
    try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { observed?.('invalid'); throw new WebError('SearXNG returned invalid JSON', 'WEB_PROVIDER_ERROR'); }
    observed?.('valid'); return parsed;
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}
function boundedCredential(promise: Promise<string | undefined>, signal: AbortSignal): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new WebError('SearXNG credential lookup cancelled', 'WEB_ABORTED'));
    signal.addEventListener('abort', abort, {once:true});
    const cleanup = () => signal.removeEventListener('abort', abort);
    promise.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
    if (signal.aborted) { cleanup(); abort(); }
  });
}
export class SearxngSearchProvider implements WebSearchProvider {
  readonly id = SEARXNG_PROVIDER_ID;
  constructor(private readonly options: ProviderOptions) {}
  available(): boolean { return !this.options.lifetime?.aborted && isEndpoint(this.options.readConfig().baseUrl); }
  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const config = this.options.readConfig();
    if (!isEndpoint(config.baseUrl)) throw new WebError('Configure a SearXNG HTTP(S) URL before searching', 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE');
    const limit = request.maxResults ?? 10;
    if (!Number.isInteger(limit) || limit < 1) throw new WebError('maxResults must be a positive integer', 'WEB_PROVIDER_ERROR');
    const group = effectiveEngineGroup(config.engineGroup, request.query);
    if (group === 'custom' && !parseCustomEngines(config.customEngines)?.length) throw new WebError('Configure valid customEngines before using the custom group', 'WEB_PROVIDER_CUSTOM_ENGINES_INVALID');
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), config.timeoutMs);
    timer.unref();
    const cancellation = AbortSignal.any([timeout.signal, ...(signal ? [signal] : []), ...(this.options.lifetime ? [this.options.lifetime] : [])]);
    const checkAbort = () => {
      if (cancellation.aborted) throw new WebError(timeout.signal.aborted ? 'SearXNG search timed out' : 'SearXNG search cancelled', timeout.signal.aborted ? 'WEB_TIMEOUT' : 'WEB_ABORTED');
    };
    try {
      checkAbort();
      const headers: Record<string,string> = {accept: 'application/json', 'user-agent': 'Omnisurge-DSH-Suite/SearXNG'};
      if (config.basicAuthEnv) {
        let secret: string | undefined;
        try { secret = await boundedCredential(this.options.resolveCredential(config.basicAuthEnv), cancellation); }
        catch { throw new WebError('SearXNG credential resolution failed', 'WEB_PROVIDER_CREDENTIAL_ERROR'); }
        checkAbort();
        if (!secret) throw new WebError('The configured SearXNG credential reference is missing', 'WEB_PROVIDER_CREDENTIAL_MISSING');
        if (!secret.includes(':')) throw new WebError('SearXNG Basic authentication requires user:password', 'WEB_PROVIDER_CREDENTIAL_ERROR');
        headers.authorization = 'Basic ' + Buffer.from(secret).toString('base64');
      }
      // Per-search authoritative catalogue; no cross-operation readiness/cache marker.
      // Uses the same credential, cancellation and total budget as /search.
      const catalogue=group==='default'?undefined:await (async()=>{
        let response:Response;
        try{response=await fetch(new URL(config.baseUrl.replace(/\/$/, '')+'/config'),{headers,signal:cancellation,redirect:'error'});}
        catch{checkAbort();throw new WebError('SearXNG engine configuration is unavailable','WEB_PROVIDER_ENGINE_CONFIG_UNAVAILABLE');}
        this.options.onResponse?.({status:response.status,json:'unknown'});
        if(!response.ok){await response.body?.cancel();throw new WebError('SearXNG engine configuration is unavailable','WEB_PROVIDER_ENGINE_CONFIG_UNAVAILABLE');}
        let payload:unknown;
        try{payload=await readJson(response,json=>this.options.onResponse?.({status:response.status,json}));}
        catch(error){checkAbort();if(error instanceof WebError&&error.code==='WEB_RESPONSE_TOO_LARGE')throw error;throw new WebError('SearXNG engine configuration is invalid','WEB_PROVIDER_ENGINE_CONFIG_INVALID');}
        checkAbort();return parseEngineCatalogue(payload);
      })();
      const firstEngines=enginesParamFor(group,config.customEngines,catalogue);
      const attempt = async (engines: string | undefined, n: number): Promise<WebSearchResult> => {
        checkAbort();
        // A previous catalogue response is not evidence of a search response.
        this.options.onResponse?.({status:null,json:'unknown'});
        const url = new URL(config.baseUrl.replace(/\/$/, '') + '/search');
        url.searchParams.set('q', request.query);
        url.searchParams.set('format', 'json');
        if (engines) url.searchParams.set('engines', engines);
        const response = await fetch(url, {headers, signal: cancellation, redirect: 'error'});
        this.options.onResponse?.({status:response.status,json:'unknown'});
        if (!response.ok) {
          await response.body?.cancel();
          throw new WebError('SearXNG returned HTTP ' + response.status, 'WEB_PROVIDER_ERROR');
        }
        const payload = await readJson(response, json=>this.options.onResponse?.({status:response.status,json}));
        const result = mapSearxngResponse(payload, Math.min(limit, 10));
        const unresponsive = normalizeUnresponsive((payload as Record<string,unknown>).unresponsive_engines);
        this.options.onDiagnosis?.(diagnoseSearch(unresponsive, engines?.split(',') ?? [], result.sources.length), n);
        checkAbort();
        return result;
      };
      const first = await attempt(firstEngines, 1);
      if (first.sources.length || !firstEngines) return first;
      let fallbackGroup: EngineGroupId = 'default';
      if (config.engineGroup === 'auto') fallbackGroup = group === 'zh' ? 'en' : 'zh';
      // Record the controlled fallback before dispatch, even if the second attempt fails.
      this.options.onFallback?.({reason: 'group-empty', from: group, to: fallbackGroup, attempt: 2});
      return await attempt(enginesParamFor(fallbackGroup,undefined,catalogue), 2);
    } catch (error) {
      checkAbort();
      if (error instanceof WebError) throw error;
      if (error instanceof EngineSelectionError) throw new WebError('SearXNG explicit engine selection could not be admitted', 'WEB_PROVIDER_'+error.code);
      throw new WebError('SearXNG request failed; check endpoint connectivity and JSON access', 'WEB_PROVIDER_ERROR');
    } finally { clearTimeout(timer); }
  }
}
