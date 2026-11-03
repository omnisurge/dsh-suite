import {copyFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
/** The four generated Typert artifacts are controlled inputs, not build output: the official generator
 * must analyze a face that contains every package augmenting the protocol interfaces, which a
 * single-package workspace cannot satisfy. They are produced deliberately (see
 * scripts/build/generate-typert-artifacts.mjs) and verified against the source surface by
 * scripts/gates/verify-typert-artifacts.mjs before they are ever packed. */
export const TYPERT_ARTIFACTS=['typert.host.js','typert.host.d.ts','typert.remote-client.js','typert.remote-client.d.ts'];
export async function installTypertArtifacts(root,output,folder='suite'){
 const source=join(root,'packages',folder,'typert');
 await mkdir(output,{recursive:true});
 for(const file of TYPERT_ARTIFACTS)await copyFile(join(source,file),join(output,file));
 return TYPERT_ARTIFACTS.map(file=>join(output,file));
}
