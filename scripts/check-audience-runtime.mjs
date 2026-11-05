import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {AudienceRuntime} from '../frontend/call-runtime.js';
import {defaultProfile} from '../server/presentation-model.js';

class Connection{
 constructor(options){Object.assign(this,options);this.call=null;this.now=10000;this.lastOK=Date.now();this.actions=[];}
 async poll(){return this.call;}
 async action(action,body={}){this.actions.push({action,...body});if(action==='prepare')this.call={id:'call-1',gameId:'game-1',name:'Noor',characterId:body.characterId,phase:'checking'};else this.call={...this.call,phase:action==='ring'?'announcing':action==='stop'?'ended':this.call?.phase};this.onChange(this.call);return this.call;}
 leave(){this.left=true;}
}
function engine(){const events=[],e={isOutput:false,demo:false,game:{id:'game-1',status:'running',state:{epoch:'epoch-1',paused:false},participation:[{id:'guest-1',name:'Noor',callStatus:'requested'}]},clientId:'host-1',hostId:'milo',speakerId:'milo',camera:'wide',voicePhase:'idle',apiStatus:{configured:true},emit(){events.push('emit');},fail(m){this.error=m;},notify(m){this.notice=m;},stopSpeech(){events.push('stopSpeech');this.voicePhase='idle';},speak(text,id,mode){events.push({text,id,mode});},post:async(action,body)=>events.push({action,body}),pause:async function(value){this.director.paused=value;this.game.state.paused=value;events.push({pause:value});return true;},audio:{pause(){events.push('audioPause');}},bridge:{id:'output-1',routing:true,connected:true,connect:async()=>{},sendLocal(){events.push('broadcast');},controls(command){events.push({command});}}};e.director={scene:'host',sceneAge:17,sceneRevision:3,paused:false,configure(p){Object.assign(this.config,p);},config:{},setScene(scene){this.scene=scene;this.sceneRevision++;},pause(){this.paused=true;}};return {e,events};}
const runtime=(e,options={})=>new AudienceRuntime(e,{Connection,timers:false,...options});

test('real call preparation uses routed output and selected character; ring captures and holds show until deliberate resume',async()=>{
 const {e,events}=engine(),r=runtime(e);await r.invite('guest-1');assert.deepEqual(events.find(x=>x?.action==='call-status'),{action:'call-status',body:{entryId:'guest-1',status:'invited'}});
 e.bridge.routing=false;await assert.rejects(()=>r.prepare('guest-1',90,'stella'),/uitzendvenster/);assert.equal(r.connection.actions.length,0);
 e.bridge.routing=true;await r.prepare('guest-1',90,'stella');assert.deepEqual(r.connection.actions[0],{action:'prepare',entryId:'guest-1',maxSeconds:90,characterId:'stella'});
 r.connection.call.phase='ready';e.showRuntime={holding:true};await assert.rejects(()=>r.action('ring'),/lopende show/);e.showRuntime.holding=false;e.director.pending={number:27};await assert.rejects(()=>r.action('ring'),/trekking/);delete e.director.pending;
 e.error='';await r.action('ring');assert.equal(r.held,true);assert.equal(e.director.scene,'call');assert.equal(e.director.paused,true);assert.equal(e.speakerId,'stella');
 r.onPhase({...r.connection.call,phase:'ended'});assert.equal(e.director.scene,'host');assert.equal(e.director.sceneAge,17);assert.equal(e.camera,'wide');assert.equal(e.director.paused,true);assert.equal(events.filter(x=>x?.pause===false).length,0);r.dispose();
});

test('a failed pause prevents ringing and a changed game epoch prevents restoring an obsolete scene',async()=>{
 const {e}=engine(),r=runtime(e);r.connection.call={id:'call-1',phase:'ready',characterId:'milo'};e.pause=async()=>false;await assert.rejects(()=>r.action('ring'),/gepauzeerd/);assert.equal(r.connection.actions.length,0);
 e.pause=async value=>{e.director.paused=value;return true;};await r.action('ring');e.game.state.epoch='epoch-2';r.onPhase({...r.connection.call,phase:'ended'});assert.equal(e.director.scene,'call');assert.equal(e.director.callHold,false);assert.equal(e.director.paused,true);r.dispose();
});

test('question reply requires review, selected character and fresh source validation before airing',async()=>{
 const {e,events}=engine(),requests=[];let valid=true;const r=runtime(e,{api:async(path,body)=>{requests.push({path,body});if(path==='present')return {action:'reply',text:'Wat een mooie vraag!',name:'Noor',question:'Kan een ster dansen?',messageId:body.messageId,characterId:body.characterId};if(!valid)throw new Error('Bericht verwijderd');return {valid:true};}});
 r.selectQuestion({id:'m-1',name:'Noor',text:'Kan een ster dansen?'});await r.prepareQuestion('stella');assert.equal(r.getSnapshot().review.phase,'review');await assert.rejects(()=>r.airQuestion(),/keur/);assert.equal(requests.length,1);
 r.approveQuestion(true);e.showRuntime={holding:true};await assert.rejects(()=>r.airQuestion(),/lopende show/);assert.equal(requests.length,1);e.showRuntime.holding=false;valid=false;await assert.rejects(()=>r.airQuestion(),/verwijderd/);assert.equal(events.some(x=>x?.mode==='ai'),false);
 valid=true;await r.airQuestion();assert.deepEqual(events.find(x=>x?.mode==='ai'),{text:'Wat een mooie vraag!',id:'stella',mode:'ai'});assert.equal(e.director.config.question.name,'Noor');assert.equal(e.director.scene,'question');assert.equal(r.getSnapshot().review.phase,'aired');r.clearQuestion();assert.equal(e.director.scene,'host');assert.equal(e.director.config.question,null);r.dispose();
});

test('late generated replies cannot repopulate a removed question',async()=>{
 const {e}=engine();let answer;const r=runtime(e,{api:()=>new Promise(resolve=>{answer=resolve;})});r.selectQuestion({id:'old',name:'Noor',text:'Vraag'});const pending=r.prepareQuestion('milo');r.clearQuestion();answer({action:'reply',text:'Late reactie',characterId:'milo'});await pending;assert.equal(r.getSnapshot().review,null);r.dispose();
});

test('output owns actual call voice animation and frozen character identity without resuming bingo',()=>{
 const {document}=parseHTML('<html><body><div id="stage"></div></body></html>');const previous=globalThis.document;globalThis.document=document;
 class Output{constructor(){this.api={call:{id:'live',phase:'live',name:'Noor',characterId:'stella'}};this.overlay=document.createElement('div');this.level=.4;this.transcript='Hallo Noor!';}close(){this.closed=true;}emergencyStop(){this.stopped=true;}}
 const {e}=engine();e.isOutput=true;e.demo=true;const r=runtime(e,{Output});r.mountOutput(document.getElementById('stage'));const first=r.output;r.mountOutput(document.getElementById('stage'));assert.equal(r.output,first);assert.equal(document.getElementById('stage').children.length,1);
 const base={hostId:'milo',paused:true,show:{title:'Première',round:'Ronde1',paused:true}};const stage=r.stagePatch(base);assert.equal(stage.hostId,'stella');assert.equal(stage.speakerId,'stella');assert.equal(stage.speaking,true);assert.equal(stage.paused,false);assert.equal(stage.show.title,'Première');assert.equal(stage.show.liveCall,true);assert.equal(base.paused,true);e.bridge.onCallStop();assert(first.stopped);r.dispose();assert(first.closed);globalThis.document=previous;
});

test('guided/off never spend automatically; saved auto mode honors host lease, mentions, interval and account cooldown',async()=>{
 const {e,events}=engine();let now=1000000;const requests=[];e.voiceMode='ai';e.game.brandId='milo';e.game.startedAt=now-1000;e.game.state.control={id:e.clientId,until:now+1000000};e.game.presentationSnapshot={profile:{...defaultProfile(),mode:'guided',mentions:true,spontaneous:false,intervalSeconds:30,accountCooldownSeconds:120},rules:[]};
 const r=runtime(e,{now:()=>now,api:async(path,body)=>{requests.push({path,body});return path==='present'?{action:'reply',text:'Wat gezellig!',name:'Noor',question:'Mag ik zwaaien?',messageId:body.messageId,memberId:'member-1',characterId:body.characterId}:{valid:true};}});r.autoGameId=e.game.id;r.bootAt=now-1000;r.chat={messages:new Map([['m-1',{id:'m-1',name:'Noor',text:'@Milo mag ik zwaaien?',memberId:'member-1',role:'player',at:now}]]),dispose(){}};
 await r.autoTick();assert.equal(requests.length,0);e.game.presentationSnapshot.profile.mode='off';await r.autoTick();assert.equal(requests.length,0);e.game.presentationSnapshot.profile.mode='auto';e.game.state.control.id='other-host';await r.autoTick();assert.equal(requests.length,0);
 e.game.state.control.id=e.clientId;e.magic={id:'star-hat'};await r.autoTick();assert.equal(requests.length,0);e.magic=null;await r.autoTick();assert.equal(requests.length,1);assert.equal(requests[0].body.automatic,true);assert.equal(requests[0].body.regieId,e.clientId);assert.equal(requests[0].body.characterId,'milo');assert.equal(r.review.approved,true);
 await r.autoTick();assert.equal(requests.filter(x=>x.path==='validate').length,1);assert.equal(events.filter(x=>x?.mode==='ai').length,1);await r.autoTick();assert.equal(r.review,null);
 now+=31000;r.chat.messages.set('m-2',{id:'m-2',text:'@Milo nog een vraag?',name:'Noor',memberId:'member-1',role:'player',at:now});await r.autoTick();assert.equal(requests.filter(x=>x.path==='present').length,1,'same account cooldown');
 r.chat.messages.set('m-3',{id:'m-3',text:'Gewoon gezellig!',name:'Sam',memberId:'member-2',role:'player',at:now});await r.autoTick();assert.equal(requests.filter(x=>x.path==='present').length,1,'mentions-only excludes unaddressed messages');
 now+=5001;e.game.presentationSnapshot.profile.spontaneous=true;await r.autoTick();assert.equal(requests.filter(x=>x.path==='present').length,2);r.dispose();
});

test('the same live chat controller survives moving between regie and audience pages',()=>{
 const {document}=parseHTML('<html><body><div id="regie"></div><div id="audience"></div></body></html>');const previous=globalThis.document;globalThis.document=document;let count=0;
 class Chat{constructor({root}){count++;this.root=root;this.messages=new Map();this.games=[];}setGame(id){this.games.push(id);}dispose(){this.disposed=true;}}
 const {e}=engine(),r=runtime(e,{Chat});const leaveRegie=r.mountChat(document.getElementById('regie'),true),chat=r.chat;assert.equal(count,1);assert.equal(chat.games[0],'game-1');leaveRegie();assert.equal(chat.disposed,undefined);r.mountChat(document.getElementById('audience'));assert.equal(r.chat,chat);assert.equal(count,1);assert.equal(chat.games.length,1);assert.equal(document.getElementById('audience').shadowRoot.contains(chat.root),true);r.dispose();assert.equal(chat.disposed,true);globalThis.document=previous;
});

test('emergency stop takes priority over a busy call control and cancels late preparation',async()=>{
 const {e}=engine(),r=runtime(e);r.connection.call={id:'call-1',phase:'ready',gameId:e.game.id};r.busy=true;await r.stop();assert.equal(r.connection.actions.at(-1).action,'stop');assert.equal(r.connection.call.phase,'ended');r.busy=false;
 let finishPrepare;const baseAction=r.connection.action.bind(r.connection);r.connection.action=async(action,body)=>{if(action==='prepare')await new Promise(resolve=>{finishPrepare=resolve;});return baseAction(action,body);};r.connection.call=null;const pending=r.prepare('guest-1',90,'milo');await new Promise(resolve=>setTimeout(resolve,0));await r.stop();finishPrepare();await assert.rejects(pending,/geannuleerd/);assert.equal(r.connection.call.phase,'ended');r.dispose();
});
