import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,open,readdir,rename,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {UpdateSource} from './config.js';
import {SUITE_PACKAGE,compareVersions,parseSums} from './upgrade.js';

/** ADR-068: the GitHub Release fetcher.
 *
 * It produces exactly one thing: a compliant \`<version>/\` directory under the append-only fetched root
 * (\`<DSH_HOME>/omnisurge/fetched/\`, ADR-068 D1). It never decides installability and never installs:
 * the candidate check is \`SuiteUpgrade.inspect()\` — the very code the install path runs — so a download
 * can only become a candidate when that check admits it. Every failure is "no update" plus one machine
 * code, and a failed attempt leaves no version directory behind.
 *
 * Why the fetched root is separate from the release directory (AGENTS 5.9): candidates reach the release
 * shelf only through \`scripts/release/publish-release.mjs\`. This fetcher writes bytes nobody published, so
 * it writes where the shelf cannot see them, and discovery treats that root as one more candidate root.
 * It is not a temporary directory either: the official installer pins a profile dependency to
 * \`file:<that directory>/<tgz>\`, so a landed version directory is never moved or deleted here.
 */

export const GITHUB_API_ORIGIN='https://api.github.com';
const GITHUB_API_HOST='api.github.com';
/** The one asset the fetcher reads as the checksum authority; the archive is named for its version. */
export const SUMS_ASSET='SHA256SUMS';
const ARCHIVE_NAME=/^omnisurge-dsh-suite-(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\.tgz$/;

/** ADR-068 D3: the closed code table. Runtime-gate refusals keep their existing UPGRADE_* codes instead of
 * minting a synonym, so a fetch is never a second opinion about compatibility. */
export type FetchCode='FETCH_NETWORK_UNREACHABLE'|'FETCH_ASSET_MISSING'|'FETCH_CHECKSUM_MISMATCH'|'FETCH_COMPONENT_MANIFEST_MISMATCH'|'FETCH_VERSION_STALE'|'FETCH_TOKEN_MISSING'|'FETCH_ABORTED'|'FETCH_REDIRECT_REFUSED';
export const FETCH_CODES:readonly FetchCode[]=['FETCH_NETWORK_UNREACHABLE','FETCH_ASSET_MISSING','FETCH_CHECKSUM_MISMATCH','FETCH_COMPONENT_MANIFEST_MISMATCH','FETCH_VERSION_STALE','FETCH_TOKEN_MISSING','FETCH_ABORTED','FETCH_REDIRECT_REFUSED'];

/** ADR-068 D5 (2026-10-29 decision): the metadata request stays strictly no-redirect, because the API answer
 * is what names the assets. Asset bodies are fetched by following hops by hand instead, with three hard
 * rules: HTTPS only, a closed host allowlist, and never carrying the Authorization header across an origin.
 * Anything outside that is refused with its own code rather than silently followed. */
const REDIRECT_HOSTS=new Set(['api.github.com','release-assets.githubusercontent.com','objects.githubusercontent.com']);
const MAX_REDIRECT_HOPS=2;
/** One URL as a developer diagnostic may see it: no query, no fragment (a signed asset URL keeps its
 * signature in the query), no credentials. */
export function describeUrl(value:string):string{
 try{const url=new URL(value);return url.protocol+'//'+url.host+url.pathname;}
 catch{return '(unparsable URL)';}
}

/** What one check produced. \`code===null\` means a verified version directory is in place (or nothing needed
 * doing); any code means "no update", never a half-landed candidate. */
export interface ReleaseFetchOutcome {
 version:string|null;
 code:string|null;
 diagnostic:string|null;
 /** The fetched root this check looked at, so a refusal can name where it looked. */
 directory:string|null;
}
/** The facts the canonical candidate check returns: the fetcher records them, it does not re-derive them. */
export interface ReleaseInspection {version:string;filename:string;suiteSha256:string;suiteBytes:number;}
export interface ReleaseFetchBudgets {
 /** Budget for the release metadata (the API answer), held in memory only up to this size. */
 metadataBytes:number;
 /** Budget for the checksum record. */
 sumsBytes:number;
 /** Budget for the archive bytes written to disk, aligned with the tar reader's own 64 MiB ceiling. */
 archiveBytes:number;
 metadataTimeoutMs:number;
 archiveTimeoutMs:number;
}
export const DEFAULT_FETCH_BUDGETS:ReleaseFetchBudgets={metadataBytes:2*1024*1024,sumsBytes:256*1024,archiveBytes:64*1024*1024,metadataTimeoutMs:15000,archiveTimeoutMs:120000};
export interface ReleaseFetcherOptions {
 /** The configured source. \`local\` and "no repository named" mean this fetcher does nothing at all. */
 source:()=>UpdateSource;
 /** The fetched root, or null when this Host has none (no DSH_HOME, no fetched channel). */
 fetchedDirectory:()=>string|null;
 /** The running Suite version, for the "is this even newer" pre-check before spending bytes. */
 currentVersion:()=>Promise<string>;
 /** \`SuiteUpgrade.inspect\`: the same candidate check the install path runs. Never reimplemented here. */
 inspect:(directory:string)=>Promise<ReleaseInspection>;
 /** The network seam (offline tests script it). A missing override uses the platform fetch. Metadata is
  * requested with redirect:'error' and asset bodies with redirect:'manual' — see the hop rules above. */
 fetch?:(url:string,init:RequestInit)=>Promise<Response>;
 /** Resolve a credential reference through the official credential service. Absent means "this Host cannot
  * resolve references", which degrades to public repositories only (a configured reference is refused). */
 resolveCredential?:(ref:string)=>Promise<string|undefined>;
 lifetime?:AbortSignal;
 logger?:(message:string,detail:Record<string,unknown>)=>void;
 budgets?:Partial<ReleaseFetchBudgets>;
}

/** A refusal that already knows its own machine code. Its message is developer diagnosis only: no secret,
 * no user-visible sentence (the Client owns wording, AGENTS 5.10). */
class FetchFailure extends Error {
 constructor(readonly code:string,message:string){super(message);this.name='FetchFailure';}
}

/** One release as the fetcher needs it: the two assets and the version hint the release states. */
interface SelectedRelease {tagVersion:string|null;archiveName:string;archiveUrl:string;archiveDigest:string|null;sumsUrl:string;}

export class GitHubReleaseFetcher {
 private pending:Promise<ReleaseFetchOutcome>|undefined;
 constructor(private readonly options:ReleaseFetcherOptions){}
 /** Check one source and land a verified directory. Concurrent callers share one request (a page poll and
  * the agent tool must not download twice); an aborted or failing check is always an outcome, never a throw. */
 async ensure(request:{currentVersion?:string}={}):Promise<ReleaseFetchOutcome>{
  const directory=this.options.fetchedDirectory();
  const source=this.options.source();
  if(directory===null||source.kind!=='github')return {version:null,code:null,diagnostic:null,directory};
  if(this.pending!==undefined)return this.pending;
  const work=this.check(source,directory,request.currentVersion).finally(()=>{if(this.pending===work)this.pending=undefined;});
  this.pending=work;
  return work;
}

 private budgets():ReleaseFetchBudgets{return {...DEFAULT_FETCH_BUDGETS,...(this.options.budgets??{})};}

 private async check(source:UpdateSource,directory:string,currentVersionHint:string|undefined):Promise<ReleaseFetchOutcome>{
  const budgets=this.budgets();
  let incoming:string|null=null;
  try{
   if(source.owner===''||source.repo==='')throw new FetchFailure('FETCH_ASSET_MISSING','the update source names no repository (owner/repo are required)');
   const currentVersion=currentVersionHint??await this.options.currentVersion();
   const token=await this.resolveToken(source);
   const release=await this.readRelease(source,token,budgets);
   const expectedVersion=ARCHIVE_NAME.exec(release.archiveName)?.[1];
   if(expectedVersion===undefined)throw new FetchFailure('FETCH_COMPONENT_MANIFEST_MISMATCH','the release asset is not named for a Suite version: '+release.archiveName);
   // The release tag is a hint, never the version authority: the archive's own package.json is. A tag that
   // disputes the asset name is an identity mismatch, refused before any byte is spent on the archive.
   if(release.tagVersion!==null&&release.tagVersion!==expectedVersion)throw new FetchFailure('FETCH_COMPONENT_MANIFEST_MISMATCH','the release tag names '+release.tagVersion+' while its asset names '+expectedVersion);
   if(compareReleaseVersions(expectedVersion,currentVersion)<=0)throw new FetchFailure('FETCH_VERSION_STALE','release '+expectedVersion+' is not newer than the running '+currentVersion);
   // Already landed: the fetched root is append-only, so an existing directory is verified, never rewritten.
   // A broken one is reported instead of replaced: it may be what a profile already depends on.
   const landed=join(directory,expectedVersion);
   if(await this.exists(landed)){const existing=await this.inspectDirectory(landed);return {version:existing.version,code:null,diagnostic:null,directory};}
   await mkdir(directory,{recursive:true,mode:0o700});
   // Everything is written inside a dot-prefixed staging directory beside the target: discovery skips dot
   // directories, so a partial download can never be offered as a candidate (ADR-068 D1).
   incoming=await mkdtemp(join(directory,'.incoming-'));
   const sumsPath=join(incoming,SUMS_ASSET);
   const sumsText=await this.downloadText(token,release.sumsUrl,budgets.sumsBytes,budgets.metadataTimeoutMs);
   const sums=parseSumsOrRefuse(sumsText);
   const expectedDigest=sums.get(release.archiveName);
   if(expectedDigest===undefined)throw new FetchFailure('FETCH_CHECKSUM_MISMATCH','the release checksum record does not list '+release.archiveName);
   // Two records of the same origin (R3): disagreement still means "do not install these bytes".
   if(release.archiveDigest!==null&&release.archiveDigest!==expectedDigest)throw new FetchFailure('FETCH_CHECKSUM_MISMATCH','the release metadata digest disagrees with its '+SUMS_ASSET+' entry for '+release.archiveName);
   const archivePath=join(incoming,release.archiveName);
   await this.downloadFile(token,release.archiveUrl,archivePath,budgets.archiveBytes,budgets.archiveTimeoutMs);
   // TOCTOU (ADR-068 D4): the digest is computed from the bytes on disk now, never from the chunks the
   // stream handed back; the install path later re-reads the same file again.
   const digest=await this.digestOfFile(archivePath,budgets.archiveBytes);
   if(digest!==expectedDigest)throw new FetchFailure('FETCH_CHECKSUM_MISMATCH','the archived bytes of '+release.archiveName+' do not match its '+SUMS_ASSET+' entry');
   await writeFile(sumsPath,sumsText,{flag:'wx'});
   // From here on the decisions are the install path's own code: package identity, strict update, peer pins
   // and the ADR-040 runtime gate. The fetcher neither reimplements nor relaxes any of them.
   const inspected=await this.inspectDirectory(incoming);
   if(inspected.version!==expectedVersion)throw new FetchFailure('FETCH_COMPONENT_MANIFEST_MISMATCH','the archive carries version '+inspected.version+' but the release names '+expectedVersion);
   // A directory record, so the landed candidate states the same identity the shelf's records do (version,
   // filename, bytes, digest). It is written before the final check, and the final check verifies it.
   const record={protocol:1,version:inspected.version,source:{kind:'github',owner:source.owner,repo:source.repo,channel:source.channel},packages:[{name:SUITE_PACKAGE,version:inspected.version,filename:inspected.filename,sha256:inspected.suiteSha256,bytes:inspected.suiteBytes}]};
   await writeFile(join(incoming,'manifest.json'),JSON.stringify(record,null,2)+'\n',{flag:'wx'});
   const verified=await this.inspectDirectory(incoming);
   const target=join(directory,verified.version);
   const renamed=await rename(incoming,target).then(()=>true).catch((error:NodeJS.ErrnoException)=>error.code==='EEXIST'||error.code==='ENOTEMPTY'?false:Promise.reject(error));
   if(!renamed){
    // Another process landed this version between the check and the rename. Its directory is the fact;
    // verify it instead of overwriting it.
    const raced=await this.inspectDirectory(target);
    await rm(incoming,{recursive:true,force:true}).catch(()=>undefined);
    incoming=null;
    return {version:raced.version,code:null,diagnostic:null,directory};
   }
   incoming=null;
   return {version:verified.version,code:null,diagnostic:null,directory};
  }catch(error){
   return this.refused(error,directory);
  }finally{
   if(incoming!==null)await rm(incoming,{recursive:true,force:true}).catch(()=>undefined);
  }
 }

 private refused(error:unknown,directory:string):ReleaseFetchOutcome{
  const code=error instanceof FetchFailure?error.code:this.codeOfFailure(error);
  const diagnostic=String((error as Error)?.message??error);
  this.options.logger?.('SUITE_RELEASE_FETCH_REFUSED',{code,directory});
  return {version:null,code,diagnostic,directory};
 }

 /** Translate anything thrown by the canonical candidate check into the fetch code table. The ADR-040 runtime
  * gate keeps its own UPGRADE_* code (ADR-068 D3): a second, near-identical code would be a second fact. */
 private codeOfFailure(error:unknown):string{
  if(error instanceof FetchFailure)return error.code;
  const declared=/^UPGRADE_[A-Z0-9_]+/.exec(String((error as Error)?.message??error))?.[0];
  if(declared!==undefined)return mapCandidateCode(declared);
  if(this.aborted())return 'FETCH_ABORTED';
  return 'FETCH_NETWORK_UNREACHABLE';
 }

 private aborted():boolean{return this.options.lifetime?.aborted===true;}

 private async exists(path:string):Promise<boolean>{
  try{await readdir(path);return true;}
  catch(error){const code=(error as NodeJS.ErrnoException).code;if(code==='ENOENT'||code==='ENOTDIR')return false;throw error;}
 }

 /** Verify one directory through the install path's own check, with its refusals translated. */
 private async inspectDirectory(directory:string):Promise<ReleaseInspection>{
  try{return await this.options.inspect(directory);}
  catch(error){
   const declared=/^UPGRADE_[A-Z0-9_]+/.exec(String((error as Error)?.message??error))?.[0];
   throw new FetchFailure(mapCandidateCode(declared),String((error as Error)?.message??error));
  }
 }

 /** A credential reference is resolved per operation through the official service; the secret never leaves
  * this method's caller. No reference means "public repository", which sends no Authorization header. */
 private async resolveToken(source:UpdateSource):Promise<string|null>{
  const ref=source.credentialRef;
  if(ref==='')return null;
  const resolve=this.options.resolveCredential;
  // Three distinct readable reasons, one code (the closed table has no per-cause token codes):
  // no service here, a service that refused to resolve, and a reference that stores no value.
  if(resolve===undefined)throw new FetchFailure('FETCH_TOKEN_MISSING','credential reference "'+ref+'" is configured but this Host has no credential service, so a private repository cannot be read');
  let secret:string|undefined;
  try{secret=await resolve(ref);}
  catch{throw new FetchFailure('FETCH_TOKEN_MISSING','credential reference "'+ref+'" could not be resolved: the credential service refused the lookup');}
  const value=typeof secret==='string'?secret.trim():'';
  if(value==='')throw new FetchFailure('FETCH_TOKEN_MISSING','credential reference "'+ref+'" is not configured: no value is stored for it, so a private repository cannot be read');
  return value;
 }

 private headers(token:string|null,accept:string):Record<string,string>{
  const headers:Record<string,string>={accept,'user-agent':'Omnisurge-DSH-Suite/ReleaseFetcher','x-github-api-version':'2022-11-28'};
  if(token!==null)headers.authorization='Bearer '+token;
  return headers;
 }

 private async readRelease(source:UpdateSource,token:string|null,budgets:ReleaseFetchBudgets):Promise<SelectedRelease>{
  const repository=GITHUB_API_ORIGIN+'/repos/'+encodeURIComponent(source.owner)+'/'+encodeURIComponent(source.repo);
  // stable asks the API's own "latest published release"; prerelease reads the newest published entry.
  const url=source.channel==='prerelease'?repository+'/releases?per_page=30':repository+'/releases/latest';
  const payload=await this.request(url,{headers:this.headers(token,'application/vnd.github+json'),method:'GET'},budgets.metadataTimeoutMs,async response=>{
   this.ensureOk(response);
   const text=await this.readText(response,budgets.metadataBytes);
   try{return JSON.parse(text) as unknown;}
   catch{throw new FetchFailure('FETCH_ASSET_MISSING','the release source returned no readable JSON');}
  });
  const published=Array.isArray(payload)?payload.find(entry=>entry!==null&&typeof entry==='object'&&(entry as {draft?:unknown}).draft!==true):payload;
  if(published===null||published===undefined||typeof published!=='object')throw new FetchFailure('FETCH_ASSET_MISSING','the release source reports no published release');
  const release=published as {tag_name?:unknown;assets?:unknown};
  const assets=(Array.isArray(release.assets)?release.assets:[]).filter((entry):entry is {name?:unknown;url?:unknown;digest?:unknown}=>entry!==null&&typeof entry==='object');
  const archives=assets.filter(asset=>typeof asset.name==='string'&&ARCHIVE_NAME.test(asset.name));
  if(archives.length!==1)throw new FetchFailure('FETCH_ASSET_MISSING','the release carries '+archives.length+' Suite archives; exactly one is required');
  const sums=assets.find(asset=>asset.name===SUMS_ASSET);
  if(sums===undefined)throw new FetchFailure('FETCH_ASSET_MISSING','the release carries no '+SUMS_ASSET+' asset');
  const archive=archives[0];
  const tag=typeof release.tag_name==='string'?release.tag_name.trim():'';
  return {
   tagVersion:/^v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(tag)?.[1]??null,
   archiveName:String(archive.name),
   // The asset URL must live on the API origin: a release JSON can never point this fetcher at another
   // host, so a bearer token can never be carried to a third party by a crafted asset entry.
   archiveUrl:this.assetUrl(archive.url),
   archiveDigest:typeof archive.digest==='string'&&archive.digest.startsWith('sha256:')?archive.digest.slice('sha256:'.length).trim():null,
   sumsUrl:this.assetUrl(sums.url),
  };
 }

 private assetUrl(value:unknown):string{
  if(typeof value!=='string')throw new FetchFailure('FETCH_ASSET_MISSING','a release asset carries no URL');
  let url:URL;
  try{url=new URL(value);}
  catch{throw new FetchFailure('FETCH_ASSET_MISSING','a release asset URL is not a URL');}
  if(url.protocol!=='https:'||url.hostname!==GITHUB_API_HOST)throw new FetchFailure('FETCH_ASSET_MISSING','a release asset URL is not served by '+GITHUB_API_HOST);
  return url.toString();
 }

 private ensureOk(response:Response):void{
  if(response.ok)return;
  if(response.status===401||response.status===403)throw new FetchFailure('FETCH_TOKEN_MISSING','the release source refused the request with HTTP '+response.status+'; a private repository needs a resolvable credential reference');
  if(response.status===404)throw new FetchFailure('FETCH_ASSET_MISSING','the release source answered HTTP 404: no such repository, release or asset');
  throw new FetchFailure('FETCH_NETWORK_UNREACHABLE','the release source answered HTTP '+response.status);
 }

 /** One deadline for a whole request (headers and body): the timer stays armed while the body is consumed,
  * so a stalled body cannot outlive the budget, and the caller's lifetime keeps abort precedence. */
 private async timed<T>(timeoutMs:number,work:(signal:AbortSignal,fail:()=>FetchFailure)=>Promise<T>):Promise<T>{
  const timeout=new AbortController();
  const timer=setTimeout(()=>timeout.abort(),timeoutMs);
  timer.unref?.();
  const lifetime=this.options.lifetime;
  const signal=AbortSignal.any([timeout.signal,...(lifetime===undefined?[]:[lifetime])]);
  const fail=():FetchFailure=>lifetime?.aborted===true
   ?new FetchFailure('FETCH_ABORTED','the release check was cancelled')
   :timeout.signal.aborted?new FetchFailure('FETCH_NETWORK_UNREACHABLE','the release request timed out after '+timeoutMs+' ms'):new FetchFailure('FETCH_ABORTED','the release request was cancelled');
  try{
   if(signal.aborted)throw fail();
   return await work(signal,fail);
  }catch(error){
   if(error instanceof FetchFailure)throw error;
   if(signal.aborted)throw fail();
   throw new FetchFailure('FETCH_NETWORK_UNREACHABLE','the release source is unreachable ('+String((error as Error)?.message??error)+')');
  }finally{clearTimeout(timer);}
 }
 private async fetchOnce(signal:AbortSignal,fail:()=>FetchFailure,url:string,init:RequestInit):Promise<Response>{
  const fetchImpl=this.options.fetch??((target:string,settings:RequestInit)=>fetch(target,settings));
  try{return await fetchImpl(url,{...init,signal});}
  catch(error){
   if(signal.aborted)throw fail();
   throw new FetchFailure('FETCH_NETWORK_UNREACHABLE','the release source is unreachable ('+String((error as Error)?.message??error)+')');
  }
 }
 /** Metadata: strictly no redirect. The answer that names the assets must come from the API origin itself. */
 private async request<T>(url:string,init:RequestInit,timeoutMs:number,consume:(response:Response)=>Promise<T>):Promise<T>{
  return this.timed(timeoutMs,async (signal,fail)=>consume(await this.fetchOnce(signal,fail,url,{...init,redirect:'error'})));
 }
 /** Asset bodies: follow hops by hand (max two), HTTPS only, host allowlist, and drop the bearer token the
  * moment a hop leaves the current origin. The final chain is logged as a developer diagnostic with every
  * URL reduced to scheme+host+path, so a signed query string never reaches a log. */
 private async assetRequest<T>(token:string|null,url:string,accept:string,timeoutMs:number,consume:(response:Response)=>Promise<T>):Promise<T>{
  return this.timed(timeoutMs,async (signal,fail)=>{
   let current=url,authorization=token,hops=0;
   const chain:string[]=[];
   for(;;){
    const headers:Record<string,string>={'accept':accept,'user-agent':'Omnisurge-DSH-Suite/ReleaseFetcher','x-github-api-version':'2022-11-28'};
    if(authorization!==null)headers.authorization='Bearer '+authorization;
    const response=await this.fetchOnce(signal,fail,current,{headers,method:'GET',redirect:'manual'});
    chain.push(describeUrl(current));
    if(!isRedirect(response.status)){
     if(chain.length>1)this.options.logger?.('SUITE_RELEASE_FETCH_REDIRECT',{hops:chain.length-1,chain});
     return consume(response);
    }
    const location=response.headers.get('location');
    await response.body?.cancel().catch(()=>undefined);
    if(hops>=MAX_REDIRECT_HOPS)throw new FetchFailure('FETCH_REDIRECT_REFUSED','the release asset exceeded '+MAX_REDIRECT_HOPS+' redirects: '+chain.join(' -> '));
    if(location===null)throw new FetchFailure('FETCH_REDIRECT_REFUSED','the release asset answered HTTP '+response.status+' without a Location: '+chain.join(' -> '));
    let next:URL;
    try{next=new URL(location,current);}
    catch{throw new FetchFailure('FETCH_REDIRECT_REFUSED','the release asset redirect is not a URL: '+chain.join(' -> '));}
    if(next.protocol!=='https:')throw new FetchFailure('FETCH_REDIRECT_REFUSED','the release asset redirect is not HTTPS: '+describeUrl(next.toString()));
    if(!REDIRECT_HOSTS.has(next.hostname))throw new FetchFailure('FETCH_REDIRECT_REFUSED','the release asset redirect left the allowlist: '+describeUrl(next.toString()));
    // The token belongs to the API origin only: any hop to another origin continues without it.
    if(next.origin!==new URL(current).origin)authorization=null;
    current=next.toString();
    hops+=1;
   }
  });
 }

 private async readText(response:Response,cap:number):Promise<string>{
  const bytes=await this.readBytes(response,cap,'metadata');
  return Buffer.from(bytes).toString('utf8');
 }
 private async readBytes(response:Response,cap:number,budget:'metadata'|'checksum'):Promise<Uint8Array>{
  if(!response.body)throw new FetchFailure('FETCH_ASSET_MISSING','the release source returned an empty body');
  const reader=response.body.getReader();
  const chunks:Uint8Array[]=[];
  let size=0;
  try{
   for(;;){
    const {done,value}=await reader.read();
    if(done)break;
    if(value===undefined)continue;
    size+=value.byteLength;
    if(size>cap)throw new FetchFailure('FETCH_ASSET_MISSING','the '+budget+' response exceeds the '+cap+'-byte budget');
    chunks.push(value);
   }
  }finally{
   await reader.cancel().catch(()=>undefined);
   reader.releaseLock();
  }
  return Buffer.concat(chunks);
 }

 private async downloadText(token:string|null,url:string,cap:number,timeoutMs:number):Promise<string>{
  return this.assetRequest(token,url,'text/plain',timeoutMs,async response=>{
   this.ensureOk(response);
   return this.readText(response,cap);
  });
 }

 private async downloadFile(token:string|null,url:string,path:string,cap:number,timeoutMs:number):Promise<void>{
  await this.assetRequest(token,url,'application/octet-stream',timeoutMs,async response=>{
   this.ensureOk(response);
   if(!response.body)throw new FetchFailure('FETCH_ASSET_MISSING','the release asset has no body');
   const reader=response.body.getReader();
   const handle=await open(path,'wx',0o600);
   let size=0;
   try{
    for(;;){
     const {done,value}=await reader.read();
     if(done)break;
     if(value===undefined)continue;
     size+=value.byteLength;
     // An asset above the budget is not an acceptable asset at all; with a closed code table (ADR-068 D3)
     // that reads as "the release carries no usable asset", never as a checksum opinion about bytes we
     // refused to hold.
     if(size>cap)throw new FetchFailure('FETCH_ASSET_MISSING','the release asset exceeds the '+cap+'-byte download budget');
     await handle.write(value);
    }
   }catch(error){
    await reader.cancel().catch(()=>undefined);
    throw error;
   }finally{await handle.close();}
  });
 }

 /** Hash what is on disk. The streamed chunks are never hashed: the bytes that count are the bytes that
  * were written, and the install path will read those same bytes again. */
 private async digestOfFile(path:string,cap:number):Promise<string>{
  const handle=await open(path,'r');
  const hash=createHash('sha256'),buffer=Buffer.allocUnsafe(1024*1024);
  let total=0;
  try{
   for(;;){
    const {bytesRead}=await handle.read(buffer,0,buffer.length,null);
    if(bytesRead===0)break;
    total+=bytesRead;
    if(total>cap)throw new FetchFailure('FETCH_ASSET_MISSING','the landed archive exceeds the '+cap+'-byte budget');
    hash.update(buffer.subarray(0,bytesRead));
   }
  }finally{await handle.close();}
  return hash.digest('hex');
 }
}

/** Translate one candidate-check refusal into the fetch code table. Runtime-gate codes pass through
 * unchanged (ADR-068 D3): the fetcher has no second opinion about compatibility. */
export function mapCandidateCode(declared:string|undefined):string{
 if(declared===undefined||declared==='')return 'FETCH_COMPONENT_MANIFEST_MISMATCH';
 if(declared==='UPGRADE_NOT_NEWER')return 'FETCH_VERSION_STALE';
 if(declared.startsWith('UPGRADE_RUNTIME_'))return declared;
 if(declared==='UPGRADE_SUITE_NAME_MISMATCH'||declared==='UPGRADE_SUITE_VERSION_MISSING'||declared==='UPGRADE_SUITE_MANIFEST_MISSING'||declared.startsWith('UPGRADE_COMPONENT'))return 'FETCH_COMPONENT_MANIFEST_MISMATCH';
 if(declared==='UPGRADE_CANDIDATE_INVALID'||declared==='UPGRADE_NOT_A_CANDIDATE'||declared==='UPGRADE_CANDIDATE_ALIAS')return 'FETCH_COMPONENT_MANIFEST_MISMATCH';
 // Everything left is about the bytes and their record: a missing checksum, an unlisted archive, byte or
 // record drift, or an archive the reader cannot parse.
 return 'FETCH_CHECKSUM_MISMATCH';
}
function isRedirect(status:number):boolean{return status===301||status===302||status===303||status===307||status===308;}
function parseSumsOrRefuse(text:string):Map<string,string>{
 try{return parseSums(text);}
 catch(error){throw new FetchFailure('FETCH_CHECKSUM_MISMATCH',String((error as Error)?.message??error));}
}
function compareReleaseVersions(left:string,right:string):number{
 try{return compareVersions(left,right);}
 catch(error){throw new FetchFailure('FETCH_COMPONENT_MANIFEST_MISMATCH',String((error as Error)?.message??error));}
}
