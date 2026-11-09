import {test,expect} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {CHARACTERS} from '../../server/characters.js';
import {makeGame} from '../../server/bingo-model.js';
import {defaultPresentation} from '../../server/presentation-model.js';

// Chromium renders the built application; every account/capability/API below
// is an inert transport fixture. This does not verify a real OBS installation.
const output=process.env.OBS_SOURCE_EVIDENCE_ROOT||'verification/obs-source/browser';
const TOKEN='A'.repeat(43)+'.'+'Q'.repeat(43);
const expiresAt=()=>Date.now()+604800000;
async function saveProof(name,proof){await mkdir(output,{recursive:true});await writeFile(`${output}/${name}.json`,JSON.stringify({observedAt:new Date().toISOString(),actualBrowserRendering:true,simulatedAuthAndApiTransport:true,actualAccountAcceptance:false,actualBackendWrites:false,actualOBSInstallation:false,actualProviderAcceptance:false,...proof},null,2)+'\n');}
async function screenshot(page,name){await mkdir(output+'/screenshots',{recursive:true});await page.screenshot({path:`${output}/screenshots/${name}.png`,fullPage:false});}
async function noOverflow(page){await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth)).toBeLessThanOrEqual(1);}
async function noPersistedCapability(page){expect(await page.evaluate(token=>[localStorage,sessionStorage].some(store=>Object.keys(store).some(key=>String(store.getItem(key)).includes(token))),TOKEN)).toBe(false);}

async function savedShow(page,testInfo){
 const origin=new URL(testInfo.project.use.baseURL).origin,game=makeGame({brandId:'milo',title:'QA OBS-browserbron',date:'2027-11-18T13:30',timeZone:'Europe/Amsterdam',roundCount:1},'qa-browser-regie',origin);game.revision=1;
 let access=null;
 const proof={origin,gameId:game.id,gets:{},fixtureMutations:[],blockedWrites:[],external:[],unexpected:[],errors:[]};
 const state=()=>({gameId:game.id,requestedGameId:game.id,configured:!!access,activeGameId:access?game.id:null,currentAccessId:access?.id||null,expiresAt:access?.expiresAt||null,expired:false});
 page.on('pageerror',error=>proof.errors.push(error.message));page.on('console',message=>{if(message.type()==='error')proof.errors.push({text:message.text(),location:message.location().url});});
 await page.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.origin!==origin){proof.external.push(url.origin+url.pathname);return route.abort('blockedbyclient');}
  if(url.pathname==='/favicon.ico')return route.fulfill({status:204});
  if(!url.pathname.startsWith('/api/')&&!url.pathname.startsWith('/auth/'))return route.continue();
  if(request.method()==='POST'&&url.pathname==='/api/obs/access'){
   const body=request.postDataJSON();expect(body.gameId).toBe(game.id);expect(body.expectedAccessId).toBe(access?.id||null);expect(request.headers()['x-milo-obs-manage']).toBe('1');
   proof.fixtureMutations.push({method:'POST',path:url.pathname,action:body.action,gameId:body.gameId,expectedAccessId:body.expectedAccessId});
   if(body.action==='create')access={id:'qa-obs-capability',expiresAt:expiresAt()};else if(body.action==='revoke')access=null;else throw Error('Unexpected OBS fixture mutation');
   return route.fulfill({json:{...state(),...(body.action==='create'?{token:TOKEN}:{})}});
  }
  if(request.method()!=='GET'){proof.blockedWrites.push({path:url.pathname,method:request.method()});return route.fulfill({status:403,json:{error:{message:'Browser QA blocks every other backend write.'}}});}
  proof.gets[url.pathname]=(proof.gets[url.pathname]||0)+1;let body;
  if(url.pathname==='/api/auth/session')body={authenticated:true,user:'qa-browser-regie',email:'regie@example.test',role:'regie',local:false,configured:true,localAvailable:false};
  else if(url.pathname==='/api/bingo/games')body={games:[{id:game.id,brandId:game.brandId,title:game.title,status:game.status,date:game.date,timeZone:game.timeZone,roundCount:1,bookCount:0}]};
  else if(url.pathname===`/api/bingo/games/${game.id}`)body={game,serverTime:Date.now()};
  else if(url.pathname===`/api/bingo/games/${game.id}/chat`||url.pathname===`/api/bingo/games/${game.id}/chat/stream`){
   body={...(url.searchParams.has('after')?{events:[]}:{messages:[]}),cursor:0,hasMore:false,self:{memberId:'qa-host',role:'host',canSend:true,mutedUntil:0,reason:'',profiles:[]},serverTime:Date.now()};
   if(url.pathname.endsWith('/stream'))return route.fulfill({body:`event: sync\ndata: ${JSON.stringify({...body,reconnect:true})}\n\n`,headers:{'Content-Type':'text/event-stream; charset=utf-8'}});
  }else if(url.pathname===`/api/bingo/games/${game.id}/chat/members`)body={members:[],serverTime:Date.now()};
  else if(url.pathname==='/api/characters')body={characters:Object.values(CHARACTERS),revision:0};
  else if(url.pathname==='/api/openai/status'||url.pathname==='/api/livekit/settings')body={configured:false,canManage:true,source:'none',environmentConfigured:false,revision:null};
  else if(url.pathname==='/api/live-calls')body={call:null,serverTime:Date.now()};
  else if(url.pathname==='/api/output')body={state:null,serverTime:Date.now()};
  else if(url.pathname==='/api/presentation/document')body={document:defaultPresentation(),revision:0};
  else if(url.pathname==='/api/bingo/families')body={families:[]};
  else if(url.pathname==='/api/obs/access'){expect(url.searchParams.get('gameId')).toBe(game.id);body=state();}
  else {proof.unexpected.push(url.pathname+url.search);return route.fulfill({status:404,json:{error:{message:'Unknown OBS browser QA endpoint.'}}});}
  return route.fulfill({json:body,headers:{'Cache-Control':'private, no-store'}});
 });return {proof,origin,game};
}

for(const width of [390,1366])test(`saved-show OBS link management is explicit and revocable ${width}px; simulated API`,async({page},testInfo)=>{
 test.setTimeout(90000);await page.setViewportSize({width,height:width===390?844:768});await page.emulateMedia({reducedMotion:'reduce'});
 const {proof,origin,game}=await savedShow(page,testInfo);
 try{
  await page.goto('/#/studio');await expect(page.locator('.mf-top-show>strong')).toHaveText('QA OBS-browserbron');
  const card=page.locator('.mf-panel').filter({has:page.getByRole('heading',{name:'OBS-browserbron',exact:true})});
  await expect(card).toBeVisible();expect(proof.gets['/api/obs/access']||0).toBe(0);
  await card.getByRole('button',{name:'OBS-link beheren',exact:true}).click();await expect(card.getByRole('button',{name:'OBS-link maken',exact:true})).toBeVisible();expect(proof.gets['/api/obs/access']).toBe(1);expect(proof.fixtureMutations).toEqual([]);
  await card.scrollIntoViewIfNeeded();await noOverflow(page);await screenshot(page,`obs-manage-${width}-initial`);
  await card.getByRole('button',{name:'OBS-link maken',exact:true}).click();const link=card.getByLabel('OBS-browserbron URL',{exact:false});
  await expect(link).toHaveValue(origin+'/uitzending#obs='+TOKEN);await expect(link).toHaveAttribute('readonly','');await expect(card.getByRole('button',{name:'OBS-link kopiëren',exact:true})).toBeVisible();expect(proof.fixtureMutations).toHaveLength(1);expect(proof.fixtureMutations[0].gameId).toBe(game.id);
  await noPersistedCapability(page);await noOverflow(page);await link.scrollIntoViewIfNeeded();await screenshot(page,`obs-manage-${width}-created`);
  await card.getByRole('button',{name:'Nieuwe OBS-link maken',exact:true}).click();await expect(card.getByRole('group',{name:'OBS-link wijzigen bevestigen'})).toBeVisible();expect(proof.fixtureMutations).toHaveLength(1);await card.getByRole('button',{name:'Annuleren',exact:true}).click();
  await card.getByRole('button',{name:'OBS-link intrekken',exact:true}).click();expect(proof.fixtureMutations).toHaveLength(1);await card.getByRole('button',{name:'Bevestigen',exact:true}).click();
  await expect(link).toHaveCount(0);await expect(card.getByRole('button',{name:'OBS-link maken',exact:true})).toBeVisible();expect(proof.fixtureMutations.map(entry=>entry.action)).toEqual(['create','revoke']);
  await noPersistedCapability(page);expect(proof.blockedWrites).toEqual([]);expect(proof.external).toEqual([]);expect(proof.unexpected).toEqual([]);expect(proof.errors).toEqual([]);
 }finally{await saveProof(`obs-manage-${width}`,proof);}
});

test('OBS output capability bypasses Google, uses only scoped transport and clears immediately on revocation; simulated API',async({page},testInfo)=>{
 test.setTimeout(90000);await page.setViewportSize({width:1920,height:1080});const origin=new URL(testInfo.project.use.baseURL).origin,gameId='qa-obs-output-show';let revoked=false,outputState=null;
 const proof={origin,gameId,sessionRequests:0,outputGets:0,heartbeats:[],callGets:0,denied:0,unexpected:[],external:[],errors:[],expectedDeniedConsoleErrors:[],audioActivation:'pending'};
 await page.addInitScript(()=>{window.__qaAudioContexts=[];const Native=window.AudioContext;if(Native)window.AudioContext=class extends Native{constructor(...args){super(...args);window.__qaAudioContexts.push(this);}};});
 page.on('pageerror',error=>proof.errors.push(error.message));page.on('console',message=>{if(message.type()!=='error')return;const text=message.text(),url=message.location().url;if(url.startsWith(origin+'/api/obs/')&&/^Failed to load resource: the server responded with a status of 401/.test(text))proof.expectedDeniedConsoleErrors.push(text);else proof.errors.push({text,url});});
 await page.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());if(url.origin!==origin){proof.external.push(url.origin+url.pathname);return route.abort('blockedbyclient');}
  if(url.pathname==='/favicon.ico')return route.fulfill({status:204});if(!url.pathname.startsWith('/api/')&&!url.pathname.startsWith('/auth/'))return route.continue();
  expect(request.headers()['x-milo-obs-token']).toBe(TOKEN);
  if(revoked){proof.denied++;return route.fulfill({status:401,json:{error:{message:'De OBS-link is ingetrokken.',code:'obs_access_denied'}}});}
  if(url.pathname==='/api/obs/session'){proof.sessionRequests++;return route.fulfill({json:{authenticated:true,role:'output',gameId,expiresAt:expiresAt()}});}
  if(url.pathname==='/api/obs/output'){
   if(request.method()==='POST'){const body=request.postDataJSON();expect(body.action).toBe('output-heartbeat');proof.heartbeats.push({action:body.action,audioReady:body.audioReady,generation:body.generation,seq:body.seq});outputState={id:body.clientId,until:Date.now()+15000,audioReady:body.audioReady,generation:body.generation,seq:body.seq};}else proof.outputGets++;
   return route.fulfill({json:{serverTime:Date.now(),state:{producer:{id:'qa-producer',generation:1,instanceId:'qa-instance'},generation:1,seq:1,publishedAt:Date.now(),snapshot:{production:'milo',gameId,gameTitle:'QA OBS-uitzending',hostId:'milo',speakerId:'milo',camera:'host',motion:'idle',paused:false},show:{scene:'host',title:'QA OBS-uitzending'},output:outputState,routing:true,mixer:{voice:100,music:25,effects:50},events:[],voice:null}}});
  }
  if(url.pathname==='/api/obs/live-calls'&&request.method()==='GET'){expect(url.searchParams.get('role')).toBe('output');proof.callGets++;return route.fulfill({json:{call:null,serverTime:Date.now()}});}
  proof.unexpected.push({path:url.pathname,method:request.method()});return route.fulfill({status:403,json:{error:{message:'Unexpected OBS fixture endpoint.'}}});
 });
 try{
  await page.goto('/uitzending#obs='+TOKEN);await expect(page.locator('#stage')).toBeVisible();await expect(page.getByRole('link',{name:'Terug naar de regie',exact:true})).toHaveCount(0);
  await expect.poll(async()=>proof.heartbeats.some(entry=>entry.audioReady)||await page.locator('.output-unlock small').textContent().then(text=>text.includes('Geluid is nog geblokkeerd'))).toBe(true);
  if(!proof.heartbeats.some(entry=>entry.audioReady)){proof.audioActivation='real Chromium autoplay blocked; explicit interaction fallback';await page.getByRole('button',{name:'Beeld & geluid activeren',exact:true}).click();}else proof.audioActivation='real Chromium autoplay permitted';
  await expect.poll(()=>proof.heartbeats.some(entry=>entry.audioReady)).toBe(true);expect(await page.evaluate(()=>window.__qaAudioContexts.some(context=>context.state==='running'))).toBe(true);
  await expect(page.locator('.output-unlock')).toBeHidden();await expect.poll(()=>proof.callGets).toBeGreaterThan(0);await noPersistedCapability(page);await screenshot(page,'obs-output-1920-active');
  revoked=true;await expect.poll(()=>proof.denied).toBeGreaterThan(0);await expect(page.locator('.output-unlock')).toBeVisible();await expect(page.locator('.output-unlock small')).not.toContainText('[object Object]');
  await expect(page).toHaveURL(/\/uitzending#obs=/);expect(proof.sessionRequests).toBe(1);expect(proof.unexpected).toEqual([]);expect(proof.external).toEqual([]);expect(proof.errors).toEqual([]);await noPersistedCapability(page);await screenshot(page,'obs-output-1920-revoked');
 }finally{await saveProof('obs-output-1920',proof);}
});

test('invalid OBS source stays on a clear retry screen without Google or regie session authority; simulated API',async({page},testInfo)=>{
 const origin=new URL(testInfo.project.use.baseURL).origin,proof={origin,sessionRequests:0,otherApi:[],external:[]};
 await page.route('**/*',async route=>{const url=new URL(route.request().url());if(url.origin!==origin){proof.external.push(url.origin+url.pathname);return route.abort('blockedbyclient');}if(url.pathname==='/api/obs/session'){proof.sessionRequests++;return route.fulfill({status:401,json:{error:{message:'De OBS-link is verlopen.'}}});}if(url.pathname.startsWith('/api/')||url.pathname.startsWith('/auth/')){proof.otherApi.push(url.pathname);return route.fulfill({status:403,json:{error:{message:'No regie session allowed in OBS QA.'}}});}return route.continue();});
 try{
  await page.goto('/uitzending#obs=invalid-fixture');await expect(page.locator('.app-loading [role="alert"]')).toContainText('De OBS-link is ongeldig of onvolledig.');expect(proof.sessionRequests).toBe(0);await expect(page.getByRole('button',{name:'Opnieuw controleren',exact:true})).toBeVisible();
  await page.goto('/uitzending#obs='+TOKEN);await page.reload();await expect(page.locator('.app-loading [role="alert"]')).toContainText('De OBS-link kon niet worden gecontroleerd.');expect(proof.sessionRequests).toBe(1);await page.getByRole('button',{name:'Opnieuw controleren',exact:true}).click();await expect.poll(()=>proof.sessionRequests).toBe(2);
  await expect(page.locator('#stage')).toHaveCount(0);expect(proof.otherApi).toEqual([]);expect(proof.external).toEqual([]);await noPersistedCapability(page);await expect(page.locator('.app-loading [role="alert"]')).not.toContainText(TOKEN);await screenshot(page,'obs-output-invalid-retry');
 }finally{await saveProof('obs-output-invalid',proof);}
});
