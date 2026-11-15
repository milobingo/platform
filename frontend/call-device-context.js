// Opaque same-show browser session. It contains no identity or microphone data.
const contexts=new Map();
export function callDeviceContext(gameId){
 const key='milo-call-device:'+gameId;if(contexts.has(key))return contexts.get(key);
 let value;try{value=globalThis.sessionStorage?.getItem(key);}catch{}
 if(!/^[a-f0-9-]{36}$/.test(value||'')){value=crypto.randomUUID();try{globalThis.sessionStorage?.setItem(key,value);}catch{}}
 contexts.set(key,value);return value;
}
