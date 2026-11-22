/**
 * MCP OAuth loopback/paste control-plane client helpers (ADR-033/034/052).
 * Extracted from tools/client.js per ADR-117 D4.
 */
import {RemoteTimeoutError,fetchWithTimeout,withTimeout} from '../remote-timeout.js';
import {failure} from './client-format.js';

export const mcpOauthPath=(serverName,action)=>'/mcp-oauth-client/'+encodeURIComponent(serverName)+'/'+action;

/** ADR-052 D3: read-only status poll cadence while the Host waits in the background. */
export const MCP_OAUTH_POLL_MS=1500;

/** The wait budget the page enforces on itself. */
export const MCP_OAUTH_WAIT_DEFAULT_MS=300_000;
export const MCP_OAUTH_WAIT_CEILING_MS=600_000;
export const mcpOauthWaitBudgetMs=server=>{
  const configured=server&&typeof server.authorizationTimeoutMs==='number'&&Number.isFinite(server.authorizationTimeoutMs)&&server.authorizationTimeoutMs>0?server.authorizationTimeoutMs:MCP_OAUTH_WAIT_DEFAULT_MS;
  return Math.min(configured,MCP_OAUTH_WAIT_CEILING_MS)+MCP_OAUTH_POLL_MS;
};

/** The pasted authorization code is a credential and must never reach any rendered raw block. */
export const mcpRedactCode=(raw,code)=>{
  const text=String(raw);
  const secret=String(code).trim();
  return secret.length===0?text:text.split(secret).join('<code>');
};

/** Every control-plane request is bounded for both fetch and body read. */
export const MCP_OAUTH_REQUEST_TIMEOUT_MS=15000;

/** One control-plane call (POST with JSON body or GET status poll). */
export const mcpOauthCall=async(serverName,action,{method='POST',body=null,timeoutMs=MCP_OAUTH_REQUEST_TIMEOUT_MS,signal}={})=>{
  try{
    const response=method==='GET'
      ?await fetchWithTimeout(fetch,mcpOauthPath(serverName,action),{method:'GET'},timeoutMs,{code:'OAUTH_CONTROL_TIMEOUT',message:'OAUTH_CONTROL '+action+' timed out',signal})
      :await fetchWithTimeout(fetch,mcpOauthPath(serverName,action),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body??{})},timeoutMs,{code:'OAUTH_CONTROL_TIMEOUT',message:'OAUTH_CONTROL '+action+' timed out',signal});
    const text=await withTimeout(response.text(),timeoutMs,{code:'OAUTH_CONTROL_TIMEOUT',message:'OAUTH_CONTROL '+action+' body timed out',signal});
    let value=null;
    try{value=text.length>0?JSON.parse(text):null;}catch{value=null;}
    if(!response.ok){
      const detail=value!==null&&typeof value==='object'&&typeof value.error==='string'?value.error:text;
      throw failure('refused','OAUTH_CONTROL '+action+' '+String(response.status)+' → '+detail);
    }
    return value;
  }catch(failed){
    if(failed instanceof RemoteTimeoutError)throw failure('timeout','OAUTH_CONTROL '+action+' '+failed.code,'OAUTH_CONTROL_TIMEOUT');
    throw failed;
  }
};

export const mcpOauthPost=(serverName,action,body,options={})=>mcpOauthCall(serverName,action,{...options,method:'POST',body});
export const mcpOauthStatus=(serverName,options={})=>mcpOauthCall(serverName,'status',{...options,method:'GET'});

const MCP_OAUTH_PREFS=new Set(['loopback','paste']);
export const mcpAuthorizationOf=view=>{
  if(view===null||typeof view!=='object')return {state:'idle',authorizationUrl:null,prefer:null,startedAt:null};
  const nested=view.authorization!==null&&typeof view.authorization==='object'?view.authorization:null;
  const readUrl=value=>typeof value==='string'&&value.length>0?value:null;
  const readPrefer=value=>MCP_OAUTH_PREFS.has(value)?value:null;
  if(nested!==null){
    return {
      state:nested.state==='waiting'?'waiting':'idle',
      authorizationUrl:readUrl(nested.authorizationUrl)??readUrl(view.authorizationUrl),
      prefer:readPrefer(nested.prefer)??readPrefer(view.prefer),
      startedAt:typeof nested.startedAt==='string'&&nested.startedAt.length>0?nested.startedAt:(typeof nested.startedAt==='number'&&Number.isFinite(nested.startedAt)?nested.startedAt:null),
    };
  }
  return {state:'idle',authorizationUrl:readUrl(view.authorizationUrl),prefer:readPrefer(view.prefer),startedAt:null};
};

export const mcpOauthStatusOf=view=>{
  const status=view!==null&&typeof view==='object'?view.status:null;
  return status==='connected'||status==='needs_login'||status==='idle'||status==='error'?status:'error';
};
