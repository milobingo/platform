import {test,expect} from '@playwright/test';
import {mkdir,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {createStorageEnvironment} from '../../server/node-storage.js';
import {dispatchNodeRequest} from '../../server/node-runtime.js';
import {readPrivateSetting} from '../../server/secrets.js';
import {CHARACTERS} from '../../server/characters.js';
import {makeGame} from '../../server/bingo-model.js';
import {listMailTemplates} from '../../server/mail-templates.js';
import {defaultPresentation} from '../../server/presentation-model.js';

// This covers the saved-show branch missed by the rehearsal-only browser tour.
// Next/React/assets are real. Resend management uses the native HTTP adapter,
// actual SQLite regie roles, local object CAS and AES-GCM storage. Auth and the
// Resend domain endpoint are explicit transport fixtures; no real account,
// remote database or mail provider receives a write. Other APIs remain fixtures.
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
 const directory=await mkdtemp(join(tmpdir(),'milo-browser-provider-')),storage=await createStorageEnvironment({SQLITE_PATH:join(directory,'app.sqlite'),OBJECT_STORAGE_PATH:join(directory,'objects')});
 const user={id:'qa-browser-regie',email:'regie@example.test'},syntheticKey='re_BROWSER_FIXTURE_'+randomBytes(18).toString('hex');
 const providerState={failNextSave:true,failNextRead:false,lastStatus:null};
 const env={...storage,NODE_ENV:origin.startsWith('https:')?'production':'test',APP_URL:origin,SUPABASE_URL:'https://qa-provider.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_browser_fixture',VLAMPIE_SETTINGS_KEY:randomBytes(32).toString('hex'),MAIL_ENVIRONMENT:'staging'};
 await env.DB.prepare('INSERT INTO app_user_roles (user_id,role) VALUES (?,?)').bind(user.id,'regie').run();
 const actualGet=env.SETTINGS.get.bind(env.SETTINGS),actualPut=env.SETTINGS.put.bind(env.SETTINGS);
 env.SETTINGS.get=async name=>{if(name==='private/native-provider-resend.v1'&&providerState.failNextRead){providerState.failNextRead=false;throw Error('Synthetic private storage read failure');}return actualGet(name);};
 env.SETTINGS.put=async(name,...args)=>{if(name==='private/native-provider-resend.v1'&&providerState.failNextSave){providerState.failNextSave=false;throw Error('Synthetic private storage save failure');}return actualPut(name,...args);};
 // The browser fixture obeys the native redacted response contract. These
 // assertions do not claim that a real provider credential was exercised.
 for(const status of [openai,livekit])for(const key of ['key','apiKey','apiSecret','OPENAI_API_KEY','LIVEKIT_API_KEY','LIVEKIT_API_SECRET'])expect(status).not.toHaveProperty(key);
 const proof={origin,gameId:game.id,requestedMailState:0,requestedSavedGame:0,gets:{},mailResponses:[],errors:[],external:[],writes:[],unexpected:[],expectedSandboxScriptBlocks:[],expectedMailLoadConsoleErrors:[],expectedResendConsoleErrors:[],resendRequests:[],resendStatuses:[],providerRequests:[],forbiddenProviderRequests:[],providerChecks:{},fixtureCleanup:false};
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
  if(url?.origin===origin&&url.pathname==='/api/resend/settings'&&/^Failed to load resource: the server responded with a status of (400|503) /.test(text)){proof.expectedResendConsoleErrors.push(text);return;}
  proof.errors.push({text,location});
 });
 await page.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.origin!==origin){proof.external.push(url.origin+url.pathname);return route.abort('blockedbyclient');}
  if(url.pathname==='/favicon.ico')return route.fulfill({status:204});
  if(!url.pathname.startsWith('/api/')&&!url.pathname.startsWith('/auth/'))return route.continue();
  if(url.pathname==='/api/resend/settings'){
   const method=request.method(),body=method==='GET'?undefined:request.postDataJSON(),headers=request.headers();
   if(method==='GET')proof.gets[url.pathname]=(proof.gets[url.pathname]||0)+1;
   const record={method,action:body?.action||null,keySubmission:body?.key===undefined?'absent':body.key===''?'blank':'replacement',revisionSupplied:body?.revision!==undefined,settingsHeader:headers['x-vlampie-settings']==='1',at:Date.now()};proof.resendRequests.push(record);
   const response=await dispatchNodeRequest(new Request(request.url(),{method,headers,...(body?{body:JSON.stringify(body)}:{})}),{env,authClientFactory:()=>({auth:{getUser:async()=>({data:{user},error:null})}}),providerFetch:async(target,options={})=>{
    const providerUrl=new URL(target),expected=providerUrl.origin==='https://api.resend.com'&&providerUrl.pathname==='/domains'&&options.method==='GET';
    if(!expected){proof.forbiddenProviderRequests.push({origin:providerUrl.origin,path:providerUrl.pathname,method:options.method||'GET'});throw Error('Unexpected provider request forbidden in browser acceptance');}
    const storedKeyUsed=options.headers?.Authorization==='Bearer '+syntheticKey;expect(storedKeyUsed).toBe(true);proof.providerRequests.push({path:providerUrl.pathname,method:options.method,storedKeyUsed,simulatedProvider:true});
    return Response.json({data:[{id:'fixture-domain',name:'example.test',status:'verified'}],has_more:false});
   }});
   const text=await response.text();record.status=response.status;record.completedAt=Date.now();
   expect(text.includes(syntheticKey)).toBe(false);expect(text.includes(env.VLAMPIE_SETTINGS_KEY)).toBe(false);expect(response.headers.get('cache-control')).toMatch(/no-store/);
   if(response.ok){const data=JSON.parse(text);expect(['key','apiKey','apiSecret','credentials','RESEND_API_KEY'].some(name=>name in data)).toBe(false);providerState.lastStatus=data;proof.resendStatuses.push({method,action:record.action,configured:data.configured,keyConfigured:data.keyConfigured,source:data.source,disabled:data.disabled,revision:data.revision,from:data.from,replyTo:data.replyTo,deliveryMode:data.deliveryMode,allowedRecipients:data.allowedRecipients,sendingAllowed:data.sendingAllowed,connectionTest:data.connectionTest,environment:data.environment});}
   return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:text});
  }
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
 return {proof,providerState,syntheticKey,readProtected:()=>readPrivateSetting({...env,NATIVE_PROVIDER_SETTINGS:true},'native-provider-resend'),assertEncrypted:async()=>{const object=await actualGet('private/native-provider-resend.v1'),envelope=await object.json();expect(typeof envelope.iv).toBe('string');expect(typeof envelope.data).toBe('string');expect(JSON.stringify(envelope).includes(syntheticKey)).toBe(false);return object.etag;},close:async()=>{await storage.close();await rm(directory,{recursive:true,force:true});proof.fixtureCleanup=true;}};
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


async function exerciseResend(page,main,h,width){
 const {proof,providerState}=h,card=main.locator('.mf-resend-settings'),key=card.getByLabel('Resend API-sleutel',{exact:false}),from=card.getByLabel('Afzenderadres',{exact:false}),replyTo=card.getByLabel('Antwoordadres',{exact:false}),mode=card.getByLabel('Verzendmodus',{exact:false}),save=card.getByRole('button',{name:'Instellingen en verzendmodus opslaan',exact:true}),test=card.getByRole('button',{name:'Test Resend-koppeling',exact:true});
 await key.scrollIntoViewIfNeeded();await expect(key).toBeVisible();await expect(key).toHaveAttribute('type','password');await expect(key).toHaveAttribute('autocomplete','new-password');await expect(key).toHaveValue('');await expect(key).toBeEditable();
 await expect(from).toHaveValue('');await expect(replyTo).toHaveValue('');await expect(mode).toHaveValue('disabled');await expect(card.locator('option[value=live]')).toHaveAttribute('disabled','');expect(await mode.evaluate(node=>node.querySelector('option[value=live]').disabled)).toBe(true);await expect(test).toBeDisabled();await expect(save).toBeDisabled();await expect(card.getByText('Mailverzending staat uit.',{exact:false})).toBeVisible();
 expect(providerState.lastStatus.configured).toBe(false);expect((await h.readProtected()).value).toBe(null);await noOverflow(page);await screenshot(page,width,'resend-settings-editable');

 // A real protected-store failure must preserve all input and send nothing.
 await key.fill(h.syntheticKey);await from.fill('show@example.test');await replyTo.fill('organisatie@example.test');await save.click();
 await expect(card.getByRole('alert')).toContainText('niet veilig worden bevestigd');expect(await key.inputValue()===h.syntheticKey).toBe(true);await expect(from).toHaveValue('show@example.test');await expect(replyTo).toHaveValue('organisatie@example.test');expect((await h.readProtected()).value).toBe(null);expect(proof.providerRequests).toHaveLength(0);expect(proof.resendRequests.filter(item=>item.action==='save')).toHaveLength(1);await noOverflow(page);await screenshot(page,width,'resend-failed-save-retains-input');
 await save.click();await expect(card.getByRole('alert')).toHaveCount(0);await expect(key).toHaveValue('');await expect(card.getByText('De Resend-koppeling is veilig opgeslagen.',{exact:false})).toBeVisible();await expect(test).toBeEnabled();expect(proof.providerRequests).toHaveLength(0);
 let saved=(await h.readProtected()).value;expect(saved.credentials.key===h.syntheticKey).toBe(true);expect(saved.credentials.from).toBe('show@example.test');expect(saved.credentials.replyTo).toBe('organisatie@example.test');expect(saved.deliveryMode).toBe('disabled');expect(providerState.lastStatus.connectionTest.tested).toBe(false);expect(providerState.lastStatus.sendingAllowed).toBe(false);const firstEtag=await h.assertEncrypted();
 await card.getByRole('button',{name:'Herlaad',exact:true}).click();await expect(key).toHaveValue('');await expect(from).toHaveValue('show@example.test');expect(providerState.lastStatus.keyConfigured).toBe(true);expect(proof.providerRequests).toHaveLength(0);
 await test.click();await expect(card.locator('.mf-badge')).toHaveText('Sleutel gecontroleerd');await expect(card.getByText('Mailverzending staat uit.',{exact:false})).toBeVisible();expect(proof.providerRequests).toHaveLength(1);expect(providerState.lastStatus.connectionTest.tested).toBe(true);expect(providerState.lastStatus.sendingAllowed).toBe(false);await noOverflow(page);await screenshot(page,width,'resend-tested-with-sending-off');

 // Blank credential input preserves the encrypted key while sender edits
 // revoke the previous domain receipt and remain separate from sending.
 await from.fill('nieuwe-show@example.test');await replyTo.fill('antwoord@example.test');await expect(key).toHaveValue('');await save.click();await expect(save).toBeDisabled();await expect(card.locator('.mf-badge')).toHaveText('Opgeslagen · nog testen');saved=(await h.readProtected()).value;expect(saved.credentials.key===h.syntheticKey).toBe(true);expect(saved.credentials.from).toBe('nieuwe-show@example.test');expect(saved.credentials.replyTo).toBe('antwoord@example.test');expect(providerState.lastStatus.connectionTest.tested).toBe(false);expect(proof.providerRequests).toHaveLength(1);expect(await h.assertEncrypted()).not.toBe(firstEtag);

 // The director deliberately opts into a staging recipient list. This save
 // still makes no provider request and cannot select unrestricted delivery.
 await mode.selectOption('allowlist');const recipients=card.getByLabel('Toegestane testadressen',{exact:false});await expect(recipients).toBeVisible();await expect(save).toBeDisabled();await recipients.fill(' Approved@Example.Test, regie@example.test\napproved@example.test ');await save.click();await expect(save).toBeDisabled();await expect(card.getByText('Mailverzending is beperkt tot de vrijgegeven testadressen.',{exact:true})).toBeVisible();expect(providerState.lastStatus.deliveryMode).toBe('allowlist');expect(providerState.lastStatus.allowedRecipients).toEqual(['approved@example.test','regie@example.test']);expect(providerState.lastStatus.sendingAllowed).toBe(true);expect(proof.providerRequests).toHaveLength(1);expect((await h.readProtected()).value.credentials.key===h.syntheticKey).toBe(true);
 await test.click();await expect(card.locator('.mf-badge')).toHaveText('Sleutel gecontroleerd');expect(proof.providerRequests).toHaveLength(2);await noOverflow(page);await screenshot(page,width,'resend-allowlist-tested');
 const beforeForbidden=await h.assertEncrypted(),revision=providerState.lastStatus.revision;
 const blocked=await page.evaluate(async revision=>{const response=await fetch('/api/resend/settings',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-Vlampie-Settings':'1'},body:JSON.stringify({action:'save',revision,deliveryMode:'live'})});return {status:response.status,body:await response.json()};},revision);
 expect(blocked.status).toBe(400);expect(blocked.body.error.message).toContain('alleen op de productieserver');expect(await h.assertEncrypted()).toBe(beforeForbidden);expect((await h.readProtected()).value.deliveryMode).toBe('allowlist');expect(proof.providerRequests).toHaveLength(2);

 const beforeRemove=proof.resendRequests.length;await card.getByRole('button',{name:'Resend-koppeling uitschakelen',exact:true}).click();expect(proof.resendRequests).toHaveLength(beforeRemove);const confirmation=card.getByRole('group',{name:'Wijziging van de Resend-koppeling bevestigen'});await expect(confirmation).toBeVisible();await confirmation.getByRole('button',{name:'Bevestigen',exact:true}).click();await expect(card.getByText('De Resend-koppeling is uitgeschakeld.',{exact:true})).toBeVisible();await expect(key).toHaveValue('');await expect(key).toHaveAttribute('required','');await expect(test).toBeDisabled();await expect(card.getByText('Mailverzending staat uit.',{exact:false})).toBeVisible();
 saved=(await h.readProtected()).value;expect(saved.mode).toBe('disabled');expect('credentials' in saved).toBe(false);expect(providerState.lastStatus.disabled).toBe(true);expect(providerState.lastStatus.keyConfigured).toBe(false);expect(providerState.lastStatus.sendingAllowed).toBe(false);await h.assertEncrypted();expect(proof.providerRequests).toHaveLength(2);await noOverflow(page);await screenshot(page,width,'resend-disabled');
 proof.providerChecks={actualNativeAdapter:true,actualRegieRoleLookup:true,actualSQLite:true,actualObjectCAS:true,actualAesGcm:true,failedSaveRetainsInput:true,saveDidNotCallProvider:true,statusRedacted:true,blankKeyPreserved:true,senderEditRevokesReceipt:true,explicitAllowlistSaved:true,stagingLiveRejected:true,removeLeavesDisabledTombstone:true,simulatedDomainChecks:2,actualMailSends:0};
}

for(const width of [390,1366]){
 test(`saved-show mail recovery and encrypted Resend CRUD ${width}px; isolated native API`,async({page},testInfo)=>{
  test.setTimeout(90000);
  await page.setViewportSize({width,height:width===390?844:768});
  await page.emulateMedia({reducedMotion:'reduce'});
  const h=await simulatedSavedShow(page,testInfo),{proof,providerState}=h;
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
   await expect(apiKey).toBeVisible();await expect(apiKey).toHaveValue('');await expect(apiKey).toHaveAttribute('type','password');await expect(apiKey).toBeEditable();
   await expect(secret).toBeVisible();await expect(secret).toHaveValue('');await expect(secret).toHaveAttribute('type','password');await expect(secret).toBeEditable();
   await expect(livekit.getByRole('button',{name:'LiveKit-koppeling opslaan',exact:true})).toBeVisible();
   await expect(livekit.getByRole('button',{name:'Test opgeslagen koppeling',exact:true})).toBeEnabled();
   await noOverflow(page);await screenshot(page,width,'livekit-environment-editable');
   await exerciseResend(page,main,h,width);
   // The same manager also exists directly in Mail settings. A real storage
   // read failure renders an actionable retry instead of an empty form.
   providerState.failNextRead=true;await openRoute(page,'mail');await main.locator('.cm-tabs').getByRole('button',{name:'Instellingen',exact:true}).click();
   const mailResend=main.locator('.cm-settings .mf-resend-settings');await expect(mailResend).toBeVisible();await expect(mailResend.getByRole('alert')).toContainText('niet veilig worden bevestigd');await expect(mailResend.locator('form')).toHaveCount(0);await mailResend.getByRole('button',{name:'Opnieuw laden',exact:true}).click();await expect(mailResend.getByRole('alert')).toHaveCount(0);await expect(mailResend.getByLabel('Resend API-sleutel',{exact:false})).toHaveValue('');await expect(mailResend.getByText('De koppeling is bewust uitgeschakeld.',{exact:true})).toBeVisible();proof.providerChecks.failedReadOffersRetry=true;
   await noOverflow(page);await screenshot(page,width,'resend-mail-settings');
   expect(proof.gets['/api/auth/session']).toBeGreaterThan(0);
   expect(proof.gets['/api/openai/status']).toBeGreaterThan(0);
   expect(proof.gets['/api/livekit/settings']).toBeGreaterThan(0);
   expect(proof.gets['/api/resend/settings']).toBeGreaterThanOrEqual(2);
   expect(proof.errors).toEqual([]);expect(proof.external).toEqual([]);expect(proof.writes).toEqual([]);expect(proof.unexpected).toEqual([]);expect(proof.forbiddenProviderRequests).toEqual([]);expect(proof.resendRequests.filter(item=>item.method==='POST').every(item=>item.settingsHeader)).toBe(true);expect(proof.providerRequests.every(item=>item.path==='/domains'&&item.method==='GET')).toBe(true);
  }finally{
   await page.close();await h.close();
   await mkdir(output,{recursive:true});
   await writeFile(`${output}/regie-settings-${width}.json`,JSON.stringify({observedAt:new Date().toISOString(),viewport:page.viewportSize(),simulatedAuthAndProviderTransport:true,otherApiTransportFixtures:true,actualAccountOrProviderAcceptance:false,actualRemoteBackendWrites:false,isolatedProviderSettingsWrites:true,savedShowBranch:true,...proof,expectedSandboxScriptBlocks:proof.expectedSandboxScriptBlocks.length},null,2)+'\n');
  }
 });
}
function templatesName(id){return listMailTemplates('milo').find(template=>template.id===id).name;}
