import {Room,RoomEvent,Track,LocalVideoTrack,LocalAudioTrack,setLogLevel} from 'livekit-client';
import Hls from 'hls.js';
import {drawFrameTime,readFrameTime} from './timecode.mjs';

setLogLevel('silent');
const video=document.createElement('video');
video.width=1280;video.height=720;video.autoplay=true;video.playsInline=true;video.muted=true;
document.body.append(video);
const canvas=document.createElement('canvas');canvas.width=1280;canvas.height=720;
const canvasContext=canvas.getContext('2d',{willReadFrequently:true});
const state={connected:false,connectedAt:null,firstVideoAt:null,firstAudioAt:null,frames:0,reconnects:0,disconnects:0,stalls:0,audioRmsMax:0,timecodeSamples:[],invalidTimecodes:0,lastFrameAt:null,tracks:[],error:null};
let room,audioContext,analyser,lastTimecode=null,lastRmsAt=0,sourceTimer,hls,connectStartedAt=Date.now(),sourceAudioAnalyser,sourceVideoPublication,sourceAudioPublication,whipPc,whipSessionUrl;
const sourceNodes=[];

async function waitRtc(predicate,timeout=15000){
  const until=Date.now()+timeout;
  while(Date.now()<until){if(predicate())return;await new Promise(accept=>setTimeout(accept,100));}
  throw new Error('WHIP ICE-verbinding niet bevestigd binnen de begrensde wachttijd.');
}
async function publishWhip({url,iceServers=[],iceTransportPolicy='all'},videoTrack,audioTrack){
  whipPc=new RTCPeerConnection({iceServers,bundlePolicy:'max-bundle',iceTransportPolicy});
  const video=whipPc.addTransceiver(videoTrack,{direction:'sendonly',sendEncodings:[{maxBitrate:1186000,maxFramerate:30,scaleResolutionDownBy:1}]});
  const audio=whipPc.addTransceiver(audioTrack,{direction:'sendonly',sendEncodings:[{maxBitrate:64000}]});
  const videoCodecs=RTCRtpSender.getCapabilities('video').codecs.filter(codec=>codec.mimeType.toLowerCase()==='video/h264');
  videoCodecs.sort((a,b)=>Number(/profile-level-id=42/i.test(b.sdpFmtpLine||''))-Number(/profile-level-id=42/i.test(a.sdpFmtpLine||'')));
  const audioCodecs=RTCRtpSender.getCapabilities('audio').codecs.filter(codec=>codec.mimeType.toLowerCase()==='audio/opus');
  if(!videoCodecs.length||!audioCodecs.length)throw new Error('Deze browser heeft geen H.264/Opus-encoder voor de WHIP-proef.');
  video.setCodecPreferences(videoCodecs);audio.setCodecPreferences(audioCodecs);
  const offer=await whipPc.createOffer();
  // Keep the test Opus mix audible at a reproducible bitrate instead of DTX.
  const opusPayload=/a=rtpmap:(\d+) opus\/48000/i.exec(offer.sdp)?.[1];
  if(opusPayload)offer.sdp=offer.sdp.replace(new RegExp(`(a=fmtp:${opusPayload} [^\\r\\n]*)`), '$1;usedtx=0;stereo=0;maxaveragebitrate=64000;cbr=1');
  await whipPc.setLocalDescription(offer);
  await waitRtc(()=>whipPc.iceGatheringState==='complete',12000);
  const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/sdp'},body:whipPc.localDescription.sdp,redirect:'error',signal:AbortSignal.timeout(12000)});
  if(response.status!==201)throw new Error(`WHIP-ingest geweigerd (HTTP ${response.status}).`);
  const location=response.headers.get('Location');
  if(location){
    const resolved=new URL(location,url);
    if(resolved.origin!==new URL(url).origin)throw new Error('WHIP-sessiebeheer wijst buiten de eigen stagingdienst.');
    whipSessionUrl=resolved.href;
  }
  const answer=await response.text();
  if(answer.length>1000000)throw new Error('WHIP-SDP overschrijdt de veilige limiet.');
  await whipPc.setRemoteDescription({type:'answer',sdp:answer});
  await waitRtc(()=>whipPc.connectionState==='connected',15000);
  return {whipHttpStatus:response.status,route:'browser-whip-test'};
}

function observeFrames() {
  video.requestVideoFrameCallback(()=>{
    const now=Date.now();state.frames++;state.firstVideoAt??=now;state.lastFrameAt=now;
    if(now-lastRmsAt>=1000){
      lastRmsAt=now;
      const ms=readFrameTime(canvasContext,video);
      if(ms!==null&&ms!==lastTimecode&&now-ms>=-20&&now-ms<120000){state.timecodeSamples.push({displayAtMs:now,sourceAtMs:ms,latencyMs:now-ms});lastTimecode=ms;}
      else if(ms===null)state.invalidTimecodes++;
      if(analyser){const data=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(data);const rms=Math.sqrt(data.reduce((sum,value)=>sum+value*value,0)/data.length);state.audioRmsMax=Math.max(state.audioRmsMax,rms);if(rms>.0001)state.firstAudioAt??=now;}
    }
    observeFrames();
  });
}
observeFrames();

window.miloMediaProbe={
  async connect({url,token,publisherIdentity,iceTransportPolicy='all'}){
    connectStartedAt=Date.now();
    room=new Room({adaptiveStream:false,dynacast:false});
    room.on(RoomEvent.Reconnecting,()=>{state.connected=false;state.reconnects++;});
    room.on(RoomEvent.Reconnected,()=>{state.connected=true;});
    room.on(RoomEvent.Disconnected,()=>{state.connected=false;state.disconnects++;});
    room.on(RoomEvent.TrackSubscribed,async(track,publication,participant)=>{
      if(participant.identity!==publisherIdentity){await publication.setSubscribed(false);state.error='unexpected-publisher';return;}
      if(track.kind===Track.Kind.Video){track.attach(video);await video.play().catch(()=>{state.error='video-playback-blocked';});}
      else if(track.kind===Track.Kind.Audio){
        // Decode the real audio track. Keep this test generator silent locally.
        audioContext=new AudioContext();await audioContext.resume();
        const source=audioContext.createMediaStreamSource(new MediaStream([track.mediaStreamTrack]));
        analyser=audioContext.createAnalyser();analyser.fftSize=2048;
        const mute=audioContext.createGain();mute.gain.value=0;source.connect(analyser);analyser.connect(mute);mute.connect(audioContext.destination);
      }
      state.tracks.push(track);
    });
    await room.connect(url,token,{autoSubscribe:true,rtcConfig:{iceTransportPolicy}});
    state.connected=true;state.connectedAt=Date.now();
  },
  async connectHls({url}){
    connectStartedAt=Date.now();
    video.crossOrigin='anonymous';video.muted=false;
    audioContext=new AudioContext();await audioContext.resume();
    const source=audioContext.createMediaElementSource(video),mute=audioContext.createGain();
    analyser=audioContext.createAnalyser();analyser.fftSize=2048;mute.gain.value=0;source.connect(analyser);analyser.connect(mute);mute.connect(audioContext.destination);
    if(Hls.isSupported()){
      hls=new Hls({lowLatencyMode:false,liveSyncDurationCount:1,liveMaxLatencyDurationCount:4,startPosition:-1});
      hls.on(Hls.Events.ERROR,(_,event)=>{if(event.fatal)state.error=`hls-${event.type}-${event.details}`;});
      hls.on(Hls.Events.MANIFEST_PARSED,()=>video.play().catch(()=>{state.error='hls-audio-activation-required';}));
      hls.loadSource(url);hls.attachMedia(video);
    }else if(video.canPlayType('application/vnd.apple.mpegurl')){video.src=url;await video.play();}
    else throw new Error('Geen HLS-decoder beschikbaar.');
    state.connected=true;state.connectedAt=Date.now();
  },
  async sample(){
    const tracks=[];
    for(const track of state.tracks){
      const stats=await track.getRTCStatsReport();
      stats?.forEach(row=>{
        if(row.type==='inbound-rtp')tracks.push({kind:track.kind,codec:stats.get(row.codecId)?.mimeType,bytesReceived:row.bytesReceived,packetsReceived:row.packetsReceived,packetsLost:row.packetsLost,jitter:row.jitter,framesDecoded:row.framesDecoded,framesDropped:row.framesDropped,freezeCount:row.freezeCount,totalFreezesDuration:row.totalFreezesDuration,totalAudioEnergy:row.totalAudioEnergy,frameWidth:row.frameWidth,frameHeight:row.frameHeight});
        if(row.type==='candidate-pair'&&row.state==='succeeded'&&row.nominated){
          const local=stats.get(row.localCandidateId),remote=stats.get(row.remoteCandidateId);
          tracks.push({kind:'transport',protocol:local?.protocol,localCandidateType:local?.candidateType,remoteCandidateType:remote?.candidateType,localAddress:local?.address,localPort:local?.port,remoteAddress:remote?.address,remotePort:remote?.port,currentRoundTripTime:row.currentRoundTripTime});
        }
      });
    }
    const samples=state.timecodeSamples.splice(0);
    const {tracks:ignored,timecodeSamples:ignoredSamples,...snapshot}=state;
    const quality=video.getVideoPlaybackQuality?.();
    return {...snapshot,tracks,timecodeSamples:samples,observedAtMs:Date.now(),timeToFirstVideoMs:state.firstVideoAt===null?null:state.firstVideoAt-connectStartedAt,timeToFirstAudioMs:state.firstAudioAt===null?null:state.firstAudioAt-connectStartedAt,audioContextState:audioContext?.state??null,hlsPlaybackQuality:quality?{totalVideoFrames:quality.totalVideoFrames,droppedVideoFrames:quality.droppedVideoFrames}:null};
  },
  async disconnect(){hls?.destroy();await room?.disconnect();await audioContext?.close();},
  async publish({url,token,announcementsUrl,iceTransportPolicy='all',sourceRoute='direct-sdk-diagnostic-source',whipUrl,whipIceServers}){
    document.body.replaceChildren(canvas);canvas.hidden=false;
    audioContext=new AudioContext();await audioContext.resume();
    const destination=audioContext.createMediaStreamDestination();
    sourceAudioAnalyser=audioContext.createAnalyser();sourceAudioAnalyser.fftSize=2048;
    const silentMonitor=audioContext.createGain();silentMonitor.gain.value=0;
    sourceAudioAnalyser.connect(destination);sourceAudioAnalyser.connect(silentMonitor);silentMonitor.connect(audioContext.destination);
    sourceNodes.push(destination,sourceAudioAnalyser,silentMonitor);
    if(announcementsUrl){
      const audio=new Audio(announcementsUrl);audio.loop=true;audio.crossOrigin='anonymous';
      const source=audioContext.createMediaElementSource(audio);source.connect(sourceAudioAnalyser);sourceNodes.push(audio,source);await audio.play();
    }else{
      // Explicitly labelled diagnostic tone, never evidence of spoken announcements.
      const oscillator=audioContext.createOscillator();oscillator.frequency.value=440;
      const gain=audioContext.createGain();gain.gain.value=.08;oscillator.connect(gain);gain.connect(sourceAudioAnalyser);oscillator.start();sourceNodes.push(oscillator,gain);
    }
    const paint=()=>{
      const now=Date.now();const n=1+Math.floor(now/15000)%75;
      canvasContext.fillStyle='#241331';canvasContext.fillRect(0,0,1280,720);
      canvasContext.fillStyle='#f1cc7c';canvasContext.font='bold 42px sans-serif';canvasContext.fillText('Milo · afgeschermde technische proef',40,60);
      canvasContext.fillStyle='#64d1cf';canvasContext.beginPath();canvasContext.arc(100+((now/6)%1080),125,26,0,Math.PI*2);canvasContext.fill();
      // A moving textured ribbon prevents a nearly static test card from
      // understating the configured media bitrate. The number cells stay clear.
      for(let tile=0;tile<1600;tile++){
        const x=(tile*53+(now/8))%1280,y=82+((tile*29)%90);
        canvasContext.fillStyle=`hsl(${(tile*41+now/40)%360} 70% 50%)`;canvasContext.fillRect(x,y,5,5);
      }
      for(let number=1;number<=75;number++){const x=40+((number-1)%15)*80,y=190+Math.floor((number-1)/15)*65;canvasContext.fillStyle=number===n?'#f1cc7c':'#67527b';canvasContext.fillRect(x,y,73,58);canvasContext.fillStyle=number===n?'#241331':'white';canvasContext.font='bold 32px sans-serif';canvasContext.fillText(String(number).padStart(2,'0'),x+13,y+40);}
      canvasContext.fillStyle='white';canvasContext.font='bold 42px monospace';canvasContext.fillText(new Date(now).toISOString(),40,595);drawFrameTime(canvasContext,now);
    };
    const sourceVideo=canvas.captureStream(0).getVideoTracks()[0];
    const tick=()=>{paint();sourceVideo.requestFrame();};tick();sourceTimer=setInterval(tick,1000/30);
    let result={route:'direct-sdk-diagnostic-source'};
    if(sourceRoute==='browser-whip-test')result=await publishWhip({url:whipUrl,iceServers:whipIceServers,iceTransportPolicy},sourceVideo,destination.stream.getAudioTracks()[0]);
    else{
      room=new Room({adaptiveStream:false,dynacast:false});await room.connect(url,token,{autoSubscribe:false,rtcConfig:{iceTransportPolicy}});
      sourceVideoPublication=await room.localParticipant.publishTrack(new LocalVideoTrack(sourceVideo),{name:'program-video',source:Track.Source.ScreenShare,videoCodec:'h264',simulcast:false,videoEncoding:{maxBitrate:1186000,maxFramerate:30}});
      sourceAudioPublication=await room.localParticipant.publishTrack(new LocalAudioTrack(destination.stream.getAudioTracks()[0]),{name:'program-audio',source:Track.Source.ScreenShareAudio,audioPreset:{maxBitrate:64000},dtx:false,forceStereo:false});
    }
    return {...result,published:true,announcements:!!announcementsUrl,audioSource:announcementsUrl?'recorded-number-announcements':'diagnostic-tone-only',profile:{width:1280,height:720,fps:30,videoBps:1186000,audioBps:64000,simulcast:false}};
  },
  async sourceSample(){
    const data=new Float32Array(sourceAudioAnalyser.fftSize);sourceAudioAnalyser.getFloatTimeDomainData(data);
    const audioRms=Math.sqrt(data.reduce((sum,value)=>sum+value*value,0)/data.length);
    const stats=new Map();
    const reports=whipPc?[await whipPc.getStats()]:await Promise.all([sourceVideoPublication?.track?.getRTCStatsReport(),sourceAudioPublication?.track?.getRTCStatsReport()]);
    reports.forEach(report=>report?.forEach((value,key)=>stats.set(key,value)));
    const video=[],audio=[],transport=[];stats?.forEach(value=>{
      if(value.type==='outbound-rtp'&&value.kind==='video')video.push({codec:stats.get(value.codecId)?.mimeType,bytesSent:value.bytesSent,framesEncoded:value.framesEncoded,framesPerSecond:value.framesPerSecond,qualityLimitationReason:value.qualityLimitationReason});
      if(value.type==='outbound-rtp'&&value.kind==='audio')audio.push({codec:stats.get(value.codecId)?.mimeType,bytesSent:value.bytesSent,packetsSent:value.packetsSent});
      if(value.type==='candidate-pair'&&value.state==='succeeded'&&value.nominated){const local=stats.get(value.localCandidateId),remote=stats.get(value.remoteCandidateId);transport.push({protocol:local?.protocol,localAddress:local?.address,localPort:local?.port,remoteAddress:remote?.address,remotePort:remote?.port,localCandidateType:local?.candidateType,remoteCandidateType:remote?.candidateType});}
    });
    return {observedAtMs:Date.now(),audioRms,audioContextState:audioContext.state,video,audio,transport};
  },
  async stopPublishing(){
    clearInterval(sourceTimer);whipPc?.close();
    if(whipSessionUrl)await fetch(whipSessionUrl,{method:'DELETE',redirect:'error',signal:AbortSignal.timeout(5000)}).catch(()=>{});
    await room?.disconnect();await audioContext?.close();
  },
};
