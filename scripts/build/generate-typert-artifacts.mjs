import {mkdtemp,copyFile,mkdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {generateManagement} from './build-management-remote.mjs';
import {TYPERT_ARTIFACTS} from '../shared/typert-artifacts.mjs';
import {compatibilityRange,verifiedRuntime} from '../shared/target-runtime.mjs';

/**
 * Adaptation-time generator, deliberately outside `pnpm run check`.
 *
 * Under 0.2.1 the official Typert generator only accepts a face that contains every package augments the
 * protocol interfaces, so it cannot run against this repository's single-package analysis workspace. The
 * artifacts therefore stay controlled inputs: this script runs the official generator into owned staging and
 * promotes the result only when it succeeded, then `scripts/gates/verify-typert-artifacts.mjs` proves the promoted
 * artifacts still match the declared Remote surface.
 */
const root=fileURLToPath(new URL('../../', import.meta.url));
const staging=await mkdtemp(join(root,'.scratch','typert-generation-'));
let failure;
try{
 await generateManagement(root,staging,'suite');
 const target=join(root,'packages','suite','typert');
 await mkdir(target,{recursive:true});
 for(const file of TYPERT_ARTIFACTS)await copyFile(join(staging,file),join(target,file));
 await writeFile(join(target,'PROVENANCE.json'),JSON.stringify({
  generator:'@deepseek-ai/dsh-typert-generator',
  generatedFor:verifiedRuntime,
  compatibilityRange,
  at:new Date().toISOString(),
  regenerate:'pnpm run generate:typert-artifacts (scripts/build/generate-typert-artifacts.mjs -> scripts/build/build-management-remote.mjs)',
  note:'Generated, not hand-maintained. The analysis face copies the installed protocol declarations into a registered packages/protocol-types project, routes the root and ./types specifiers to that copy, and analyzes only @omnisurge/dsh-suite through WorkspaceAnalyzer; installed SDK packages keep their own protocol instance, so their augmentations stay out of the face. The artifact verifier compares the result with the declared @Remote surface. Determinism: the same sources and the same verified runtime produce identical bytes across two runs. Earlier hand extensions (listSkills, the MCP tool wall) are retired.',
 },null,2)+'\n');
 console.log('typert artifacts promoted for '+verifiedRuntime+': '+TYPERT_ARTIFACTS.join(', '));
}catch(error){failure=error;throw error;}
finally{await rm(staging,{recursive:true,force:true}).catch(error=>{if(!failure)throw error;});}
