import {gameEvents} from './bingo-choreography.js?v=36';
// Original short broadcast cues, generated locally. Only the regie makes sound;
// its music/cues duck under the presenter so numbers stay easy to hear.
export function createShowAudio({Context=globalThis.AudioContext||globalThis.webkitAudioContext}={}){
 let musicBus,effectMeter,musicMeter,programDestination,muted=false,levels={voice:100,music:25,effects:50},lastMusic=-1;
 let brand='vlampie';
 let context,bus,enabled=true,volume=.32,ducked=false,nodes=new Set(),timers=new Set(),paused=false,gameKey='',gameTime=-1,gameCues=[];
 function level(){return enabled&&!muted?volume*(levels.effects/50)*(ducked?.2:1):0;}
 function gain(){if(musicBus)musicBus.gain.setTargetAtTime(enabled&&!muted?levels.music/100*(ducked?.14:.45):0,context.currentTime,.12);if(bus){bus.gain.cancelScheduledValues(context.currentTime);bus.gain.setTargetAtTime(level(),context.currentTime,.08);}}
 async function unlock(){if(!enabled||!Context)return false;try{context??=new Context();if(!bus){programDestination=context.createMediaStreamDestination();bus=context.createGain();bus.gain.value=level();effectMeter=context.createAnalyser();effectMeter.fftSize=256;bus.connect(effectMeter);effectMeter.connect(context.destination);effectMeter.connect(programDestination);musicBus=context.createGain();musicMeter=context.createAnalyser();musicMeter.fftSize=256;musicBus.connect(musicMeter);musicMeter.connect(context.destination);musicMeter.connect(programDestination);gain();}paused=false;await context.resume();return context.state==='running';}catch{return false;}}
 function later(fn,ms){const id=setTimeout(()=>{timers.delete(id);if(!paused&&enabled)fn();},ms);timers.add(id);}
 function tone(hz,start,duration=.25,type='sine',power=.12,destination=bus){if(!context||!bus)return;const o=context.createOscillator(),g=context.createGain();o.type=brand==='rocco'&&type==='sine'?'triangle':type;o.frequency.setValueAtTime(hz*(brand==='milo'?1.189207:brand==='rocco'?.890899:1),start);g.gain.setValueAtTime(0,start);g.gain.linearRampToValueAtTime(power,start+.018);g.gain.exponentialRampToValueAtTime(.001,start+duration);o.connect(g);g.connect(destination);o.start(start);o.stop(start+duration+.03);nodes.add(o);o.onended=()=>{nodes.delete(o);o.disconnect();g.disconnect();};}
 function applause(){if(!context||!bus)return;const buffer=context.createBuffer(1,Math.floor(context.sampleRate*.16),context.sampleRate),data=buffer.getChannelData(0);for(let i=0;i<data.length;i++)data[i]=(Math.random()*2-1)*(1-i/data.length)**2;
  for(let i=0;i<48;i++){const b=context.createBufferSource(),filter=context.createBiquadFilter(),g=context.createGain();b.buffer=buffer;filter.type='bandpass';filter.frequency.value=950+i%7*260;filter.Q.value=.7;g.gain.value=.12+i%5*.025;b.connect(filter);filter.connect(g);g.connect(bus);b.start(context.currentTime+i*.053+(i%3)*.018);nodes.add(b);b.onended=()=>{nodes.delete(b);b.disconnect();filter.disconnect();g.disconnect();};}}
 function stop(){timers.forEach(clearTimeout);timers.clear();for(const node of nodes){try{node.stop();}catch{}}nodes.clear();}
 function cue(kind){if(!enabled||paused||!context||context.state!=='running')return;stop();const t=context.currentTime;
  const notes=kind==='intro'||kind==='finale'?[261.63,329.63,392,523.25,659.25,783.99,1046.5]:kind==='win'?[392,523.25,659.25,783.99,1046.5]:kind==='round'||kind==='prize'?[329.63,392,523.25,659.25]:kind==='friendly'?[392,329.63,392]:[523.25,659.25,1046.5];
  if(kind==='applause'){applause();return;}
  if(kind==='spin'){for(let i=0;i<30;i++){const s=t+i*(.11-.0007*i);tone(180+(i%4)*70,s,.065,'triangle',.07);}tone(120,t,3.5,'sine',.07);return;}
  notes.forEach((hz,i)=>{tone(hz,t+i*.13,kind==='intro'||kind==='finale'?.6:.35,'sine',.15);tone(hz/2,t+i*.13,.28,'triangle',.035);});
  if(['intro','finale'].includes(kind)){[261.63,329.63,392].forEach(hz=>tone(hz,t,.9,'triangle',.05));}
  if(kind==='win'||kind==='finale')later(applause,450);
 }
 function gameSound(kind){if(!context||context.state!=='running'||!enabled||paused)return;const t=context.currentTime;
  if(kind==='count')tone(440,t,.075,'sine',.065);
  else if(kind==='go'){[392,523,784].forEach((hz,i)=>tone(hz,t+i*.055,.13,'triangle',.055));}
  else if(kind==='pop'){tone(145,t,.07,'triangle',.07);tone(930,t+.02,.05,'sine',.025);}
  else if(kind==='bump'){tone(780,t,.06,'triangle',.05);tone(310,t,.1,'sine',.025);}
  else if(kind==='tick'||kind==='hoof')tone(kind==='tick'?620:155,t,.055,'triangle',.035);
  else if(kind==='beat'){tone(125,t,.14,'sine',.045);tone(550,t+.025,.04,'triangle',.018);}
  else if(kind==='boost'){[200,360,620,900].forEach((hz,i)=>tone(hz,t+i*.04,.15,'sine',.027));}
  else if(kind==='shuffle'||kind==='scan'||kind==='water'){[330,470,660].forEach((hz,i)=>tone(hz,t+i*.025,.09,'sine',.028));}
  else if(kind==='tension'){[196,220,196,247].forEach((hz,i)=>tone(hz,t+i*.15,.18,'triangle',.027));}
  else if(kind==='reveal'){[523,659,784,1047].forEach((hz,i)=>tone(hz,t+i*.08,.28,'sine',.055));}
 }
 function tickGame(show){
  brand=show?.brandId||brand;
  if(enabled&&!muted&&!paused&&context?.state==='running'&&['lobby','pause','opening'].includes(show?.scene)&&!show.paused){const beat=Math.floor(context.currentTime/2);if(beat!==lastMusic){lastMusic=beat;const chords=brand==='milo'?[[220,329.63,523.25],[196,293.66,493.88],[174.61,261.63,440],[164.81,246.94,392]]:brand==='rocco'?[[261.63,329.63,493.88],[220,329.63,392],[174.61,261.63,329.63],[196,293.66,440]]:[[261.63,329.63,392],[220,261.63,329.63],[174.61,220,261.63],[196,246.94,293.66]];const chord=chords[beat%4];chord.forEach((hz,i)=>tone(hz,context.currentTime+i*.18,1.8,'sine',.05,musicBus));}}

  if(show?.scene!=='minigame'||show.gameStage?.type!=='minigame'){gameKey='';gameTime=-1;return;}
  const s=show.gameStage,key=s.playId||`${s.result.id}:${s.result.minigame}`,age=show.age||0;
  if(key!==gameKey){gameKey=key;gameCues=gameEvents(s);gameTime=age>.3?age-.02:-1;}
  if(show.paused||paused)return;
  // Drop missed/old beats after a seek or stalled frame. A paused scene never
  // starts a timer and a repeated snapshot never replays the same event.
  if(!show.reducedMotion)for(const e of gameCues)if(e.time>gameTime&&e.time<=age&&age-e.time<.25)gameSound(e.kind);
  gameTime=Math.max(gameTime,age);
 }
 function meter(a){if(!a)return 0;const bytes=new Uint8Array(a.fftSize);a.getByteTimeDomainData(bytes);return Math.min(1,Math.sqrt(bytes.reduce((s,n)=>s+((n-128)/128)**2,0)/bytes.length)*3);}
 return {get programStream(){return programDestination?.stream||null;},setMuted(v){muted=!!v;gain();},setLevels(v){levels={...levels,...v};gain();},get meters(){return {effects:meter(effectMeter),music:meter(musicMeter)};},unlock,cue,tickGame,stop,pause(){paused=true;stop();},resume(){paused=false;unlock();},setEnabled(value){enabled=!!value;if(!enabled)stop();gain();},setVolume(value){volume=Math.max(0,Math.min(1,value));gain();},duck(value){if(ducked!==!!value){ducked=!!value;gain();}},dispose(){stop();for(const track of programDestination?.stream?.getTracks?.()||[])track.stop();context?.close().catch(()=>{});}};
}
