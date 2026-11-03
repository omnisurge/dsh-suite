import type { Context } from '@deepseek-ai/cordis';
import { credentialRef } from '@deepseek-ai/dsh-credentials';
import type {} from '@deepseek-ai/dsh-web';
import { snapshot, type Config } from './config.js';
import { SearxngSearchProvider } from './provider.js';
import {SearxngSetup,setupBuildSupported} from './setup.js';
import {registerWebSetupSkill,SKILL_NAME,SKILL_CONTENT,SKILL_DESCRIPTION} from './skill.js';
export { Config, snapshot } from './config.js';
export {SearxngSetup} from './setup.js';
export {SKILL_NAME,SKILL_CONTENT,SKILL_DESCRIPTION,registerWebSetupSkill} from './skill.js';
// The build stamp is part of the module's advertised surface: the capability gate reads it from the
// shipped artifact instead of trusting the build log.
export {setupBuildSupported} from './setup.js';
export type {SetupInspection, SetupCheck, SetupProbe, SetupConfiguration} from './types.js';
export { SearxngSearchProvider, SEARXNG_PROVIDER_ID } from './provider.js';
// The module's contract tests assert the shipped artifact, and the compiler's per-file outputs are not
// part of the owned generation (it stays flat), so the units they cover are exported here. The row
// loader only uses `apply`; extra exports change nothing at runtime.
export { isEndpoint } from './config.js';
export { mapSearxngResponse, MAX_RESPONSE_BYTES } from './provider.js';
export { effectiveEngineGroup, normalizeEngineGroup } from './engines.js';
export { SearxngSetupCore } from './setup-core.js';
export const name = 'omnisurge-web-search-searxng';
export const inject = ['web', 'credentials', 'tools'];
export function apply(ctx: Context, config: Config): void {
  const setupCallable=['inspect','check','checkSaved'].every(method=>typeof SearxngSetup.prototype[method as keyof SearxngSetup]==='function');
  const setupStamped=(setupBuildSupported as boolean)===true;
  const setupReady=setupStamped&&setupCallable;
  if(setupReady)new SearxngSetup(ctx,config);
  else ctx.logger.warn('SETUP_BUILD_UNSUPPORTED: diagnostic generation/version stamp missing; upgrade Suite builder and complete full build; search remains available');
  // The protocol and capability flags are stamped by the fixed build entry. An untransformed
  // placeholder or a false flag means the loaded Host cannot back the new UI and must not be
  // reported as a ready generation.
  // The loaded module also advertises the exact version it was built from: the Suite needs that to
  // tell "installed on disk" from "actually loaded", which is the restart-pending signal.
  ctx.provide('omnisurgeSearxngHostBuild', {version:'__OMNISURGE_PACKAGE_VERSION__',revision:'__OMNISURGE_HOST_REVISION__',protocol:'__OMNISURGE_BUILD_PROTOCOL__',capabilities:{hostStamped:setupStamped,hostRemote:setupReady}});
  const lifetime = new AbortController();
  ctx.effect(() => () => lifetime.abort(), 'searxng: cancel active requests on disable');
  ctx.web.registerSearchProvider(new SearxngSearchProvider({
    readConfig: () => snapshot(config),
    resolveCredential: async ref => (await ctx.credentials.resolve(credentialRef(ref)))?.value,
    lifetime: lifetime.signal,
    onFallback: event => ctx.logger.info('SEARXNG_FALLBACK', event),
    onDiagnosis: (diagnosis, attempt) => {
      if (diagnosis.notify) ctx.logger.warn('SEARXNG_DIAGNOSIS', { ...diagnosis, attempt });
    },
  }));
  // The deployment knowledge ships with the component instead of living in one machine's skill
  // directory. The official skill service is a profile-level service, so it is read defensively: a
  // profile without it keeps the search provider and loses only the guidance.
  const skills = ctx.get('skills') as {register?:(skill:{name:string;description:string;content:string})=>unknown}|undefined;
  if (typeof skills?.register === 'function') registerWebSetupSkill(skills);
  else ctx.logger.warn('SKILL_SERVICE_UNAVAILABLE: the carried setup skill "%s" was not registered because this profile provides no skill service', SKILL_NAME);
}
