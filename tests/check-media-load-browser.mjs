import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {build} from 'esbuild';
import {chromium} from '@playwright/test';
import {HARNESS_BROWSER_SIGNAL_OPTIONS} from '../scripts/load/browser-runtime.mjs';

// No LiveKit server or participant is contacted. Only the SDK's signaling
// boundary is stubbed; the exact receiver uses real local Chromium Opus RTP.
const executablePath=process.argv[2]||chromium.executablePath();
const output=process.argv[3]?resolve(process.argv[3]):null;
const sourcePath=resolve('scripts/load/browser-probe.mjs');
const source=await readFile(sourcePath);
const bundle=await build({entryPoints:[sourcePath],bundle:true,write:false,format:'esm',target:'es2022',plugins:[{
  name:'networkless-signaling-boundary',setup(plugin){
    plugin.onResolve({filter:/^livekit-client$/},()=>({path:'livekit-client',namespace:'local-rtp-only'}));
    plugin.onLoad({filter:/.*/,namespace:'local-rtp-only'},()=>({loader:'js',contents:`
export const Track={Kind:{Audio:'audio',Video:'video'},Source:{ScreenShare:'screen_share',ScreenShareAudio:'screen_share_audio'}};
export const RoomEvent={Reconnecting:'reconnecting',Reconnected:'reconnected',Disconnected:'disconnected',TrackSubscribed:'trackSubscribed'};
export function setLogLevel(){}
export class Room {
 constructor(){this.listeners=new Map();window.__miloRegressionRoom=this;}
 on(name,listener){this.listeners.set(name,listener);return this;}
 async connect(){}
 async disconnect(){}
}
export class LocalVideoTrack{}
export class LocalAudioTrack{}
`}));
  },
}]});
const payload=bundle.outputFiles[0].contents;
const server=createServer((request,response)=>{
  response.setHeader('Cache-Control','no-store');
  if(request.url==='/probe.js'){response.setHeader('Content-Type','text/javascript');response.end(payload);}
  else if(request.url==='/'){response.setHeader('Content-Type','text/html');response.end('<!doctype html><meta charset="utf-8"><title>Lokale Milo-Opusregressie</title><script type="module" src="/probe.js"></script>');}
  else{response.writeHead(404);response.end();}
});
await new Promise(accept=>server.listen(0,'127.0.0.1',accept));
const origin=`http://127.0.0.1:${server.address().port}`;
const report={format:'milo-real-local-opus-receiver-regression-v1',observedAt:new Date().toISOString(),source:'scripts/load/browser-probe.mjs',sourceSha256:createHash('sha256').update(source).digest('hex'),method:'Exact receiver module; only SDK signaling stubbed; real Chromium local WebRTC peer pair, Opus encoding/decoding and measured received PCM.',scope:'Local test harness only; no public LiveKit, Ingress, HLS, OBS, physical audio output or capacity claim.',externalNetworkRequests:[],loadStageExecuted:false,realRoomCreated:false,samples:[]};
let browser;
try{
  browser=await chromium.launch({executablePath,headless:true,...HARNESS_BROWSER_SIGNAL_OPTIONS,args:['--autoplay-policy=no-user-gesture-required','--disable-background-timer-throttling']});
  const context=await browser.newContext({serviceWorkers:'block'});
  await context.route('**/*',route=>{
    if(new URL(route.request().url()).origin===origin)return route.continue();
    report.externalNetworkRequests.push({protocol:new URL(route.request().url()).protocol,blocked:true});return route.abort();
  });
  const page=await context.newPage();await page.goto(origin);await page.waitForFunction(()=>window.miloMediaProbe);
  report.setup=await page.evaluate(async()=>{
    const sourceContext=new AudioContext();await sourceContext.resume();
    const oscillator=sourceContext.createOscillator(),gain=sourceContext.createGain(),destination=sourceContext.createMediaStreamDestination(),mute=sourceContext.createGain();
    oscillator.frequency.value=440;gain.gain.value=.08;mute.gain.value=0;
    oscillator.connect(gain);gain.connect(destination);gain.connect(mute);mute.connect(sourceContext.destination);oscillator.start();
    const sender=new RTCPeerConnection(),receiver=new RTCPeerConnection();
    const transceiver=sender.addTransceiver(destination.stream.getAudioTracks()[0],{direction:'sendonly',sendEncodings:[{maxBitrate:64000}]});
    transceiver.setCodecPreferences(RTCRtpSender.getCapabilities('audio').codecs.filter(codec=>codec.mimeType.toLowerCase()==='audio/opus'));
    const incoming=new Promise(accept=>receiver.ontrack=event=>accept(event.track));
    const gather=async pc=>{for(let i=0;i<100&&pc.iceGatheringState!=='complete';i++)await new Promise(accept=>setTimeout(accept,50));if(pc.iceGatheringState!=='complete')throw new Error('Local ICE gathering timed out.');};
    await sender.setLocalDescription(await sender.createOffer());await gather(sender);
    await receiver.setRemoteDescription(sender.localDescription);
    await receiver.setLocalDescription(await receiver.createAnswer());await gather(receiver);
    await sender.setRemoteDescription(receiver.localDescription);
    const remoteTrack=await incoming;
    // Reproduce the original analyser-only arrangement before the tested
    // module attaches its media sink; report the real negative observation.
    const controlContext=new AudioContext();await controlContext.resume();
    const controlSource=controlContext.createMediaStreamSource(new MediaStream([remoteTrack])),controlAnalyser=controlContext.createAnalyser(),controlMute=controlContext.createGain();
    controlAnalyser.fftSize=2048;controlMute.gain.value=0;controlSource.connect(controlAnalyser);controlAnalyser.connect(controlMute);controlMute.connect(controlContext.destination);
    const controlSamples=[];
    for(let i=0;i<5;i++){
      await new Promise(accept=>setTimeout(accept,100));const values=new Float32Array(controlAnalyser.fftSize);controlAnalyser.getFloatTimeDomainData(values);controlSamples.push(Math.sqrt(values.reduce((sum,value)=>sum+value*value,0)/values.length));
    }
    window.__miloRealPeers={sender,receiver,oscillator,sourceContext,controlContext};
    await window.miloMediaProbe.connect({url:'wss://unused.invalid',token:'local-fixture-never-sent',publisherIdentity:'milo-load-regression-source'});
    const track={kind:'audio',mediaStreamTrack:remoteTrack,getRTCStatsReport:()=>receiver.getStats(),attach(){const element=document.createElement('audio');element.srcObject=new MediaStream([remoteTrack]);return element;}};
    await window.__miloRegressionRoom.listeners.get('trackSubscribed')(track,{setSubscribed:async()=>{}},{identity:'milo-load-regression-source'});
    return {analyserOnlyControlMaxRms:Math.max(...controlSamples),sourceTrackSettings:destination.stream.getAudioTracks()[0].getSettings(),receivedTrackState:remoteTrack.readyState};
  });
  for(let i=0;i<15;i++){await page.waitForTimeout(100);report.samples.push(await page.evaluate(()=>window.miloMediaProbe.sample()));}
  report.rtp=await page.evaluate(async()=>{
    const result={sender:[],receiver:[]},peers=window.__miloRealPeers;
    (await peers.sender.getStats()).forEach(row=>{if(row.type==='media-source'&&row.kind==='audio')result.sender.push({audioLevel:row.audioLevel,totalAudioEnergy:row.totalAudioEnergy,totalSamplesDuration:row.totalSamplesDuration});});
    (await peers.receiver.getStats()).forEach(row=>{if(row.type==='inbound-rtp'&&row.kind==='audio')result.receiver.push({codec:row.codecId,bytesReceived:row.bytesReceived,packetsReceived:row.packetsReceived,totalAudioEnergy:row.totalAudioEnergy,totalSamplesReceived:row.totalSamplesReceived});});
    return result;
  });
  assert.equal(report.externalNetworkRequests.length,0,'Geen externe URL mag worden aangeroepen.');
  assert.ok(report.samples.some(sample=>sample.audioRmsMax>.01),'De exacte harnasontvanger moet echte niet-stille PCM decoderen.');
  assert.ok(report.samples.at(-1).audioSamples>=10,'Audio wordt onafhankelijk van videoframes continu gemeten.');
  assert.ok(report.samples.at(-1).audioPlayoutElements.some(element=>!element.paused&&element.volume===0&&!element.muted),'De echte audio-sink speelt terwijl het generatorgeluid lokaal stil blijft.');
  assert.ok(report.rtp.sender.some(row=>row.totalAudioEnergy>0),'De bron bevat echte energie.');
  assert.ok(report.rtp.receiver.some(row=>row.totalSamplesReceived>0&&row.packetsReceived>0),'De receiver moet echte RTP-samples decoderen.');
  report.shutdownSignals=[];
  for(const signal of ['SIGINT','SIGTERM']){
    let received=false;const handle=()=>{received=true;};process.once(signal,handle);
    process.kill(process.pid,signal);await page.waitForTimeout(100);
    assert.equal(received,true,'Node moet zijn eigen nette afsluiting kunnen uitvoeren.');
    assert.equal(browser.isConnected(),true,'De browser moet na het signaal beschikbaar blijven voor mediacleanup.');
    const sample=await page.evaluate(()=>window.miloMediaProbe.sample());
    assert.equal(sample.connected,true,'Het echte mediapad moet bereikbaar blijven tot expliciete cleanup.');
    report.shutdownSignals.push({signal,nodeHandlerInvoked:received,browserAvailableForExplicitCleanup:true});
  }
  await page.evaluate(async()=>{await window.miloMediaProbe.disconnect();const peers=window.__miloRealPeers;peers.oscillator.stop();peers.sender.close();peers.receiver.close();await peers.sourceContext.close();await peers.controlContext.close();});
  report.explicitCleanup=await page.evaluate(()=>({sourceContextState:window.__miloRealPeers.sourceContext.state,controlContextState:window.__miloRealPeers.controlContext.state,senderState:window.__miloRealPeers.sender.connectionState,receiverState:window.__miloRealPeers.receiver.connectionState}));
  assert.deepEqual(report.explicitCleanup,{sourceContextState:'closed',controlContextState:'closed',senderState:'closed',receiverState:'closed'});
  report.passed=true;
  console.log(`✓ Exacte harnasontvanger decodeert echte lokale Opus-PCM (max RMS ${Math.max(...report.samples.map(sample=>sample.audioRmsMax)).toFixed(5)}); geen externe media gestart.`);
}catch(error){report.passed=false;report.error=String(error.message);throw error;}
finally{
  await browser?.close();await new Promise(accept=>server.close(accept));report.finishedAt=new Date().toISOString();
  if(output){await mkdir(dirname(output),{recursive:true,mode:0o700});await writeFile(output,JSON.stringify(report,null,2)+'\n',{mode:0o600});}
}
