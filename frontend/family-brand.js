import {SHOW_BRANDS} from '../server/show-brands.js';

const hasBrand=id=>Object.hasOwn(SHOW_BRANDS,id);

/** The family entrance is Milo by default. A selected stored show always keeps
 * its own identity, including the canonical Vlampie fallback for legacy shows.
 */
export function familyBrandId(value,fallback='milo'){
 const candidate=typeof value==='string'?value:value?.brandId;
 if(hasBrand(candidate))return candidate;
 if(value&&typeof value==='object'&&value.id)return 'vlampie';
 return hasBrand(fallback)?fallback:'milo';
}

export function familyBrandAssets(value,fallback='milo'){
 const brandId=familyBrandId(value,fallback),brand=SHOW_BRANDS[brandId];
 return {brandId,title:brand.title,name:brand.name,short:brand.short,logo:brand.logo,mascot:brand.mascot,palette:brand.palette,
  backdrop:brandId==='milo'?'/assets/milo-friends/studio/sterrenplein-grand-room.webp':brandId==='vlampie'?'/assets/studio-master-v14.png':'/assets/hosts/rocco-master-v36.webp'};
}

const dateOf=game=>{const at=Date.parse(game.date);return Number.isFinite(at)?at:null;};
function preferredShow(rows,now){
 return [...rows].sort((a,b)=>{
  const order={running:0,draft:1,finished:2},rank=(order[a.status]??3)-(order[b.status]??3);
  if(rank)return rank;
  const left=dateOf(a),right=dateOf(b);
  if(left===null||right===null)return left===right?0:left===null?1:-1;
  if(a.status==='draft'){
   const leftUpcoming=left>=now,rightUpcoming=right>=now;
   if(leftUpcoming!==rightUpcoming)return leftUpcoming?-1:1;
   return leftUpcoming?left-right:right-left;
  }
  return right-left;
 })[0]?.id||'';
}

/** A QR/deep link is an exact request, not a suggestion. Never redirect it to
 * another show, even if its details still need to be fetched. Generic entrances
 * prefer Milo's active/upcoming show without hiding other productions. If that
 * world has no shows yet, keep its welcome screen instead of switching brands.
 */
export function selectFamilyGameId(games,{requestedId='',bookGameId='',brandHint='milo',now=Date.now()}={}){
 if(requestedId)return requestedId;
 if(bookGameId)return bookGameId;
 const rows=Array.isArray(games)?games.filter(g=>g&&typeof g.id==='string'&&g.id):[],brand=familyBrandId(brandHint);
 const preferred=rows.filter(g=>familyBrandId(g)===brand);
 return preferredShow(preferred,now);
}
