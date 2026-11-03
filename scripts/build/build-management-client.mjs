import {build} from 'esbuild';
import {readFile,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
/**
 * Absolute path of the UI library entry.
 *
 * esbuild resolves alias values against the current working directory, and an isolated fixture copies
 * `scripts/` too, so neither the fixture root nor this file's own location identifies the owner. Walk up
 * from the build root until the repository that carries the built library is found.
 */
export function libraryEntry(root){
 for(let dir=resolve(root);;){
  const candidate=join(dir,'packages/ui/lib/index.js');
  if(existsSync(candidate))return candidate;
  const parent=dirname(dir);
  if(parent===dir)throw Error('OMNISURGE_UI_LIBRARY_MISSING: build packages/ui first (pnpm --filter @omnisurge/dsh-ui build)');
  dir=parent;
 }
}
import {join} from 'node:path';

/**
 * Owned Client build in the official module-loader shape: the emitted file is a single
 * `window.__ModuleLoader__.load({id, factory:(require)=>{…}})` call whose body is the bundled CommonJS
 * module — the same shape the target runtime's own client bundles use. React and the JSX runtime stay
 * external and resolve through the loader's `require`, so no second React and no SDK copy can enter the
 * artifact, and the factory id is the plugin's own package name.
 */
/**
 * The one SDK input the Client bundle accepts must stay a pure leaf. This is executable evidence, not a
 * comment: if a future protocol release makes `remote-info` import a runtime module or register
 * something, the bundle must stop accepting it instead of silently inlining SDK runtime.
 * @param file - resolved esbuild input path already known to belong to the protocol package.
 */
async function assertPureProtocolLeaf(file){
 const source=await readFile(file,'utf8');
 const runtimeImport=/(?:^|\n)\s*import\s+(?!type\b)|(?:^|\n)\s*import\s*['"]|\brequire\s*\(|\bfrom\s*['"](?:node:|@deepseek-ai\/)/;
 if(runtimeImport.test(source))throw Error('SDK_PROTOCOL_LEAF_IMPURE: '+file+' gained a runtime import; the Client bundle may only inline the dependency-free protocol leaf');
}
export async function buildManagementClient(root,output,folder='suite'){
 if(folder!=='suite')throw Error('Unsupported owned Client target: the Suite owns the one Client module');
 const source=await readFile(join(root,'packages',folder,'src/client.js'),'utf8');
 const anchor="'../lib/typert.remote-client.js'";
 if(source.split(anchor).length!==2)throw Error('Expected exactly one owned generated Remote build input');
 const imported=JSON.stringify(join(output,'typert.remote-client.js'));
 // Both generated inputs are bundled into the one Client module: the generated Remote namespace and the
 // self-service flow. The import is emitted at the top of the module, the marker inside the body becomes
 // its binding, and the flow is only a capability because it is really here.
 const contents=source.replace(anchor,imported);
 const packageName=JSON.parse(await readFile(join(root,'packages',folder,'package.json'),'utf8')).name;
 const result=await build({stdin:{contents,resolveDir:join(root,'packages',folder),sourcefile:'suite-development-client.js'},bundle:true,write:false,format:'cjs',platform:'browser',target:'es2022',minify:true,legalComments:'none',metafile:true,external:['react','react/jsx-runtime','react-dom','react-dom/client'],
  // The UI library is this repository's own build-time package (ADR-028): resolve it by path so an
  // isolated copy without package-manager links compiles exactly like a linked checkout. A fixture that
  // copies only the owned targets still compiles the same library bytes from this repository.
  alias:{'@omnisurge/dsh-ui':libraryEntry(root)}});
 for(const input of Object.keys(result.metafile.inputs)){
  // One deliberate leaf exception: the generated Remote artifact imports the protocol's pure factory
  // (createTypertRemoteInfo) because that is the 0.2.1 emission contract. The leaf has no runtime
  // imports of its own (protocol README: "The leaf has no runtime imports; generated artifacts supply
  // Zod"), no Cordis service and no mutable state, so bundling it copies no SDK runtime, no second React
  // and no kernel module — and the Client module table does not serve '@deepseek-ai/*' ids, so it cannot
  // be an external. Everything else from the SDK stays forbidden.
  const protocolLeaf=input.replace(/\\/g,'/').endsWith('/@deepseek-ai/dsh-typert-protocol/lib/types/remote-info.js');
  if(protocolLeaf)await assertPureProtocolLeaf(input);
  else if(input.includes('@deepseek-ai/')||/(?:^|\/)react(?:-dom)?\//.test(input)||input.includes('/cordis/'))throw Error('SDK_RUNTIME_COPY_FORBIDDEN: '+input);
 }
 if(result.outputFiles.length!==1)throw Error('Expected one module-loader Client bundle');
 const remoteText=await readFile(join(output,'typert.remote-client.js'),'utf8').catch(()=> '');
 const capabilities={
  // Build facts, not runtime guesses: the generated Remote either carries this namespace and its
  // methods or it does not, and the self-service flow either exists as bundled source or it does not.
  // The advertised namespace and its three methods as whole identifiers: the real proof is the
  // capability gate, which imports the generated Remote and reads its descriptors.
  clientRemote:remoteText.includes('omnisurgeSearxngSetup')&&['inspect','check','checkSaved'].every(method=>new RegExp('\\b'+method+'\\b').test(remoteText)),
  // The self-service flow is a capability only when it is really bundled and its entry point is still
  // exported: a flow that lost its export cannot be offered to the user.
  clientFlow:Object.keys(result.metafile.inputs).some(input=>input.includes('search/client-flow.js'))
   &&/export\s+(?:async\s+)?function\s+saveConnection\b/.test(await readFile(join(root,'packages/suite/src/search/client-flow.js'),'utf8').catch(()=> '')),
 };
 const wrapped=wrapClientBundle(packageName,result.outputFiles[0].text,capabilities);
 await writeFile(join(output,'client.js'),wrapped);
}

/** Wrap a bundled CommonJS Client body exactly as the module loader expects to receive it. */
export function wrapClientBundle(packageName,cjsText,capabilities){
 // The loader descriptor is where the runtime reads a Client's advertised capabilities, so the build
 // states what it actually produced instead of leaving a runtime lookup to guess.
 const advertised=capabilities&&Object.keys(capabilities).length?' capabilities: '+JSON.stringify(capabilities)+',\n':'';
 return 'window.__ModuleLoader__.load({\n id: '+JSON.stringify(packageName)+',\n'+advertised+' factory: (require) => {\n'
  +'  var module = { exports: {} };\n  var exports = module.exports;\n'
  +'  Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });\n'
  +cjsText+'\n  return module.exports;\n }\n});\n';
}