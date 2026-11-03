/** Local skill directory scan: the roots the official filesystem provider reads, read directly.
 *
 * ADR-027: the desktop bundle disables the host skill-filesystem row and mounts discovery inside each
 * preset, so the registry's global layer (the only layer a Session-less page can read) has no filesystem
 * provider at all. The page therefore reads two facts: the registry segment (bundled/office/runtime and
 * any host-mounted provider) and this local segment, which is exactly what a preset's filesystem
 * discovery would find. Merging happens in skills-catalog.ts.
 *
 * Roots, source names and ranks mirror .ref/dsh-src/packages/skill/skill-filesystem/src/index.ts
 * (0.2.1-rc.3, identical to 0.2.1-rc.2): PROJECT_DSH_RANK=100, PROJECT_AGENTS_RANK=200, CUSTOM_RANK=300 (not scanned: the page has
 * no config for custom roots in 0.1.6), USER_DSH_RANK=400, USER_AGENTS_RANK=500, and the bundled root at
 * BUNDLED_SKILL_RANK=600 (registry segment only). Project roots exist only when a workspace cwd is given,
 * and user-dsh is the one root whose .system directory is skipped.
 *
 * Entry rules are the official discoverRoot rules: a root entry is a directory with SKILL.md or a flat
 * *.md file; frontmatter is the official one (skills-manage parseSkillMarkdown); the name must match the
 * official kebab grammar; name and description must be non-empty strings; the legacy invocation keys the
 * official parser rejects are rejected here too; anything unreadable or invalid is skipped, never fatal.
 * A missing root is an empty root. A resolved path leaving its root (symlink escape) is skipped, using the
 * same containment rule as the write path. Filesystem facts only: no cache, no index, no registry write.
 */
import {readFile,readdir,realpath,stat} from 'node:fs/promises';
import type {Dirent} from 'node:fs';
import {homedir} from 'node:os';
import {join,resolve} from 'node:path';
import {findSkillProjectRoot,invocationPolicyOf,isWithin,parseSkillMarkdown,resolveSkillDshHome} from './skills-manage.js';

const SKILL_FILE='SKILL.md';
const SYSTEM_DIRECTORY='.system';
const SKILL_NAME_PATTERN=/^[a-z0-9]+(-[a-z0-9]+)*$/;
/** The official parser rejects these outright (use disable-model-invocation / user-invocable), so a file
 * carrying them is not a skill this build can read. */
const LEGACY_INVOCATION_KEYS=['disableModelInvocation','modelInvocable','userInvocable'];

/** Rank constants from the official provider; 300 (custom) and 600 (bundled) are documented here because
 * this scan deliberately does not cover them. */
export const LOCAL_SKILL_RANKS={projectDsh:100,projectAgents:200,custom:300,userDsh:400,userAgents:500,bundled:600} as const;

export type LocalSkillSource='project-dsh'|'project-agents'|'user-dsh'|'user-agents';

/** One scanned skill file: a catalog row plus the facts that decided its place in the list. */
export interface LocalSkillEntry {
 name:string;
 description:string;
 whenToUse?:string;
 /** Absolute real path of the skill file (SKILL.md in a bundle, the flat file otherwise). */
 path:string;
 provider:'filesystem';
 source:LocalSkillSource;
 modelInvocable:boolean;
 userInvocable:boolean;
 rank:number;
}

export interface LocalSkillsRead {skills:LocalSkillEntry[];complete:boolean;}

export interface LocalSkillsOptions {
 /** Workspace selector: only a supplied cwd contributes project roots. */
 cwd?:string;
 /** Harness home override; defaults like the official resolveDshHome ($DSH_HOME or ~/.dsh). */
 dshHome?:string;
 /** Shared agent home override; defaults like the official resolveAgentsHome ($DSH_AGENTS_HOME or ~/.agents). */
 agentsHome?:string;
 signal?:AbortSignal;
}

/** One local root before scanning. */
export interface LocalSkillRoot {path:string;source:LocalSkillSource;rank:number;skipSystem:boolean;}

function codeOf(error:unknown):string|undefined {
 return typeof error==='object'&&error!==null&&typeof (error as NodeJS.ErrnoException).code==='string'?(error as NodeJS.ErrnoException).code:undefined;
}

function isAbsent(error:unknown):boolean {
 const code=codeOf(error);
 return code==='ENOENT'||code==='ENOTDIR';
}

function expandHome(path:string):string {
 if(path==='~')return homedir();
 if(path.startsWith('~/')||path.startsWith('~\\'))return join(homedir(),path.slice(2));
 return path;
}

/** Same precedence as the official resolveAgentsHome in .ref/dsh-src/packages/util/home-paths/src/index.ts:
 * explicit path, non-blank DSH_AGENTS_HOME, then ~/.agents. An empty root must never resolve to the cwd. */
export function resolveLocalAgentsHome(configured?:string,env:NodeJS.ProcessEnv=process.env):string {
 const fromEnv=env.DSH_AGENTS_HOME;
 const selected=configured??(fromEnv!==undefined&&fromEnv.trim().length>0?fromEnv:join(homedir(),'.agents'));
 return resolve(expandHome(selected));
}

/** The four roots this scan owns, in official rank order; project roots only with a workspace selector. */
export async function resolveLocalSkillRoots(options:{cwd?:string;dshHome?:string;agentsHome?:string}={}):Promise<LocalSkillRoot[]>{
 const roots:LocalSkillRoot[]=[];
 const cwd=typeof options.cwd==='string'&&options.cwd.trim().length>0?options.cwd:undefined;
 if(cwd!==undefined){
  const projectRoot=await findSkillProjectRoot(cwd);
  roots.push({path:join(projectRoot,'.dsh','skills'),source:'project-dsh',rank:LOCAL_SKILL_RANKS.projectDsh,skipSystem:false});
  roots.push({path:join(projectRoot,'.agents','skills'),source:'project-agents',rank:LOCAL_SKILL_RANKS.projectAgents,skipSystem:false});
 }
 roots.push({path:join(resolveSkillDshHome(options.dshHome),'skills'),source:'user-dsh',rank:LOCAL_SKILL_RANKS.userDsh,skipSystem:true});
 roots.push({path:join(resolveLocalAgentsHome(options.agentsHome),'skills'),source:'user-agents',rank:LOCAL_SKILL_RANKS.userAgents,skipSystem:false});
 return roots;
}

/** Follow one root entry the way the official nodeEntryKind does: a directory, a regular file, or a
 * symbolic link to either; special files are not skills. */
async function entryKind(path:string,entry:Dirent):Promise<'directory'|'file'|undefined>{
 if(entry.isDirectory())return 'directory';
 if(entry.isFile())return 'file';
 if(!entry.isSymbolicLink())return undefined;
 try{
  const info=await stat(path);
  if(info.isDirectory())return 'directory';
  if(info.isFile())return 'file';
  return undefined;
 }catch{
  return undefined;
 }
}

/** Read one candidate file through its real path; undefined means "not a readable skill in this root". */
async function scanSkillFile(path:string,root:LocalSkillRoot,realRoot:string,signal?:AbortSignal):Promise<LocalSkillEntry|undefined>{
 let resolved:string;
 try{
  resolved=await realpath(path);
 }catch{
  return undefined;
 }
 // A symlink inside the root that resolves outside must not be read (same containment rule as writes).
 if(!isWithin(realRoot,resolved))return undefined;
 let raw:string;
 try{
  raw=await readFile(resolved,'utf8');
 }catch{
  return undefined;
 }
 signal?.throwIfAborted();
 const parsed=parseSkillMarkdown(raw);
 if(parsed===undefined)return undefined;
 const data=parsed.data;
 const name=data.name,description=data.description;
 if(typeof name!=='string'||name.length===0||!SKILL_NAME_PATTERN.test(name))return undefined;
 if(typeof description!=='string'||description.length===0)return undefined;
 if(LEGACY_INVOCATION_KEYS.some(key=>Object.hasOwn(data,key)))return undefined;
 const whenToUse=typeof data.whenToUse==='string'&&data.whenToUse.length>0?data.whenToUse:undefined;
 const policy=invocationPolicyOf(data);
 return {
  name,
  description,
  ...(whenToUse===undefined?{}:{whenToUse}),
  path:resolved,
  provider:'filesystem',
  source:root.source,
  modelInvocable:policy.modelInvocable,
  userInvocable:policy.userInvocable,
  rank:root.rank,
 };
}

/** Scan one root. An absent root is empty; an unreadable one proves the scan incomplete, never throws. */
async function scanLocalRoot(root:LocalSkillRoot,signal?:AbortSignal):Promise<{skills:LocalSkillEntry[];complete:boolean}>{
 let entries:Dirent[];
 try{
  entries=await readdir(root.path,{withFileTypes:true});
 }catch(error){
  return {skills:[],complete:isAbsent(error)};
 }
 let realRoot:string;
 try{
  realRoot=await realpath(root.path);
 }catch{
  return {skills:[],complete:false};
 }
 entries.sort((left,right)=>left.name.localeCompare(right.name));
 const skills:LocalSkillEntry[]=[];
 for(const entry of entries){
  signal?.throwIfAborted();
  if(root.skipSystem&&entry.name===SYSTEM_DIRECTORY)continue;
  const full=join(root.path,entry.name);
  const kind=await entryKind(full,entry);
  if(kind==='directory'){
   const skill=await scanSkillFile(join(full,SKILL_FILE),root,realRoot,signal);
   if(skill!==undefined)skills.push(skill);
  }else if(kind==='file'&&entry.name.endsWith('.md')){
   const skill=await scanSkillFile(full,root,realRoot,signal);
   if(skill!==undefined)skills.push(skill);
  }
 }
 return {skills,complete:true};
}

/** Rank then name, one row per name: the lowest-ranked root wins a duplicate, exactly as the registry's
 * layer precedence resolves it. */
function orderLocalSkills(skills:LocalSkillEntry[]):LocalSkillEntry[]{
 const ordered=[...skills].sort((left,right)=>left.rank-right.rank||left.name.localeCompare(right.name));
 const seen=new Set<string>();
 return ordered.filter(skill=>{
  if(seen.has(skill.name))return false;
  seen.add(skill.name);
  return true;
 });
}

/** Read every local root this build scans. Root failures degrade complete; only cancellation rejects. */
export async function readLocalSkills(options:LocalSkillsOptions={}):Promise<LocalSkillsRead>{
 options.signal?.throwIfAborted();
 const roots=await resolveLocalSkillRoots(options);
 const collected:LocalSkillEntry[]=[];
 let complete=true;
 for(const root of roots){
  options.signal?.throwIfAborted();
  const scanned=await scanLocalRoot(root,options.signal);
  complete&&=scanned.complete;
  collected.push(...scanned.skills);
 }
 return {skills:orderLocalSkills(collected),complete};
}
