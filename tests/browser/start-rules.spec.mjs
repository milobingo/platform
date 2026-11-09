import {test,expect} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {CHARACTERS} from '../../server/characters.js';
import {makeGame} from '../../server/bingo-model.js';
import {bindingRules,publishGameRules,rulesContract} from '../../server/game-rules.js';
import {defaultPresentation} from '../../server/presentation-model.js';

// Next, React and the saved-show UI run in Chromium. Auth and API transport
// are explicit fixtures: clicking Publish never publishes a real user's rules.
const output=process.env.START_RULES_EVIDENCE_ROOT||'verification/rules-start/browser';

async function simulatedSavedShow(page,testInfo){
 const origin=new URL(testInfo.project.use.baseURL).origin;
 const game=makeGame({brandId:'milo',title:'QA opgeslagen show met startregels',date:'2027-11-18T13:30',timeZone:'Europe/Amsterdam',roundCount:1},'qa-browser-regie',origin);
 game.revision=1;
 const publishPath=`/api/bingo/games/${game.id}/publish-rules`;
 const proof={origin,gameId:game.id,publishPath,requestedSavedGame:0,gets:{},fixturePublications:[],blockedWrites:[],external:[],unexpected:[],errors:[]};
 page.setDefaultTimeout(10000);
 page.on('pageerror',error=>proof.errors.push(error.message));
 page.on('console',message=>{if(message.type()==='error')proof.errors.push({text:message.text(),location:message.location().url});});
 await page.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.origin!==origin){proof.external.push(url.origin+url.pathname);return route.abort('blockedbyclient');}
  if(url.pathname==='/favicon.ico')return route.fulfill({status:204});
  if(!url.pathname.startsWith('/api/')&&!url.pathname.startsWith('/auth/'))return route.continue();
  if(request.method()==='POST'&&url.pathname===publishPath){
   const body=request.postDataJSON();
   proof.fixturePublications.push({path:url.pathname,method:request.method(),regieHeader:request.headers()['x-vlampie-bingo']==='1',requestIdPresent:typeof body.requestId==='string'&&body.requestId.length>0,regieIdPresent:typeof body.regieId==='string'&&body.regieId.length>0});
   publishGameRules(game);game.revision++;
   return route.fulfill({json:{game:structuredClone(game),serverTime:Date.now()},headers:{'Cache-Control':'private, no-store'}});
  }
  if(request.method()!=='GET'){
   proof.blockedWrites.push({path:url.pathname,method:request.method()});
   return route.fulfill({status:403,json:{error:{message:'Browser QA blocks every other backend write.'}}});
  }
  proof.gets[url.pathname]=(proof.gets[url.pathname]||0)+1;
  let body;
  if(url.pathname==='/api/auth/session')body={authenticated:true,user:'qa-browser-regie',email:'regie@example.test',role:'regie',local:false,configured:true,localAvailable:false};
  else if(url.pathname==='/api/bingo/games')body={games:[{id:game.id,brandId:game.brandId,title:game.title,status:game.status,date:game.date,timeZone:game.timeZone,roundCount:1,bookCount:0}]};
  else if(url.pathname===`/api/bingo/games/${game.id}`){proof.requestedSavedGame++;body={game:structuredClone(game),serverTime:Date.now()};}
  else if(url.pathname===`/api/bingo/games/${game.id}/chat`||url.pathname===`/api/bingo/games/${game.id}/chat/stream`){
   const self={memberId:'qa-browser-chat-host',role:'host',mutedUntil:0,canSend:true,reason:'',profiles:[]};
   body={...(url.searchParams.has('after')?{events:[]}:{messages:[]}),cursor:0,hasMore:false,self,serverTime:Date.now()};
   if(url.pathname.endsWith('/stream'))return route.fulfill({body:`event: sync\ndata: ${JSON.stringify({...body,reconnect:true})}\n\n`,headers:{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'private, no-store'}});
  }
  else if(url.pathname===`/api/bingo/games/${game.id}/chat/members`)body={members:[],serverTime:Date.now()};
  else if(url.pathname==='/api/characters')body={characters:Object.values(CHARACTERS),revision:0};
  else if(url.pathname==='/api/openai/status')body={configured:false,canManage:true,source:'none',environmentConfigured:false,revision:null};
  else if(url.pathname==='/api/livekit/settings')body={configured:false,canManage:true,source:'none',environmentConfigured:false,revision:null};
  else if(url.pathname==='/api/live-calls'&&url.searchParams.get('role')==='host'&&url.searchParams.get('gameId')===game.id)body={call:null,serverTime:Date.now()};
  else if(url.pathname==='/api/output')body={state:null,serverTime:Date.now()};
  else if(url.pathname==='/api/presentation/document')body={document:defaultPresentation(),revision:0};
  else if(url.pathname==='/api/bingo/families')body={families:[]};
  else {proof.unexpected.push(url.pathname+url.search);return route.fulfill({status:404,json:{error:{message:'Unknown browser QA endpoint.'}}});}
  return route.fulfill({json:body,headers:{'Cache-Control':'private, no-store'}});
 });
 return {proof,game};
}

async function openStartCheck(page){
 await expect(page.locator('.mf-top-show>strong')).toHaveText('QA opgeslagen show met startregels');
 await expect(page.locator('.mf-top-show')).not.toContainText('Oefenstudio');
 await expect(page.locator('.mf-route-view[data-route="script"]')).toBeVisible();
 await page.getByRole('tab',{name:'Startcheck',exact:true}).click();
 return page.locator('[data-check="rules"]');
}
async function noOverflow(page){
 await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth)).toBeLessThanOrEqual(1);
}
async function screenshot(page,width,name){
 await mkdir(output+'/screenshots',{recursive:true});
 await page.screenshot({path:`${output}/screenshots/start-rules-${width}-${name}.png`,fullPage:false});
}

for(const width of [390,1366]){
 test(`saved-show startcheck publishes and retains explicit show rules ${width}px; simulated API`,async({page},testInfo)=>{
  test.setTimeout(90000);
  await page.setViewportSize({width,height:width===390?844:768});
  await page.emulateMedia({reducedMotion:'reduce'});
  const {proof,game}=await simulatedSavedShow(page,testInfo);
  try{
   await page.goto('/#/script');
   const rules=await openStartCheck(page),main=page.locator('main#mf-main');
   expect(proof.requestedSavedGame).toBeGreaterThan(0);
   await expect(rules).toHaveAttribute('data-status','blocked');
   await expect(rules.getByText('Blokkeert start',{exact:true})).toBeVisible();
   await expect(rules.getByText('De spelregels voor deze show zijn nog niet gepubliceerd. Bekijk ze en kies Publiceer spelregels.',{exact:true})).toBeVisible();
   const publish=rules.getByRole('button',{name:'Publiceer spelregels',exact:true});
   await expect(publish).toBeVisible();await expect(publish).toBeEnabled();
   await expect(main.locator('.mf-editor-actions').getByRole('button',{name:/Publiceer.*spelregels/})).toHaveCount(0);
   await expect(main.getByRole('button',{name:'Start de show',exact:true})).toBeDisabled();
   expect(proof.fixturePublications).toEqual([]);
   await rules.scrollIntoViewIfNeeded();await noOverflow(page);await screenshot(page,width,'unpublished-action');

   await rules.locator('summary').filter({hasText:'Spelregels bekijken'}).click();
   const articles=rules.locator('.mf-start-rules details article');
   const generatedRules=bindingRules(rulesContract(game));expect(generatedRules).toHaveLength(9);
   await expect(articles).toHaveCount(9);
   for(const [index,rule] of generatedRules.entries()){
    await expect(articles.nth(index).getByRole('heading',{name:rule.title,exact:true})).toBeVisible();
    await expect(articles.nth(index).locator('p')).toHaveText(rule.text);
   }
   await noOverflow(page);
   await rules.locator('summary').filter({hasText:'Spelregels bekijken'}).click();
   expect(proof.fixturePublications).toEqual([]);

   await publish.click();
   await expect(rules).toHaveAttribute('data-status','ready');
   await expect(rules.getByText('Gereed',{exact:true})).toBeVisible();
   await expect(rules.getByText('Versie 1 is gepubliceerd en hoort bij deze voorbereiding.',{exact:true})).toBeVisible();
   const publishedLink=rules.getByRole('link',{name:'Bekijk gepubliceerde regels · versie 1',exact:true});
   await expect(publishedLink).toHaveAttribute('href','/spelregels?spel='+encodeURIComponent(game.id));
   await expect(publishedLink).toHaveAttribute('target','_blank');
   await expect(publishedLink).toHaveAttribute('rel','noopener noreferrer');
   await expect(rules.getByRole('button',{name:/Publiceer.*spelregels/})).toHaveCount(0);
   await expect(rules.locator('details')).toHaveCount(0);
   await expect(main.getByRole('button',{name:'Start de show',exact:true})).toBeDisabled();
   expect(proof.fixturePublications).toEqual([{path:proof.publishPath,method:'POST',regieHeader:true,requestIdPresent:true,regieIdPresent:true}]);
   await rules.scrollIntoViewIfNeeded();await noOverflow(page);await screenshot(page,width,'published-ready');

   const readsBeforeReload=proof.requestedSavedGame;
   await page.reload();
   const reloadedRules=await openStartCheck(page);
   await expect(reloadedRules).toHaveAttribute('data-status','ready');
   await expect(reloadedRules.getByRole('link',{name:'Bekijk gepubliceerde regels · versie 1',exact:true})).toHaveAttribute('href','/spelregels?spel='+encodeURIComponent(game.id));
   await expect(reloadedRules.getByRole('button',{name:/Publiceer.*spelregels/})).toHaveCount(0);
   expect(proof.requestedSavedGame).toBeGreaterThan(readsBeforeReload);
   expect(proof.fixturePublications).toHaveLength(1);
   expect(game.rulesPublication.version).toBe(1);
   expect(proof.blockedWrites).toEqual([]);expect(proof.external).toEqual([]);expect(proof.unexpected).toEqual([]);expect(proof.errors).toEqual([]);
   await reloadedRules.scrollIntoViewIfNeeded();await noOverflow(page);await screenshot(page,width,'reload-ready');
  }finally{
   await mkdir(output,{recursive:true});
   await writeFile(`${output}/start-rules-${width}.json`,JSON.stringify({observedAt:new Date().toISOString(),viewport:page.viewportSize(),simulatedAuthAndApiTransport:true,actualUserRulesPublication:false,actualBackendWrites:false,actualProviderAcceptance:false,savedShowBranch:true,...proof},null,2)+'\n');
  }
 });
}
