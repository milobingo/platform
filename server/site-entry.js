// Shared by the Worker and React bootstrap: old bookmarks always enter the new app.
const studioPaths=new Set(['/','/index.html','/regie','/uitzending','/klassiek','/studio-hub.html','/milo-studio.html']);
const aliases={overzicht:'overview',regie:'live',spellen:'shows',voorbereiding:'script',prepare:'script',patronen:'script',prijzen:'script',spelregels:'library',chat:'audience',vlampie:'characters/vlampie',koppeling:'settings'};
export const isStudioEntry=path=>studioPaths.has(path);
export const isFamilyEntry=path=>path==='/player.html'||/^\/spelen(?:\/[a-z-]*)?$/.test(path);
export function normalizedEntry(input){
 const url=new URL(input),original=url.href;
 if(!isStudioEntry(url.pathname)&&!isFamilyEntry(url.pathname))return null;
 const family=isFamilyEntry(url.pathname),view=url.searchParams.get('view');
 if(family){if(['/player.html','/spelen/klassiek'].includes(url.pathname))url.pathname='/spelen';}
 else{
  if(['show','overlay'].includes(view))url.pathname='/uitzending';
  else if(['/index.html','/klassiek','/studio-hub.html','/milo-studio.html'].includes(url.pathname))url.pathname='/';
  if(url.pathname==='/regie'){url.pathname='/';if(!url.hash)url.hash='/live';}
  url.searchParams.delete('view');
  if(url.pathname!=='/uitzending'){
   const hash=url.hash.replace(/^#\/?/,'');
   if(aliases[hash])url.hash='/'+aliases[hash];
  }
 }
 return url.href===original?null:url;
}
