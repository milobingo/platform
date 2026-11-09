import {test,expect} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {makeGame,generateBooks,playerGame} from '../../server/bingo-model.js';

const output='verification/v70/handoff-v70';
const noOverflow=page=>expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth)).toBeLessThanOrEqual(1);
async function evidence(page,name,body){
 await mkdir(output+'/screenshots',{recursive:true});
 if(await page.getByRole('dialog').count())await expect(page.getByRole('dialog')).toHaveCSS('opacity','1');
 await page.screenshot({path:`${output}/screenshots/${name}.png`,fullPage:false});
 await writeFile(`${output}/${name}.json`,JSON.stringify({realReactAndBrowser:true,realAccountOrProviderAcceptance:false,...body},null,2)+'\n');
}
async function protectNetwork(page,testInfo,{dispatch,expectedExternal=[]}={}){
 const origin=new URL(testInfo.project.use.baseURL).origin,proof={errors:[],external:[],api:[],writes:[],unexpected:[]};
 page.on('pageerror',error=>proof.errors.push(error.message));
 await page.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.origin!==origin){if(expectedExternal.includes(url.origin)){proof.blockedSimulatedMedia??=[];proof.blockedSimulatedMedia.push(url.origin+url.pathname);}else proof.external.push(url.origin+url.pathname);return route.abort('blockedbyclient');}
  if(url.pathname==='/favicon.ico')return route.fulfill({status:204});
  if(!url.pathname.startsWith('/api/')&&!url.pathname.startsWith('/auth/'))return route.continue();
  proof.api.push(url.pathname);if(request.method()!=='GET')proof.writes.push(url.pathname);
  const body=dispatch&&await dispatch(url,request);
  if(body!==undefined)return route.fulfill({json:body,headers:{'Cache-Control':'private, no-store'}});
  proof.unexpected.push(url.pathname);return route.fulfill({status:403,json:{error:{message:'Browser QA blocks real backend and provider traffic.'}}});
 });return proof;
}
const booksTab=page=>page.getByRole('navigation',{name:'Spelersomgeving'}).getByRole('button',{name:'Boekjes',exact:false});
const bingo=page=>page.locator('.fam-book-live-console .fam-bingo-sphere');
const seconds=text=>Number(text.match(/(\d+)\s*(?:s\b|seconden)/)?.[1]);

for(const width of [320,1366])test(`v70 family demo ${width}px: real BINGO from Books, retained show and one shared countdown`,async({page},testInfo)=>{
 await page.setViewportSize({width,height:width===320?740:768});await page.emulateMedia({reducedMotion:'reduce'});
 const proof=await protectNetwork(page,testInfo);await page.goto('/spelen?demo=1');
 const stage=page.locator('.fam-demo-video');await expect(stage).toBeVisible();await stage.evaluate(node=>node.dataset.v70Mount='retained');
 await booksTab(page).click();await expect(bingo(page)).toBeEnabled();await bingo(page).click();
 const dialog=page.getByRole('dialog');await expect(dialog.getByRole('heading',{name:'Heb je écht BINGO?'})).toBeVisible();
 await expect(dialog.getByRole('combobox')).toHaveValue('milo-family-demo-boek-noor-demo');
 await expect(dialog.locator('.fam-modal-pattern')).toContainText('Vier hoeken');
 await dialog.getByRole('button',{name:'Ja, meld deze BINGO!',exact:true}).click();
 await expect(dialog.getByRole('status')).toContainText('Je bingo is ontvangen!');
 const before=seconds(await dialog.locator('.fam-window-count').innerText());expect(before).toBeGreaterThan(0);expect(before).toBeLessThanOrEqual(30);
 await dialog.getByRole('button',{name:'Sluiten',exact:true}).click();
 const helper=page.locator('.fam-book-live-console .fam-bingo-helper');await expect(helper).toContainText('Meldvenster: nog');
 expect(Math.abs(seconds(await helper.innerText())-before)).toBeLessThanOrEqual(1);
 await bingo(page).click();await expect(dialog.locator('.fam-claim-state')).toContainText('Geldige bingo ontvangen');
 await expect(dialog.getByRole('button',{name:'Ja, meld deze BINGO!',exact:true})).toBeDisabled();
 await expect.poll(async()=>seconds(await dialog.locator('.fam-window-count').innerText())).toBeLessThan(before);
 expect(Math.abs(seconds(await helper.innerText())-seconds(await dialog.locator('.fam-window-count').innerText()))).toBeLessThanOrEqual(1);
 await noOverflow(page);await expect(stage).toHaveAttribute('data-v70-mount','retained');
 expect(proof.errors).toEqual([]);expect(proof.external).toEqual([]);expect(proof.api).toEqual([]);expect(proof.writes).toEqual([]);
 await evidence(page,`books-bingo-${width}`,{transport:'explicit-browser-local-demo',sharedCountdown:true,claimStatus:'valid',...proof});
});

test('v70 family dialog stays bound to the shown goal after a real browser poll installs a newer simulated snapshot',async({page},testInfo)=>{
 await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'});
 const account='qa-family-only',family={ownerName:'QA Ouder',email:'qa@example.invalid',profiles:[{id:'qa-child',name:'QA Kind',age:9}],blocked:false,blockedGames:{},cooldowns:{}};
 const game=makeGame({brandId:'milo',title:'Gesimuleerde pollcontrole',date:'2026-11-11T13:30',timeZone:'Europe/Amsterdam'},'qa-regie','https://example.invalid');
 generateBooks(game,1,'browser-v70-fixture');Object.assign(game.books[0],{accountId:account,profileId:'qa-child',name:'QA Kind'});
 game.settings.youtubeId='abcdefghijk';await page.addInitScript(()=>{window.YT={Player:class{constructor(frame,{events}){this.frame=frame;queueMicrotask(()=>events.onReady());}getPlayerState(){return 2;}isMuted(){return true;}getVolume(){return 100;}getCurrentTime(){return 0;}getDuration(){return 0;}destroy(){this.frame.remove();}}};});
 game.status='running';game.revision=1;Object.assign(game.state,{phase:'window',roundIndex:0,blockIndex:game.plan.blocks.findIndex(b=>b.type==='round'),goalIndex:0,epoch:'qa-old-context',drawn:[7,13,27],windowSequence:1,window:{id:'qa-window',status:'open',startedAt:Date.now(),endsAt:Date.now()+60000,frozenAt:3,announcements:[{accountId:account,status:'accepted'}],claims:[]}});
 let polls=0;const identity=()=>({accountId:account,family,host:false,serverTime:Date.now()}),snapshot=()=>({...identity(),game:playerGame(game,account),complete:true,scope:'qa-only-account-scope',familyRevision:1,booksVersion:'qa-books-1',configVersion:'qa-config-1'});
 const proof=await protectNetwork(page,testInfo,{expectedExternal:['https://www.youtube-nocookie.com'],dispatch:(url,request)=>{
  if(request.method()!=='GET')return undefined;
  if(url.pathname==='/api/player/session')return {authenticated:true,method:'supabase',needsOnboarding:false,...identity()};
  if(url.pathname==='/api/player/brand')return {brandId:'milo'};
  if(url.pathname==='/api/bingo/me')return identity();
  if(url.pathname==='/api/mail/preferences')return {brandId:'milo',subscribed:false,newsletterEnabled:true};
  if(url.pathname==='/api/bingo/games')return {games:[{id:game.id,brandId:'milo',title:game.title,date:game.date,status:game.status}]};
  if(url.pathname===`/api/bingo/games/${game.id}/live`){polls++;return snapshot();}
  if(url.pathname==='/api/live-calls')return {call:null,serverTime:Date.now()};
  if(url.pathname===`/api/bingo/games/${game.id}/chat`)return {messages:[],cursor:0,self:{memberId:account,role:'player',canSend:false,profiles:family.profiles},serverTime:Date.now()};
  if(url.pathname===`/api/bingo/games/${game.id}/chat/stream`)return {disabled:true};
  return undefined;
 }});
 await page.goto('/spelen?spel='+game.id);await booksTab(page).click();await expect(bingo(page)).toBeEnabled();await bingo(page).click();
 const dialog=page.getByRole('dialog'),oldPattern=await dialog.locator('.fam-modal-pattern strong').innerText();
 const initial=seconds(await dialog.locator('.fam-window-count').innerText());expect(initial).toBeGreaterThan(0);
 expect(Math.abs(seconds(await page.locator('.fam-book-live-console .fam-bingo-helper').innerText())-initial)).toBeLessThanOrEqual(1);
 const earlier=polls;game.state.goalIndex=1;game.state.epoch='qa-new-context';game.state.window=null;game.state.windowSequence=0;game.state.phase='running';game.revision++;
 await page.evaluate(()=>dispatchEvent(new Event('online')));await expect.poll(()=>polls).toBeGreaterThan(earlier);
 await expect(dialog.getByRole('alert')).toContainText('eerdere spelcontext');await expect(dialog.locator('.fam-modal-pattern strong')).toHaveText(oldPattern);
 await expect(dialog.getByRole('button',{name:'Ja, meld deze BINGO!',exact:true})).toBeDisabled();expect(proof.writes).toEqual([]);
 await noOverflow(page);await evidence(page,'stale-dialog-phone',{transport:'browser-route-simulator-no-server-auth-bypass',oldPattern,staleClaimDisabled:true,...proof});
 await dialog.getByRole('button',{name:'Sluiten',exact:true}).click();await bingo(page).click();await expect(dialog.getByRole('alert')).toHaveCount(0);await expect(dialog.locator('.fam-modal-pattern strong')).not.toHaveText(oldPattern);
 await dialog.getByRole('button',{name:'Sluiten',exact:true}).click();const frame=page.locator('.fam-youtube-frame iframe');await expect(frame).toHaveAttribute('src',/cc_lang_pref=nl/);await frame.evaluate(node=>node.dataset.captionMount='original');await page.getByRole('button',{name:'Account en instellingen'}).click();
 await dialog.getByRole('checkbox',{name:'YouTube-ondertiteling bij openen aanvragen',exact:false}).check();await expect(frame).toHaveAttribute('data-caption-mount','original');expect(new URL(await frame.getAttribute('src')).searchParams.get('cc_load_policy')).toBeNull();
 await dialog.getByRole('button',{name:'CC-voorkeur op video toepassen',exact:true}).click();await expect(frame).toHaveAttribute('src',/cc_load_policy=1/);await expect(frame).not.toHaveAttribute('data-caption-mount','original');await expect(dialog.locator('.fam-view-preferences')).toContainText('Ondertiteling is bij YouTube aangevraagd.');
 await evidence(page,'youtube-caption-request-phone',{transport:'browser-route-simulator-with-local-YouTube-API-stub',realYouTubeTrackVerified:false,captionRequestParametersVerified:true,noAutomaticVideoRemount:true,...proof});
 expect(proof.errors).toEqual([]);expect(proof.external).toEqual([]);expect(proof.unexpected).toEqual([]);expect(proof.writes).toEqual([]);
});

test('v70 mobile family newsletter preferences default to opt-out and stay separate for Milo and Vlampie',async({page},testInfo)=>{
 await page.setViewportSize({width:390,height:740});await page.emulateMedia({reducedMotion:'reduce'});const proof=await protectNetwork(page,testInfo);
 await page.goto('/spelen?demo=1');await page.getByRole('button',{name:'Account en instellingen'}).click();
 const dialog=page.getByRole('dialog'),choice=dialog.getByRole('checkbox',{name:'Ja, houd mij op de hoogte',exact:false});await expect(choice).not.toBeChecked();
 await choice.check();await dialog.getByRole('button',{name:'Mijn keuze opslaan',exact:true}).click();await expect(dialog.locator('.fam-mail-saved')).toContainText('Milo & Friends');
 await dialog.getByRole('button',{name:'Sluiten',exact:true}).click();await page.getByRole('combobox',{name:'Kies een show',exact:true}).selectOption('vlampie-family-demo');
 await expect(page.locator('.family-app')).toHaveAttribute('data-brand','vlampie');await page.getByRole('button',{name:'Account en instellingen'}).click();await expect(choice).not.toBeChecked();await noOverflow(page);
 await dialog.getByRole('button',{name:'Sluiten',exact:true}).click();await page.getByRole('combobox',{name:'Kies een show',exact:true}).selectOption('milo-family-demo');await expect(page.locator('.family-app')).toHaveAttribute('data-brand','milo');await page.getByRole('button',{name:'Account en instellingen'}).click();await expect(choice).toBeChecked();
 await choice.uncheck();await dialog.getByRole('button',{name:'Mijn keuze opslaan',exact:true}).click();await expect(dialog.locator('.fam-mail-saved')).toContainText('afgemeld');
 await evidence(page,'brand-mail-opt-in-phone',{transport:'explicit-browser-local-demo',defaultOptOut:true,brandIsolation:true,...proof});
 expect(proof.errors).toEqual([]);expect(proof.external).toEqual([]);expect(proof.api).toEqual([]);expect(proof.writes).toEqual([]);
});

test('v70 mobile reactions retain the typed question and viewing preferences persist per brand without pretending demo speech captions',async({page},testInfo)=>{
 await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'no-preference'});const proof=await protectNetwork(page,testInfo);await page.goto('/spelen?demo=1');
 const reactions=page.getByRole('group',{name:'Korte publieksreactie'});await expect(reactions.getByRole('button')).toHaveCount(4);const applause=reactions.getByRole('button',{name:'Reageer met Applaus',exact:true});await expect(applause).toBeEnabled();
 const draft=page.getByRole('textbox',{name:'Je chatbericht',exact:true});await draft.fill('Mijn eigen vraag verstuur ik later.');await page.getByRole('combobox',{name:'Kies wie reageert',exact:true}).selectOption('sem-demo');await applause.click();
 const message=page.locator('.lc-message').filter({hasText:'👏 Applaus!'});await expect(message).toHaveCount(1);await expect(message.locator('.lc-message-name')).toHaveText('Sem');await expect(draft).toHaveValue('Mijn eigen vraag verstuur ik later.');await expect(page.locator('.lc-notice')).toContainText('Reactie bevestigd in de showchat.');
 await page.getByRole('button',{name:'Account en instellingen'}).click();const dialog=page.getByRole('dialog'),captions=dialog.getByRole('checkbox',{name:'YouTube-ondertiteling bij openen aanvragen',exact:false}),motion=dialog.getByRole('checkbox',{name:'Rustige animaties',exact:false});await expect(captions).not.toBeChecked();await captions.check();await motion.check();
 await expect(dialog.locator('.fam-view-preferences')).toContainText('De demo heeft geen gesproken uitzending of ondertiteltrack.');await expect(page.locator('.family-app')).toHaveAttribute('data-reduced-motion','true');await dialog.getByRole('button',{name:'Sluiten',exact:true}).click();
 await expect.poll(()=>page.locator('.fam-demo-host').evaluate(node=>getComputedStyle(node).animationName)).toBe('none');await noOverflow(page);
 await page.reload();await page.getByRole('button',{name:'Account en instellingen'}).click();await expect(captions).toBeChecked();await expect(motion).toBeChecked();await dialog.getByRole('button',{name:'Sluiten',exact:true}).click();
 await page.getByRole('combobox',{name:'Kies een show',exact:true}).selectOption('vlampie-family-demo');await expect(page.locator('.family-app')).toHaveAttribute('data-brand','vlampie');await page.getByRole('button',{name:'Account en instellingen'}).click();await expect(captions).not.toBeChecked();await expect(motion).not.toBeChecked();
 await evidence(page,'family-viewing-and-reactions-phone',{transport:'explicit-browser-local-demo',reactionProfile:'Sem',typedDraftRetained:true,viewingPreferencesPersist:true,brandIsolation:true,actualCaptionTrackVerified:false,...proof});
 expect(proof.errors).toEqual([]);expect(proof.external).toEqual([]);expect(proof.api).toEqual([]);expect(proof.writes).toEqual([]);
});

test('v70 actual unauthenticated APIs reject forged identity for claims, private calls and mail preferences',async({request})=>{
 const paths=['/api/mail/preferences?brand=milo','/api/live-calls?role=host&clientId=11111111-1111-4111-8111-111111111111&gameId=22222222-2222-4222-8222-222222222222','/api/bingo/games?demo=1'];
 const checks=[];for(const path of paths){const response=await request.get(path,{headers:{'oai-authenticated-user-id':'forged-regie','oai-authenticated-user-email':'admin@example.invalid','X-Vlampie-Player':'1'}});expect([401,503]).toContain(response.status());const body=await response.json();expect(body.error).toBeTruthy();expect(body.family).toBeUndefined();expect(body.call).toBeUndefined();expect(body.subscribed).toBeUndefined();checks.push({path,status:response.status()});}
 await mkdir(output,{recursive:true});await writeFile(`${output}/real-api-auth-negatives.json`,JSON.stringify({realServerAuthCheck:true,readOnly:true,credentialsUsed:false,checks},null,2)+'\n');
});
