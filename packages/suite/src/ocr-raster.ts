import {execFile} from 'node:child_process';
import {mkdtemp,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {extname,join} from 'node:path';
import {OcrRefusal} from './ocr-contract.js';

/** One page as the adapters see it: raster bytes and the facts the caller may show. */
export interface RasterPage{bytes:Uint8Array;mediaType:'image/png'|'image/jpeg';page:number;width:number;height:number;}
export interface RasterSource{kind:'image'|'pdf';path:string;pages:number;bytes:number;}

export interface RasterDeps{
 /** Runs one child process and resolves its stdout; rejects on a non-zero exit. */
 run?:(file:string,args:string[])=>Promise<{stdout:string;stderr:string}>;
 tempRoot?:(prefix:string)=>Promise<string>;
 createTemp?:(prefix:string)=>Promise<string>;
 cleanup?:(directory:string)=>Promise<void>;
 maxPages?:number;
 dpi?:number;
}

const IMAGE_TYPES:Record<string, 'image/png'|'image/jpeg'>={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg'};
export const DEFAULT_MAX_PAGES=40;
export const HARD_MAX_PAGES=200;
export const DEFAULT_DPI=300;
const PY_PROBE='import pymupdf;print("ok")';
const PY_COUNT=['-c','import pymupdf,sys;print(pymupdf.open(sys.argv[1]).page_count)'];

function defaultRun(file:string,args:string[]):Promise<{stdout:string;stderr:string}>{
 return new Promise((resolve,reject)=>{
  execFile(file,args,{maxBuffer:4*1024*1024,windowsHide:true},(error,stdout,stderr)=>{
   if(error){reject(Object.assign(error,{stdout:String(stdout),stderr:String(stderr)}));return;}
   resolve({stdout:String(stdout),stderr:String(stderr)});
  });
 });
}

/** A renderer that exits 0 but writes nothing must be a refusal, never an ENOENT leak. */
async function readRendered(path:string):Promise<Uint8Array>{
 try{return new Uint8Array(await readFile(path));}
 catch{throw new OcrRefusal('PDF_UNREADABLE','the rasterizer produced no page image');}
}

async function detect(file:string,deps:RasterDeps):Promise<'pymupdf'|'sips'|null>{
 const run=deps.run??defaultRun;
 try{await run('python3',['-c',PY_PROBE]);return 'pymupdf';}catch{/* keep probing */}
 try{await run('sips',['--version']);return 'sips';}catch{return null;}
}

/** Reads the source's shape without rendering anything: kind, byte size, page count. */
export async function inspectSource(path:string,deps:RasterDeps={}):Promise<RasterSource>{
 const info=await stat(path).catch(()=>{throw new OcrRefusal('PDF_UNREADABLE','the file cannot be read');});
 const extension=extname(path).toLowerCase();
 const mediaType=IMAGE_TYPES[extension];
 if(mediaType!==undefined)return {kind:'image',path,pages:1,bytes:info.size};
 if(extension!=='.pdf')throw new OcrRefusal('PDF_UNREADABLE','only PDF and PNG/JPEG inputs are supported');
 const run=deps.run??defaultRun;
 if(await detect(path,deps)==='pymupdf'){
  const {stdout}=await run('python3',[...PY_COUNT,path]).catch(()=>{throw new OcrRefusal('PDF_UNREADABLE','the PDF could not be opened');});
  const pages=Number.parseInt(stdout.trim(),10);
  if(!Number.isFinite(pages)||pages<1)throw new OcrRefusal('PDF_UNREADABLE','the PDF reports no pages');
  return {kind:'pdf',path,pages,bytes:info.size};
 }
 throw new OcrRefusal('PDF_RASTERIZER_MISSING','no rasterizer on this machine can open a PDF');
}

/** Parses "1-10,12" into 1-based page numbers. A bad spec is its own refusal: guessing would render the
 * wrong pages silently. Bounds are checked against the document, not just the range syntax. */
export function parsePageRange(spec:string,pages:number):number[]{
 const wanted:number[]=[];
 for(const part of spec.split(',').map(value=>value.trim()).filter(value=>value.length>0)){
  const match=/^(\d+)(?:\s*-\s*(\d+))?$/.exec(part);
  if(match===null)throw new OcrRefusal('PDF_PAGE_RANGE_INVALID','"'+part+'" is not a page or a page range');
  const start=Number.parseInt(match[1],10);
  const end=match[2]===undefined?start:Number.parseInt(match[2],10);
  if(end<start)throw new OcrRefusal('PDF_PAGE_RANGE_INVALID','"'+part+'" runs backwards');
  for(let page=start;page<=end;page+=1){
   if(page<1||page>pages)throw new OcrRefusal('PDF_PAGE_OUT_OF_RANGE','page '+page+' is outside 1..'+pages);
   if(!wanted.includes(page))wanted.push(page);
  }
 }
 if(wanted.length===0)throw new OcrRefusal('PDF_PAGE_RANGE_INVALID','the range names no page');
 return wanted.sort((left,right)=>left-right);
}

/** Renders one page. Page numbers are 1-based; the budget is checked before any rendering happens. */
export async function rasterizePage(source:RasterSource,page:number,deps:RasterDeps={}):Promise<RasterPage>{
 const dpi=deps.dpi??DEFAULT_DPI;
 if(!Number.isInteger(page)||page<1||page>source.pages)throw new OcrRefusal('PDF_PAGE_OUT_OF_RANGE','page '+String(page)+' is outside 1..'+source.pages);
 if(source.kind==='image'){
  if(page!==1)throw new OcrRefusal('PDF_PAGE_OUT_OF_RANGE','an image has a single page');
  const mediaType=IMAGE_TYPES[extname(source.path).toLowerCase()];
  return {bytes:new Uint8Array(await readFile(source.path)),mediaType:mediaType??'image/png',page,width:0,height:0};
 }
 const run=deps.run??defaultRun;
 const tool=await detect(source.path,deps);
 if(tool===null)throw new OcrRefusal('PDF_RASTERIZER_MISSING','no rasterizer on this machine can open a PDF');
 if(tool==='sips'&&page!==1)throw new OcrRefusal('PDF_RASTERIZER_MISSING','the available rasterizer only renders the first page; install PyMuPDF or split the PDF');
 const directory=await (deps.createTemp??(async prefix=>mkdtemp(join(tmpdir(),prefix))))('ocr-raster-');
 const target=join(directory,'page-'+page+'.png');
 try{
  if(tool==='pymupdf'){
   const script=['-c','import pymupdf,sys;d=pymupdf.open(sys.argv[1]);p=d[int(sys.argv[2])-1];pix=p.get_pixmap(dpi=int(sys.argv[3]));pix.save(sys.argv[4]);print(pix.width,pix.height)',source.path,String(page),String(dpi),target];
   const {stdout}=await run('python3',script).catch(()=>{throw new OcrRefusal('PDF_UNREADABLE','the page could not be rendered');});
   const [width,height]=stdout.trim().split(/\s+/).map(value=>Number.parseInt(value,10));
   return {bytes:new Uint8Array(await readRendered(target)),mediaType:'image/png',page,width:width||0,height:height||0};
  }
  await run('sips',['-s','format','png','--resampleWidth',String(Math.round(dpi*8.27)),source.path,'--out',target]).catch(()=>{throw new OcrRefusal('PDF_UNREADABLE','the page could not be rendered');});
  return {bytes:new Uint8Array(await readRendered(target)),mediaType:'image/png',page,width:0,height:0};
 }finally{await (deps.cleanup??(async directory=>{await rm(directory,{recursive:true,force:true});}))(directory);}
}
/** A region of one page, rendered for a human or a model to look at. The box is in PDF points
 * (x0,y0,x1,y1); omitting it renders the whole page. Coordinates are clamped to the page, because a
 * caller that guesses a box must not get an empty image and assume the page was blank. */
export async function renderRegion(source:RasterSource,page:number,box?:{x0:number;y0:number;x1:number;y1:number},deps:RasterDeps={}):Promise<{bytes:Uint8Array;mediaType:'image/png'|'image/jpeg';page:number;width:number;height:number}>{
 const dpi=deps.dpi??DEFAULT_DPI;
 if(!Number.isInteger(page)||page<1||page>source.pages)throw new OcrRefusal('PDF_PAGE_OUT_OF_RANGE','page '+String(page)+' is outside 1..'+source.pages);
 if(source.kind==='image'){
  if(page!==1)throw new OcrRefusal('PDF_PAGE_OUT_OF_RANGE','an image has a single page');
  // Returning the whole image while silently ignoring a crop box would be a lie: the caller would look at a
  // full page and believe it saw the crop (review 0.2.2-5 #8).
  if(box!==undefined)throw new OcrRefusal('OCR_CROP_UNSUPPORTED','cropping an image is not supported; pass a PDF page instead');
  return {bytes:new Uint8Array(await readFile(source.path)),mediaType:IMAGE_TYPES[extname(source.path).toLowerCase()]??'image/png',page,width:0,height:0};
 }
 const run=deps.run??defaultRun;
 const directory=await (deps.createTemp??(async prefix=>mkdtemp(join(tmpdir(),prefix))))('ocr-render-');
 const target=join(directory,'page-'+page+'.png');
 try{
  const clip=box===undefined?['0','0','0','0']:[String(box.x0),String(box.y0),String(box.x1),String(box.y1)];
  const script=['-c','import pymupdf,sys;d=pymupdf.open(sys.argv[1]);p=d[int(sys.argv[2])-1];b=[float(v) for v in sys.argv[3:7]];r=pymupdf.Rect(*b) if b[2]>b[0] and b[3]>b[1] else None;pix=p.get_pixmap(clip=r,dpi=int(sys.argv[7]));pix.save(sys.argv[8]);print(pix.width,pix.height)',source.path,String(page),...clip,String(dpi),target];
  const {stdout}=await run('python3',script).catch(()=>{throw new OcrRefusal('PDF_UNREADABLE','the page could not be rendered');});
  const [width,height]=stdout.trim().split(/\s+/).map(value=>Number.parseInt(value,10));
  return {bytes:new Uint8Array(await readRendered(target)),mediaType:'image/png',page,width:width||0,height:height||0};
 }finally{await (deps.cleanup??(async directory=>{await rm(directory,{recursive:true,force:true});}))(directory);}
}