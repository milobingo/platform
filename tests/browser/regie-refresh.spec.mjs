import {test,expect} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {CHARACTERS} from '../../server/characters.js';
import {makeGame,activateBlock} from '../../server/bingo-model.js';
import {BingoStore} from '../../server/bingo-store.js';
import {handleBingo} from '../../server/bingo.js';
import {createSqliteDatabase} from '../../server/node-storage.js';
import {prepareAutomaticRules} from '../../server/game-rules.js';
import {defaultPresentation} from '../../server/presentation-model.js';

// Production UI and real Bingo handlers/SQLite CAS. Every API request is
// intercepted; no real show, account, provider or production data is changed.
const output=process.env.REGIE_REFRESH_EVIDENCE_ROOT||'verification/regie-refresh/browser';
async function fixture(page,testInfo){
 const origin=new URL(testInfo.project.use.baseURL).origin,owner='qa-regie-refresh',db=createSqliteDatabase(':memory:'),store=new BingoStore(db);
 const game=makeGame({brandId:'milo',title:'QA regie · Magie op het Sterrenplein',date:'2027-11-18T13:30',timeZone:'Europe/Amsterdam'},owner,origin);
 prepareAutomaticRules(game);game.status='running';game.startedAt=Date.now()-120000;
 activateBlock(game,game.plan.blocks.map((block,index)=>({block,index})).filter(item=>item.block.type==='round')[1].index,1);
 Object.assign(game.state,{paused:true,drawn:[7,13,19,24,31,41],lastCommit:{number:41,at:Date.now()-20000}});await store.create(game);
 const path='/api/bingo/games/'+game.id,evidence={origin,gameId:game.id,errors:[],external:[],unexpected:[],forbiddenWrites:[],mutations:[]};
 page.on('pageerror',error=>evidence.errors.push(error.message));
 page.on('console',message=>{if(message.type()==='error')evidence.errors.push(message.text());});
 await page.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url()),method=request.method();
  if(url.origin!==origin){evidence.external.push(url.origin+url.pathname);return route.abort('blockedbyclient');}
  if(url.pathname==='/favicon.ico')return route.fulfill({status:204});
  if(!url.pathname.startsWith('/api/')&&!url.pathname.startsWith('/auth/'))return route.continue();
  const read=method==='GET'&&['/api/bingo/games',path,'/api/bingo/families'].includes(url.pathname),write=method==='POST'&&['heartbeat','pause'].some(action=>url.pathname===path+'/'+action);
  if(read||write){
   const body=write?request.postDataJSON():undefined,response=await handleBingo(new Request(request.url(),{method,headers:request.headers(),...(body?{body:JSON.stringify(body)}:{})}),{DB:db,AUTH_IDENTITY:{user:owner,email:'regie@example.test',admin:true}});
   if(write)evidence.mutations.push({path:url.pathname,body,status:response.status});
   return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:await response.text()});
  }
  if(method!=='GET'){evidence.forbiddenWrites.push({path:url.pathname,method});return route.fulfill({status:403,json:{error:{message:'Only isolated pause and heartbeat writes are allowed.'}}});}
  let body;
  if(url.pathname==='/api/auth/session')body={authenticated:true,user:owner,email:'regie@example.test',role:'regie',local:false,configured:true,localAvailable:false};
  else if(url.pathname===path+'/chat'||url.pathname===path+'/chat/stream'){
   body={...(url.searchParams.has('after')?{events:[]}:{messages:[]}),cursor:0,hasMore:false,self:{memberId:'qa-regie-host',role:'host',mutedUntil:0,canSend:true,reason:'',profiles:[]},serverTime:Date.now()};
   if(url.pathname.endsWith('/stream'))return route.fulfill({body:`event: sync\ndata: ${JSON.stringify({...body,reconnect:true})}\n\n`,headers:{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'private, no-store'}});
  }
  else if(url.pathname===path+'/chat/members')body={members:[],serverTime:Date.now()};
  else if(url.pathname==='/api/characters')body={characters:Object.values(CHARACTERS),revision:0};
  else if(url.pathname==='/api/openai/status'||url.pathname==='/api/livekit/settings')body={configured:false,canManage:true,source:'none',environmentConfigured:false,revision:null};
  else if(url.pathname==='/api/live-calls')body={call:null,serverTime:Date.now()};
  else if(url.pathname==='/api/output')body={state:null,serverTime:Date.now()};
  else if(url.pathname==='/api/presentation/document')body={document:defaultPresentation(),revision:0};
  else {evidence.unexpected.push(url.pathname+url.search);return route.fulfill({status:404,json:{error:{message:'Unexpected isolated regie QA endpoint.'}}});}
  return route.fulfill({json:body,headers:{'Cache-Control':'private, no-store'}});
 });
 return {game,evidence,read:async()=>(await store.game(game.id)).data,mutate:operation=>store.mutate(game.id,{},operation),close:()=>db.close()};
}
async function noOverflow(page){await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth)).toBeLessThanOrEqual(1);}
async function shot(page,name){await mkdir(output+'/screenshots',{recursive:true});await page.screenshot({path:output+'/screenshots/'+name+'.png',fullPage:false});}
async function top(page){await page.evaluate(()=>{window.scrollTo(0,0);document.querySelector('main#mf-main')?.scrollTo(0,0);});}
for(const width of [1920,1366,390]){
 test(`regie refresh ${width}px: live priorities, resume, keyboard pause and BINGO focus; isolated real Bingo API`,async({page},testInfo)=>{
  test.setTimeout(90000);await page.setViewportSize({width,height:width===1920?1080:width===1366?900:844});await page.emulateMedia({reducedMotion:'reduce'});
  const h=await fixture(page,testInfo),{evidence}=h;
  try{
   await page.goto('/#/live');const main=page.locator('main#mf-main'),workspace=main.locator('.rd-workspace'),essentials=workspace.locator('.mf-live-essentials'),timer=essentials.getByRole('timer',{name:'Volgende officiële bal'}),advanced=workspace.locator('.mf-live-advanced');
   await expect(workspace).toBeVisible();await expect(workspace.getByRole('heading',{name:'Live regie',exact:true})).toBeVisible();await expect(page.locator('.mf-top-show>strong')).toHaveText(h.game.title);
   await expect(essentials).toContainText('Ronde 2');await expect(essentials).toContainText('Prijsstap 2 / 3');await expect(essentials).toContainText('Bovenste én onderste rij');await expect(essentials.locator('.mf-live-ball')).toHaveText('41');
   await expect(timer).toContainText('Wacht');await expect(timer).toContainText('Gepauzeerd');await expect(advanced).toHaveCount(2);await expect(workspace.locator('.mf-live-advanced[open]')).toHaveCount(0);await noOverflow(page);await shot(page,`regie-${width}-saved-round`);
   const labelSizes=await essentials.locator(':scope>div>span').evaluateAll(labels=>labels.map(label=>parseFloat(getComputedStyle(label).fontSize)));expect(labelSizes.every(size=>size>=12)).toBe(true);
   expect(await workspace.evaluate(node=>Boolean(node.querySelector('.rd-transport').compareDocumentPosition(node.querySelector('.mf-live-advanced'))&Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
   if(width>=1366){await expect(essentials).toBeInViewport({ratio:1});await expect(workspace.locator('.mf-live-bingo>.rd-section').first()).toBeInViewport({ratio:1});await expect(workspace.locator('.mf-live-bingo>.rd-section').last()).toBeInViewport({ratio:1});}
   const resume=workspace.getByRole('button',{name:'Hervat regie',exact:true});await expect(resume).toBeEnabled();await resume.click();await expect(main.getByText('Regie hersteld. Spelstand en blokkades zijn behouden. Kies bewust Hervat om de trekking vrij te geven.',{exact:true})).toBeVisible();await main.getByRole('button',{name:'Melding sluiten',exact:true}).click();
   const play=essentials.getByRole('button',{name:'Hervat',exact:true});await expect(play).toBeEnabled();await play.click();await expect(essentials.getByRole('button',{name:'Pauze',exact:true})).toBeEnabled();
   await expect.poll(async()=>(await h.read()).state.paused).toBe(false);await expect(timer).toContainText(/1[345] s/);
   // The existing keyboard shortcut must still reach the same pause handler.
   await main.focus();await page.keyboard.press('Space');await expect(play).toBeEnabled();await expect.poll(async()=>(await h.read()).state.paused).toBe(true);await expect(timer).toContainText('Gepauzeerd');
   await top(page);await noOverflow(page);await shot(page,`regie-${width}-paused`);
   const board=workspace.locator('.rd-board');await board.locator('summary').focus();await page.keyboard.press('Enter');await expect(board).toHaveAttribute('open','');await expect(board.locator('.rd-number-grid>span')).toHaveCount(75);await expect(board.locator('.rd-number-grid>span.drawn')).toHaveCount(6);await board.locator('summary').focus();await page.keyboard.press('Enter');await expect(board).not.toHaveAttribute('open','');
   const first=advanced.first();await first.locator(':scope>summary').focus();await page.keyboard.press('Enter');await expect(first).toHaveAttribute('open','');const program=workspace.getByRole('region',{name:'Programmonitor'});await expect(program).toBeVisible();await expect(workspace.getByRole('button',{name:'TAKE',exact:true})).toBeVisible();await noOverflow(page);
   await first.locator('.rd-monitor-wall').evaluate(node=>node.scrollIntoView({block:'center',behavior:'instant'}));await shot(page,`regie-${width}-advanced`);
   if(width===390){
    // CDP's minimal scroll left 1.08px above the viewport in this nested main.
    // Centre the actual content below the fixed header before visual review.
    const centre=async locator=>{await locator.evaluate(node=>{node.scrollIntoView({block:'center',behavior:'instant'});const bounds=node.getBoundingClientRect();if(bounds.top<80)window.scrollBy({top:bounds.top-80,behavior:'instant'});});await expect(locator).toBeInViewport({ratio:1});await expect.poll(()=>locator.evaluate(node=>node.getBoundingClientRect().top)).toBeGreaterThanOrEqual(60);};
    await centre(program);evidence.mobileProgramGeometry=await program.evaluate(node=>({viewport:{width:innerWidth,height:innerHeight},bounds:node.getBoundingClientRect().toJSON()}));await shot(page,`regie-${width}-advanced-program`);const presenter=workspace.locator('.rd-quick-host');await centre(presenter);await noOverflow(page);await shot(page,`regie-${width}-advanced-presenter`);
   }
   evidence.monitorRatios=await workspace.locator('.rd-monitor-wall .mf-stage-frame').evaluateAll(nodes=>nodes.map(node=>{const bounds=node.getBoundingClientRect();return bounds.width/bounds.height;}));for(const ratio of evidence.monitorRatios)expect(Math.abs(ratio-16/9)).toBeLessThan(.02);
   await first.locator(':scope>summary').focus();await page.keyboard.press('Enter');await expect(first).not.toHaveAttribute('open','');
   // Simulate a server-observed BINGO window in this in-memory fixture only.
   await h.mutate(game=>{game.state.phase='window';game.state.window={id:'qa-regie-window',status:'open',startedAt:Date.now(),endsAt:Date.now()+600000,frozenAt:game.state.drawn.length,announcements:[],claims:[{id:'qa-claim',name:'Sam',ticket:'0001',status:'valid'}]};});
   await expect(workspace.locator('.rd-alert-strip')).toContainText('Meldvenster actief');const review=workspace.locator('.mf-live-bingo>.rd-claims');await expect(review).toContainText('Sam');await expect(timer).toContainText('BINGO-meldvenster');await expect(play).toBeDisabled();
   const order=await workspace.locator('.mf-live-bingo').evaluate(node=>Array.from(node.children).map(child=>child.className));expect(order[0]).toContain('rd-claims');await workspace.locator('.rd-alert-strip').getByRole('button',{name:'Naar controle'}).click();await expect(review).toBeInViewport({ratio:1});await noOverflow(page);await shot(page,`regie-${width}-bingo`);
   const writesBeforeBlockedKeys=evidence.mutations.length;await main.focus();await page.keyboard.press('n');await expect(page.getByText('Rond eerst het meldvenster of de uitslag af.',{exact:true})).toBeVisible();await main.focus();await page.keyboard.press('Space');await expect(page.getByText('Het meldvenster of de uitslag houdt de show nog stil.',{exact:true})).toBeVisible();expect(evidence.mutations).toHaveLength(writesBeforeBlockedKeys);evidence.blockedKeysPreserveBingoWindow=true;
   const saved=await h.read();expect(saved.state.drawn).toEqual([7,13,19,24,31,41]);expect(saved.state.lastCommit.number).toBe(41);expect(evidence.mutations.some(item=>item.path.endsWith('/pause')&&item.body.restartClock===true&&item.status===200)).toBe(true);expect(evidence.mutations.every(item=>item.status===200)).toBe(true);expect(evidence.errors).toEqual([]);expect(evidence.external).toEqual([]);expect(evidence.unexpected).toEqual([]);expect(evidence.forbiddenWrites).toEqual([]);
   evidence.layout=await essentials.evaluate(node=>({bounds:node.getBoundingClientRect().toJSON(),labels:Array.from(node.querySelectorAll(':scope>div>span')).map(label=>({text:label.textContent,size:getComputedStyle(label).fontSize}))}));evidence.bingoOrder=order;
  }finally{
   await mkdir(output,{recursive:true});await writeFile(output+`/regie-${width}.json`,JSON.stringify({observedAt:new Date().toISOString(),viewport:page.viewportSize(),actualBrowserRendering:true,realBingoHandlers:true,actualHandlerScope:['reads','heartbeat','pause'],syntheticBingoWindow:true,actualClaimValidation:false,inMemoryFixtureWritesOnly:true,actualAccountWrites:false,actualProviderRequests:false,actualOBSInstallation:false,...evidence},null,2)+'\n');await page.close();await h.close();
  }
 });
}

test('regie refresh preserves the separate Vlampie console and all seven modules',async({page},testInfo)=>{
 await page.setViewportSize({width:1366,height:900});await page.emulateMedia({reducedMotion:'reduce'});await page.addInitScript(()=>localStorage.setItem('mf-production','vlampie'));
 const h=await fixture(page,testInfo);
 try{
  await page.goto('/#/live');await expect(page.locator('body')).toHaveAttribute('data-brand','vlampie');const workspace=page.locator('.rd-workspace');await expect(workspace).toBeVisible();
  await expect(workspace.locator('.mf-live-essentials,.mf-live-advanced')).toHaveCount(0);await expect(workspace.getByRole('button',{name:'Volgende bal',exact:false})).toBeVisible();await expect(workspace.getByRole('button',{name:'Pauzeren',exact:true})).toBeVisible();await expect(workspace.getByRole('button',{name:'TAKE',exact:true})).toBeVisible();
  await expect(workspace.locator('[data-module-id]')).toHaveCount(7);const modules=[];
  for(const control of await workspace.locator('[data-module-id]').all()){
   const id=await control.getAttribute('data-module-id');await control.click();await expect(workspace.locator(`[data-panel-id="${id}"]`)).toBeVisible();modules.push(id);await noOverflow(page);
  }
  await top(page);await shot(page,'vlampie-1366-preserved');h.evidence.modules=modules;
  h.evidence.styles=await workspace.evaluate(node=>Object.fromEntries(['.rd-console-status','.rd-monitor-wall','.rd-program','.rd-transport','.rd-quick-host','.rd-section'].map(selector=>{const element=node.querySelector(selector),style=getComputedStyle(element);return [selector,Object.fromEntries(['display','fontSize','color','backgroundColor','borderRadius','padding','gap','gridTemplateColumns'].map(property=>[property,style[property]]))];})));
  expect(h.evidence.errors).toEqual([]);expect(h.evidence.external).toEqual([]);expect(h.evidence.unexpected).toEqual([]);expect(h.evidence.forbiddenWrites).toEqual([]);expect(h.evidence.mutations).toEqual([]);
 }finally{
  await mkdir(output,{recursive:true});await writeFile(output+'/vlampie-1366.json',JSON.stringify({observedAt:new Date().toISOString(),viewport:page.viewportSize(),actualBrowserRendering:true,actualAccountWrites:false,actualProviderRequests:false,...h.evidence},null,2)+'\n');await page.close();await h.close();
 }
});
