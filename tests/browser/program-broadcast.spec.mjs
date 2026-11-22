import {test,expect} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {makeGame,generateBooks,playerGame} from '../../server/bingo-model.js';

async function fixture(page,testInfo){
 const origin=new URL(testInfo.project.use.baseURL).origin,account='programme-browser-family',family={ownerName:'Fictieve ouder',email:'programme@example.invalid',profiles:[{id:'fictitious-child',name:'Fictieve speler',age:9}],blocked:false,blockedGames:{},cooldowns:{}},game=makeGame({brandId:'milo',title:'Afgeschermde spelercontrole',date:'2027-11-22T19:00:00Z'},'fixture-host',origin);
 generateBooks(game,1,'programme-browser-fixture');Object.assign(game.books[0],{accountId:account,profileId:family.profiles[0].id,name:family.profiles[0].name});
 game.status='running';game.programBroadcast={version:1,enabled:true,status:'prepared'};Object.assign(game.state,{phase:'running',roundIndex:0,blockIndex:game.plan.blocks.findIndex(block=>block.type==='round'),goalIndex:0,epoch:'programme-browser-epoch',drawn:[7,19,41]});
 const proof={errors:[],external:[],unexpected:[],writes:[]};page.on('pageerror',error=>proof.errors.push(error.message));
 await page.addInitScript(()=>{
  class Emitter{constructor(){this.events=new Map();}addEventListener(name,fn){if(!this.events.has(name))this.events.set(name,new Set());this.events.get(name).add(fn);}removeEventListener(name,fn){this.events.get(name)?.delete(fn);}emit(name,event){for(const fn of this.events.get(name)||[])fn(event);}}
  const context=new Emitter(),controller=new Emitter(),remote={isConnected:false,isMediaLoaded:false},session={media:null,getMediaSession(){return this.media;},async loadMedia(request){this.media={media:request.media,playerState:'PLAYING'};remote.isConnected=true;remote.isMediaLoaded=true;controller.emit('player');},endSession(){this.media=null;remote.isConnected=false;remote.isMediaLoaded=false;context.emit('session',{sessionState:'ENDED'});}};
  Object.assign(context,{setOptions(){},getCastState:()=> 'AVAILABLE',requestSession:async()=>{},getCurrentSession:()=>session});
  window.cast={framework:{CastContext:{getInstance:()=>context},RemotePlayer:class{constructor(){return remote;}},RemotePlayerController:class{constructor(){return controller;}},CastContextEventType:{SESSION_STATE_CHANGED:'session',CAST_STATE_CHANGED:'cast'},SessionState:{SESSION_ENDED:'ENDED',SESSION_START_FAILED:'FAILED'},RemotePlayerEventType:{IS_CONNECTED_CHANGED:'connected',IS_MEDIA_LOADED_CHANGED:'loaded',PLAYER_STATE_CHANGED:'player'},CastState:{NO_DEVICES_AVAILABLE:'NONE'}}};
  window.chrome??={};window.chrome.cast={AutoJoinPolicy:{ORIGIN_SCOPED:'origin'},media:{DEFAULT_MEDIA_RECEIVER_APP_ID:'CC1AD845',StreamType:{LIVE:'LIVE'},PlayerState:{PLAYING:'PLAYING',BUFFERING:'BUFFERING',PAUSED:'PAUSED',IDLE:'IDLE'},MediaInfo:class{constructor(contentId,contentType){Object.assign(this,{contentId,contentType});}},LoadRequest:class{constructor(media){this.media=media;}}}};
 });
 const identity=()=>({accountId:account,family,host:false,serverTime:Date.now()});
 await page.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());if(url.origin!==origin){proof.external.push(url.origin+url.pathname);return route.abort('blockedbyclient');}
  if(url.pathname==='/favicon.ico')return route.fulfill({status:204});if(!url.pathname.startsWith('/api/'))return route.continue();
  let data;if(request.method()!=='GET')proof.writes.push(url.pathname);
  if(url.pathname==='/api/auth/session')data={authenticated:true,configured:true,localAvailable:false,role:'family'};
  else if(url.pathname==='/api/player/session')data={authenticated:true,method:'supabase',needsOnboarding:false,...identity()};
  else if(url.pathname==='/api/player/brand')data={brandId:'milo'};
  else if(url.pathname==='/api/bingo/me')data=identity();
  else if(url.pathname==='/api/bingo/games')data={games:[{id:game.id,brandId:'milo',title:game.title,date:game.date,status:game.status}]};
  else if(url.pathname===`/api/bingo/games/${game.id}/live`)data={...identity(),game:playerGame(game,account),complete:true,scope:'programme-family-only',familyRevision:1,booksVersion:'programme-books',configVersion:'programme-config'};
  else if(url.pathname==='/api/live-calls')data={call:null,serverTime:Date.now()};
  else if(url.pathname===`/api/bingo/games/${game.id}/chat`)data={messages:[],cursor:0,self:{memberId:account,role:'player',canSend:false,profiles:family.profiles},serverTime:Date.now()};
  else if(url.pathname===`/api/bingo/games/${game.id}/chat/stream`)data={disabled:true};
  else if(url.pathname===`/api/broadcast/${game.id}/status`)data={enabled:true,providerConfigured:true,provider:'livekit',state:'live',hls:{available:true},serverTime:Date.now()};
  else if(url.pathname===`/api/broadcast/${game.id}/token`)return route.fulfill({status:503,json:{error:{code:'fixture_unavailable',message:'Gesimuleerde netwerkonderbreking. Verbind opnieuw.'}}});
  else if(url.pathname===`/api/broadcast/${game.id}/cast`)data={url:'https://media.example.invalid/api/broadcast/hls/fictitious-capability/live.m3u8',expiresAt:Date.now()+60000,mimeType:'application/x-mpegURL'};
  else{proof.unexpected.push(url.pathname);return route.fulfill({status:404,json:{error:{message:'Real provider and participant requests are blocked in this isolated UI fixture'}}});}
  return route.fulfill({json:data,headers:{'Cache-Control':'private, no-store'}});
 });return {game,proof};
}

for(const width of [390,1366])test(`native family programme ${width}px: existing card/chat, reconnect action, Cast lifecycle and heard-ball board gate`,async({page},testInfo)=>{
 await page.setViewportSize({width,height:width===390?844:900});const h=await fixture(page,testInfo);await page.goto('/spelen?spel='+h.game.id);await page.addStyleTag({content:'nextjs-portal{pointer-events:none!important}'});
 const player=page.getByLabel('Rechtstreekse showuitzending'),grid=page.getByRole('grid',{name:'Alle 75 bingoballen'});await expect(player).toBeVisible();await expect(player).toContainText('Uitzendverbinding onderbroken');await expect(player.getByRole('button',{name:'Opnieuw verbinden',exact:true})).toBeVisible();await expect(grid.getByRole('gridcell')).toHaveCount(75);
 await expect(page.locator('.fam-youtube-frame')).toHaveCount(0);await expect(page.getByRole('navigation',{name:'Spelersomgeving'})).toBeVisible();await expect(page.getByRole('region',{name:'Showchat'})).toBeVisible();
 await player.getByRole('button',{name:'Cast naar tv',exact:true}).click();await expect(player).toContainText('Cast speelt op tv');await expect(page.locator('.fam-number-ball.is-drawn')).toHaveCount(0);await expect(page.locator('.fam-tv-board-sync')).toBeVisible();
 await page.getByRole('spinbutton',{name:'Laatst gehoorde bal',exact:true}).fill('19');await page.getByRole('button',{name:'Bord bijwerken',exact:true}).click();await expect(page.locator('.fam-number-ball.is-drawn')).toHaveCount(2);await expect(page.locator('.fam-number-ball[data-number="41"]')).toHaveAttribute('aria-selected','false');
 h.game.state.drawn.push(55);h.game.revision++;await page.evaluate(()=>dispatchEvent(new Event('online')));await expect(page.locator('.fam-number-ball[data-number="55"]')).toHaveAttribute('aria-selected','false');
 await page.getByRole('navigation',{name:'Spelersomgeving'}).getByRole('button',{name:'Boekjes',exact:false}).click();await expect(page.locator('.fam-card-numbers')).toBeVisible();await expect(page.locator('.fam-tv-board-sync')).toBeVisible();
 await page.getByRole('navigation',{name:'Spelersomgeving'}).getByRole('button',{name:'Kijken',exact:false}).click();await player.getByRole('button',{name:'Stop casten',exact:true}).click();await expect(player.getByRole('button',{name:'Cast naar tv',exact:true})).toBeVisible();await expect(page.locator('.fam-tv-board-sync')).toHaveCount(0);await expect(page.locator('.fam-number-ball.is-drawn')).toHaveCount(4);
 await player.getByRole('button',{name:'Tv-hulp',exact:true}).click();await expect(player).toContainText('Scherm spiegelen');await player.getByRole('button',{name:'Tv-hulp sluiten',exact:true}).click();await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
  const message=await player.locator('.fam-program-feedback').boundingBox(),controls=await player.locator('.fam-program-controls').boundingBox();expect(message.y+message.height).toBeLessThanOrEqual(controls.y+1);
 expect(h.proof.errors).toEqual([]);expect(h.proof.external).toEqual([]);expect(h.proof.unexpected).toEqual([]);
 expect(h.proof.writes.every(path=>path.startsWith('/api/broadcast/'))).toBe(true);
 await mkdir('verification/media/browser',{recursive:true});await page.screenshot({path:`verification/media/browser/family-programme-${width}.png`,fullPage:false});await writeFile(`verification/media/browser/family-programme-${width}.json`,JSON.stringify({actualReactBrowserRendering:true,actualLiveKitMediaDecoded:false,castSDKSimulated:true,physicalCastOrAirPlayTested:false,providerOrRealParticipantTraffic:false,...h.proof},null,2)+'\n');
});
