// Only the native server can make local fixture previews available. A URL flag
// or an old browser preference must never switch a hosted app to fictional data.
export function configureLocalPreview(session,target=globalThis.window){
 const available=session?.localAvailable===true;
 if(!target)return false;
 target.__MILO_LOCAL_PREVIEW_AVAILABLE__=available;
 if(!available){
  const url=new URL(target.location.href);
  if(url.searchParams.has('demo')){
   url.searchParams.delete('demo');
   target.history.replaceState(target.history.state,'',url.pathname+url.search+url.hash);
  }
 }
 return available;
}
