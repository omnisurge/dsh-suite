/** Official credentials + Settings are separate authorities; never pretend an atomic transaction. */
export function requiresHttpConsent(value,authMode){
 if(authMode!=='basic'||!value.baseUrl)return false;
 try{const url=new URL(value.baseUrl);return url.protocol==='http:'&&!['localhost','127.0.0.1','[::1]'].includes(url.hostname);}catch{return false;}
}
export async function saveConnection(request,ports){
 let credentialStored=false,reference;
 const answer=code=>({code,committed:code==='SAVED',credentialStored,...(reference?{reference}:{})});
 const active=()=>!request.signal.aborted;
 const current=()=>ports.snapshot();
 const ready=s=>s.status==='ready'&&s.writable&&s.revision!==undefined;
 const fresh=()=>current().revision===request.expectedRevision;
 const value={...request.value};const fields=new Set(request.changed);
 try{
  if(!active())return answer('CANCELLED');
  if(!ready(current()))return answer('UNAVAILABLE');
  if(!fresh())return answer('STALE');
  if(!['none','basic'].includes(request.authMode))return answer('INVALID');
  if(request.authMode==='none'){if(value.basicAuthEnv){value.basicAuthEnv='';fields.add('basicAuthEnv');}}
  const replacing=request.authMode==='basic'&&(request.username!==''||request.password!=='');
  if(replacing){
   if(!request.username||!request.password||request.username.includes(':')||/[\r\n]/.test(request.username))return answer('BASIC_INVALID');
   reference=ports.newRef();if(reference===request.value.basicAuthEnv||reference===current().value?.basicAuthEnv)return answer('CREDENTIAL_REFERENCE_COLLISION');value.basicAuthEnv=reference;fields.add('basicAuthEnv');
  }else if(request.authMode==='basic'&&!value.basicAuthEnv)return answer('BASIC_REQUIRED');
  if(!ports.validate(value))return answer('INVALID');
  if(requiresHttpConsent(value,request.authMode)&&!request.httpConsent)return answer('HTTP_CONSENT_REQUIRED');
  if(request.authMode==='basic'){
   let info;try{const response=await ports.describe(value.basicAuthEnv);if(!response.ok)return answer('CREDENTIAL_STATE_UNKNOWN');info=response.value[value.basicAuthEnv];if(!info)return answer('CREDENTIAL_STATE_UNKNOWN');}catch{return answer('CREDENTIAL_STATE_UNKNOWN');}
   if(!active())return answer('CANCELLED');if(!fresh())return answer('STALE');
   if(replacing){
    if(info.configured)return answer('CREDENTIAL_REFERENCE_COLLISION');if(info.writable===false)return answer('CREDENTIAL_WRITE_REJECTED');
    // The literal belongs only to this write. Never put it in Settings, report, logger or rollback.
    let response;try{const writing=ports.set(reference,request.username+':'+request.password);ports.clearSecrets();response=await writing;}catch{return answer('CREDENTIAL_WRITE_UNCONFIRMED');}finally{ports.clearSecrets();}
    if(!response.ok)return answer('CREDENTIAL_WRITE_REJECTED');credentialStored=true;
   }else if(!info?.configured)return answer('CREDENTIAL_MISSING');
  }
  if(!active())return answer(credentialStored?'CREDENTIAL_STORED_CANCELLED':'CANCELLED');
  if(!fresh())return answer(credentialStored?'CREDENTIAL_STORED_SETTINGS_STALE':'STALE');
  const ops=[...fields].map(field=>({op:'set',path:[field],value:value[field]}));
  if(ops.length){let accepted;try{accepted=await ports.mutate(ops,request.expectedRevision);}catch{return answer(credentialStored?'CREDENTIAL_STORED_SETTINGS_UNCONFIRMED':'SETTINGS_UNCONFIRMED');}if(!accepted)return answer(credentialStored?'CREDENTIAL_STORED_SETTINGS_UNCONFIRMED':'SETTINGS_UNCONFIRMED');}
  const after=current();
  // Acknowledged write is not permission to probe a configuration another editor subsequently changed.
  if(!active())return answer(credentialStored?'CREDENTIAL_STORED_CANCELLED':'CANCELLED');
  if(!ready(after)||Object.keys(value).some(key=>after.value?.[key]!==value[key]))return answer(credentialStored?'CREDENTIAL_STORED_SETTINGS_STALE':'STALE');
  return {...answer('SAVED'),revision:after.revision};
 }finally{ports.clearSecrets();}
}
