const key=brand=>'milo-family-viewing-v1:'+(brand==='vlampie'?'vlampie':'milo');
export function readFamilyViewing(brand,{storage=globalThis.localStorage,matchMedia=globalThis.matchMedia}={}){
 let saved;try{saved=JSON.parse(storage?.getItem(key(brand))||'null');}catch{}
 let system=false;try{system=matchMedia?.('(prefers-reduced-motion: reduce)').matches===true;}catch{}
 return {captions:saved?.captions===true,reducedMotion:typeof saved?.reducedMotion==='boolean'?saved.reducedMotion:system};
}
export function saveFamilyViewing(brand,value,{storage=globalThis.localStorage}={}){
 const preferences={captions:value.captions===true,reducedMotion:value.reducedMotion===true};
 try{storage?.setItem(key(brand),JSON.stringify(preferences));}catch{}
 return preferences;
}
