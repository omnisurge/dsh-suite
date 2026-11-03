import {RemoteError} from '@deepseek-ai/dsh-typert-protocol';
import type {} from '@deepseek-ai/dsh-typert-protocol/types';
import type {SkillCatalogEntry,SkillRoots,SkillsCatalog} from './types.js';
import type {LocalSkillEntry,LocalSkillsRead,LocalSkillRoot} from './skills-local.js';
import {readLocalSkills,resolveLocalSkillRoots} from './skills-local.js';
export type {SkillCatalogEntry,SkillsCatalog} from './types.js';

/** The failure codes this reader owns, declared in the protocol's own code map. A plain Error is
 * collapsed by the gateway into 'gateway/internal' (only the structural RemoteError marker keeps a code
 * across the wire), so the codes and the sentences on the page would drift apart without this declaration. */
declare module '@deepseek-ai/dsh-typert-protocol/types'{
 interface RemoteErrorDetailsMap{
  'skills/registry-unavailable':{};
  'skills/registry-response-invalid':{};
  // Write path (ADR-026). Codes are owned here so the reader and the writer never disagree about the
  // names that cross the wire; the Client turns each one into a sentence in its own dictionary.
  'skills/name-taken':{};
  'skills/not-editable':{};
  'skills/invalid-draft':{};
  'skills/path-escape':{};
  'skills/write-failed':{};
 }
}
const registryUnavailable=()=>new RemoteError('skills/registry-unavailable','SKILL_REGISTRY_UNAVAILABLE: the skill registry service is not mounted',{});
const registryAnswerUnreadable=()=>new RemoteError('skills/registry-response-invalid','SKILL_REGISTRY_RESPONSE_INVALID: the skill registry answered a catalog this page cannot read',{});

/** The public Summary surface these rows are transported from; only the carried fields are named. */
interface SkillSummary {
 name:string;
 description:string;
 whenToUse?:string;
 path?:string;
 provider:string;
 source?:string;
 invocation?:{modelInvocable?:boolean;userInvocable?:boolean}|null;
}

/** The three fields every official Summary guarantees; without them a row cannot be described at all. */
const isSummary=(value:unknown):boolean=>{
 if(value===null||typeof value!=='object')return false;
 const row=value as Record<string,unknown>;
 return typeof row.name==='string'&&typeof row.description==='string'&&typeof row.provider==='string';
};

/** Absent, non-string and empty values all mean "not declared"; an empty string is never a value. */
const declared=(value:unknown):string|undefined=>typeof value==='string'&&value.length>0?value:undefined;

/** Only facts the official registry published are transported: no inferred values, no renamed fields.
 * A summary without a declared invocation policy keeps that fact undeclared (false/false), and the Client
 * shows that row as "not callable" rather than guessing a policy the registry never declared. */
export function toCatalogEntry(summary:SkillSummary):SkillCatalogEntry{
 const entry:SkillCatalogEntry={
  name:summary.name,
  description:summary.description,
  provider:summary.provider,
  modelInvocable:summary.invocation?.modelInvocable===true,
  userInvocable:summary.invocation?.userInvocable===true,
 };
 const whenToUse=declared(summary.whenToUse),path=declared(summary.path),source=declared(summary.source);
 if(whenToUse!==undefined)entry.whenToUse=whenToUse;
 if(path!==undefined)entry.path=path;
 if(source!==undefined)entry.source=source;
 return entry;
}

/** The registry segment: the official global layer, whose order is kept as-is (the registry already sorts
 * by name; re-sorting here would be a second fact). This is the only registry layer a Session-less page
 * can read; preset layers need an agent or preset ScopeKey (ADR-027). */
async function readRegistrySegment(registry:unknown,options:{cwd?:string;signal?:AbortSignal}):Promise<SkillsCatalog>{
 const service=registry as {snapshot?:(request:{cwd?:string;signal?:AbortSignal})=>Promise<unknown>}|null|undefined;
 if(!service||typeof service.snapshot!=='function')throw registryUnavailable();
 const cwd=declared(options.cwd);
 const snapshot=await service.snapshot({...(cwd===undefined?{}:{cwd}),...(options.signal?{signal:options.signal}:{})}) as {skills?:unknown;complete?:unknown}|null|undefined;
 if(!snapshot||typeof snapshot!=='object'||!Array.isArray(snapshot.skills))throw registryAnswerUnreadable();
 // A row this page cannot describe is a named failure, not a partial list: dropping it would silently
 // understate what the Host discovered, and a TypeError would reach the gateway as an unnamed fault.
 for(const summary of snapshot.skills)if(!isSummary(summary))throw registryAnswerUnreadable();
 // The registry segment carries no roots of its own; the merged catalog fills them in from the scan.
 return {skills:snapshot.skills.map(summary=>toCatalogEntry(summary as SkillSummary)),complete:snapshot.complete===true,roots:{}};
}

/** Local rows are already catalog facts; only the rank is dropped, because the merged list is ordered here. */
function toEntryFromLocal(skill:LocalSkillEntry):SkillCatalogEntry{
 const entry:SkillCatalogEntry={
  name:skill.name,
  description:skill.description,
  path:skill.path,
  provider:skill.provider,
  source:skill.source,
  modelInvocable:skill.modelInvocable,
  userInvocable:skill.userInvocable,
 };
 if(skill.whenToUse!==undefined)entry.whenToUse=skill.whenToUse;
 return entry;
}

/** The one read path is two facts (ADR-027): the registry's global layer (bundled/office/runtime and any
 * host-mounted provider) and this build's own scan of the four local roots a preset's filesystem discovery
 * would read. Local rows come first (rank then name) because a preset layer shadows the global layer, so
 * the local segment wins a same-name merge; registry rows keep their own order after it. Discovery is
 * complete only when both segments are: either one coming up short means the page shows its warn line.
 *
 * A segment that cannot be read does not fail the page: the catalog degrades to the other segment with
 * complete:false, which the Client already renders as its incomplete-discovery line. Only when BOTH
 * segments are unreadable does the read fail, with the registry's named code (the local scan itself
 * reports per-root failures as complete:false and only rejects on cancellation, so this guard covers a
 * future throwing implementation, not a reachable state today). */
export async function readSkillsCatalog(registry:unknown,options?:{cwd?:string;dshHome?:string;signal?:AbortSignal}):Promise<SkillsCatalog>{
 // Cancellation is checked before either side is touched: an aborted caller must not reach snapshot or disk.
 options?.signal?.throwIfAborted();
 let registrySegment:SkillsCatalog|undefined,registryFailure:unknown;
 try{
  registrySegment=await readRegistrySegment(registry,{cwd:options?.cwd,...(options?.signal?{signal:options.signal}:{})});
 }catch(error){
  if(options?.signal?.aborted)throw error;
  registryFailure=error;
 }
 let localSegment:LocalSkillsRead|undefined,localFailure:unknown;
 try{
  localSegment=await readLocalSkills({...(options?.cwd===undefined?{}:{cwd:options.cwd}),...(options?.dshHome===undefined?{}:{dshHome:options.dshHome}),...(options?.signal?{signal:options.signal}:{})});
 }catch(error){
  if(options?.signal?.aborted)throw error;
  localFailure=error;
 }
 if(registrySegment===undefined&&localSegment===undefined)throw registryFailure??localFailure;
 // The roots are a display fact, not a discovery result: resolving them must never turn a readable catalog
 // into a failure, so a resolver error degrades to "root unknown" (the page then offers the user scope only).
 let roots:SkillRoots={};
 try{
  roots=rootsOf(await resolveLocalSkillRoots({...(options?.cwd===undefined?{}:{cwd:options.cwd}),...(options?.dshHome===undefined?{}:{dshHome:options.dshHome})}));
 }catch(error){
  if(options?.signal?.aborted)throw error;
 }
 const localEntries=(localSegment?.skills??[]).map(toEntryFromLocal);
 const localNames=new Set(localEntries.map(entry=>entry.name));
 const registryEntries=(registrySegment?.skills??[]).filter(entry=>!localNames.has(entry.name));
 return {
  skills:[...localEntries,...registryEntries],
  complete:(registrySegment?.complete??false)&&(localSegment?.complete??false),
  roots,
 };
}

/** Map the scanned roots onto the two facts the page may show. Only the writable roots are surfaced: the
 * `.agents` roots and bundled skills are read-only and already carry their absolute path per row. */
function rootsOf(roots:readonly LocalSkillRoot[]):SkillRoots{
 const out:SkillRoots={};
 for(const root of roots){
  if(root.source==='user-dsh'&&out.user===undefined)out.user=root.path;
  if(root.source==='project-dsh'&&out.project===undefined)out.project=root.path;
 }
 return out;
}
