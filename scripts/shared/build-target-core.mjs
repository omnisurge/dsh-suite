import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {mkdir,readFile,readdir,writeFile,rename,rm,open,mkdtemp,lstat,realpath} from 'node:fs/promises';
import {join,dirname,resolve,relative,isAbsolute,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {SUITE_DEVELOPMENT_PROTOCOL,BUILDER_VERSION,ENTRY_FILES,REQUIRED_CAPABILITIES} from './build-protocol.mjs';
/** This file is executed from disk by the fixed entry for every click; it must not
 * depend on any module the loaded manager already cached. */
export const repository=fileURLToPath(new URL('../../', import.meta.url));
async function digest(files){
 const hash=createHash('sha256');
 for(const [label,file] of files){hash.update(label);hash.update('\0');hash.update(await readFile(file));hash.update('\0');}
 return hash.digest('hex');
}
/** Every owned input whose bytes can change the produced artifacts, one caliber. */
export async function sourceFingerprint(root,signal){
 const suite=join(root,'packages/suite'),files=[];
 async function collect(relative,directory){
  for(const entry of (await readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
   const child=join(directory,entry.name);
   if(entry.isDirectory())await collect(relative+'/'+entry.name,child);else files.push([relative+'/'+entry.name,child]);
  }
 }
 await collect('packages/suite/src',join(suite,'src'));
 // The Typert artifacts are controlled inputs of the build, so their bytes are part of the fingerprint:
 // regenerating them outside the build must change what the build considers current.
 await collect('packages/suite/typert',join(suite,'typert'));
 for(const name of ['package.json','tsconfig.json','components.json','cordis.patch.yml'])files.push(['packages/suite/'+name,join(suite,name)]);
 for(const name of ENTRY_FILES)files.push([name,join(root,name)]);
 for(const name of ['package.json','pnpm-lock.yaml'])files.push([name,join(root,name)]);
 // Resolve in a new process too: require.resolve and compiler module caches in a
 // long-lived watcher cannot identify a newly installed/resolved local toolchain.
 const resolver=String.raw`import {createRequire} from 'node:module';import {join,dirname} from 'node:path';import {readdir,readFile,realpath} from 'node:fs/promises';import {createHash} from 'node:crypto';const root=process.argv[1];

 const require=createRequire(join(root,'package.json')),ts=require('typescript'),business=join(root,'packages/suite');
 const config=ts.readConfigFile(join(business,'tsconfig.json'),ts.sys.readFile);
 if(config.error)throw Error('FINGERPRINT_CONFIG: '+ts.flattenDiagnosticMessageText(config.error.messageText,' '));
 const parsed=ts.parseJsonConfigFileContent(config.config,ts.sys,business);
 const program=ts.createProgram(parsed.fileNames,parsed.options);
 const inputs=new Set(program.getSourceFiles().filter(file=>file.isDeclarationFile).map(file=>file.fileName));
 for(const request of ['typescript','typescript/package.json','typescript/bin/tsc','esbuild','esbuild/package.json','@deepseek-ai/dsh-typert-generator/package.json','@deepseek-ai/dsh-typert-protocol/package.json'])inputs.add(require.resolve(request));
 inputs.add(join(dirname(require.resolve('typescript')),'_tsc.js'));
 const protocol=dirname(require.resolve('@deepseek-ai/dsh-typert-protocol/package.json'));
 for(const name of (await readdir(join(protocol,'lib/types'))).filter(name=>name.endsWith('.d.ts')))inputs.add(join(protocol,'lib/types',name));
 const generator=dirname(require.resolve('@deepseek-ai/dsh-typert-generator'));
 async function collect(directory){for(const entry of await readdir(directory,{withFileTypes:true})){const file=join(directory,entry.name);if(entry.isDirectory())await collect(file);else if(entry.name.endsWith('.js'))inputs.add(file);}}
 await collect(generator);
 // The generated Client consumes Zod at bundle time, and the generator resolves its
 // own TypeScript/mapping dependencies (which need not equal the root compiler).
 const generatorRequire=createRequire(require.resolve('@deepseek-ai/dsh-typert-generator'));
 for(const request of ['typescript','@jridgewell/gen-mapping'])inputs.add(generatorRequire.resolve(request));
 const esbuild=require('esbuild');
 try{const result=await esbuild.build({stdin:{contents:"import {z} from 'zod'; console.log(z);",resolveDir:root},bundle:true,write:false,platform:'browser',target:'es2022',metafile:true});for(const file of Object.keys(result.metafile.inputs))if(file!=='<stdin>')inputs.add(join(root,file));}finally{esbuild.stop();}
 const esbuildRequire=createRequire(require.resolve('esbuild')),pkg='@esbuild/'+process.platform+'-'+process.arch,subpath=process.platform==='win32'?'esbuild.exe':'bin/esbuild';
 let binary;try{binary=esbuildRequire.resolve(pkg+'/'+subpath);}catch(error){if(error.code!=='MODULE_NOT_FOUND')throw error;binary=join(dirname(require.resolve('esbuild')),'downloaded-'+pkg.replace('/','-')+'-'+subpath.split('/').at(-1));}
 inputs.add(binary);
 const hash=createHash('sha256');for(const file of [...inputs].sort()){const identity=await realpath(file);hash.update(identity);hash.update('\0');hash.update(await readFile(identity));hash.update('\0');}console.log(hash.digest('hex'));
`;
 const output=await run(process.execPath,['--input-type=module','-e',resolver,root],{cwd:root,signal,env:{PATH:'/usr/bin:/bin',HOME:join(root,'.scratch'),TMPDIR:join(root,'.scratch'),LANG:'C.UTF-8',ELECTRON_RUN_AS_NODE:'1',NODE_NO_WARNINGS:'1'}});
 if(!/^[a-f0-9]{64}$/.test(output.trim()))throw Error('FINGERPRINT_INVALID: toolchain resolver returned no identity');
 return createHash('sha256').update(await digest(files)).update('\0resolved-inputs\0').update(output.trim()).digest('hex');
}
/** Identity of the entry bytes that must run on this click; never module-cached. */
export async function entryFingerprint(root){
 return digest(ENTRY_FILES.map(name=>[name,join(root,name)]));
}
/** Receipt identifies the generated bytes actually loaded, including compiler options.
 * `extraInputs` are build inputs whose own output is written *after* this receipt is taken: the carried MCP
 * client bundles (ADR-033) are built from `src/clients/**`, so that source tree belongs to this generation's
 * identity even though its bundles do not exist yet. Hashing the input tree keeps the receipt a function of
 * its inputs; hashing the finished bundles instead would be self-referential (the receipt is stamped into the
 * generation it would be hashing) and would break the `changed:0` determinism of a repeat build. Names are
 * relative and the caller sorts them, so the digest cannot depend on where the build ran. */
export async function artifactRevisions(directory,client,extraInputs=[]){
 const hash=createHash('sha256');
 for(const file of (await readdir(directory)).filter(name=>name.endsWith('.js')&&name!=='client.js').sort()){hash.update(file);hash.update(await readFile(join(directory,file)));}
 for(const [name,bytes] of extraInputs){hash.update(name);hash.update('\0');hash.update(bytes);hash.update('\0');}
 return {hostRevision:hash.digest('hex'),clientRevision:createHash('sha256').update(client).digest('hex')};
}
async function readOptional(file){try{return await readFile(file,'utf8');}catch(error){if(error.code==='ENOENT')return null;throw error;}}
/** Prove the running capabilities exist in this generation instead of assuming the compiler exit code. */
export async function inspectCapabilities(lib,signal,packageName){
 // Execute the exact completed generation in a fresh process. The VM only captures the
 // public Client factory advertisement; it does not pretend to be a running DSH host.
 const script=`import {readFile} from 'node:fs/promises';import {pathToFileURL} from 'node:url';import {join} from 'node:path';import vm from 'node:vm';
 const lib=process.argv[1],name=process.argv[2],methods=['inspect','check','checkSaved'];
 const optional=async name=>{const file=join(lib,name);try{await readFile(file);}catch(e){if(e.code==='ENOENT')return {};throw e;}return import(pathToFileURL(file));};
 const setup=await optional('searxng.js'),host=await optional('typert.host.js'),remote=await optional('typert.remote-client.js');
 const descriptors=(value,key)=>methods.every(method=>value?.[key]?.some(d=>d.service==='omnisurgeSearxngSetup'&&d.namespace==='omnisurgeSearxngSetup'&&d.method===method&&d.invocation?.kind==='direct'&&typeof d.result?.create==='function'&&d.cancellation?.parameter==='signal'));
 let advertisement={},entry;try{const code=await readFile(join(lib,'client.js'),'utf8');vm.runInNewContext(code,{window:{__ModuleLoader__:{load(value){entry=value;}}},console,setTimeout,clearTimeout,AbortController,URL},{timeout:3000});advertisement=entry?.id===name?(entry.capabilities??{}):{};if(entry?.id===name){const exported=entry.factory(name=>{if(name==='react')return {createElement(){}};if(name==='react/jsx-runtime')return {jsx(){},jsxs(){},Fragment:Symbol.for('react.fragment')};throw Error('Unexpected Client external '+name);}),plugin=typeof exported?.apply==='function'?exported:(exported?.default??{});if(typeof plugin.apply==='function')plugin.apply({provide(name,value){if(name==='omnisurgeSearxngClientBuild')advertisement=value.capabilities;},effect(){},locale:{bind(){return key=>String(key);}},configForms:{get(){return {};}}});}}catch(e){if(e.code!=='ENOENT')throw e;}
 const stamped=setup.setupBuildSupported===true;
 console.log(JSON.stringify({hostStamped:stamped,hostRemote:stamped&&methods.every(method=>typeof setup.SearxngSetup?.prototype[method]==='function')&&descriptors(host.TYPERT,'invocations')&&descriptors(remote.TYPERT_REMOTE,'descriptors'),clientRemote:advertisement.clientRemote===true&&descriptors(remote.TYPERT_REMOTE,'descriptors'),clientFlow:advertisement.clientFlow===true}));`;
 // A staging generation has no manifest beside it, so the owning package identity is passed in; the
 // accepted layout falls back to the manifest that owns this lib directory.
 const owner=packageName??JSON.parse(await readFile(join(dirname(resolve(lib)),'package.json'),'utf8')).name;
 const output=await run(process.execPath,['--input-type=module','-e',script,resolve(lib),owner],{signal,env:{PATH:'/usr/bin:/bin',HOME:dirname(resolve(lib)),TMPDIR:dirname(resolve(lib)),LANG:'C.UTF-8',ELECTRON_RUN_AS_NODE:'1',NODE_NO_WARNINGS:'1'}});
 return JSON.parse(output.trim().split('\n').at(-1));
}
/** Spawn with piped output; failures keep the tail of stdout/stderr in the message. */
export function run(command,args,options={}){return new Promise((accept,reject)=>{
 const child=spawn(command,args,{...options,stdio:['ignore','pipe','pipe']});let output='',failure;
 for(const stream of [child.stdout,child.stderr])stream.on('data',data=>{output=(output+data).slice(-12000);});
 child.once('error',error=>{failure=error;});
 // AbortError is emitted BEFORE close. Do not settle early or discard the child's
 // rollback/cleanup outcome: the exclusive parent owner must outlive child cleanup.
 child.once('close',(code,term)=>{if(failure){failure.message+='; child closed '+code+'/'+term+(output?'\n'+output:'');reject(failure);}else if(code===0)accept(output);else reject(Error(command+' exited '+code+'/'+term+'\n'+output));});
});}
/** Atomic file replacement; identical bytes are left alone so HMR is not churned. */
export async function publishChanged(file,bytes){let old;try{old=await readFile(file);}catch(error){if(error.code!=='ENOENT')throw error;}if(old?.equals(bytes))return false;await mkdir(dirname(file),{recursive:true});const temporary=file+'.manager-'+process.pid;try{await writeFile(temporary,bytes);await rename(temporary,file);}finally{await rm(temporary,{force:true});}return true;}
/** Logical generation transaction under the caller's exclusive target lease.
 * No symlink/module-identity tricks: accepted paths stay unchanged. Individual renames
 * are atomic, the multi-file window is NOT physically atomic to HMR/readers. Any caught
 * I/O failure or cancellation before the commit point restores and verifies all old bytes.
 * SIGKILL cannot run recovery: retained journal/material blocks another publish.
 * This is not a durable database transaction: power-loss/fsync guarantees are not claimed.
 * Once COMMITTED is persisted and cancellation checked, cleanup is non-cancellable. */
export async function publishGeneration(directory,generation,signal){
 directory=resolve(directory);const parent=dirname(directory),prefix='.'+directory.slice(parent.length+1)+'.generation-';
 const check=()=>signal?.throwIfAborted();check();
 if(!(generation instanceof Map))throw Error('GENERATION_INVALID: expected a complete Map<string,Buffer>');
 for(const [name,bytes] of generation)if(!name||name==='.'||name==='..'||name.includes('/')||name.includes('\\')||!Buffer.isBuffer(bytes))throw Error('GENERATION_INVALID: flat owned file names and Buffer bytes required');
 async function canonical(){if(await realpath(parent)!==parent)throw Error('OUTPUT_ALIAS: output parent redirects');try{if(await realpath(directory)!==directory)throw Error('OUTPUT_ALIAS: generation output redirects');}catch(error){if(error.code!=='ENOENT')throw error;}}
 await canonical();check();
 for(const name of await readdir(parent))if(name.startsWith(prefix)){
  let journal;try{journal=JSON.parse(await readFile(join(parent,name,'journal.json'),'utf8'));}catch(error){throw Error('RECOVERY_REQUIRED: unresolved generation material '+join(parent,name)+'; '+error.message);}
  if(!['COMMITTED','ROLLED_BACK','PREPARE_FAILED'].includes(journal.phase))throw Error('RECOVERY_REQUIRED: unresolved generation material '+join(parent,name));
 }
 check();const old=new Map();let existed=true;
 let oldNames;try{oldNames=await readdir(directory);}catch(error){if(error.code!=='ENOENT')throw error;existed=false;oldNames=[];}check();
 for(const name of oldNames){check();const file=join(directory,name),stat=await lstat(file);check();if(!stat.isFile()||stat.isSymbolicLink())throw Error('OUTPUT_ALIAS: generation contains a non-regular owned file '+name);old.set(name,await readFile(file));check();}
 // Preserve the Host-first/Client-last contract even when filesystem names are alphabetical.
 const names=[...new Set([...old.keys(),...generation.keys()])].sort((a,b)=>{if(a==='client.js')return b==='client.js'?0:1;if(b==='client.js')return -1;return a.localeCompare(b);});
 const changed=names.filter(name=>!old.get(name)?.equals(generation.get(name)??Buffer.alloc(0))||!old.has(name)||!generation.has(name));
 if(!changed.length){check();return 0;}
 const transaction=await mkdtemp(join(parent,prefix));let failure,committing=false,committed=false,keep=false;
 const journal={directory,phase:'PREPARING',oldFiles:[...old.keys()],newFiles:[...generation.keys()],changed};
 const record=async phase=>{journal.phase=phase;await writeFile(join(transaction,'journal.json'),JSON.stringify(journal,null,2)+'\n');};
 try{
  check();await mkdir(join(transaction,'old'));check();await mkdir(join(transaction,'new'));check();await record('PREPARING');check();
  for(const [name,bytes] of old){await writeFile(join(transaction,'old',name),bytes);check();}
  for(const [name,bytes] of generation){await writeFile(join(transaction,'new',name),bytes);check();}
  await record('PREPARED');check();await canonical();check();
  // Check that even an uncooperative writer has not changed the snapshot before commit.
  if(existed){const actual=(await readdir(directory)).sort();check();if(JSON.stringify(actual)!==JSON.stringify([...old.keys()].sort()))throw Error('OUTPUT_CHANGED: generation changed before commit');for(const [name,bytes] of old){const stat=await lstat(join(directory,name));check();if(!stat.isFile()||stat.isSymbolicLink()||!(await readFile(join(directory,name))).equals(bytes))throw Error('OUTPUT_CHANGED: '+name);check();}}
  await record('COMMITTING');check();committing=true;
  if(!existed){await mkdir(directory);check();}
  for(const name of changed){check();await canonical();check();if(generation.has(name))await rename(join(transaction,'new',name),join(directory,name));else await rm(join(directory,name));check();}
  await record('COMMITTED');check();committed=true;
 }catch(error){
  failure=error;
  if(committing){
   const recovery=[];
   // Ignore cancellation during recovery: restore all members, not just the last rename.
   for(const name of changed){try{await canonical();if(old.has(name)){const temporary=join(transaction,'restore-'+name);await writeFile(temporary,old.get(name));await rename(temporary,join(directory,name));}else await rm(join(directory,name),{force:true});}catch(error){recovery.push(name+': '+error.message);}}
   try{const actual=(await readdir(directory)).sort();if(JSON.stringify(actual)!==JSON.stringify([...old.keys()].sort()))throw Error('old file set differs');for(const [name,bytes] of old){if(!(await readFile(join(directory,name))).equals(bytes))throw Error('old bytes differ: '+name);}if(!existed)await rm(directory);}catch(error){recovery.push('verify: '+error.message);}
   if(recovery.length){keep=true;failure.message+='; PARTIAL/RECOVERY_REQUIRED: '+recovery.join('; ')+'; recovery material '+transaction;try{await record('RECOVERY_REQUIRED');}catch(error){failure.message+='; journal diagnostic: '+error.message;}}
   else{failure.message+='; GENERATION_ROLLED_BACK: complete old file set and bytes verified';try{await record('ROLLED_BACK');}catch(error){failure.message+='; cleanup journal diagnostic: '+error.message;}}
  }else{failure.message+='; GENERATION_NOT_PUBLISHED: accepted generation unchanged';try{await record('PREPARE_FAILED');}catch(error){failure.message+='; cleanup journal diagnostic: '+error.message;}}
 }finally{
  if(!keep)try{await rm(transaction,{recursive:true,force:true});}catch(error){if(failure)failure.message+='; CLEANUP_FAILED: '+error.message+'; material '+transaction;else failure=Error('GENERATION_COMMITTED: accepted generation complete; CLEANUP_FAILED: '+error.message+'; material '+transaction);}
 }
 if(failure)throw failure;
 if(!committed)throw Error('RECOVERY_REQUIRED: generation has no terminal outcome');
 return changed.length;
}
function command(args,cwd,env,signal){return run(process.execPath,args,{cwd,env,signal}).then(()=>{},error=>{throw Error('Compiler rejected: '+error.message);});}
async function targetPaths(root){
 const business=join(root,'packages/suite');if(await realpath(business)!==business)throw Error('OUTPUT_ALIAS: the Suite target escapes its source owner');
 try{if(await realpath(join(business,'lib'))!==join(business,'lib'))throw Error('OUTPUT_ALIAS: compiled output redirects');}catch(error){if(error.code!=='ENOENT')throw error;}
}
async function assertOwnedScratch(scratch,state){
 const canonical=await realpath(scratch),requested=resolve(state),rel=relative(canonical,requested);
 if(!rel||rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel))throw Error('STATE_ALIAS: compiler state escapes scratch');
 let ancestor=requested;
 for(;;){try{const actual=await realpath(ancestor);if(actual!==canonical&&!actual.startsWith(canonical+sep))throw Error('STATE_ALIAS: compiler state escapes scratch');break;}catch(error){if(error.code!=='ENOENT')throw error;ancestor=dirname(ancestor);}}
}
/** Staging helpers have no accepted-output mode. Validate before even creating analysis files. */
export async function assertControlledStaging(root,output){
 if(typeof output!=='string'||!output)throw Error('STAGING_REQUIRED: explicit owned staging directory required');
 root=await realpath(resolve(root));const scratch=join(root,'.scratch'),requested=resolve(output);
 const rel=relative(scratch,requested);
 if(!rel||rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel))throw Error('STAGING_REQUIRED: output must be a descendant of owned .scratch, never accepted lib');
 let current=requested;
 for(;;){if(await realpath(current)!==current)throw Error('STAGING_ALIAS: staging redirects');if(current===scratch)break;current=dirname(current);}
 if(!(await lstat(requested)).isDirectory())throw Error('STAGING_REQUIRED: staging must be an existing directory');
 return requested;
}
/** Fixed SearXNG target only. A rejected generation never replaces accepted files, and a
 * generation whose running capabilities cannot be proven is rejected before any publish. */
export async function buildTarget(root,state,signal=new AbortController().signal){
 signal.throwIfAborted();root=await realpath(resolve(root));await targetPaths(root);
 const scratch=join(root,'.scratch');await mkdir(scratch,{recursive:true});if((await lstat(scratch)).isSymbolicLink())throw Error('STATE_ALIAS: scratch redirects');
 await assertOwnedScratch(scratch,state);
 const before=await sourceFingerprint(root,signal),entry=await entryFingerprint(root);
 // Imported lazily: the Suite build owns its own lease, staging and publish, and importing it eagerly
 // would make this module and the Suite entry one load-time cycle.
 const {buildSuite}=await import('../build/build-suite.mjs');
 const {changed,hostRevision,clientRevision,capabilities}=await buildSuite(root,state,undefined,signal);
 if(await sourceFingerprint(root,signal)!==before)throw Error('SOURCE_CHANGED: source or build entry changed during compilation; retry the new generation');
 if(await entryFingerprint(root)!==entry)throw Error('BUILDER_CHANGED: the fixed build entry changed during compilation; retry the new generation');
 // The receipt reports the revisions the published artifacts actually carry, not a fresh digest of the
 // stamped bytes, which would name a revision no artifact contains.
 return {protocol:SUITE_DEVELOPMENT_PROTOCOL,builderVersion:BUILDER_VERSION,entryFingerprint:entry,sourceFingerprint:before,hostRevision,clientRevision,capabilities,changed};
}
