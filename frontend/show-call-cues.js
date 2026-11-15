import {openCallCue,winnerAnnouncementText,WINNER_SPEECH_VERSION} from '../server/call-cues.js';
import {LIVE_CALL_LINES} from '../public/live-call-script.js';

// The durable queue lives in the existing game document. This adapter only
// schedules the existing runner and call runtime; it owns no game decisions.
export class ShowCallCues{
 constructor(engine){this.engine=engine;this.fallbacks=new Set();}
 get enabled(){return this.engine.game.brandId==='milo';}
 get open(){return this.enabled?(this.engine.game.callCues||[]).filter(openCallCue):[];}
 get held(){return this.open.some(c=>c.source!=='manual'&&c.status!=='deferred');}
 safe(){const e=this.engine,g=e.game;return g.status==='running'&&!g.cancelledAt&&!e.presentationReplay&&!g.state.pending&&!e.director.pending&&e.director.flow?.kind!=='draw'&&g.state.window?.status!=='open'&&!g.state.resultId&&e.voicePhase==='idle'&&!e.magic&&!e.showCues?.holding&&!e.showRuntime?.holding;}
 beforeBlock(index){const e=this.engine;if(!this.enabled)return true;const winner=this.open.find(c=>c.source==='winner');if(winner)return false;const pending=this.open.find(c=>c.source==='random'&&c.status!=='deferred');if(pending)return false;return true;}
 async entered(block){if(!this.enabled||block?.type!=='random-call')return;await this.engine.liveCalls?.schedule({blockId:block.id});this.engine.syncGame();}
 announce(result){const e=this.engine;if(!result?.acknowledged||!this.enabled)return false;
  const cue=(e.game.callCues||[]).find(c=>c.resultId===result.id&&c.status==='waiting-announcement');if(!cue)return false;
  this.announcement={gameId:e.game.id,resultId:result.id,startedAt:Date.now(),text:cue.announcementScript?.text||winnerAnnouncementText(result),version:cue.announcementScript?.version||WINNER_SPEECH_VERSION};
  e.director.cancel(false);e.director.lastWinner=result.winner?.name||'';
  e.director.configure({round:e.game.plan.blocks.find(b=>b.id===result.roundId)?.title||'',prize:result.prize?.title||''});
  e.director.setScene('winner','portrait',true);e.motion='cheer';
  // The name and prize exist only after the immutable result. This is the one
  // deliberate dynamic utterance; fixed scripts remain fully prepared.
  e.speak(this.announcement.text,e.hostId,e.voiceMode,false,{preparedOnly:false});
  e.audio.cue('win');return true;
 }
 retryAnnouncement(cueId){const e=this.engine,cue=(e.game.callCues||[]).find(item=>item.id===cueId&&item.status==='waiting-announcement');if(!cue)throw Error('Deze winnaaraankondiging staat niet meer open.');if(e.game.state.window?.status==='open'||e.game.state.resultId||e.game.state.pending||e.liveCalls?.active)throw Error('Rond eerst de officiële spelcontrole of het gesprek af.');e.stopSpeech();this.announcement=null;return this.announce(e.game.results.find(result=>result.id===cue.resultId));}
 async acknowledge(cue){const e=this.engine,announcement=this.announcement;if(!announcement||announcement.gameId!==e.game.id||announcement.resultId!==cue.resultId)return false;
  const voice=e.bridge.command,ack=e.bridge.latest?.output?.voiceAck;
  if(e.demo){if(e.voicePhase!=='idle')return false;cue.status='pending';cue.announcement={announcedAt:Date.now(),simulated:true};return true;}
  if(!voice||voice.text!==announcement.text||ack?.id!==voice.id||ack.status!=='ended')return false;
  const response=await e.liveCalls.connection.action('cue-result-announced',{resultId:cue.resultId,voiceId:voice.id,scriptVersion:announcement.version});
  e.liveCalls.acceptResponse(response);await e.liveCalls.refreshGame();this.announcement=null;return true;
 }
 fallback(value){const e=this.engine,key=e.game.id+':'+(value.cueId||value.id);if(this.fallbacks.has(key)||e.voicePhase!=='idle'||e.liveCalls?.onAir)return;
  const cue=(e.game.callCues||[]).find(cue=>cue.id===(value.cueId||value.id)),text=value.preparedLines?.fallback||cue?.fallbackText||value.fallbackText||LIVE_CALL_LINES.fallback,speaker=value.characterId||cue?.characterId||e.hostId;
  this.fallbacks.add(key);e.speak(text,speaker,e.voiceMode,false,{preparedOnly:!e.demo});
 }
 async process(){const e=this.engine;if(!this.enabled||this.processing||e.disposed||e.isOutput||!e.runner.active||!e.liveCalls||Date.now()<(this.retryAt||0))return;
  // Only the director with the actual program route can automatically invite.
  if(!e.demo&&(!e.bridge.routing||!e.bridge.connected))return;
  if(this.announcement&&!this.announcement.failed&&Date.now()-this.announcement.startedAt>60000){this.announcement.failed=true;e.stopSpeech();e.fail('De winnaaraankondiging is niet volledig bevestigd. Kies Opnieuw afspelen of Belmoment overslaan op de belkaart.');}
  if(!this.safe())return;this.processing=true;
  try{
   const active=e.liveCalls.call;
   if(active&&active.phase!=='completed'){
    if(active.phase==='returning'&&active.resourcesClosed&&['declined','missed','failed'].includes(active.outcome))this.fallback(active);
    return;
   }
   const winner=this.open.find(c=>c.source==='winner'),block=e.runner.block;
   let cue=winner||this.open.find(c=>c.source==='random'&&(c.status!=='deferred'||block?.id!==c.sourceBlockId&&['pause','transition','random-call'].includes(block?.type)&&e.game.plan.blocks.findIndex(b=>b.id===block.id)>e.game.plan.blocks.findIndex(b=>b.id===c.sourceBlockId)))||this.open.find(c=>c.source==='manual'&&(['pause','transition','random-call'].includes(block?.type)||block?.type==='round'&&e.game.state.goalWon));
   if(cue?.status==='waiting-announcement'){
    if(this.announcement?.resultId===cue.resultId&&(e.failedSpeech||Date.now()-this.announcement.startedAt>60000)){if(!this.announcement.failed){this.announcement.failed=true;e.stopSpeech();e.fail('De officiële winnaaraankondiging is niet volledig bevestigd. Kies Opnieuw afspelen of Belmoment overslaan op de belkaart.');}return;}
    if(!this.announcement||this.announcement.gameId!==e.game.id||this.announcement.resultId!==cue.resultId)this.announce(e.game.results.find(r=>r.id===cue.resultId));
    else await this.acknowledge(cue);
    return;
   }
   if(cue&&!cue.callId){
    await e.liveCalls.inviteCue(cue.id,{characterId:cue.characterId||e.hostId,mode:cue.mode||'prepared'});
    const current=(e.game.callCues||[]).find(c=>c.id===cue.id);if(current?.status==='skipped')this.fallback(current);
    e.syncGame();return;
   }
   if(block?.type==='random-call'&&!(e.game.callCues||[]).some(c=>c.sourceBlockId===block.id)){await this.entered(block);return;}
   if(block?.type==='random-call'&&!this.held&&!e.game.state.drawHold&&!e.liveCalls.drawHeld){
    if(e.game.state.paused||e.director.paused)e.runner.phase='waiting';
    else e.runner.enter(e.runner.index+1);
   }
  }catch(error){this.retryAt=Date.now()+5000;e.fail(error.message);}
  finally{this.processing=false;}
 }
 async resume(target,call){const e=this.engine;if(e.game.state.drawHold||e.game.state.callId||e.liveCalls?.drawHeld)throw Error('De server heeft de belblokkade nog niet vrijgegeven.');
  const cue=(e.game.callCues||[]).find(c=>c.id===call?.cueId);
  if(cue&&cue.status!=='completed')throw Error('De afsluiting van deze belkaart is nog niet bevestigd.');
  const canonical=call?.source==='winner'?(cue?.resumeTarget||call.resumeTarget):'draw';if(target!==canonical)throw Error('Het vervolg past niet bij de actuele serverstand.');
  e.syncGame();e.runner.autoDraw=false;e.runner.age=0;e.autoDrawBlocked=true;e.localDrawNextAt=0;
  if(call?.checkpoint?.paused===true){e.director.pause();e.notify('De belblokkade is opgeheven. De eerdere handmatige pauze blijft staan; kies bewust Hervat of een volgende cue.');return true;}
  if(target==='draw'){
   if(e.game.state.paused&&!await e.pause(false))return false;
   if(e.runner.block?.type==='random-call')e.runner.phase='waiting';
   e.notify('Terugkeer bevestigd. De volgende trekking begint met een nieuwe timer; kies bewust het vervolg.');return true;
  }
  if(this.open.some(c=>c.source==='winner'))throw Error('Rond eerst de andere officiële winnaaroproep af.');
  let index;
  if(target==='ending'){index=e.game.plan.blocks.findIndex((b,i)=>i>=(e.game.state.blockIndex||0)&&b.type==='finale');if(index<0)index=e.game.plan.blocks.length;}
  else index=e.game.plan.blocks.findIndex((b,i)=>i>(e.game.state.blockIndex||0)&&b.type==='round');
  if(index<0)throw Error('Er staat geen volgende ronde klaar. Controleer het draaiboek.');
  // Enter the intervening prepared story/call cue first; never skip a scheduled
  // moment merely because the explicit continuation says next round.
  if(target==='next-round')index=Math.min(index,(e.game.state.blockIndex||0)+1);
  if(e.game.state.paused&&!await e.pause(false))return false;
  e.runner.enter(index);e.emit();return true;
 }
}
