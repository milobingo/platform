import {test,expect} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {CHARACTERS} from '../../server/characters.js';
import {defaultPresentation} from '../../server/presentation-model.js';

// Browser-only transport fixtures: actual Next/React/CSS/Canvas and local assets,
// with no server auth bypass, provider request or persisted backend mutation.
const output='verification/v70/handoff-v6';
const routes=['overview','shows','script','live','audience','studio','characters','library','books','orders','mail','people','settings'];
const characterIds=Object.keys(CHARACTERS).filter(id=>id!=='vlampie');
const tabs={
 script:['Draaiboek','Cast & stemmen','Rondes & patronen','Prijzen','Startcheck'],
 audience:['Live chat','Kijkersvragen','Belregie'],
 library:['Beweging & magie','Scènes & momenten','Beslisspellen','Voorprogramma','Verhaallijnen','Geluid & stemmen','Prijzen & afsluiting'],
 people:['Boekjes & uitgifte','Gezinnen','Prijzen & verslag','Herstel'],
 mail:['Mailtemplates','Acties & triggers','Nieuwsbrieven','Verzendlog','Instellingen'],
 settings:['AI & stemmen','Deze show','E-mail & bellen','Profielen & spelregels','Herstel & controle'],
};
const characterTabs=['Stem & uitspraak','Karakter & wereld','Trucjes & show','Gesprek met kinderen','Kennis & geheugen','Beweging'];

async function simulatedTransport(page,testInfo){
 page.setDefaultTimeout(10000);
 const errors=[],external=[],writes=[],unexpected=[],sandboxBlockedScripts=[];
 const origin=new URL(testInfo.project.use.baseURL).origin;
 page.on('pageerror',error=>errors.push(error.message));
 page.on('console',message=>{if(message.type()!=='error')return;const text=message.text();if(message.location().url==='about:srcdoc'&&text==="Blocked script execution in 'about:srcdoc' because the document's frame is sandboxed and the 'allow-scripts' permission is not set.")sandboxBlockedScripts.push(text);else errors.push(text);});
 await page.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.origin!==origin){external.push(url.origin+url.pathname);return route.abort('blockedbyclient');}
  if(url.pathname==='/favicon.ico')return route.fulfill({status:204});
  if(!url.pathname.startsWith('/api/')&&!url.pathname.startsWith('/auth/'))return route.continue();
  if(request.method()!=='GET'){
   writes.push({path:url.pathname,method:request.method()});
   return route.fulfill({status:403,json:{error:{message:'Simulated browser QA blocks backend writes.'}}});
  }
  let body;
  if(url.pathname==='/api/auth/session')body={authenticated:true,user:'qa-browser-regie',email:'regie@example.test',role:'regie',local:false,configured:true,localAvailable:false};
  else if(url.pathname==='/api/bingo/games')body={games:[]};
  else if(url.pathname==='/api/characters')body={characters:Object.values(CHARACTERS),revision:0};
  else if(url.pathname==='/api/openai/status')body={configured:false,canManage:false,revision:null,liveVerified:false};
  else if(url.pathname==='/api/output')body={state:null,serverTime:Date.now()};
  else if(url.pathname==='/api/presentation/document')body={document:defaultPresentation(),revision:0};
  else if(url.pathname==='/api/bingo/families')body={families:[]};
  else if(url.pathname==='/api/livekit/settings')body={source:'environment',canManage:false,configured:false,url:'',apiKey:'',apiKeyConfigured:false,secretConfigured:false,revision:null,connectionTest:null};
  else if(url.pathname.includes('/archive'))body={total:0,items:[]};
  else {unexpected.push(url.pathname+url.search);return route.fulfill({status:404,json:{error:{message:'Unexpected simulated QA endpoint.'}}});}
  return route.fulfill({json:body,headers:{'Cache-Control':'private, no-store'}});
 });
 return {errors,external,writes,unexpected,sandboxBlockedScripts};
}

const noOverflow=page=>expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth),{timeout:3000}).toBeLessThanOrEqual(1);
async function openRoute(page,id){
 await page.evaluate(value=>{location.hash='/'+value;},id);
 await expect(page.locator(`.mf-route-view[data-route="${id}"]`)).toBeVisible();
 await page.waitForTimeout(220);
 await page.evaluate(()=>{window.scrollTo(0,0);document.querySelector('main#mf-main')?.scrollTo(0,0);});
 await noOverflow(page);
 await expect(page.getByText('De studio kon niet starten.',{exact:true})).toHaveCount(0);
}
async function chooseTab(scope,label){
 const control=scope.getByRole('tab',{name:label,exact:false}).or(scope.getByRole('button',{name:label,exact:false})).first();
 await control.click();
 await expect(control).toBeVisible();
}
async function screenshot(page,name){
 await mkdir(output+'/screenshots',{recursive:true});
 // Keep the real viewport: a stitched long page moves fixed sidebars away from
 // their on-screen position after a control has scrolled into view.
 await page.screenshot({path:`${output}/screenshots/qa-simulated-${name}.png`,fullPage:false});
}
async function inViewport(page,locator){
 await expect(locator).toBeVisible();
 const box=await locator.boundingBox(),viewport=page.viewportSize();
 expect(box).not.toBeNull();
 expect(box.x).toBeGreaterThanOrEqual(-1);expect(box.y).toBeGreaterThanOrEqual(-1);
 expect(box.x+box.width).toBeLessThanOrEqual(viewport.width+1);
 expect(box.y+box.height).toBeLessThanOrEqual(viewport.height+1);
}
async function revealLiveAdvanced(main){
 const advanced=main.locator('.mf-live-advanced');
 for(let index=0;index<await advanced.count();index++){
  const details=advanced.nth(index);if(await details.getAttribute('open')===null)await details.locator(':scope>summary').click();
  await expect(details).toHaveAttribute('open','');
 }
}
async function inspectLiveModules(page,main,width,modules){
 const simple=await main.locator('.mf-live-essentials').count()>0;
 if(simple){
  await expect(main.locator('.mf-live-bingo').getByRole('heading',{name:'Bingo regie',exact:true})).toBeVisible();
  await expect(main.locator('.mf-live-bingo').getByRole('heading',{name:'Bingo & controle',exact:true})).toBeVisible();
  await expect(main.locator('.mf-live-advanced')).toHaveCount(2);
  await expect(main.locator('.mf-live-advanced[open]')).toHaveCount(0);
  await expect(main.getByRole('timer',{name:'Volgende officiële bal'})).toBeVisible();
  await revealLiveAdvanced(main);
 }
 const take=main.getByRole('button',{name:'TAKE',exact:true});await take.scrollIntoViewIfNeeded();await inViewport(page,take);
 const speak=main.getByRole('button',{name:'Laat spreken',exact:true}).first();await speak.scrollIntoViewIfNeeded();await inViewport(page,speak);
 if(simple)await expect(main.locator('.rd-transport').getByText('Automatische trekking · 15 seconden per bal',{exact:true})).toBeVisible();
 else {const draw=main.getByRole('button',{name:'Volgende bal',exact:false}).first();await draw.scrollIntoViewIfNeeded();await inViewport(page,draw);}
 const gestures=main.locator('.rd-quick-gestures>button');await expect(gestures).toHaveCount(4);
 for(let index=0;index<4;index++){await gestures.nth(index).scrollIntoViewIfNeeded();await inViewport(page,gestures.nth(index));expect(await gestures.nth(index).evaluate(node=>node.scrollWidth-node.clientWidth)).toBeLessThanOrEqual(1);}
 const controls=main.locator('[data-module-id]'),expected=simple?6:7;await expect(controls).toHaveCount(expected);
 for(let index=0;index<expected;index++){
  const control=controls.nth(index),moduleId=await control.getAttribute('data-module-id');
  if(simple)expect(moduleId).not.toBe('bingo');
  if(width<1100)await main.getByRole('combobox',{name:'Mobiel werkpaneel'}).selectOption(moduleId);else await control.click();
  const panel=main.locator(`[data-panel-id="${moduleId}"]`);await expect(panel).toBeVisible();await panel.scrollIntoViewIfNeeded();modules.push(moduleId);await noOverflow(page);
 }
}

test('Milo preparation opens the actual pre-show settings and saving availability keeps the show unstarted; simulated transport',async({page},testInfo)=>{
 const proof=await simulatedTransport(page,testInfo);
 await page.addInitScript(()=>localStorage.setItem('mf-production-settings-milo',JSON.stringify({lobby:{enabled:false}})));
 await page.goto('/#/library/lobby');
 const main=page.locator('main#mf-main'),toggle=main.getByRole('checkbox',{name:/Voorprogramma beschikbaar/});
 await expect(main.getByRole('heading',{name:'Al gezellig vóór de eerste bal',exact:true})).toBeVisible();await expect(toggle).not.toBeChecked();
 await main.getByRole('button',{name:'Beweging & magie',exact:true}).click();
 await expect(toggle).toHaveCount(0);
 await page.evaluate(()=>{location.hash='/library';});await expect(page.locator('.mf-route-view')).toHaveAttribute('data-route','library');
 await page.evaluate(()=>{location.hash='/library/lobby';});await expect(toggle).toBeVisible();
 await page.getByRole('link',{name:'Overzicht',exact:true}).click();
 const setup=main.getByRole('link',{name:'Voorprogramma instellen',exact:true});await expect(setup).toBeVisible();await setup.click();
 await expect(page).toHaveURL(/#\/library\/lobby$/);await expect(toggle).not.toBeChecked();
 await toggle.check();await main.getByRole('button',{name:'Opslaan',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('mf-production-settings-milo')).lobby.enabled)).toBe(true);
 await expect(main.getByRole('button',{name:'Voorprogramma live',exact:true})).toBeEnabled();
 await expect(page.locator('.mf-top-show')).toContainText('Oefenstudio');
 await page.getByRole('link',{name:'Overzicht',exact:true}).click();await expect(setup).toHaveCount(0);
 expect(proof.writes).toEqual([]);expect(proof.external).toEqual([]);expect(proof.unexpected).toEqual([]);expect(proof.errors).toEqual([]);
});

for(const width of [390,1366]){
 test(`handoff v6 actual browser ${width}px: routes, nested tabs and controls; simulated transport`,async({page},testInfo)=>{
  test.setTimeout(180000);
  await page.setViewportSize({width,height:width===1366?720:844});
  await page.emulateMedia({reducedMotion:'reduce'});
  const proof=await simulatedTransport(page,testInfo),visited=[],nested=[],modules=[];
  await page.goto('/#/overview');
  const main=page.locator('main#mf-main');await expect(main).toBeVisible();
  await expect(page.locator('nav[aria-label="Hoofdnavigatie"]>a')).toHaveCount(13);
  for(const id of routes){
   await openRoute(page,id);visited.push(id);
   if(id==='live'){
    await inspectLiveModules(page,main,width,modules);
    await screenshot(page,`regie-${width}`);
   }
   if(id==='characters')await expect(main.locator('a[href^="#/characters/"]')).toHaveCount(12);
   if(id==='mail'){
    const templates=main.locator('.cm-template-list>button');await expect(templates).toHaveCount(17);
    for(let index=0;index<17;index++){const name=await templates.nth(index).locator('strong').innerText();await templates.nth(index).click();await expect(main.locator('.cm-editor>header h2')).toHaveText(name);await expect(main.locator('.cm-preview-error')).toHaveCount(0);const preview=main.locator('iframe[title="Voorbeeld van de mail met fictieve gegevens"]');await expect(preview).toHaveAttribute('sandbox','');await expect(preview).not.toHaveAttribute('srcdoc',/<script\b/i);}
   }
   if(tabs[id])for(const label of tabs[id]){
    const scope=id==='script'?main.locator('.mf-tabs[role="tablist"]').first():id==='audience'?main.locator('nav[aria-label="Publiekswerkplek"]'):id==='library'?main.locator('nav[aria-label="Showbibliotheek"]'):id==='people'?main.locator('[role="tablist"][aria-label="Deelnemersadministratie"]'):id==='mail'?main.getByRole('navigation',{name:'Communicatieonderdelen'}):main;
    if(width===390&&id==='library')await main.getByRole('combobox',{name:'Onderdeel van de showbibliotheek'}).selectOption({label});else await chooseTab(scope,label);nested.push(id+':'+label);await noOverflow(page);
    if(id==='settings'&&label==='AI & stemmen')await expect(main.locator('input[type="password"]')).toHaveCount(0);
    if(id==='settings'&&label==='E-mail & bellen'){
     await expect(main.locator('input[type="password"]')).toHaveCount(0);
     await expect(main.getByText('Aanmelden voor gezinnen',{exact:true})).toBeVisible();
    }
    if(id==='settings'&&label==='Profielen & spelregels'){
     const presentation=main.locator('[role="tablist"][aria-label="Presentatie-instellingen"]');
     for(const name of ['Presentatieprofielen','Spelregels','Deze show']){await chooseTab(presentation,name);nested.push('presentation:'+name);await noOverflow(page);}
    }
   }
   if(['library','orders','mail'].includes(id))await screenshot(page,`${id}-${width}`);
  }
  for(const id of characterIds){await openRoute(page,'characters/'+id);visited.push('characters/'+id);}
  await openRoute(page,'characters/milo');
  const cast=main.locator('nav[aria-label="Personage-instellingen"],.cp-nav').first();
  for(const label of characterTabs){await chooseTab(cast,label);nested.push('character:'+label);await noOverflow(page);}
  expect(nested).toHaveLength(38);expect(visited).toHaveLength(25);
  if(width===390){
   const trigger=page.getByRole('button',{name:'Menu openen',exact:true});
   await trigger.click();await expect(page.locator('aside').getByRole('link',{name:'Overzicht',exact:true})).toBeVisible();
   await page.keyboard.press('Escape');await expect(trigger).toBeFocused();
  }
  const before=page.url();await page.locator('.mf-skip').focus();await page.keyboard.press('Enter');
  expect(page.url()).toBe(before);await expect(main).toBeFocused();
  expect(proof.errors).toEqual([]);expect(proof.external).toEqual([]);expect(proof.writes).toEqual([]);expect(proof.unexpected).toEqual([]);
  await mkdir(output,{recursive:true});
  await writeFile(`${output}/browser-workspace-${width}.json`,JSON.stringify({simulatedBrowserTransport:true,realAuthOrProvidersVerified:false,viewport:page.viewportSize(),routes:visited,nestedTabs:nested,modules,errors:proof.errors,expectedSandboxScriptBlocks:proof.sandboxBlockedScripts.length,externalRequests:proof.external,backendWrites:proof.writes},null,2)+'\n');
 });
}

test('handoff v6 short-screen workspace and family modals; simulated transport',async({page},testInfo)=>{
 const proof=await simulatedTransport(page,testInfo);
 await page.setViewportSize({width:390,height:568});await page.emulateMedia({reducedMotion:'reduce'});
 await page.goto('/#/overview');await expect(page.locator('main#mf-main')).toBeVisible();
 await page.getByRole('button',{name:'Nieuwe show',exact:true}).click();
 const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();
 await inViewport(page,dialog.getByRole('button',{name:'Sluiten',exact:true}));
 await dialog.locator('input').first().fill('Een lange Nederlandse naam voor de korte schermcontrole');
 await dialog.getByRole('button',{name:'Show aanmaken',exact:false}).scrollIntoViewIfNeeded();
 await expect(dialog.getByRole('button',{name:'Show aanmaken',exact:false})).toBeVisible();
 await noOverflow(page);await screenshot(page,'new-show-short-phone');
 await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
 await page.goto('/spelen?demo=1');await expect(page.getByRole('navigation',{name:'Spelersomgeving'})).toBeVisible();
 await page.getByRole('button',{name:'Account en instellingen'}).click();
 await expect(page.getByRole('dialog')).toBeVisible();
 await inViewport(page,page.getByRole('dialog').getByRole('button',{name:'Sluiten',exact:true}));
 await noOverflow(page);await screenshot(page,'family-account-short-phone');
 await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
 expect(proof.errors).toEqual([]);expect(proof.external).toEqual([]);expect(proof.writes).toEqual([]);expect(proof.unexpected).toEqual([]);
});

test('handoff v6 family orders, retained broadcast and whisper dialog; simulated transport',async({page},testInfo)=>{
 test.setTimeout(90000);
 const proof=await simulatedTransport(page,testInfo);await page.setViewportSize({width:390,height:844});
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.goto('/spelen?demo=1');const stage=page.locator('.fam-demo-video');await expect(stage).toBeVisible();
 await stage.evaluate(node=>node.dataset.handoffMount='retained');
 await screenshot(page,'family-phone');
 await page.getByRole('navigation',{name:'Spelersomgeving'}).getByRole('button',{name:'Boekjes',exact:false}).click();
 const subnav=page.getByRole('navigation',{name:'Boekjes en bestellingen'});
 for(const name of ['Mijn boekjes','Bingobladen bestellen','Mijn bestellingen']){
  await subnav.getByRole('button',{name,exact:true}).click();await expect(stage).toHaveAttribute('data-handoff-mount','retained');await noOverflow(page);
  if(name==='Bingobladen bestellen')await screenshot(page,'family-order-phone');
 }
 await page.goto('/#/live');await expect(page.locator('main#mf-main')).toBeVisible();
 await revealLiveAdvanced(page.locator('main#mf-main'));
 await page.getByRole('button',{name:/^Fluister naar /}).first().click();
 const whisper=page.getByRole('dialog');await expect(whisper).toBeVisible();
 await whisper.locator('textarea').fill('Bouw op een vrolijke manier wat spanning op, zonder een uitslag te verzinnen.');
 await screenshot(page,'whisper-private-phone');
 await whisper.getByRole('button',{name:'Fluister in',exact:true}).click();
 await expect(whisper.getByText(/Gesimuleerd|Simulatie/i).first()).toBeVisible();
 await noOverflow(page);await screenshot(page,'whisper-simulated-proposal-phone');
 expect(proof.errors).toEqual([]);expect(proof.external).toEqual([]);expect(proof.writes).toEqual([]);expect(proof.unexpected).toEqual([]);
});

test('handoff v6 Vlampie retains all seven console modules and its manual draw controls; simulated transport',async({page},testInfo)=>{
 const proof=await simulatedTransport(page,testInfo);await page.setViewportSize({width:1366,height:720});await page.emulateMedia({reducedMotion:'reduce'});
 await page.addInitScript(()=>localStorage.setItem('mf-production','vlampie'));
 await page.goto('/#/live');const main=page.locator('main#mf-main');await expect(main).toBeVisible();await expect(page.locator('body')).toHaveAttribute('data-brand','vlampie');await expect(main.locator('.mf-live-essentials')).toHaveCount(0);
 const modules=[];await inspectLiveModules(page,main,1366,modules);expect(modules).toHaveLength(7);expect(modules).toContain('bingo');await noOverflow(page);
 expect(proof.errors).toEqual([]);expect(proof.external).toEqual([]);expect(proof.writes).toEqual([]);expect(proof.unexpected).toEqual([]);
});

test('handoff v6 actual tour transport, new magic reveal and order detail; simulated transport',async({page},testInfo)=>{
 test.setTimeout(90000);
 const proof=await simulatedTransport(page,testInfo);await page.setViewportSize({width:1366,height:720});
 await page.emulateMedia({reducedMotion:'no-preference'});
 await page.goto('/#/library');const library=page.locator('.sc-library');await expect(library).toBeVisible();
 await library.locator('.sc-card').filter({hasText:'Milo’s studiorondje'}).click();
 const preview=library.locator('.sc-preview');await expect(preview.getByRole('heading',{name:'Milo’s studiorondje'})).toBeVisible();
 await preview.getByRole('button',{name:'Voorbeeld afspelen',exact:true}).click();
 await expect(preview.getByRole('button',{name:'Voorbeeld pauzeren',exact:true})).toBeVisible();
 await page.waitForTimeout(300);await preview.getByRole('button',{name:'Voorbeeld pauzeren',exact:true}).click();
 const position=preview.getByRole('slider',{name:'Tijdpositie voorbeeld'});
 await position.fill('32');await expect(position).toHaveValue('32');await screenshot(page,'studio-tour-preview-desktop');
 await preview.getByRole('button',{name:'Start dit moment live',exact:true}).click();
 const active=library.getByRole('region',{name:'Actief showmoment'});await expect(active).toBeVisible();
 await active.getByRole('button',{name:'Showmoment pauzeren',exact:true}).click();
 await expect(active.getByRole('button',{name:'Showmoment hervatten',exact:true})).toBeVisible();
 await active.getByRole('button',{name:'Showmoment hervatten',exact:true}).click();
 await active.getByRole('button',{name:'Stop showmoment',exact:true}).click();
 await expect(active).toHaveCount(0,{timeout:6000});
 const rings=library.locator('.sc-card').filter({hasText:'De onmogelijke sterrenringen'});await rings.click();
 const art=rings.locator('img');await expect(art).toHaveAttribute('src',/linking-rings\.webp$/);
 await expect.poll(()=>art.evaluate(node=>node.complete&&node.naturalWidth>0)).toBe(true);
 await position.fill('14');await expect(preview.locator('.sc-magic-phases>.active')).toHaveText('Onthulling');
 await expect(preview.locator('canvas')).toBeVisible();await screenshot(page,'linking-rings-reveal-desktop');
 await openRoute(page,'orders');await page.locator('.oa-order-row').first().click();
 const detail=page.getByRole('dialog');await expect(detail).toBeVisible();
 await expect(detail.getByText('Fictief voorbeeld',{exact:true})).toBeVisible();
 await expect(detail.locator('.oa-timeline>li')).toHaveCount(4);
 await screenshot(page,'order-detail-desktop');await page.keyboard.press('Escape');await expect(detail).toHaveCount(0);
 expect(proof.errors).toEqual([]);expect(proof.external).toEqual([]);expect(proof.writes).toEqual([]);expect(proof.unexpected).toEqual([]);
});
