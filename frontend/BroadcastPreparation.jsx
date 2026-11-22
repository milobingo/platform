import React,{useEffect,useRef,useState} from 'react';
import {CheckCircle2,Monitor,RefreshCw,Volume2} from 'lucide-react';
import {Button,Panel} from './components.jsx';
import ObsSourceSettings from './ObsSourceSettings.jsx';
import ProgramBroadcastSettings from './ProgramBroadcastSettings.jsx';

/** Preparation only: none of these controls starts, resumes or releases a game. */
export default function BroadcastPreparation({s,bridge,onPrepare,onOpenOutput,onTestSound}){
 const [busy,setBusy]=useState(''),[error,setError]=useState(''),[played,setPlayed]=useState(false),[mixerChecked,setMixerChecked]=useState(false),[recordChecked,setRecordChecked]=useState(false);
 const gameId=s.game.id,current=useRef(gameId),epoch=useRef(0),lock=useRef(false);current.current=gameId;
 const status=s.outputPreparation||bridge?.preparationStatus||{},connected=status.gameId===gameId&&status.connected,audioActivated=status.gameId===gameId&&status.audioActivated;
 useEffect(()=>{epoch.current++;lock.current=false;setBusy('');setError('');setPlayed(false);setMixerChecked(false);setRecordChecked(false);return()=>{epoch.current++;};},[gameId]);
 useEffect(()=>{setPlayed(false);setMixerChecked(false);setRecordChecked(false);},[audioActivated,status.testId]);
 const run=async(kind,action)=>{if(lock.current||s.demo)return;const id=gameId,attempt=++epoch.current;lock.current=true;setBusy(kind);setError('');if(kind==='sound'){setPlayed(false);setMixerChecked(false);setRecordChecked(false);}
  try{await action();if(attempt!==epoch.current||id!==current.current)return;if(kind==='sound')setPlayed(true);}
  catch(e){if(attempt===epoch.current&&id===current.current)setError(e.message||'De uitzending kon niet worden getest. Probeer opnieuw.');}
  finally{if(attempt===epoch.current){lock.current=false;setBusy('');}}
 };
 const prepare=async()=>{await onPrepare?.(gameId);};
 const open=()=>void run('open',()=>onOpenOutput?.(gameId));
 const sound=()=>void run('sound',async()=>{await prepare();if(onTestSound)await onTestSound(gameId);else if(bridge)await bridge.testSound();else throw Error('Open de regie opnieuw om het testgeluid af te spelen.');});
 const disabled=!!busy||s.working||s.demo;
 return <Panel title="Uitzending testen" subtitle="Verbind het beeld, activeer geluid en controleer daarna OBS."><div className="mf-editor-content mf-broadcast-preparation">
  {s.demo?<p>Maak een show om het uitzendvenster en OBS te verbinden.</p>:<>
   <div className="mf-obs-actions"><Button icon={Monitor} disabled={disabled} onClick={open}>Open uitzendvenster</Button><Button icon={Volume2} disabled={disabled} onClick={sound}>{busy==='sound'?'Testgeluid afspelen…':'Speel testgeluid'}</Button>{!connected&&<Button icon={RefreshCw} disabled={disabled} onClick={()=>void run('connect',prepare)}>Opnieuw verbinden</Button>}</div>
   <ol className="mf-broadcast-checks">
    <li><strong>1. Verbinding met regie</strong><p role="status">{connected?'Verbonden met deze show. Houd de regiepagina open.':'Open het uitzendvenster om deze show te verbinden.'}</p></li>
    <li><strong>2. Audio in het uitzendvenster</strong><p role="status">{(played||audioActivated&&status.testPlayed)&&connected?'Geluid afgespeeld.':audioActivated?'Geluid in het uitzendvenster geactiveerd.':'De OBS-browserbron activeert beeld en geluid automatisch zodra de regie verbonden is. Open je de link in een gewone browser en blokkeert die geluid? Kies daar Beeld & geluid activeren.'}</p></li>
    <li><strong>3. Controle in OBS</strong><p>{mixerChecked&&recordChecked?'OBS door jou gecontroleerd: mixer én proefopname.':'Controleer zelf de OBS-mixer en maak een korte proefopname met beeld en testgeluid.'}</p><label><input type="checkbox" checked={mixerChecked} disabled={!audioActivated||!connected} onChange={e=>{setMixerChecked(e.target.checked);if(!e.target.checked)setRecordChecked(false);}}/> Ik zie het testgeluid in de OBS-mixer.</label><label><input type="checkbox" checked={recordChecked} disabled={!mixerChecked} onChange={e=>setRecordChecked(e.target.checked)}/> Ik heb een korte proefopname met beeld en geluid teruggekeken.</label>{mixerChecked&&recordChecked&&<span className="mf-broadcast-confirmed"><CheckCircle2 size={16}/> Door jou bevestigd</span>}</li>
   </ol>
   {busy&&busy!=='sound'&&<p role="status">Uitzendvenster verbinden…</p>}{error&&<p role="alert">{error}</p>}
   <ObsSourceSettings s={s} preparation entryLabel="Kopieer OBS-link" copyLabel="Kopieer OBS-link"/>
   <ProgramBroadcastSettings s={s}/>
  </>}
  <details><summary>Browserbron in OBS</summary><p>Voeg een Browserbron toe met de OBS-link, stel <strong>1920 × 1080</strong> in en zet <strong>Audio beheren via OBS</strong> aan. Beeld en geluid worden automatisch geactiveerd zodra de regie verbonden is; bij een tijdelijke onderbreking verbindt de bron vanzelf opnieuw. Je hoeft niet in de bron te klikken.</p><p>Kies <strong>Speel testgeluid</strong> in de regie. Controleer de meter van deze bron in de OBS-mixer en luister een korte proefopname met beeld en testgeluid terug. Alleen die controle bevestigt dat OBS geluid ontvangt.</p><p>Blokkeert jouw browser of OBS-installatie automatisch afspelen? Gebruik als eenmalige terugvalroute <strong>OBS → Bronnen → rechtsklik → Interactie → Beeld & geluid activeren</strong>. Controleer daarna opnieuw met het testgeluid.</p></details>
  <details><summary>Vensteropname in OBS</summary><p>Open de OBS-link in een aparte browsertoepassing, zonder regie- of backstagetabs, en activeer daar Beeld & geluid. Voeg dit venster in OBS toe via Bronnen → + → Vensteropname. Leg voor audio uitsluitend die uitzendbrowser vast via Toepassingsaudio vastleggen; zet algemene desktopaudio uit. Gebruik de Browserbron als audio per toepassing niet beschikbaar is. Controleer de mixer en luister een korte proefopname terug.</p></details>
 </div></Panel>;
}
