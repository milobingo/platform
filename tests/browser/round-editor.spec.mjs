import {test,expect} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {createSqliteDatabase} from '../../server/node-storage.js';
import {BingoStore} from '../../server/bingo-store.js';
import {handleBingo} from '../../server/bingo.js';
import {makeGame,generateBooks} from '../../server/bingo-model.js';
import {prepareAutomaticRules} from '../../server/game-rules.js';
import {CHARACTERS} from '../../server/characters.js';
import {defaultPresentation} from '../../server/presentation-model.js';
import {premierePlan} from '../../server/premiere-plan.js';
import {createBrowserAudioFixture} from '../helpers/browser-audio-fixture.mjs';

const output=process.env.ROUND_EDITOR_EVIDENCE_ROOT||'/tmp/milo-round-editor-browser';
const rounds=game=>game.plan.blocks.filter(block=>block.type==='round');
async function fixture(page,testInfo,{premiere=false}={}){
 const origin=new URL(testInfo.project.use.baseURL).origin,owner='round-editor-browser',db=createSqliteDatabase(':memory:'),store=new BingoStore(db),game=makeGame({brandId:'milo',title:'QA bewerkbare première',date:'2027-12-02T12:30:00Z',...(premiere?{plan:premierePlan(),roundCount:4,settings:{rulesProfile:'milo-standard-v1',mode:'auto'}}:{})},owner,origin);
 if(!premiere){const first=rounds(game)[0];first.goals=first.goals.slice(0,1);game.plan.blocks=game.plan.blocks.filter(block=>block.type!=='round'||block.id===first.id);}prepareAutomaticRules(game);await store.create(game);
 const path='/api/bingo/games/'+game.id,proof={errors:[],unexpected:[],writes:[],external:[]},read=async()=>(await store.game(game.id)).data;
 const audio=createBrowserAudioFixture({owner,getGame:read});proof.audio=audio.requests;
 page.on('pageerror',error=>proof.errors.push(error.message));
 await page.addInitScript(()=>localStorage.setItem('mf-production','milo'));
 await page.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());if(url.origin!==origin){proof.external.push(url.origin);return route.abort('blockedbyclient');}if(url.pathname==='/favicon.ico')return route.fulfill({status:204});if(!url.pathname.startsWith('/api/')&&!url.pathname.startsWith('/auth/'))return route.continue();if(premiere&&await audio.handle(route))return;
  if(url.pathname===path&&['GET','PUT'].includes(request.method())){
   const headers=new Headers(request.headers());headers.set('Origin',origin);const response=await handleBingo(new Request(url.href,{method:request.method(),headers,...(request.method()==='PUT'?{body:request.postData()}:{} )}),{DB:db,AUTH_IDENTITY:{user:owner,admin:true}}),data=await response.json();if(request.method()==='PUT')proof.writes.push({status:response.status,revision:data.game?.preparationRevision,rounds:data.game&&rounds(data.game).map(round=>({title:round.title,goals:round.goals.length}))});return route.fulfill({status:response.status,json:data});
  }
  if(request.method()!=='GET'){proof.unexpected.push({method:request.method(),path:url.pathname});return route.fulfill({status:403,json:{error:{message:'No provider or live operations are allowed in this fixture.'}}});}
  let data;
  if(url.pathname==='/api/auth/session')data={authenticated:true,role:'regie',user:owner,configured:true,email:'fixture@example.invalid'};
  else if(url.pathname==='/api/bingo/games'){const current=await read();data={games:[{id:game.id,brandId:'milo',title:game.title,status:current.status,date:game.date,timeZone:game.timeZone,roundCount:rounds(current).length,bookCount:current.books.length}]};}
  else if(url.pathname==='/api/characters')data={characters:Object.values(CHARACTERS),revision:0};
  else if(['/api/openai/status','/api/livekit/settings'].includes(url.pathname))data={configured:premiere&&url.pathname==='/api/openai/status',canManage:true,source:'none',environmentConfigured:false};
  else if(url.pathname==='/api/live-calls')data={call:null,serverTime:Date.now()};
  else if(url.pathname==='/api/output')data={state:null,serverTime:Date.now()};
  else if(url.pathname==='/api/presentation/document')data={document:defaultPresentation(),revision:0};
  else if(url.pathname==='/api/bingo/families')data={families:[]};
  else if(url.pathname===path+'/chat'||url.pathname===path+'/chat/stream'){
   data={messages:[],events:[],cursor:0,hasMore:false,self:{memberId:owner,role:'host',canSend:true,profiles:[]},serverTime:Date.now()};if(url.pathname.endsWith('/stream'))return route.fulfill({body:'event: sync\ndata: '+JSON.stringify({...data,reconnect:true})+'\n\n',headers:{'Content-Type':'text/event-stream'}});
  }else if(url.pathname===path+'/chat/members')data={members:[],serverTime:Date.now()};
  else{proof.unexpected.push({method:request.method(),path:url.pathname});return route.fulfill({status:404,json:{error:{message:'Unknown isolated round endpoint'}}});}
  return route.fulfill({json:data});
 });return {game,store,proof,read,audio,close:()=>db.close()};
}

for(const width of [1366,390])test(`round editor ${width}px adds missing rounds and patterns, persists ordered prices, and respects issued cards and participation; isolated Bingo API`,async({page},testInfo)=>{
 test.setTimeout(90000);page.setDefaultTimeout(10000);await page.setViewportSize({width,height:width===390?844:1000});const h=await fixture(page,testInfo);
 const open=async()=>{await page.goto('/#/script');await expect(page.locator('.mf-top-show>strong')).toHaveText(h.game.title);await page.getByRole('tab',{name:'Rondes & patronen',exact:true}).click();};
 const cards=page.locator('.mf-rounds-editable>.mf-panel'),saved=async check=>expect.poll(async()=>check(await h.read()),{timeout:10000}).toBe(true);
 try{
  await open();await expect(cards).toHaveCount(1);await expect(page.getByRole('button',{name:'Ronde toevoegen',exact:true})).toBeEnabled();await cards.first().getByRole('button',{name:'Patroon en prijs toevoegen',exact:true}).click();await cards.first().getByRole('button',{name:'Patroon en prijs toevoegen',exact:true}).click();await expect(cards.first().locator('.mf-round-step-list>li')).toHaveCount(3);await saved(game=>rounds(game)[0].goals.length===3);
  expect(rounds(await h.read())[0].goals.map(goal=>goal.patternId)).toEqual(['patroon-hoeken','patroon-boven-onder','patroon-vol']);await expect(cards.first().getByText(/Eén volle rij is geen bingo/)).toBeVisible();
  for(let count=2;count<=4;count++){await page.getByRole('button',{name:'Ronde toevoegen',exact:true}).click();await expect(cards).toHaveCount(count);await saved(game=>rounds(game).length===count);}
  expect(rounds(await h.read()).map(round=>round.goals.length)).toEqual([3,3,3,1]);expect(rounds(await h.read())[3].title).toBe('Finaleronde');
  await cards.nth(1).getByLabel('Naam van de ronde',{exact:true}).fill('De sterrenronde');await cards.nth(1).getByLabel('Prijs prijsstap 2',{exact:false}).selectOption('prijs-hoofdprijs');await saved(game=>rounds(game)[1].title==='De sterrenronde'&&rounds(game)[1].goals[1].prizeId==='prijs-hoofdprijs');
  await cards.nth(1).getByRole('button',{name:'Prijsstap 2 hoger',exact:true}).click();await saved(game=>rounds(game)[1].goals[0].patternId==='patroon-boven-onder');await cards.nth(1).getByRole('button',{name:'Prijsstap 1 lager',exact:true}).click();await saved(game=>rounds(game)[1].goals[1].patternId==='patroon-boven-onder');
  await cards.nth(1).getByRole('button',{name:'Patroon en prijs toevoegen',exact:true}).click();await expect(cards.nth(1).locator('.mf-round-step-list>li')).toHaveCount(4);await cards.nth(1).getByRole('button',{name:'Prijsstap 3 verwijderen',exact:true}).click();await saved(game=>rounds(game)[1].goals.length===3);
  await page.reload();await page.getByRole('tab',{name:'Rondes & patronen',exact:true}).click();await expect(cards).toHaveCount(4);await expect(cards.nth(1).getByLabel('Naam van de ronde',{exact:true})).toHaveValue('De sterrenronde');await expect(cards.nth(1).getByLabel('Prijs prijsstap 2',{exact:false})).toHaveValue('prijs-hoofdprijs');
  const before=await h.read();expect(before.plan.blocks.filter(block=>block.type!=='round')).toEqual(h.game.plan.blocks.filter(block=>block.type!=='round'));expect(before.plan.patterns.find(pattern=>pattern.id==='patroon-boven-onder').cells).toEqual([0,1,2,3,4,20,21,22,23,24]);
  await mkdir(output,{recursive:true});await page.screenshot({path:output+`/round-editor-${width}.png`,fullPage:true});
  await h.store.mutate(h.game.id,{user:'round-editor-browser'},game=>generateBooks(game,1,'browser-issued-cards'));await page.reload();await page.getByRole('tab',{name:'Rondes & patronen',exact:true}).click();await expect(page.getByRole('button',{name:'Ronde toevoegen',exact:true})).toBeDisabled();await expect(cards.first().getByLabel('Naam van de ronde',{exact:true})).toHaveAttribute('readonly','');await expect(cards.first().getByLabel('Patroon prijsstap 1',{exact:false})).toBeEnabled();await expect(page.getByRole('status').filter({hasText:'rondekaarten'})).toBeVisible();
  await h.store.mutate(h.game.id,{user:'round-editor-browser'},game=>{game.books[0].accountId='family';});await page.reload();await page.getByRole('tab',{name:'Rondes & patronen',exact:true}).click();await expect(cards.first().getByLabel('Patroon prijsstap 1',{exact:false})).toBeDisabled();await expect(cards.first().getByLabel('Prijs prijsstap 1',{exact:false})).toBeDisabled();await expect(page.getByRole('status').filter({hasText:'bestaande deelnemers'})).toBeVisible();
  expect(h.proof.errors).toEqual([]);expect(h.proof.unexpected).toEqual([]);expect(h.proof.external).toEqual([]);expect(h.proof.writes.every(write=>write.status===200)).toBe(true);h.proof.savedRoundGoals=rounds(await h.read()).map(round=>round.goals.length);await writeFile(output+`/round-editor-${width}.json`,JSON.stringify(h.proof,null,2));
 }finally{await page.close();await h.close();}
});

test('premiere attachment exposes all 26 moments, five guest turns, pattern explanation and 20 private-note cue cards; audio starts only after its button',async({page},testInfo)=>{
 test.setTimeout(120000);page.setDefaultTimeout(10000);await page.setViewportSize({width:1366,height:1000});const h=await fixture(page,testInfo,{premiere:true}),originalGuest=h.game.plan.blocks.find(block=>block.type==='guest'),explanation=h.game.plan.blocks.find(block=>block.explanationSteps?.length),readGuest=async()=>(await h.read()).plan.blocks.find(block=>block.id===originalGuest.id);
 try{
  await page.goto('/#/script');await expect(page.locator('.mf-top-show>strong')).toHaveText(h.game.title);const main=page.locator('#mf-main');await expect(main.locator('.mf-cue-list>button')).toHaveCount(26);expect(rounds(await h.read()).map(round=>round.goals.length)).toEqual([3,3,3,1]);await page.waitForTimeout(1200);expect(h.proof.audio).toHaveLength(0);
  await main.locator('.mf-cue-list').getByRole('button',{name:new RegExp(originalGuest.title)}).click();const editor=main.locator('.mf-cue-editor');await expect(editor.locator('.mf-dialogue-turn')).toHaveCount(5);const revised='Milo neemt rustig de tijd om de bovenste en de onderste rij samen uit te leggen. '.repeat(12).trim(),note='ALLEEN REGIE: houd de gast in beeld en toon geen privégegevens.';await editor.getByLabel('Tekst beurt 2',{exact:false}).fill(revised);await editor.getByLabel('Regienotitie — wordt niet voorgelezen',{exact:false}).fill(note);await expect.poll(async()=>(await readGuest()).dialogue[1].text).toBe(revised);await expect.poll(async()=>(await readGuest()).operatorNotes).toBe(note);const guest=await readGuest();expect(guest.dialogue.filter((_,index)=>index!==1)).toEqual(originalGuest.dialogue.filter((_,index)=>index!==1));expect(guest.dialogue).toHaveLength(5);expect(guest.text).toBe(originalGuest.text);
  await main.locator('.mf-cue-list').getByRole('button',{name:new RegExp(explanation.title)}).click();await expect(editor.getByRole('checkbox',{name:'Patronen één voor één uitleggen in het uitzendbeeld'})).toBeChecked();for(let index=0;index<3;index++)await expect(editor.getByLabel(`Patroon uitlegstap ${index+1}`,{exact:false})).toHaveValue(['patroon-hoeken','patroon-boven-onder','patroon-vol'][index]);
  await main.getByRole('tab',{name:'Spreekkaarten',exact:true}).click();const bank=main.locator('.mf-panel').filter({has:page.getByRole('heading',{name:'Spreekkaarten voor live regie',exact:true})});await expect(bank.getByLabel('Voorbereide tekst',{exact:false}).locator('option')).toHaveCount(20);const manual=(await h.read()).plan.manualCues.find(cue=>cue.title.startsWith('B5 ·'));await bank.getByLabel('Voorbereide tekst',{exact:false}).selectOption(manual.id);await expect(bank.getByLabel('Wanneer beschikbaar',{exact:false})).toHaveValue('confirmed-tie');expect(h.proof.audio).toHaveLength(0);expect(h.proof.unexpected).toEqual([]);
  await page.reload();await main.getByRole('tab',{name:'Draaiboek',exact:true}).click();await main.locator('.mf-cue-list').getByRole('button',{name:new RegExp(originalGuest.title)}).click();await expect(editor.getByLabel('Tekst beurt 2',{exact:false})).toHaveValue(revised);await expect(editor.getByLabel('Regienotitie — wordt niet voorgelezen',{exact:false})).toHaveValue(note);expect(h.proof.audio).toHaveLength(0);
  await page.goto('/#/overview');const preparation=page.getByRole('region',{name:'Audio voorbereiden',exact:true});await expect(preparation.getByRole('button',{name:'Audio voorbereiden',exact:true})).toBeEnabled();await page.waitForTimeout(1200);expect(h.proof.audio).toHaveLength(0);const manifest=await h.audio.manifest();expect(manifest.items.some(item=>item.text.includes('ALLEEN REGIE:'))).toBe(false);expect(manifest.items.some(item=>item.sources.some(source=>source.kind==='manual'))).toBe(true);await preparation.getByRole('button',{name:'Audio voorbereiden',exact:true}).click();await expect(preparation).toContainText(`Alle ${manifest.total} vaste stemfragmenten zijn ingeladen`,{timeout:45000});expect(h.proof.audio.filter(request=>request.path==='/api/openai/speech')).toHaveLength(manifest.total);
  expect(h.proof.errors).toEqual([]);expect(h.proof.unexpected).toEqual([]);expect(h.proof.external).toEqual([]);expect(h.proof.writes.every(write=>write.status===200)).toBe(true);await mkdir(output,{recursive:true});await page.screenshot({path:output+'/premiere-manual-audio.png',fullPage:true});h.proof.premiere={moments:26,roundGoalCounts:[3,3,3,1],guestTurnsRetained:5,explanationPatterns:3,cueCards:20,noAudioBeforeButton:true,audioTotal:manifest.total,notesExcludedFromSpeech:true};await writeFile(output+'/premiere-editor.json',JSON.stringify(h.proof,null,2));
 }finally{await page.close();await h.close();}
});
