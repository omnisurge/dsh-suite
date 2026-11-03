import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { TextDecoder } from 'node:util';
import { once } from 'node:events';
import { callTool, toolDefinitions, InvalidArguments } from './tools.mjs';

const versions=['2025-11-25','2025-06-18','2025-03-26','2024-11-05'];
const error=(id,code,message)=>({jsonrpc:'2.0',id,error:{code,message}});
export function createSession(options={}) {
  let initialized=false;
  return async message=>{
    if(!message||typeof message!=='object'||Array.isArray(message)||message.jsonrpc!=='2.0'||typeof message.method!=='string'||(Object.hasOwn(message,'id')&&typeof message.id!=='string'&&typeof message.id!=='number')) return error(null,-32600,'Invalid Request');
    const notification=!Object.hasOwn(message,'id');
    const {id,method,params={}}=message;
    if(notification) return null;
    if(!params||typeof params!=='object'||Array.isArray(params))return error(id,-32602,'Invalid params');
    if(method==='initialize') {
      const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
      if(typeof params.protocolVersion!=='string'||!params.protocolVersion.trim()||!object(params.clientInfo)||typeof params.clientInfo.name!=='string'||!params.clientInfo.name.trim()||typeof params.clientInfo.version!=='string'||!params.clientInfo.version.trim()||!object(params.capabilities)) return error(id,-32602,'initialize requires protocolVersion, clientInfo {name,version} and capabilities objects');
      initialized=true;
      return {jsonrpc:'2.0',id,result:{protocolVersion:versions.includes(params.protocolVersion)?params.protocolVersion:versions[0],capabilities:{tools:{}},serverInfo:{name:'omnisurge-ui-mcp',version:'0.0.0'},instructions:'Development-only source projection. Compose existing UI primitives or request a gap; never generate a parallel skin.'}};
    }
    if(method==='ping')return {jsonrpc:'2.0',id,result:{}};
    if(!initialized)return error(id,-32002,'Initialize first');
    if(method==='tools/list')return {jsonrpc:'2.0',id,result:{tools:toolDefinitions}};
    if(method!=='tools/call')return error(id,-32601,'Method not found');
    try {
      const data=await callTool(params.name,params.arguments??{},options);
      return {jsonrpc:'2.0',id,result:{content:[{type:'text',text:JSON.stringify(data)}],structuredContent:data,isError:false}};
    } catch(cause) {
      if(cause instanceof InvalidArguments)return error(id,-32602,cause.message);
      // Expected operational errors are tool results, never fake success. No stack or environment dumps.
      return {jsonrpc:'2.0',id,result:{isError:true,content:[{type:'text',text:'UI_TOOL_FAILED: '+(cause.code??cause.message)}]}};
    }
  };
}

export async function serve(input=process.stdin,output=process.stdout,options={}) {
  const dispatch=createSession(options),decoder=new TextDecoder('utf-8',{fatal:true});
  const MAX_FRAME=1048576;
  let pending=Buffer.alloc(0),oversized=false;
  const send=async response=>{if(response&&!output.write(JSON.stringify(response)+'\n'))await once(output,'drain');};
  const line=async frame=>{
    if(frame.length===0)return;
    let value;
    try {value=decoder.decode(frame);}catch {await send(error(null,-32700,'Parse error'));return;}
    if(!value.trim())return;
    let message;
    try {message=JSON.parse(value);}catch {await send(error(null,-32700,'Parse error'));return;}
    await send(await dispatch(message));
  };
  const consume=async chunk=>{
    const bytes=Buffer.isBuffer(chunk)?chunk:Buffer.from(String(chunk));
    pending=Buffer.concat([pending,bytes]);
    for(;;){
      const at=pending.indexOf(10);
      if(at<0)break;
      const frame=pending.subarray(0,at);
      pending=pending.subarray(at+1);
      if(oversized){oversized=false;continue;}
      if(frame.length>MAX_FRAME){await send(error(null,-32600,'Request exceeds 1 MiB'));continue;}
      await line(frame);
    }
    if(pending.length>MAX_FRAME){
      pending=Buffer.alloc(0);
      if(!oversized){oversized=true;await send(error(null,-32600,'Request exceeds 1 MiB'));}
    }
  };
  for await(const chunk of input)await consume(chunk);
  if(pending.length>0&&!oversized)await line(pending);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  serve().catch(error=>{process.stderr.write('ui-mcp transport failure: '+(error.code??error.message)+'\n');process.exitCode=1;});
}
