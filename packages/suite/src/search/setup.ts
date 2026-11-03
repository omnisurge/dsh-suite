import type {Context} from '@deepseek-ai/cordis';
import {defineTool} from '@deepseek-ai/dsh-tools';
import {Remote, TypertRemoteService} from '@deepseek-ai/dsh-typert-protocol';
import {credentialRef} from '@deepseek-ai/dsh-credentials';
import {snapshot, type Config} from './config.js';
import {SearxngSetupCore} from './setup-core.js';
import type {SetupInspection, SetupCheck, SetupExpectedConfiguration, SetupSettingsOwner} from './types.js';
export type {SetupInspection, SetupCheck, SetupExpectedConfiguration, SetupSettingsOwner} from './types.js';
declare module '@deepseek-ai/cordis' {interface Context {omnisurgeSearxngSetup: SearxngSetup;}}
// Stamped from the owned manifest before byte receipts, avoiding stale JSON module cache.
const version: string='__OMNISURGE_PACKAGE_VERSION__';
export const setupBuildSupported=!version.startsWith('__');
/** One business owner for read-only Agent and UI calls, with no configuration writer. */
export class SearxngSetup extends TypertRemoteService {
  private readonly lifetime=new AbortController();
  private readonly core: SearxngSetupCore;
  constructor(ctx: Context, config: Config){
    super(ctx,'omnisurgeSearxngSetup');
    this.core=new SearxngSetupCore({readConfig:()=>snapshot(config),version,lifetime:this.lifetime.signal,
      describeCredential:ref=>ctx.credentials.describe(credentialRef(ref)),
      resolveCredential:async ref=>(await ctx.credentials.resolve(credentialRef(ref)))?.value,
      // Read lazily: the plugin manager may be absent in a minimal installation, and that absence must
      // surface as a reported fallback instead of blocking this plugin from loading.
      listBundles:async()=>{const manager=ctx.get('pluginManager');if(!manager)throw Error('PLUGIN_MANAGER_UNAVAILABLE');return await manager.listBundles();},
    });
    ctx.effect(()=>async()=>{this.lifetime.abort();await this.core.settled();},'searxng setup: abort owned checks and await settlement');
    ctx.tools.register(defineTool({
      name:'searxng_setup',
      description:'Read-only SearXNG setup discovery and diagnostics. inspect returns installed Config schema/defaults, redacted effective configuration and credential presence. check runs bounded fixed calibration against this plugin own provider (the matching language for en/zh; English and Chinese for default/auto/custom); reports HTTP/JSON/errors/degradation/latency/domain matches. Does not write configuration, expose credentials, deploy or restart servers. Global web provider selection is unknown; a successful check does not prove global web_search dispatch.',
      parameters:{action:{type:'string',enum:['inspect','check'],required:true,description:'inspect does not access SearXNG; check calibrates the matching language for en/zh and both languages for default/auto/custom. Explicit engines require the configured service catalogue.'}},
      output:{schema:{type:'object',additionalProperties:false,properties:{action:{type:'string',enum:['inspect','check'],required:true},report:{type:'json',required:true}}},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]},
      timeoutMs:20000,isConcurrencySafe:args=>args.action==='inspect',
      execute:async(args,exec)=>{
        if(Object.keys(args).some(key=>key!=='action'))throw new Error('searxng_setup accepts action only; no URL, query, credential or write arguments');
        const report=args.action==='inspect'?await this.core.inspect(exec.signal):await this.core.check(exec.signal);
        return {action:args.action,report:JSON.parse(JSON.stringify(report))};
      },
    }));
  }
  @Remote
  async inspect(signal: AbortSignal): Promise<SetupInspection>{return this.core.inspect(signal);}
  @Remote
  async check(signal: AbortSignal): Promise<SetupCheck>{return this.core.check(signal);}
  @Remote
  async checkSaved(expected: SetupExpectedConfiguration, signal: AbortSignal): Promise<SetupCheck>{return this.core.check(signal,expected);}
  /** Read-only: which bundle owns this row, so the Client registers exactly one settings entry. */
  @Remote
  async settingsOwner(): Promise<SetupSettingsOwner>{return this.core.settingsOwner();}
}
