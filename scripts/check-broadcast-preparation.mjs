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
 await h.bridge.reconnect();assert.equal(h.bridge.targetGameId,GAME);assert.equal(h.bridge.audioReady,true);assert.equal(h.panel.hidden,true);assert.deepEqual(actions,['GET']);assert.deepEqual(h.requests.map(request=>request.action),['output-heartbeat']);const snapshot=h.received.find(event=>event.kind==='snapshot'&&!event.payload.outputWaiting).payload;assert.deepEqual(snapshot.drawn,[7,19,41]);assert.equal(snapshot.paused,true);assert.equal(snapshot.bingoPending,true);assert.equal(snapshot.lastNumber,41);assert(!actions.some(action=>/start|resume|draw|claim|publish/.test(action)));
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
