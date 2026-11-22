import React,{useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {Cast,Volume2,VolumeX,RefreshCw,Monitor,Airplay} from 'lucide-react';
import './program-broadcast.css';

const phaseText={waiting:'De uitzending begint zo',connecting:'Verbinden met de studio…',reconnecting:'Verbinding wordt hersteld…',disconnected:'Uitzendverbinding onderbroken',ended:'Bedankt voor het meespelen',suspended:'Uitzending stil tijdens je belmoment'};
const castText={idle:'Cast niet verbonden',connecting:'Tv zoeken…',waiting:'Wachten op beeld op tv…',playing:'Cast speelt op tv',paused:'Cast gepauzeerd',buffering:'Cast laadt beeld…',stopping:'Cast stoppen…',error:'Cast niet bevestigd'};
const airplayText={idle:'AirPlay niet verbonden',preparing:'AirPlay voorbereiden…',ready:'Kies je AirPlay-apparaat',connecting:'AirPlay verbinden…',playing:'AirPlay speelt op tv',stopping:'Kies iPhone/iPad om te stoppen',error:'AirPlay niet bevestigd'};

export default function ProgramBroadcast({controller,gameId,title,config}){
 const container=useRef(),[help,setHelp]=useState(false),[actionError,setActionError]=useState(''),state=useSyncExternalStore(controller.subscribe,controller.getSnapshot);
 useEffect(()=>controller.mount(container.current,{gameId,title,config}),[controller,gameId,title]);
 useEffect(()=>controller.configure(config),[controller,config]);
 const run=action=>{setActionError('');try{void Promise.resolve(action()).catch(error=>setActionError(error.message));}catch(error){setActionError(error.message);}};
 const remote=state.castActive||state.airplayActive,airplaySupported=typeof controller.airplay?.webkitShowPlaybackTargetPicker==='function';
 return <div className="fam-program-player" data-phase={state.phase} aria-label="Rechtstreekse showuitzending">
  <div ref={container} className="fam-program-media"/>
  {state.phase!=='live'&&!remote&&<div className="fam-program-message" role="status"><Monitor size={25}/><strong>{phaseText[state.phase]||'Wachten op de uitzending'}</strong>{state.phase==='reconnecting'&&<small>Je kaart en spelstand blijven bewaard.</small>}</div>}
  {remote&&<div className="fam-program-tv-message" role="status"><Cast size={24}/><strong>{state.castActive?castText[state.castPhase]:airplayText[state.airplayPhase]}</strong><small>Je telefoon blijft beschikbaar voor je kaart en chat.</small></div>}
  {config.hls?.available&&<div className="fam-program-route-status" role="status"><span>{castText[state.castPhase]}</span>{airplaySupported&&<span>{airplayText[state.airplayPhase]}</span>}</div>}
  <div className="fam-program-controls">
   {!remote&&<button type="button" onClick={()=>run(()=>state.muted?controller.activateAudio():controller.mute())} disabled={state.suspended||state.phase==='ended'}>{state.muted?<VolumeX size={16}/>:<Volume2 size={16}/>}<span>{state.muted?'Geluid aanzetten':'Geluid uitzetten'}</span></button>}
   {['disconnected','reconnecting'].includes(state.phase)&&<button type="button" onClick={()=>run(()=>controller.connect())}><RefreshCw size={16}/><span>Opnieuw verbinden</span></button>}
   {state.castActive?<button type="button" disabled={state.castPhase==='stopping'} onClick={()=>run(()=>controller.stopCast())}><Cast size={16}/><span>Stop casten</span></button>:<button type="button" disabled={!config.hls?.available||state.suspended||state.airplayActive||['connecting','waiting','stopping'].includes(state.castPhase)} onClick={()=>run(()=>controller.startCast())} title={config.hls?.available?'Kies een Chromecast of Google TV':'De regie heeft de tv-feed nog niet gestart'}><Cast size={16}/><span>Cast naar tv</span></button>}
   {airplaySupported&&<button type="button" disabled={!config.hls?.available||state.suspended&&!state.airplayActive||state.castActive||state.airplayPhase==='preparing'} onClick={()=>run(()=>state.airplayActive?controller.stopAirPlay():state.airplayPrepared?controller.showAirPlayPicker():controller.prepareAirPlay())}><Airplay size={16}/><span>{state.airplayActive?'Stop AirPlay':state.airplayPrepared?'Kies AirPlay-apparaat':'AirPlay voorbereiden'}</span></button>}
   <button type="button" aria-expanded={help} onClick={()=>setHelp(value=>!value)}><Monitor size={16}/><span>Tv-hulp</span></button>
  </div>
  {(actionError||state.error||state.castError||state.airplayError)&&<p className="fam-program-feedback" role="status">{actionError||state.castError||state.airplayError||state.error}</p>}
  {help&&<div className="fam-program-help"><button type="button" aria-label="Tv-hulp sluiten" onClick={()=>setHelp(false)}>×</button><strong>De show op je tv</strong><p>Chromecast/Google TV: open deze pagina in Chrome, verbind telefoon en tv met hetzelfde netwerk en kies Cast naar tv. iPhone/iPad: gebruik Safari en kies eerst AirPlay voorbereiden en daarna je apparaat.</p><p>Geen directe tv-optie? Gebruik Scherm spiegelen in het bedieningspaneel van je apparaat. Controleer zelf of beeld én geluid op de tv afspelen.</p>{!config.hls?.available&&<p>De tv-feed is nog niet gestart. Rechtstreeks kijken op deze pagina blijft beschikbaar zodra de studio uitzendt.</p>}<small>{castText[state.castPhase]} · {airplayText[state.airplayPhase]}</small></div>}
  <span className="fam-sr-only" role="status">{state.muted&&!remote?'Geluid op dit apparaat staat uit.':''} {castText[state.castPhase]}. {airplayText[state.airplayPhase]}.</span>
 </div>;
}

/** Do not list actual draws here: that would already reveal unheard TV balls. */
export function ProgramTvBoard({game,onHeard}){
 const [number,setNumber]=useState(''),[error,setError]=useState('');
 useEffect(()=>{setNumber('');setError('');},[game?.id,game?.state?.roundIndex]);
 return <form className="fam-tv-board-sync" onSubmit={event=>{event.preventDefault();const value=Number(number);if(!(game?.state?.drawn||[]).includes(value)){setError('Dit nummer is nog niet officieel getoond in deze ronde. Controleer wat je op tv hoorde.');return;}onHeard({key:game.id+':'+game.state.roundIndex,number:value});setError('');}}><div><strong>Je ballenbord volgt wat je op tv hebt gehoord.</strong><p>Tv kan iets achterlopen. Vul de laatst gehoorde bal in om het bord bij te werken; nieuwe servernummers verschijnen hier niet alvast.</p></div><label>Laatst gehoorde bal<input type="number" min="1" max="75" step="1" inputMode="numeric" value={number} onChange={event=>setNumber(event.target.value)} required/></label><button type="submit" className="fam-button secondary">Bord bijwerken</button>{error&&<p role="alert">{error}</p>}</form>;
}
