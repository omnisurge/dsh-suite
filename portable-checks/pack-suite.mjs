import {mkdir,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const out=resolve(process.argv[2]??join(root,'.scratch','suite-pack'));
await mkdir(out,{recursive:true});
const declarations=JSON.parse(await readFile(join(root,'packages','suite','components.json'),'utf8'));
const modules=declarations.map(item=>({id:item.id,module:'@omnisurge/dsh-suite'+item.export.slice(1),rowId:item.rowId,display:item.display,runtime:item.runtime??null,...(item.effect?{effect:item.effect}:{})}));
const componentsDir=join(root,'packages','suite','components');
const manifestPath=join(componentsDir,'manifest.json');
await mkdir(componentsDir,{recursive:true});
await writeFile(manifestPath,JSON.stringify({protocol:2,components:modules},null,2)+'\n',{flag:'wx'});
try{
 const pnpm=process.platform==='win32'?'pnpm.cmd':'pnpm';
 execFileSync(pnpm,['--filter','@omnisurge/dsh-suite','pack','--pack-destination',out],{cwd:root,stdio:['ignore','inherit','inherit'],shell:process.platform==='win32'});
 const tarballs=(await readdir(out)).filter(name=>name.endsWith('.tgz')).sort();
 if(!tarballs.length)throw new Error('PACK_TARBALL_MISSING');
 console.log(join(out,tarballs.at(-1)));
}finally{
 await rm(manifestPath,{force:true});
 await rm(componentsDir,{recursive:true,force:true}).catch(()=>{});
}
