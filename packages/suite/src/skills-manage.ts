/** Skill write path: create, edit, and retire skills in the two roots the official filesystem provider
 * actually scans.
 *
 * Roots (verified against 0.2.1-rc.3; the provider source is identical in rc.2 and rc.3): user = DSH_HOME/skills (DSH_HOME defaults to ~/.dsh, a blank env
 * value is treated as unset, same precedence as the official resolveDshHome) and project =
 * <project>/.dsh/skills, where <project> is the first ancestor of cwd containing .git (cwd itself when
 * none) — the official findProjectRoot rule in .ref/dsh-src/packages/skill/skill-filesystem/src/index.ts
 * (0.2.1-rc.3). package.json is deliberately not a root marker: a skill written where the provider does
 * not scan is silently invisible. Unverified: Windows drive-letter/UNC traversal uses the same rule with
 * path semantics and was not run on Windows.
 *
 * Writes are atomic (temporary file in the target directory + rename), an update keeps
 * <file>.omnisurge-backup, and the written file is re-read and re-parsed before the mutation is
 * reported. Removal moves the skill into <root>/.omnisurge-trash/<stamp>-<name>/, so it stays
 * recoverable. Frontmatter keys this form does not own (and their comments) are preserved unchanged.
 *
 * Containment is one rule, not two: isWithin is exported and reused by the local read scan
 * (skills-local.ts, ADR-027), so a read and a write can never disagree about what lies inside a root.
 *
 * Frontmatter is the official reader's YAML: switches are the canonical disable-model-invocation: true
 * and user-invocable: false; the legacy keys the official parser rejects are never written. */
import {RemoteError} from '@deepseek-ai/dsh-typert-protocol';
import type {} from '@deepseek-ai/dsh-typert-protocol/types';
import {copyFile,mkdir,readFile,readdir,realpath,rename,rm,stat,unlink,writeFile} from 'node:fs/promises';
import type {Dirent} from 'node:fs';
import {basename,dirname,isAbsolute,join,relative,resolve,sep} from 'node:path';
import {Document,isMap,parse,parseDocument} from 'yaml';
import {resolveDshHome} from './dsh-home.js';
import type {SkillDocument,SkillDraft,SkillMutation,SkillScope} from './types.js';
export type {SkillDocument,SkillDraft,SkillMutation,SkillScope} from './types.js';

const SKILL_NAME_PATTERN=/^[a-z0-9]+(-[a-z0-9]+)*$/;
const SKILL_FILE='SKILL.md';
const TRASH_DIRECTORY='.omnisurge-trash';
const BACKUP_SUFFIX='.omnisurge-backup';
const SYSTEM_DIRECTORY='.system';
const LEGACY_KEYS=['disableModelInvocation','modelInvocable','userInvocable'];

const nameTaken=()=>new RemoteError('skills/name-taken','SKILL_NAME_TAKEN: a skill with this name already exists in this scope',{});
const notEditable=()=>new RemoteError('skills/not-editable','SKILL_NOT_EDITABLE: no writable skill file matches this name in the selected scope',{});
const invalidDraft=(detail:string)=>new RemoteError('skills/invalid-draft','SKILL_INVALID_DRAFT: '+detail,{});
const pathEscape=()=>new RemoteError('skills/path-escape','SKILL_PATH_ESCAPE: the resolved path is outside the skill root',{});
const writeFailed=()=>new RemoteError('skills/write-failed','SKILL_WRITE_FAILED: the skill file was not changed',{});

/** The registry surface this module accepts; the Host passes ctx.skills. Mutations do not wait on it:
 * a verified file commit is the live fact for the filesystem provider. */
export interface SkillRegistryLike {
 snapshot(options?:{cwd?:string;signal?:AbortSignal}):Promise<unknown>;
}

export interface SkillContext {
 /** Workspace selector; the same value listSkills receives, used to find the project root. */
 cwd?:string;
 /** Harness config root; defaults like the official resolveDshHome. */
 dshHome?:string;
 skills?:SkillRegistryLike;
 signal?:AbortSignal;
}

export interface SkillRoots {user:string;project:string|null;}

export interface ParsedSkillMarkdown {frontmatter:string;data:Record<string,unknown>;body:string;}

export interface SkillInvocationPolicy {modelInvocable:boolean;userInvocable:boolean;}

interface NormalizedSkill {
 name:string;
 description:string;
 whenToUse?:string;
 body:string;
 modelInvocable:boolean;
 userInvocable:boolean;
 scope:SkillScope;
}

interface LocatedSkill {
 path:string;
 directory:string;
 bundle:boolean;
 name:string;
 data:Record<string,unknown>;
 frontmatter:string;
 body:string;
}

/** A verified file commit is the live fact: the filesystem provider re-scans on watch invalidation and
 * has no separate reload step to await, so this provider never reports pending. */
const LIVE='live' as const;

function codeOf(error:unknown):string|undefined {
 return typeof error==='object'&&error!==null&&typeof (error as NodeJS.ErrnoException).code==='string'?(error as NodeJS.ErrnoException).code:undefined;
}

/** Same precedence as the official resolveDshHome. The implementation lives in dsh-home.ts so the
 * fetched-release root cannot drift from the skills roots (review 0.2.2-1 F1). */
const resolveSkillDshHome=resolveDshHome;
export {resolveSkillDshHome};

async function pathExists(path:string):Promise<boolean> {
 try{
  await stat(path);
  return true;
 }catch{
  // Absence is the expected answer while walking toward the filesystem root; any other stat failure
  // makes this candidate unusable, exactly as the official pathExists treats it.
  return false;
 }
}

/** The official project-root rule: the first ancestor of cwd that contains .git, else cwd itself. */
export async function findSkillProjectRoot(cwd:string):Promise<string> {
 const start=resolve(cwd);
 let current=start;
 for(;;){
  if(await pathExists(join(current,'.git')))return current;
  const parent=dirname(current);
  if(parent===current)return start;
  current=parent;
 }
}

/** The two writable roots; the project root is null when no workspace directory was supplied. */
export async function resolveSkillRoots(ctx:{cwd?:string;dshHome?:string}):Promise<SkillRoots> {
 const user=join(resolveSkillDshHome(ctx.dshHome),'skills');
 const cwd=typeof ctx.cwd==='string'&&ctx.cwd.trim().length>0?ctx.cwd:undefined;
 return {user,project:cwd===undefined?null:join(await findSkillProjectRoot(cwd),'.dsh','skills')};
}

function scopeOf(value:unknown):SkillScope {
 if(value==='user'||value==='project')return value;
 throw invalidDraft('scope must be user or project');
}

function rootOf(roots:SkillRoots,scope:SkillScope):string|null {
 return scope==='project'?roots.project:roots.user;
}

function requireRoot(roots:SkillRoots,scope:SkillScope):string {
 const root=rootOf(roots,scope);
 if(root===null)throw invalidDraft('the project scope needs a workspace directory');
 return root;
}

/** Path containment shared with the local read scan (skills-local.ts): one relative-path rule, so a
 * write and a read can never disagree about what "inside the root" means. */
export function isWithin(root:string,target:string):boolean {
 const child=relative(root,target);
 return child===''||(child!=='..'&&!child.startsWith('..'+sep)&&!isAbsolute(child));
}

/** Refuse any resolved path that leaves its root: a symlink inside a skill root must not become a write
 * or a read outside it. */
async function assertInsideRoot(root:string,target:string):Promise<void> {
 const realRoot=await realpath(root),realTarget=await realpath(target);
 if(!isWithin(realRoot,realTarget))throw pathEscape();
}

/** Split a SKILL.md into frontmatter and body with the official delimiters (a first line of exactly
 * three dashes, a closing line of exactly three dashes), so files this module writes are read back
 * unchanged by the official provider. */
export function parseSkillMarkdown(raw:string):ParsedSkillMarkdown|undefined {
 const firstBreak=raw.indexOf('\n');
 if(firstBreak<0)return undefined;
 if(raw.slice(0,firstBreak).replace(/\r$/,'')!=='---')return undefined;
 const start=firstBreak+1,closing=closingFrontmatter(raw,start);
 if(closing===undefined)return undefined;
 const frontmatter=raw.slice(start,closing.start);
 let data:unknown;
 try{
  data=parse(frontmatter);
 }catch{
  // Unparsable YAML is "not a skill this build can read"; callers report it as not editable.
  return undefined;
 }
 if(typeof data!=='object'||data===null||Array.isArray(data))return undefined;
 return {frontmatter,data:data as Record<string,unknown>,body:raw.slice(closing.bodyStart)};
}

function closingFrontmatter(raw:string,start:number):{start:number;bodyStart:number}|undefined {
 let lineStart=start;
 while(lineStart<=raw.length){
  const nextBreak=raw.indexOf('\n',lineStart);
  const lineEnd=nextBreak<0?raw.length:nextBreak;
  if(raw.slice(lineStart,lineEnd).replace(/\r$/,'')==='---')return {start:lineStart,bodyStart:nextBreak<0?raw.length:nextBreak+1};
  if(nextBreak<0)return undefined;
  lineStart=nextBreak+1;
 }
 return undefined;
}

function frontmatterBoolean(value:unknown):boolean|undefined {
 if(typeof value==='boolean')return value;
 if(value===1||value==='1')return true;
 if(value===0||value==='0')return false;
 if(typeof value==='string'){
  switch(value.toLowerCase()){
   case 'true':case 'yes':case 'on':return true;
   case 'false':case 'no':case 'off':return false;
  }
 }
 return undefined;
}

/** The official mapping: model invocation is on unless disable-model-invocation is true, user invocation
 * is on unless user-invocable is false. The rejected legacy keys never define a policy. */
export function invocationPolicyOf(data:Record<string,unknown>):SkillInvocationPolicy {
 return {modelInvocable:frontmatterBoolean(data['disable-model-invocation'])!==true,userInvocable:frontmatterBoolean(data['user-invocable'])!==false};
}

/** Build the frontmatter block. With previous, every key this form does not own (and its comments)
 * survives unchanged; the four owned fields are rewritten and the legacy keys removed. */
export function renderSkillFrontmatter(draft:NormalizedSkill,previous?:string):string {
 const doc=previous===undefined?new Document({}):parseDocument(previous);
 if(doc.errors.length>0)throw invalidDraft('the existing frontmatter is not valid YAML');
 if(doc.contents!==null&&!isMap(doc.contents))throw invalidDraft('the existing frontmatter is not a YAML mapping');
 const own=(key:string,value:string|boolean|undefined):void=>{
  if(value===undefined)doc.delete(key);
  else doc.set(key,value);
 };
 own('name',draft.name);
 own('description',draft.description);
 own('whenToUse',draft.whenToUse);
 own('disable-model-invocation',draft.modelInvocable?undefined:true);
 own('user-invocable',draft.userInvocable?undefined:false);
 for(const legacy of LEGACY_KEYS)doc.delete(legacy);
 const text=String(doc).trimEnd();
 if(text.length===0)throw invalidDraft('the rendered frontmatter is empty');
 return text;
}

/** Assemble a complete SKILL.md. The body is normalised to LF without trailing blank lines; the official
 * reader trims the body, so this keeps the file round-trippable. */
export function renderSkillMarkdown(frontmatter:string,body:string):string {
 const content=body.replace(/\r\n?/g,'\n').replace(/\n+$/,'');
 return '---\n'+frontmatter+'\n---\n'+(content.length>0?content+'\n':'');
}

function normalizeName(value:unknown):string {
 const name=typeof value==='string'?value.trim():'';
 if(!SKILL_NAME_PATTERN.test(name))throw invalidDraft('name must match ^[a-z0-9]+(-[a-z0-9]+)*$');
 return name;
}

function normalizeDraft(draft:SkillDraft,defaults:{scope:SkillScope;policy:SkillInvocationPolicy}):NormalizedSkill {
 if(draft===null||typeof draft!=='object')throw invalidDraft('a skill draft is required');
 const name=normalizeName(draft.name);
 const description=typeof draft.description==='string'?draft.description:'';
 if(description.trim().length===0)throw invalidDraft('description is required');
 const whenToUse=typeof draft.whenToUse==='string'&&draft.whenToUse.trim().length>0?draft.whenToUse:undefined;
 const body=typeof draft.body==='string'?draft.body:'';
 const modelInvocable=typeof draft.modelInvocable==='boolean'?draft.modelInvocable:defaults.policy.modelInvocable;
 const userInvocable=typeof draft.userInvocable==='boolean'?draft.userInvocable:defaults.policy.userInvocable;
 const scope=draft.scope===undefined?defaults.scope:scopeOf(draft.scope);
 return {name,description,whenToUse,body,modelInvocable,userInvocable,scope};
}

function skillNameOf(data:Record<string,unknown>):string|undefined {
 return typeof data.name==='string'?data.name:undefined;
}

async function readParsed(path:string):Promise<ParsedSkillMarkdown|undefined> {
 try{
  return parseSkillMarkdown(await readFile(path,'utf8'));
 }catch{
  // A missing or unreadable skill file is not a candidate; discovery in the official provider does the same.
  return undefined;
 }
}

async function kindOf(path:string,entry:Dirent):Promise<'directory'|'file'|null> {
 try{
  if(entry.isDirectory())return 'directory';
  if(entry.isFile())return 'file';
  if(!entry.isSymbolicLink())return null;
  const info=await stat(path);
  return info.isDirectory()?'directory':info.isFile()?'file':null;
 }catch{
  return null;
 }
}

async function locatedSkill(root:string,path:string,bundle:boolean,parsed:ParsedSkillMarkdown):Promise<LocatedSkill> {
 const realRoot=await realpath(root),realPath=await realpath(path);
 if(!isWithin(realRoot,realPath))throw pathEscape();
 return {
  path:realPath,
  directory:bundle?dirname(realPath):realRoot,
  bundle,
  name:skillNameOf(parsed.data)??'',
  data:parsed.data,
  frontmatter:parsed.frontmatter,
  body:parsed.body,
 };
}

/** Find the one skill file whose frontmatter name matches, scanning the root the way the official
 * provider does (directory bundles with SKILL.md, flat *.md files). */
async function locateSkill(root:string,name:string,scope:SkillScope):Promise<LocatedSkill|null> {
 let entries:Dirent[];
 try{
  entries=await readdir(root,{withFileTypes:true});
 }catch(error){
  if(codeOf(error)==='ENOENT'||codeOf(error)==='ENOTDIR')return null;
  throw notEditable();
 }
 entries.sort((left,right)=>left.name.localeCompare(right.name));
 for(const entry of entries){
  if(entry.name===TRASH_DIRECTORY)continue;
  if(entry.name===SYSTEM_DIRECTORY&&scope==='user')continue;
  const full=join(root,entry.name),kind=await kindOf(full,entry);
  if(kind==='directory'){
   const path=join(full,SKILL_FILE),parsed=await readParsed(path);
   if(parsed&&skillNameOf(parsed.data)===name)return await locatedSkill(root,path,true,parsed);
   continue;
  }
  if(kind==='file'&&entry.name.endsWith('.md')){
   const parsed=await readParsed(full);
   if(parsed&&skillNameOf(parsed.data)===name)return await locatedSkill(root,full,false,parsed);
  }
 }
 return null;
}

function matchesDraft(parsed:ParsedSkillMarkdown,expected:NormalizedSkill):boolean {
 const policy=invocationPolicyOf(parsed.data),whenToUse=typeof parsed.data.whenToUse==='string'?parsed.data.whenToUse:undefined;
 return parsed.data.name===expected.name
  &&parsed.data.description===expected.description
  &&whenToUse===expected.whenToUse
  &&policy.modelInvocable===expected.modelInvocable
  &&policy.userInvocable===expected.userInvocable
  &&parsed.body.trim()===expected.body.replace(/\r\n?/g,'\n').trim();
}

/** Write atomically, then prove the landed file parses to the draft; any failure restores the backup
 * (or removes the file this call created) so a failed write never leaves a half-edited skill. */
async function writeVerified(path:string,text:string,expected:NormalizedSkill,backup:boolean):Promise<void> {
 const directory=dirname(path);
 const temporary=join(directory,'.'+basename(path)+'.omnisurge-'+String(process.pid)+'.tmp');
 const backupPath=path+BACKUP_SUFFIX;
 let hadFile=false;
 if(backup){
  try{
   await copyFile(path,backupPath);
   hadFile=true;
  }catch(error){
   if(codeOf(error)!=='ENOENT')throw writeFailed();
  }
 }
 try{
  await writeFile(temporary,text,'utf8');
  await rename(temporary,path);
  const landed=parseSkillMarkdown(await readFile(path,'utf8'));
  if(!landed||!matchesDraft(landed,expected))throw writeFailed();
 }catch(error){
  await unlink(temporary).catch(()=>undefined);
  if(hadFile)await copyFile(backupPath,path).catch(()=>undefined);
  else await unlink(path).catch(()=>undefined);
  if(error instanceof RemoteError)throw error;
  throw writeFailed();
 }
}

/** Move into the trash; a cross-device rename (bind mount, separate volume) falls back to copy+remove. */
async function movePath(source:string,destination:string):Promise<void> {
 try{
  await rename(source,destination);
  return;
 }catch(error){
  if(codeOf(error)!=='EXDEV')throw writeFailed();
 }
 try{
  await rm(destination,{recursive:true,force:true});
  await copyTree(source,destination);
  await rm(source,{recursive:true,force:true});
 }catch{
  throw writeFailed();
 }
}

async function copyTree(source:string,destination:string):Promise<void> {
 const info=await stat(source);
 if(!info.isDirectory()){
  await mkdir(dirname(destination),{recursive:true});
  await copyFile(source,destination);
  return;
 }
 await mkdir(destination,{recursive:true});
 for(const entry of await readdir(source,{withFileTypes:true}))await copyTree(join(source,entry.name),join(destination,entry.name));
}

async function uniqueTrashPath(base:string):Promise<string> {
 if(!(await pathExists(base)))return base;
 for(let index=2;index<1000;index+=1){
  const candidate=base+'-'+String(index);
  if(!(await pathExists(candidate)))return candidate;
 }
 throw writeFailed();
}

export async function readSkill(ctx:SkillContext,name:string,scope?:SkillScope):Promise<SkillDocument> {
 ctx.signal?.throwIfAborted();
 const target=normalizeName(name);
 const roots=await resolveSkillRoots(ctx);
 // Explicit scope reads only that root; without one the user root wins, then the project root.
 const scopes:SkillScope[]=scope===undefined?['user','project']:[scopeOf(scope)];
 for(const candidate of scopes){
  const root=rootOf(roots,candidate);
  if(root===null)continue;
  const located=await locateSkill(root,target,candidate);
  if(located===null)continue;
  const whenToUse=typeof located.data.whenToUse==='string'&&located.data.whenToUse.length>0?located.data.whenToUse:undefined;
  return {
   name:target,
   description:typeof located.data.description==='string'?located.data.description:'',
   ...(whenToUse===undefined?{}:{whenToUse}),
   body:located.body.trim(),
   ...invocationPolicyOf(located.data),
   scope:candidate,
   path:located.path,
   editable:true,
  };
 }
 throw notEditable();
}

export async function createSkill(ctx:SkillContext,draft:SkillDraft):Promise<SkillMutation> {
 ctx.signal?.throwIfAborted();
 const normalized=normalizeDraft(draft,{scope:'user',policy:{modelInvocable:true,userInvocable:true}});
 const roots=await resolveSkillRoots(ctx);
 const root=requireRoot(roots,normalized.scope);
 if(await locateSkill(root,normalized.name,normalized.scope))throw nameTaken();
 if(await pathExists(join(root,normalized.name+'.md')))throw nameTaken();
 await mkdir(root,{recursive:true});
 const directory=join(root,normalized.name);
 const existed=await pathExists(directory);
 try{
  await mkdir(directory,{recursive:true});
 }catch(error){
  const code=codeOf(error);
  if(code==='EEXIST'||code==='ENOTDIR')throw nameTaken();
  throw writeFailed();
 }
 await assertInsideRoot(root,directory);
 const path=join(directory,SKILL_FILE);
 if(await pathExists(path))throw nameTaken();
 const text=renderSkillMarkdown(renderSkillFrontmatter(normalized),normalized.body);
 try{
  await writeVerified(path,text,normalized,false);
 }catch(error){
  await unlink(path).catch(()=>undefined);
  if(!existed)await rm(directory,{recursive:true,force:true}).catch(()=>undefined);
  throw error;
 }
 return {mode:'created',name:normalized.name,scope:normalized.scope,applied:LIVE};
}

export async function updateSkill(ctx:SkillContext,name:string,draft:SkillDraft):Promise<SkillMutation> {
 ctx.signal?.throwIfAborted();
 const target=normalizeName(name);
 const scope=draft!==null&&typeof draft==='object'&&draft.scope!==undefined?scopeOf(draft.scope):'user';
 const roots=await resolveSkillRoots(ctx);
 const root=requireRoot(roots,scope);
 const located=await locateSkill(root,target,scope);
 if(located===null)throw notEditable();
 const normalized=normalizeDraft(draft,{scope,policy:invocationPolicyOf(located.data)});
 if(normalized.name!==target)throw invalidDraft('renaming a skill is not supported; create a new skill instead');
 const text=renderSkillMarkdown(renderSkillFrontmatter(normalized,located.frontmatter),normalized.body);
 await writeVerified(located.path,text,normalized,true);
 return {mode:'updated',name:normalized.name,scope,applied:LIVE};
}

export async function removeSkill(ctx:SkillContext,name:string,scope?:SkillScope):Promise<SkillMutation> {
 ctx.signal?.throwIfAborted();
 const target=normalizeName(name);
 const selected=scope===undefined?'user':scopeOf(scope);
 const roots=await resolveSkillRoots(ctx);
 const root=requireRoot(roots,selected);
 const located=await locateSkill(root,target,selected);
 if(located===null)throw notEditable();
 const trashRoot=join(root,TRASH_DIRECTORY);
 await mkdir(trashRoot,{recursive:true});
 await assertInsideRoot(root,trashRoot);
 const stamp=new Date().toISOString().replace(/[:.]/g,'-');
 const destination=await uniqueTrashPath(join(trashRoot,stamp+'-'+target));
 if(located.bundle){
  await assertInsideRoot(root,located.directory);
  await movePath(located.directory,destination);
 }else{
  await mkdir(destination,{recursive:true});
  await movePath(located.path,join(destination,basename(located.path)));
 }
 return {mode:'removed',name:target,scope:selected,applied:LIVE};
}
