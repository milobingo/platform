import {MINIGAMES,minigamesForBrand,activeGoal} from '../server/bingo-model.js';
import {productionSettings,normalizeProduction,STORYLINES} from '../server/production-model.js';
import {showPresentation} from '../server/presentation-model.js';
import {brandText,brandGameName} from '../server/show-brands.js';
import {createBlock} from '../server/plan-model.js';
import {getMagicCue} from '../server/magic-cues.js';
import {apiJSON} from '../public/openai-voice.js';
import {minigameDuration} from '../public/milo-minigame-plan.js';

export const SHOW_SCENES=Object.freeze([
 {id:'host',title:'Presentator',detail:'Terug naar de showdesk',camera:'host',icon:'host'},
 {id:'still',title:'Showlogo',detail:'Het showlogo in de hoofdrol',camera:'wide',icon:'star'},
 {id:'lobby',title:'Voorprogramma',detail:'Aftellen, prijzen, regels en begroetingen',camera:'wide',icon:'clock'},
 {id:'rules',title:'Spelregels',detail:'Duidelijke uitleg op het podium',camera:'wide',icon:'book'},
 {id:'patterns',title:'Speelpatronen',detail:'De stappen van deze ronde',camera:'wide',icon:'grid'},
 {id:'prize',title:'Prijs in beeld',detail:'De prijs van het actieve patroon',camera:'wide',icon:'gift'},
 {id:'pause',title:'Pauzemoment',detail:'Een rustig scherm met afteltimer',camera:'dolly',icon:'pause'},
 {id:'audience',title:'Applaus',detail:'Een moment voor iedereen thuis',camera:'wide',icon:'heart'},
 {id:'finale',title:'Finale',detail:'Een feestelijk dankjewel op het podium',camera:'wide',icon:'star'},
]);
export const GAME_NAMES={plingo:'Milo’s Sterrenplingo',wheel:'Het Magische Sterrenrad',gifts:'De Verrassingsparade',gold:'De Gouden Bingobal',horses:'De Grote Sterrenrace',cookies:'De Bonbonrace',rockets:'Raketten naar de Maan',boats:'De Avonturenrace',chimneys:'Het Geheime Sterrenpad',balloons:'Het Ballonnenfeest',pinball:'De Magische Flipperkast',disco:'De Gouden Discovloer'};
export function minigameName(game,production){return brandGameName(game,production);}
const runtimes=new WeakMap();
const copy=v=>structuredClone(v);
export function getShowRuntime(engine){if(!runtimes.has(engine)){const runtime=new ShowRuntime(engine);runtimes.set(engine,runtime);engine.showRuntime=runtime;}return runtimes.get(engine);}
export class ShowRuntime{
 constructor(engine){this.engine=engine;this.manual=null;this.gameId=engine.game?.id;this.generation=0;this.archive=null;this.preparing=false;this.archiveMessage='';this.preview=null;this.hydrateDemo();}
 get holding(){return !!this.manual;}
 get status(){return {manual:this.manual?{scene:this.manual.scene,age:this.manual.age,preview:!!this.manual.preview,processing:!!this.manual.processing}:null,archive:this.archive,preparing:this.preparing,archiveMessage:this.archiveMessage};}
 emit(){this.engine.emit();this.engine.bridge?.sendLocal();}
 hydrateDemo(){if(!this.engine.demo)return;try{const raw=localStorage.getItem('mf-production-settings-'+this.engine.production);if(raw)this.engine.game.production=normalizeProduction(JSON.parse(raw));}catch{}}
 assertQuiet({result=false,allowDraft=false}={}){
  const e=this.engine,d=e.director,g=e.game;
  if(d.callHold||g.state.callId)throw Error('Rond eerst het belmoment af.');
  if(e.showCues?.active||e.showCues?.holding)throw Error('Rond eerst het bewegings- of showmoment af, of stop het vanuit de regie.');
  if(g.state.window?.status==='open')throw Error('Laat het meldvenster eerst sluiten.');
  if(!result&&g.state.resultId)throw Error('Presenteer eerst de vastgelegde uitslag.');
  if(!result&&(d.flow?.kind==='draw'||d.pending!==null&&d.pending!==undefined||g.state.pending))throw Error('Rond eerst de lopende trekking af.');
  if(e.voicePhase!=='idle')throw Error('Wacht tot de huidige uitspraak klaar is.');
  if(!allowDraft&&!e.demo&&g.status==='finished')throw Error('Deze show is afgelopen.');
 }
 setup(scene,config={},options={}){
  const e=this.engine;
  if(!this.manual)this.restore={gameId:e.game.id,camera:e.camera,motion:e.motion};
  this.manual={scene,age:0,paused:false,...config,...options};
  e.camera=options.camera||SHOW_SCENES.find(x=>x.id===scene)?.camera||'wide';e.motion=options.motion||'idle';this.emit();
 }
 baseConfig(){const e=this.engine,g=e.game,goal=activeGoal(g),p=productionSettings(g.production),presentation=showPresentation(g);return {brandId:e.production,title:g.title,round:goal?.round.title||g.plan.blocks.find(b=>b.type==='round')?.title||'De show begint zo',pattern:goal?.pattern.title||'',patternCells:goal?.pattern.cells||[],patternVariant:goal?.pattern.variant||'fixed',patternFreeCenter:goal?.pattern.freeCenter!==false,roundPatterns:goal?.round.goals.map(v=>g.plan.patterns.find(p=>p.id===v.patternId)).filter(Boolean)||[],goalIndex:g.state.goalIndex||0,prize:goal?.prize.title||g.plan.prizes[0]?.title||'Een mooie verrassing',prizeImage:goal?.prize.image||g.plan.prizes[0]?.image||'',prizeDescription:goal?.prize.description||g.plan.prizes[0]?.description||'',rules:presentation.rules,transition:'fade',transitionMs:650,pauseMinutes:5};}
 visual(base={}){
  if(!this.manual)return base;
  const p=productionSettings(this.engine.game.production),stage=this.manual.scene==='lobby'?{type:'lobby',startsAt:p.lobby.startAt||this.engine.game.date,rotateSeconds:p.lobby.rotateSeconds,message:p.lobby.message,prizes:this.engine.game.plan.prizes.map(x=>({title:x.title,description:x.description})),rules:showPresentation(this.engine.game).rules,greetings:(this.engine.game.participation||[]).filter(x=>x.greeting&&x.greetingApproved).map(x=>x.name)}:this.manual.gameStage||null;
  return {...base,...this.baseConfig(),...this.manual,gameStage:stage,age:this.manual.age,sceneRevision:(base.sceneRevision||0)+this.generation*1000,paused:!!this.manual.paused,externalHold:false};
 }
 async scene(id,config={}){
  if(id==='host'){if(this.engine.showCues?.active||this.engine.showCues?.holding)throw Error('Rond eerst het bewegings- of showmoment af, of stop het vanuit de regie.');this.returnToShow();this.engine.setCamera?.('host');return;}
  this.assertQuiet({allowDraft:true});if(!SHOW_SCENES.some(x=>x.id===id))throw Error('Kies een beschikbare showscène.');
  if(id==='lobby'&&(!productionSettings(this.engine.game.production).lobby.enabled||this.engine.game.status!=='draft'))throw Error('Schakel het voorprogramma in en gebruik het vóór de show.');
  await this.engine.audio.unlock();this.assertQuiet({allowDraft:true});this.generation++;this.setup(id,config);if(id==='audience')this.cue('applause');
 }
 previewScene(id){if(!SHOW_SCENES.some(x=>x.id===id))return;this.preview=this.previewVisual(id);this.engine.previewShow=this.preview;this.engine.previewCamera=SHOW_SCENES.find(x=>x.id===id).camera;this.engine.emit();}
 previewVisual(id){const p=productionSettings(this.engine.game.production);return {...this.baseConfig(),scene:id,age:0,sceneRevision:0,paused:false,gameStage:id==='lobby'?{type:'lobby',startsAt:p.lobby.startAt||this.engine.game.date,rotateSeconds:p.lobby.rotateSeconds,message:p.lobby.message,prizes:this.engine.game.plan.prizes,rules:showPresentation(this.engine.game).rules,greetings:(this.engine.game.participation||[]).filter(e=>e.greeting&&e.greetingApproved).map(e=>e.name)}:null};}
 async takePreview(){if(this.preview)await this.scene(this.preview.scene);else this.engine.setCamera(this.engine.previewCamera);}
 pause(value=!this.manual?.paused){if(!this.manual)return false;this.manual.paused=!!value;this.emit();return true;}
 returnToShow(){if(this.manual?.processing)throw Error('De server bevestigt de uitslag nog. Wacht heel even.');this.generation++;this.manual=null;if(this.restore?.gameId===this.engine.game.id){this.engine.camera=this.restore.camera;this.engine.motion=this.restore.motion;}this.restore=null;this.emit();}
 async previewMinigame(id){
  if(!minigamesForBrand(this.engine.production).some(g=>g.id===id))throw Error('Kies een bestaand beslisspel.');
  if(this.engine.game.status==='running'||this.engine.runner.active)throw Error('Bekijk een oefenspel vóór de show. Tijdens de show presenteer je alleen de vastgelegde uitslag.');
  this.assertQuiet({allowDraft:true});await this.engine.audio.unlock();this.assertQuiet({allowDraft:true});
  const entrants=['Noor','Sam','Mila','Daan','Luca','Tess'].map((name,i)=>({bookId:'oefenboek-'+i,name,ticket:String(i+1).padStart(4,'0')}));
  const duration=minigameDuration(id,true);
  const result={id:'oefenresultaat-'+crypto.randomUUID(),minigame:id,entrants,winner:entrants[2],prize:{title:'Oefenprijs · geen echte trekking'}};
  this.generation++;this.setup('minigame',{gameStage:{type:'minigame',playId:crypto.randomUUID(),result,duration}},{preview:true,endAfter:duration+2});
 }
 async presentResult(){
  const e=this.engine,g=e.game,r=g.results.find(r=>r.id===g.state.resultId);if(!r||r.acknowledged)throw Error('Er staat geen nieuwe uitslag klaar.');
  if(this.manual?.kind==='result')return;
  this.assertQuiet({result:true});if(!e.demo)await e.post('heartbeat');await e.audio.unlock();this.assertQuiet({result:true});
  if(!r.minigame){await e.resultNext();return;}
  const duration=minigameDuration(r.minigame);
  this.generation++;this.setup('minigame',{gameStage:{type:'minigame',playId:crypto.randomUUID(),result:copy(r),duration}},{kind:'result',resultId:r.id,gameId:g.id,endAfter:duration+2});
 }
 async raffle(prize){this.assertQuiet();if(this.engine.demo)throw Error('Een echte lotnummerprijs trek je in een opgeslagen, lopende show.');if(this.engine.game.status!=='running')throw Error('Start eerst een echte show.');if(!prize?.trim())throw Error('Vul de naam van de extra prijs in.');await this.engine.post('raffle',{prize:prize.trim()});this.engine.emit();await this.presentResult();}
 async saveProduction(draft){const e=this.engine,p=normalizeProduction(draft);if(e.demo){p.revision=productionSettings(e.game.production).revision+1;e.game.production=p;localStorage.setItem('mf-production-settings-'+e.production,JSON.stringify(p));e.notify('Oefenproductie op dit apparaat opgeslagen.');}else{await e.post('production',{revision:p.revision,production:p});e.notify('Productie-instellingen opgeslagen.');}this.mix(p.levels);this.emit();}
 setMinigames(ids){if(!Array.isArray(ids)||!ids.length)throw Error('Laat minstens één beslisspel ingeschakeld.');if(ids.some(id=>!minigamesForBrand(this.engine.production).some(g=>g.id===id)))throw Error('Kies een beschikbaar beslisspel voor deze productie.');if(this.engine.game.status!=='draft'&&!this.engine.demo)throw Error('De beslisspellen staan vast tijdens de show.');this.engine.game={...this.engine.game,settings:{...this.engine.game.settings,minigames:[...new Set(ids)]}};this.engine.dirty=true;this.engine.emit();}
 async greeting(entryId,approved){if(this.engine.demo)throw Error('Begroetingen komen van aangemelde spelers in een echte show.');await this.engine.post('call-status',{entryId,status:'greeting-approved',approved});this.emit();}
 mix(levels){const e=this.engine,v=Object.fromEntries(['voice','music','effects'].map(k=>[k,Math.max(0,Math.min(100,Number(levels[k])||0))]));if(e.bridge)e.bridge.mixer=v;e.voice?.setVolume(v.voice/100);e.audio.setLevels(v);e.bridge?.sendLocal();return v;}
 async cue(id){if(this.engine.showCues?.active||this.engine.showCues?.holding)throw Error('Rond eerst de actieve showcue af voordat je een losse jingle start.');if(!['intro','applause','round','prize','friendly','finale','win'].includes(id))throw Error('Dit geluid is niet beschikbaar.');await this.engine.audio.unlock();this.engine.audio.cue(id);this.engine.bridge?.cue(id);}
 applyStory(id,{replace=false}={}){const story=STORYLINES.find(s=>s.id===id);if(!story)throw Error('Dit verhaal bestaat niet.');const e=this.engine;if(e.game.plan.blocks.some(b=>b.type==='story')&&!replace)throw Error('Bevestig eerst het vervangen van bestaande verhaalhoofdstukken.');e.editPlan(plan=>{let index=0;plan.blocks=plan.blocks.filter(b=>b.type!=='story').flatMap(block=>block.type==='round'?[{id:'story-'+crypto.randomUUID(),type:'story',title:story.title+' · '+(++index),text:brandText(story.chapters[Math.min(index-1,story.chapters.length-1)],e.game),hold:3,speakerId:e.hostId},block]:[block]);});e.notify('Verhaallijn aan het draaiboek toegevoegd. Sla je draaiboek op.');}
 addMoment(type,{title,text,speakerId,magicId}={}){this.engine.editPlan(plan=>{const b=createBlock(type,{...plan,leadId:speakerId||this.engine.hostId},this.engine.production);if(title)b.title=title;if(text)b.text=text;b.speakerId=speakerId||this.engine.hostId;if(type==='magic'){b.speakerId='milo';b.magicId=magicId||'star-hat';const cue=getMagicCue(b.magicId);if(!cue)throw Error('Kies een bestaand magiemoment.');b.duration=cue.duration;b.text=typeof text==='string'?text:cue.intro;}const end=plan.blocks.findIndex(x=>x.type==='finale');plan.blocks.splice(end<0?plan.blocks.length:end,0,b);});this.engine.notify('Showmoment toegevoegd. Sla je draaiboek op.');}
 async deliver(resultId,delivered,awardId){if(this.engine.demo){const r=this.engine.game.results.find(r=>r.id===resultId),award=awardId?r?.consolations?.find(a=>a.id===awardId):r;if(!award)throw Error('Deze prijs is niet beschikbaar.');award.delivered=delivered;award.deliveredAt=delivered?Date.now():null;}else await this.engine.post('delivery',{resultId,delivered,...(awardId?{awardId}:{})});this.emit();}
 async finishShow(){if(this.engine.demo){this.engine.game.status='finished';this.engine.game.state.phase='complete';this.engine.stop();this.emit();return;}if(this.engine.game.state.window?.status==='open'||this.engine.game.state.resultId)throw Error('Rond eerst het meldvenster en de uitslag af.');await this.engine.post('finish');this.engine.stop();this.emit();}
 async checkArchive(characterId=this.engine.hostId){const e=this.engine,c=e.characters.find(c=>c.id===characterId);if(!c)throw Error('Kies een personage.');if(this.preparing)throw Error('Stop eerst de lopende voorbereiding.');const response=await apiJSON('library',{characterId,speed:c.speed,...(e.demo?{brandId:e.production}:{gameId:e.game.id})});this.archive={...response,characterId,gameId:e.game.id};this.archiveMessage=`${response.ready} van ${response.total} fragmenten staan klaar.`;e.emit();return this.archive;}
 async prepareArchive(characterId=this.engine.hostId){
  const e=this.engine;if(!e.apiStatus?.configured)throw Error('Stel eerst de globale OpenAI-koppeling in.');if(this.preparing)return;await this.checkArchive(characterId);const archive=this.archive,c=e.characters.find(c=>c.id===characterId),token=this.archiveToken=(this.archiveToken||0)+1;this.preparing=true;this.archiveAbort=new AbortController();e.emit();
  try{for(const item of archive.items.filter(x=>!x.ready)){if(token!==this.archiveToken||archive.gameId!==e.game.id)break;const started=Date.now(),r=await fetch('/api/openai/speech',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},signal:this.archiveAbort.signal,body:JSON.stringify({text:item.text,characterId,speed:c.speed,...(e.demo?{brandId:e.production}:{gameId:e.game.id})})});if(!r.ok){const d=await r.json().catch(()=>({}));throw Error(d.error?.message||'Het stemfragment kon niet worden voorbereid.');}await r.arrayBuffer();if(token!==this.archiveToken)break;item.ready=true;archive.ready=archive.items.filter(x=>x.ready).length;this.archiveMessage=`${archive.ready} / ${archive.total} · ${item.text}`;e.emit();await new Promise(resolve=>{this.archiveWait=setTimeout(resolve,Math.max(0,2300-(Date.now()-started)));this.archiveWake=resolve;});}if(token===this.archiveToken)this.archiveMessage='Voorbereiding afgerond. De opgeslagen fragmenten worden automatisch hergebruikt.';}catch(error){if(error.name!=='AbortError')throw error;}finally{if(token===this.archiveToken){this.preparing=false;this.archiveAbort=null;e.emit();}}
 }
 stopArchive(){this.archiveToken=(this.archiveToken||0)+1;this.archiveAbort?.abort();clearTimeout(this.archiveWait);this.archiveWake?.();this.archiveWake=null;this.preparing=false;this.archiveMessage='Voorbereiding gestopt. Opgeslagen fragmenten blijven bewaard.';this.engine.emit();}
 tick(dt){
  const e=this.engine;if(e.game.id!==this.gameId){this.stopArchive();this.manual=null;this.restore=null;this.archive=null;this.gameId=e.game.id;this.hydrateDemo();}
  if(!this.manual||this.manual.paused||!Number.isFinite(dt)||dt<=0)return;
  this.manual.age+=Math.min(.35,dt);
  if(this.manual.kind==='result'&&this.manual.age>=this.manual.endAfter&&!this.manual.processing){
   const m=this.manual;m.processing=true;const token=this.generation;
   void e.resultNext().then(()=>{if(this.generation!==token||this.manual!==m||e.game.id!==m.gameId)return;this.manual={scene:'winner',age:0,winner:m.gameStage.result.winner.name,kind:'celebration',endAfter:7};this.emit();}).catch(error=>{if(this.manual===m){m.processing=false;m.endAfter=m.age+999999;e.fail(error.message);}});
  }else if(this.manual.endAfter&&this.manual.age>=this.manual.endAfter&&!this.manual.processing&&(!this.manual.kind||this.manual.kind==='celebration'&&e.voicePhase==='idle'))this.returnToShow();
 }
 dispose(){this.stopArchive();this.manual=null;}
}
