import {realpath} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildTarget} from '../shared/build-target-core.mjs';
/** Fixed build entry. The loaded Suite manager spawns this file by path on every click and
 * never imports a cached build module; the entry therefore always runs its current disk bytes.
 * It accepts only one owned target (the repository containing this script) and one owned state
 * directory; no caller-supplied command, script or output path is accepted. */
const repository=await realpath(fileURLToPath(new URL('../../', import.meta.url)));
const args=process.argv.slice(2);
const controller=new AbortController();
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>controller.abort(Error('BUILD_ABORTED: build entry received '+signal)));
try{
 // Either no arguments (the repository owns this entry) or exactly the two fixed options.
 if(args.length&&(args.length!==4||args[0]!=='--root'||args[2]!=='--state'))throw Error('UNSUPPORTED_TARGET: the fixed build entry accepts exactly --root <root> --state <state>');
 const root=await realpath(resolve(args.length?args[1]:repository));
 if(root!==repository)throw Error('UNSUPPORTED_TARGET: the fixed build entry only builds its own repository');
 const receipt=await buildTarget(root,resolve(args.length?args[3]:join(repository,'.scratch','repo-build')),controller.signal);
 process.stdout.write('OMNISURGE_BUILD_RECEIPT '+JSON.stringify(receipt)+'\n');
}catch(error){
 // This protocol is line-framed: keep primary and cleanup/recovery diagnostics in
 // the same error frame rather than letting the manager parse only the first line.
 const message=String(error&&error.message?error.message:error).replaceAll('\r','').replaceAll('\n',' | ');
 process.stderr.write('OMNISURGE_BUILD_ERROR '+message+'\n');
 process.exitCode=1;
}
