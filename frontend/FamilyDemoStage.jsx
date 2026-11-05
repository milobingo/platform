import React,{useState} from 'react';
import {Pause,Play,Sparkles} from 'lucide-react';
import './family-demo-stage.css';

export default function FamilyDemoStage({game,visual}){
 const [playing,setPlaying]=useState(true),latest=game.state.drawn.at(-1),goal=game.state.goal,presenter=game.brandId==='vlampie'?'Vlampie':game.brandId==='rocco'?'Rocco':'Milo',deskName=game.brandId==='vlampie'?"Vlampie’s Bingo":game.brandId==='rocco'?'Rocco Royale':'Milo & Friends';
 return <section className={'fam-demo-video '+(playing?'is-playing':'is-paused')} aria-label="Gesimuleerde studio-uitzending">
  <img className="fam-demo-stage-backdrop" src={visual.backdrop} alt=""/>
  <div className="fam-demo-stage-glow" aria-hidden="true"/>
  <header className="fam-demo-video-meta"><span><Sparkles size={12}/> VOORBEELDUITZENDING</span><span>{goal?.round||'Ronde 2'} · {game.state.drawn.length} ballen</span></header>
  <div className="fam-demo-stage-prompt"><span>{presenter.toUpperCase()} PRESENTEERT</span><strong>Spelen met<br/>een beetje magie!</strong><p>Heb jij nummer {latest} al gevonden?</p></div>
  <img className="fam-demo-host" src={visual.mascot} alt={presenter+' in de voorbeeldstudio'}/>
  <div className="fam-demo-stage-desk"><span>{deskName}</span><strong>BingoShow</strong></div>
  <div className="fam-demo-stage-ball" aria-label={'Laatste voorbeeldnummer '+latest}><small>DE LAATSTE BAL</small><strong>{latest}</strong></div>
  <button type="button" className="fam-demo-stage-play" aria-label={playing?'Voorbeeldanimatie pauzeren':'Voorbeeldanimatie afspelen'} onClick={()=>setPlaying(value=>!value)}>{playing?<Pause size={13}/>:<Play size={13}/>}<span>Animatie · zonder geluid</span></button>
 </section>;
}
