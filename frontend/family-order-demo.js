import {makeGame,playerGame} from '../server/bingo-model.js';
import {productionSettings} from '../server/production-model.js';
import {readOrderDemo,mutateOrderDemo,ORDER_DEMO_ACCOUNT} from './order-demo-store.js';

/** Browser-local family order transport. Tokens/cards are deliberately invalid;
 * no payment provider, email service or real order endpoint is contacted. */
const copy=value=>structuredClone(value);
const fail=(message,status=409)=>Object.assign(new Error(message),{status,code:'order_demo_invalid',simulated:true});
const configOf=show=>show?.ordering||show?.config||{enabled:false,maxQuantity:30,unitPriceCents:null};
const open=show=>show?.status==='draft'&&configOf(show).enabled===true&&show.available!==false&&Number.isFinite(Date.parse(show.date))&&Date.parse(show.date)>Date.now();
const bodyOf=body=>{if(body==null)return {};if(typeof body==='string'){try{return JSON.parse(body);}catch{throw fail('Deze voorbeeldaanvraag is niet leesbaar.',400);}}return body;};
const accountOf=context=>context.accountId||ORDER_DEMO_ACCOUNT;
function publicOrder(order){const {email,customerName,accountId,requestId,profileAges,profileNames,...safe}=order;return copy(safe);}
function currentShows(state,context){
 const additional=[...(context.games?.values?.()||[])].filter(game=>!state.shows.some(show=>show.id===game.id)).map(game=>({id:game.id,brandId:game.brandId,title:game.title,date:game.date,status:game.status,roundCount:game.plan.blocks.filter(b=>b.type==='round').length,ordering:{enabled:false,maxQuantity:30,unitPriceCents:null},available:false}));
 return [...state.shows.map(show=>({...show,available:open(show)})),...additional];
}
export function syncFamilyOrderDemo(context={},state=readOrderDemo()){
 if(!context.games?.set)return state;
 for(const show of state.shows){
  let game=context.games.get(show.id);
  if(!game){game=makeGame({timeZone:'Europe/Amsterdam',brandId:show.brandId||'milo',title:show.title,date:show.date,roundCount:show.roundCount||4},'family-demo-studio','https://family-demo.invalid',Date.now());game.id=show.id;game.revision=1;game.simulated=true;game.production=productionSettings({calls:{enabled:false}},game);game.presentationSnapshot={rules:[{id:'order-demo',title:'Fictieve bestelshow',text:'Bestellingen, e-mails, betalingen en bladen zijn voorbeelden. De kaarten zijn ongeldig voor echte shows.'}]};context.games.set(show.id,game);context.messages?.set?.(show.id,[]);}
  const books=state.orders.filter(o=>o.show.id===show.id&&o.status==='fulfilled').flatMap(o=>state.booksByOrder[o.id]||[]);
  if(JSON.stringify(game.books)!==JSON.stringify(books)){game.books=copy(books);game.revision=(game.revision||0)+1;}
  game.ordering=copy(configOf(show));game.available=open(show);game.status=show.status;game.title=show.title;game.date=show.date;
 }
 return state;
}
function response(state,context,gameId,orderId){
 syncFamilyOrderDemo(context,state);
 const accountId=accountOf(context),orders=state.orders.filter(o=>o.accountId===accountId&&(!gameId||o.show.id===gameId)),show=state.shows.find(s=>s.id===gameId),game=context.games?.get?.(gameId);
 return {orders:orders.map(publicOrder),shows:currentShows(state,context),...(orderId?{order:orders.find(o=>o.id===orderId)?publicOrder(orders.find(o=>o.id===orderId)):undefined}:{}),...(gameId?{config:copy(configOf(show)),available:open(show)}:{}),...(game?{game:{...playerGame(game,accountId),simulated:true,demo:true}}:{}),...(context.family?{family:copy(context.family)}:{}),serverTime:Date.now(),simulated:true,demo:true};
}
/** Call before the existing family-demo route matching. Undefined means that
 * the original demo handler should continue. Passing its state also makes the
 * future show and approved books available through the normal /games routes. */
export function matchFamilyOrderDemo(input,options={},context={}){
 const url=input instanceof URL?input:new URL(String(input),globalThis.location?.href||'https://family-demo.invalid/'),path=url.pathname,verb=(options.method||'GET').toUpperCase();
 const match=path.match(/^\/api\/bingo\/games\/([^/]+)\/orders(?:\/([^/]+))?(?:\/([^/]+))?$/),all=path==='/api/bingo/orders';
 const state=syncFamilyOrderDemo(context);
 if(!all&&!match)return undefined;
 if(new URL(globalThis.location?.href||'https://family-demo.invalid/').searchParams.get('demo')!=='1')throw fail('Deze bestellingen zijn alleen beschikbaar in de expliciete demostand.',403);
 if(options.signal?.aborted)throw new DOMException('De voorbeeldactie is geannuleerd.','AbortError');
 if(context.authenticated===false)throw fail('Log opnieuw in op het voorbeeldaccount.',401);
 const gameId=match?decodeURIComponent(match[1]):undefined,orderId=match?.[2]?decodeURIComponent(match[2]):undefined,action=match?.[3]?decodeURIComponent(match[3]):undefined,accountId=accountOf(context);
 if(verb==='GET'&&(all||!orderId))return response(state,context,gameId);
 if(verb!=='POST'||all)throw fail('Deze voorbeeldactie is niet beschikbaar.',404);
 const data=bodyOf(options.body),family=context.family||{profiles:[]};
 if(!orderId){
  const show=state.shows.find(s=>s.id===gameId);if(!open(show))throw fail('Bestellen voor deze voorbeeldshow is gesloten.');
  if(!['print','pickup','both'].includes(data.fulfillmentChoice))throw fail('Kies Zelf printen, Ophalen of Zelf printen én ophalen.');
  const max=Math.min(30,configOf(show).maxQuantity||30),quantity=data.quantity;
  if(!Number.isInteger(quantity)||quantity<1||quantity>max)throw fail(`Kies 1 tot ${max} bingobladen.`);
  if(!Array.isArray(data.profileIds)||data.profileIds.length!==quantity)throw fail('Controleer de spelers bij jullie bladen.');
  if(data.profileIds.some(id=>id!==null&&!family.profiles.some(p=>p.id===id)))throw fail('Kies alleen spelers uit jullie voorbeeldgezin.');
  const requestId=String(data.requestId||'');if(!requestId)throw fail('Deze aanvraag mist een herkenbare referentie. Probeer opnieuw.');
  const previous=state.orders.find(o=>o.accountId===accountId&&o.show.id===gameId&&o.requestId===requestId);if(previous)return response(state,context,gameId,previous.id);
  const id='demo-order-'+crypto.randomUUID(),changed=mutateOrderDemo(s=>{s.orders.push({id,reference:'MF-DEMO-'+String(s.orders.length+1041),requestId,accountId,customerName:family.ownerName||'Voorbeeldgezin',email:family.email||'gezin@voorbeeld.invalid',show:{id:show.id,title:show.title,date:show.date,roundCount:show.roundCount||4},quantity,fulfillmentChoice:data.fulfillmentChoice,profileIds:copy(data.profileIds),profileNames:data.profileIds.map(id=>family.profiles.find(p=>p.id===id)?.name||''),profileAges:data.profileIds.map(id=>family.profiles.find(p=>p.id===id)?.age??null),amountCents:Number.isInteger(configOf(show).unitPriceCents)?quantity*configOf(show).unitPriceCents:null,status:'requested',createdAt:Date.now(),paymentUrl:'',paymentMail:{status:'queued'},readyMail:{status:'queued'},books:[],bookIds:[],note:'',simulated:true});});
  return response(changed,context,gameId,id);
 }
 const order=state.orders.find(o=>o.id===orderId&&o.show.id===gameId&&o.accountId===accountId);if(!order)throw fail('Deze voorbeeldbestelling is niet gevonden.',404);
 if(!['paid','cancel','assign'].includes(action))throw fail('Deze actie is voor de organisatie, niet voor het gezinsaccount.',403);
 const changed=mutateOrderDemo(s=>{
  const item=s.orders.find(o=>o.id===orderId&&o.accountId===accountId),show=s.shows.find(x=>x.id===gameId);
  if(action==='paid'){
   if(item.status==='payment_reported')return;if(item.status!=='payment_pending')throw fail('Er staat nog geen betaallink klaar om een betaling te melden.');
   item.status='payment_reported';item.paymentReportedAt=Date.now();
  }else if(action==='cancel'){
   if(item.status==='cancelled')return;if(!['requested','payment_pending'].includes(item.status))throw fail('Deze bestelling kan niet meer als aanvraag worden geannuleerd. Neem contact op met de organisatie.');
   item.status='cancelled';item.cancelledAt=Date.now();
  }else{
   if(item.status!=='fulfilled'||show?.status!=='draft')throw fail('Koppel jullie bladen vóór de show begint, na goedkeuring.');
   const book=s.booksByOrder[item.id]?.find(b=>b.id===data.bookId),profile=family.profiles.find(p=>p.id===data.profileId);
   if(!book||!profile)throw fail('Kies een eigen blad en een speler uit jullie gezin.');
   if(book.profileId&&book.profileId!==profile.id)throw fail('Dit blad is al aan een andere speler gekoppeld.');
   Object.assign(book,{profileId:profile.id,name:profile.name,age:profile.age,admitted:true,issueStatus:'assigned'});item.books=s.booksByOrder[item.id].map(({cards,token,code,...b})=>b);
  }
 });
 return response(changed,context,gameId,orderId);
}
