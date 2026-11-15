import {test,expect} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {createSqliteDatabase} from '../../server/node-storage.js';
import {BingoStore} from '../../server/bingo-store.js';
import {handleBingo} from '../../server/bingo.js';
import {makeGame,activateBlock,forceCancelGame} from '../../server/bingo-model.js';
import {rulesContract} from '../../server/game-rules.js';
import {CHARACTERS} from '../../server/characters.js';
import {defaultPresentation} from '../../server/presentation-model.js';

const output=process.env.BROADCAST_SETTINGS_EVIDENCE_ROOT||'verification/broadcast-settings/browser',video='ezsA3hsxIEc',other='dQw4w9WgXcQ',remote='aaaaaaaaaaa';
async function fixture(page,testInfo){
 const origin=new URL(testInfo.project.use.baseURL).origin,owner='broadcast-browser-fixture',db=createSqliteDatabase(':memory:'),store=new BingoStore(db),game=makeGame({brandId:'milo',title:'QA YouTube-instellingen',date:'2027-12-05T19:00:00Z'},owner,origin);
 game.status='running';activateBlock(game,game.plan.blocks.findIndex(block=>block.type==='round'));game.state.drawn=[7,19,41];game.state.lastCommit={number:41,at:Date.now()-20000};game.state.paused=true;await store.create(game);
 const proof={gameId:game.id,requests:[],unexpected:[],external:[],errors:[],expectedFailures:[]},state={failures:1};
 page.on('pageerror',error=>proof.errors.push(error.message));page.on('console',message=>{if(message.type()!=='error')return;const text=message.text(),url=message.location().url;if(url===origin+'/api/bingo/games/'+game.id+'/broadcast'&&/^Failed to load resource: the server responded with a status of (409|503)/.test(text))proof.expectedFailures.push({text,url});else proof.errors.push({text,url});});
 await page.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());if(url.origin!==origin){proof.external.push(url.origin+url.pathname);return route.abort('blockedbyclient');}
  if(url.pathname==='/favicon.ico')return route.fulfill({status:204});if(!url.pathname.startsWith('/api/')&&!url.pathname.startsWith('/auth/'))return route.continue();
  if(url.pathname==='/api/bingo/games/'+game.id+'/broadcast'&&request.method()==='POST'){
   const body=request.postDataJSON();if(state.failures-->0){proof.requests.push({body,status:503});return route.fulfill({status:503,json:{error:{code:'unavailable',message:'De opslag is tijdelijk niet bereikbaar. Je invoer blijft bewaard.'}}});}
   const headers=new Headers(request.headers());headers.set('Origin',origin);const response=await handleBingo(new Request(url.href,{method:'POST',headers,body:request.postData()}),{DB:db,AUTH_IDENTITY:{user:owner,admin:true}}),data=await response.json();proof.requests.push({body,status:response.status});return route.fulfill({status:response.status,json:data});
  }
  if(request.method()!=='GET'){proof.unexpected.push({path:url.pathname,method:request.method()});return route.fulfill({status:403,json:{error:{message:'Only the isolated broadcast setting may be written'}}});}
  let data;
  if(url.pathname==='/api/auth/session')data={authenticated:true,role:'regie',user:owner,configured:true,email:'fixture@example.invalid'};
  else if(url.pathname==='/api/bingo/games')data={games:[{id:game.id,brandId:'milo',title:game.title,status:(await store.game(game.id)).data.status,date:game.date,timeZone:game.timeZone,roundCount:4,bookCount:0}]};
  else if(url.pathname==='/api/bingo/games/'+game.id){const response=await handleBingo(new Request(url.href,{headers:{Origin:origin}}),{DB:db,AUTH_IDENTITY:{user:owner,admin:true}});return route.fulfill({status:response.status,json:await response.json()});}
  else if(url.pathname==='/api/characters')data={characters:Object.values(CHARACTERS),revision:0};
  else if(url.pathname==='/api/openai/status'||url.pathname==='/api/livekit/settings')data={configured:false,canManage:true,source:'none',environmentConfigured:false};
  else if(url.pathname==='/api/live-calls')data={call:null,serverTime:Date.now()};
  else if(url.pathname==='/api/output')data={state:null,serverTime:Date.now()};
  else if(url.pathname==='/api/presentation/document')data={document:defaultPresentation(),revision:0};
  else if(url.pathname==='/api/bingo/families')data={families:[]};
  else if(url.pathname==='/api/bingo/games/'+game.id+'/chat'||url.pathname==='/api/bingo/games/'+game.id+'/chat/stream'){
   data={messages:[],events:[],cursor:0,hasMore:false,self:{memberId:owner,role:'host',canSend:true,profiles:[]},serverTime:Date.now()};if(url.pathname.endsWith('/stream'))return route.fulfill({body:'event: sync\ndata: '+JSON.stringify({...data,reconnect:true})+'\n\n',headers:{'Content-Type':'text/event-stream'}});
  }else if(url.pathname==='/api/bingo/games/'+game.id+'/chat/members')data={members:[],serverTime:Date.now()};
  else{proof.unexpected.push({path:url.pathname,method:request.method()});return route.fulfill({status:404,json:{error:{message:'Unexpected isolated broadcast endpoint'}}});}
  return route.fulfill({json:data,headers:{'Cache-Control':'private, no-store'}});
 });return {game,store,proof,read:async()=>(await store.game(game.id)).data,close:()=>db.close()};
}
for(const width of [1366,390])test(`YouTube autosave ${width}px: running paused show, failed storage, retry, reload, conflict and terminal read-only; real isolated Bingo API`,async({page},testInfo)=>{
 test.setTimeout(90000);await page.setViewportSize({width,height:width===390?844:900});const h=await fixture(page,testInfo);
 const open=async()=>{await page.goto('/#/settings');await page.getByRole('button',{name:'Deze show',exact:true}).click();return page.locator('.mf-panel').filter({has:page.getByRole('heading',{name:'YouTube-uitzending',exact:true})});};
 const shot=async name=>{await mkdir(output+'/screenshots',{recursive:true});await page.screenshot({path:output+`/screenshots/youtube-${width}-${name}.png`,fullPage:false});};
 try{
  const before=await h.read();let card=await open(),input=card.getByRole('textbox',{name:'YouTube-video-ID of link',exact:false});await expect(input).toBeEnabled();const rules=page.locator('.mf-show-settings-fields');await expect(rules).toHaveAttribute('disabled','');await expect(rules.getByRole('spinbutton',{name:'Meldvenster (minimaal 30 sec)',exact:true})).toBeDisabled();await expect(rules.getByRole('button',{name:'Showinstellingen opslaan',exact:true})).toBeDisabled();
  const url='https://youtu.be/'+video+'?si=fixture';await input.fill(url);await expect(card.getByRole('alert')).toContainText('Niet opgeslagen');await expect(input).toHaveValue(url);expect(h.proof.requests).toHaveLength(1);await page.waitForTimeout(200);expect(h.proof.requests).toHaveLength(1);await shot('failed-retains-input');
  await card.getByRole('button',{name:'Opnieuw proberen',exact:true}).click();await expect(card.getByRole('status')).toContainText('Opgeslagen · '+video);await expect(input).toHaveValue(video);expect(h.proof.requests).toHaveLength(2);expect(h.proof.requests[0].body.requestId).toBe(h.proof.requests[1].body.requestId);expect((await h.read()).settings.youtubeId).toBe(video);await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);await shot('saved-running');
  card=await open();input=card.getByRole('textbox',{name:'YouTube-video-ID of link',exact:false});await expect(input).toHaveValue(video);expect(h.proof.requests).toHaveLength(2);
  await input.fill(other);await h.store.mutate(h.game.id,{},game=>{game.settings.youtubeId=remote;game.broadcastRevision++;});await expect(card.getByRole('alert')).toContainText('ander venster');await expect(input).toHaveValue(other);await expect(card).toContainText('Nu opgeslagen: '+remote);
  const count=h.proof.requests.length;await page.waitForTimeout(200);expect(h.proof.requests).toHaveLength(count);await card.getByRole('button',{name:'Opnieuw proberen',exact:true}).click();await expect(card.getByRole('status')).toContainText('Opgeslagen · '+other);expect((await h.read()).settings.youtubeId).toBe(other);
  const saved=await h.read();expect(saved.state).toEqual(before.state);expect(saved.plan).toEqual(before.plan);expect(saved.preparationRevision).toBe(before.preparationRevision);expect(rulesContract(saved)).toEqual(rulesContract(before));
  await h.store.mutate(h.game.id,{},game=>forceCancelGame(game,{by:'fixture',reason:'Einde van de geannuleerde testshow',requestId:crypto.randomUUID(),binding:'fixture'},Date.now()));await expect(page.locator('.mf-top-show')).toContainText('Geannuleerd');await expect(input).toBeDisabled();await expect(input).toHaveValue(other);await expect(card).toContainText('Deze show is geannuleerd');await expect(card.getByRole('button',{name:'Opnieuw proberen',exact:true})).toHaveCount(0);await shot('terminal-readonly');
  expect(h.proof.errors).toEqual([]);expect(h.proof.external).toEqual([]);expect(h.proof.unexpected).toEqual([]);
 }finally{await mkdir(output,{recursive:true});await writeFile(output+`/youtube-${width}.json`,JSON.stringify({observedAt:new Date().toISOString(),actualBrowserRendering:true,realBingoHandlers:true,isolatedSQLiteWrites:true,actualShowOrAccountMutation:false,actualProviderRequests:false,...h.proof},null,2)+'\n');await page.close();await h.close();}
});
