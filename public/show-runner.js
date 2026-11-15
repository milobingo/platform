import {normalizePlan,planIssues} from './plan-model.js?v=36';
import {getShowCue} from './show-cues.js?v=48';

// This runner schedules the existing director; it never chooses or confirms a ball.
export class ShowRunner{
 constructor(director,{onChange=()=>{},onNotice=()=>{}}={}){this.director=director;this.onChange=onChange;this.onNotice=onNotice;this.active=false;this.index=-1;this.phase='idle';this.age=0;this.goal=0;this.plan=null;}
 get block(){return this.plan?.blocks[this.index];}
 start(document,{blockIndex=0,goalIndex=0}={}){
  if(this.director.scene==='checking'||this.active)return false;
  const plan=normalizePlan(structuredClone(document)),issues=planIssues(plan);if(issues.length)throw new Error(issues[0]);
  if(!Number.isInteger(blockIndex)||blockIndex<0||blockIndex>plan.blocks.length||!Number.isInteger(goalIndex)||goalIndex<0)throw new Error('Het herstelpunt van de show is ongeldig.');
  this.plan=plan;this.active=true;this.voiceFailed=false;this.index=-1;this.initialGoal=goalIndex;this.enter(blockIndex);return true;
 }
 notify(){this.onChange(this.visual());}
 stop(){this.syncToken=(this.syncToken||0)+1;this.heldTarget=null;this.active=false;this.voiceFailed=false;this.phase='idle';this.clearCastCue();this.director.configure({planKind:'',planTitle:'',patternCells:null,prizeImage:'',prizeDescription:''});this.notify();}
 clearCastCue(){if(this.showCue){this.director.event('show-cue',{action:'end',...this.showCue});this.showCue=null;}if(this.castCue){const returnSpeakerId=this.plan?.leadId||this.castCue.speakerId;this.director.event('cast-cue',{action:'end',...this.castCue,returnSpeakerId});this.director.configure({magicId:null,guestId:null,speakerId:returnSpeakerId});this.castCue=null;}}
 next(){if(this.director.callHold)return false;if(!this.active||this.director.scene==='checking')return false;return this.enter(this.heldTarget?.index??this.index+1)!==false;}
 holdRound(index,kind='block'){
  this.syncToken=(this.syncToken||0)+1;this.heldTarget={kind,index};this.phase='draw-held';this.notify();return false;
 }
 enter(index){
  if(this.director.drawBlocked&&this.plan?.blocks[index]?.type==='round')return this.holdRound(index);
  this.heldTarget=null;
  if(this.beforeBlock){this.phase='sync';this.syncTarget={kind:'block',index};const token=this.syncToken=(this.syncToken||0)+1;this.notify();this.syncRequest=Promise.resolve().then(()=>{if(!this.active||this.syncToken!==token)return;if(this.director.drawBlocked&&this.plan?.blocks[index]?.type==='round'){this.holdRound(index);return;}return this.beforeBlock(index,this.initialGoal??0);}).then(()=>{if(this.active&&this.syncToken===token)this.enterReady(index);}).catch(error=>{if(!this.active||this.syncToken!==token)return;if(this.director.drawBlocked&&this.plan?.blocks[index]?.type==='round'){this.holdRound(index);return;}this.phase='sync-error';this.onNotice(error.message);this.notify();});return true;}
  return this.enterReady(index);
 }
 enterReady(index){
  if(this.director.drawBlocked&&this.plan?.blocks[index]?.type==='round')return this.holdRound(index);
  if(index>=this.plan.blocks.length){this.active=false;this.phase='complete';this.notify();return;}
  this.clearCastCue();this.index=index;this.age=0;this.goal=Number.isInteger(this.initialGoal)?this.initialGoal:0;this.initialGoal=null;const b=this.block,d=this.director;
  d.configure({title:this.plan.title,planKind:b.type,planTitle:b.title,patternCells:null,prizeImage:'',prizeDescription:'',...(b.speakerId||this.plan.leadId?{speakerId:b.speakerId||this.plan.leadId}:{}),magicId:b.magicId||null,guestId:b.guestId||null});
  if(b.type==='round'){
   if(b.newBoard)d.reset();else d.cancel(false);
   this.afterRound?.();
   this.announceGoal();return;
  }
  const timed=['countdown','pause','call'].includes(b.type),scene=b.type==='countdown'?'opening':b.type==='pause'?'pause':b.type==='call'?'call':b.type==='finale'?'finale':'host';
  if(b.type==='countdown')d.configure({countdown:b.seconds});
  if(b.type==='pause')d.configure({pauseMinutes:b.seconds/60});
  if(b.type==='call')d.configure({callSeconds:b.seconds,callText:b.text});
  this.phase='flow';
  if(b.type==='show'){
   const cue=getShowCue(b.showCueId);this.showCue={id:cue.id,instanceId:`${b.id}-${crypto.randomUUID()}`,hostId:b.speakerId||this.plan.leadId||'milo'};
   d.event('show-cue',{action:'start',...this.showCue});
   d.program([{scene:'host',duration:cue.duration,camera:cue.shots?.[0]?.camera||cue.camera,motion:cue.motion,sound:cue.sound}]);
  }else if(b.type==='explanation'&&b.explanationSteps?.length){
   // A visual explanation is not a bingo round. Only the existing block sync
   // runs; no goal is activated and no board or official draw state is changed.
   const patterns=b.explanationSteps.map(step=>this.plan.patterns.find(pattern=>pattern.id===step.patternId));
   d.program(b.explanationSteps.flatMap((step,index)=>[
    {scene:'round',duration:2,camera:b.camera||'wide',motion:b.animation||'point',speech:()=>{const pattern=patterns[index];d.configure({round:b.title,roundPatterns:patterns,goalIndex:index,patternPage:Math.floor(index/3),pattern:pattern.title,patternCells:[...pattern.cells],patternFreeCenter:pattern.freeCenter,patternVariant:pattern.variant,prize:''});return step.text;},waitVoice:true},
    {scene:'round',duration:1,camera:b.camera||'wide',motion:'idle'},
   ]));
  }else if(['magic','guest'].includes(b.type)){
   this.castCue={cueId:b.id,kind:b.type,speakerId:b.speakerId||this.plan.leadId||'milo',guestId:b.guestId||null,magicId:b.magicId||null,duration:b.duration};
   const turns=[{speakerId:this.castCue.speakerId,text:b.text,animation:b.animation||'idle'},...(b.type==='guest'?b.dialogue:[])];
   d.program(turns.map((turn,i)=>({scene:'host',duration:Math.max(2,b.duration/turns.length),camera:b.camera||(b.type==='magic'?'magic':'duo'),motion:turn.animation||'idle',speech:()=>{d.configure({speakerId:turn.speakerId});d.event('cast-speaker',{characterId:turn.speakerId,cueId:b.id,animation:turn.animation||'idle',turn:i});return turn.text;},waitVoice:true})));
   d.event('cast-cue',{action:'start',...this.castCue});
  }else d.program([{scene,duration:timed?b.seconds:b.type==='finale'?7:2,camera:b.camera||(scene==='opening'?'establish':scene==='pause'?'tour':b.type==='finale'?'wide':'front'),motion:b.animation||(b.type==='finale'?'cheer':b.type==='welcome'?'wave':'idle'),...(b.type==='finale'?{sound:'finale'}:{}),...(b.text?{speech:b.text,waitVoice:true}:{})}]);
  this.notify();
 }
 announceGoal(){
  if(this.director.drawBlocked)return this.holdRound(this.index,'goal');
  this.heldTarget=null;
  if(this.beforeGoal&&this.goal>0){this.phase='sync';this.syncTarget={kind:'goal',index:this.index};const token=this.syncToken=(this.syncToken||0)+1;this.syncRequest=Promise.resolve().then(()=>{if(!this.active||this.syncToken!==token)return;if(this.director.drawBlocked){this.holdRound(this.index,'goal');return;}return this.beforeGoal(this.index,this.goal);}).then(()=>{if(this.active&&token===this.syncToken)this.announceReady();}).catch(error=>{if(!this.active||this.syncToken!==token)return;if(this.director.drawBlocked){this.holdRound(this.index,'goal');return;}this.phase='sync-error';this.onNotice(error.message);this.notify();});return;}
  this.announceReady();
 }
 announceReady(){
  if(this.director.drawBlocked)return this.holdRound(this.index,'goal');
  const b=this.block,g=b.goals[this.goal],pattern=this.plan.patterns.find(p=>p.id===g.patternId),prize=this.plan.prizes.find(p=>p.id===g.prizeId),d=this.director;
  this.approvalBase=d.approvals;this.age=0;this.phase='round-intro';
  d.configure({roundPatterns:b.goals.map(g=>this.plan.patterns.find(p=>p.id===g.patternId)),goalIndex:this.goal,patternPage:Math.floor(this.goal/3),round:b.title,pattern:pattern.title,patternCells:[...pattern.cells],patternFreeCenter:pattern.freeCenter,patternVariant:pattern.variant,prize:prize.title,prizeImage:prize.image,prizeDescription:prize.description});
  d.take('round');this.notify();
 }
 drawNow(){
  if(this.director.drawBlocked||!this.active||this.block?.type!=='round'||this.phase!=='drawing')return false;
  this.age=0;return this.director.draw();
 }
 tick(delta){if(this.director.callHold)return;
  const d=this.director;if(!this.active||d.paused||d.externalHold||d.narrationHold||d.scene==='checking'||!Number.isFinite(delta)||delta<=0)return;
  // Hold only bingo progression. Stories, magic and other entertainment keep
  // their normal timing; the next round waits without resetting the board.
  if(d.drawBlocked&&(this.block?.type==='round'||this.phase==='draw-held'))return;
  if(this.phase==='draw-held'){const target=this.heldTarget;this.heldTarget=null;if(target?.kind==='goal')this.announceGoal();else if(target)this.enter(target.index);return;}
  if(['sync','sync-error'].includes(this.phase)||!this.block)return;
  if(this.phase==='waiting'){
   if(this.block.type==='round'&&d.approvals>this.approvalBase){this.phase='winner';this.notify();}else return;
  }
  const b=this.block;
  if(b.type==='round'){
   if(this.phase==='drawing'&&d.approvals>this.approvalBase){this.phase='winner';this.notify();}
   if(d.flow){this.age=0;return;}
   if(this.phase==='round-intro'){this.phase='round-prize';d.take('prize');this.notify();return;}
   if(this.phase==='round-prize'){this.phase='drawing';this.age=0;this.notify();return;}
   if(this.phase==='winner'){
    if(this.goal+1<b.goals.length){this.goal++;this.announceGoal();}else this.enter(this.index+1);return;
   }
   if(this.phase==='drawing'){
    if(this.autoDraw===false)return;
    if(d.drawn.length>=75){this.phase='waiting';this.onNotice('Alle 75 ballen zijn getrokken. Controleer een bingo of ga naar het volgende blok.');this.notify();return;}
    this.age+=delta;if(this.age>=b.interval){this.age=0;d.draw();this.notify();}return;
   }
  }
  if(this.phase==='flow'&&!d.flow){
   this.clearCastCue();
   this.age=0;
   if(b.type==='call'&&b.advance==='manual'){this.phase='waiting';this.onNotice('De belronde wacht op de regie. Kies Volgend blok wanneer je verder wilt.');this.notify();return;}
   this.phase='hold';this.notify();return;
  }
  if(this.phase==='hold'){this.age+=delta;if(this.age>=(b.hold||0))this.enter(this.index+1);}
 }
 visual(){const b=this.block;return {active:this.active,phase:this.phase,index:this.index,total:this.plan?.blocks.length||0,title:b?.title||'',kind:b?.type||'',speakerId:this.director.config.speakerId||b?.speakerId||this.plan?.leadId||null,magicId:b?.magicId||null,guestId:b?.guestId||null,goal:this.goal+1,goals:b?.goals?.length||0,waiting:this.phase==='waiting',drawBlocked:!!this.director.drawBlocked,heldIndex:this.heldTarget?.index??null};}
 retrySync(){if(this.phase!=='sync-error'||!this.syncTarget)return false;if(this.syncTarget.kind==='goal')this.announceGoal();else this.enter(this.syncTarget.index);return true;}
}
