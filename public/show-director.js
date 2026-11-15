import {showBrand} from './show-brands.js?v=36';
import {bt} from './brand-ui.js?v=37';
import {bingoNumberText,roundSpeech,prizeSpeech,FIXED_SHOW_SPEECH} from './bingo-speech.js';
export const SCENES=Object.freeze([
 {id:'still',name:'Still met showlogo',short:'Still',camera:'wide',hint:'Tussenbeeld zonder presentator',key:'S'},
 {id:'rules',name:'Spelregels',short:'Spelregels',camera:'wide',hint:'Geselecteerde spelregels',key:'R'},
 {id:'patterns',name:'Patronen van deze ronde',short:'Patronen',camera:'wide',hint:'Alle stappen in speelvolgorde',key:'P'},
 {id:'question',name:bt('Vraag aan Vlampie'),short:'Kijkersvraag',camera:'portrait',hint:bt('Kies een vraag in de chat of bij Vlampie'),key:'V'},
 {id:'opening',name:'Opening',short:'Opening',camera:'establish',hint:'Aftellen en welkom',key:'1'},
 {id:'host',name:bt('Vlampie aan de desk'),short:'Presentator',camera:'desk',hint:bt('Het woord aan Vlampie'),key:'2'},
 {id:'draw',name:'Volgende bal',short:'Trekking',camera:'machine',hint:'Molen, onthulling en bord',key:'3'},
 {id:'board',name:'Bingobord',short:'Bingobord',camera:'led',hint:'Alle 75 getallen',key:'4'},
 {id:'round',name:'Ronde aankondigen',short:'Nieuwe ronde',camera:'wide',hint:'Ronde en speelpatroon',key:'5'},
 {id:'prize',name:'Prijs onthullen',short:'De prijs',camera:'wide',hint:'Cadeau en prijsnaam',key:'6'},
 {id:'pause',name:'Pauze',short:'Pauze',camera:'tour',hint:'Rustig pauzescherm',key:'7'},
 {id:'audience',name:'Applaus voor het publiek',short:'Publiek',camera:'audience',hint:'Een moment voor iedereen',key:'8'},
 {id:'finale',name:'Finale',short:'Finale',camera:'wide',hint:'Bedanken en afsluiten',key:'9'},
 {id:'card',name:bt('Bingokaart naast Vlampie'),short:'Kaartcontrole',camera:'front',hint:'De gemelde kaart op het podium',key:'0'},
]);
export const SCENE_NAMES={lobby:'Voorprogramma',standby:'Klaar voor de show',call:'Belronde',minigame:'Beslisspel',reveal:'Balonthulling',checking:'Bingocontrole',winner:'Bingo bevestigd',rejected:'Even verder spelen',...Object.fromEntries(SCENES.map(s=>[s.id,s.name]))};
export const DEFAULT_SHOW={title:bt('Vlampie’s Bingo'),round:'Ronde 1',pattern:'Volle kaart',prize:'Een feestelijk verrassingspakket',pauseMinutes:5,autoCamera:true,voice:true,sound:true,comments:true,audience:true,countdown:5};
const comments={
 royale:['Een prachtige rij lichtjes. Houd die kaarten in de spotlights!','Een korte blik op je kaart. Welk nummer krijgt zo een hoofdrol?','Dames, heren en jonge eregasten: een applaus voor jullie allemaal!'],
 magico:['Kijk eens hoe het bord fonkelt. Welke vakjes schitteren er op jouw kaart?','Nog even goed kijken. Het volgende nummer blijft ook voor mij een verrassing!','De mooiste magie maken we samen. Wat gezellig dat jullie meespelen!'],
 showtime:['Zo, het bord begint al mooi te schitteren! Hoe gaat het op jullie kaarten?','Even goed kijken naar je kaart. Misschien komt jouw nummer er zo aan!','Wat een gezellige avond. Een applaus voor iedereen die meespeelt!'],
 sinterklaas:['De kruidnoten liggen klaar, maar eerst goed naar je kaart kijken!','Zou er een bingokaart in mijn schoen passen? Die zit vast vol geluksnummers!','Al die lichtjes op het bord! Het lijkt wel een cadeautje voor onze studio.'],
};
export function chooseBingoNumber(drawn,random=globalThis.crypto){
 const remaining=Array.from({length:75},(_,i)=>i+1).filter(n=>!drawn.includes(n));if(!remaining.length)return null;
 // Rejection sampling avoids favouring the first numbers in the remaining list.
 const ceiling=Math.floor(4294967296/remaining.length)*remaining.length,word=new Uint32Array(1);
 do{random.getRandomValues(word);}while(word[0]>=ceiling);
 return remaining[word[0]%remaining.length];
}

// The regie is the only owner of this state machine. Show/preview windows receive
// its visual snapshot and never choose or commit a ball themselves.
export class ShowDirector{
 constructor({config={},onEvent=()=>{},random=globalThis.crypto}={}){
  this.config={...DEFAULT_SHOW,...config};this.onEvent=onEvent;this.random=random;
  this.drawn=[];this.pending=null;this.number=null;this.scene='standby';this.sceneAge=0;
  this.sceneRevision=0;this.narrationHold=false;this.preview='opening';this.flow=null;this.suspended=null;this.claim=null;this.paused=false;
  this.theme='sinterklaas';this.camera='wide';this.lookAt='camera';this.started=false;this.lastWinner='';this.approvals=0;
 }
 event(type,payload={}){this.onEvent({type,...payload});}
 configure(values){Object.assign(this.config,values);this.event('change');}
 select(scene){if(!SCENES.some(s=>s.id===scene))return false;this.preview=scene;this.event('change');return true;}
 get busy(){return !!this.flow||this.scene==='checking';}
 get step(){return this.flow?.steps[this.flow.index];}
 get drawBlocked(){return !!this.config.drawBlocked;}
 set drawBlocked(value){this.config.drawBlocked=!!value;}
 take(scene=this.preview){
  if(this.callHold||this.scene==='checking'||this.externalHold)return false;
  if(scene==='draw')return this.draw();
  if(scene==='round'&&this.drawBlocked)return false;
  if(!SCENES.some(s=>s.id===scene))return false;
  this.cancel(false);this.paused=false;this.started=true;this.event('resume');
  if(scene==='opening')this.run('opening',[
   {scene:'opening',duration:this.config.countdown,camera:'establish',motion:'welcome',sound:'intro'},
   {scene:'host',duration:3,camera:'front',motion:'wave',speech:['royale','magico'].includes(this.theme)?showBrand(this.brandId||this.config.brandId).intro:this.theme==='sinterklaas'?bt('Hallo allemaal! Welkom bij Vlampie’s pakjesavondbingo! Pak je kaart erbij, we maken er samen een gezellige show van.'):bt('Hallo allemaal! Welkom bij Vlampie’s Bingo! Pak je kaart erbij en speel gezellig mee.'),waitVoice:true},
   {scene:'host',duration:1,camera:'desk',motion:'idle'},
  ]);
  else if(scene==='round')this.run('round',[{scene:'round',duration:5,camera:'wide',motion:'welcome',sound:'round',speech:roundSpeech(this.config.round,this.config.pattern),waitVoice:true},{scene:'host',duration:1,camera:'desk',motion:'idle'}]);
  else if(scene==='prize')this.run('prize',[{scene:'prize',duration:6,camera:'wide',motion:'welcome',sound:'prize',speech:prizeSpeech(this.config.prize),waitVoice:true}]);
  else if(scene==='finale')this.run('finale',[{scene:'finale',duration:7,camera:'wide',motion:'cheer',sound:'finale',speech:FIXED_SHOW_SPEECH.thanks,waitVoice:true},{scene:'finale',duration:4,camera:'front',motion:'bow'}]);
  else {const target=SCENES.find(s=>s.id===scene);this.lookAt='camera';this.setScene(scene,target.camera,true);this.event('motion',{motion:scene==='host'?'idle':scene==='audience'?'welcome':'idle',lookAt:'camera'});if(scene==='audience'&&this.config.audience)this.event('sound',{cue:'applause'});}
  return true;
 }
 draw(){
  if(this.drawBlocked||this.callHold||this.externalHold||this.narrationHold)return false;
  if(this.paused&&this.flow?.kind==='draw'){this.resume();return true;}
  if(this.busy||this.drawn.length>=75)return false;
  this.cancel(false);this.paused=false;this.started=true;this.event('resume');
  const milo=(this.brandId||this.config.brandId)==='milo',official=milo&&this.config.drawCadence==='official';
  this.run('draw',[
   {scene:'host',duration:1.15,camera:this.drawn.length%3===2?'portrait':'desk',motion:'look',lookAt:'machine'},
   {scene:'draw',duration:4.3,camera:'machine',motion:'idle',sound:'spin',pick:true},
   {scene:'reveal',duration:3.2,camera:'machine',motion:'point',sound:'reveal',commit:true,speech:()=>bingoNumberText(this.number,milo?'milo':'vlampie'),waitVoice:true},
   {scene:'board',duration:official?.45:2.2,camera:'led',motion:'point',lookAt:'board'},
   {scene:'host',duration:official?.45:2.8,camera:'desk',motion:!milo&&this.drawn.length%5===4?'welcome':'idle',speech:()=>!milo&&this.config.comments&&this.drawn.length%5===0?(comments[this.theme]||comments.showtime)[Math.floor(this.drawn.length/5-1)%3]:'',waitVoice:true},
  ]);return true;
 }
 run(kind,steps){this.flow={kind,steps,index:0,age:0};this.enter(true);}
 program(steps){
  if(this.callHold||this.scene==='checking'||!steps.length||this.drawBlocked&&steps.some(step=>step.pick||step.commit))return false;
  this.cancel(false);this.paused=false;this.started=true;this.event('resume');this.run('planned',steps);return true;
 }
 setScene(scene,camera,force=false,notify=true){this.scene=scene;this.sceneRevision++;this.sceneAge=0;if(camera&&(force||this.config.autoCamera)){this.camera=camera;this.event('camera',{camera});}if(notify)this.event('change');}
 enter(first=false){
  const step=this.step;if(!step)return;
  // A confirmed commit may arrive after the hold was installed. Show that
  // already-drawn ball, but never initiate another reservation or commit.
  if(this.drawBlocked&&(step.pick&&!this.flow.serverPicked||step.commit&&!this.flow.serverCommitted)){this.flow.drawBlocked=true;this.flow.firstOnResume=first;return;}
  if(step.pick&&this.requestPick&&!this.flow.serverPicked){
   const flow=this.flow;flow.awaiting=true;
   Promise.resolve().then(()=>{if(this.flow!==flow)return null;if(this.drawBlocked){flow.awaiting=false;flow.drawBlocked=true;flow.firstOnResume=first;return null;}return this.requestPick();}).then(p=>{if(this.flow!==flow||!p)return;this.pending=p.number;this.pendingToken=p.token;flow.serverPicked=true;flow.awaiting=false;if(this.paused){flow.enterOnResume=true;flow.firstOnResume=first;}else this.enter(first);}).catch(error=>{if(this.flow!==flow)return;flow.awaiting=false;flow.externalFailed=true;this.pause();this.event('external-error',{error});});return;
  }
  if(step.commit&&this.requestCommit&&!this.flow.serverCommitted){
   const flow=this.flow;flow.awaiting=true;
   Promise.resolve().then(()=>{if(this.flow!==flow)return null;if(this.drawBlocked){flow.awaiting=false;flow.drawBlocked=true;flow.firstOnResume=first;return null;}return this.requestCommit(this.pendingToken);}).then(commit=>{if(this.flow!==flow||!commit)return;this.pending=commit.number;flow.serverCommitted=true;flow.awaiting=false;if(this.paused){flow.enterOnResume=true;flow.firstOnResume=first;}else this.enter(first);}).catch(error=>{if(this.flow!==flow)return;flow.awaiting=false;flow.externalFailed=true;this.pause();this.event('external-error',{error});});return;
  }
  this.lookAt=step.lookAt||'camera';
  this.setScene(step.scene,step.camera,first,false);
  if(step.pick&&!this.requestPick)this.pending=chooseBingoNumber(this.drawn,this.random);
  if(step.commit){
   if(this.pending===null||this.drawn.includes(this.pending)&&!this.requestCommit){this.cancel();return;}
   this.number=this.pending;this.pending=null;if(!this.drawn.includes(this.number))this.drawn.push(this.number);this.event('commit',{number:this.number});
  }
  this.event('motion',{motion:step.motion||'idle',lookAt:this.lookAt});
  if(step.sound&&this.config.sound)this.event('sound',{cue:step.sound});
  const text=typeof step.speech==='function'?step.speech():step.speech;
  this.flow.hasSpeech=!!(text&&this.config.voice);if(this.flow.hasSpeech)this.event('speech',{text});
  this.event('change');
 }
 tick(delta,{voiceBusy=false}={}){if(this.callHold)return;
  if(this.paused||this.externalHold||this.narrationHold||!Number.isFinite(delta)||delta<=0)return;
  if(this.drawBlocked&&this.flow?.kind==='draw')return;
  if(this.flow?.drawBlocked){this.flow.drawBlocked=false;this.enter(this.flow.firstOnResume);return;}
  this.sceneAge+=delta;
  if(!this.flow)return;
  if(this.flow.awaiting||this.flow.externalFailed)return;
  this.flow.age+=delta;
  const step=this.step;if(this.flow.age<step.duration||(step.waitVoice&&this.flow.hasSpeech&&voiceBusy))return;
  // Optional remarks run outside the required draw flow. Announce the opening
  // only after the official number has finished, never while a claim is held.
  if(this.flow.kind==='draw'&&step.commit&&!this.flow.numberFinished){const flow=this.flow;flow.numberFinished=true;this.event('numberfinished',{number:this.number,index:this.drawn.length-1,count:this.drawn.length});if(this.flow!==flow||this.paused||this.callHold||this.externalHold||this.drawBlocked||this.narrationHold)return;}
  if(this.flow.index+1<this.flow.steps.length){this.flow.index++;this.flow.age=0;this.enter();}
  else{const kind=this.flow.kind;this.flow=null;
   if(kind==='rejected'&&this.suspended){this.flow=this.suspended;this.suspended=null;if(this.flow.externalFailed){this.flow.externalFailed=false;this.flow.age=0;this.enter();return;}const savedAge=this.flow.age;this.scene=this.step.scene;this.sceneAge=savedAge;if(this.config.autoCamera)this.event('camera',{camera:this.step.camera});this.lookAt=this.step.lookAt||'camera';this.event('motion',{motion:this.step.motion||'idle',lookAt:this.lookAt});const text=typeof this.step.speech==='function'?this.step.speech():this.step.speech;if(text&&this.config.voice)this.event('speech',{text});}
   if(kind==='rejected'&&!this.flow)this.setScene('host','desk');
   this.event('change');
  }
 }
 pause(){if(this.paused)return;this.paused=true;this.event('pause');this.event('change');}
 resume(){if(this.callHold||this.scene==='checking'||this.externalHold||this.drawBlocked&&this.flow?.kind==='draw')return false;this.paused=false;if(this.flow?.enterOnResume){this.flow.enterOnResume=false;this.enter(this.flow.firstOnResume);}else if(this.flow?.externalFailed){this.flow.externalFailed=false;this.flow.age=0;this.enter();}this.event('resume');this.event('change');return true;}
 cancel(notify=true){this.flow=null;this.suspended=null;this.pending=null;this.event('cancel');if(notify)this.event('change');}
 reportBingo(name='',card=''){
  if(this.scene==='checking')return false;
  this.suspended=this.flow;this.flow=null;this.claim={name:String(name).trim().slice(0,60)||'Een deelnemer',card:String(card).trim().slice(0,40),status:'checking'};
  this.paused=false;this.lookAt='camera';this.event('cancel');this.setScene('checking','portrait',true);this.event('motion',{motion:'think',lookAt:'camera'});
  if(this.config.voice)this.event('speech',{text:FIXED_SHOW_SPEECH.bingo});return true;
 }
 resolveBingo(approved,{checked=false}={}){
  if(this.scene!=='checking'||!this.claim||(approved&&!checked))return false;
  this.paused=false;this.event('cancel');
  if(approved){
   this.pending=null;this.suspended=null;this.claim.status='approved';this.lastWinner=this.claim.name;this.approvals++;
   this.run('winner',[{scene:'winner',duration:6,camera:'portrait',motion:'cheer',sound:'win',speech:(this.brandId||this.config.brandId)==='milo'?FIXED_SHOW_SPEECH.winner:`Bingo bevestigd! Gefeliciteerd ${this.claim.name}! Een groot applaus voor jou!`,waitVoice:true},...(this.config.audience?[{scene:'audience',duration:2,camera:'audience',motion:'welcome',sound:'applause'}]:[]),{scene:'winner',duration:5,camera:'wide',motion:'cheer'}]);
  }else{this.claim.status='rejected';this.run('rejected',[{scene:'rejected',duration:3.5,camera:'desk',motion:'welcome',sound:'friendly',speech:FIXED_SHOW_SPEECH.false,waitVoice:true}]);}
  return true;
 }
 reset(){this.cancel(false);this.drawn=[];this.pending=null;this.number=null;this.claim=null;this.lastWinner='';this.approvals=0;this.paused=false;this.lookAt='camera';this.setScene('host','desk',true);this.event('motion',{motion:'idle',lookAt:'camera'});this.event('change');}
 visual(){return {brandId:this.brandId||this.config.brandId||'vlampie',scene:this.scene,liveCall:!!this.config.liveCall,sceneRevision:this.sceneRevision,transition:this.config.transition||'fade',transitionMs:this.config.transitionMs||700,rules:this.config.rules||[],rulePage:this.config.rulePage||0,roundPatterns:this.config.roundPatterns||[],goalIndex:this.config.goalIndex||0,patternPage:this.config.patternPage||0,question:this.config.question||null,age:this.sceneAge,duration:this.step?.duration||0,flow:this.flow?.kind||null,paused:this.paused,preview:this.preview,title:this.config.title,round:this.config.round,pattern:this.config.pattern,prize:this.config.prize,pauseMinutes:this.config.pauseMinutes,countdown:this.config.countdown,number:this.number,drawnCount:this.drawn.length,claim:this.claim?{...this.claim}:null,winner:this.lastWinner,lookAt:this.lookAt,audience:this.config.audience,reducedMotion:!!this.config.reducedMotion,planKind:this.config.planKind||'',planTitle:this.config.planTitle||'',patternCells:this.config.patternCells||null,patternFreeCenter:this.config.patternFreeCenter!==false,patternVariant:this.config.patternVariant||'fixed',prizeImage:this.config.prizeImage||'',prizeDescription:this.config.prizeDescription||'',callSeconds:this.config.callSeconds||0,callText:this.config.callText||'',gameStage:this.config.gameStage||null,externalHold:!!this.externalHold,drawBlocked:this.drawBlocked};}
}
