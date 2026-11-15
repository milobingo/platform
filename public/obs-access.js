// A browser-source capability stays in this tab's URL/memory. It is never a
// regie session and must never accompany arbitrary same-origin API requests.
const tokenPattern=/^[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/;
export function isObsSource(location=globalThis.location){
 if(location?.pathname!=='/uitzending')return false;
 return new URLSearchParams((location.hash||'').replace(/^#/,'')).has('obs');
}
export function obsSourceToken(location=globalThis.location){
 if(!isObsSource(location))return null;
 const values=new URLSearchParams((location.hash||'').replace(/^#/,''));
 const tokens=values.getAll('obs');return tokens.length===1&&tokenPattern.test(tokens[0])?tokens[0]:null;
}
function lost(){globalThis.window?.dispatchEvent?.(new Event('milo-obs-access-lost'));}
export async function obsFetch(input,init={},options={}){
 const fetcher=options.fetcher||globalThis.fetch,location=options.location||globalThis.location;
 if(!isObsSource(location))return fetcher(input,init);
 const url=new URL(String(input),location.origin),sameOrigin=url.origin===location.origin;
 let path=sameOrigin?url.pathname:'';
 if(path==='/api/output')path='/api/obs/output';
 else if(path==='/api/openai/show-audio')path='/api/obs/show-audio';
 else if(/^\/api\/openai\/clips\/[a-f0-9]{64}$/.test(path))path=path.replace('/api/openai/clips/','/api/obs/clips/');
 else if(/^\/api\/live-calls(?:\/|$)/.test(path))path=path.replace('/api/live-calls','/api/obs/live-calls');
 const scoped=/^\/api\/obs\/(?:session|output|show-audio|clips\/[a-f0-9]{64}|live-calls(?:\/[a-z-]+)?)$/.test(path);
 if(!sameOrigin||!scoped){const headers=new Headers(init.headers);headers.delete('X-Milo-OBS-Token');return fetcher(input,{...init,headers});}
 const token=obsSourceToken(location);
 if(!token){lost();throw Object.assign(new Error('De OBS-link is ongeldig of onvolledig. Maak een nieuwe link in de regie.'),{status:401});}
 const headers=new Headers(init.headers);headers.set('X-Milo-OBS-Token',token);
 try{
  const response=await fetcher(path+url.search,{...init,headers,credentials:'omit',cache:'no-store',redirect:'error'});
  if(!response.ok)lost();return response;
 }catch(error){if(error?.name!=='AbortError')lost();throw error;}
}
