import {WorkspaceAnalyzer, FaceModelEmitter} from '@deepseek-ai/dsh-typert-generator';
import {assertControlledStaging} from '../shared/build-target-core.mjs';
import {verifiedRuntime} from '../shared/target-runtime.mjs';
import {writeFile,readFile,readdir,mkdir,cp,mkdtemp,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
/** rc.2 generator recognises protocol decorators only in registered projects.
 * Its NPM declarations are build inputs, never runtime code or distributable SDK.
 * Copy exact installed public declarations into an owned temporary analysis project;
 * do not synthesise fields, edit the SDK, or weaken diagnostics.
 *
 * Two things keep this analyzable from a single-package repository:
 * 1. The protocol is copied to source under `packages/protocol-types` and registered as a face
 *    project, so `@Remote`/`TypertRemoteService` belong to the analyzed face. The copy's package
 *    exports route both the root and the `./types` subpath to it; that subpath is where our
 *    `RemoteErrorDetailsMap` codes merge, and leaving it on the installed package lost them
 *    (TS2345 for every declared code).
 * 2. The face is analyzed through `WorkspaceAnalyzer` with an explicit package selection instead of
 *    `WorkspaceTypertGenerator#generate`. Generation first discovers every contributor; the protocol
 *    package itself matches that scan (it declares the base service class), and analyzing it expands
 *    the merged `TypertResourceMap`/remote-error maps, which then contain declarations installed SDK
 *    packages own outside this face (dsh-session, dsh-api-gateway). Selecting our package keeps the
 *    program rooted at our sources — the protocol copy is a reference, not a second analyzed face.
 * The installed SDK packages keep resolving their own protocol instance, so their augmentations stay
 * out of the face rather than colliding with the copy.
 *
 * A Cordis `Context` augmentation is only modeled when its service type is an export of the analyzed
 * package: the rc.2 analyzer collects `services` from the augmentation but looks the class up among the
 * package's export records, and skips the member when it is not there. `src/index.ts` therefore has to
 * re-export `SuiteDevelopment` (type-only); without it the model keeps the invocations but loses the
 * service, its members, and every type declaration the Client codegen resolves through `typeSymbol`. */
const ARTIFACT_EXPORTS={
 './typert':{types:'./lib/typert.host.d.ts',default:'./lib/typert.host.js'},
 './remote':{types:'./lib/typert.remote-client.d.ts',default:'./lib/typert.remote-client.js'},
};
/** The generator validates these on emission; the explicit analyzer does not, so keep the check. */
async function assertPublishedArtifacts(root,folder){
 const manifest=JSON.parse(await readFile(join(root,'packages',folder,'package.json'),'utf8'));
 const files=Array.isArray(manifest.files)?manifest.files:[];
 for(const [subpath,expected] of Object.entries(ARTIFACT_EXPORTS)){
  const actual=manifest.exports?.[subpath];
  if(actual?.types!==expected.types||actual?.default!==expected.default)throw Error('TYPERT_EXPORT_INVALID: '+subpath+' must be '+JSON.stringify(expected));
  for(const file of [expected.types.replace(/^\.\/lib\//,'lib/'),expected.default.replace(/^\.\/lib\//,'lib/')])if(!files.includes(file))throw Error('TYPERT_FILES_INVALID: package files must include '+file);
 }
}
export async function generateManagement(root,output,folder='suite'){
 if(folder!=='suite')throw Error('Unsupported owned Remote target: the Suite owns the one Remote namespace');
 output=await assertControlledStaging(root,output);
 const require=createRequire(join(root,'package.json'));
 const protocol=dirname(require.resolve('@deepseek-ai/dsh-typert-protocol/package.json'));
 const metadata=JSON.parse(await readFile(join(protocol,'package.json'),'utf8'));
 if(metadata.version!==verifiedRuntime)throw Error('SDK_ABI_CHANGED: recheck public declaration analysis for '+metadata.version);
 await mkdir(join(root,'.scratch'),{recursive:true});const analysis=await mkdtemp(join(root,'.scratch','typert-analysis-'));
 let primary;try{
  const options={target:'ES2022',module:'NodeNext',moduleResolution:'NodeNext',strict:true,skipLibCheck:true,types:['node'],noEmit:true,allowImportingTsExtensions:true};
  const suite=join(analysis,'packages',folder),types=join(analysis,'packages','protocol-types');
  await mkdir(suite,{recursive:true});await mkdir(join(types,'src'),{recursive:true});
  await cp(join(root,'packages',folder,'src'),join(suite,'src'),{recursive:true});
  await cp(join(root,'packages',folder,'package.json'),join(suite,'package.json'));
  // The analyzer maps every runtime export target back to a source file (lib/<x>.js → src/<x>.ts). The
  // carried MCP client modules export *bundle entries* whose source lives under src/clients/<name>/index.ts
  // (ADR-033), so those subpaths have no one-to-one source and would abort the whole face. They declare no
  // typert objects, schemas or services, so the analysis manifest simply omits entries it cannot map —
  // the shipped package.json keeps them, and this copy never leaves .scratch.
  {
   const manifest=JSON.parse(await readFile(join(suite,'package.json'),'utf8'));
   if(manifest.exports!==null&&typeof manifest.exports==='object'){
    for(const [subpath,value] of Object.entries(manifest.exports)){
     if(subpath.includes('*'))continue;
     const target=typeof value==='string'?value:value?.default;
     if(typeof target!=='string')continue;
     const normalized=target.replace(/^\.\//,'');
     if(!normalized.startsWith('lib/'))continue;
     const source=join(suite,'src',normalized.slice(4).replace(/\.(?:mjs|cjs|js|d\.ts)$/,'.ts'));
     if(!existsSync(source))delete manifest.exports[subpath];
    }
   }
   await writeFile(join(suite,'package.json'),JSON.stringify(manifest));
  }
  // The installed declarations import their siblings as `./types.ts`, so the copy is promoted to
  // source files rather than left as `.d.ts`; the package exports point TypeScript at those sources.
  for(const file of await readdir(join(protocol,'lib/types'))){if(file.endsWith('.d.ts'))await writeFile(join(types,'src',file.replace(/\.d\.ts$/,'.ts')),await readFile(join(protocol,'lib/types',file)));}
  const exportsField={'.':'./src/index.ts','./types':'./src/types.ts','./remote-info':'./src/remote-info.ts','./package.json':'./package.json'};
  await writeFile(join(types,'package.json'),JSON.stringify({name:metadata.name,version:metadata.version,type:'module',exports:exportsField}));
  await writeFile(join(types,'tsconfig.json'),JSON.stringify({compilerOptions:options,include:['src/**/*.ts']}));
  await writeFile(join(suite,'tsconfig.json'),JSON.stringify({compilerOptions:options,include:['src/**/*.ts']}));
  // The carried MCP client modules (clients/**, ADR-033) import the MCP SDK, which pnpm installs only for
  // packages/suite (never hoisted to this repository's root). The analysis project lives under .scratch, so
  // Node's own resolution would not find it; map the specifier to the installed declaration file exactly like
  // the protocol copy above. Build-time only: nothing here reaches the emitted artifacts.
  // Resolve the package entry (its export map has no `./package.json` subpath), then read the declaration
  // entry named by its own manifest.
  const sdkEntry=require.resolve('@modelcontextprotocol/client',{paths:[join(root,'packages',folder)]});
  const sdkDir=dirname(dirname(sdkEntry));
  const sdkManifest=JSON.parse(await readFile(join(sdkDir,'package.json'),'utf8'));
  const sdkTypes=resolve(sdkDir,sdkManifest.exports?.['.']?.import?.types??sdkManifest.types??'dist/index.d.mts');
  const faceOptions={...options,baseUrl:analysis,paths:{
   '@deepseek-ai/dsh-typert-protocol':[join(types,'src/index.ts')],
   '@deepseek-ai/dsh-typert-protocol/types':[join(types,'src/types.ts')],
   '@deepseek-ai/dsh-typert-protocol/remote-info':[join(types,'src/remote-info.ts')],
   '@modelcontextprotocol/client':[sdkTypes],
  }};
  await writeFile(join(analysis,'tsconfig.host.json'),JSON.stringify({compilerOptions:faceOptions,files:[],references:[{path:'./packages/'+folder+'/tsconfig.json'},{path:'./packages/protocol-types/tsconfig.json'}]}));
  await writeFile(join(suite,'tsconfig.json'),JSON.stringify({compilerOptions:faceOptions,include:['src/**/*.ts']}));
  await writeFile(join(types,'tsconfig.json'),JSON.stringify({compilerOptions:faceOptions,include:['src/**/*.ts']}));
  // Selecting only our package keeps the protocol copy a referenced project instead of a second
  // analyzed contributor (see the header comment); the SDK packages resolve from this repository's
  // own node_modules through the analysis project living inside the workspace.
  const workspace=new WorkspaceAnalyzer({root:analysis,packages:['@omnisurge/dsh-suite'],faces:['host']}).analyze();
  const face=workspace.faces.find(candidate=>candidate.face==='host');
  if(face===undefined)throw Error('TYPERT_FACE_MISSING: the analysis produced no host face for '+folder);
  // The emitter would happily ship invocations with no service and no type declarations; every namespace
  // that answers an invocation must also be modeled as a service, or the Client gets dangling typeSymbols.
  const modeled=face.packages.find(candidate=>candidate.name==='@omnisurge/dsh-suite');
  const serviceKeys=new Set(modeled.services.map(service=>service.key));
  for(const namespace of new Set(modeled.invocations.map(invocation=>invocation.namespace))){if(!serviceKeys.has(namespace))throw Error('TYPERT_SERVICE_UNMODELED: '+namespace+' answers invocations but the face model has no service for it; export the service class from a package export subpath (the rc.2 analyzer only models exported service classes)');}
  const artifact=new FaceModelEmitter(face).emit('@omnisurge/dsh-suite');
  if(typeof artifact.remote?.js!=='string')throw Error('TYPERT_REMOTE_MISSING: the host face emitted no Remote client artifact; a Remote method is required');
  await assertPublishedArtifacts(root,folder);
  await mkdir(output,{recursive:true});
  await writeFile(join(output,'typert.host.js'),artifact.js);await writeFile(join(output,'typert.host.d.ts'),artifact.dts);
  await writeFile(join(output,'typert.remote-client.js'),artifact.remote.js);await writeFile(join(output,'typert.remote-client.d.ts'),artifact.remote.dts);
 }catch(error){primary=error;throw error;}finally{try{await rm(analysis,{recursive:true,force:true});}catch(error){if(primary)primary.message+='; CLEANUP_FAILED: Remote analysis '+error.message;else throw Error('REMOTE_GENERATED: staging output completed; CLEANUP_FAILED: '+error.message);}}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){if(process.argv.length!==4)throw Error('STAGING_REQUIRED: build-management-remote requires <staging> <suite|web-search-searxng>');const root=fileURLToPath(new URL('../../', import.meta.url));await generateManagement(root,process.argv[2],process.argv[3]);}