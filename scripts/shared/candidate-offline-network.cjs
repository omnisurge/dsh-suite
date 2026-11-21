'use strict';
/** Owned-test defense in depth. External OS sandbox is the cross-process boundary.
 * Loaded before SDK imports; no production HOME/config or network discovery. */
const {syncBuiltinESMExports}=require('node:module');
const {isAbsolute}=require('node:path');
const POLICY='OMNISURGE_CANDIDATE_OFFLINE_POLICY';
let installed;
function fail(kind,target){throw Object.assign(new Error('CANDIDATE_OFFLINE_NETWORK_DENIED: '+kind+' '+target),{code:'CANDIDATE_OFFLINE_NETWORK_DENIED'});}
function validatePolicy(policy){
 if(!policy||typeof policy.storeDir!=='string'||!isAbsolute(policy.storeDir)||!Array.isArray(policy.ownedPorts)||!policy.ownedPorts.length||policy.ownedPorts.some(p=>!Number.isInteger(p)||p<1||p>65535))throw Error('CANDIDATE_OFFLINE_POLICY_INVALID');
 return Object.freeze({storeDir:policy.storeDir,ownedPorts:Object.freeze([...new Set(policy.ownedPorts)].sort((a,b)=>a-b))});
}
function install(policy){
 policy=validatePolicy(policy);
 if(installed){if(JSON.stringify(installed.policy)!==JSON.stringify(policy))throw Error('CANDIDATE_OFFLINE_POLICY_CHANGED');return state();}
 const declaredPorts=new Set(policy.ownedPorts), activePorts=new Set(policy.ownedPorts), generations=new WeakMap(), refs=new Map();
 const allow=(host,port,kind)=>{if(host!=='127.0.0.1'||!activePorts.has(Number(port)))fail(kind,host+':'+port);};
 installed={policy,activePorts,refs};
 const url=value=>{const u=value instanceof URL?value:new URL(typeof value==='string'?value:value.url);allow(u.hostname,u.port||(u.protocol==='https:'?'443':'80'),'url');return u;};
 const net=require('node:net'),tls=require('node:tls'),dns=require('node:dns'),http2=require('node:http2'),dgram=require('node:dgram');
 const listen=net.Server.prototype.listen;
 net.Server.prototype.listen=function(...args){
  // One token per listen attempt; failed attempts never grant a port. Token comparison
  // prevents stale callbacks from retiring a later generation of the same Server.
  if(this.listening)return Reflect.apply(listen,this,args);
  const old=generations.get(this);old?.retire?.();
  const token={port:null};token.retire=()=>{if(token.port===null)return;const p=token.port;token.port=null;const n=(refs.get(p)??1)-1;if(n)refs.set(p,n);else {refs.delete(p);if(!declaredPorts.has(p))activePorts.delete(p);}};generations.set(this,token);
  const onError=()=>{this.removeListener('listening',onListen);};
  const onListen=()=>{this.removeListener('error',onError);if(generations.get(this)!==token)return;const a=this.address();if(a&&typeof a==='object'&&a.address==='127.0.0.1'){token.port=a.port;refs.set(a.port,(refs.get(a.port)??0)+1);activePorts.add(a.port);this.once('close',()=>{if(generations.get(this)!==token||token.port===null)return;generations.delete(this);token.retire();});}};
  this.once('listening',onListen);this.once('error',onError);try{return Reflect.apply(listen,this,args);}catch(error){onError();this.removeListener('error',onError);throw error;}
 };
 const connect=net.Socket.prototype.connect;
 net.Socket.prototype.connect=function(...args){const a=Array.isArray(args[0])?args[0]:args;const o=a[0];if(typeof o==='object'&&o!==null){if(o.path)fail('unix-socket',o.path);allow(o.host??'localhost',o.port,'socket');}else if(typeof o==='number')allow(typeof a[1]==='string'?a[1]:'localhost',o,'socket');else fail('socket',String(o));return Reflect.apply(connect,this,args);};
 const tlsConnect=tls.connect;tls.connect=function(...args){const o=args[0];if(typeof o==='object'){if(o.socket)fail('tls-preconnected','unattested socket');allow(o.host??'localhost',o.port,'tls');}else allow(typeof args[1]==='string'?args[1]:'localhost',o,'tls');return Reflect.apply(tlsConnect,this,args);};
 for(const key of ['lookup','resolve','resolve4','resolve6','resolveAny','resolveCname','resolveMx','resolveNaptr','resolveNs','resolvePtr','resolveSoa','resolveSrv','resolveTxt','reverse'])if(typeof dns[key]==='function'){const original=dns[key];dns[key]=function(host,...args){if(key==='lookup'&&host==='127.0.0.1')return Reflect.apply(original,this,[host,...args]);fail('dns',String(host));};}
 for(const key of Object.keys(dns.promises))if(/^(lookup|resolve|reverse)/.test(key)&&typeof dns.promises[key]==='function'){const original=dns.promises[key];dns.promises[key]=async function(host,...args){if(key==='lookup'&&host==='127.0.0.1')return Reflect.apply(original,this,[host,...args]);fail('dns',String(host));};}
 for(const moduleName of ['node:http','node:https']){const http=require(moduleName);for(const method of ['request','get']){const original=http[method];http[method]=function(input,...args){if(typeof input==='string'||input instanceof URL)url(input);else {const host=input?.hostname??input?.host??'localhost';allow(host,input?.port??(moduleName==='node:https'?443:80),'http');}return Reflect.apply(original,this,[input,...args]);};}}
 for(const Resolver of [dns.Resolver,dns.promises.Resolver])if(Resolver)for(const key of Object.getOwnPropertyNames(Resolver.prototype))if(/^(resolve|reverse)/.test(key))Resolver.prototype[key]=function(host){fail('dns-resolver',String(host));};
 const h2connect=http2.connect;http2.connect=function(authority,...args){url(authority);return Reflect.apply(h2connect,this,[authority,...args]);};
 const makeSocket=dgram.createSocket;dgram.createSocket=function(...args){const socket=Reflect.apply(makeSocket,this,args);socket.send=function(){fail('udp','disabled');};socket.connect=function(){fail('udp','disabled');};return socket;};
 if(typeof globalThis.fetch==='function'){const fetch=globalThis.fetch;globalThis.fetch=function(input,...args){url(input);return Reflect.apply(fetch,this,[input,...args]);};}
 // Every Node installer child gets this same exact-port preload. Native children
 // are contained by the runner's required external OS network sandbox instead.
 process.env[POLICY]=JSON.stringify(policy);
 process.env.NODE_OPTIONS='--require '+JSON.stringify(__filename);
 const packageEnvironment={npm_config_offline:'true',npm_config_ignore_scripts:'true',npm_config_registry:'http://127.0.0.1:1/',pnpm_config_offline:'true',PNPM_CONFIG_OFFLINE:'true',pnpm_config_ignore_scripts:'true',PNPM_CONFIG_IGNORE_SCRIPTS:'true',pnpm_config_store_dir:policy.storeDir,PNPM_CONFIG_STORE_DIR:policy.storeDir};
 Object.assign(process.env,packageEnvironment);
 const cp=require('node:child_process');
 const childEnv=env=>({...env,[POLICY]:JSON.stringify({storeDir:policy.storeDir,ownedPorts:[...activePorts]}),NODE_OPTIONS:'--require '+JSON.stringify(__filename),...packageEnvironment});
 for(const key of ['spawn','spawnSync','execFile','execFileSync']){const original=cp[key];cp[key]=function(command,args,options,...rest){if(!Array.isArray(args)){if(typeof options==='function')rest.unshift(options);options=args;args=[];}if(typeof options==='function')return Reflect.apply(original,this,[command,args,{env:childEnv(process.env)},options,...rest]);return Reflect.apply(original,this,[command,args,{...options,env:childEnv(options?.env??process.env)},...rest]);};}
 const fork=cp.fork;cp.fork=function(modulePath,args,options){if(!Array.isArray(args)){options=args;args=[];}return Reflect.apply(fork,this,[modulePath,args,{...options,env:childEnv(options?.env??process.env)}]);};
 syncBuiltinESMExports();return state();
}
function state(){return {active:!!installed,host:'127.0.0.1',ownedPorts:installed?[...installed.activePorts].sort((a,b)=>a-b):[],declaredPorts:installed?[...installed.policy.ownedPorts]:[],ownListenerPorts:installed?[...installed.refs.keys()].sort((a,b)=>a-b):[],activePorts:installed?[...installed.activePorts].sort((a,b)=>a-b):[],preload:__filename,registry:'http://127.0.0.1:1/',installationOffline:true,storeDir:installed?.policy.storeDir??null,crossProcessBoundary:'external-os-sandbox-required'};}
module.exports={install,state,validatePolicy};
if(process.env[POLICY])install(JSON.parse(process.env[POLICY]));
