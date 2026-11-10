import {test,expect} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {CHARACTERS} from '../../server/characters.js';
import {makeGame,generateBooks} from '../../server/bingo-model.js';
import {BingoStore} from '../../server/bingo-store.js';
import {handleBingo} from '../../server/bingo.js';
import {createSqliteDatabase} from '../../server/node-storage.js';
import {prepareAutomaticRules,rulesCurrent} from '../../server/game-rules.js';
import {defaultPresentation} from '../../server/presentation-model.js';

// Chromium renders the real application. Auth/provider status and chat are
// inert fixtures. Preparation/start execute the real Bingo handler and SQLite
// CAS. No actual account, show or provider receives a write.
const output=process.env.SIMPLE_PREPARATION_EVIDENCE_ROOT||'verification/simple-show/preparation-browser';

async function savedShow(page,testInfo){
 const origin=new URL(testInfo.project.use.baseURL).origin,owner='qa-preparation-regie',db=createSqliteDatabase(':memory:'),store=new BingoStore(db);
 const game=makeGame({brandId:'milo',title:'QA eenvoudig voorbereiden en starten',date:'2027-11-18T13:30',timeZone:'Europe/Amsterdam'},owner,origin);
 prepareAutomaticRules(game);generateBooks(game,1,'qa-preparation-book');Object.assign(game.books[0],{accountId:'qa-family',profileId:'qa-child',name:'Sam'});await store.create(game);
 const gamePath='/api/bingo/games/'+game.id,initial=JSON.stringify((await store.game(game.id)).data);
 const evidence={origin,gameId:game.id,gets:{},bingoRequests:[],puts:[],starts:[],publishCalls:[],blockedWrites:[],external:[],unexpected:[],errors:[],expectedStorageConsoleErrors:[]},state={failSaves:true};
 const failedStorage={kind:db.kind,prepare(sql){
  const query=db.prepare(sql);if(!/^UPDATE bingo_games SET revision/.test(sql))return query;
  return {bind(...args){const bound=query.bind(...args);return {...bound,async first(){throw new Error('Synthetic preparation storage outage');}};}};
 },batch:db.batch.bind(db)};
 page.setDefaultTimeout(15000);
 page.on('pageerror',error=>evidence.errors.push(error.message));
 page.on('console',message=>{
  if(message.type()!=='error')return;
  const text=message.text(),location=message.location().url;
  if(location.startsWith(origin+gamePath)&&/^Failed to load resource: the server responded with a status of 503/.test(text))evidence.expectedStorageConsoleErrors.push(text);
  else evidence.errors.push({text,location});
 });
 await page.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url()),method=request.method();
  if(url.origin!==origin){evidence.external.push(url.origin+url.pathname);return route.abort('blockedbyclient');}
  if(url.pathname==='/favicon.ico')return route.fulfill({status:204});
  if(!url.pathname.startsWith('/api/')&&!url.pathname.startsWith('/auth/'))return route.continue();
  if(method==='GET')evidence.gets[url.pathname]=(evidence.gets[url.pathname]||0)+1;
  const bingoRead=method==='GET'&&['/api/bingo/games',gamePath,'/api/bingo/families'].includes(url.pathname);
  const bingoWrite=method==='PUT'&&url.pathname===gamePath||method==='POST'&&['start','activate','heartbeat','pause'].some(action=>url.pathname===gamePath+'/'+action);
  if(bingoRead||bingoWrite){
   const body=method==='GET'?undefined:request.postDataJSON(),headers=request.headers(),record={path:url.pathname,method,at:Date.now(),regieHeader:headers['x-vlampie-bingo']==='1',requestId:body?.requestId||null,preparationRevision:body?.expectedPreparationRevision??null,cueTitle:body?.plan?.blocks?.[0]?.title||null};
   evidence.bingoRequests.push(record);
   const response=await handleBingo(new Request(request.url(),{method,headers,...(body?{body:JSON.stringify(body)}:{})}),{DB:method==='PUT'&&state.failSaves?failedStorage:db,AUTH_IDENTITY:{user:owner,email:'regie@example.test',admin:true}});
   const text=await response.text();record.status=response.status;record.completedAt=Date.now();
   if(method==='PUT')evidence.puts.push({...record});if(url.pathname===gamePath+'/start')evidence.starts.push({...record});
   return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:text});
  }
  if(url.pathname===gamePath+'/publish-rules')evidence.publishCalls.push({path:url.pathname,method});
  if(method!=='GET'){evidence.blockedWrites.push({path:url.pathname,method});return route.fulfill({status:403,json:{error:{message:'This fixture allows only isolated preparation/start operations.'}}});}
  let body;
  if(url.pathname==='/api/auth/session')body={authenticated:true,user:owner,email:'regie@example.test',role:'regie',local:false,configured:true,localAvailable:false};
  else if(url.pathname===gamePath+'/chat'||url.pathname===gamePath+'/chat/stream'){
   const self={memberId:'qa-preparation-host',role:'host',mutedUntil:0,canSend:true,reason:'',profiles:[]};body={...(url.searchParams.has('after')?{events:[]}:{messages:[]}),cursor:0,hasMore:false,self,serverTime:Date.now()};
   if(url.pathname.endsWith('/stream'))return route.fulfill({body:`event: sync\ndata: ${JSON.stringify({...body,reconnect:true})}\n\n`,headers:{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'private, no-store'}});
  }
  else if(url.pathname===gamePath+'/chat/members')body={members:[],serverTime:Date.now()};
  else if(url.pathname==='/api/characters')body={characters:Object.values(CHARACTERS),revision:0};
  else if(url.pathname==='/api/openai/status')body={configured:true,canManage:true,source:'environment',environmentConfigured:true,revision:'qa-status-only',liveVerified:false};
  else if(url.pathname==='/api/livekit/settings')body={configured:false,canManage:true,source:'none',environmentConfigured:false,revision:null};
  else if(url.pathname==='/api/live-calls'&&url.searchParams.get('role')==='host'&&url.searchParams.get('gameId')===game.id)body={call:null,serverTime:Date.now()};
  else if(url.pathname==='/api/output')body={state:null,serverTime:Date.now()};
  else if(url.pathname==='/api/presentation/document')body={document:defaultPresentation(),revision:0};
  else {evidence.unexpected.push(url.pathname+url.search);return route.fulfill({status:404,json:{error:{message:'Unknown isolated preparation QA endpoint.'}}});}
  return route.fulfill({json:body,headers:{'Cache-Control':'private, no-store'}});
 });
 return {game,state,evidence,initial,read:async()=>(await store.game(game.id)).data,close:()=>db.close()};
}

async function noOverflow(page){await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth)).toBeLessThanOrEqual(1);}
async function screenshot(page,width,name){await mkdir(output+'/screenshots',{recursive:true});await page.screenshot({path:`${output}/screenshots/preparation-${width}-${name}.png`,fullPage:false});}

for(const width of [390,1366]){
 test(`Milo preparation autosaves, retains a failed edit and starts once without manual rules publication ${width}px; real isolated Bingo API`,async({page},testInfo)=>{
  test.setTimeout(90000);await page.setViewportSize({width,height:width===390?844:900});await page.emulateMedia({reducedMotion:'reduce'});
  const h=await savedShow(page,testInfo),{evidence}=h;
  try{
   await page.goto('/#/overview');await expect(page.locator('.mf-top-show>strong')).toHaveText(h.game.title);await expect(page.locator('.mf-top-show')).not.toContainText('Oefenstudio');
   const main=page.locator('main#mf-main'),steps=main.getByRole('navigation',{name:'Show voorbereiden'});
   await expect(steps.getByRole('button',{name:/Voorbereiden/})).toHaveAttribute('aria-current','step');await expect(steps.getByRole('button',{name:/Uitzending testen/})).toBeVisible();await expect(steps.getByRole('button',{name:/Start show/})).toBeVisible();
   const rounds=main.locator('.mf-standard-rounds>section');await expect(rounds).toHaveCount(4);await expect(main.locator('.mf-standard-rounds>section>ol>li')).toHaveCount(10);
   for(const [index,count] of [3,3,3,1].entries()){
    const round=rounds.nth(index);await expect(round.locator('ol>li')).toHaveCount(count);await expect(round).toContainText(`Rondekaart ${index+1} · leeg bord bij de nieuwe ronde`);
    if(index<3){const second=round.locator('ol>li').nth(1);await expect(second).toContainText('De bovenste én de onderste rij moeten allebei vol zijn. Eén volle rij is geen bingo voor deze prijsstap.');await expect(second.locator('.mf-pattern i.on')).toHaveCount(10);}
   }
   await expect(main.getByRole('button',{name:/Spelregels vastzetten|Publiceer.*spelregels|Draaiboek opslaan|Wijzigingen opslaan/})).toHaveCount(0);await noOverflow(page);await screenshot(page,width,'ten-price-steps');
   await main.getByRole('button',{name:'Draaiboek bewerken',exact:true}).click();await expect(page).toHaveURL(/#\/script/);
   const title=main.getByLabel('Naam van dit showmoment',{exact:true}),edited='Mijn bewaarde voorbereiding '+width;await expect(title).toHaveValue(h.game.plan.blocks[0].title);await title.fill(edited);
   await expect(main.locator('[data-save-status="saving"]')).toContainText('Opslaan…');await expect(main.locator('[data-save-status="error"]')).toContainText('Niet opgeslagen');await expect(title).toHaveValue(edited);
   await expect(main.getByRole('button',{name:'Opnieuw proberen',exact:true})).toBeVisible();expect(JSON.stringify(await h.read())).toBe(h.initial);expect(evidence.puts).toHaveLength(3);expect(new Set(evidence.puts.map(item=>item.requestId)).size).toBe(1);expect(evidence.puts.every(item=>item.status===503)).toBe(true);
   await noOverflow(page);await screenshot(page,width,'failed-save-retains-input');
   h.state.failSaves=false;await main.getByRole('button',{name:'Opnieuw proberen',exact:true}).click();await expect(main.locator('[data-save-status="saved"]')).toContainText('Opgeslagen');await expect(title).toHaveValue(edited);expect((await h.read()).plan.blocks[0].title).toBe(edited);
   const finalTitle='Laatste wijziging vóór start '+width;await title.fill(finalTitle);await main.getByRole('tab',{name:'Startcheck',exact:true}).click();
   const start=main.getByRole('button',{name:'Start show',exact:true});await expect(start).toBeEnabled();await expect(main.locator('[data-rules-state="readonly"]')).toBeVisible();
   await start.dblclick({force:true});await expect(page).toHaveURL(/#\/live/);await expect.poll(async()=>(await h.read()).status).toBe('running');
   let saved=await h.read();expect(saved.plan.blocks[0].title).toBe(finalTitle);expect(rulesCurrent(saved)).toBe(true);expect(saved.rulesPublication.finalizedAt).toBeGreaterThan(0);expect(saved.events.filter(event=>event.type==='show-started')).toHaveLength(1);expect(evidence.starts).toHaveLength(1);expect(evidence.starts[0].status).toBe(200);
   const finalPut=evidence.bingoRequests.findLastIndex(item=>item.method==='PUT'&&item.status===200&&item.cueTitle===finalTitle),started=evidence.bingoRequests.findIndex(item=>item.path.endsWith('/start'));expect(finalPut).toBeGreaterThanOrEqual(0);expect(started).toBeGreaterThan(finalPut);expect(evidence.bingoRequests[finalPut].completedAt).toBeLessThanOrEqual(evidence.starts[0].at);
   expect(evidence.publishCalls).toEqual([]);expect(evidence.puts.every(item=>item.regieHeader&&item.requestId)).toBe(true);await noOverflow(page);await screenshot(page,width,'started-once');
   const starts=evidence.starts.length;await page.goto('/#/overview');await expect(main.getByRole('button',{name:'Hervat regie',exact:true})).toBeVisible();expect(evidence.starts).toHaveLength(starts);saved=await h.read();expect(saved.events.filter(event=>event.type==='show-started')).toHaveLength(1);
   evidence.final={status:saved.status,preparationRevision:saved.preparationRevision,firstCueTitle:saved.plan.blocks[0].title,rulesVersion:saved.rulesPublication.version,rulesFinalizedAt:saved.rulesPublication.finalizedAt,rulesCurrent:rulesCurrent(saved),showStartedEvents:saved.events.filter(event=>event.type==='show-started').length,goalCount:saved.plan.blocks.filter(block=>block.type==='round').reduce((sum,round)=>sum+round.goals.length,0)};
   expect(evidence.blockedWrites).toEqual([]);expect(evidence.external).toEqual([]);expect(evidence.unexpected).toEqual([]);expect(evidence.errors).toEqual([]);
  }finally{
   await mkdir(output,{recursive:true});await writeFile(`${output}/preparation-${width}.json`,JSON.stringify({observedAt:new Date().toISOString(),viewport:page.viewportSize(),actualBrowserRendering:true,simulatedAuthAndProviderStatus:true,actualBingoHandlers:true,actualSQLiteCAS:true,inMemoryFixtureWritesOnly:true,actualAccountWrites:false,actualProviderAcceptance:false,actualOBSInstallation:false,...evidence},null,2)+'\n');
   await page.close();await h.close();
  }
 });
}
