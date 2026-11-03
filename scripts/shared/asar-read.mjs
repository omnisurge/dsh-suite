/**
 * Read-only `.asar` access for the installed application.
 *
 * The official runtime ships **built JS only** (no `.d.ts`), and this repository deliberately does not vendor
 * it, so contract discovery means reading files out of the installed archive in place. Two gates and the
 * contract snapshot need exactly that, and a copy of this reader living in `/tmp` was a single point of
 * failure: it disappears with the temp directory and then "the seam" has to be found again by hand.
 *
 * An asar is a pickled header followed by file slices at fixed offsets. Nothing here writes.
 */
import {readFileSync} from 'node:fs';

export function openAsar(path){
  const bytes=readFileSync(path);
  const jsonSize=bytes.readUInt32LE(12);
  const header=JSON.parse(bytes.subarray(16,16+jsonSize).toString('utf8'));
  // File data starts after the header, padded to the next 4-byte boundary.
  const base=16+jsonSize+((4-(16+jsonSize)%4)%4);
  const read=file=>{
    let node=header;
    for(const part of file.split('/').filter(Boolean))node=node?.files?.[part];
    if(!node||node.files)return null;
    const start=base+Number(node.offset??0);
    return bytes.subarray(start,start+Number(node.size)).toString('utf8');
  };
  /** Every file path below one directory of the archive, sorted. */
  const list=(directory)=>{
    const out=[];
    const walk=(node,prefix)=>{for(const [name,entry] of Object.entries(node?.files??{})){if(entry.files)walk(entry,prefix+name+'/');else out.push(prefix+name);}};
    let node=header;
    for(const part of directory.split('/').filter(Boolean))node=node?.files?.[part];
    walk(node,'');
    return out.sort();
  };
  return {header,read,list};
}

/** The official packages inside the installed app, keyed by package name. */
export function officialPackages(path){
  const {read,list}=openAsar(path);
  const names=(list('dsh/node_modules/@deepseek-ai')??[]).map(file=>file.split('/')[0]);
  return [...new Set(names)].sort().map(name=>{
    let manifest={};
    try{manifest=JSON.parse(read(`dsh/node_modules/@deepseek-ai/${name}/package.json`));}catch{manifest={};}
    return {name:`@deepseek-ai/${name}`,version:manifest.version??null,description:manifest.description??null};
  });
}
