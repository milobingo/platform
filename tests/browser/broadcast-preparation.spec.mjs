import {test,expect} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {CHARACTERS} from '../../server/characters.js';
import {makeGame,activateBlock} from '../../server/bingo-model.js';
import {defaultPresentation} from '../../server/presentation-model.js';
import {obsOutputState} from '../../server/node-obs-access.js';

// Real built UI, Canvas, Web Audio and MediaRecorder; inert authenticated and
// scoped API transport. This is a browser recording, never an OBS acceptance.
const output=process.env.SIMPLE_SHOW_EVIDENCE_ROOT||'verification/simple-show/browser';
const TOKEN='A'.repeat(43)+'.'+'Q'.repeat(43);
const expiresAt=()=>Date.now()+604800000;
async function proof(name,data){await mkdir(output,{recursive:true});await writeFile(`${output}/${name}.json`,JSON.stringify({observedAt:new Date().toISOString(),actualBrowserRendering:true,actualWebAudio:true,simulatedAuthAndApiTransport:true,actualAccountAcceptance:false,actualBackendWrites:false,actualProviderAcceptance:false,actualOBSInstallation:false,remainingOBSCheck:'Controleer op een echte OBS-installatie de Browserbronmixer en luister een korte proefopname met beeld en testgeluid terug.',...data},null,2)+'\n');}
async function shot(page,name){await mkdir(output+'/screenshots',{recursive:true});await page.screenshot({path:`${output}/screenshots/${name}.png`,fullPage:false});}

async function instrumentAudio(page,{allow=true}={}){
 await page.addInitScript(allow=>{
  window.__qaAllowAudio=allow;window.__qaAudioContexts=[];window.__qaProgramDestinations=[];window.__qaMicrophoneRequests=0;window.__qaAudioPhases=[];
  window.__qaAudioStep=(phase,operation,milliseconds=10000)=>{
   const entry={phase,status:'pending',startedAt:performance.now()};window.__qaAudioPhases.push(entry);
   return new Promise((resolve,reject)=>{const finish=(status,value)=>{clearTimeout(timer);entry.status=status;entry.elapsedMs=performance.now()-entry.startedAt;(status==='complete'?resolve:reject)(value);},timer=setTimeout(()=>finish('failed',Error(`Audio QA phase timed out: ${phase}`)),milliseconds);Promise.resolve().then(operation).then(value=>finish('complete',value),error=>finish('failed',Error(`Audio QA phase failed: ${phase}: ${error.message}`)));});
  };
  const Native=window.AudioContext;
  window.AudioContext=class extends Native{
   constructor(...args){super(...args);window.__qaAudioContexts.push(this);}
   async resume(){if(!window.__qaAllowAudio){await this.suspend();return;}return super.resume();}
   createMediaStreamDestination(){const destination=super.createMediaStreamDestination();window.__qaProgramDestinations.push({context:this,destination});return destination;}
  };
  window.__qaCreateRenderMeter=async context=>{
   const processor='qa-render-meter-'+crypto.randomUUID(),module=URL.createObjectURL(new Blob([`registerProcessor(${JSON.stringify(processor)},class extends AudioWorkletProcessor{
    constructor(){super();this.peak=0;this.frames=0;this.port.onmessage=({data})=>{if(data.command==='reset'){this.peak=0;this.frames=0;}this.port.postMessage({id:data.id,peak:this.peak,frames:this.frames});};}
    process(inputs,outputs){const input=inputs[0]||[],output=outputs[0]||[];for(let channel=0;channel<output.length;channel++)output[channel].set(input[channel]||input[0]||new Float32Array(output[channel].length));for(const values of input){let squares=0;for(const value of values)squares+=value*value;if(values.length)this.peak=Math.max(this.peak,Math.sqrt(squares/values.length));}this.frames+=input[0]?.length||0;return true;}
   });`],{type:'text/javascript'}));
   try{await window.__qaAudioStep('AudioWorklet.addModule',()=>context.audioWorklet.addModule(module));}finally{URL.revokeObjectURL(module);}
   const node=new AudioWorkletNode(context,processor),readings=new Map();let sequence=0;
   node.port.onmessage=({data})=>{const pending=readings.get(data.id);if(!pending)return;readings.delete(data.id);clearTimeout(pending.timer);pending.resolve(data);};
   return {node,read:command=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{readings.delete(id);reject(Error('The audio render meter did not acknowledge '+command));},5000);readings.set(id,{resolve,reject,timer});node.port.postMessage({id,command});}),close(){for(const pending of readings.values()){clearTimeout(pending.timer);pending.reject(Error('The audio render meter was closed'));}readings.clear();node.disconnect();node.port.close();}};
  };
  if(navigator.mediaDevices)navigator.mediaDevices.getUserMedia=async()=>{window.__qaMicrophoneRequests++;throw Error('Microphones are forbidden in broadcast preparation QA');};
 },allow);
}
async function fixture(context,testInfo,{outputOnly=false}={}){
 const origin=new URL(testInfo.project.use.baseURL).origin,game=makeGame({brandId:'milo',title:'QA eenvoudige uitzendvoorbereiding',date:'2027-11-18T13:30',timeZone:'Europe/Amsterdam'},'qa-preparation-regie',origin);
 game.status='running';activateBlock(game,game.plan.blocks.findIndex(block=>block.type==='round'),0);game.state.paused=true;game.state.drawn=[7,19,41];game.state.lastCommit={number:41,committedAt:Date.now()-20000};game.state.window={id:'qa-open-bingo',status:'open',startedAt:Date.now()-1000,endsAt:Date.now()+600000,announcements:[],claims:[]};game.revision=1;
 let relay=outputOnly?{producer:{id:'qa-producer',instanceId:'qa-instance',gameId:game.id,generation:1,until:Date.now()+600000},generation:1,seq:1,publishedAt:Date.now(),snapshot:{production:'milo',gameId:game.id,gameTitle:game.title,hostId:'milo',speakerId:'milo',camera:'host',motion:'idle',paused:true,lastNumber:41,drawn:[7,19,41],bingoPending:true},show:{scene:'host',paused:true,title:game.title,drawBlocked:true},output:null,routing:true,mixer:{voice:100,music:25,effects:50},events:[],voice:null}:null;
 let disconnected=false;
 const evidence={origin,gameId:game.id,outputOnly,requests:[],producerActions:[],heartbeats:[],leaseHeartbeats:[],forbiddenWrites:[],external:[],unexpected:[],errors:[],expectedNetworkErrors:[],initialGameState:structuredClone(game.state)};
 const observe=page=>{page.on('pageerror',error=>evidence.errors.push(error.message));page.on('console',message=>{if(message.type()!=='error')return;const text=message.text(),url=message.location().url;if(url.startsWith(origin+'/api/obs/')&&/Failed to load resource|Failed to fetch/.test(text))evidence.expectedNetworkErrors.push(text);else evidence.errors.push({text,url});});};
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url()),scoped=url.pathname.startsWith('/api/obs/');
  if(url.origin!==origin){evidence.external.push(url.origin+url.pathname);return route.abort('blockedbyclient');}
  if(url.pathname==='/favicon.ico')return route.fulfill({status:204});if(!url.pathname.startsWith('/api/')&&!url.pathname.startsWith('/auth/'))return route.continue();
  evidence.requests.push({path:url.pathname,method:request.method(),scoped});
  if(scoped){expect(request.headers()['x-milo-obs-token']).toBe(TOKEN);if(disconnected)return route.abort('failed');}
  if(scoped&&url.pathname==='/api/obs/session')return route.fulfill({json:{authenticated:true,role:'output',gameId:game.id,expiresAt:expiresAt()}});
  if(url.pathname==='/api/output'||url.pathname==='/api/obs/output'){
   if(request.method()==='POST'){
    const body=request.postDataJSON();
    if(scoped){expect(body.action).toBe('output-heartbeat');evidence.heartbeats.push({action:body.action,audioReady:body.audioReady,audioPlayedAt:body.audioPlayedAt,testAck:body.testAck,generation:body.generation,seq:body.seq});if(relay)relay.output={id:body.clientId,until:Date.now()+7000,audioReady:body.audioReady,audioPlayedAt:body.audioPlayedAt||null,testAck:body.testAck||null,generation:body.generation,seq:body.seq};}
    else if(body.action==='producer-claim'){expect(game.state.control?.id).toBe(body.clientId);expect(game.state.control.until).toBeGreaterThan(Date.now());evidence.producerActions.push(body.action);relay={...(relay||{}),producer:{id:body.clientId,instanceId:body.instanceId,gameId:body.gameId,generation:(relay?.generation||0)+1,until:Date.now()+15000},generation:(relay?.generation||0)+1,seq:0,publishedAt:null,snapshot:null,show:null,events:[],voice:null,routing:false};}
    else if(body.action==='publish'){evidence.producerActions.push(body.action);expect(body.gameId).toBe(game.id);expect(body.generation).toBe(relay.producer.generation);relay={...relay,...body,publishedAt:Date.now(),producer:{...relay.producer,until:Date.now()+15000}};}
    else {evidence.forbiddenWrites.push({path:url.pathname,action:body.action});return route.fulfill({status:403,json:{error:'Unexpected relay action'}});}
   }
   if(outputOnly&&relay){relay.publishedAt=Date.now();relay.producer.until=Date.now()+15000;}
   return route.fulfill({json:{serverTime:Date.now(),state:scoped?obsOutputState(relay,{gameId:game.id}):relay}});
  }
  if(url.pathname===`/api/bingo/games/${game.id}/heartbeat`&&request.method()==='POST'){const body=request.postDataJSON();evidence.leaseHeartbeats.push({action:'heartbeat',regieId:body.regieId});game.state.control={id:body.regieId,until:Date.now()+15000};return route.fulfill({json:{ok:true}});}
  if(request.method()!=='GET'){evidence.forbiddenWrites.push({path:url.pathname,method:request.method(),body:request.postDataJSON()});return route.fulfill({status:403,json:{error:{message:'Game mutations and real providers are forbidden in browser QA.'}}});}
  let data;
  if(url.pathname==='/api/auth/session')data={authenticated:true,user:'qa-preparation-regie',email:'regie@example.test',role:'regie',local:false,configured:true,localAvailable:false};
  else if(url.pathname==='/api/bingo/games')data={games:[{id:game.id,brandId:game.brandId,title:game.title,status:game.status,date:game.date,timeZone:game.timeZone,roundCount:4,bookCount:0}]};
  else if(url.pathname===`/api/bingo/games/${game.id}`)data={game,serverTime:Date.now()};
  else if(url.pathname===`/api/bingo/games/${game.id}/chat`||url.pathname===`/api/bingo/games/${game.id}/chat/stream`){data={...(url.searchParams.has('after')?{events:[]}:{messages:[]}),cursor:0,hasMore:false,self:{memberId:'qa-host',role:'host',canSend:true,mutedUntil:0,reason:'',profiles:[]},serverTime:Date.now()};if(url.pathname.endsWith('/stream'))return route.fulfill({body:`event: sync\ndata: ${JSON.stringify({...data,reconnect:true})}\n\n`,headers:{'Content-Type':'text/event-stream; charset=utf-8'}});}
  else if(url.pathname===`/api/bingo/games/${game.id}/chat/members`)data={members:[],serverTime:Date.now()};
  else if(url.pathname==='/api/characters')data={characters:Object.values(CHARACTERS),revision:0};
  else if(url.pathname==='/api/openai/status'||url.pathname==='/api/livekit/settings')data={configured:false,canManage:true,source:'none',environmentConfigured:false,revision:null};
  else if(url.pathname==='/api/live-calls'||url.pathname==='/api/obs/live-calls')data={call:null,serverTime:Date.now()};
  else if(url.pathname==='/api/presentation/document')data={document:defaultPresentation(),revision:0};
  else if(url.pathname==='/api/bingo/families')data={families:[]};
  else {evidence.unexpected.push(url.pathname+url.search);return route.fulfill({status:404,json:{error:{message:'Unexpected preparation QA endpoint.'}}});}
  return route.fulfill({json:data,headers:{'Cache-Control':'private, no-store'}});
 });
 return {origin,game,evidence,observe,disconnect:value=>{disconnected=value;},getRelay:()=>relay};
}

async function activate(page,evidence){
 await expect(page.locator('#stage canvas')).toBeVisible();
 await expect.poll(async()=>evidence.heartbeats.some(item=>item.audioReady)||await page.locator('.output-unlock small').textContent().then(text=>text.includes('Geluid is nog geblokkeerd'))).toBe(true);
 if(!evidence.heartbeats.some(item=>item.audioReady))await page.getByRole('button',{name:'Beeld & geluid activeren',exact:true}).click();
 await expect.poll(()=>evidence.heartbeats.some(item=>item.audioReady&&item.audioPlayedAt&&item.testAck?.status==='played')).toBe(true);await expect(page.locator('.output-unlock')).toBeHidden();
}
async function startRecording(page){
 await page.bringToFront();
 return page.evaluate(async()=>{
  const first=window.__qaProgramDestinations[0],canvas=document.querySelector('#stage canvas');if(!first?.destination?.stream||!canvas?.captureStream)throw Error('Actual canvas/programme audio is missing');
  const analyser=first.context.createAnalyser();analyser.fftSize=256;const source=first.context.createMediaStreamSource(first.destination.stream),meter=await window.__qaCreateRenderMeter(first.context),silent=first.context.createGain();silent.gain.value=0;source.connect(meter.node);meter.node.connect(analyser);analyser.connect(silent);silent.connect(first.context.destination);let peak=0;
  // Pull the measurement branch on the audio thread without duplicating the
  // already audible programme. Arm it before the recorder accepts the tone.
  await window.__qaAudioStep('programme AudioContext.resume',()=>first.context.resume());await meter.read('reset');await window.__qaAudioStep('visible programme animation frame',()=>new Promise(requestAnimationFrame));
  const sample=setInterval(()=>{const bytes=new Uint8Array(analyser.fftSize);analyser.getByteTimeDomainData(bytes);peak=Math.max(peak,Math.sqrt(bytes.reduce((n,v)=>n+((v-128)/128)**2,0)/bytes.length));},15);
  const video=canvas.captureStream(15),stream=new MediaStream([...video.getVideoTracks(),...first.destination.stream.getAudioTracks()]),chunks=[],mime='video/webm;codecs=vp8,opus';if(!MediaRecorder.isTypeSupported(mime))throw Error('Chromium has no expected WebM/Opus recorder');
  const recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:1100000,audioBitsPerSecond:64000});recorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};const started=new Promise((resolve,reject)=>{recorder.onstart=resolve;recorder.onerror=event=>reject(Error(event.error?.message||'MediaRecorder error'));});void started.catch(()=>{});recorder.start(100);if(recorder.state!=='recording')throw Error('MediaRecorder.start did not enter recording state');video.getVideoTracks()[0].requestFrame?.();
  // A paused background canvas may not supply its first frame until foregrounded.
  // Do not wait for the asynchronous start event before the test cue can run.
  window.__qaAwaitRecordingStarted=()=>{video.getVideoTracks()[0].requestFrame?.();return window.__qaAudioStep('MediaRecorder.onstart after test tone',()=>started);};
  window.__qaFinishRecording=()=>window.__qaAudioStep('MediaRecorder.stop',()=>new Promise((resolve,reject)=>{recorder.onstop=async()=>{try{const measured=await meter.read('snapshot');clearInterval(sample);source.disconnect();meter.close();analyser.disconnect();silent.disconnect();const blob=new Blob(chunks,{type:mime});window.__qaRecordingBlob=blob;video.getTracks().forEach(track=>track.stop());const bytes=await window.__qaAudioStep('recorded WebM.arrayBuffer',()=>blob.arrayBuffer());resolve({bytes:Array.from(new Uint8Array(bytes)),mime,peak:measured.peak,programRenderedFrames:measured.frames,programMainThreadSampledRms:peak,videoTracks:stream.getVideoTracks().length,audioTracks:stream.getAudioTracks().length,microphoneRequests:window.__qaMicrophoneRequests});}catch(error){reject(error);}};recorder.stop();}));return {width:canvas.width,height:canvas.height,mime,captureVisibility:document.visibilityState,recorderState:recorder.state};
 });
}

async function verifyRecordedClip(page,{stallMainThreadMs=0}={}){
 const decoded=await page.evaluate(async()=>{
  const blob=window.__qaRecordingBlob,context=window.__qaProgramDestinations[0]?.context;if(!blob||!context)throw Error('Recorded programme clip is missing');
  const pcm=await window.__qaAudioStep('recorded WebM.decodeAudioData',async()=>context.decodeAudioData(await blob.arrayBuffer()));let decodedPeakRms=0;
  for(let channel=0;channel<pcm.numberOfChannels;channel++){const values=pcm.getChannelData(channel);for(let offset=0;offset<values.length;offset+=1024){const block=values.subarray(offset,offset+1024);decodedPeakRms=Math.max(decodedPeakRms,Math.sqrt(block.reduce((sum,value)=>sum+value*value,0)/block.length));}}
  const viewer=document.createElement('div');viewer.id='qa-recorded-clip-review';viewer.style.cssText='position:fixed;inset:10px auto auto 10px;z-index:9999;background:#21142f;color:white;padding:12px';
  const video=document.createElement('video');video.controls=true;video.preload='auto';video.width=640;video.height=360;const button=document.createElement('button');button.id='qa-play-recorded-clip';button.textContent='QA: opgenomen beeld en geluid afspelen';viewer.append(video,button);document.body.append(viewer);const url=URL.createObjectURL(blob);
  await window.__qaAudioStep('recorded WebM.loadedmetadata',()=>new Promise((resolve,reject)=>{video.onloadedmetadata=resolve;video.onerror=()=>reject(Error('The recorded WebM has no decodable video metadata'));video.src=url;}));
  const metadata={videoWidth:video.videoWidth,videoHeight:video.videoHeight,decodedAudioChannels:pcm.numberOfChannels,decodedAudioFrames:pcm.length,decodedAudioDuration:pcm.duration,decodedPeakRms};
  // A background tab or busy renderer can miss the entire short tone between
  // main-thread analyser callbacks. Measure every real audio render quantum;
  // the port handshake arms the meter before playback and reads it after end.
  const source=context.createMediaElementSource(video),meter=await window.__qaCreateRenderMeter(context),analyser=context.createAnalyser();analyser.fftSize=256;source.connect(meter.node);meter.node.connect(analyser);analyser.connect(context.destination);let peak=0,sample,timer,settled=false;
  const readMeter=command=>meter.read(command);
  window.__qaRecordedClipPlayback=new Promise((resolve,reject)=>{
   const cleanup=()=>{clearInterval(sample);clearTimeout(timer);source.disconnect();meter.close();analyser.disconnect();video.onended=null;video.onerror=null;video.pause();video.removeAttribute('src');video.load();viewer.remove();URL.revokeObjectURL(url);};
   video.onended=async()=>{if(settled)return;settled=true;try{const measured=await readMeter('snapshot'),frame=document.createElement('canvas');frame.width=64;frame.height=36;const drawing=frame.getContext('2d');drawing.drawImage(video,0,0,64,36);const pixels=drawing.getImageData(0,0,64,36).data;let low=255,high=0;for(let i=0;i<pixels.length;i+=4){const light=(pixels[i]+pixels[i+1]+pixels[i+2])/3;low=Math.min(low,light);high=Math.max(high,light);}const result={recordedPlaybackRms:measured.peak,recordedPlaybackAudioFrames:measured.frames,recordedPlaybackMeter:'AudioWorklet render quanta',recordedMainThreadSampledRms:peak,recordedPlaybackEnded:true,recordedVideoPixelRange:high-low,recordedPlaybackTime:video.currentTime};cleanup();resolve(result);}catch(error){cleanup();reject(error);}};
   video.onerror=()=>{cleanup();reject(Error('Playback of the recorded WebM failed'));};
   button.onclick=()=>{sample=setInterval(()=>{const values=new Uint8Array(analyser.fftSize);analyser.getByteTimeDomainData(values);peak=Math.max(peak,Math.sqrt(values.reduce((sum,value)=>sum+((value-128)/128)**2,0)/values.length));},15);timer=setTimeout(()=>{cleanup();reject(Error('The recorded WebM did not complete actual playback'));},15000);void window.__qaAudioStep('recorded playback AudioContext.resume',()=>context.resume()).then(()=>readMeter('reset')).then(()=>window.__qaAudioStep('recorded WebM.play',()=>video.play())).catch(error=>{cleanup();reject(error);});};
  });return metadata;
 });
 if(stallMainThreadMs)await page.evaluate(milliseconds=>{const video=document.querySelector('#qa-recorded-clip-review video');video.addEventListener('playing',()=>{const end=performance.now()+milliseconds;while(performance.now()<end){/* Simulate a busy renderer while the audio render thread keeps playing. */}},{once:true});},stallMainThreadMs);
 await page.locator('#qa-play-recorded-clip').click();const playback=await page.evaluate(()=>window.__qaRecordedClipPlayback);return {...decoded,...playback};
}

test('two-page broadcast preparation plays the actual programme test, records image/audio and reconnects the same paused bingo; simulated relay',async({context,page},testInfo)=>{
 test.setTimeout(100000);await page.setViewportSize({width:1366,height:900});const h=await fixture(context,testInfo),outputPage=await context.newPage();h.observe(page);h.observe(outputPage);await outputPage.setViewportSize({width:1920,height:1080});await instrumentAudio(outputPage);
 try{
  await page.goto('/#/overview');await expect(page.locator('.mf-top-show>strong')).toHaveText(h.game.title);await page.getByRole('button',{name:'Hervat regie',exact:true}).click();await expect(page).toHaveURL(/#\/live/);await page.evaluate(()=>{location.hash='#/overview';});await page.getByRole('navigation',{name:'Show voorbereiden'}).getByRole('button',{name:/Uitzending testen/}).click();const card=page.locator('.mf-panel').filter({has:page.getByRole('heading',{name:'Uitzending testen',exact:true})}).first();
  await card.getByRole('button',{name:'Opnieuw verbinden',exact:true}).click();await expect.poll(()=>h.getRelay()?.snapshot?.gameId).toBe(h.game.id);
  await outputPage.goto('/uitzending#obs='+TOKEN);await activate(outputPage,h.evidence);await expect(card).toContainText('Geluid afgespeeld.');await expect(card).not.toContainText('OBS door jou gecontroleerd');
  await page.bringToFront();h.evidence.recordingPreparation={focusBeforeCapture:'regie',paused:h.game.state.paused};const metadata=await startRecording(outputPage);h.evidence.recording=metadata;await card.getByRole('button',{name:'Speel testgeluid',exact:true}).click();await outputPage.bringToFront();await outputPage.evaluate(()=>window.__qaAwaitRecordingStarted());await expect(card.getByRole('button',{name:'Speel testgeluid',exact:true})).toBeEnabled();await expect(card).toContainText('Geluid afgespeeld.');
  await expect.poll(()=>h.evidence.heartbeats.filter(item=>item.testAck?.status==='played').map(item=>item.testAck.id).filter((id,index,items)=>items.indexOf(id)===index).length).toBeGreaterThan(1);await shot(outputPage,'broadcast-programme-active');await shot(page,'broadcast-preparation-three-checks');
  await outputPage.waitForTimeout(1100);const recording=await outputPage.evaluate(()=>window.__qaFinishRecording());expect(recording.videoTracks).toBe(1);expect(recording.audioTracks).toBe(1);expect(recording.peak).toBeGreaterThan(.01);expect(recording.programRenderedFrames).toBeGreaterThan(0);expect(recording.microphoneRequests).toBe(0);expect(recording.bytes.length).toBeGreaterThan(10000);await mkdir(output,{recursive:true});await writeFile(output+'/browser-programme-test.webm',Buffer.from(recording.bytes));const decoded=await verifyRecordedClip(outputPage,{stallMainThreadMs:1200});expect(decoded.videoWidth).toBe(metadata.width);expect(decoded.videoHeight).toBe(metadata.height);expect(decoded.decodedAudioChannels).toBeGreaterThan(0);expect(decoded.decodedAudioDuration).toBeGreaterThan(1);expect(decoded.decodedPeakRms).toBeGreaterThan(.01);expect(decoded.recordedPlaybackRms).toBeGreaterThan(.01);expect(decoded.recordedPlaybackAudioFrames).toBeGreaterThan(0);expect(decoded.recordedPlaybackEnded).toBe(true);expect(decoded.recordedVideoPixelRange).toBeGreaterThan(20);h.evidence.recording={...metadata,...decoded,bytes:recording.bytes.length,peak:recording.peak,programRenderedFrames:recording.programRenderedFrames,programMainThreadSampledRms:recording.programMainThreadSampledRms,microphoneRequests:recording.microphoneRequests,actualOBSRecording:false};
  const before=structuredClone(h.game.state);delete before.control;h.disconnect(true);await expect(outputPage.locator('.output-unlock--obs')).toBeVisible();await expect(outputPage.getByRole('button',{name:'Opnieuw verbinden',exact:true})).toHaveCount(0);h.disconnect(false);await expect(outputPage.locator('.output-unlock')).toBeHidden({timeout:15000});await expect.poll(()=>h.getRelay()?.snapshot?.lastNumber).toBe(41);expect(h.getRelay().snapshot.drawn).toEqual([7,19,41]);expect(h.getRelay().snapshot.paused).toBe(true);const restored=structuredClone(h.game.state);delete restored.control;expect(restored).toEqual(before);expect(h.game.state.window.id).toBe('qa-open-bingo');await shot(outputPage,'broadcast-reconnected-existing-show');
  expect(h.evidence.forbiddenWrites).toEqual([]);expect(h.evidence.unexpected).toEqual([]);expect(h.evidence.external).toEqual([]);expect(h.evidence.errors).toEqual([]);h.evidence.finalGameState=structuredClone(h.game.state);
 }finally{h.evidence.audioPhases=await outputPage.evaluate(()=>window.__qaAudioPhases).catch(()=>[]);await proof('broadcast-two-page-record-reconnect',h.evidence);await outputPage.close();}
});

test('blocked autoplay keeps a compact activation fallback until a real programme tone finishes; simulated scoped API',async({context,page},testInfo)=>{
 test.setTimeout(60000);const h=await fixture(context,testInfo,{outputOnly:true});h.observe(page);await page.setViewportSize({width:1920,height:1080});await instrumentAudio(page,{allow:false});
 try{
  await page.goto('/uitzending#obs='+TOKEN);await expect(page.locator('#stage canvas')).toBeVisible();await expect(page.locator('.output-unlock')).toBeVisible();await expect(page.locator('.output-unlock small')).toContainText('Geluid is nog geblokkeerd');expect(h.evidence.heartbeats.some(item=>item.audioReady)).toBe(false);await shot(page,'broadcast-audio-blocked');
  await page.evaluate(()=>{window.__qaAllowAudio=true;});await page.getByRole('button',{name:'Beeld & geluid activeren',exact:true}).click();await expect(page.locator('.output-unlock')).toBeHidden();expect(h.evidence.heartbeats.some(item=>item.audioReady&&item.audioPlayedAt&&item.testAck?.status==='played')).toBe(true);expect(await page.evaluate(()=>window.__qaMicrophoneRequests)).toBe(0);expect(h.evidence.forbiddenWrites).toEqual([]);expect(h.evidence.unexpected).toEqual([]);expect(h.evidence.external).toEqual([]);expect(h.evidence.errors).toEqual([]);await shot(page,'broadcast-audio-explicitly-activated');
 }finally{await proof('broadcast-blocked-audio-activation',h.evidence);}
});
