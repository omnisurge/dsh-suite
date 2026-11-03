/** The official DSH home, resolved once for every Host feature that must read or write under it.
 *
 * Precedence is the official `resolveDshHome` (0.2.1-rc.3): an explicit path wins, then a non-blank
 * `DSH_HOME`, then `~/.dsh`; a blank env value counts as unset. This exists as one function because two
 * callers (the skills roots and the fetched-release root) must agree — a second copy that drifts is how
 * the GitHub channel silently stopped finding its directory while every gate stayed green (review
 * 0.2.2-1 F1: the shipped desktop Host runs with `HOME` only, no `DSH_HOME`).
 *
 * Verified against the installed runtime; Windows drive-letter/UNC traversal uses the same rule with
 * path semantics and was not run on Windows. */
import {homedir} from 'node:os';
import {join,resolve} from 'node:path';

export function expandHome(path:string):string {
 if(path==='~')return homedir();
 if(path.startsWith('~/')||path.startsWith('~\\'))return join(homedir(),path.slice(2));
 return path;
}

export function resolveDshHome(configured?:string,env:NodeJS.ProcessEnv=process.env):string {
 const fromEnv=env.DSH_HOME;
 const selected=configured??(fromEnv!==undefined&&fromEnv.trim().length>0?fromEnv:join(homedir(),'.dsh'));
 return resolve(expandHome(selected));
}
