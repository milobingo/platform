import React,{useEffect,useRef,useState} from 'react';
import {ArrowUpRight,Camera,Clock,Eye,Hand,Music,Pause,Play,Plus,RotateCcw,Sparkles,Square,VolumeX,WandSparkles} from 'lucide-react';
import {SHOW_CUES,MOTION_CUES} from '../server/show-cues.js';
import {MAGIC_CUES as MAGIC_MOMENTS} from '../server/magic-cues.js';
import {Button,Badge,Stage} from './components.jsx';
import {getShowRuntime} from './show-runtime.js';
import './show-cues.css';

const magicCards=MAGIC_MOMENTS.map(c=>({...c,kind:'magic'}));
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
 const cue=(s.stage.showCue?SHOW_CUES:s.stage.movement?MOTION_CUES:MAGIC_MOMENTS).find(c=>c.id===active.id),duration=active.duration||cue?.duration||1,elapsed=Math.min(duration,active.elapsed||0),paused=active.paused??s.stage.paused,returning=active.returnAt!==undefined;
 return <div className="sc-active" role="region" aria-label="Actief showmoment"><div className="sc-active-title"><span className={'sc-live-dot '+(paused?'paused':'')}/><div><small>{active.source==='rundown'?'VANUIT HET DRAAIBOEK':'SHOWMOMENT ACTIEF'}</small><strong>{cue?.title||'Beweging'}</strong></div><span>{time(duration-elapsed)}<small>resterend</small></span></div><progress aria-label="Voortgang showmoment" max={duration} value={elapsed}/><div className="sc-active-actions"><span>{returning?'Milo keert rustig terug naar zijn desk':paused?'Moment gepauzeerd':'Keert na afloop vanzelf terug'}</span><Button icon={paused?Play:Pause} onClick={()=>run(()=>engine.pause(!paused))} aria-label={paused?'Showmoment hervatten':'Showmoment pauzeren'}>{paused?'Hervat':'Pauze'}</Button><Button icon={Square} disabled={returning} onClick={()=>run(()=>engine.stopShowCue())} aria-label="Stop showmoment">{active.id==='studio-tour'?'Terug naar desk':'Stop'}</Button></div></div>;
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
 const [filter,setFilter]=useState('all'),[query,setQuery]=useState('');
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
 const visibleCards=allCards.filter(c=>(filter==='all'||c.kind===filter)&&`${c.title} ${c.description}`.toLocaleLowerCase('nl-NL').includes(query.trim().toLocaleLowerCase('nl-NL')));
 const changeFilter=value=>{setFilter(value);const first=allCards.find(c=>(value==='all'||c.kind===value)&&`${c.title} ${c.description}`.toLocaleLowerCase('nl-NL').includes(query.trim().toLocaleLowerCase('nl-NL')));if(first)choose(first);};
 const previewActor=card.hostId||(card.kind==='magic'?'milo':previewHost);
 const previewCamera=card.shots?.filter(shot=>shot.at<=clock.elapsed).at(-1)?.camera||card.camera;
 const active=clock.started&&clock.elapsed<card.duration;
 const previewState={...s.stage,hostId:previewActor,speakerId:previewActor,guestId:null,cohostId:null,roundTitle:card.title,pattern:null,camera:previewCamera,movingCamera:clock.playing,cameraTransition:'smooth',cameraDuration:1400,motion:active?card.motion:'idle',paused:!clock.playing,speaking:false,caption:'',showCaptions:false,scene:'host',liveCall:null,call:null,show:{scene:'host',age:clock.elapsed,paused:!clock.playing,brandId:'milo'},magic:active&&card.kind==='magic'?{id:card.id,playing:true,startedAt:'preview-'+clock.instance,elapsed:clock.elapsed*1000,duration:card.duration}:null,showCue:active&&card.kind==='show'?{id:card.id,instanceId:'preview-'+clock.instance,elapsed:clock.elapsed,duration:card.duration,paused:!clock.playing,source:'preview',hostId:previewActor}:null,movement:active&&card.kind==='show'?{id:card.motion,elapsed:clock.elapsed,duration:card.duration,paused:!clock.playing}:null};
 const selectionVisible=visibleCards.some(c=>cardKey(c)===selected);
 const liveReason=reason||(!selectionVisible?'Kies eerst een moment uit de resultaten.':'')||((card.kind==='magic'||card.hostId==='milo')&&s.stage.hostId!=='milo'?'Kies Milo als live presentator voor dit moment.':'');
 const playLive=()=>run(()=>card.kind==='magic'?engine.magicMoment(card.id):engine.playShowCue(card.id));
 const add=()=>run(()=>card.kind==='magic'?getShowRuntime(engine).addMoment('magic',{title:card.title,magicId:card.id,speakerId:'milo'}):engine.addShowCue(card.id));
 return <div className="sc-library"><div className="sc-intro"><div><span className="sc-eyebrow">HET STERRENPLEIN KOMT TOT LEVEN</span><h2>Beweging & magie</h2><p>Kies links een moment. Bekijk het eerst zonder geluid en zet het daarna bewust live.</p></div><Badge tone="gold">{SHOW_CUES.length} showcues · {MAGIC_MOMENTS.length} goocheltrucs</Badge></div><ActiveCue s={s} engine={engine} run={run}/><div className="sc-library-tools"><div role="group" aria-label="Soort showmoment">{[['all','Alles',allCards.length],['magic','Goochelatelier',MAGIC_MOMENTS.length],['show','Showmomenten',SHOW_CUES.length]].map(([id,label,count])=><button type="button" key={id} aria-pressed={filter===id} onClick={()=>changeFilter(id)}>{label}<span>{count}</span></button>)}</div><label className="sc-library-search"><Eye size={15}/><input type="search" aria-label="Zoek een showmoment" placeholder="Zoek een truc of showmoment…" value={query} onChange={e=>setQuery(e.target.value)}/></label></div>{!visibleCards.length&&<p className="sc-mobile-empty" role="status">Geen momenten gevonden. Probeer een andere naam of wis je zoekopdracht.</p>}<label className="sc-mobile-picker">Moment voor de voorvertoning<select aria-label="Moment voor de voorvertoning" value={visibleCards.some(c=>cardKey(c)===selected)?selected:''} onChange={e=>{const next=visibleCards.find(c=>cardKey(c)===e.target.value);if(next)choose(next);}}><option value="" disabled>{visibleCards.length?'Kies een moment':'Geen momenten gevonden'}</option>{visibleCards.map(c=><option key={cardKey(c)} value={cardKey(c)}>{c.title} · {c.duration} sec</option>)}</select></label><div className="sc-library-layout"><div className="sc-card-grid" role="group" aria-label="Kies een showmoment">{visibleCards.map((c,i)=><button type="button" className={'sc-card '+(selected===cardKey(c)?'selected':'')} key={cardKey(c)} aria-pressed={selected===cardKey(c)} onClick={()=>choose(c)}><span className="sc-card-art" style={{'--magic-color':c.color||'#a782be'}}><img src={'/assets/milo-friends/studio/show-cues/'+(c.art||c.id)+'.webp'} onError={e=>{e.currentTarget.onerror=null;e.currentTarget.src='/assets/milo-friends/studio/sterrenplein-grand-preview.webp';}} alt=""/><span>{c.kind==='magic'?<WandSparkles size={14}/>:<Sparkles size={14}/>} {c.kind==='magic'?'Magie':'Showcue'}</span><small><Clock size={11}/>{time(c.duration)}</small></span><span className="sc-card-copy"><b>{c.title}</b><small>{c.description}</small><em><Eye size={13}/>{selected===cardKey(c)?'Geselecteerd':'Bekijk het moment'}</em></span></button>)}{!visibleCards.length&&<div className="sc-no-results"><Sparkles size={28}/><strong>Dat moment heeft zich verstopt.</strong><p>Probeer een andere naam of bekijk alle trucs.</p><button type="button" onClick={()=>{setQuery('');changeFilter('all');}}>Toon alle momenten</button></div>}</div><aside className="sc-preview"><header><span><Eye size={16}/>STILLE VOORVERTONING</span><Badge tone="gray">Niet live</Badge></header><Stage state={previewState}/><div className="sc-preview-transport"><button type="button" className="sc-preview-play" aria-label={clock.playing?'Voorbeeld pauzeren':'Voorbeeld afspelen'} onClick={()=>clock.playing?setClock(c=>({...c,playing:false})):clock.started&&clock.elapsed<card.duration?setClock(c=>({...c,playing:true})):replay()}>{clock.playing?<Pause size={17}/>:<Play size={17}/>}</button><input type="range" aria-label="Tijdpositie voorbeeld" min="0" max={card.duration} step=".1" value={clock.elapsed} onInput={e=>setClock(c=>({...c,elapsed:Number(e.target.value),playing:false,started:true}))}/><span>{time(clock.elapsed)} / {time(card.duration)}</span><button type="button" aria-label="Voorbeeld opnieuw afspelen" onClick={replay}><RotateCcw size={16}/></button></div><div className="sc-preview-copy"><span className="sc-preview-label"><VolumeX size={13}/>Alleen dit voorbeeld beweegt · zonder geluid</span><h3>{card.title}</h3><p>{card.description}</p>{card.kind==='magic'&&<div className="sc-magic-phases" aria-label="Opbouw van de goocheltruc">{Object.entries(card.phases).map(([id,[start,end]])=><span key={id} className={clock.started&&clock.elapsed>=start&&clock.elapsed<end?'active':''} style={{flexGrow:end-start}}><i/><small>{({prepare:'Klaarzetten',suspense:'Spanning',reveal:'Onthulling',settle:'Afronding'})[id]}</small></span>)}</div>}<div className="sc-cue-facts"><span><Camera size={14}/>Geregisseerd shot</span><span><Music size={14}/>{card.sound===null?'Zonder verplichte jingle':'Jingle bij live starten'}</span></div>{card.kind==='show'&&!card.hostId&&<label className="sc-preview-character">Personage in het voorbeeld<select value={previewHost} onChange={e=>{setPreviewHost(e.target.value);setClock(c=>({...c,playing:false,started:false,elapsed:0}));}}>{s.characters.filter(c=>c.id!=='vlampie').map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}<div className="sc-live-choice"><span>LIVE PRESENTATOR</span><strong>{s.characters.find(c=>c.id===s.stage.hostId)?.name||'Milo'}</strong><Button icon={Play} kind="primary" disabled={!!liveReason} onClick={playLive}>Start dit moment live</Button><Button icon={Plus} disabled={locked||!selectionVisible} onClick={add}>Aan draaiboek toevoegen</Button>{liveReason&&<small className="sc-reason" role="status">{liveReason}</small>}{locked&&<small>Stop de repetitie of open de showvoorbereiding om het draaiboek te bewerken.</small>}</div></div></aside></div><GestureControls s={s} engine={engine} run={run}/></div>;
}
