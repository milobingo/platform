const recoveryKey='milo-studio:startup-refresh';
const chunkFailure=/failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed|failed to load module script/i;

export function freshStudioUrl(href,now=Date.now()){
 const url=new URL(href);url.searchParams.set('studio-refresh',String(now));return url.href;
}
export function recoverStartup(error,{location=globalThis.location,storage,now=Date.now()}={}){
 if(!chunkFailure.test(String(error?.message||error)))return false;
 try{
  storage??=globalThis.sessionStorage;
  const previous=Number(storage.getItem(recoveryKey));
  if(previous>0&&now-previous<60000)return false;
  storage.setItem(recoveryKey,String(now));
  location.replace(freshStudioUrl(location.href,now));return true;
 }catch{return false;}
}
export function clearStartupRecovery(storage){try{(storage??globalThis.sessionStorage).removeItem(recoveryKey);}catch{}}
