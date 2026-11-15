import {platformIdentity} from './player-identity.js';
import {readSecret} from './secrets.js';
import {BingoStore} from './bingo-store.js';
import {prepareAutomaticRules} from './game-rules.js';
import {ShowDesignStore,ownedBatch,designCandidate,touchBatch,abandonDesignRewrite} from './show-design-store.js';
import {wakeDesignJobs,cancelDesignJobs} from './show-design-jobs.js';
import {designCatalog,normalizeDesignBriefing,designError,DIRECTIONS,DESIGN_VERSION,validateDesignProposal,compileDesignProposal,makeDesignGame} from './show-design-model.js';
import {createHash} from 'node:crypto';
import {previewDesignMerge,applyDesignMerge,restoreDesignMerge} from './show-design-merge.js';
const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
const json=(body,status=200)=>Response.json(body,{status,headers});
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const requestId=value=>{if(typeof value!=='string'||!/^[A-Za-z0-9_-]{8,100}$/.test(value))throw designError('request_id','Bevestig deze ontwerpactie opnieuw vanuit de studio.');return value;};
const sourceRevision=game=>game.preparationRevision||0;
function candidateRevision(candidate,value){if(!Number.isInteger(value)||value!==candidate.revision)throw designError('design_conflict','Dit voorstel is in een ander venster gewijzigd. Je eigen tekst blijft staan; laad de huidige versie en vergelijk opnieuw.',409);}
function publicBatch(batch){const copy=structuredClone(batch);for(const c of copy.candidates){delete c.lease;delete c.source;delete c.repairCode;}delete copy.creationBinding;delete copy.intentBinding;return copy;}
function makeCandidate(index,direction=DIRECTIONS[index]){return {id:crypto.randomUUID(),index,direction,status:'waiting',attempt:0,automaticRetries:0,revision:0,error:null,proposal:null,history:[],lease:null,feedback:'',sceneSuggestion:null};}
function makeBatch(snapshot,request,{previousBatchId=null,candidates=null}={}){return {id:crypto.randomUUID(),version:DESIGN_VERSION,revision:1,status:'working',briefing:snapshot.briefing,options:snapshot.options,catalogVersion:designCatalog().version,createdAt:Date.now(),updatedAt:Date.now(),candidates:candidates||DIRECTIONS.map((d,i)=>makeCandidate(i,d)),requestId:request,creationBinding:digest(snapshot),previousBatchId,sourceGameId:snapshot.sourceGameId||null,sourceRevision:snapshot.sourceRevision??null,reservedOutputTokens:0,imports:[]};}
async function readBody(request){if(!/^application\/json(?:;|$)/i.test(request.headers.get('content-type')||''))throw designError('content_type','Verstuur ontwerpacties vanuit de studio.',415);const reader=request.body?.getReader();if(!reader)throw designError('invalid_body','De ontwerpactie is leeg.');const chunks=[];let size=0,timer;const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{void reader.cancel().catch(()=>{});reject(designError('request_timeout','De ontwerpactie kon niet op tijd worden gelezen. Probeer opnieuw.',408));},10000);timer.unref?.();});try{for(;;){const {done,value}=await Promise.race([reader.read(),deadline]);if(done)break;size+=value.length;if(size>160000){await reader.cancel();throw designError('body_size','De ontwerpactie is te groot.',413);}chunks.push(value);}}finally{clearTimeout(timer);reader.releaseLock();}const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}try{return JSON.parse(new TextDecoder().decode(bytes));}catch{throw designError('invalid_body','De ontwerpactie kon niet worden gelezen.');}}
function rawProposal(proposal){return {title:proposal.title,logline:proposal.logline,storyForm:proposal.storyForm,tone:proposal.tone,productionNotes:proposal.productionNotes,scenes:proposal.scenes.map(({slotId,title,purpose,speakerTurns,editorialSpeakerTurns,operatorNotes,cameraId,cueId,durationEstimate,fallbackTurns})=>({slotId,title,purpose,speakerTurns:editorialSpeakerTurns||speakerTurns,operatorNotes,cameraId,cueId,durationEstimate,fallbackTurns}))};}
function saveProposal(candidate,proposal){if(candidate.history.length>=8)throw designError('history_limit','Dit voorstel heeft acht bewaarde revisies. Maak een variant om verder te werken.',409);candidate.history.push({revision:candidate.revision,proposal:candidate.proposal,at:Date.now()});candidate.proposal=proposal;candidate.revision++;candidate.sceneSuggestion=null;candidate.rewriteSlotId=null;candidate.status='ready';candidate.error=null;}
async function sourceGame(env,owner,id,revision,{draft=true}={}){const row=await new BingoStore(env.DB).game(id);if(!row||row.owner_id!==owner||row.data.brandId!=='milo')throw designError('not_found','Kies een Milo-show uit je eigen studio.',404);if(draft&&(row.data.status!=='draft'||row.data.cancelledAt))throw designError('draft_only','Ontwerp met AI is alleen beschikbaar voor een bewerkbaar Milo-concept.',409);if(revision!==undefined&&revision!==null&&sourceRevision(row.data)!==revision)throw designError('source_conflict','Het bestaande draaiboek is sinds dit ontwerp gewijzigd. Vergelijk de huidige versie voordat je overneemt.',409);return row.data;}
export async function handleShowDesign(request,env={},fetcher=fetch){
 const identity=platformIdentity(request,env),url=new URL(request.url);
 if(!identity.user)return json({error:{code:'sign_in',message:'Log in om een show te ontwerpen.'}},401);
 if(!identity.admin)return json({error:{code:'owner_only',message:'Alleen bevoegde Milo-showmakers kunnen ontwerpen.'}},403);
 if(url.pathname!=='/api/show-design')return json({error:{code:'not_found',message:'Deze ontwerpactie bestaat niet.'}},404);
 if(!['GET','POST'].includes(request.method))return json({error:{code:'method',message:'Deze aanvraag wordt niet ondersteund.'}},405);
 if(request.headers.get('sec-fetch-site')==='cross-site'||request.headers.get('origin')&&request.headers.get('origin')!==url.origin||request.method==='POST'&&(request.headers.get('origin')!==url.origin||request.headers.get('x-milo-show-design')!=='1'))return json({error:{code:'origin',message:'Open Ontwerp met AI vanuit deze showstudio.'}},403);
 const owner=identity.user,store=new ShowDesignStore(env,owner);
 try{
  if(request.method==='GET'){
   const {data}=await store.read(),id=url.searchParams.get('batchId');let configured=false;try{configured=!!(await readSecret(env)).key;}catch{}
   if(id){const batch=ownedBatch(data,id);void wakeDesignJobs(env,owner,{fetcher});return json({batch:publicBatch(batch),configured,catalog:designCatalog()});}
   void wakeDesignJobs(env,owner,{fetcher});return json({catalog:designCatalog(),configured,batches:data.batches.map(b=>({id:b.id,title:b.options.title||b.candidates.find(c=>c.proposal)?.proposal.title||'Nieuwe show',briefing:b.briefing,status:b.status,createdAt:b.createdAt,ready:b.candidates.filter(c=>c.proposal).length,total:b.candidates.length,previousBatchId:b.previousBatchId}))});
  }
  const body=await readBody(request),action=body.action;
  if(action==='create'){
   const normalized=normalizeDesignBriefing(body.briefing,body.options),id=requestId(body.requestId),snapshot={...normalized};
   if(body.sourceGameId){const game=await sourceGame(env,owner,body.sourceGameId,body.sourceRevision);snapshot.sourceGameId=game.id;snapshot.sourceRevision=sourceRevision(game);}
   const current=await store.read(),prior=current.data.batches.find(b=>b.requestId===id);if(prior){if(prior.creationBinding!==digest(snapshot))throw designError('request_conflict','Deze ontwerpactie is al met een andere briefing gebruikt.',409);void wakeDesignJobs(env,owner,{fetcher});return json({batch:publicBatch(prior)},200);}
   const secret=await readSecret(env);if(!secret.key)throw designError('not_configured','Stel de OpenAI-koppeling in om te ontwerpen.',503);
   const result=await store.edit(data=>{const existing=data.batches.find(b=>b.requestId===id);if(existing){if(existing.creationBinding!==digest(snapshot))throw designError('request_conflict','Deze ontwerpactie is al met een andere briefing gebruikt.',409);return {noWrite:true,value:existing};}if(data.batches.length>=8)throw designError('batch_limit','Je hebt acht ontwerpreeksen bewaard. Gebruik een bestaand ontwerp of verwijder bewust een oude reeks.',409);const batch=makeBatch(snapshot,id);data.batches.push(batch);return batch;});void wakeDesignJobs(env,owner,{fetcher});return json({batch:publicBatch(result)},202);
  }
  if(!body.batchId)throw designError('batch_required','Kies eerst een ontwerpreeks.');
  if(action==='restore-merge'){
   const {data}=await store.read(),batch=ownedBatch(data,body.batchId),id=requestId(body.requestId),binding=digest([batch.id,body.mergeRequestId,body.targetGameId,body.targetRevision,body.confirmed]),result=await restoreDesignMerge({request,env,owner,store,batch,body,requestId:id,binding}),updated=ownedBatch((await store.read()).data,batch.id);return json({gameId:result.game.id,game:result.game,restored:true,replayed:result.replayed,batch:publicBatch(updated)});
  }
  if(action==='merge-preview'||action==='merge'){
   const {data}=await store.read(),batch=ownedBatch(data,body.batchId),candidate=designCandidate(batch,body.candidateId);if(batch.catalogVersion!==designCatalog().version)throw designError('catalog_changed','De catalogus is gewijzigd. Vergelijk een nieuwe variant voordat je scènes overneemt.',409);
   if(action==='merge-preview'){const result=await previewDesignMerge({env,owner,batch,candidate,body});return json({preview:result.preview});}
   const id=requestId(body.requestId),binding=digest([batch.id,candidate.id,body.expectedRevision,body.targetGameId,body.targetRevision,body.mappings]),result=await applyDesignMerge({request,env,owner,store,batch,candidate,body,requestId:id,binding}),updated=ownedBatch((await store.read()).data,batch.id);return json({gameId:result.game.id,game:result.game,merged:true,replayed:result.replayed,batch:publicBatch(updated)});
  }
  if(action==='import'){
   const {data}=await store.read(),batch=ownedBatch(data,body.batchId),candidate=designCandidate(batch,body.candidateId);candidateRevision(candidate,body.expectedRevision);if(!candidate.proposal||candidate.status!=='ready'||candidate.sceneSuggestion)throw designError('proposal_incomplete','Kies een volledig voorstel en rond een eventuele scènewijziging eerst af.',409);
   if(batch.catalogVersion!==designCatalog().version)throw designError('catalog_changed','De studiocatalogus is gewijzigd. Vergelijk of maak een nieuwe variant voordat je dit concept gebruikt.',409);
   if(body.detachSource!==undefined&&typeof body.detachSource!=='boolean')throw designError('invalid_choice','Kies bewust of je zonder broninstellingen een apart concept wilt maken.');
   const id=requestId(body.requestId),binding=digest([batch.id,candidate.id,candidate.revision,body.date||null,body.detachSource===true]),gameId=stableGameId(owner,id),games=new BingoStore(env.DB),existing=await games.game(gameId);if(existing){if(existing.owner_id!==owner||existing.data.designOrigin?.binding!==binding)throw designError('request_conflict','Deze overnameactie is met een andere versie gebruikt.',409);return json({gameId,game:existing.data,replayed:true});}
   let source=null;if(batch.sourceGameId&&body.detachSource!==true){try{source=await sourceGame(env,owner,batch.sourceGameId,batch.sourceRevision);}catch(error){if(error.code==='source_conflict')throw designError('source_conflict','Het brondraaiboek is gewijzigd. Vergelijk de bron, of vink ‘Zonder broninstellingen’ aan om bewust een apart concept zonder bronprijzen of spelinstellingen te maken.',409);throw error;}}
   const game=makeDesignGame(candidate.proposal,batch.options,{owner,origin:url.origin,id:gameId,date:body.date||source?.date});game.designOrigin={version:DESIGN_VERSION,batchId:batch.id,candidateId:candidate.id,revision:candidate.revision,binding,...(body.detachSource===true?{detachedFromSource:true}:{})};
   if(source){game.settings={...structuredClone(source.settings),mode:'auto',rulesProfile:'milo-standard-v1',youtubeId:''};game.plan.prizes=structuredClone(source.plan.prizes);const old=source.plan.blocks.filter(b=>b.type==='round');game.plan.blocks.filter(b=>b.type==='round').forEach((round,i)=>round.goals.forEach((goal,j)=>{const prizeId=old[i]?.goals[j]?.prizeId;goal.prizeId=game.plan.prizes.some(p=>p.id===prizeId)?prizeId:'';}));if(source.presentationSelection)game.presentationSelection=structuredClone(source.presentationSelection);}
   // No start, audio, call, producer claim, order, book, participant or active
   // workspace selection is copied or mutated by an explicit design import.
   prepareAutomaticRules(game);try{await games.create(game);}catch(error){const winner=await games.game(gameId);if(!winner||winner.owner_id!==owner||winner.data.designOrigin?.binding!==binding)throw error;return json({gameId,game:winner.data,replayed:true});}
   await store.edit(state=>{const b=ownedBatch(state,batch.id);if(!b.imports.some(item=>item.requestId===id))b.imports.push({requestId:id,gameId,candidateId:candidate.id,revision:candidate.revision,at:Date.now()});touchBatch(b);return null;});return json({gameId,game},201);
  }
  const result=await store.edit(data=>{
   const batch=ownedBatch(data,body.batchId);
   if(action==='cancel'){batch.cancelledAt=Date.now();for(const candidate of batch.candidates)if(['waiting','writing','validating'].includes(candidate.status)){candidate.status='cancelled';candidate.lease=null;if(candidate.proposal)abandonDesignRewrite(candidate);}touchBatch(batch);return batch;}
   if(action==='delete'){if(batch.candidates.some(c=>['writing','validating'].includes(c.status)))throw designError('job_active','Stop deze ontwerpreeks voordat je hem verwijdert.',409);data.batches=data.batches.filter(b=>b.id!==batch.id);return {deleted:true};}
   if(['new-set','variant'].includes(action)){
    const id=requestId(body.requestId),intentBinding=digest([action,batch.id,body.candidateId||null,body.expectedRevision??null,body.feedback||'']),prior=data.batches.find(b=>b.requestId===id);if(prior){if(prior.intentBinding!==intentBinding)throw designError('request_conflict','Deze herschrijfactie is met andere invoer gebruikt. Bevestig opnieuw.',409);return {noWrite:true,value:prior};}if(data.batches.length>=8)throw designError('batch_limit','Er zijn acht bewaarde reeksen. Verwijder eerst bewust een oude reeks.',409);
    const feedback=normalizeDesignBriefing('Herschrijf een warme Nederlandse familieshow met deze extra feedback.',{required:body.feedback||''}).options.required;
    let candidates=null;if(action==='variant'){const candidate=designCandidate(batch,body.candidateId);candidateRevision(candidate,body.expectedRevision);if(!candidate.proposal)throw designError('proposal_incomplete','Open eerst een volledig voorstel.',409);const next=makeCandidate(0,candidate.direction);next.feedback=feedback;next.source=rawProposal(candidate.proposal);candidates=[next];}else candidates=DIRECTIONS.map((d,i)=>({...makeCandidate(i,d),feedback}));
    const next=makeBatch({briefing:batch.briefing,options:batch.options,sourceGameId:batch.sourceGameId,sourceRevision:batch.sourceRevision},id,{previousBatchId:batch.id,candidates});next.intentBinding=intentBinding;data.batches.push(next);return next;
   }
   const candidate=designCandidate(batch,body.candidateId);candidateRevision(candidate,body.expectedRevision);
   if(action==='retry'){if(!['failed','cancelled'].includes(candidate.status))throw designError('job_active','Dit voorstel is al klaar of wordt nog geschreven.',409);if(batch.cancelledAt)delete batch.cancelledAt;candidate.status='waiting';candidate.error=null;candidate.lease=null;touchBatch(batch);return batch;}
   if(!candidate.proposal)throw designError('proposal_incomplete','Open eerst een volledig geschreven voorstel.',409);
   if(action==='rewrite-scene'){
    const id=requestId(body.requestId);if(candidate.rewriteRequestId===id)return {noWrite:true,value:batch};if(['writing','validating','waiting'].includes(candidate.status))throw designError('job_active','Deze scène wordt al herschreven.',409);
    const scene=candidate.proposal.scenes.find(s=>s.id===body.sceneId||s.slotId===body.sceneId);if(!scene)throw designError('not_found','Deze scène bestaat niet.',404);
    const feedback=normalizeDesignBriefing('Herschrijf deze scène met behoud van de functie en beschermde instellingen.',{required:body.feedback||''}).options.required;if(!feedback)throw designError('feedback_required','Geef kort aan wat je aan deze scène wilt veranderen.');
    if(batch.cancelledAt)delete batch.cancelledAt;candidate.source=rawProposal(candidate.proposal);candidate.feedback=feedback;candidate.rewriteSlotId=scene.slotId;candidate.baseRevision=candidate.revision;candidate.rewriteRequestId=id;candidate.sceneSuggestion=null;candidate.status='waiting';candidate.error=null;touchBatch(batch);return batch;
   }
   if(action==='apply-scene'){
    const suggestion=candidate.sceneSuggestion;if(!suggestion||suggestion.id!==body.suggestionId||suggestion.baseRevision!==candidate.revision)throw designError('design_conflict','Deze suggestie hoort bij een eerdere scène. Vergelijk opnieuw; jouw huidige tekst blijft staan.',409);
    if(body.accept!==true&&body.accept!==false)throw designError('invalid_choice','Kies toepassen of verwerpen.');if(body.accept){const updated=rawProposal(candidate.proposal);updated.scenes=updated.scenes.map(s=>s.slotId===suggestion.slotId?rawScene(suggestion.scene):s);const valid=validateDesignProposal(updated,batch.options,{idPrefix:candidate.id});saveProposal(candidate,compileDesignProposal(valid,batch.options));}else{candidate.sceneSuggestion=null;candidate.rewriteSlotId=null;candidate.status='ready';}touchBatch(batch);return batch;
   }
   if(action==='edit-scene'){
    const scene=candidate.proposal.scenes.find(s=>s.id===body.sceneId||s.slotId===body.sceneId);if(!scene)throw designError('not_found','Deze scène bestaat niet.',404);if(!body.scene||body.scene.slotId!==scene.slotId)throw designError('protected_slot','De identiteit, plaats en functie van deze scène zijn beschermd.');
    const updated=rawProposal(candidate.proposal);updated.scenes=updated.scenes.map(s=>s.slotId===scene.slotId?rawScene(body.scene):s);const valid=validateDesignProposal(updated,batch.options,{idPrefix:candidate.id});saveProposal(candidate,compileDesignProposal(valid,batch.options));candidate.lease=null;touchBatch(batch);return batch;
   }
   if(action==='restore'){const history=candidate.history.find(h=>h.revision===body.historyRevision);if(!history)throw designError('not_found','Deze revisie is niet beschikbaar.',404);saveProposal(candidate,structuredClone(history.proposal));candidate.lease=null;touchBatch(batch);return batch;}
   throw designError('unknown_action','Deze ontwerpactie bestaat niet.');
  });
  if(action==='cancel')cancelDesignJobs(env,owner,body.batchId);else if(['new-set','variant','retry','rewrite-scene'].includes(action))void wakeDesignJobs(env,owner,{fetcher});return result?.deleted?json(result):json({batch:publicBatch(result)},['new-set','variant','retry','rewrite-scene'].includes(action)?202:200);
 }catch(error){return json({error:{code:error?.code||'design_unavailable',message:error?.code?error.message:'Ontwerpen of opslaan is nu niet bevestigd. Je eerdere ontwerpen en invoer blijven behouden.'}},error?.status||503);}
}
function rawScene(scene){return Object.fromEntries(['slotId','title','purpose','speakerTurns','operatorNotes','cameraId','cueId','durationEstimate','fallbackTurns'].map(key=>[key,scene[key]]));}
function stableGameId(owner,request){const hex=digest(['show-design-import',owner,request]).slice(0,32);return `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-8${hex.slice(17,20)}-${hex.slice(20)}`;}
