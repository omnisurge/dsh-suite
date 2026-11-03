import type {OcrChannel,OcrLine,OcrPolygonPoint} from './ocr-types.js';

/** One visual line as several channels read it. Nothing here is a decided text: the page shows the
 * candidates and the disagreements, and a human decides (ADR-036 D3). */
export interface ReconciledLine{
 page:number;
 channels:{channel:OcrChannel;text:string;confidence:number;polygon:OcrPolygonPoint[]}[];
 agreement:boolean;
 similarity:number;
 disagreements:{a:string;b:string}[];
 confirmed:string|null;
}

const center=(polygon:OcrPolygonPoint[]):{x:number;y:number}|null=>{
 if(polygon.length===0)return null;
 const xs=polygon.map(point=>point.x),ys=polygon.map(point=>point.y);
 return {x:(Math.min(...xs)+Math.max(...xs))/2,y:(Math.min(...ys)+Math.max(...ys))/2};
};

/** Longest-common-subsequence diff, character level: how the two readings differ, not which one is right. */
export function diffTexts(a:string,b:string):{a:string;b:string}[]{
 const left=[...a],right=[...b];
 const table:number[][]=Array.from({length:left.length+1},()=>new Array<number>(right.length+1).fill(0));
 for(let i=left.length-1;i>=0;i-=1)for(let j=right.length-1;j>=0;j-=1){
  table[i][j]=left[i]===right[j]?table[i+1][j+1]+1:Math.max(table[i+1][j],table[i][j+1]);
 }
 const hunks:{a:string;b:string}[]=[];
 let pendingA='',pendingB='';
 const flush=()=>{if(pendingA.length>0||pendingB.length>0){hunks.push({a:pendingA,b:pendingB});pendingA='';pendingB='';}};
 let i=0,j=0;
 while(i<left.length&&j<right.length){
  if(left[i]===right[j]){flush();i+=1;j+=1;continue;}
  if(table[i+1][j]>=table[i][j+1]){pendingA+=left[i];i+=1;}else{pendingB+=right[j];j+=1;}
 }
 while(i<left.length){pendingA+=left[i];i+=1;}
 while(j<right.length){pendingB+=right[j];j+=1;}
 flush();
 return hunks;
}

export function similarityOf(a:string,b:string):number{
 const longest=Math.max([...a].length,[...b].length);
 if(longest===0)return 1;
 const differing=diffTexts(a,b).reduce((sum,hunk)=>sum+Math.max([...hunk.a].length,[...hunk.b].length),0);
 return Number((1-differing/longest).toFixed(3));
}

const band=(polygon:OcrPolygonPoint[]):{x0:number;y0:number;x1:number;y1:number}|null=>{
 if(polygon.length===0)return null;
 const xs=polygon.map(point=>point.x),ys=polygon.map(point=>point.y);
 return {x0:Math.min(...xs),y0:Math.min(...ys),x1:Math.max(...xs),y1:Math.max(...ys)};
};

/** Two channels do not always share a coordinate origin or a line segmentation. A pair is only accepted
 * when the bands actually sit on the same visual line (same row, overlapping columns); a wrong pair would
 * present two unrelated sentences as "the same line read twice", which is worse than no pairing at all. */
function pairUp(left:OcrLine[],right:OcrLine[]):{left:OcrLine|null;right:OcrLine|null}[]{
 const heights=[...left,...right].map(line=>{const box=band(line.polygon);return box===null?null:box.y1-box.y0;}).filter((height):height is number=>height!==null&&height>0);
 const median=heights.length===0?24:[...heights].sort((a,b)=>a-b)[Math.floor(heights.length/2)]!;
 const maxRowDistance=Math.max(8,median*1.2);
 const pairs:{left:OcrLine|null;right:OcrLine|null}[]=[];
 const used=new Set<number>();
 for(const line of left){
  const anchor=band(line.polygon);
  let best=-1,bestDistance=Number.POSITIVE_INFINITY;
  right.forEach((candidate,index)=>{
   if(used.has(index))return;
   const other=band(candidate.polygon);
   if(anchor===null||other===null)return;
   const rowDistance=Math.abs((anchor.y0+anchor.y1)/2-(other.y0+other.y1)/2);
   const overlap=Math.min(anchor.x1,other.x1)-Math.max(anchor.x0,other.x0);
   if(rowDistance>maxRowDistance||overlap<=0)return;
   if(rowDistance<bestDistance){bestDistance=rowDistance;best=index;}
  });
  if(best>=0){used.add(best);pairs.push({left:line,right:right[best]!});}
  else pairs.push({left:line,right:null});
 }
 right.forEach((line,index)=>{if(!used.has(index))pairs.push({left:null,right:line});});
 return pairs;
}

/** Aligns the channels line by line. A channel that returned no lines is not "agreement": a pair whose
 * texts match but whose channels are the same reading must still be reported as one channel only. */
export function reconcileLines(page:number,channels:{channel:OcrChannel;lines:OcrLine[]}[]):ReconciledLine[]{
 const [first,second]=channels;
 if(first===undefined)return [];
 if(second===undefined){
  return first.lines.map(line=>({page,channels:[{channel:first.channel,text:line.text,confidence:line.confidence,polygon:line.polygon}],agreement:false,similarity:1,disagreements:[],confirmed:null}));
 }
 const pairs=pairUp(first.lines,second.lines);
 return pairs.map(pair=>{
  const texts=[pair.left?.text,pair.right?.text].filter((text):text is string=>typeof text==='string');
  const same=texts.length===2&&texts[0]===texts[1];
  const rank={confirmed:null as string|null};
  const channels:{channel:OcrChannel;text:string;confidence:number;polygon:OcrPolygonPoint[]}[]=[];
  if(pair.left!==null)channels.push({channel:first.channel,text:pair.left.text,confidence:pair.left.confidence,polygon:pair.left.polygon});
  if(pair.right!==null)channels.push({channel:second.channel,text:pair.right.text,confidence:pair.right.confidence,polygon:pair.right.polygon});
  return {
   page,
   channels,
   agreement:same,
   similarity:pair.left!==null&&pair.right!==null?similarityOf(pair.left.text,pair.right.text):0,
   disagreements:pair.left!==null&&pair.right!==null&&!same?diffTexts(pair.left.text,pair.right.text):[],
   confirmed:rank.confirmed,
  };
 });
}
/** Provider polygons are in the pixels of the raster that was sent (the rasterizer's DPI). Cropping a page
 * needs PDF points, so the conversion lives here, next to the polygons, instead of in every caller: a caller
 * that forgot it cropped a blank region and the supplier answered ImageNoText. */
export function polygonToPoints(polygon:OcrPolygonPoint[],dpi:number):{x0:number;y0:number;x1:number;y1:number}{
 const box=band(polygon);
 if(box===null)return {x0:0,y0:0,x1:0,y1:0};
 const scale=72/dpi;
 return {x0:box.x0*scale,y0:box.y0*scale,x1:box.x1*scale,y1:box.y1*scale};
}
