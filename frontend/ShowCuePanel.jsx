import React,{useEffect,useRef,useState} from 'react';
import {ArrowUpRight,Camera,Clock,Eye,Hand,Music,Pause,Play,Plus,RotateCcw,Sparkles,Square,VolumeX,WandSparkles} from 'lucide-react';
import {SHOW_CUES,MOTION_CUES} from '../server/show-cues.js';
import {MAGIC_MOMENTS} from '../public/mf-studio.js';
import {Button,Badge,Stage} from './components.jsx';
import {getShowRuntime} from './show-runtime.js';
import './show-cues.css';

const magicCards=MAGIC_MOMENTS.map(c=>({...c,kind:'magic',camera:'magic',motion:'magic',description:c.id==='star-hat'?'Milo laat zijn hoed zweven en tovert een gouden ster tevoorschijn.':'Zijden linten volgen Milo’s hand en veranderen in een fonkelende vlinder.'}));
const allCards=[...SHOW_CUES.map(c=>({...c,kind:'show'})),...magicCards];
const cardKey=c=>c.kind+':'+c.id;
const time=value=>`${Math.max(0,Math.ceil(Number(value)||0))} sec`;

export function cueBlockReason(s,engine){
 if(s.working)return 'Even wachten op de vorige actie.';
 if(engine.calls?.held||engine.liveCalls?.onAir||engine.liveCalls?.switchingLive||engine.director?.callHold||s.game.state.callId)return 'Rond eerst het actieve gesprek af.';
 if(s.game.state.window?.status==='open')return 'Het meldvenster blijft open. Wacht tot de controle klaar is.';
 if(s.game.state.resultId)return 'Presenteer eerst de bevestigde uitslag.';
 if(s.game.state.pending||engine.director?.flow?.kind==='draw'||engine.director?.pending!=null)return 'De lopende nummertrekking wordt eerst afgerond.';
 if(s.voicePhase!=='idle')return 'Wacht tot de huidige uitspraak klaar is.';
 if(s.showRuntime?.manual)return 'Zet eerst de presentator terug in beeld.';
 if(s.stage.magic)return 'Laat het magiemoment eerst afronden.';
 if(s.stage.showCue||s.stage.movement)return 'Rond het actieve moment af voordat je een nieuw moment start.';
 if(engine.director?.flow&&!engine.director.paused||['sync','sync-error','round-intro','round-prize'].includes(s.runner.phase))return 'Pauzeer het draaiboek voor een los showmoment.';
 return '';
}

export function ActiveCue({s,engine,run}){
 const manualMagic=s.stage.magic?.manual?{...s.stage.magic,elapsed:(s.stage.magic.elapsed||0)/1000,source:'manual'}:null,active=s.stage.showCue||s.stage.movement||manualMagic;
 if(!active)return null;
 const cue=(s.stage.showCue?SHOW_CUES:s.stage.movement?MOTION_CUES:MAGIC_MOMENTS).find(c=>c.id===active.id),duration=active.duration||cue?.duration||1,elapsed=Math.min(duration,active.elapsed||0),paused=active.paused??s.stage.paused;
 return <div className="sc-active" role="region" aria-label="Actief showmoment"><div className="sc-active-title"><span className={'sc-live-dot '+(paused?'paused':'')}/><div><small>{active.source==='rundown'?'VANUIT HET DRAAIBOEK':'SHOWMOMENT ACTIEF'}</small><strong>{cue?.title||'Beweging'}</strong></div><span>{time(duration-elapsed)}<small>resterend</small></span></div><progress aria-label="Voortgang showmoment" max={duration} value={elapsed}/><div className="sc-active-actions"><span>{paused?'Moment gepauzeerd':'Keert na afloop vanzelf terug'}</span><Button icon={paused?Play:Pause} onClick={()=>run(()=>engine.pause(!paused))} aria-label={paused?'Showmoment hervatten':'Showmoment pauzeren'}>{paused?'Hervat':'Pauze'}</Button><Button icon={Square} onClick={()=>run(()=>engine.stopShowCue())} aria-label="Stop showmoment">Stop</Button></div></div>;
}

export function GestureControls({s,engine,run,compact=false}){
 if(s.production!=='milo')return null;
 const reason=cueBlockReason(s,engine);
 return <div className={'sc-gestures '+(compact?'compact':'')}><div className="sc-mini-heading"><span><Hand size={16}/>Gebaren van de presentator</span><small>Rustig in · rustig uit</small></div><div className="sc-gesture-grid">{MOTION_CUES.map(c=><button type="button" key={c.id} disabled={!!reason} onClick={()=>run(()=>engine.setMotion(c.id))} aria-pressed={s.stage.movement?.id===c.id}><b>{c.title}</b><small>{time(c.duration)}</small></button>)}</div></div>;
}

export function ShowCueQuick({s,engine,run}){
 if(s.production!=='milo')return null;
 const reason=cueBlockReason(s,engine);
 return <section className="sc-quick" aria-label="Beweging en showmomenten"><header><div><span className="sc-eyebrow">ÉÉN KNOP, EEN COMPLEET MOMENT</span><h3><Sparkles size={18}/>Beweging & magie</h3></div><a href="#/library">Bekijk alle momenten<ArrowUpRight size={14}/></a></header><ActiveCue s={s} engine={engine} run={run}/><div className="sc-quick-grid">{SHOW_CUES.filter(c=>['welcome-wave','applause','dance','star-shower'].includes(c.id)).map(c=><button type="button" key={c.id} disabled={!!reason} onClick={()=>run(()=>engine.playShowCue(c.id))}><span className={'sc-quick-orb effect-'+c.effect}><Sparkles size={20}/></span><span><b>{c.title}</b><small>{time(c.duration)} · beeld & jingle</small></span><Play size={14}/></button>)}</div>{reason&&!s.stage.showCue&&!s.stage.movement&&<p className="sc-reason" role="status">{reason}</p>}<GestureControls s={s} engine={engine} run={run} compact/></section>;
}

// Local preview owns its clock. Selecting, scrubbing and replaying never calls
// the engine, the audio mixer, a provider or the programme output bridge.
export default function ShowCuePanel({s,engine,run}){
 const [selected,setSelected]=useState('show:welcome-wave'),[previewHost,setPreviewHost]=useState(s.stage.hostId),[clock,setClock]=useState({elapsed:0,playing:false,started:false,instance:0});
 const clockRef=useRef(clock);clockRef.current=clock;
 const card=allCards.find(c=>cardKey(c)===selected)||allCards[0],reason=cueBlockReason(s,engine),locked=s.game.status!=='draft'&&!s.demo||s.runner.active;
 useEffect(()=>{setPreviewHost(s.stage.hostId);setClock({elapsed:0,playing:false,started:false,instance:0});},[s.game.id,s.production]);
 useEffect(()=>{
  if(!clock.playing)return;
  let frame=0,last=performance.now(),paint=last;
  const tick=now=>{const dt=Math.min(.1,Math.max(0,(now-last)/1000));last=now;const current=clockRef.current,next=Math.min(card.duration,current.elapsed+dt);clockRef.current={...current,elapsed:next,playing:next<card.duration};if(now-paint>=33||next>=card.duration){paint=now;setClock({...clockRef.current});}if(next<card.duration)frame=requestAnimationFrame(tick);};
  frame=requestAnimationFrame(tick);return()=>cancelAnimationFrame(frame);
 },[clock.playing,clock.instance,selected,card.duration]);
 if(s.production!=='milo')return null;
 const choose=c=>{setSelected(cardKey(c));setClock({elapsed:0,playing:false,started:false,instance:clock.instance+1});};
 const replay=()=>setClock(c=>({elapsed:0,playing:true,started:true,instance:c.instance+1}));
 const previewActor=card.kind==='magic'?'milo':previewHost;
 const previewCamera=card.shots?.filter(shot=>shot.at<=clock.elapsed).at(-1)?.camera||card.camera;
 const active=clock.started&&clock.elapsed<card.duration;
 const previewState={...s.stage,hostId:previewActor,speakerId:previewActor,guestId:null,cohostId:null,camera:previewCamera,movingCamera:clock.playing,cameraTransition:'smooth',cameraDuration:1400,motion:active?card.motion:'idle',paused:!clock.playing,speaking:false,caption:'',showCaptions:false,scene:'host',liveCall:null,call:null,show:{scene:'host',age:clock.elapsed,paused:!clock.playing,brandId:'milo'},magic:active&&card.kind==='magic'?{id:card.id,playing:true,startedAt:'preview-'+clock.instance,elapsed:clock.elapsed*1000}:null,showCue:active&&card.kind==='show'?{id:card.id,instanceId:'preview-'+clock.instance,elapsed:clock.elapsed,duration:card.duration,paused:!clock.playing,source:'preview',hostId:previewActor}:null,movement:active&&card.kind==='show'?{id:card.motion,elapsed:clock.elapsed,duration:card.duration,paused:!clock.playing}:null};
 const liveReason=reason||(card.kind==='magic'&&s.stage.hostId!=='milo'?'Kies Milo als live presentator voor zijn goocheltrucs.':'');
 const playLive=()=>run(()=>card.kind==='magic'?engine.magicMoment(card.id):engine.playShowCue(card.id));
 const add=()=>run(()=>card.kind==='magic'?getShowRuntime(engine).addMoment('magic',{title:card.title,magicId:card.id,speakerId:'milo'}):engine.addShowCue(card.id));
 return <div className="sc-library"><div className="sc-intro"><div><span className="sc-eyebrow">HET STERRENPLEIN KOMT TOT LEVEN</span><h2>Kleine gebaren. Grote showmomenten.</h2><p>Bekijk de beweging, kies je moment en zet het bewust live. Met een eigen camera, licht en een korte jingle.</p></div><Badge tone="gold">8 showcues · 2 goocheltrucs</Badge></div><ActiveCue s={s} engine={engine} run={run}/><div className="sc-library-layout"><div className="sc-card-grid" aria-label="Kies een showmoment">{allCards.map((c,i)=><button type="button" className={'sc-card '+(selected===cardKey(c)?'selected':'')} key={cardKey(c)} aria-pressed={selected===cardKey(c)} onClick={()=>choose(c)}><span className="sc-card-art"><img src={'/assets/milo-friends/studio/show-cues/'+c.id+'.webp'} onError={e=>{e.currentTarget.onerror=null;e.currentTarget.src='/assets/milo-friends/studio/sterrenplein-grand-preview.webp';}} alt=""/><span>{c.kind==='magic'?<WandSparkles size={14}/>:<Sparkles size={14}/>} {c.kind==='magic'?'MILO’S MAGIE':'SHOWCUE '+String(i+1).padStart(2,'0')}</span><small><Clock size={11}/>{time(c.duration)}</small></span><span className="sc-card-copy"><b>{c.title}</b><small>{c.description}</small><em><Eye size={13}/>{selected===cardKey(c)?'Geselecteerd':'Bekijk het moment'}</em></span></button>)}</div><aside className="sc-preview"><header><span><Eye size={16}/>STILLE VOORVERTONING</span><Badge tone="gray">Niet live</Badge></header><Stage state={previewState}/><div className="sc-preview-transport"><button type="button" className="sc-preview-play" aria-label={clock.playing?'Voorbeeld pauzeren':'Voorbeeld afspelen'} onClick={()=>clock.playing?setClock(c=>({...c,playing:false})):clock.started&&clock.elapsed<card.duration?setClock(c=>({...c,playing:true})):replay()}>{clock.playing?<Pause size={17}/>:<Play size={17}/>}</button><input type="range" aria-label="Tijdpositie voorbeeld" min="0" max={card.duration} step=".1" value={clock.elapsed} onChange={e=>setClock(c=>({...c,elapsed:Number(e.target.value),playing:false,started:true}))}/><span>{time(clock.elapsed)} / {time(card.duration)}</span><button type="button" aria-label="Voorbeeld opnieuw afspelen" onClick={replay}><RotateCcw size={16}/></button></div><div className="sc-preview-copy"><span className="sc-preview-label"><VolumeX size={13}/>Alleen dit voorbeeld beweegt · zonder geluid</span><h3>{card.title}</h3><p>{card.description}</p><div className="sc-cue-facts"><span><Camera size={14}/>Geregisseerd shot</span><span><Music size={14}/>Jingle bij live starten</span></div>{card.kind==='show'&&<label className="sc-preview-character">Personage in het voorbeeld<select value={previewHost} onChange={e=>{setPreviewHost(e.target.value);setClock(c=>({...c,playing:false,started:false,elapsed:0}));}}>{s.characters.filter(c=>c.id!=='vlampie').map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}<div className="sc-live-choice"><span>LIVE PRESENTATOR</span><strong>{s.characters.find(c=>c.id===s.stage.hostId)?.name||'Milo'}</strong><Button icon={Play} kind="primary" disabled={!!liveReason} onClick={playLive}>Start dit moment live</Button><Button icon={Plus} disabled={locked} onClick={add}>Aan draaiboek toevoegen</Button>{liveReason&&<small className="sc-reason" role="status">{liveReason}</small>}{locked&&<small>Stop de repetitie of open de showvoorbereiding om het draaiboek te bewerken.</small>}</div></div></aside></div><GestureControls s={s} engine={engine} run={run}/></div>;
}
