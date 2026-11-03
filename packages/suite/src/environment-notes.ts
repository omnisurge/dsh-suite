/** 环境笔记（Chat助理「环境」页在本套件里的最小等价物；ADR-061）。
 *
 * 为什么要它：旧版助理那类手写 `chat/TOOLS.md` 笔记没有官方注入机制（内核 `environment_notes` 命中 0），
 * 于是它只能靠人贴进会话。这里给一个**本插件自己的**、可读可写的笔记文件，并作为一段系统提示注入。
 *
 * 三条纪律（与 `mcp-purpose` 同一套）：
 * - 文件是唯一权威，内存快照只是缓存；写后立刻重读，读不到就报不可用，不猜。
 * - `interpolate:false`：用户写什么就是什么，`{{`/`}}` 不被展开。
 * - 大小上限固定（32 KiB），超了拒绝写入而不是悄悄截断；只读文本，不碰凭据与会话。
 */
import {readFileSync,statSync} from 'node:fs';
import {mkdir,readFile,rename,writeFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
// 上限只有一处声明（limits.json）：页面计数、Host 写入闸门读同一份。
import limits from './limits.json' with {type:'json'};

export const ENVIRONMENT_NOTES_SECTION='omnisurge:environment-notes';
export const ENVIRONMENT_NOTES_ORDER=57;
export const ENVIRONMENT_NOTES_MAX_BYTES=limits.maxNotesBytes;
export const ENVIRONMENT_NOTES_FILE='omnisurge/environment-notes.md';

export interface EnvironmentNotes {available:boolean;code:string|null;text:string;bytes:number;path:string|null;}

export function notesPathOf(profileDir:string|null):string|null{
 return profileDir===null||profileDir.length===0?null:join(profileDir,ENVIRONMENT_NOTES_FILE);
}

/** 读：文件不存在是"空笔记"（可用、无内容），读失败才是不可用——两种不能混。 */
export async function readNotes(path:string|null):Promise<EnvironmentNotes>{
 if(path===null)return {available:false,code:'ENVIRONMENT_NOTES_PROFILE_UNKNOWN',text:'',bytes:0,path:null};
 try{
  const text=await readFile(path,'utf8');
  return {available:true,code:null,text,bytes:Buffer.byteLength(text,'utf8'),path};
 }catch(error){
  if((error as {code?:string}).code==='ENOENT')return {available:true,code:null,text:'',bytes:0,path};
  return {available:false,code:'ENVIRONMENT_NOTES_UNREADABLE',text:'',bytes:0,path};
 }
}

export function notesSectionText(notes:EnvironmentNotes):string{
 if(!notes.available)return '';
 const text=notes.text.trim();
 return text.length===0?'':text;
}

/** 写：先校验再落盘；原子替换（临时文件 + rename），失败保持原文件字节不变。 */
export async function writeNotes(path:string|null,text:string):Promise<EnvironmentNotes>{
 if(path===null)return {available:false,code:'ENVIRONMENT_NOTES_PROFILE_UNKNOWN',text:'',bytes:0,path:null};
 if(typeof text!=='string')return {available:false,code:'ENVIRONMENT_NOTES_INVALID',text:'',bytes:0,path};
 const bytes=Buffer.byteLength(text,'utf8');
 if(bytes>ENVIRONMENT_NOTES_MAX_BYTES)return {available:false,code:'ENVIRONMENT_NOTES_TOO_LARGE',text:'',bytes,path};
 await mkdir(dirname(path),{recursive:true});
 const temporary=path+'.tmp-'+process.pid;
 try{
  await writeFile(temporary,text,'utf8');
  await rename(temporary,path);
 }catch{return {available:false,code:'ENVIRONMENT_NOTES_WRITE_FAILED',text:'',bytes,path};}
 return {available:true,code:null,text,bytes,path};
}

/** 提示段求值是同步的：按 mtime 缓存，文件没变就不读盘；任何异常都退化成"没有这一段"。 */
let cached:{path:string;mtimeMs:number;text:string}|null=null;
export function notesSectionTextSync(path:string|null):string{
 if(path===null)return '';
 try{
  const mtimeMs=statSync(path).mtimeMs;
  if(cached!==null&&cached.path===path&&cached.mtimeMs===mtimeMs)return cached.text;
  const text=readFileSync(path,'utf8');
  const trimmed=text.trim();
  cached={path,mtimeMs,text:trimmed};
  return trimmed;
 }catch{
  // 文件被删/权限变化：立刻退回"没有这一段"，不留上一版旧笔记继续注入。
  cached=null;
  return '';
 }
}
/** 结构化追加一条环境事实（ADR-065）：块以 `### [kind] name` 起头；同名同类替换旧块，避免重复累积。
 *  纯函数，便于单测；不校验大小（由 writeNotes 的上限闸门负责）。 */
export function appendEnvironmentEntry(current:string,kind:string,name:string,detail:string):string{
 const heading='### ['+kind+'] '+name;
 const block=[heading,detail.trim()].join('\n');
 const lines=current.split('\n');
 const out:string[]=[];
 let i=0,replaced=false;
 while(i<lines.length){
  if(lines[i]===heading){replaced=true;out.push(heading,detail.trim());i+=1;while(i<lines.length&&!lines[i].startsWith('### ['))i+=1;continue;}
  out.push(lines[i]);i+=1;
 }
 if(replaced)return out.join('\n');
 const base=current.replace(/\s*$/u,'');
 return (base.length>0?base+'\n\n':'')+block+'\n';
}
