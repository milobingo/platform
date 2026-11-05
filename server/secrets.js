// This private object has no download route. Its content is encrypted before storage.
const OBJECT='private/openai-key.v1';
const AAD=new TextEncoder().encode('appgprj_6ac2dd7f3d6c819190b17cc04ae8daad/openai-key/v1');
const encode=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes)));
const decode=text=>Uint8Array.from(atob(text),c=>c.charCodeAt(0));
export function settingsReady(env){return !!env.SETTINGS&&/^[a-f0-9]{64}$/i.test(env.VLAMPIE_SETTINGS_KEY||'');}
async function master(env){
  if(!settingsReady(env))throw new Error('settings_unavailable');
  const bytes=Uint8Array.from(env.VLAMPIE_SETTINGS_KEY.match(/../g),x=>parseInt(x,16));
  return crypto.subtle.importKey('raw',bytes,{name:'AES-GCM'},false,['encrypt','decrypt']);
}
export async function readPrivateSetting(env,name){
 const object=await env.SETTINGS?.get(`private/${name}.v1`);if(!object)return {value:null,revision:null};
 const envelope=await object.json(),plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(envelope.iv),additionalData:new TextEncoder().encode(name)},await master(env),decode(envelope.data));
 return {value:JSON.parse(new TextDecoder().decode(plain)),revision:object.etag};
}
export async function writePrivateSetting(env,name,value,revision){
 const iv=crypto.getRandomValues(new Uint8Array(12)),data=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(name)},await master(env),new TextEncoder().encode(JSON.stringify(value)));
 const object=await env.SETTINGS.put(`private/${name}.v1`,JSON.stringify({iv:encode(iv),data:encode(data)}),{onlyIf:revision===null?{etagDoesNotMatch:'*'}:{etagMatches:revision},httpMetadata:{contentType:'application/octet-stream',cacheControl:'private, no-store'}});
 return object?{revision:object.etag}:null;
}
export async function readSecret(env){
  // The new Node deployment manages provider credentials in its environment.
  // An imported legacy settings object must never override that serversecret.
  if(env.OPENAI_ENV_ONLY)return {key:typeof env.OPENAI_API_KEY==='string'?env.OPENAI_API_KEY.trim():'',revision:null,source:env.OPENAI_API_KEY?'environment':'none'};
  if(!settingsReady(env)){
    if(typeof env.OPENAI_API_KEY==='string'&&env.OPENAI_API_KEY.trim())return {key:env.OPENAI_API_KEY.trim(),revision:null,source:'environment'};
    throw new Error('settings_unavailable');
  }
  const object=await env.SETTINGS.get(OBJECT);
  if(!object)return {key:typeof env.OPENAI_API_KEY==='string'?env.OPENAI_API_KEY.trim():'',revision:null,source:env.OPENAI_API_KEY?'environment':'none'};
  const envelope=await object.json();
  if(envelope.v!==1||typeof envelope.iv!=='string'||typeof envelope.data!=='string')throw new Error('settings_corrupt');
  const iv=decode(envelope.iv);if(iv.length!==12)throw new Error('settings_corrupt');
  const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:AAD},await master(env),decode(envelope.data));
  const value=JSON.parse(new TextDecoder().decode(plain));
  if(typeof value.key!=='string')throw new Error('settings_corrupt');
  return {key:value.key,revision:object.etag,source:value.key?'site':'none'};
}
export async function saveSecret(env,key,revision){
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const data=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:AAD},await master(env),new TextEncoder().encode(JSON.stringify({key})));
  const envelope=JSON.stringify({v:1,iv:encode(iv),data:encode(data)});
  // Conditional writes prevent an older browser tab overwriting a newer setting.
  // Empty key intentionally disables an environment fallback as well.
  const object=await env.SETTINGS.put(OBJECT,envelope,{onlyIf:revision===null?{etagDoesNotMatch:'*'}:{etagMatches:revision},httpMetadata:{contentType:'application/octet-stream',cacheControl:'private, no-store'}});
  if(!object)return null;
  return {revision:object.etag,configured:!!key,source:key?'site':'none'};
}
