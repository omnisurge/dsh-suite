import type {Context} from '@deepseek-ai/cordis';
import type {SuiteDevelopment} from './host.js';
import type {Config} from './config.js';
export {Config,DEFAULT_RELEASE_DIRECTORY} from './config.js';
/** The Host service class is public: the Cordis augmentation above, and the Typert face model, resolve `ctx.omnisurgeSuiteDev` through this export. */
export type {SuiteDevelopment} from './host.js';
/** The declared Host entry: no plugin-API value is imported here.
 *
 * Everything this plugin adds through the official API (the Typert Remote service, the agent tools, the
 * gateway reads) lives in `host.js` and is imported dynamically below. The entry therefore loads on a
 * runtime whose plugin API moved: the failure surfaces as one named error from `apply`, which the plugin row
 * and the Client page can both quote, instead of a module-load failure that leaves the user with an opaque
 * message. Framework-level values (`@deepseek-ai/cordis` types, the Config schema) stay static because the
 * loader reads them at load time and they are not part of the plugin API surface being adapted here.
 */
export const name='omnisurge-suite-development';
/** ADR-068: `credentials` is deliberately **not** in this list. A static `inject` entry is a *required*
 * service (Cordis keeps the fiber unapplied until it exists), so listing it would take the whole row — the
 * Remote, the tools, the update card — down on a Host without that service. The fetcher only needs it for a
 * private repository, where the absence must read as "the configured reference cannot be resolved"
 * (`FETCH_TOKEN_MISSING`) while public repositories keep working; `host.ts` therefore reads the service
 * with `ctx.get('credentials')` and degrades instead of failing to load. */
export const inject=['typert','typertGateway','pluginManager','profileContext','tools'];
declare module '@deepseek-ai/cordis' {interface Context {omnisurgeSuiteDev:SuiteDevelopment;}}
export async function apply(ctx:Context,config?:Config):Promise<void>{
 let host,release;
 try{
  host=await import('./host.js');
  // ADR-068: the release fetcher is an optional capability, loaded here at the same boundary. The manager
  // takes it as a factory instead of importing it, so a Host that never checks a source never loads the
  // network capability — and the module graph of the manager itself stays free of it.
  release=await import('./github-release.js');
 }catch(issue){
  const detail=issue instanceof Error?issue.message:String(issue);
  console.error('[suite] HOST_API_UNAVAILABLE: '+detail);
  throw new Error('HOST_API_UNAVAILABLE: this Suite cannot start on this DSH runtime ('+detail+')');
 }
 host.startHost(ctx,config,options=>new release.GitHubReleaseFetcher(options));
}