import {test,expect} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {CHARACTERS} from '../../server/characters.js';
import {makeGame} from '../../server/bingo-model.js';
import {listMailTemplates} from '../../server/mail-templates.js';
import {defaultPresentation} from '../../server/presentation-model.js';

// This covers the saved-show branch missed by the rehearsal-only browser tour.
// Next/React/assets are real. Auth and every API response are explicit browser
// transport fixtures; no actual account, provider or backend write is tested.
const output=process.env.REGIE_SETTINGS_EVIDENCE_ROOT||'verification/regie-settings/browser';
const loadError='Je mailtemplates konden niet worden geladen';
const sandboxError="Blocked script execution in 'about:srcdoc' because the document's frame is sandboxed and the 'allow-scripts' permission is not set.";
const providerUrl='wss://qa-regie-settings.livekit.cloud';

async function simulatedSavedShow(page,testInfo){
 const origin=new URL(testInfo.project.use.baseURL).origin;
 const game=makeGame({brandId:'milo',title:'QA opgeslagen show',date:'2027-11-18T13:30',timeZone:'Europe/Amsterdam',roundCount:1},'qa-browser-regie',origin);
 game.revision=1;
 const templates=listMailTemplates('milo').map(template=>({...template,...(template.id==='auth-code'?{editable:false}:{})}));
 expect(templates).toHaveLength(17);
 const mail={brandId:'milo',revision:'qa-mail-1',settings:{newsletterEnabled:true},templates,campaigns:[],outbox:[],audience:{subscribed:0,total:0},provider:{configured:false,from:'organisatie@example.invalid',canManage:false,marketingAvailable:false}};
 const openai={configured:true,canManage:true,source:'environment',environmentConfigured:true,revision:'qa-openai-1',connectionTest:null,liveVerified:false};
 const livekit={configured:true,canManage:true,source:'environment',environmentConfigured:true,url:providerUrl,apiKeyConfigured:true,secretConfigured:true,revision:'qa-livekit-1',connectionTest:null};
 // The browser fixture obeys the native redacted response contract. These
 // assertions do not claim that a real provider credential was exercised.
 for(const status of [openai,livekit])for(const key of ['key','apiKey','apiSecret','OPENAI_API_KEY','LIVEKIT_API_KEY','LIVEKIT_API_SECRET'])expect(status).not.toHaveProperty(key);
 const proof={origin,gameId:game.id,requestedMailState:0,requestedSavedGame:0,gets:{},mailResponses:[],errors:[],external:[],writes:[],unexpected:[],expectedSandboxScriptBlocks:[],expectedMailLoadConsoleErrors:[]};
 page.setDefaultTimeout(10000);
 page.on('pageerror',error=>proof.errors.push(error.message));
 page.on('console',message=>{
  if(message.type()!=='error')return;
  const text=message.text(),location=message.location().url;
  if(location==='about:srcdoc'&&text===sandboxError){proof.expectedSandboxScriptBlocks.push(text);return;}
  let url;try{url=new URL(location);}catch{}
  if(url?.origin===origin&&url.pathname==='/api/mail/state'&&/^Failed to load resource: the server responded with a status of 503 \(Service Unavailable\)$/.test(text)){
   proof.expectedMailLoadConsoleErrors.push(text);return;
  }
  proof.errors.push({text,location});
 });
 await page.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.origin!==origin){proof.external.push(url.origin+url.pathname);return route.abort('blockedbyclient');}
  if(url.pathname==='/favicon.ico')return route.fulfill({status:204});
  if(!url.pathname.startsWith('/api/')&&!url.pathname.startsWith('/auth/'))return route.continue();
  if(request.method()!=='GET'){
   proof.writes.push({path:url.pathname,method:request.method()});
   return route.fulfill({status:403,json:{error:{message:'Browser QA blocks every backend write.'}}});
  }
  proof.gets[url.pathname]=(proof.gets[url.pathname]||0)+1;
  let body;
  if(url.pathname==='/api/auth/session')body={authenticated:true,user:'qa-browser-regie',email:'regie@example.test',role:'regie',local:false,configured:true,localAvailable:false};
  else if(url.pathname==='/api/bingo/games')body={games:[{id:game.id,brandId:game.brandId,title:game.title,status:game.status,date:game.date,timeZone:game.timeZone,roundCount:1,bookCount:0}]};
  else if(url.pathname==='/api/bingo/games/'+game.id){proof.requestedSavedGame++;body={game,serverTime:Date.now()};}
  else if(url.pathname===`/api/bingo/games/${game.id}/chat`||url.pathname===`/api/bingo/games/${game.id}/chat/stream`){
   const self={memberId:'qa-browser-chat-host',role:'host',mutedUntil:0,canSend:true,reason:'',profiles:[]};
   body={...(url.searchParams.has('after')?{events:[]}:{messages:[]}),cursor:0,hasMore:false,self,serverTime:Date.now()};
   if(url.pathname.endsWith('/stream'))return route.fulfill({body:`event: sync\ndata: ${JSON.stringify({...body,reconnect:true})}\n\n`,headers:{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'private, no-store'}});
  }
  else if(url.pathname===`/api/bingo/games/${game.id}/chat/members`)body={members:[],serverTime:Date.now()};
  else if(url.pathname==='/api/mail/state'&&url.searchParams.get('brand')==='milo'){
   proof.requestedMailState++;
   if(proof.requestedMailState===1){proof.mailResponses.push(503);return route.fulfill({status:503,json:{error:{message:'QA: de mailwerkplek is tijdelijk niet bereikbaar.'}},headers:{'Cache-Control':'private, no-store'}});}
   proof.mailResponses.push(200);body=mail;
  }
  else if(url.pathname==='/api/characters')body={characters:Object.values(CHARACTERS),revision:0};
  else if(url.pathname==='/api/openai/status')body=openai;
  else if(url.pathname==='/api/livekit/settings')body=livekit;
  else if(url.pathname==='/api/live-calls'&&url.searchParams.get('role')==='host'&&url.searchParams.get('gameId')===game.id)body={call:null,serverTime:Date.now()};
  else if(url.pathname==='/api/output')body={state:null,serverTime:Date.now()};
  else if(url.pathname==='/api/presentation/document')body={document:defaultPresentation(),revision:0};
  else if(url.pathname==='/api/bingo/families')body={families:[]};
  else {proof.unexpected.push(url.pathname+url.search);return route.fulfill({status:404,json:{error:{message:'Unknown browser QA endpoint.'}}});}
  return route.fulfill({json:body,headers:{'Cache-Control':'private, no-store'}});
 });
 return proof;
}

async function openRoute(page,id){
 await page.evaluate(value=>{location.hash='/'+value;},id);
 await expect(page.locator(`.mf-route-view[data-route="${id}"]`)).toBeVisible();
 await expect(page.getByText('De studio kon niet starten.',{exact:true})).toHaveCount(0);
}
async function noOverflow(page){
 await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth)).toBeLessThanOrEqual(1);
}
async function screenshot(page,width,name){
 await mkdir(output+'/screenshots',{recursive:true});
 await page.screenshot({path:`${output}/screenshots/regie-settings-${width}-${name}.png`,fullPage:false});
}

for(const width of [390,1366]){
 test(`saved-show mail recovery and editable redacted provider settings ${width}px; simulated API`,async({page},testInfo)=>{
  test.setTimeout(90000);
  await page.setViewportSize({width,height:width===390?844:768});
  await page.emulateMedia({reducedMotion:'reduce'});
  const proof=await simulatedSavedShow(page,testInfo);
  try{
   await page.goto('/#/overview');
   const main=page.locator('main#mf-main');await expect(main).toBeVisible();
   await expect(page.locator('.mf-top-show>strong')).toHaveText('QA opgeslagen show');
   await expect(page.locator('.mf-top-show')).not.toContainText('Oefenstudio');
   expect(proof.requestedSavedGame).toBeGreaterThan(0);
   await openRoute(page,'mail');
   const workspace=main.locator('.cm-workspace');
   await expect(workspace.getByRole('heading',{name:loadError,exact:true})).toBeVisible();
   await expect(workspace.locator('.cm-load-error[role="alert"]')).toBeVisible();
   await expect(workspace.locator('.cm-library,.cm-editor')).toHaveCount(0);
   await expect(workspace.getByText('Geen mail bij deze zoekopdracht',{exact:true})).toHaveCount(0);
   await expect(workspace.getByText('DEMO · geen echte mails',{exact:true})).toHaveCount(0);
   expect(proof.requestedMailState).toBe(1);
   await noOverflow(page);await screenshot(page,width,'mail-load-error');
   const tabs=workspace.getByRole('navigation',{name:'Communicatieonderdelen'});
   await tabs.getByRole('button',{name:'Acties & triggers',exact:true}).click();
   await expect(workspace.getByRole('heading',{name:loadError,exact:true})).toBeVisible();
   await tabs.getByRole('button',{name:'Mailtemplates',exact:true}).click();
   await expect(workspace.getByRole('heading',{name:loadError,exact:true})).toBeVisible();
   expect(proof.requestedMailState).toBe(1);
   await workspace.getByRole('button',{name:'Opnieuw laden',exact:true}).click();
   await expect(workspace.locator('.cm-template-list>button')).toHaveCount(17);
   await expect(workspace.getByRole('heading',{name:loadError,exact:true})).toHaveCount(0);
   expect(proof.requestedMailState).toBe(2);expect(proof.mailResponses).toEqual([503,200]);
   await expect(workspace.locator('.cm-editor>header h2')).toHaveText(templatesName('auth-code'));
   await expect(workspace.locator('.cm-toggle input')).toBeDisabled();
   await workspace.locator('.cm-template-list>button').filter({hasText:'Bingobladen staan klaar'}).click();
   await expect(workspace.locator('.cm-editor>header h2')).toHaveText('Bingobladen staan klaar');
   if(width===390)await workspace.locator('.cm-mobile-switch').getByRole('button',{name:'Voorbeeld',exact:true}).click();
   const preview=workspace.locator('iframe[title="Voorbeeld van de mail met fictieve gegevens"]');
   await preview.scrollIntoViewIfNeeded();await expect(preview).toBeVisible();
   await expect(preview).toHaveAttribute('sandbox','');await expect(preview).not.toHaveAttribute('srcdoc',/<script\b/i);
   await expect(preview).toHaveAttribute('srcdoc',/Hallo Danny/);
   await noOverflow(page);await screenshot(page,width,'mail-recovered-preview');

   await openRoute(page,'settings');
   await main.getByRole('button',{name:'AI & stemmen',exact:true}).click();
   const key=main.getByLabel('OpenAI API-sleutel',{exact:false});
   await key.scrollIntoViewIfNeeded();await expect(key).toBeVisible();await expect(key).toHaveAttribute('type','password');await expect(key).toHaveValue('');
   await expect(key).toHaveAttribute('autocomplete','new-password');await expect(key).toBeEditable();
   await expect(main.getByText('De huidige koppeling gebruikt de serverinstellingen.',{exact:false})).toBeVisible();
   await expect(main.getByRole('button',{name:'Sleutel veilig opslaan',exact:true})).toBeDisabled();
   await noOverflow(page);await screenshot(page,width,'openai-environment-editable');

   await main.getByRole('button',{name:'E-mail & bellen',exact:true}).click();
   const livekit=main.locator('.lks-root'),url=livekit.getByLabel('LiveKit-project URL',{exact:false}),apiKey=livekit.getByLabel('LiveKit API-key',{exact:false}),secret=livekit.getByLabel('LiveKit API-secret',{exact:false});
   await url.scrollIntoViewIfNeeded();await expect(url).toBeVisible();await expect(url).toHaveValue(providerUrl);await expect(url).toBeEditable();
   await expect(apiKey).toBeVisible();await expect(apiKey).toHaveValue('');await expect(apiKey).toBeEditable();
   await expect(secret).toBeVisible();await expect(secret).toHaveValue('');await expect(secret).toHaveAttribute('type','password');await expect(secret).toBeEditable();
   await expect(livekit.getByRole('button',{name:'LiveKit-koppeling opslaan',exact:true})).toBeVisible();
   await expect(livekit.getByRole('button',{name:'Test opgeslagen koppeling',exact:true})).toBeEnabled();
   await noOverflow(page);await screenshot(page,width,'livekit-environment-editable');
   expect(proof.gets['/api/auth/session']).toBeGreaterThan(0);
   expect(proof.gets['/api/openai/status']).toBeGreaterThan(0);
   expect(proof.gets['/api/livekit/settings']).toBeGreaterThan(0);
   expect(proof.errors).toEqual([]);expect(proof.external).toEqual([]);expect(proof.writes).toEqual([]);expect(proof.unexpected).toEqual([]);
  }finally{
   await mkdir(output,{recursive:true});
   await writeFile(`${output}/regie-settings-${width}.json`,JSON.stringify({observedAt:new Date().toISOString(),viewport:page.viewportSize(),simulatedAuthAndApiTransport:true,actualAccountOrProviderAcceptance:false,actualBackendWrites:false,savedShowBranch:true,...proof,expectedSandboxScriptBlocks:proof.expectedSandboxScriptBlocks.length},null,2)+'\n');
  }
 });
}
function templatesName(id){return listMailTemplates('milo').find(template=>template.id===id).name;}
