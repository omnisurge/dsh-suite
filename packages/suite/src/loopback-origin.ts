/** Whether an origin belongs to this machine (ADR-033 D2).
 *
 * This is the one predicate for "is that URL a loopback this process may talk to": the Host manager uses it
 * before asking a client's control plane, and the carried MCP client modules use it for the login gateway
 * origin the host web server reports. Pure (URL only, no node builtins) so both layers may import it.
 */
export function loopbackOrigin(origin:string|null):string|null{
 if(origin===null||origin.length===0)return null;
 try{
  const url=new URL(origin);
  const host=url.hostname.toLowerCase();
  return host==='127.0.0.1'||host==='[::1]'||host==='::1'||host==='localhost'?origin:null;
 }catch{
  return null;
 }
}
