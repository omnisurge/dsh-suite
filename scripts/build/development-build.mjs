import {mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {run,publishChanged} from '../shared/build-target-core.mjs';
export {run,publishChanged};
/** The watcher only caches process plumbing, never a mutable compiler/publisher algorithm.
 * Suite and business have independent owners/commit boundaries, not a cross-target transaction. */
export async function buildDevelopment(sourceRoot,stateRoot,env,signal){
 sourceRoot=resolve(sourceRoot);const controller=signal??new AbortController().signal;
 controller.throwIfAborted();await mkdir(stateRoot,{recursive:true});controller.throwIfAborted();
 const suiteOutput=await run(process.execPath,[join(sourceRoot,'scripts/build/build-suite.mjs'),sourceRoot,stateRoot],{cwd:sourceRoot,env,signal:controller});
 const suite=JSON.parse(suiteOutput.trim().split('\n').at(-1));
 controller.throwIfAborted();
 try{
  const output=await run(process.execPath,[join(sourceRoot,'scripts/build/build-target.mjs'),'--root',sourceRoot,'--state',join(sourceRoot,'.scratch/suite-watcher')],{cwd:sourceRoot,env,signal:controller});
  const line=output.trim().split('\n').findLast(line=>line.startsWith('OMNISURGE_BUILD_RECEIPT '));
  if(!line)throw Error('BUILD_RECEIPT_MISSING: fixed business CLI produced no receipt');
  const business=JSON.parse(line.slice('OMNISURGE_BUILD_RECEIPT '.length));
  return {changed:suite.changed+business.changed,protocol:business.protocol,entryFingerprint:business.entryFingerprint,capabilities:business.capabilities};
 }catch(error){error.message+='; Suite bootstrap completed independently; business failure/rollback status is reported above, not a whole-suite last-good guarantee';throw error;}
}
