import React from 'react';
import {CheckCircle2,Music,RefreshCw,Volume2} from 'lucide-react';
import {Button} from './components.jsx';

export default function ShowAudioPreparation({s,operator,run}){
 if(s.production!=='milo'||s.demo||s.game.cancelledAt||s.game.status==='finished')return null;
 const audio=s.audioPreparation||{phase:'idle',ready:0,total:0},output=operator.bridge?.latest?.output?.audioPreparation;
 const outputReady=!!operator.bridge?.connected&&!!audio.fingerprint&&output?.fingerprint===audio.fingerprint&&output.ready===audio.total&&output.total===audio.total;
 return <section className="mf-audio-preparation" aria-label="Audio voorbereiden">
  <div><Volume2 size={20}/><strong>Showaudio staat vooraf klaar</strong></div>
  <p role={audio.phase==='error'?'alert':'status'}>{audio.phase==='ready'?<><CheckCircle2 size={16}/> Alle {audio.total} vaste stemfragmenten zijn ingeladen in de regie.</>:audio.phase==='error'?audio.error:audio.phase==='loading'?`Audio voorbereiden… ${audio.ready} van ${audio.total||'…'} fragmenten ingeladen.`:!s.apiStatus?.configured?'Stel de centrale OpenAI-koppeling in om de vaste showaudio automatisch voor te bereiden.':'De audio wordt automatisch voorbereid zodra deze show is geladen.'}</p>
  {audio.phase==='loading'&&<progress aria-label="Voortgang audiovoorbereiding" value={audio.ready} max={Math.max(1,audio.total)}/>}
  {audio.phase==='error'&&<Button icon={RefreshCw} onClick={()=>run(()=>operator.prepareShowAudio())}>Audio opnieuw voorbereiden</Button>}
  <p className="mf-audio-detail">Nummeroproepen, vaste spelteksten, korte publieksreacties en alle beschikbare draaiboekteksten worden automatisch klaargezet. De eerste voorbereiding kan enkele minuten duren. Eerder gemaakte fragmenten worden hergebruikt; alleen nieuwe teksten of gewijzigde stemmen worden opnieuw gemaakt.</p>
  {audio.fingerprint&&<p role="status">{outputReady?'Ook alle vaste audio in het uitzendvenster is ingeladen.':s.outputPreparation?.connected?`Audio in het uitzendvenster laden… ${output?.fingerprint===audio.fingerprint?output.ready:0} van ${audio.total}.`:'Open het uitzendvenster om de audio daar ook vooraf in te laden.'}</p>}
  <label className="mf-audio-music"><Music size={18}/><input type="checkbox" checked={s.backgroundMusic!==false} onChange={e=>operator.setBackgroundMusic(e.target.checked)}/><span>Zachte achtergrondmuziek tijdens de show</span></label>
  {s.backgroundMusic!==false&&<label className="mf-audio-music-volume">Muziekvolume<input aria-label="Volume achtergrondmuziek" type="range" min="0" max="50" value={operator.bridge?.mixer?.music??25} onChange={e=>operator.setMix('music',Number(e.target.value))}/></label>}
  <small>De muziek zakt onder de presentator en stopt bij een pauze of onderbreking. Korte grapjes krijgen alleen ruimte wanneer de volgende bal op tijd kan komen.</small>
 </section>;
}
