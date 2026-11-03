import {createHash} from 'node:crypto';
import {Config, isEndpoint, type Snapshot} from './config.js';
import {SearxngSearchProvider, SEARXNG_PROVIDER_ID} from './provider.js';
import {normalizeEngineGroup} from './engines.js';
import type {SetupInspection, SetupProbe, SetupCheck, SetupExpectedConfiguration, SetupSettingsOwner} from './types.js';
import {OWNER_PACKAGE, PLUGIN_ROW} from './identity.js';

/** The official plugin manager row shape this plugin reads; only `name`/`rows[].rowId` are used. */
export interface BundleRowLedger {name: string; rows?: {rowId: string}[]}

export interface SetupDependencies {
  readConfig(): Snapshot;
  describeCredential(ref: string): Promise<{configured: boolean}>;
  resolveCredential(ref: string): Promise<string | undefined>;
  version: string;
  lifetime: AbortSignal;
  /** The official plugin manager is the only authority for the owning bundle of this plugin row. */
  listBundles(): Promise<BundleRowLedger[]>;
}
/** Fixed calibration queries, with independent public expected-domain oracles. Not a general relevance guarantee. */
export const CALIBRATION = [
  {language:'en' as const, query:'SearXNG official documentation', domain:'docs.searxng.org'},
  {language:'zh' as const, query:'中国人民银行 官方网站', domain:'pbc.gov.cn'},
];
export function configurationFingerprint(c: Snapshot | SetupExpectedConfiguration): string {
  return createHash('sha256').update(JSON.stringify([c.baseUrl,c.basicAuthEnv,normalizeEngineGroup(c.engineGroup),c.customEngines,c.timeoutMs])).digest('hex');
}
/** Abort the wait without caching/returning a credential; the underlying SDK lookup may settle later. */
async function bounded<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return await new Promise<T>((resolve,reject)=>{
    const abort=()=>{cleanup();reject(signal.reason);};
    const cleanup=()=>signal.removeEventListener('abort',abort);
    signal.addEventListener('abort',abort,{once:true});
    work.then(value=>{cleanup();resolve(value);},error=>{cleanup();reject(error);});
    if(signal.aborted)abort();
  });
}
export function nextSteps(codes: string[]): string[] {
 const guides: Record<string,string>={ENGINE_CONFIG_UNAVAILABLE:'Explicit engines require the same service /config catalogue. Check proxy access or explicitly select server defaults; no silent fallback was made.',ENGINE_CONFIG_INVALID:'The service /config must declare exact engine names and boolean enabled flags; successful search hits do not prove name admission.',ENGINE_NAME_UNKNOWN:'At least one custom engine is not declared by this service. Correct its exact name from /config; unknown names must not silently use server defaults.',ENGINE_GROUP_UNAVAILABLE:'This service has no enabled candidates for the selected language group. Review server engine flags, choose known custom names or explicitly select server defaults.',CUSTOM_ENGINES_INVALID:'Set valid nonempty comma-separated names before selecting custom mode.',CONFIG_MISSING:'Use the official plugin settings to configure an HTTP(S) SearXNG endpoint; a blank endpoint disables search.',CUSTOM_ENGINES_MISSING:'Set custom engine names before selecting custom mode.',CREDENTIAL_MISSING:'Configure the referenced credential through the official credential service; never put a secret into plugin fields.',CREDENTIAL_LOOKUP_FAILED:'Credential presence could not be inspected; check credential-provider availability without exposing secret values.',CREDENTIAL_ERROR:'Credential resolution or Basic user:password format failed; review the official credential service without copying secret values.',UNENCRYPTED_TRANSPORT:'Review the trust boundary and consider HTTPS before sending credentials or private queries.',HTTP_AUTH_REQUIRED:'Check the proxy authentication policy and configured credential reference.',HTTP_FORBIDDEN:'Check proxy/access restrictions and JSON-format permission; HTTP 403 alone does not prove JSON is disabled.',HTTP_ERROR:'Check service availability and proxy logs; do not infer relevance from HTTP status.',RESPONSE_NOT_JSON:'Check proxy responses and SearXNG JSON-format settings.',RESPONSE_SHAPE_INVALID:'Confirm this endpoint returns a compatible SearXNG results array.',RESPONSE_TOO_LARGE:'Review upstream response size; the plugin limits response memory to 2 MiB.',NETWORK_FAILED:'Check connectivity, TLS and service availability; raw exception text is intentionally omitted.',EMPTY_RESULTS:'Review engines and language routing; empty results do not prove server failure.',QUALITY_SUSPECT:'Calibration expected-domain match failed; review language/engine selection and results manually. HTTP 200 is not relevance proof.',ENGINE_DEGRADED:'Some upstream engines did not respond; successful sources still exist. Review engine health if degradation persists.',FALLBACK_USED:'The selected group returned empty; one controlled fallback was planned (auto: opposite language, explicit group: server defaults), subject to catalogue admission and the same total budget.',EXPECTED_CONFIGURATION_MISMATCH:'The saved UI configuration no longer matches the Host. No search request was sent; reload and confirm settings before checking.',CONFIGURATION_CHANGED:'Settings changed during the check. These results use the captured configuration; repeat for current settings.',CHECK_BUSY:'Wait for the owned active check instead of starting duplicate probes.',CHECK_TIMEOUT:'The fixed total diagnostic budget expired; review latency and connectivity.',CHECK_CANCELLED:'The caller or plugin owner cancelled the check; no completed health claim is made.',SETUP_CLOSED:'This plugin owner is unloaded; reload it normally before checking.',INSPECTION_CANCELLED:'Credential presence inspection was cancelled; presence is unknown.'};
 return [...new Set(codes.flatMap(code=>guides[code]?[guides[code]]:[]))];
}
export class SearxngSetupCore {
  private pending: Promise<SetupCheck> | undefined;
  private checking=false;
  constructor(private readonly deps: SetupDependencies) {}
  /**
   * The single settings entry is registered under the bundle that actually owns this row, exactly as
   * the official plugin manager computes it (`<bundle>#<settings namespace>`). Both the Suite layout
   * and the standalone layout therefore produce one entry, never two.
   */
  async settingsOwner(): Promise<SetupSettingsOwner> {
    try{
      const bundles=await this.deps.listBundles();
      const owner=(bundles??[]).find(bundle=>(bundle.rows??[]).some(row=>row.rowId===PLUGIN_ROW));
      if(owner?.name)return {owner:owner.name,rowId:PLUGIN_ROW,source:'plugin-manager',diagnostic:null};
      return {owner:OWNER_PACKAGE,rowId:PLUGIN_ROW,source:'own-package',diagnostic:'no installed bundle declares row '+PLUGIN_ROW};
    }catch(error){
      // Never swallow: the fallback is reported so a missing plugin manager stays observable.
      return {owner:OWNER_PACKAGE,rowId:PLUGIN_ROW,source:'own-package',diagnostic:'bundle ledger unavailable: '+String((error as Error)?.message??error)};
    }
  }
  async inspect(signal?: AbortSignal): Promise<SetupInspection> {
    return this.inspectSnapshot({...this.deps.readConfig()},signal);
  }
  private async inspectSnapshot(c: Snapshot, signal?: AbortSignal): Promise<SetupInspection> {
    const combined=AbortSignal.any([this.deps.lifetime,AbortSignal.timeout(3000),...(signal?[signal]:[])]);
    const codes: string[]=[];
    if(this.deps.lifetime.aborted)codes.push('SETUP_CLOSED');
    if(!isEndpoint(c.baseUrl))codes.push('CONFIG_MISSING');
    if(c.engineGroup==='custom'&&!c.customEngines.trim())codes.push('CUSTOM_ENGINES_MISSING');
    let credentialState: SetupInspection['credentialState']='not-required';
    if(c.basicAuthEnv){
      credentialState='unknown';
      if(!combined.aborted){
        try{credentialState=(await bounded(this.deps.describeCredential(c.basicAuthEnv),combined)).configured?'configured':'missing';}
        catch{codes.push('CREDENTIAL_LOOKUP_FAILED');}
      }else codes.push('INSPECTION_CANCELLED');
      if(credentialState==='missing')codes.push('CREDENTIAL_MISSING');
    }
    if(c.baseUrl.startsWith('http:'))codes.push('UNENCRYPTED_TRANSPORT');
    return {
      version:this.deps.version,providerId:SEARXNG_PROVIDER_ID,capability:'read-only',
      configurationFingerprint:configurationFingerprint(c),schemaJson:JSON.stringify(Config.toJSON()),
      configuration:{endpointConfigured:isEndpoint(c.baseUrl),transport:c.baseUrl.startsWith('https:')?'https':c.baseUrl.startsWith('http:')?'http':'none',credentialReferenceConfigured:Boolean(c.basicAuthEnv),engineGroup:c.engineGroup,customEngines:c.customEngines,timeoutMs:c.timeoutMs},
      credentialState,globalSelection:'unknown',codes,nextSteps:[...nextSteps(codes),'Global web_search provider selection is unknown: review the official web provider setting. Any configuration/server remediation requires user authorization.'],
    };
  }
  async check(signal?: AbortSignal,expected?: SetupExpectedConfiguration): Promise<SetupCheck> {
    const c={...this.deps.readConfig()};
    if(this.checking){
      return {inspection:await this.inspectSnapshot(c,signal),scope:'own-provider',state:'busy',configurationChanged:false,elapsedMs:0,probes:[],codes:['CHECK_BUSY'],nextSteps:nextSteps(['CHECK_BUSY'])};
    }
    // Claim before the first awaited validation so concurrent UI/Agent calls cannot both start probes.
    this.checking=true;const work=this.run(c,signal,expected!==undefined&&configurationFingerprint(expected)!==configurationFingerprint(c));this.pending=work;
    try{return await work;}finally{if(this.pending===work){this.pending=undefined;this.checking=false;}}
  }
  async settled(): Promise<void> { await this.pending; }
  private async run(c: Snapshot, caller?: AbortSignal,expectedMismatch=false): Promise<SetupCheck> {
    const began=Date.now();
    const budget=AbortSignal.timeout(Math.min(c.timeoutMs,15000));
    const signal=AbortSignal.any([this.deps.lifetime,budget,...(caller?[caller]:[])]);
    const inspection=await this.inspectSnapshot(c,signal);
    const probes: SetupProbe[]=[];
    const reportCodes: string[]=expectedMismatch?['EXPECTED_CONFIGURATION_MISMATCH']:[];
    const blocked=expectedMismatch||inspection.codes.some(code=>['CONFIG_MISSING','CUSTOM_ENGINES_MISSING','CREDENTIAL_MISSING','CREDENTIAL_LOOKUP_FAILED','SETUP_CLOSED','INSPECTION_CANCELLED'].includes(code));
    if(!blocked){
      // One credential resolution per check, scoped to this invocation; never retained across checks.
      let credential: Promise<string|undefined> | undefined;
      const calibration=CALIBRATION.filter(sample=>c.engineGroup!=='en'&&c.engineGroup!=='zh'||sample.language===c.engineGroup);
      for(const sample of calibration){
        const probe: SetupProbe={language:sample.language,query:sample.query,elapsedMs:0,httpStatus:null,jsonState:'unknown',sourceCount:0,expectedDomainMatched:false,unresponsiveEngineCount:0,fallbackUsed:false,codes:[],nextSteps:[]};
        const start=Date.now();
        const provider=new SearxngSearchProvider({
          readConfig:()=>c,
          resolveCredential:ref=>credential??=bounded(this.deps.resolveCredential(ref),signal),
          lifetime:signal,
          onResponse:event=>{probe.httpStatus=event.status;probe.jsonState=event.json;},
          onFallback:()=>{probe.fallbackUsed=true;},
          onDiagnosis:diagnosis=>{probe.unresponsiveEngineCount=Math.max(probe.unresponsiveEngineCount,diagnosis.unresponsive.length);},
        });
        try{
          const result=await provider.search({query:sample.query,maxResults:10},signal);
          probe.sourceCount=result.sources.length;
          probe.expectedDomainMatched=result.sources.some(source=>{const hostname=new URL(source.url).hostname;return hostname===sample.domain||hostname.endsWith('.'+sample.domain);});
          if(!probe.sourceCount)probe.codes.push('EMPTY_RESULTS');
          else if(!probe.expectedDomainMatched)probe.codes.push('QUALITY_SUSPECT');
          if(probe.unresponsiveEngineCount)probe.codes.push('ENGINE_DEGRADED');
          if(probe.fallbackUsed)probe.codes.push('FALLBACK_USED');
        }catch(error){
          // SDK/provider exceptions can contain secrets or upstream text; return allowlisted facts only.
          const code=(error as {code?:string}).code;
          if(signal.aborted)probe.codes.push(budget.aborted?'CHECK_TIMEOUT':'CHECK_CANCELLED');
          else if(code==='WEB_PROVIDER_CREDENTIAL_MISSING')probe.codes.push('CREDENTIAL_MISSING');
          else if(code==='WEB_PROVIDER_CREDENTIAL_ERROR')probe.codes.push('CREDENTIAL_ERROR');
          else if(code&&['WEB_PROVIDER_ENGINE_CONFIG_UNAVAILABLE','WEB_PROVIDER_ENGINE_CONFIG_INVALID','WEB_PROVIDER_ENGINE_NAME_UNKNOWN','WEB_PROVIDER_ENGINE_GROUP_UNAVAILABLE','WEB_PROVIDER_CUSTOM_ENGINES_INVALID'].includes(code)){
            probe.codes.push(code.slice('WEB_PROVIDER_'.length));
            if(probe.httpStatus===401)probe.codes.push('HTTP_AUTH_REQUIRED');
            else if(probe.httpStatus===403)probe.codes.push('HTTP_FORBIDDEN');
            else if(probe.httpStatus!==null&&probe.httpStatus>=400)probe.codes.push('HTTP_ERROR');
          }
          else if(probe.httpStatus===401)probe.codes.push('HTTP_AUTH_REQUIRED');
          else if(probe.httpStatus===403)probe.codes.push('HTTP_FORBIDDEN');
          else if(probe.httpStatus!==null&&probe.httpStatus>=400)probe.codes.push('HTTP_ERROR');
          else if(probe.jsonState==='invalid')probe.codes.push('RESPONSE_NOT_JSON');
          else if(code==='WEB_RESPONSE_TOO_LARGE')probe.codes.push('RESPONSE_TOO_LARGE');
          else if(probe.jsonState==='valid')probe.codes.push('RESPONSE_SHAPE_INVALID');
          else probe.codes.push('NETWORK_FAILED');
        }
        probe.elapsedMs=Date.now()-start;probe.nextSteps=nextSteps(probe.codes);
        // Latency is evidence, not a universal one-second service-quality verdict.
        probes.push(probe);
        if(signal.aborted)break;
      }
    }
    const configurationChanged=expectedMismatch||configurationFingerprint(this.deps.readConfig())!==inspection.configurationFingerprint;
    if(configurationChanged)reportCodes.push('CONFIGURATION_CHANGED');
    if(signal.aborted)reportCodes.push(budget.aborted?'CHECK_TIMEOUT':'CHECK_CANCELLED');
    const failed=probes.some(p=>p.codes.some(code=>!['QUALITY_SUSPECT','ENGINE_DEGRADED','FALLBACK_USED'].includes(code)));
    reportCodes.push(...probes.flatMap(probe=>probe.codes));
    const codes=[...new Set(reportCodes)];
    return {inspection,scope:'own-provider',state:signal.aborted?'cancelled':blocked||failed?'blocked':configurationChanged||probes.some(p=>p.codes.length>0)?'degraded':'ready',configurationChanged,elapsedMs:Date.now()-began,probes,codes,nextSteps:nextSteps([...inspection.codes,...codes])};
  }
}
