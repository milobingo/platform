import {ensureWinnerCallCue,assertCallCueProgress,expireDeferredCallCues} from './call-cues.js';
import {brandId,validBrand,brandProfile,showBrand,switchPlanBrand,repairLegacyPlanBrand} from './show-brands.js';
import {playerIdentity,birthAge,refreshAges} from './player-identity.js';
import {productionAction} from './production.js';
import {productionEvent,productionSettings} from './production-model.js';
import {BingoStore} from './bingo-store.js';
import {cancelGameCallResources} from './live-calls.js';
import {cancelGameOutput} from './output.js';
import {BingoError,minigamesForBrand,enabledMinigameIds,assertDrawAvailable,assertShowNotCancelled,forceCancelGame,normalizeBingoPlan,assertClaimContext,assertOwnedBook,assertBookAccountLimit,assertBookAccountsReady,makeGame,gameSettings,integer,cleanText,bingoPrintMode,generateBooks,activateBlock,reserveBall,commitBall,beginBingo,claimBook,settleWindow,playerGame,randomIndex,checkAccount} from './bingo-model.js';
import {normalizeShowTime} from './show-time.js';
import {publishGameRules,assertRulesCurrent,prepareAutomaticRules,finalizeGameRules} from './game-rules.js';
import {automaticRules,isStandardMiloGame,STANDARD_MILO_PROFILE,loadStandardMiloPlan,resetDrawClock} from './standard-show.js';
import {PresentationStore} from './presentation-store.js';
import {presentationSelection,freezePresentation} from './presentation-model.js';
import {bookPdf,PRINT_VERSION,printVersion} from './bingo-pdf.js';
import {handleBingoOrders} from './bingo-orders.js';
import {assertStartCapacity,gameCapacity} from './game-capacity.js';
import {recordResultMailEvent,dispatchPublishedPrizeMail} from './mail-domain-events.js';
import {broadcastSettings,normalizeYoutubeId} from './broadcast-settings.js';
import {optionalSpeechCue,NUMBER_NINE_AUDIENCE} from '../public/bingo-speech.js';
import {activeOrders,orderShow,assertOrderStartReady,assertOrderBookIntegrity} from './bingo-order-model.js';
import {duplicateShowDraft,freshProduction,freshOrdering,showCreateBinding} from './show-duplicate.js';
const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
const json=(data,status=200)=>Response.json(data,{status,headers});
const hostGame=game=>{const copy=structuredClone(game);copy.plan=repairLegacyPlanBrand(copy.plan,copy);copy.production=productionSettings(copy.production,copy);copy.capacity=gameCapacity(game);copy.preparationRevision=game.preparationRevision||0;copy.broadcastRevision=broadcastSettings(game).revision;copy.serverTime=Date.now();delete copy.state.deck;delete copy.chat;return copy;};
async function hostGameWithCleanup(game,env){
 const copy=hostGame(game);if(!copy.cancellation)return copy;
 let pending=!!(game.state.callId||game.state.drawHold);
 try{const row=await env.DB.prepare('SELECT document FROM studio_calls WHERE owner_id = ?').bind(game.ownerId).first(),call=row?JSON.parse(row.document):null;if(call?.gameId===game.id)pending=call.resourcesClosed!==true&&(call.transport==='livekit'||!!(call.realtimeId||call.realtimeStarted)||!['ended','declined','missed','failed'].includes(call.phase));}
 catch{pending=true;}
 // Derived host-only metadata: closure proof stays in the call journal, never
 // in the immutable cancellation record or the public family projection.
 copy.cancellation.cleanupPending=pending;return copy;
}
function presentationValue(fn){try{return fn();}catch(error){throw new BingoError(error.message,400,'presentation_choice');}}
async function operationDigest(value){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),byte=>byte.toString(16).padStart(2,'0')).join('');}
const publicClaim=claim=>{if(!claim)return claim;const copy={...claim};delete copy.operation;return copy;};
async function creationId(ownerId,requestId){
 // A repeated creation request must target the same primary key, including when
 // both requests arrive before either insert has committed. Scope it per host.
 const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(['bingo-show-v1',ownerId,requestId]))));
 bytes[6]=(bytes[6]&15)|128;bytes[8]=(bytes[8]&63)|128;
 const hex=Array.from(bytes.slice(0,16),v=>v.toString(16).padStart(2,'0')).join('');
 return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
async function bodyOf(request){const raw=await request.text();if(new TextEncoder().encode(raw).length>300000)throw new BingoError('De aanvraag is te groot.',413);try{return JSON.parse(raw||'{}');}catch{throw new BingoError('De aanvraag kon niet worden gelezen.');}}
export async function handleBingo(request,env={}){
 const {user,email,admin}=await playerIdentity(request,env),url=new URL(request.url),path=url.pathname.slice('/api/bingo'.length),write=!['GET','HEAD'].includes(request.method);
 if(!user)return json({error:{code:'sign_in',message:'Log in om jouw boekjes te beheren.'}},401);
 if(request.headers.get('sec-fetch-site')==='cross-site'||request.headers.get('origin')&&request.headers.get('origin')!==url.origin||write&&(request.headers.get('origin')!==url.origin||request.headers.get('x-vlampie-bingo')!=='1'))return json({error:{code:'origin',message:'Gebruik deze functie vanuit de showstudio of spelersapp.'}},403);
 if(!env.DB?.prepare)return json({error:{code:'unavailable',message:'De speladministratie is tijdelijk niet beschikbaar.'}},503);
 const store=new BingoStore(env.DB),now=Date.now();
 try{
  const body=write?await bodyOf(request):{},requestId=typeof body.requestId==='string'&&/^[a-zA-Z0-9_-]{8,100}$/.test(body.requestId)?body.requestId:crypto.randomUUID();
  const requireHost=()=>{if(!admin)throw new BingoError('Alleen de host kan deze functie gebruiken.',403);};
  if(path==='/me'&&request.method==='GET'){const row=await store.family(user,email);return json({accountId:user,host:admin,family:refreshAges(row.data),serverTime:Date.now(),minigames:minigamesForBrand(url.searchParams.get('brand'))});}
  if(path==='/profiles'&&request.method==='POST'){
   const saved=await store.editFamily(user,email,family=>{const prior=family.profiles.find(p=>p.createRequestId===requestId);if(prior)return prior;if(family.profiles.length>=30)throw new BingoError('Een account kan maximaal 30 personen beheren.');const profile={id:crypto.randomUUID(),createRequestId:requestId,name:cleanText(body.name,40,'voornaam'),age:body.dateOfBirth?birthAge(body.dateOfBirth):integer(body.age,0,120,'Leeftijd'),...(body.dateOfBirth?{dateOfBirth:body.dateOfBirth}:{})};family.profiles.push(profile);return profile;});return json(saved,201);
  }
  if(path==='/games'&&request.method==='GET'){const rows=await store.games();return json({games:rows.filter(r=>!admin||r.owner_id===user).map(r=>({...orderShow(r.data,now),bookCount:r.data.books.length,linked:r.data.books.filter(b=>b.accountId).length,createdAt:r.data.createdAt})),serverTime:Date.now()});}
  if(path==='/games'&&request.method==='POST'){
   requireHost();const id=await creationId(user,requestId);
   // Keep retries of shows created before stable IDs working as well.
   const existing=await store.game(id)||(await store.games()).find(r=>r.data.createRequestId===requestId&&r.owner_id===user);
   if(existing?.owner_id===user&&existing.data.createRequestId===requestId&&!existing.data.creationBinding)return json({game:hostGame(existing.data)});
   const binding=await showCreateBinding(body);
   if(existing){if(existing.owner_id!==user||existing.data.createRequestId!==requestId||existing.data.creationBinding&&existing.data.creationBinding!==binding)throw new BingoError('Dit verzoek is al met andere invoer gebruikt. Maak een nieuw verzoek voor deze show.',409,'request_conflict');return json({game:hostGame(existing.data)});}
   const game=makeGame(body,user,url.origin,now);game.id=id;game.createRequestId=requestId;game.creationBinding=binding;if(body.production!==undefined)game.production=freshProduction(body.production,{identity:game,sourceDate:game.date,date:game.date});if(body.ordering!==undefined)game.ordering=freshOrdering(body.ordering,{sourceDate:game.date,date:game.date});if(automaticRules(game))prepareAutomaticRules(game,now);
   const presentation=await new PresentationStore(env.DB).read(user);game.presentationSelection=presentationValue(()=>presentationSelection(body.presentationSelection,presentation.document));
   try{await store.create(game);}catch(error){
    // An identical in-flight request may have won the insert. Never report a
    // successful retry unless the persisted row belongs to this exact request.
    const winner=await store.game(id);
    if(winner){if(winner.owner_id!==user||winner.data.createRequestId!==requestId||winner.data.creationBinding&&winner.data.creationBinding!==binding)throw new BingoError('Dit verzoek is al met andere invoer gebruikt. Maak een nieuw verzoek voor deze show.',409,'request_conflict');return json({game:hostGame(winner.data)});}
    throw error;
   }
   return json({game:hostGame(game)},201);
  }
  if(path==='/families'&&request.method==='GET'){requireHost();const shows=(await store.games()).filter(row=>row.owner_id===user),accounts=new Set(shows.flatMap(row=>[...row.data.books.map(book=>book.accountId),...(row.data.orders||[]).map(order=>order.accountId)]).filter(Boolean));return json({families:(await store.families()).filter(row=>accounts.has(row.account_id)).map(row=>({accountId:row.account_id,email:row.data.email,blocked:!!row.data.blocked,blockedGames:row.data.blockedGames,falseCounts:row.data.falseCounts,cooldowns:row.data.cooldowns,profiles:row.data.profiles.map(profile=>({id:profile.id,name:profile.name,age:profile.age}))}))});}
  const orderResponse=await handleBingoOrders({path,request,url,body,requestId,user,email,admin,store,env,now,json,hostGame});if(orderResponse)return orderResponse;
  const match=path.match(/^\/games\/([a-f0-9-]{36})(?:\/(.*))?$/);
  if(match){
   const id=match[1],action=match[2]||'',row=await store.game(id);if(!row)throw new BingoError('Dit spel bestaat niet.',404);if(admin&&row.owner_id!==user)throw new BingoError('Dit spel hoort bij een andere host.',403);
   const scopedId=`${user}:${request.method}:${path}:${requestId}`,options={requestId:scopedId,authorize:assertShowNotCancelled},ownOptions={requestId:scopedId,accountId:user,email};
   const preparationCheck=game=>{if(body.expectedPreparationRevision!==undefined&&(!Number.isSafeInteger(body.expectedPreparationRevision)||body.expectedPreparationRevision!==(game.preparationRevision||0)))throw new BingoError('Het draaiboek is in een ander venster gewijzigd. Jouw invoer is bewaard. Vergelijk de actuele voorbereiding voordat je opnieuw opslaat.',409,'preparation_conflict');};
   const control=(game,now)=>{assertShowNotCancelled(game);if(game.status==='finished')throw new BingoError('Deze show is afgelopen. Maak een nieuwe show.',409,'show_finished');const client=cleanText(body.regieId,100,'regievenster');if(game.state.control&&game.state.control.id!==client&&game.state.control.until>now)throw new BingoError('Dit spel wordt al vanuit een ander regievenster bestuurd. Sluit dat venster of wacht 15 seconden.',409,'control_busy');game.state.control={id:client,until:now+15000};};
   if(action==='duplicate'&&request.method==='POST'){
    requireHost();if(!/^application\/json(?:;|$)/i.test(request.headers.get('content-type')||''))throw new BingoError('Verstuur de nieuwe showgegevens als JSON.',415,'content_type');
    const duplicated=await duplicateShowDraft({store,source:row.data,ownerId:user,origin:url.origin,now,body,id:await creationId(user,body.requestId)});
    return json({...duplicated,game:hostGame(duplicated.game)},duplicated.replayed?200:201);
   }
   if(!action&&request.method==='GET'){
    let game=row.data;if(game.status!=='finished'&&game.state.window?.status==='open'&&Date.now()>=game.state.window.endsAt)game=(await store.mutate(id,{},(g,_family,now)=>settleWindow(g,now))).game;
    return json({game:admin&&url.searchParams.get('player')!=='1'?await hostGameWithCleanup(game,env):playerGame(game,user),serverTime:Date.now()});
   }
   if(action==='broadcast'&&request.method==='POST'){
    requireHost();
    if(!/^application\/json(?:;|$)/i.test(request.headers.get('content-type')||''))throw new BingoError('Verstuur de uitzendinstellingen als JSON.',415,'content_type');
    if(Object.keys(body).some(key=>!['youtubeId','expectedBroadcastRevision','requestId','regieId'].includes(key)))throw new BingoError('Wijzig hier alleen de YouTube-uitzending.',400,'broadcast_fields');
    if(!Number.isSafeInteger(body.expectedBroadcastRevision)||body.expectedBroadcastRevision<0)throw new BingoError('Herlaad de uitzendinstellingen voordat je opslaat.',400,'broadcast_revision');
    const youtubeId=normalizeYoutubeId(body.youtubeId),binding=await operationDigest(['broadcast',youtubeId,body.expectedBroadcastRevision]);
    const result=await store.mutate(id,{...options,binding,authorize:g=>{if(g.ownerId!==user)throw new BingoError('Deze show hoort bij een andere host.',403);assertShowNotCancelled(g);if(!['draft','running'].includes(g.status))throw new BingoError('Deze show is afgelopen. De uitzending kan niet meer worden gewijzigd.',409,'show_finished');}},(g)=>{
     const current=broadcastSettings(g);
     if(current.revision!==body.expectedBroadcastRevision)throw Object.assign(new BingoError('De YouTube-uitzending is in een ander venster gewijzigd. Je invoer blijft bewaard. Controleer de opgeslagen uitzending voordat je opnieuw probeert.',409,'broadcast_conflict'),{broadcast:current});
     g.settings={...g.settings,youtubeId};g.broadcastRevision=current.revision+1;
     return broadcastSettings(g);
    });return json({game:hostGame(result.game),broadcast:broadcastSettings(result.game)});
   }
   if(action==='audio-cue'&&request.method==='POST'){
    requireHost();if(!/^application\/json(?:;|$)/i.test(request.headers.get('content-type')||''))throw new BingoError('Verstuur het presentatormoment als JSON.',415,'content_type');const cue=optionalSpeechCue(body.cueId);
    if(!cue)throw new BingoError('Kies een beschikbaar kort presentatormoment.',400,'audio_cue_invalid');
    const authorize=g=>{if(g.ownerId!==user)throw new BingoError('Deze show hoort bij een andere host.',403);assertShowNotCancelled(g);if(brandId(g)!=='milo'||g.status!=='running')throw new BingoError('Dit presentatormoment hoort bij een lopende Milo-show.',409,'audio_cue_unavailable');};
    const result=await store.mutate(id,{requestId:scopedId,authorize,durableReplay:g=>g.audioCues?.[cue.id]?{result:{claimed:false}}:null},(g,_family,at)=>{
     if(!body.regieId||g.state.control?.id!==body.regieId||!(g.state.control.until>at))throw new BingoError('Alleen het actieve regievenster kan dit presentatormoment afspelen. Hervat eerst de regie.',409,'control_busy');
     assertDrawAvailable(g);
     if(g.state.paused||g.state.phase!=='running'||g.state.window?.status==='open'||g.state.resultId||g.state.pending||g.state.callId)throw new BingoError('Het presentatormoment wacht tot de trekking vrij is.',409,'audio_cue_held');
     if(body.expectedEpoch!==undefined&&body.expectedEpoch!==g.state.epoch)throw new BingoError('Deze ronde is intussen gewijzigd.',409,'audio_cue_stale');
     if(body.expectedNumber!==undefined&&body.expectedNumber!==g.state.lastCommit?.number)throw new BingoError('Er is intussen een andere officiële bal getoond.',409,'audio_cue_stale');
     if(cue.id===NUMBER_NINE_AUDIENCE.id&&(g.state.lastCommit?.number!==9||!g.state.drawn.includes(9)))throw new BingoError('Dit moment hoort alleen bij de officieel getoonde negen.',409,'audio_cue_number');
     g.audioCues={...(g.audioCues||{}),[cue.id]:{at,by:user,requestId,epoch:g.state.epoch,number:g.state.lastCommit?.number||null}};
     return {claimed:true};
    });return json({claimed:result.result?.claimed===true,game:hostGame(result.game)});
   }
   if(action==='brand'&&request.method==='POST'){
    requireHost();const next=validBrand(body.brandId);const result=await store.mutate(id,options,(g,_family,now)=>{control(g,now);assertDrawAvailable(g);if((g.status!=='draft'||g.rulesPublication)&&brandId(g)!==next)throw new BingoError('De showwereld staat vast zodra de regels gepubliceerd zijn of de show gestart is.',409,'brand_locked');if(activeOrders(g)&&brandId(g)!==next)throw new BingoError('De showwereld staat vast zolang er bestellingen voor deze show bestaan.',409);if(g.state.callId)throw new BingoError('Rond eerst het belmoment af voordat je de showhost wisselt.',409,'call_active');if(g.status==='finished')throw new BingoError('Deze show is afgelopen. De opgeslagen showidentiteit blijft bewaard.',409);const previous=showBrand(g);g.plan=switchPlanBrand(g.plan,previous,next);g.brandId=next;g.settings={...g.settings,minigames:enabledMinigameIds(g)};if(g.title===previous.title)g.title=showBrand(g).title;if(g.presentationSnapshot){g.presentationSnapshot.profile=brandProfile(g.presentationSnapshot.profile,g);g.presentationSnapshot.frozenAt=now;} });return json({game:hostGame(result.game)});
   }
   if(!action&&request.method==='PUT'){
    requireHost();const presentation=body.presentationSelection?await new PresentationStore(env.DB).read(user):null;const result=await store.mutate(id,options,(g,_family,now)=>{if(g.status!=='draft')throw new BingoError('De voorbereiding staat vast: deze show is bezig. Hervat de regie om verder te gaan.',409,'preparation_locked');preparationCheck(g);const plan=normalizeBingoPlan(body.plan||g.plan),schedule=body.date?normalizeShowTime(body.date,{timeZone:body.timeZone}):{date:g.date,timeZone:g.timeZone},rounds=plan.blocks.filter(b=>b.type==='round'),old=g.plan.blocks.filter(b=>b.type==='round');if((g.books.length||activeOrders(g))&&(rounds.length!==old.length||rounds.some((r,i)=>r.title!==old[i].title)||body.title&&body.title!==g.title||body.date&&schedule.date!==g.date))throw new BingoError('Spelnaam, datum en ronde-indeling staan vast zodra er boekjes of actieve bestellingen zijn.');g.plan=plan;g.title=cleanText(body.title||g.title,60,'spelnaam');Object.assign(g,schedule);g.settings=gameSettings({...body.settings||g.settings,youtubeId:g.settings.youtubeId||''},g);if(presentation)g.presentationSelection=presentationValue(()=>presentationSelection(body.presentationSelection,presentation.document));if(automaticRules(g)){prepareAutomaticRules(g,now);}else if(g.rulesPublication){if(body.publishRules===true){const reason=cleanText(body.rulesChangeReason,300,'reden voor de gewijzigde regels');if(reason.length<10)throw new BingoError('Licht de gecontroleerde regelwijziging toe (minimaal tien tekens).');const oldVersion=g.rulesPublication.version;publishGameRules(g,now);if(g.rulesPublication.version!==oldVersion)productionEvent(g,'rules-republished',{previousVersion:oldVersion,version:g.rulesPublication.version,reason},now);}else assertRulesCurrent(g);}g.preparationRevision=(g.preparationRevision||0)+1;});return json({game:hostGame(result.game)});
   }
   if(action==='load-standard'&&request.method==='POST'){
    requireHost();const result=await store.mutate(id,options,(g,_family,now)=>{
     if(brandId(g)!=='milo'||g.status!=='draft')throw new BingoError('Standaardregels zijn alleen beschikbaar voor een Milo-conceptshow.',409,'preparation_locked');
     preparationCheck(g);assertDrawAvailable(g);
     if((g.orders||[]).length||g.books.some(book=>book.accountId))throw new BingoError('De regels staan vast voor bestaande deelnemers of bestellingen. Gebruik voor andere regels een nieuwe show.',409,'rules_locked');
     if(g.books.length&&g.plan.blocks.filter(block=>block.type==='round').length!==4)throw new BingoError('De gedrukte rondekaarten horen bij het bestaande aantal rondes. Maak voor vier standaardrondes een nieuwe show.',409,'rules_locked');
     g.plan=normalizeBingoPlan(loadStandardMiloPlan(g.plan));g.settings=gameSettings({...g.settings,mode:'auto',rulesProfile:STANDARD_MILO_PROFILE},g);prepareAutomaticRules(g,now);g.preparationRevision=(g.preparationRevision||0)+1;productionEvent(g,'standard-rules-loaded',{},now);
    });return json({game:hostGame(result.game)});
   }
   if(action==='publish-rules'&&request.method==='POST'){requireHost();const result=await store.mutate(id,options,(g,_family,now)=>{normalizeBingoPlan(g.plan);assertBookAccountsReady(g);publishGameRules(g,now);productionEvent(g,'rules-published',{version:g.rulesPublication.version,publicationId:g.rulesPublication.id},now);});return json({game:hostGame(result.game)});}
   if(action==='generate'&&request.method==='POST'){requireHost();const result=await store.mutate(id,options,(g,_family,now)=>generateBooks(g,body.count,requestId,now,{mode:body.printMode}));const batch=result.result||result.game.batches.find(b=>b.requestId===requestId);return json({game:hostGame(result.game),batch,pdf:`/api/bingo/games/${id}/batches/${batch.id}/pdf`},201);}
   const batchMatch=action.match(/^batches\/([a-f0-9-]{36})\/pdf$/),bookMatch=action.match(/^books\/([a-f0-9-]{36})\/pdf$/);
   if((batchMatch||bookMatch)&&request.method==='GET'){
    const game=row.data;let bookIds,fileId,batch;
    if(batchMatch){requireHost();batch=game.batches.find(b=>b.id===batchMatch[1]);if(!batch)throw new BingoError('Deze PDF bestaat niet.',404);bookIds=batch.bookIds;fileId=batch.id;}
    else{const book=game.books.find(b=>b.id===bookMatch[1]&&(admin||b.accountId===user));if(!book)throw new BingoError('Dit boekje hoort niet bij jouw account.',403);assertOrderBookIntegrity(game,book,{accountId:admin?book.accountId:user,download:true});bookIds=[book.id];fileId=`boek-${book.id}`;batch=game.batches.find(b=>b.id===book.batchId);}
    // Appearance only affects this rendering; existing cards, codes and batch metadata stay intact.
    const format=url.searchParams.get('format')||'a5';if(!['a5','a4'].includes(format))throw new BingoError('Kies A5 of A4 als afdrukformaat.');
    const mode=bingoPrintMode(url.searchParams.has('mode')?url.searchParams.get('mode'):batch?.print?.mode??'mono'),key=`bingo-pdfs/${printVersion(game)}/${brandId(game)}/${format.toUpperCase()}/${mode}/${id}/${fileId}`,pdfHeaders={...headers,'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="${showBrand(game).name.replace(/ /g,'-')}-${format.toUpperCase()}-${mode==='color'?'kleur':'zwart-wit'}-${bookIds.length}-${bookIds.length===1?'boekje':'boekjes'}.pdf"`};
    const file=await env.SETTINGS?.get(key);if(file)return new Response(file.body,{headers:pdfHeaders});
    const bytes=await bookPdf(game,bookIds,{mode,format});await env.SETTINGS?.put(key,bytes,{httpMetadata:{contentType:'application/pdf'}});return new Response(bytes,{headers:pdfHeaders});
   }
   if(action==='register'&&request.method==='POST'){
    const result=await store.mutate(id,ownOptions,(g,f,now)=>{prepareAutomaticRules(g,now);checkAccount(f,g,now);if(g.status!=='draft')throw new BingoError('Deze show is gestart of afgelopen. Nieuwe boekjes koppelen is gesloten.',409);const profile=f.profiles.find(p=>p.id===body.profileId);if(!profile)throw new BingoError('Kies eerst een persoon binnen jouw account.');f.codeAttempts=f.codeAttempts?.until>now?f.codeAttempts:{count:0,until:now+600000};if(f.codeAttempts.count>=10)throw new BingoError('Te veel onjuiste codes. Probeer over tien minuten opnieuw.',429);const code=String(body.code||'').toUpperCase().replace(/[^A-Z0-9]/g,''),book=g.books.find(b=>body.token?b.token===body.token:b.code===code);if(!book){f.codeAttempts.count++;return {error:'Deze code hoort niet bij dit spel.'};}if(book.revokedAt)throw new BingoError('Dit boekje is ingetrokken. Vraag de host om hulp.',409);if(book.accountId&&(book.accountId!==user||book.profileId&&book.profileId!==profile.id))throw new BingoError('Dit boekje is al aan een persoon gekoppeld.',409);assertBookAccountLimit(g,user,book.id);book.accountId=user;book.profileId=profile.id;book.name=profile.name;book.age=profile.dateOfBirth?birthAge(profile.dateOfBirth):profile.age;if(book.issueStatus==='paid-ready'){book.admitted=true;book.issueStatus='assigned';}f.codeAttempts.count=0;return {bookId:book.id};});if(result.result?.error)throw new BingoError(result.result.error);return json({game:playerGame(result.game,user),family:result.family});
   }
   const productionResponse=await productionAction({action,request,body,url,row,store,id,user,email,admin,env,options,ownOptions,now,control,hostGame,playerGame,json});if(productionResponse)return productionResponse;
   if(['begin','claim'].includes(action)&&request.method==='POST'){
    const context=body.claimContext;
    // Canonical order binds semantically identical inputs, without retaining a
    // client's arbitrary extra properties or returning another account's data.
    const boundContext=context&&typeof context==='object'?Object.fromEntries(['gameId','brandId','roundId','goalId','epoch','patternVersion','windowId','windowStatus','windowSequence'].map(key=>[key,context[key]??null])):null;
    const binding=JSON.stringify([id,user,action,boundContext,action==='claim'?body.bookId??null:null]);
    const [operationKey,bindingHash]=await Promise.all([operationDigest(scopedId),operationDigest(binding)]);
    const durableReplay=g=>{
     const windows=[g.state.window,...g.events.filter(event=>event.type==='window-closed')];
     for(const window of windows){const records=action==='claim'?window?.claims:window?.announcements;for(const record of records||[])if(record.operation?.key===operationKey){if(record.accountId!==user||record.operation.binding!==bindingHash)throw new BingoError('Dit verzoek is met andere invoer gebruikt. Bevestig opnieuw.',409,'request_conflict');return {result:record};}}return null;
    };
    const authorize=g=>{assertShowNotCancelled(g);if(action==='claim')assertOwnedBook(g,user,body.bookId);else if(!g.books.some(book=>book.accountId===user&&book.admitted&&!book.revokedAt))throw new BingoError('Koppel eerst een boekje voor deze show.',403,'book_forbidden');};
    const result=await store.mutate(id,{...ownOptions,serializeLocal:true,binding,authorize,durableReplay},(g,f,now)=>{
     assertClaimContext(g,context,{claim:action==='claim'});
     const record=action==='claim'?claimBook(g,f,user,body.bookId,now):beginBingo(g,f,user,requestId,now);
     record.operation??={key:operationKey,binding:bindingHash};return record;
    });
    return json({game:playerGame(result.game,user),family:result.family,...(action==='claim'?{claim:publicClaim(result.result)}:{}),serverTime:Date.now()});
   }

   requireHost();
   if(action==='force-cancel'&&request.method==='POST'){
    if(typeof body.requestId!=='string'||!/^[a-zA-Z0-9_-]{8,100}$/.test(body.requestId)||body.confirm!==true||typeof body.expectedTitle!=='string')throw new BingoError('Bevestig expliciet welke draaiende show je definitief wilt annuleren.',400,'cancel_confirmation');
    if(body.reason!==undefined&&(typeof body.reason!=='string'||body.reason.length>300))throw new BingoError('Gebruik maximaal 300 tekens voor de reden.',400,'cancel_reason');
    const reason=body.reason?.trim()||'Handmatig geannuleerd door de regie',binding=JSON.stringify([body.expectedTitle,reason]);
    const result=await store.mutate(id,{requestId:scopedId,binding,authorize:g=>{if(g.ownerId!==user)throw new BingoError('Deze show hoort bij een andere host.',403);if(body.expectedTitle!==g.title)throw new BingoError('De shownaam is gewijzigd. Controleer de actuele show voordat je annuleert.',409,'cancel_confirmation');},durableReplay:g=>{if(!g.cancellation)return null;if(g.cancellation.requestId===requestId&&g.cancellation.binding!==binding)throw new BingoError('Dit annuleringsverzoek is met andere invoer gebruikt. Controleer de show en bevestig opnieuw.',409,'request_conflict');return {result:{applied:false}};}},(g,_family,at)=>forceCancelGame(g,{by:user,reason,requestId,binding},at));
    let outputCleanup;try{outputCleanup=await cancelGameOutput(env,user,id);}catch{outputCleanup={pending:true};}
    let cleanup;try{cleanup=await cancelGameCallResources(env,user,id);}catch{cleanup={pending:true,error:'De show is geannuleerd. Het afsluiten van gespreksaudio is nog niet bevestigd; controleer de belregie.'};}
    if(outputCleanup.pending)cleanup={...cleanup,pending:true,error:'De show is geannuleerd. Controleer of het uitzendvenster en de gespreksaudio zijn gestopt.'};
    const current=await store.game(id);return json({game:await hostGameWithCleanup(current?.data||result.game,env),applied:!result.replayed&&result.result?.applied===true,cleanup});
   }
   if(row.data.state.callId&&['activate','reserve','commit','raffle','finish'].includes(action))throw new BingoError('Rond eerst het belmoment af.',409,'call_active');
   if(row.data.state.callId&&action==='pause'&&body.paused!==true)throw new BingoError('Rond eerst het belmoment af voordat je de show hervat.',409,'call_active');
   if(action==='heartbeat'&&request.method==='POST'){const result=await store.mutate(id,options,(g,_family,now)=>control(g,now));return json({ok:true});}
   if(action==='start'&&request.method==='POST'){const presentation=await new PresentationStore(env.DB).read(user);const result=await store.mutate(id,options,(g,_family,now)=>{if(g.status==='running')throw new BingoError('Deze show is al bezig. Kies Hervat regie om de bestaande spelstand te openen.',409,'show_running');control(g,now);assertCallCueProgress(g);assertDrawAvailable(g);if(g.state.callId)throw new BingoError('Rond eerst het belmoment af voordat je de showhost wisselt.',409,'call_active');if(g.status==='finished')throw new BingoError('Dit spel is afgelopen. Maak een nieuwe show.');if(g.status==='draft'){preparationCheck(g);normalizeBingoPlan(g.plan);if(g.brandId==='milo'&&g.production?.calls?.enabled&&g.plan.blocks.filter(b=>b.type==='random-call').length!==2)throw new BingoError('Voeg precies twee geplande willekeurige belmomenten toe voordat je de belshow start.',409,'call_rundown');assertBookAccountsReady(g);finalizeGameRules(g,now);normalizeShowTime(g.date,{timeZone:g.timeZone});assertOrderStartReady(g);assertStartCapacity(g);if(!g.books.some(b=>b.accountId&&b.admitted&&!b.revokedAt))throw new BingoError('Koppel minstens één boekje voordat de show begint.');g.presentationSnapshot=presentationValue(()=>freezePresentation(g,presentation,now));g.status='running';g.startedAt=now;productionEvent(g,'show-started',{},now);g.state.phase='interlude';g.state.paused=false;}});return json({game:hostGame(result.game)});}
   if(action==='activate'&&request.method==='POST'){const result=await store.mutate(id,options,(g,_family,now)=>{control(g,now);if(g.plan.blocks[body.blockIndex]?.type==='round')assertCallCueProgress(g);if(g.state.callId)throw new BingoError('Rond eerst het belmoment af.',409);if(g.status!=='running')throw new BingoError('Start eerst dit spel.');activateBlock(g,body.blockIndex,body.goalIndex||0,now);});return json({game:hostGame(result.game)});}
   if(action==='reserve'&&request.method==='POST'){const result=await store.mutate(id,options,(g,_family,now)=>{control(g,now);if(g.state.callId)throw new BingoError('Rond eerst het belmoment af.',409);assertCallCueProgress(g);return reserveBall(g,now);});return json({pending:result.result||result.game.state.pending});}
   if(action==='commit'&&request.method==='POST'){const result=await store.mutate(id,options,(g,_family,now)=>{control(g,now);if(g.state.callId)throw new BingoError('Rond eerst het belmoment af.',409);assertCallCueProgress(g);return commitBall(g,body.token,now);});return json({commit:result.result||result.game.state.lastCommit,game:hostGame(result.game)});}
   if(action==='pause'&&request.method==='POST'){const result=await store.mutate(id,options,(g,_family,now)=>{control(g,now);if(g.brandId==='milo'&&g.state.drawHold&&body.paused!==true)throw new BingoError('De belblokkade houdt de bestaande pauze vast tot gecontroleerd hervatten.',409,'call_draw_hold');if(g.state.callId&&body.paused!==true)throw new BingoError('Rond eerst het belmoment af.',409);if(g.state.paused===!!body.paused&&!(body.paused===false&&body.restartClock===true))return;g.state.paused=!!body.paused;if(!g.state.paused){if(isStandardMiloGame(g))g.state.pending=null;resetDrawClock(g,now);}productionEvent(g,g.state.paused?'paused':'resumed',{},now);});return json({game:hostGame(result.game)});}
   if(action==='extend'&&request.method==='POST'){const result=await store.mutate(id,options,(g,_family,now)=>{control(g,now);const w=g.state.window;if(w?.status!=='open'||now>=w.endsAt)throw new BingoError('Het meldvenster is al gesloten.',409,'closed');w.endsAt+=integer(body.seconds,1,300,'Extra seconden')*1000;});return json({game:hostGame(result.game)});}
   if(action==='unblock'&&request.method==='POST'){const accountId=cleanText(body.accountId,150,'account'),result=await store.mutate(id,{requestId:scopedId,accountId},(g,f)=>{f.blocked=false;if(f.blockedGames)delete f.blockedGames[id];if(g.emptyAnnouncements)delete g.emptyAnnouncements[accountId];if(g.participationLimits)delete g.participationLimits[accountId];f.cooldowns[id]=0;if(body.reset!==false)f.falseCounts[id]=0;});return json({game:hostGame(result.game),family:result.family});}
   if(action==='admit'&&request.method==='POST'){const result=await store.mutate(id,options,g=>{if(g.status!=='draft')throw new BingoError('De deelnemerslijst staat vast tijdens de show.');const b=g.books.find(b=>b.id===body.bookId);if(!b)throw new BingoError('Boekje niet gevonden.');if(b.revokedAt&&body.admitted)throw new BingoError('Een ingetrokken boekje kan niet meer deelnemen.');b.admitted=!!body.admitted;});return json({game:hostGame(result.game)});}
   if(action==='finish-result'&&request.method==='POST'){const result=await store.mutate(id,options,(g,_family,now)=>{control(g,now);const r=g.results.find(r=>r.id===body.resultId);if(!r)throw new BingoError('Uitslag niet gevonden.');const applied=!r.acknowledged;r.acknowledged=true;if(applied){r.acknowledgedAt=now;productionEvent(g,'result-announced',{resultId:r.id,name:r.winner.name,ticket:r.winner.ticket,prize:r.prize.title,minigame:r.minigame},now);}ensureWinnerCallCue(g,r,now);recordResultMailEvent(g,r,now);if(g.state.resultId===r.id){g.state.phase=r.type==='bingo'?'running':r.returnPhase||'interlude';g.state.resultId=null;resetDrawClock(g,now);}return applied;});await dispatchPublishedPrizeMail({env,game:result.game,result:result.game.results.find(r=>r.id===body.resultId),origin:url.origin});return json({game:hostGame(result.game),applied:result.result===true});}
   if(action==='raffle'&&request.method==='POST'){
    assertDrawAvailable(row.data);
    const blocked=new Set((await store.families()).filter(r=>r.data.blocked||r.data.blockedGames?.[id]).map(r=>r.account_id));const result=await store.mutate(id,options,(g,_family,now)=>{control(g,now);assertCallCueProgress(g);assertDrawAvailable(g);if(g.state.callId)throw new BingoError('Rond eerst het belmoment af.',409);if(g.status!=='running'||g.state.window?.status==='open'||g.state.phase==='result')throw new BingoError('Rond de huidige bingocontrole of uitslag eerst af.');const entrants=g.books.filter(b=>b.accountId&&b.admitted&&!b.revokedAt&&!blocked.has(b.accountId)).map(b=>({bookId:b.id,accountId:b.accountId,profileId:b.profileId,name:b.name,ticket:b.ticket}));if(!entrants.length)throw new BingoError('Er zijn geen deelnemende lotnummers.');const winner=entrants[randomIndex(entrants.length)],pool=enabledMinigameIds(g),r={id:crypto.randomUUID(),type:'lottery',prize:{title:cleanText(body.prize||'Pakjesprijs',90,'prijs'),description:'De extra lotnummerprijs tussen de rondes.',image:''},winner,entrants,minigame:pool[randomIndex(pool.length)],createdAt:now,acknowledged:false,returnPhase:g.state.phase};g.results.push(r);g.state.phase='result';g.state.resultId=r.id;});return json({game:hostGame(result.game)});
   }
   if(action==='delivery'&&request.method==='POST'){const result=await store.mutate(id,options,(g,_family,now)=>{const r=g.results.find(r=>r.id===body.resultId);if(!r)throw new BingoError('Prijs niet gevonden.');
    if(body.awardId!==undefined){const awardId=cleanText(body.awardId,100,'troostprijs'),award=(r.consolations||[]).find(a=>a.id===awardId);if(!award)throw new BingoError('Troostprijs niet gevonden.');award.delivered=!!body.delivered;award.deliveredAt=award.delivered?now:null;productionEvent(g,'prize-delivery',{resultId:r.id,awardId:award.id,kind:'consolation',name:award.name,prize:award.prize.title,delivered:award.delivered},now);}
    else{r.delivered=!!body.delivered;r.deliveredAt=r.delivered?now:null;productionEvent(g,'prize-delivery',{resultId:r.id,name:r.winner.name,prize:r.prize.title,delivered:r.delivered},now);}
   });return json({game:hostGame(result.game)});}
   if(action==='finish'&&request.method==='POST'){const result=await store.mutate(id,options,(g,_family,now)=>{control(g,now);expireDeferredCallCues(g,now);assertCallCueProgress(g);assertDrawAvailable(g);if(g.state.callId)throw new BingoError('Rond eerst het belmoment af.',409);if(g.state.window?.status==='open'||g.state.resultId||g.state.phase==='result'||g.results.some(result=>!result.acknowledged))throw new BingoError('Rond alle meldvensters af en publiceer de bevestigde uitslagen voordat je afsluit.',409,'unpublished_result');g.status='finished';g.finishedAt=now;productionEvent(g,'show-finished',{},now);g.state.phase='complete';g.state.pending=null;});return json({game:hostGame(result.game)});}
  }
  if(path==='/prize-image'&&request.method==='GET'){
   const row=await store.game(url.searchParams.get('game')),id=url.searchParams.get('id');if(!row||!row.data.plan.prizes.some(p=>p.image===`/api/planner/images/${id}`))throw new BingoError('Afbeelding niet gevonden.',404);const image=await env.SETTINGS?.get(`show-prizes/${encodeURIComponent(row.owner_id)}/${id}`);if(!image)throw new BingoError('Afbeelding niet gevonden.',404);return new Response(image.body,{headers:{...headers,'Content-Type':image.httpMetadata?.contentType||'image/png'}});
  }
  throw new BingoError('Deze functie bestaat niet.',404);
 }catch(error){if(error instanceof BingoError||error.status&&error.code)return json({error:{code:error.code,message:error.message},...(error.broadcast?{broadcast:error.broadcast}:{})},error.status);console.error('Bingoadministratie:',error?.name||'StorageError');return json({error:{code:'unavailable',message:'De aanvraag is niet bevestigd. Probeer opnieuw; de opgeslagen spelstand blijft behouden.'}},503);}
}
