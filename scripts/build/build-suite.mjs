import {lstat,mkdir,mkdtemp,readFile,readdir,writeFile,rm,realpath,open} from 'node:fs/promises';
import {join,relative,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {run,publishGeneration,artifactRevisions,inspectCapabilities} from '../shared/build-target-core.mjs';
import {REQUIRED_CAPABILITIES} from '../shared/build-protocol.mjs';
import {verifiedRuntimes} from '../shared/target-runtime.mjs';
import {installTypertArtifacts} from '../shared/typert-artifacts.mjs';
import {buildManagementClient} from './build-management-client.mjs';
import {build as esbuild} from 'esbuild';
import {SUITE_DEVELOPMENT_PROTOCOL} from '../shared/build-protocol.mjs';
const repository=fileURLToPath(new URL('../../', import.meta.url));
/** ADR-033 carried MCP client bundles are esbuilt from this source tree, and they are written to the staging
 * generation after the receipt is computed. The receipt must be a function of its inputs, so the tree is read
 * here: relative names in sorted order keep the digest independent of the staging directory the build runs in,
 * and no finished (already stamped) artifact is hashed into itself. */
async function carriedBundleInputs(directory){
 const names=[];
 const walk=async current=>{
  const entries=await readdir(current,{withFileTypes:true});
  for(const entry of entries.sort((left,right)=>left.name<right.name?-1:left.name>right.name?1:0)){
   const full=join(current,entry.name);
   if(entry.isDirectory())await walk(full);
   else if(entry.isFile())names.push(full);
  }
 };
 await walk(directory);
 const inputs=[];
 for(const full of names)inputs.push([relative(directory,full),await readFile(full)]);
 return inputs;
}

/** Bootstrap is a separate Suite owner/commit boundary, not the daily business loop. */
export async function buildSuite(root,state,env,signal){
 root=await realpath(resolve(root));await mkdir(state,{recursive:true});
 const scratch=join(root,'.scratch');await mkdir(scratch,{recursive:true});
 if(await realpath(scratch)!==scratch)throw Error('STATE_ALIAS: Suite scratch must not redirect');
 const lockPath=join(scratch,'suite-manager-build.lock');
 let lock;try{lock=await open(lockPath,'wx');}catch(error){if(error.code==='EEXIST')throw Error('BUILD_BUSY: another owner holds the Suite target lease');throw error;}
 let staging,failure,result,published=false;
 try{
  await lock.writeFile(JSON.stringify({pid:process.pid,target:'suite-manager'})+'\n');
  signal?.throwIfAborted();staging=await mkdtemp(join(scratch,'suite-build-'));
  const business=join(root,'packages/suite'),lib=join(staging,'lib'),home=join(state,'suite-compiler-home');
  await mkdir(home,{recursive:true});
  const compilerEnv=env??{PATH:'/usr/bin:/bin:/usr/local/bin',HOME:home,TMPDIR:staging,LANG:'C.UTF-8',ELECTRON_RUN_AS_NODE:'1',NODE_NO_WARNINGS:'1',GIT_CONFIG_NOSYSTEM:'1'};
  await run(process.execPath,[createRequire(join(root,'package.json')).resolve('typescript/bin/tsc'),'-p',join(business,'tsconfig.json'),'--outDir',lib],{cwd:root,env:compilerEnv,signal});
  // Every owned Client source is checked, not only the entry: the carried module's sources are what the
  // entry imports, and an esbuild failure is a worse diagnostic than the syntax error itself.
  for(const name of ['client.js','search/client.js','search/client-flow.js','tools/client.js'])await run(process.execPath,['--check',join(business,'src',name)],{cwd:root,env:compilerEnv,signal});
  // The loaded manager freezes a generated projection of the one canonical source.
  // Host modules that carry a third-party library are bundled in place: the profile loader resolves
  // '@deepseek-ai/*' for plugins but not arbitrary packages, and the Suite ships no runtime dependencies
  // (only a bundle). Everything else stays plain tsc output.
  const bundledHostModules=['mcp-servers.js','skills-manage.js'];
  for(const name of bundledHostModules){
   // The bundled CommonJS dependency reaches for Node builtins through `require`; ESM output has no
   // `require`, so the banner gives esbuild's shim a real one anchored at this module.
   // Bundled through stdin, not as an entry file: esbuild writes the resolved entry path into the output as a
   // comment, and this build runs inside a randomly named staging directory. That one comment made every build
   // produce different bytes for identical inputs (hostRevision churned, entry-freshness/manager-build red).
   // A stable `sourcefile` keeps the published generation byte-identical across builds.
   const bare=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
   // esbuild labels the root module with the path it was given; an earlier generation may also still carry
   // one. Both are build-position noise, not code: strip every such label line so identical inputs publish
   // identical bytes wherever the staging directory happens to be.
   // Two shapes of the same noise: the root module label (`// mcp-servers.js`, or an older generation's
   // path-prefixed form) and the label esbuild emits for a *bundled local* module it pulled in from the
   // staging directory (`// .scratch/suite-build-XXXX/lib/loopback-origin.js`). Both name a build-position,
   // and the staging name is a fresh mkdtemp per run, so leaving the second shape in would make identical
   // inputs publish different bytes (entry-freshness/manager-build red, pack determinism broken).
   const rootLabel=new RegExp('^// (?:\\S+/)?'+bare+'$');
   const positionLabel=/^\/\/ .*suite-build-[^/]*\/lib\/[A-Za-z0-9._-]+$/;
   const stripRoot=(text)=>text.split('\n').filter(line=>!rootLabel.test(line)&&!positionLabel.test(line)).join('\n');
   const source=stripRoot(await readFile(join(lib,name),'utf8'));
   const bundled=await esbuild({stdin:{contents:source,resolveDir:lib,sourcefile:name,loader:'js'},bundle:true,write:false,format:'esm',platform:'node',target:'node22',legalComments:'none',logLevel:'silent',external:['@deepseek-ai/*','node:*'],banner:{js:"import { createRequire as __omnisurgeCreateRequire } from 'node:module'; const require = __omnisurgeCreateRequire(import.meta.url);"}});
   await writeFile(join(lib,name),stripRoot(bundled.outputFiles[0].text));
  }
  await writeFile(join(lib,'build-protocol.js'),await readFile(join(root,'scripts/shared/build-protocol.mjs')));
  await writeFile(join(lib,'build-protocol.d.ts'),await readFile(join(business,'src/build-protocol.d.ts')));
  await installTypertArtifacts(root,lib,'suite');await buildManagementClient(root,lib,'suite');
  // The Suite is the only profile-level package, so the declared component's Host plugin is bundled
  // into the Suite's own export map: the inserted row resolves inside the Suite. The official
  // installer refuses insert-only packages, and Node resolution never enters a nested node_modules,
  // so a second profile dependency cannot be the answer.
  const suiteManifest=JSON.parse(await readFile(join(root,'packages/suite/package.json'),'utf8'));
  const bundled=await esbuild({entryPoints:[join(root,'packages/suite/src/searxng.ts')],bundle:true,write:false,format:'esm',platform:'node',target:'node22',legalComments:'none',logLevel:'silent',external:['@deepseek-ai/*','node:*']});
  // The carried bundles' sources are part of this generation's identity even though the bundles themselves
  // are written below (ADR-033 / task-37): the receipt stays a function of its inputs, never of itself.
  const carriedInputs=await carriedBundleInputs(join(business,'src/clients'));
  const suiteRevisions=await artifactRevisions(lib,await readFile(join(lib,'client.js'),'utf8'),carriedInputs);
  const stamp=text=>text
   .replaceAll('__OMNISURGE_PACKAGE_VERSION__',suiteManifest.version)
   .replaceAll('__OMNISURGE_HOST_REVISION__',suiteRevisions.hostRevision)
   .replaceAll('__OMNISURGE_CLIENT_REVISION__',suiteRevisions.clientRevision)
   .replaceAll('__OMNISURGE_BUILD_PROTOCOL__',SUITE_DEVELOPMENT_PROTOCOL)
   .replaceAll('__OMNISURGE_VERIFIED_RUNTIMES__',verifiedRuntimes.join(','));
  // The revisions are the digests of the pre-stamp bytes, so stamping the Client afterwards cannot
  // change the receipt it reports.
  const stampedClient=stamp(await readFile(join(lib,'client.js'),'utf8'));
  if(/__OMNISURGE_[A-Z_]+__/.test(stampedClient))throw Error('UNSTAMPED_CLIENT_BUNDLE: the Suite Client bundle still carries a build placeholder');
  await writeFile(join(lib,'client.js'),stampedClient);
  const stampedComponent=stamp(bundled.outputFiles[0].text);
  if(/__OMNISURGE_[A-Z_]+__/.test(stampedComponent))throw Error('UNSTAMPED_COMPONENT_BUNDLE: the Suite-side module bundle still carries a build placeholder');
  await writeFile(join(lib,'searxng.js'),stampedComponent);
  // ADR-033: the MCP client modules the Suite carries are bundled one file each. The MCP SDK is inlined at
  // build time (the profile loader resolves only '@deepseek-ai/*'), cordis/schemastery stay external like
  // every other plugin module. The tsc per-file outputs under lib/clients are removed afterwards and only
  // the declarations stay: the published generation stays flat and no unbundled copy can be imported.
  for(const [directory,file] of [['dual','mcp-dual'],['login-gateway','login-gateway'],['oauth','mcp-oauth'],['agent-teams','agent-teams']]){
   const carried=await esbuild({entryPoints:[join(business,'src/clients',directory,'index.ts')],bundle:true,write:false,format:'esm',platform:'node',target:'node22',legalComments:'none',logLevel:'silent',external:['@deepseek-ai/*','node:*']});
   await writeFile(join(lib,file+'.js'),carried.outputFiles[0].text);
  }
  // The carried module is served only as that single bundled entry, so the per-file outputs of the
  // same tree are removed: the owned generation stays flat and nothing stale is published.
  await rm(join(lib,'search'),{recursive:true,force:true});
  // The owned generation is flat (publishGeneration owns top-level files only), so the per-file tsc tree
  // cannot be published: the bundles above are the artifacts, and the checked-in declaration templates are
  // copied beside them under the names the export map points at.
  await rm(join(lib,'clients'),{recursive:true,force:true});
  for(const file of ['mcp-dual','mcp-oauth','login-gateway','agent-teams']){
   await writeFile(join(lib,file+'.d.ts'),await readFile(join(business,'src/clients',file+'.public.d.ts')));
  }
  // Prove the running capabilities on the completed staging generation, before anything is published:
  // a generation this build cannot prove must never replace the accepted files.
  const capabilities=await inspectCapabilities(lib,signal,suiteManifest.name);
  const missing=REQUIRED_CAPABILITIES.filter(name=>!capabilities[name]);
  if(missing.length)throw Error('BUILD_CAPABILITY_MISSING: '+missing.join(',')+' — this generation does not prove the required capabilities');
  // A plain "tsc -p packages/suite/tsconfig.json" emits the per-file tree into this directory (its outDir),
  // while the owned generation is flat and publishGeneration refuses non-regular members. Such an entry can
  // never be part of a published generation, so drop it here instead of wedging the build on someone's emit.
  const owned=join(business,'lib');
  for(const name of await readdir(owned).catch(()=>[])){
   const target=join(owned,name);
   if(!(await lstat(target)).isFile())await rm(target,{recursive:true,force:true});
  }
  signal?.throwIfAborted();const generation=new Map();
  for(const name of await readdir(lib))generation.set(name,await readFile(join(lib,name)));
  const changed=await publishGeneration(join(business,'lib'),generation,signal);
  published=true;result={changed,hostRevision:suiteRevisions.hostRevision,clientRevision:suiteRevisions.clientRevision,capabilities};
 }catch(error){failure=error;}finally{
  const issues=[];
  for(const [label,cleanup]of [['close Suite lease',()=>lock.close()],['remove Suite staging',()=>staging?rm(staging,{recursive:true,force:true}):Promise.resolve()],['release Suite lease',()=>rm(lockPath,{force:true})]])try{await cleanup();}catch(error){issues.push(label+': '+error.message);}
  if(issues.length){const detail='CLEANUP_FAILED: '+issues.join('; ');if(failure)failure.message+='; '+detail;else failure=Error((published?'SUITE_GENERATION_COMMITTED: complete Suite output published; ':'SUITE_GENERATION_NOT_PUBLISHED: ')+detail);}
 }
 if(failure)throw failure;return result;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const root=resolve(process.argv[2]??repository),state=resolve(process.argv[3]??join(root,'.scratch/suite-build'));
 const controller=new AbortController(),cancel=()=>controller.abort(Error('BUILD_CANCELLED: Suite bootstrap was cancelled'));
 process.on('SIGINT',cancel);process.on('SIGTERM',cancel);
 try{console.log(JSON.stringify(await buildSuite(root,state,undefined,controller.signal)));}
 catch(error){console.error(String(error?.message??error));process.exitCode=1;}
 finally{process.off('SIGINT',cancel);process.off('SIGTERM',cancel);}
}
