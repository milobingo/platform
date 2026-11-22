import {BingoStore} from './bingo-store.js';
import {playerGame,settleWindow} from './bingo-model.js';
import {playerIdentity,digest,refreshAges} from './player-identity.js';
import {brandId} from './show-brands.js';

// Bounded, role-specific projections. Neither a supplied account id nor a
// client-selected cache key can select somebody else's family variant.
const caches=new WeakMap();
const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Vary':'Cookie'}});
export async function handleLiveFeed(request,env){
 try{
  const url=new URL(request.url),match=url.pathname.match(/^\/api\/bingo\/games\/([a-f0-9-]{36})\/live$/);
  if(!match)return json({error:{code:'not_found',message:'Deze livefeed bestaat niet.'}},404);
  if(request.method!=='GET')return json({error:{code:'method',message:'Deze livefeed is alleen leesbaar.'}},405);
  if(request.headers.get('sec-fetch-site')==='cross-site'||request.headers.get('origin')&&request.headers.get('origin')!==url.origin)return json({error:{code:'origin',message:'Open de feed vanuit de familieplek.'}},403);
  const identity=await playerIdentity(request,env);
  if(!identity.user)return json({error:{code:'sign_in',message:'Log eerst in.'}},401);
  const scope=await digest(JSON.stringify(['family-feed-v1',identity.user,match[1]]));
  const id=match[1],store=new BingoStore(env.DB);let cache=caches.get(env.DB);if(!cache){cache=new Map();caches.set(env.DB,cache);}
  const readMeta=()=>env.DB.prepare("SELECT revision,json_extract(document,'$.brandId') AS brand_id,json_extract(document,'$.state.window.status') AS window_status,json_extract(document,'$.state.window.endsAt') AS window_ends_at FROM bingo_games WHERE id = ?").bind(id).first();
  let meta=await readMeta();
  if(!meta)return json({error:{code:'not_found',message:'Deze show bestaat niet.'}},404);
  const expectedBrand=url.searchParams.get('brand');
  if(!expectedBrand||expectedBrand!==brandId(meta.brand_id))return json({error:{code:'brand',message:'De livefeed hoort bij een andere showwereld.'}},403);
  if(meta.window_status==='open'&&Date.now()>=Number(meta.window_ends_at)){await store.mutate(id,{},game=>settleWindow(game,Date.now()));meta=await readMeta();if(expectedBrand!==brandId(meta.brand_id))return json({error:{code:'brand',message:'De showwereld is veranderd.'}},403);}
  const familyMeta=await env.DB.prepare('SELECT revision FROM bingo_families WHERE account_id = ?').bind(identity.user).first();
  const familyRevision=familyMeta?.revision||0;
  if(url.searchParams.get('scope')===scope&&url.searchParams.get('snapshot')!=='1'&&Number(url.searchParams.get('since'))===meta.revision&&Number(url.searchParams.get('familySince'))===familyRevision)return json({unchanged:true,scope,gameId:id,revision:meta.revision,familyRevision,serverTime:Date.now()});
  const key=JSON.stringify([id,meta.revision,identity.user,familyRevision,'family-v1']);
  let entry=cache.get(key);
  if(!entry||entry.until<Date.now()){
   const row=await store.game(id);if(brandId(row.data)!==expectedBrand)return json({error:{code:'brand',message:'De showwereld is veranderd.'}},403);const family=await store.family(identity.user,identity.email),view=playerGame(row.data,identity.user);
   entry={until:Date.now()+15000,view,family:refreshAges(family.data),familyRevision:family.revision,booksVersion:await digest(JSON.stringify(view.books)),configVersion:await digest(JSON.stringify([view.brandId,view.title,view.date,view.settings,view.rounds,view.rulesPublication,view.showRules,view.programBroadcast]))};
   cache.set(key,entry);while(cache.size>8)cache.delete(cache.keys().next().value);
  }
  const full=url.searchParams.get('scope')!==scope||url.searchParams.get('snapshot')==='1'||url.searchParams.get('booksVersion')!==entry.booksVersion||url.searchParams.get('configVersion')!==entry.configVersion;
  const {id:gameId,revision,status,state,results,production}=entry.view,compact={id:gameId,revision,status,state,results,production};
  return json({scope,game:full?entry.view:compact,complete:full,booksVersion:entry.booksVersion,configVersion:entry.configVersion,...(url.searchParams.get('familySince')!==String(entry.familyRevision)?{family:entry.family}:{}),familyRevision:entry.familyRevision,serverTime:Date.now()});
 }catch(error){return json({error:{code:'feed_unavailable',message:error.status?error.message:'De liveverbinding wordt hersteld. Bewaar je kaart.'}},error.status||503);}
}
