import assert from 'node:assert/strict';
export function candidateOsNetworkProfile(ports) {
  assert.ok(Array.isArray(ports)&&ports.length>0,'CANDIDATE_SANDBOX_PORTS_REQUIRED');
  for(const p of ports) assert.ok(Number.isInteger(p)&&p>0&&p<65536,'CANDIDATE_SANDBOX_PORT_INVALID');
  return '(version 1)(allow default)(deny network-outbound)' + [...new Set(ports)].map(p=>'(allow network-outbound (remote tcp "localhost:'+p+'"))').join('');
}
/** Explicit test-only navigation boundary; server membership comes from the owned Host, never the page. */
export function candidateRequestAllowed(raw, ownedPorts) {
  let url; try { url = new URL(raw); } catch { return false; }
  if (url.protocol === 'data:' || url.protocol === 'blob:' || url.protocol === 'about:') return true;
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) || url.hostname !== '127.0.0.1' || url.username || url.password) return false;
  const port = Number(url.port || (url.protocol === 'https:' || url.protocol === 'wss:' ? 443 : 80));
  return ownedPorts.has(port);
}
export function candidateSandboxCommand(executable, args, ports, platform=process.platform) {
  assert.equal(platform, 'darwin', 'CANDIDATE_OFFLINE_OS_SANDBOX_UNSUPPORTED');
  assert.equal(executable.startsWith('/'), true, 'CANDIDATE_EXECUTABLE_MUST_BE_ABSOLUTE');
  return {executable:'/usr/bin/sandbox-exec', args:['-p',candidateOsNetworkProfile(ports),executable,...args]};
}
/** Called before creating any test page. Chromium's background networking is separately OS-denied. */
export async function installCandidateBrowserBoundary(context, refreshPorts, evidence, sealedPorts) {
  const fixed=[...(sealedPorts??[])].sort((a,b)=>a-b);
  assert.ok(fixed.length,'CANDIDATE_SEALED_PORTS_REQUIRED');
  const ownedPorts=new Set(fixed);
  const refresh=async()=>{const state=await refreshPorts();assert.deepEqual(state.declaredPorts,fixed,'CANDIDATE_HOST_DECLARED_PORTS_MISMATCH');return state;};
  const initial=await refresh();
  await context.route('**/*',async route=>{
    const url=route.request().url();
    if (!candidateRequestAllowed(url,ownedPorts)) await refresh();
    if (candidateRequestAllowed(url,ownedPorts)) return route.continue();
    evidence.push({stage:'owned-browser-request-blocked',scheme:(()=>{try{return new URL(url).protocol;}catch{return'invalid';}})()});
    return route.abort('blockedbyclient');
  });
  if (typeof context.routeWebSocket!=='function') throw Error('CANDIDATE_WEBSOCKET_BOUNDARY_UNAVAILABLE');
  await context.routeWebSocket('**/*',async socket=>{
    const url=socket.url(); if (!candidateRequestAllowed(url,ownedPorts)) await refresh();
    if (candidateRequestAllowed(url,ownedPorts)) socket.connectToServer();
    else {evidence.push({stage:'owned-browser-websocket-blocked'});socket.close({code:1008,reason:'owned test connections only'});}
  });
  evidence.push({stage:'owned-browser-network-boundary',ownedPorts:fixed,staticPorts:fixed,parentRunnerOsSandbox:false,osSandbox:'deny outbound except explicit same-host TCP ports; all child processes',http:'only owned Host ports',websocket:'only owned Host ports',serviceWorkers:'blocked',localDependencySeed:initial.localDependencySeedProof?{name:initial.localDependencySeedProof.name,version:initial.localDependencySeedProof.version,sourceSha256:initial.localDependencySeedProof.sourceSha256,copySha256:initial.localDependencySeedProof.copySha256,files:initial.localDependencySeedProof.files?.length,matched:initial.localDependencySeedProof.matched}:null});
  return {ownedPorts,refresh};
}
