import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const suite=JSON.parse(readFileSync(new URL('../../packages/suite/package.json', import.meta.url),'utf8'));
/** The DSH generation this plugin claims, as the one range it ships in `engines.dsh`. */
export const compatibilityRange=suite.engines?.dsh;
if(typeof compatibilityRange!=='string'||compatibilityRange.trim()==='')throw Error('COMPATIBILITY_DECLARATION_MISSING: packages/suite/package.json must carry engines.dsh');
/**
 * The runtimes this generation was actually exercised on, read from the one owned record. The Client uses
 * this list (never a range evaluation of its own) to tell "verified" from "loadable but unverified".
 */
export const verifiedRuntimes=(()=>{
 // The record lives in the package manifest: it travels with every publish, is part of the same file the
 // official loader reads, and cannot drift away from the package it describes.
 const versions=(suite.omnisurge?.verifiedRuntimes??[]).map(entry=>entry?.version).filter(version=>typeof version==='string');
 if(versions.length===0)throw Error('VERIFIED_RUNTIMES_MISSING: packages/suite/package.json omnisurge.verifiedRuntimes must list at least one runtime');
 return versions;
})();
/** The exact runtime the repository's gates actually run against: the installed dev SDK, never a literal. */
export const verifiedRuntime=require('@deepseek-ai/dsh-app-boot/package.json').version;
const semver=require('semver');
/** Official compatibility semantics: prereleases count (dsh-app-boot plugin-compatibility). */
export const satisfies=runtime=>semver.satisfies(runtime,compatibilityRange,{includePrerelease:true});
if(!verifiedRuntimes.includes(verifiedRuntime))throw Error('VERIFIED_RUNTIME_UNRECORDED: the installed dev runtime '+verifiedRuntime+' is not listed in packages/suite/package.json omnisurge.verifiedRuntimes');
