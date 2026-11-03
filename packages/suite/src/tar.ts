import {gunzipSync} from 'node:zlib';

export interface TarEntry {name:string;type:'file'|'directory'|'link'|'other';size:number;bytes:Uint8Array;}
const BLOCK=512,MAX_ENTRIES=4096,MAX_TOTAL_BYTES=64*1024*1024;

const text=(buffer:Uint8Array,start:number,length:number):string=>{
 const slice=buffer.subarray(start,start+length);let end=slice.indexOf(0);
 if(end<0)end=slice.length;
 return Buffer.from(slice.subarray(0,end)).toString('utf8').replace(/\0.*$/,'');
};
const octal=(buffer:Uint8Array,start:number,length:number):number=>{
 const slice=buffer.subarray(start,start+length);
 if(slice.length>0&&(slice[0]&0x80)!==0){let value=0;for(const byte of slice.subarray(1))value=value*256+(byte&0xff);return value;}
 const raw=text(buffer,start,length).trim();
 if(raw==='')return 0;
 if(!/^[0-7]+$/.test(raw))throw Error('TAR_HEADER_INVALID: non-octal numeric field');
 return Number.parseInt(raw,8);
};
/** Read one npm-produced gzipped tar into memory. This is deliberately a strict, bounded reader for
 * the Suite's own fixed archives: unknown numeric encodings, a broken checksum, an oversized payload
 * or a truncated archive are refused instead of guessed. */
export function readTarGz(archive:Uint8Array):TarEntry[]{
 const buffer=gunzipSync(archive),entries:TarEntry[]=[];
 if(buffer.length%BLOCK!==0&&buffer.length>0)throw Error('TAR_LENGTH_INVALID');
 let offset=0,total=0,pending:{path:string|null;size:number|null}={path:null,size:null};
 while(offset+BLOCK<=buffer.length){
  const header=buffer.subarray(offset,offset+BLOCK);offset+=BLOCK;
  if(header.every(byte=>byte===0))break;
  const stored=octal(header,148,8);
  let sum=0;for(let index=0;index<BLOCK;index+=1)sum+=index>=148&&index<156?0x20:header[index];
  if(sum!==stored)throw Error('TAR_CHECKSUM_INVALID');
  const magic=text(header,257,8);
  const base=magic.startsWith('ustar')?text(header,345,155):'';
  const name=pending.path??(base?base+'/':'')+text(header,0,100);
  const size=pending.size??octal(header,124,12);
  pending={path:null,size:null};
  const type=header[156]===0?'0':String.fromCharCode(header[156]);
  if(type==='x'||type==='g'){
   const payload=buffer.subarray(offset,offset+size);offset+=Math.ceil(size/BLOCK)*BLOCK;
   let cursor=0;
   while(cursor<payload.length){
    let space=payload.indexOf(0x20,cursor);if(space<0)break;
    const length=Number.parseInt(Buffer.from(payload.subarray(cursor,space)).toString('utf8'),10);
    if(!Number.isSafeInteger(length)||length<=0||cursor+length>payload.length)throw Error('TAR_PAX_INVALID');
    const record=Buffer.from(payload.subarray(space+1,cursor+length-1)).toString('utf8');
    const separator=record.indexOf('=');
    if(separator>0){const key=record.slice(0,separator),value=record.slice(separator+1);if(key==='path')pending.path=value;if(key==='size')pending.size=Number.parseInt(value,10);}
    cursor+=length;
   }
   continue;
  }
  if(size<0||size>MAX_TOTAL_BYTES)throw Error('TAR_SIZE_INVALID');
  total+=size;if(total>MAX_TOTAL_BYTES)throw Error('TAR_PAYLOAD_TOO_LARGE');
  if(offset+Math.ceil(size/BLOCK)*BLOCK>buffer.length)throw Error('TAR_TRUNCATED');
  if(entries.length>=MAX_ENTRIES)throw Error('TAR_ENTRY_LIMIT');
  if(type==='0')entries.push({name,type:'file',size,bytes:buffer.subarray(offset,offset+size)});
  else if(type==='5')entries.push({name,type:'directory',size:0,bytes:new Uint8Array()});
  else if(type==='1'||type==='2')entries.push({name,type:'link',size:0,bytes:new Uint8Array()});
  else entries.push({name,type:'other',size,bytes:new Uint8Array()});
  offset+=Math.ceil(size/BLOCK)*BLOCK;
 }
 return entries;
}
