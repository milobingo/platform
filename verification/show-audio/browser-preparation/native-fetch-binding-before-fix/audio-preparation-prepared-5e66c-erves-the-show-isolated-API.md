# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: audio-preparation.spec.mjs >> prepared live Milo speaks two official balls 15 seconds apart with no hot speech requests, then pause/reload preserves the show; isolated API
- Location: tests/browser/audio-preparation.spec.mjs:86:1

# Error details

```
Error: expect(locator).toHaveText(expected) failed

Locator:  locator('section[aria-label="Audio voorbereiden"]').getByRole('status').first()
Expected: "Alle 123 vaste stemfragmenten zijn ingeladen in de regie."
Received: "Open het uitzendvenster om de audio daar ook vooraf in te laden."
Timeout:  30000ms

Call log:
  - Expect "toHaveText" locator('section[aria-label="Audio voorbereiden"]').getByRole('status').first() with timeout 30000ms
  - waiting for locator('section[aria-label="Audio voorbereiden"]').getByRole('status').first()
    5 × locator resolved to <p role="status">Audio voorbereiden… 0 van … fragmenten ingeladen.</p>
      - unexpected value "Audio voorbereiden… 0 van … fragmenten ingeladen."
    59 × locator resolved to <p role="status">Open het uitzendvenster om de audio daar ook voor…</p>
       - unexpected value "Open het uitzendvenster om de audio daar ook vooraf in te laden."

```

```yaml
- status: Open het uitzendvenster om de audio daar ook vooraf in te laden.
```

# Test source

```ts
  1  | import {test,expect} from '@playwright/test';
  2  | import {mkdir,writeFile} from 'node:fs/promises';
  3  | import {CHARACTERS} from '../../server/characters.js';
  4  | import {makeGame,generateBooks,activateBlock} from '../../server/bingo-model.js';
  5  | import {BingoStore} from '../../server/bingo-store.js';
  6  | import {handleBingo} from '../../server/bingo.js';
  7  | import {createSqliteDatabase} from '../../server/node-storage.js';
  8  | import {prepareAutomaticRules} from '../../server/game-rules.js';
  9  | import {createBlock} from '../../server/plan-model.js';
  10 | import {defaultPresentation} from '../../server/presentation-model.js';
  11 | import {createBrowserAudioFixture} from '../helpers/browser-audio-fixture.mjs';
  12 | import {splitSpeechText} from '../../public/speech-text.js';
  13 | import {NUMBER_NINE_AUDIENCE} from '../../public/bingo-speech.js';
  14 | 
  15 | const output=process.env.AUDIO_PREPARATION_EVIDENCE_ROOT||'verification/show-audio/browser';
  16 | const defer=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
  17 | 
  18 | // All APIs are intercepted. Show mutations execute the actual Bingo handler
  19 | // and SQLite CAS; the audio fixture uses actual manifest/cache identities and
  20 | // a 100ms synthetic WAV. This is cold browser preloading, not a paid provider run.
  21 | async function fixture(page,testInfo,{running=false}={}){
  22 |  const origin=new URL(testInfo.project.use.baseURL).origin,owner='qa-show-audio',db=createSqliteDatabase(':memory:'),store=new BingoStore(db),game=makeGame({brandId:'milo',title:'QA automatische showaudio',date:'2027-11-18T13:30',timeZone:'Europe/Amsterdam'},owner,origin);
  23 |  const story=createBlock('story',game.plan,'milo');Object.assign(story,{title:'Het verhaal van de sterrenhoed',text:'Milo opent de sterrenhoed. Een vrolijke ster zweeft over het plein. '.repeat(8).slice(0,480),hold:0});
  24 |  const guest=createBlock('guest',game.plan,'milo');Object.assign(guest,{title:'Kapitein Kora komt op bezoek',text:'Milo verwelkomt zijn beste vriend op het Sterrenplein.',guestId:'kora',dialogue:[{speakerId:'kora',text:'Ahoy, mijn lieve vrienden! Wat zijn jullie kaarten mooi!',animation:'wave'},{speakerId:'milo',text:'Welkom, Kora! Kom er gezellig bij.',animation:'welcome'}]});
  25 |  game.plan.blocks.splice(3,0,story,guest);prepareAutomaticRules(game);generateBooks(game,1,'qa-audio-book');Object.assign(game.books[0],{accountId:'qa-family',profileId:'qa-child',name:'Sam'});
  26 |  if(running){game.status='running';game.startedAt=Date.now()-120000;activateBlock(game,game.plan.blocks.findIndex(block=>block.type==='round'),0);Object.assign(game.state,{paused:true,drawn:[1,2,3,4,5,6,7,8],deck:Array.from({length:75},(_,i)=>i+1),lastCommit:{token:'qa-prior-eight',number:8,index:8,at:Date.now()-20000}});}
  27 |  await store.create(game);const path='/api/bingo/games/'+game.id,audio=createBrowserAudioFixture({owner,getGame:async()=>(await store.game(game.id)).data}),state={gateText:null,gate:null,gateSeen:false},proof={origin,gameId:game.id,errors:[],unexpected:[],external:[],forbiddenWrites:[],bingo:[],audio:[],audioPreparationRequests:audio.requests};
  28 |  await page.addInitScript(()=>{
  29 |   localStorage.setItem('mf-production','milo');window.__preparedAudioRendering={decodes:[],starts:[]};const Native=window.AudioContext;
  30 |   if(Native)window.AudioContext=class extends Native{
  31 |    async decodeAudioData(bytes,...args){const result=await super.decodeAudioData(bytes,...args);window.__preparedAudioRendering.decodes.push({at:Date.now(),duration:result.duration,frames:result.length});return result;}
  32 |    createBufferSource(){const source=super.createBufferSource(),start=source.start.bind(source);source.start=(...args)=>{window.__preparedAudioRendering.starts.push({at:Date.now(),duration:source.buffer?.duration,frames:source.buffer?.length,state:this.state});return start(...args);};return source;}
  33 |   };
  34 |  });
  35 |  page.on('pageerror',error=>proof.errors.push(error.message));page.on('console',message=>{if(message.type()==='error')proof.errors.push({text:message.text(),url:message.location().url});});
  36 |  await page.route('**/*',async route=>{
  37 |   const request=route.request(),url=new URL(request.url()),method=request.method();
  38 |   if(url.origin!==origin){proof.external.push(url.origin+url.pathname);return route.abort('blockedbyclient');}
  39 |   if(url.pathname==='/favicon.ico')return route.fulfill({status:204});
  40 |   if(!url.pathname.startsWith('/api/')&&!url.pathname.startsWith('/auth/'))return route.continue();
  41 |   if(method==='POST'&&['/api/openai/show-audio','/api/openai/speech'].includes(url.pathname)){
  42 |    const body=request.postDataJSON(),record={path:url.pathname,at:Date.now(),gameId:body.gameId,text:body.text,characterId:body.characterId,key:body.expectedKey,cacheOnly:body.cacheOnly};proof.audio.push(record);
  43 |    if(url.pathname.endsWith('/speech')&&body.text===state.gateText){state.gateSeen=true;await state.gate.promise;}
  44 |    await audio.handle(route);record.completedAt=Date.now();return;
  45 |   }
  46 |   const read=method==='GET'&&['/api/bingo/games',path,'/api/bingo/families'].includes(url.pathname),write=method==='PUT'&&url.pathname===path||method==='POST'&&['start','activate','heartbeat','pause','reserve','commit','audio-cue'].some(action=>url.pathname===path+'/'+action);
  47 |   if(read||write){const body=write?request.postDataJSON():undefined,record={path:url.pathname,method,at:Date.now(),...(body?{body}:{})};proof.bingo.push(record);const response=await handleBingo(new Request(request.url(),{method,headers:request.headers(),...(body?{body:JSON.stringify(body)}:{})}),{DB:db,AUTH_IDENTITY:{user:owner,email:'regie@example.test',admin:true}});record.status=response.status;record.completedAt=Date.now();return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:await response.text()});}
  48 |   if(method!=='GET'){proof.forbiddenWrites.push({path:url.pathname,method});return route.fulfill({status:403,json:{error:{message:'Only isolated show/preparation operations are allowed.'}}});}
  49 |   let body;
  50 |   if(url.pathname==='/api/auth/session')body={authenticated:true,user:owner,email:'regie@example.test',role:'regie',local:false,configured:true,localAvailable:false};
  51 |   else if(url.pathname===path+'/chat'||url.pathname===path+'/chat/stream'){
  52 |    body={...(url.searchParams.has('after')?{events:[]}:{messages:[]}),cursor:0,hasMore:false,self:{memberId:'qa-audio-host',role:'host',mutedUntil:0,canSend:true,reason:'',profiles:[]},serverTime:Date.now()};
  53 |    if(url.pathname.endsWith('/stream'))return route.fulfill({body:`event: sync\ndata: ${JSON.stringify({...body,reconnect:true})}\n\n`,headers:{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'private, no-store'}});
  54 |   }else if(url.pathname===path+'/chat/members')body={members:[],serverTime:Date.now()};
  55 |   else if(url.pathname==='/api/characters')body={characters:Object.values(CHARACTERS),revision:0};
  56 |   else if(url.pathname==='/api/openai/status')body={configured:true,canManage:true,source:'environment',environmentConfigured:true,revision:'qa-synthetic-only',liveVerified:false};
  57 |   else if(url.pathname==='/api/livekit/settings')body={configured:false,canManage:true,source:'none',environmentConfigured:false,revision:null};
  58 |   else if(url.pathname==='/api/live-calls')body={call:null,serverTime:Date.now()};
  59 |   else if(url.pathname==='/api/output')body={state:null,serverTime:Date.now()};
  60 |   else if(url.pathname==='/api/presentation/document')body={document:defaultPresentation(),revision:0};
  61 |   else{proof.unexpected.push(url.pathname+url.search);return route.fulfill({status:404,json:{error:{message:'Unknown isolated audio QA endpoint.'}}});}
  62 |   return route.fulfill({json:body,headers:{'Cache-Control':'private, no-store'}});
  63 |  });
  64 |  return {game,story,guest,audio,state,proof,read:async()=>(await store.game(game.id)).data,mutate:operation=>store.mutate(game.id,{},operation),close:()=>db.close()};
  65 | }
  66 | 
  67 | async function saveProof(name,h,page){const rendering=await page.evaluate(()=>window.__preparedAudioRendering).catch(()=>null),played=[...(rendering?.starts||[]),...(h.proof.beforeReloadAudio?.starts||[])].some(start=>start.duration>.09&&start.duration<.11&&start.state==='running');await mkdir(output,{recursive:true});await writeFile(`${output}/${name}.json`,JSON.stringify({observedAt:new Date().toISOString(),actualBrowserRendering:true,actualWebAudioDecodeAndPlayback:played,actualBingoHandlers:true,actualSQLiteCAS:true,coldBrowserMemory:true,serverPreparedAudioIsSyntheticFixture:true,syntheticWavDurationMs:100,actualProviderCalls:false,actualAccountWrites:false,actualOBSInstallation:false,scope:'All transport is intercepted; mutations exist only in this test in-memory database.',...h.proof,audioRendering:rendering},null,2)+'\n');}
  68 | async function shot(page,name){await mkdir(output+'/screenshots',{recursive:true});await page.screenshot({path:`${output}/screenshots/${name}.png`,fullPage:false});}
  69 | const speechRequests=proof=>proof.audio.filter(request=>request.path==='/api/openai/speech');
  70 | const starts=proof=>proof.bingo.filter(request=>request.path.endsWith('/start'));
> 71 | async function ready(page,total){const section=page.locator('section[aria-label="Audio voorbereiden"]');await expect(section).toBeVisible();await expect(section.getByRole('status').first()).toHaveText(`Alle ${total} vaste stemfragmenten zijn ingeladen in de regie.`,{timeout:30000});}
     |                                                                                                                                                                                               ^ Error: expect(locator).toHaveText(expected) failed
  72 | function assertBoundaries(proof){expect(proof.errors).toEqual([]);expect(proof.external).toEqual([]);expect(proof.unexpected).toEqual([]);expect(proof.forbiddenWrites).toEqual([]);expect(proof.bingo.every(request=>request.status===200)).toBe(true);}
  73 | 
  74 | test('saved Milo automatically loads the full bank on overview, refreshes edited script/dialogue and starts after the last audio byte; isolated API',async({page},testInfo)=>{
  75 |  test.setTimeout(90000);await page.setViewportSize({width:1366,height:900});await page.emulateMedia({reducedMotion:'reduce'});const h=await fixture(page,testInfo);
  76 |  try{
  77 |   const initial=await h.audio.manifest();await page.goto('/#/overview');await expect(page.locator('.mf-top-show>strong')).toHaveText(h.game.title);await ready(page,initial.total);expect(speechRequests(h.proof)).toHaveLength(initial.total);expect(new Set(speechRequests(h.proof).map(request=>request.key)).size).toBe(initial.total);expect(speechRequests(h.proof).every(request=>request.cacheOnly)).toBe(true);
  78 |   expect(initial.items.filter(item=>item.kind==='number')).toHaveLength(75);expect(initial.items.filter(item=>item.sources.some(source=>source.id===h.story.id))).toHaveLength(splitSpeechText(h.story.text).length);expect(initial.items.some(item=>item.characterId==='kora'&&item.kind==='dialogue')).toBe(true);expect(initial.items.some(item=>item.id===NUMBER_NINE_AUDIENCE.id)).toBe(true);h.proof.initialManifest={fingerprint:initial.fingerprint,total:initial.total,numberCalls:75,longStoryCharacters:h.story.text.length,longStoryParts:splitSpeechText(h.story.text).length,guestDialoguePrepared:true};await shot(page,'overview-bank-ready');
  79 |   await page.getByRole('button',{name:'Draaiboek bewerken',exact:true}).click();const main=page.locator('main#mf-main');await main.locator('.mf-cue-list').getByRole('button',{name:new RegExp(h.story.title)}).click();const storyText=main.getByLabel('Wat zegt het personage?',{exact:true});await expect(storyText).toHaveValue(h.story.text);const updatedStory='Het licht van Milo’s hoed danst vrolijk over de bingokaarten. '.repeat(9).slice(0,490);await storyText.fill(updatedStory);await expect(main.locator('[data-save-status="saved"]')).toContainText('Opgeslagen');await expect.poll(async()=>(await h.read()).plan.blocks.find(block=>block.id===h.story.id).text).toBe(updatedStory);
  80 |   await page.goto('/#/overview');const changed=await h.audio.manifest();await ready(page,changed.total);const oldKeys=new Set(initial.items.map(item=>item.key)),changedOnly=changed.items.filter(item=>!oldKeys.has(item.key));expect(changedOnly.length).toBeGreaterThan(0);expect(speechRequests(h.proof)).toHaveLength(initial.total+changedOnly.length);expect(speechRequests(h.proof).slice(initial.total).map(request=>request.key).sort()).toEqual(changedOnly.map(item=>item.key).sort());h.proof.editedStory={fingerprint:changed.fingerprint,newKeys:changedOnly.length,oldKeysReused:true};
  81 |   await page.getByRole('button',{name:'Draaiboek bewerken',exact:true}).click();await main.locator('.mf-cue-list').getByRole('button',{name:new RegExp(h.guest.title)}).click();const guestText='Ahoy! Een nieuwe magische groet voor alle bingovrienden.';h.state.gateText=guestText;h.state.gate=defer();await main.getByLabel('Gastzin',{exact:true}).fill(guestText);await main.getByRole('tab',{name:'Startcheck',exact:true}).click();const start=main.getByRole('button',{name:'Start show',exact:true});await expect(start).toBeEnabled();await start.click();await expect.poll(()=>h.state.gateSeen).toBe(true);await page.waitForTimeout(200);expect(starts(h.proof)).toHaveLength(0);expect((await h.read()).status).toBe('draft');await expect(main.getByRole('button',{name:'Even bezig…',exact:true})).toBeVisible();h.proof.startWaitedForAudio=true;h.proof.audioGateReleasedAt=Date.now();h.state.gate.resolve();
  82 |   await expect(page).toHaveURL(/#\/live/);await expect.poll(async()=>(await h.read()).status).toBe('running');expect(starts(h.proof)).toHaveLength(1);expect(starts(h.proof)[0].at).toBeGreaterThanOrEqual(h.proof.audioGateReleasedAt);expect((await h.read()).events.filter(event=>event.type==='show-started')).toHaveLength(1);expect((await h.read()).plan.blocks.find(block=>block.id===h.guest.id).dialogue[0].text).toBe(guestText);const final=await h.audio.manifest(),allExpected=new Set([...initial.items,...changed.items,...final.items].map(item=>item.key));expect(speechRequests(h.proof)).toHaveLength(allExpected.size);expect(new Set(speechRequests(h.proof).map(request=>request.key)).size).toBe(allExpected.size);h.proof.finalManifest={fingerprint:final.fingerprint,total:final.total,singleStart:true,manualSaveRequired:false,manualAudioPreparationRequired:false};await shot(page,'single-start-after-audio');assertBoundaries(h.proof);
  83 |  }finally{h.state.gate?.resolve();await saveProof('automatic-bank-and-start',h,page);await page.close();await h.close();}
  84 | });
  85 | 
  86 | test('prepared live Milo speaks two official balls 15 seconds apart with no hot speech requests, then pause/reload preserves the show; isolated API',async({page},testInfo)=>{
  87 |  test.setTimeout(120000);await page.setViewportSize({width:1366,height:900});await page.emulateMedia({reducedMotion:'reduce'});const h=await fixture(page,testInfo,{running:true});
  88 |  try{
  89 |   const manifest=await h.audio.manifest();await page.goto('/#/overview');await ready(page,manifest.total);const preloaded=speechRequests(h.proof).length;expect(preloaded).toBe(manifest.total);await page.getByRole('button',{name:'Hervat regie',exact:true}).click();await expect(page).toHaveURL(/#\/live/);const essentials=page.locator('.mf-live-essentials'),timer=essentials.getByRole('timer',{name:'Volgende officiële bal'});await expect(essentials.locator('.mf-live-ball')).toHaveText('8');await expect(timer).toContainText('Gepauzeerd');expect((await h.read()).state.drawn).toEqual([1,2,3,4,5,6,7,8]);
  90 |   const resumedAt=Date.now();await essentials.getByRole('button',{name:'Hervat',exact:true}).click();await expect(essentials.getByRole('button',{name:'Pauze',exact:true})).toBeEnabled();await expect.poll(async()=>(await h.read()).state.drawn.length,{timeout:22000}).toBe(9);await expect(essentials.locator('.mf-live-ball')).toHaveText('9');const first=(await h.read()).state.lastCommit;expect(first.at-resumedAt).toBeGreaterThanOrEqual(15000);await expect.poll(async()=>Boolean((await h.read()).audioCues?.[NUMBER_NINE_AUDIENCE.id]),{timeout:7000}).toBe(true);await expect.poll(async()=>(await h.read()).state.drawn.length,{timeout:20000}).toBe(10);await expect(essentials.locator('.mf-live-ball')).toHaveText('10');const second=(await h.read()).state.lastCommit,gap=second.at-first.at;expect(gap).toBeGreaterThanOrEqual(15000);expect(gap).toBeLessThan(17000);expect(speechRequests(h.proof)).toHaveLength(preloaded);expect(starts(h.proof)).toHaveLength(0);await expect.poll(()=>page.evaluate(()=>window.__preparedAudioRendering.starts.filter(start=>start.duration>.09&&start.duration<.11&&start.state==='running').length)).toBeGreaterThanOrEqual(3);
  91 |   h.proof.cadence={first:{number:first.number,at:first.at},second:{number:second.number,at:second.at},gapMs:gap,fullBrowserAndServerWallClock:true,hotSpeechRequests:0,numberNineReceipt:(await h.read()).audioCues[NUMBER_NINE_AUDIENCE.id]};await essentials.getByRole('button',{name:'Pauze',exact:true}).click();await expect.poll(async()=>(await h.read()).state.paused).toBe(true);await expect(timer).toContainText('Gepauzeerd');const paused=await h.read();await page.waitForTimeout(16000);expect((await h.read()).state.drawn).toEqual(paused.state.drawn);expect((await h.read()).state.lastCommit).toEqual(paused.state.lastCommit);expect(speechRequests(h.proof)).toHaveLength(preloaded);h.proof.pauseHeldAcrossAnEntireInterval=true;h.proof.beforeReloadAudio=await page.evaluate(()=>window.__preparedAudioRendering);await shot(page,'live-two-official-balls-paused');
  92 |   // An isolated server-observed claim window must survive loading the bank and
  93 |   // restoring the view; this does not simulate validation of a real claim.
  94 |   await h.mutate(game=>{game.state.phase='window';game.state.window={id:'qa-audio-window',status:'open',startedAt:Date.now(),endsAt:Date.now()+600000,frozenAt:game.state.drawn.length,announcements:[],claims:[]};});await expect(timer).toContainText('BINGO-meldvenster',{timeout:7000});await expect(essentials.getByRole('button',{name:'Hervat',exact:true})).toBeDisabled();h.proof.syntheticBingoWindow=true;const window=(await h.read()).state.window;
  95 |   await page.reload();await expect(page.locator('.mf-top-show>strong')).toHaveText(h.game.title);await expect(essentials.locator('.mf-live-ball')).toHaveText('10');await expect(timer).toContainText('BINGO-meldvenster');await expect(page.getByRole('button',{name:'Hervat regie',exact:true})).toBeVisible();await expect.poll(()=>speechRequests(h.proof).length,{timeout:15000}).toBe(preloaded+manifest.total);expect((await h.read()).state.drawn).toEqual(paused.state.drawn);expect((await h.read()).state.epoch).toBe(paused.state.epoch);expect((await h.read()).state.window).toEqual(window);expect((await h.read()).audioCues[NUMBER_NINE_AUDIENCE.id]).toEqual(h.proof.cadence.numberNineReceipt);expect(starts(h.proof)).toHaveLength(0);h.proof.reload={sameGame:true,sameRoundEpoch:true,sameDrawn:true,paused:true,openBingoWindowPreserved:true,coldBankReloaded:true,numberNineReceiptPreserved:true};assertBoundaries(h.proof);
  96 |  }finally{await saveProof('live-cadence-and-reload',h,page);await page.close();await h.close();}
  97 | });
  98 | 
```