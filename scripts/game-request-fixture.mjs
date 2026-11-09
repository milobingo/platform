import {BingoStore} from '../server/bingo-store.js';
import {publishGameRules} from '../server/game-rules.js';
import {claimContext} from '../server/bingo-model.js';

// Adapter for pre-v70 test scenarios. This changes fixture requests only;
// direct HTTP/runtime and P0 regression tests exercise the strict API itself.
// Existing scenarios now explicitly seed published rules and capture the
// server context before submitting a claim. Supplied stale fields stay stale.
export async function gameRequestFixture(handler,request,env,...args){
 if(request.method!=='POST')return handler(request,env,...args);
 const url=new URL(request.url),match=url.pathname.match(/^\/api\/bingo\/games\/([^/]+)\/(register|start|begin|claim)$/);
 let body;try{body=await request.clone().json();}catch{return handler(request,env,...args);}
 if(match&&env.DB){
  const store=new BingoStore(env.DB);let row=await store.game(match[1]);
  if(row&&['register','start'].includes(match[2])&&!row.data.rulesPublication){
   await store.mutate(row.data.id,{requestId:'fixture-publish-'+row.data.id},game=>publishGameRules(game));row=await store.game(match[1]);
  }
  if(row&&['begin','claim'].includes(match[2])&&!body.claimContext){
   body.claimContext=claimContext(row.data);
   if(body.epoch!==undefined)body.claimContext.epoch=body.epoch;
   if(body.windowId!==undefined)body.claimContext.windowId=body.windowId;
  }
 }
 if(body.date&&!body.timeZone)body.timeZone='Europe/Amsterdam';
 return handler(new Request(request,{body:JSON.stringify(body)}),env,...args);
}
