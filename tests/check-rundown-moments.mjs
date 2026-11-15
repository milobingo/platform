import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultPlan,normalizePlan,planIssues,createBlock} from '../server/plan-model.js';
import {manualCueAvailability} from '../server/manual-cues.js';
import {ShowRunner} from '../public/show-runner.js';
import {ShowDirector} from '../public/show-director.js';
import {playerGame,makeGame} from '../server/bingo-model.js';
import {showAudioScripts} from '../server/show-audio-manifest.js';
import {drawShowGraphics} from '../public/show-graphics.js';

const makeCue=(condition,extra={})=>({id:'handtekst',title:'Microfoontekst',text:'De officiële spelstand blijft leidend.',condition,...extra});
function game(){return {status:'running',settings:{consolationEnabled:true},plan:{blocks:[{id:'round-1',type:'round',goals:[{id:'step-1'},{id:'step-2'},{id:'step-3'}]},{id:'round-2',type:'round',goals:[{id:'final-step'}]}]},results:[],state:{phase:'running',roundIndex:0,goalIndex:0,epoch:'current',window:null,resultId:null,goalWon:false}};}
function result(g,{acknowledged=false,tie=false,consolations=[]}={}){const row={id:'official',type:'bingo',roundIndex:g.state.roundIndex,goalIndex:g.state.goalIndex,epoch:g.state.epoch,acknowledged,entrants:tie?[{id:'one'},{id:'two'}]:[{id:'one'}],consolations};g.results.push(row);g.state.resultId=acknowledged?null:row.id;g.state.goalWon=true;g.state.window={status:'closed',epoch:g.state.epoch,claims:[{status:'valid'}]};return row;}
function run(plan){const events=[],director=new ShowDirector({config:{voice:true,sound:false,comments:false},onEvent:event=>events.push(event)}),runner=new ShowRunner(director);runner.start(plan);const tick=(seconds=.25,voiceBusy=false)=>{director.tick(seconds,{voiceBusy});runner.tick(seconds);};return {events,director,runner,tick};}

test('rundown text and every guest dialogue turn retain 10,000 characters and private notes',()=>{
 const plan=defaultPlan();plan.leadId='milo';plan.studioId='sterrenplein';const guest=createBlock('guest',plan,'milo');guest.text='a'.repeat(10000);guest.operatorNotes='REGIE: nooit uitspreken of publiceren.';guest.dialogue=Array.from({length:5},(_,index)=>({speakerId:index%2?'milo':'piko',text:index?'Dit is een bewaarde dialoogbeurt.':'😀'.repeat(10000),animation:'wave'}));plan.blocks=[guest];plan.manualCues=[makeCue('always',{speakerId:'milo',notes:'REGIE: uitsluitend achter de schermen.'})];
 const saved=normalizePlan(plan);assert.equal(Array.from(saved.blocks[0].text).length,10000);assert.equal(Array.from(saved.blocks[0].dialogue[0].text).length,10000);assert.equal(saved.blocks[0].dialogue.length,5);assert.equal(saved.blocks[0].operatorNotes,guest.operatorNotes);assert.equal(saved.manualCues[0].notes,plan.manualCues[0].notes);assert.deepEqual(planIssues(saved),[]);
 const tooLong=structuredClone(plan);tooLong.blocks[0].text+='a';assert.throws(()=>normalizePlan(tooLong),/10.000/);
 const tooMany=structuredClone(plan);tooMany.blocks[0].dialogue=Array.from({length:13},()=>({speakerId:'piko',text:'Hallo.'}));assert.throws(()=>normalizePlan(tooMany),/Dialoogbeurten/);
 const unknown=structuredClone(plan);unknown.manualCues[0].condition='invented-official-result';assert.throws(()=>normalizePlan(unknown),/afspeelvoorwaarde/);
});

test('operator notes and manual cue notes never become generated speech or family data',()=>{
 const g=makeGame({brandId:'milo',date:'2026-12-02T13:30',timeZone:'Europe/Amsterdam'},'owner','https://bingo.test');g.plan.blocks[0].operatorNotes='GEHEIME OPERATORNOTITIE';g.plan.manualCues=[makeCue('always',{notes:'GEHEIME RESERVENOTITIE'})];
 assert(!JSON.stringify(showAudioScripts(g)).includes('GEHEIME'));const family=playerGame(g,'family');assert(!JSON.stringify(family).includes('GEHEIME'));assert(!('plan'in family));assert(!('manualCues'in family));
});

test('open-window and checking texts follow actual server deadline and matching epoch',()=>{
 const g=game(),now=1000;assert.equal(manualCueAvailability(makeCue('window-open'),g,now).allowed,false);g.state.window={status:'open',epoch:'current',endsAt:2000,claims:[]};assert.equal(manualCueAvailability(makeCue('window-open'),g,now).allowed,true);assert.equal(manualCueAvailability(makeCue('checking'),g,now).allowed,true);assert.equal(manualCueAvailability(makeCue('window-open'),g,2000).allowed,false);assert.equal(manualCueAvailability(makeCue('checking'),g,2000).allowed,false);g.state.window.epoch='previous';assert.equal(manualCueAvailability(makeCue('window-open'),g,now).allowed,false);
});

test('an invalid bingo announcement needs a closed window without any valid claim',()=>{
 const g=game(),cue=makeCue('no-valid-bingo');assert.equal(manualCueAvailability(cue,g).allowed,false);g.state.window={status:'closed',epoch:'current',claims:[{status:'false'},{status:'late'}]};assert.equal(manualCueAvailability(cue,g).allowed,true);g.state.window.claims.push({status:'valid'});assert.equal(manualCueAvailability(cue,g).allowed,false);g.state.window.claims=[];g.state.goalWon=true;assert.equal(manualCueAvailability(cue,g).allowed,false);
});

test('prize, tie and consolation announcements cannot promise an unconfirmed outcome',()=>{
 const g=game(),row=result(g,{tie:true,consolations:[{id:'consolation'}]});assert.equal(manualCueAvailability(makeCue('confirmed-tie'),g).allowed,true);assert.equal(manualCueAvailability(makeCue('confirmed-bingo'),g).allowed,false);assert.equal(manualCueAvailability(makeCue('confirmed-consolation'),g).allowed,false);row.acknowledged=true;g.state.resultId=null;assert.equal(manualCueAvailability(makeCue('confirmed-bingo'),g).allowed,true);assert.equal(manualCueAvailability(makeCue('confirmed-consolation'),g).allowed,true);assert.equal(manualCueAvailability(makeCue('confirmed-tie'),g).allowed,false);g.settings.consolationEnabled=false;assert.equal(manualCueAvailability(makeCue('confirmed-consolation'),g).allowed,false);g.settings.consolationEnabled=true;row.consolations=[];assert.equal(manualCueAvailability(makeCue('confirmed-consolation'),g).allowed,false);
});

test('round and finale announcements need the acknowledged last goal, never a saved name or another round',()=>{
 const g=game();g.state.goalIndex=2;result(g,{acknowledged:true});assert.equal(manualCueAvailability(makeCue('confirmed-bingo'),g).allowed,false);assert.equal(manualCueAvailability(makeCue('round-complete'),g).allowed,true);assert.equal(manualCueAvailability(makeCue('confirmed-finale'),g).allowed,false);g.state.roundIndex=1;g.state.goalIndex=0;g.state.goalWon=false;assert.equal(manualCueAvailability(makeCue('round-complete'),g).allowed,false);result(g,{acknowledged:true});assert.equal(manualCueAvailability(makeCue('confirmed-finale'),g).allowed,true);assert.equal(manualCueAvailability(makeCue('round-complete'),g).allowed,false);assert.equal(manualCueAvailability(makeCue('confirmed-finale',{roundIndex:0}),g).allowed,false);
});

test('six scoped pattern transitions need the acknowledged prior step and never reset the board',()=>{
 const g=game();g.state.drawn=[2,7,22];g.state.goalIndex=1;const cue=makeCue('round-transition',{roundIndex:0,goalIndex:1});assert.equal(manualCueAvailability(cue,g).allowed,false);g.results.push({id:'previous',type:'bingo',roundIndex:0,goalIndex:0,acknowledged:true});const before=structuredClone(g);assert.equal(manualCueAvailability(cue,g).allowed,true);assert.deepEqual(g,before);assert.equal(manualCueAvailability({...cue,goalIndex:2},g).allowed,false);g.state.window={status:'open'};assert.equal(manualCueAvailability(cue,g).allowed,false);
});

test('call text requires a server draw hold and cancellation silences every cue',()=>{
 const g=game();assert.equal(manualCueAvailability(makeCue('call-held'),g).allowed,false);g.state.drawHold={id:'tested-call'};assert.equal(manualCueAvailability(makeCue('call-held'),g).allowed,true);g.cancelledAt=123;assert.equal(manualCueAvailability(makeCue('always'),g).allowed,false);assert.equal(manualCueAvailability(makeCue('call-held'),g).allowed,false);
});

test('60-second countdown and 90-second pause hold the timeline with no official balls',()=>{
 const plan=defaultPlan();plan.blocks=[{id:'one-minute',type:'countdown',title:'We gaan zo beginnen',seconds:60,unit:'seconds'},{id:'ninety-seconds',type:'pause',title:'Even op adem komen',seconds:90,unit:'seconds'}];const h=run(plan);for(let i=0;i<239;i++)h.tick();assert.equal(h.runner.index,0);while(h.runner.index===0)h.tick();assert.equal(h.director.config.pauseMinutes,1.5);for(let i=0;i<359;i++)h.tick();assert.equal(h.runner.index,1);assert.equal(h.runner.active,true);while(h.runner.active)h.tick();assert.equal(h.director.drawn.length,0);assert(!h.events.some(event=>event.type==='commit'||event.type==='speech'));
});

test('custom magic words wait for both the full trick and actual voice before a complete five-turn guest visit',()=>{
 const plan=defaultPlan();plan.leadId='milo';plan.studioId='sterrenplein';const magic=createBlock('magic',plan,'milo');Object.assign(magic,{duration:14,text:'Drie, twee, één… Sterrenplein… straal!',operatorNotes:'Never speak this note.',hold:0});const guest=createBlock('guest',plan,'milo');Object.assign(guest,{guestId:'piko',text:'Professor Piko, welkom!',duration:18,hold:0,dialogue:Array.from({length:5},(_,index)=>({speakerId:index%2?'milo':'piko',text:`Dialoogbeurt ${index+1}.`,animation:'wave'}))});plan.blocks=[magic,guest];const h=run(plan);assert.equal(h.events.find(event=>event.type==='speech').text,magic.text);for(let i=0;i<60;i++)h.tick(.25,true);assert.equal(h.runner.index,0);h.tick(.25,false);while(h.runner.index===0)h.tick();while(h.runner.active)h.tick();assert.deepEqual(h.events.filter(event=>event.type==='speech').map(event=>event.text),[magic.text,guest.text,...guest.dialogue.map(turn=>turn.text)]);assert.equal(h.director.config.guestId,null);assert.equal(h.director.config.speakerId,'milo');assert.equal(h.director.drawn.length,0);
});

test('closing thanks finish speaking before the complete ten-second slotapplaus and show completion',()=>{
 const plan=defaultPlan();plan.leadId='milo';plan.studioId='sterrenplein';const closing=createBlock('finale',plan,'milo');closing.text='Bedankt voor mijn eerste show. Daaaag!';closing.hold=0;const applause=createBlock('show',plan,'milo');Object.assign(applause,{showCueId:'curtain-call',title:'Het grote slotapplaus',duration:10});plan.blocks=[closing,applause];const h=run(plan);for(let i=0;i<40;i++)h.tick(.25,true);assert.equal(h.runner.index,0);while(h.runner.index===0)h.tick();assert.equal(h.runner.block.showCueId,'curtain-call');assert.equal(h.runner.active,true);for(let i=0;i<39;i++)h.tick();assert.equal(h.runner.active,true);while(h.runner.active)h.tick();assert.equal(h.runner.phase,'complete');assert(h.events.some(event=>event.type==='show-cue'&&event.action==='start'&&event.id==='curtain-call'));assert(h.events.some(event=>event.type==='show-cue'&&event.action==='end'&&event.id==='curtain-call'));assert.equal(h.director.drawn.length,0);
});

test('pattern explanation steps preserve long text and require complete patterns without weakening the ordinary fallback',()=>{
 const plan=defaultPlan(),explanation=createBlock('explanation',plan,'milo');explanation.text='';explanation.explanationSteps=[{patternId:'patroon-hoeken',text:'a'.repeat(10000)},{patternId:'patroon-boven-onder',text:'Bovenste én onderste rij; één rij is nog niet genoeg.'},{patternId:'patroon-vol',text:'Alle nummervakken. Het midden is vrij.'}];plan.blocks=[explanation];
 const saved=normalizePlan(plan);assert.deepEqual(saved.blocks[0].explanationSteps,explanation.explanationSteps);assert.deepEqual(planIssues(saved),[]);
 const missing=structuredClone(saved);missing.blocks[0].explanationSteps[0].patternId='geen-patroon';assert.match(planIssues(normalizePlan(missing))[0],/compleet patroon/);
 const blank=structuredClone(saved);blank.blocks[0].explanationSteps[0].text=' ';assert.match(planIssues(normalizePlan(blank))[0],/tekst van elke uitlegstap/);
 const excessive=structuredClone(saved);excessive.blocks[0].explanationSteps=Array.from({length:11},()=>explanation.explanationSteps[1]);assert.throws(()=>normalizePlan(excessive),/Uitlegstappen/);
 const tooLong=structuredClone(saved);tooLong.blocks[0].explanationSteps[0].text+='a';assert.throws(()=>normalizePlan(tooLong),/10.000/);
 const fallback=structuredClone(saved);fallback.blocks[0].explanationSteps=[];assert.match(planIssues(normalizePlan(fallback))[0],/presentatietekst/);fallback.blocks[0].text='De oorspronkelijke uitleg blijft beschikbaar.';assert.deepEqual(planIssues(normalizePlan(fallback)),[]);
});

test('three explanation patterns speak once in order, wait for the voice and a visual pause, and never activate or draw a round',()=>{
 const plan=defaultPlan();plan.leadId='milo';plan.studioId='sterrenplein';const explanation=createBlock('explanation',plan,'milo');Object.assign(explanation,{title:'Drie opdrachten op dezelfde kaart',text:'Deze gecombineerde reserveuitleg mag niet dubbel klinken.',hold:0,explanationSteps:[{patternId:'patroon-hoeken',text:'Eerst de vier hoekjes.'},{patternId:'patroon-boven-onder',text:'De bovenste én de onderste rij. Eén rij is nog niet genoeg.'},{patternId:'patroon-vol',text:'Daarna de volle kaart. Het midden is vrij.'}]});plan.blocks=[explanation];
 const spoken=[],views=[],events=[],director=new ShowDirector({config:{voice:true,sound:false},onEvent:event=>{events.push(event);if(event.type==='speech'){spoken.push(event.text);views.push(structuredClone(director.visual()));}}}),runner=new ShowRunner(director);director.drawn=[7,15,27];director.number=27;director.drawBlocked=true;
 director.requestPick=()=>assert.fail('Explanation must never reserve a ball');director.requestCommit=()=>assert.fail('Explanation must never confirm a ball');runner.beforeGoal=()=>assert.fail('Explanation must never activate a goal');runner.afterRound=()=>assert.fail('Explanation must never reset a round');runner.start(plan);
 const tick=(seconds=.25,voiceBusy=false)=>{director.tick(seconds,{voiceBusy});runner.tick(seconds);};
 assert.equal(spoken.length,1);assert.equal(runner.drawNow(),false);assert.equal(director.draw(),false);
 for(let index=0;index<3;index++){
  for(let i=0;i<20;i++)tick(.25,true);assert.equal(spoken.length,index+1);assert.equal(director.scene,'round');assert.equal(director.config.pattern,plan.patterns.find(pattern=>pattern.id===explanation.explanationSteps[index].patternId).title);
  tick(.25,false);assert.equal(spoken.length,index+1);tick(.5,false);assert.equal(spoken.length,index+1);assert.deepEqual(director.drawn,[7,15,27]);assert.equal(director.number,27);assert.equal(director.pending,null);
  if(index<2){tick(.5,false);assert.equal(spoken.length,index+2);}
 }
 for(let i=0;i<20&&runner.active;i++)tick();assert.equal(runner.phase,'complete');assert.deepEqual(spoken,explanation.explanationSteps.map(step=>step.text));
 for(const [index,view] of views.entries()){const pattern=plan.patterns.find(pattern=>pattern.id===explanation.explanationSteps[index].patternId);assert.equal(view.scene,'round');assert.equal(view.pattern,pattern.title);assert.deepEqual(view.patternCells,pattern.cells);assert.equal(view.patternFreeCenter,true);assert.equal(view.patternVariant,'fixed');assert.equal(view.goalIndex,index);assert.equal(view.roundPatterns.length,3);}
 assert(!events.some(event=>event.type==='commit'||event.type==='sound'));assert.deepEqual(director.drawn,[7,15,27]);
});

test('explanation pattern graphics identify rehearsal instructions while official round labels remain unchanged',()=>{
 const rendered=[],context={save(){},restore(){},beginPath(){},roundRect(){},fill(){},stroke(){},fillRect(){},createLinearGradient(){return {addColorStop(){}};},measureText(){return {width:0};},fillText(value){rendered.push(value);}},show={scene:'round',round:'Drie opdrachten op dezelfde kaart',pattern:'Bovenste én onderste rij',patternCells:[0,1,2,3,4,20,21,22,23,24],patternFreeCenter:true,patternVariant:'fixed',goalIndex:1,roundPatterns:[{},{},{}],prize:''};
 drawShowGraphics(context,{show:{...show,planKind:'explanation'}});assert(rendered.includes('STAP 2 VAN 3 · UITLEG VAN HET PATROON'));assert(!rendered.some(text=>text.includes('WE SPELEN VOOR')));rendered.length=0;
 drawShowGraphics(context,{show:{...show,planKind:'round'}});assert(rendered.includes('STAP 2 VAN 3 · WE SPELEN VOOR'));assert(rendered.includes('Bovenste én onderste rij'));
});
