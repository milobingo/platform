// Local audio graph/timing, SQLite relay and reconnect fixtures. These checks
// cannot certify an OBS mixer or a physical speaker; OBS needs a real rehearsal.
import test from 'node:test';
import assert from 'node:assert/strict';
import {OutputBridge} from '../public/output-bridge.js';
import {handleOutput} from '../server/output.js';
import {obsOutputState} from '../server/node-obs-access.js';
import {fixture} from './live-calls-fixture.mjs';
import {verifiedTestEnvironment} from './verified-test-identity.mjs';
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const GAME='qa-broadcast-show';
function audioFixture({signal=true,advances=true,ends=true}={}){
 const connections=[],nodes=[],gain={gain:{value:1}},start=Date.now();let playing=false;
 const context={state:'running',sampleRate:8000,get currentTime(){return advances?(Date.now()-start)/1000:0;},resume:async()=>{},createBuffer:(channels,length,rate)=>({duration:length/rate,getChannelData:()=>new Float32Array(length)}),createBufferSource(){const node={connect:destination=>connections.push(destination),disconnect(){},start(){playing=true;if(ends)this.timer=setTimeout(()=>{playing=false;this.onended?.();},660);},stop(){clearTimeout(this.timer);playing=false;}};nodes.push(node);return node;}};
 const analyser={fftSize:256,getByteTimeDomainData(bytes){for(let i=0;i<bytes.length;i++)bytes[i]=playing&&signal&&gain.gain.value>0?128+(i%2?18:-18):128;}};
 const panelState={hidden:false},elements={small:{textContent:''},'[data-output-reconnect]':{hidden:true}};panelState.querySelector=selector=>elements[selector]||{textContent:''};
 const requests=[],received=[];
 const bridge=Object.assign(Object.create(OutputBridge.prototype),{context,gain,analyser,audioGraphReady:true,accessEpoch:0,seen:new Set(),events:[],offset:0,mixer:{voice:100,music:25,effects:50},showAudio:{unlock:async()=>true,setMuted(){},setLevels(){},stop(){}},panel:panelState,heartbeat:async function(){requests.push({action:'output-heartbeat',audioReady:this.audioReady,audioPlayedAt:this.audioPlayedAt,testAck:this.testAck});},receive:message=>received.push(message),latest:{routing:true}});
 return {bridge,context,gain,connections,nodes,requests,received,panel:panelState};
}
const state=(gameId=GAME)=>({producer:{id:'qa-producer',instanceId:'qa-instance',generation:4,gameId,until:Date.now()+15000},seq:9,publishedAt:Date.now(),snapshot:{gameId,paused:true,lastNumber:41,drawn:[7,19,41],bingoPending:true},show:{scene:'bingo',paused:true,drawBlocked:true},routing:true,mixer:{voice:100,music:25,effects:50},events:[],voice:null});

test('audio activation waits for a completed non-silent programme source before claiming ready or hiding the overlay',async()=>{
 const h=audioFixture();const activating=h.bridge.activate();await wait(80);assert.equal(h.bridge.audioReady,undefined);assert.equal(h.panel.hidden,false);assert.deepEqual(h.requests,[]);
 await activating;assert.equal(h.panel.hidden,true);assert.equal(h.bridge.audioReady,true);assert.equal(h.bridge.testAck.status,'played');assert.equal(h.connections[0],h.gain,'Test sound shares the scripted-presenter programme gain');assert(h.bridge.audioPlayedAt>0);assert.equal(h.requests.length,1);assert.match(h.panel.querySelector('small').textContent,/Geluid afgespeeld.*OBS-mixer/);
});

test('a running audio context without a measured signal keeps the activation overlay and never acknowledges ready',async()=>{
 const h=audioFixture({signal:false});await assert.rejects(h.bridge.activate(),/Geen hoorbaar testsignaal/);assert.equal(h.panel.hidden,false);assert.equal(h.bridge.audioReady,false);assert.equal(h.bridge.active,false);assert.deepEqual(h.requests,[]);assert.equal(h.bridge.testAck.status,'error');
});

test('an ended callback without audio-clock progress is not proof of playback',async()=>{
 const h=audioFixture({advances:false});await assert.rejects(h.bridge.activate(),/Geen hoorbaar testsignaal/);assert.equal(h.panel.hidden,false);assert.deepEqual(h.requests,[]);
});

test('disconnect during the test silences its source and cannot acknowledge a late successful activation',async()=>{
 const h=audioFixture();const attempt=h.bridge.activate();await wait(50);h.bridge.loseOutput('Verbinding verloren. Kies Opnieuw verbinden.');await assert.rejects(attempt,/onderbroken|gewijzigd/);assert.equal(h.bridge.audioReady,false);assert.equal(h.bridge.active,false);assert.equal(h.panel.hidden,false);assert.equal(h.panel.querySelector('[data-output-reconnect]').hidden,false);assert.deepEqual(h.requests,[]);
});

test('reconnect restores the exact paused show, pending bingo and official history using only read and output heartbeat',async()=>{
 const h=audioFixture(),actions=[];h.bridge.isOutput=true;h.bridge.targetGameId=GAME;h.bridge.api=async body=>{actions.push(body?.action||'GET');return state();};
 await h.bridge.reconnect();assert.equal(h.bridge.targetGameId,GAME);assert.equal(h.bridge.audioReady,true);assert.equal(h.panel.hidden,true);assert.deepEqual(actions,['GET','GET']);assert.deepEqual(h.requests.map(request=>request.action),['output-heartbeat']);const snapshot=h.received.find(event=>event.kind==='snapshot'&&!event.payload.outputWaiting).payload;assert.deepEqual(snapshot.drawn,[7,19,41]);assert.equal(snapshot.paused,true);assert.equal(snapshot.bingoPending,true);assert.equal(snapshot.lastNumber,41);assert(!actions.some(action=>/start|resume|draw|claim|publish/.test(action)));
});

test('reconnect refuses a different show and a stale producer without opening audio or releasing the game',async()=>{
 for(const value of [state('other-show'),{...state(),publishedAt:Date.now()-9000},{...state(),producer:{...state().producer,until:Date.now()-1}}]){
  const h=audioFixture();h.bridge.targetGameId=GAME;h.bridge.api=async()=>value;await assert.rejects(h.bridge.reconnect(),/regie van deze show/);assert.equal(h.bridge.audioReady,false);assert.equal(h.panel.hidden,false);assert.equal(h.nodes.length,0);assert.deepEqual(h.requests,[]);
 }
});

test('test request plays once through output, acknowledges only its own event and never resumes a paused show',async()=>{
 const h=audioFixture();Object.assign(h.bridge,{isOutput:true,active:true,audioReady:true});const event={id:crypto.randomUUID(),kind:'test-sound',at:Date.now()},packet={...state(),events:[event]};h.bridge.consume(packet);h.bridge.consume({...packet,seq:10});await wait(720);assert.equal(h.nodes.length,1);assert.equal(h.bridge.testAck.id,event.id);assert.equal(h.bridge.testAck.status,'played');assert.equal(h.requests.length,1);assert(h.received.filter(event=>event.kind==='snapshot').every(event=>event.payload.paused));
});

test('regie test awaits the matching playback acknowledgement, not a routed or connected status alone',async()=>{
 const h=audioFixture();Object.assign(h.bridge,{isOutput:false,route:async enabled=>{h.bridge.routing=enabled;},publish:async()=>{}});let settled=false;const testing=h.bridge.testSound().then(()=>{settled=true;});await wait(20);assert.equal(settled,false);assert.equal(h.bridge.events.length,1);assert.equal(h.bridge.events[0].kind,'test-sound');h.bridge.acceptTestAck({id:'another-test',status:'played'});await wait(10);assert.equal(settled,false);h.bridge.acceptTestAck({id:h.bridge.events[0].id,status:'played',at:Date.now()});await testing;assert.equal(settled,true);assert.equal(h.bridge.routing,true);
});

test('audio and reconnect never connect a microphone or backstage stream, and active calls prevent a test sound',async()=>{
 const h=audioFixture();h.bridge.liveCallActive=true;await assert.rejects(h.bridge.playProgramTest(),/livegesprek/);assert.equal(h.nodes.length,0);assert.equal(h.connections.length,0);
});

test('a live call arriving during a programme test stops the test and keeps its acknowledgement unsuccessful',async()=>{
 const h=audioFixture();const testing=h.bridge.playProgramTest();await wait(30);h.bridge.setLiveCallActive(true);await assert.rejects(testing,/onderbroken/);assert.equal(h.bridge.liveCallActive,true);assert.equal(h.bridge.testAck.status,'error');assert.equal(h.bridge.testPlayback,null);
});

test('relay stores a bounded public playback acknowledgement while preserving producer, game and paused state',async t=>{
 const h=await fixture(t),instanceId=crypto.randomUUID(),id=h.ids.host;await h.bingo.mutate(h.game.id,{},game=>{game.state.control={id,until:Date.now()+60000};game.state.paused=true;});
 const send=async body=>{const request=h.req('host',{clientId:id,...body},{path:'/api/output',headers:{'X-Vlampie-Output':'1'}}),response=await handleOutput(request,verifiedTestEnvironment(request,h.env));assert.equal(response.status,200);return (await response.json()).state;};
 const claimed=await send({action:'producer-claim',instanceId,gameId:h.game.id,expectedGeneration:0}),generation=claimed.producer.generation;
 const published=await send({action:'publish',instanceId,gameId:h.game.id,generation,seq:1,snapshot:{gameId:h.game.id,paused:true,lastNumber:41,drawn:[7,19,41]},events:[{id:crypto.randomUUID(),kind:'test-sound',at:Date.now()}],routing:true,mixer:{voice:100,music:25,effects:50}});
 const testId=crypto.randomUUID(),audioPlayedAt=Date.now(),output=await send({action:'output-heartbeat',clientId:h.ids.output,audioReady:true,audioPlayedAt,generation,seq:1,testAck:{id:testId,status:'played',secret:'must-not-leak'},meters:{voice:.4}});
 assert.equal(output.producer.id,published.producer.id);assert.deepEqual(output.snapshot,published.snapshot);assert.equal(output.output.audioPlayedAt,audioPlayedAt);assert.equal(output.output.testAck.id,testId);assert.equal(output.output.testAck.status,'played');assert.equal(output.output.testAck.secret,undefined);assert.equal((await h.bingo.game(h.game.id)).data.state.paused,true);const scoped=obsOutputState(output,{gameId:h.game.id});assert.equal(scoped.output.audioPlayedAt,audioPlayedAt);assert.equal(scoped.output.testAck.status,'played');assert.equal(scoped.snapshot.paused,true);
 const noProof=await send({action:'output-heartbeat',clientId:h.ids.output,audioReady:false,audioPlayedAt,generation,seq:1,testAck:{id:'invalid',status:'played'}});assert.equal(noProof.output.audioPlayedAt,null);assert.equal(noProof.output.testAck,null);
});

const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function routeFixture(){
 const id=crypto.randomUUID(),clientId=crypto.randomUUID(),game={id:crypto.randomUUID(),brandId:'milo',state:{paused:true,drawn:[7,19,41],drawHold:{callId:'kept-call'}}},requests=[],muted=[];let respond;
 let server={producer:{id:clientId,instanceId:id,generation:4,gameId:game.id,until:Date.now()+15000},seq:9,publishedAt:Date.now(),snapshot:{gameId:game.id,paused:true,drawn:game.state.drawn},routing:false,events:[],voice:null,mixer:{voice:100,music:25,effects:50},output:{id:crypto.randomUUID(),generation:4,seq:9,until:Date.now()+7000,audioReady:true,audioPlayedAt:Date.now()}};
 const bridge=Object.assign(Object.create(OutputBridge.prototype),{id,isOutput:false,enabled:true,offset:0,accessEpoch:0,generation:4,seq:9,claimedGame:game.id,routing:false,latest:structuredClone(server),events:[],command:null,mixer:server.mixer,getId:()=>clientId,getGame:()=>game,getSnapshot:()=>({gameId:game.id,paused:game.state.paused,drawn:game.state.drawn}),getShow:()=>null,showAudio:{setMuted:value=>muted.push(value)}});
 bridge.api=async body=>{requests.push(structuredClone(body));if(respond)await respond(body);if(body?.action==='publish')server={...server,producer:{...server.producer,until:Date.now()+15000},seq:body.seq,publishedAt:Date.now(),snapshot:body.snapshot,routing:body.routing};bridge.latest=structuredClone(server);return bridge.latest;};
 return {bridge,game,requests,muted,respond:fn=>{respond=fn;},server:()=>server,setServer:fn=>{server=fn(server);bridge.latest=structuredClone(server);}};
}

test('routing waits for an older in-flight packet, then for its own server-confirmed route without queuing duplicate publishes',async()=>{
 const h=routeFixture(),old=deferred(),routed=deferred();h.respond(body=>body.routing? routed.promise:old.promise);
 const gameBefore=structuredClone(h.game),publishing=h.bridge.publish();assert.equal(h.bridge.publish(),publishing,'other callers share the actual in-flight promise');
 let settled=false;const routing=h.bridge.route(true).then(()=>{settled=true;});await turn();assert.equal(h.requests.length,1);assert.equal(h.requests[0].routing,false);assert.equal(h.bridge.routing,false);assert.equal(settled,false);
 old.resolve();await publishing;await turn();assert.equal(h.requests.length,2);assert.equal(h.requests[1].routing,true);assert.equal(settled,false,'the previous false packet is not a true-route acknowledgement');assert.deepEqual(h.muted,[true]);
 routed.resolve();await routing;assert.equal(settled,true);assert.equal(h.bridge.latest.routing,true);assert.equal(h.bridge.latest.producer.id,h.bridge.clientId);assert.deepEqual(h.muted,[true,true]);assert.deepEqual(h.game,gameBefore);
});

test('turning output routing off keeps local audio silent until the server acknowledges the new route',async()=>{
 const h=routeFixture(),routed=deferred();h.bridge.routing=true;h.setServer(server=>({...server,routing:true}));let count=0;h.respond(()=>++count===2?routed.promise:undefined);
 let settled=false;const routing=h.bridge.route(false).then(()=>{settled=true;});await turn();assert.equal(count,2);assert.equal(settled,false);assert.deepEqual(h.muted,[true]);assert.equal(h.server().routing,true);
 routed.resolve();await routing;assert.equal(h.server().routing,false);assert.deepEqual(h.muted,[true,false]);
});

test('a publisher racing the route continuation cannot turn its older packet into a false route acknowledgement',async()=>{
 const h=routeFixture(),old=deferred(),raced=deferred(),confirmed=deferred();let count=0;h.respond(()=>[old,raced,confirmed][count++]?.promise);
 const publishing=h.bridge.publish(),competing=publishing.then(()=>h.bridge.publish());let settled=false;const routing=h.bridge.route(true).then(()=>{settled=true;});
 old.resolve();await publishing;await turn();assert.equal(count,2);assert.equal(h.requests[1].routing,false);assert.equal(h.bridge.routing,true);assert.equal(settled,false);
 raced.resolve();await competing;await turn();assert.equal(count,3);assert.equal(h.requests[2].routing,true);assert.equal(settled,false);confirmed.resolve();await routing;assert.equal(h.server().routing,true);assert.equal(h.requests.length,3);
});

for(const invalid of ['missing-output','expired-output','wrong-generation','wrong-producer','wrong-instance','wrong-show','wrong-route'])test(`routing fails closed for ${invalid}, without claiming another output or changing the game`,async()=>{
 const h=routeFixture(),before=structuredClone(h.game);
 if(invalid==='missing-output')h.setServer(server=>({...server,output:null}));
 if(invalid==='expired-output')h.setServer(server=>({...server,output:{...server.output,until:Date.now()-1}}));
 if(invalid==='wrong-generation')h.setServer(server=>({...server,output:{...server.output,generation:3}}));
 if(invalid==='wrong-producer')h.setServer(server=>({...server,producer:{...server.producer,id:crypto.randomUUID()}}));
 if(invalid==='wrong-instance')h.setServer(server=>({...server,producer:{...server.producer,instanceId:crypto.randomUUID()}}));
 if(invalid==='wrong-show')h.setServer(server=>({...server,producer:{...server.producer,gameId:crypto.randomUUID()}}));
 if(invalid==='wrong-route'){const api=h.bridge.api;h.bridge.api=async body=>{const result=await api(body);if(body?.routing===true)h.bridge.latest.routing=false;return result;};}
 await assert.rejects(h.bridge.route(true),/uitzendvenster|geluidsroute/);assert.equal(h.bridge.routing,false);assert(h.muted.every(Boolean));assert(h.requests.every(body=>body.action==='publish'));assert.deepEqual(h.game,before);
});

for(const change of ['show','dispose','cancel','epoch'])test(`a route waiting on publication stops after ${change} and cannot later change or publish the route`,async()=>{
 const h=routeFixture(),held=deferred();h.respond(()=>held.promise);const publishing=h.bridge.publish(),routing=h.bridge.route(true);const rejected=assert.rejects(routing,/uitzending/);await turn();
 if(change==='show')h.game.id=crypto.randomUUID();if(change==='dispose')h.bridge.disposed=true;if(change==='cancel')h.bridge.cancelledGames=new Set([h.game.id]);if(change==='epoch')h.bridge.accessEpoch++;
 await rejected;const requests=h.requests.length,muted=h.muted.length;held.resolve();await assert.rejects(publishing,/uitzending/);await turn();assert.equal(h.bridge.routing,false);assert.equal(h.requests.length,requests);assert.equal(h.muted.length,muted);assert(h.requests.every(body=>body.routing===false));
});

test('a stalled route has a bounded deadline instead of waiting forever or starting an unconfirmed route',async t=>{
 const h=routeFixture(),held=deferred(),started=Date.now();let now=started;t.mock.method(Date,'now',()=>now);h.respond(()=>held.promise);
 const publishing=h.bridge.publish(),routing=h.bridge.route(true),rejected=assert.rejects(routing,/nog niet door de server bevestigd/);await turn();now=started+15001;await rejected;assert.equal(h.bridge.routing,false);assert(h.muted.every(Boolean));assert.equal(h.requests.length,1);held.resolve();await publishing;assert.equal(h.bridge.routing,false);assert.equal(h.requests.length,1);
});

test('cancellation remembered for an earlier show cannot block a different show from confirming its own audio route',async()=>{
 const h=routeFixture(),oldGame=crypto.randomUUID();h.bridge.cancelledGames=new Set([oldGame]);h.bridge.latest={...h.bridge.latest,cancelledGameId:oldGame,cancelledAt:Date.now(),snapshot:{gameId:oldGame}};
 await h.bridge.route(true);assert.equal(h.bridge.latest.snapshot.gameId,h.game.id);assert.equal(h.bridge.latest.routing,true);assert.equal(h.bridge.routing,true);assert.equal(h.bridge.isGameCancelled(oldGame),true);assert.equal(h.bridge.isGameCancelled(h.game.id),false);
});

test('stopping the show while routing awaits a packet prevents a late route mutation or another publication',async()=>{
 const h=routeFixture(),held=deferred();let isCurrent=true;h.respond(()=>held.promise);const publishing=h.bridge.publish(),routing=h.bridge.route(true,{isCurrent:()=>isCurrent}),rejected=assert.rejects(routing,/uitzending/);
 await turn();isCurrent=false;await rejected;assert.equal(h.bridge.routing,false);assert.equal(h.requests.length,1);assert.deepEqual(h.muted,[]);held.resolve();await publishing;await turn();assert.equal(h.requests.length,1);assert.equal(h.bridge.routing,false);assert.deepEqual(h.muted,[]);
});

test('a stop during the initial producer read prevents the follow-up producer claim and route publication',async()=>{
 const h=routeFixture(),held=deferred();let isCurrent=true;h.bridge.generation=null;h.respond(()=>held.promise);const routing=h.bridge.route(true,{isCurrent:()=>isCurrent}),rejected=assert.rejects(routing,/uitzending/);
 await turn();assert.deepEqual(h.requests,[undefined]);isCurrent=false;await rejected;held.resolve();await turn();assert.deepEqual(h.requests,[undefined]);assert.equal(h.bridge.routing,false);assert.deepEqual(h.muted,[]);
});

test('a busy presenter prevents route changes before publishing or muting anything',async()=>{
 const h=routeFixture();h.bridge.isVoiceBusy=()=>true;await assert.rejects(h.bridge.route(true),/uitspraak/);assert.deepEqual(h.requests,[]);assert.deepEqual(h.muted,[]);assert.equal(h.bridge.routing,false);
});

test('a second regular output checks the active lease before any test sound or heartbeat and never steals it',async()=>{
 const h=audioFixture(),owner=crypto.randomUUID(),reads=[];Object.assign(h.bridge,{isOutput:true,id:crypto.randomUUID(),targetGameId:GAME,api:async body=>{reads.push(body||null);return {...state(),output:{id:owner,until:Date.now()+7000,audioReady:true,generation:4,seq:9}};}});
 await assert.rejects(h.bridge.activate(),/ander uitzendvenster.*sluit dit extra venster/);assert.equal(h.bridge.active,false);assert.equal(h.bridge.audioReady,false);assert.equal(h.nodes.length,0);assert.deepEqual(h.requests,[]);assert.deepEqual(reads,[null]);assert.equal(h.panel.hidden,false);
});

// Render the actual preparation card without network, accounts or OBS.
import vm from 'node:vm';
import {build} from 'esbuild';
import {parseHTML} from 'linkedom';
import {fileURLToPath} from 'node:url';
const uiBundle=(await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import BroadcastPreparation from './frontend/BroadcastPreparation.jsx';let root;window.renderPreparation=props=>{root??=createRoot(document.getElementById('root'));flushSync(()=>root.render(React.createElement(BroadcastPreparation,props)));};window.closePreparation=()=>root&&flushSync(()=>root.unmount());`,resolveDir:fileURLToPath(new URL('..',import.meta.url)),loader:'jsx'},bundle:true,write:false,format:'iife',platform:'browser',target:'es2022',loader:{'.css':'empty'},logLevel:'warning'})).outputFiles[0].text;
function preparationUI(t,{prepare=async()=>{},open=async()=>{},sound=async()=>{}}={}){
 const {window}=parseHTML('<!doctype html><html><body><div id="root"></div></body></html>'),{document}=window,actions=[],errors=[];window.HTMLElement.prototype.getBoundingClientRect=()=>({x:0,y:0,left:0,top:0,right:900,bottom:700,width:900,height:700});
 const context={window,document,location:{origin:'https://preparation.invalid'},navigator:{userAgent:'Local preparation check'},console:{...console,error:(...args)=>errors.push(args.map(String).join(' '))},setTimeout,clearTimeout,performance,queueMicrotask,crypto,URL,AbortController,AbortSignal,Response,HTMLElement:window.HTMLElement,SVGElement:window.SVGElement,Element:window.Element,Node:window.Node,Event:window.Event,requestAnimationFrame:()=>1,cancelAnimationFrame(){},getComputedStyle:()=>new Proxy({getPropertyValue:()=>''},{get:(object,key)=>object[key]||''}),matchMedia:()=>({matches:false,addEventListener(){},removeEventListener(){}}),fetch:()=>{throw Error('No network in preparation UI checks');}};context.self=context;context.globalThis=context;
 vm.runInNewContext(uiBundle,context,{filename:'broadcast-preparation-ui.js'});
 const render=async(gameId=GAME,status={})=>{window.renderPreparation({s:{game:{id:gameId},demo:false,outputPreparation:{gameId,...status}},onPrepare:async id=>{actions.push(['prepare',id]);return prepare(id);},onOpenOutput:async id=>{actions.push(['open',id]);return open(id);},onTestSound:async id=>{actions.push(['sound',id]);return sound(id);}});await wait(35);};
 const button=label=>[...document.querySelectorAll('button')].find(node=>node.textContent.trim()===label),click=label=>{const node=button(label);assert(node,'Missing preparation action '+label);assert(!node.disabled);node.dispatchEvent(new window.Event('click',{bubbles:true,cancelable:true}));};
 t.after(()=>{window.closePreparation();assert.deepEqual(errors,[]);});return {document,actions,render,button,click};
}

test('preparation separates connection, audio activation and unconfirmed OBS checks; opening stays on the user gesture',async t=>{
 let opened=false;const h=preparationUI(t,{open:async()=>{opened=true;}});await h.render();const text=h.document.body.textContent;assert.match(text,/1\. Verbinding met regie/);assert.match(text,/2\. Audio in het uitzendvenster/);assert.match(text,/3\. Controle in OBS/);assert.match(text,/OBS → Bronnen → rechtsklik → Interactie → Beeld & geluid activeren/);assert.match(text,/Vensteropname/);assert.equal([...h.document.querySelectorAll('input[type="checkbox"]')].every(input=>input.disabled),true);assert(!text.includes('OBS door jou gecontroleerd'));assert(h.button('Kopieer OBS-link'));
 h.click('Open uitzendvenster');assert.equal(opened,true,'Popup callback must run synchronously inside the click gesture');await wait(20);assert.deepEqual(h.actions,[['open',GAME]]);
});

test('preparation reports a real playback failure without claiming sound or OBS acceptance',async t=>{
 const h=preparationUI(t,{sound:async()=>{throw Error('Het testgeluid is niet bevestigd. Probeer opnieuw.');}});await h.render(GAME,{connected:true,audioActivated:false});h.click('Speel testgeluid');await wait(40);assert.deepEqual(h.actions,[['prepare',GAME],['sound',GAME]]);assert.match(h.document.querySelector('[role="alert"]').textContent,/niet bevestigd/);assert(!h.document.body.textContent.includes('Geluid afgespeeld.'));assert(!h.document.body.textContent.includes('OBS door jou gecontroleerd'));assert(h.button('Speel testgeluid'));
});

test('audio proof for a previous show never becomes a successful preparation status after switching shows',async t=>{
 let resolve;const pending=new Promise(yes=>{resolve=yes;});const h=preparationUI(t,{sound:()=>pending});await h.render(GAME,{connected:true,audioActivated:true});h.click('Speel testgeluid');await wait(15);await h.render('other-show',{connected:false,audioActivated:false});resolve();await wait(40);assert(!h.document.body.textContent.includes('Geluid afgespeeld.'));assert.equal([...h.document.querySelectorAll('input[type="checkbox"]')].every(input=>input.disabled),true);
});
