import React,{useEffect,useState} from 'react';
import {createPortal} from 'react-dom';
import {Ear,Send,LockKeyhole,CheckCircle2,Clock,AlertCircle,RotateCcw,Square,Sparkles,Volume2} from 'lucide-react';
import {Button,Modal} from './components.jsx';
import './director-whisper.css';

const phaseNames={idle:'Nog niet verstuurd',preparing:'Wordt voorbereid',prepared:'Reactie klaar voor jouw controle',queued:'Wacht op een geschikt moment',speaking:'Presentator spreekt',completed:'Uitspraak afgerond',accepted:'Ontvangen in de live sessie',failed:'Niet afgeleverd',cancelled:'Geannuleerd',uncertain:'Ontvangst onbevestigd'};
const suggestions=[
 ['Rustiger praten','Neem rustig de tijd en spreek wat kalmer, met korte natuurlijke pauzes.'],
 ['Meer spanning','Bouw op een vrolijke manier wat spanning op. Vraag de kinderen of ze klaarzitten, zonder een nummer of winnaar te verzinnen.'],
 ['Makkelijke vraag','Stel één vriendelijke, makkelijke vraag over een favoriete kleur of hobby. Verzin geen persoonlijke gegevens.'],
 ['Vriendelijk afronden','Rond het huidige praatje vriendelijk af en bedank de luisteraar. Kondig geen nieuwe trekking of prijs aan.']
];

export default function DirectorWhisper({s,engine}){
 const [open,setOpen]=useState(false),[draft,setDraft]=useState(''),[localError,setLocalError]=useState('');
 const state=s.whisper||engine.whispers?.snapshot?.()||{phase:'idle',busy:false};
 const activeCharacter=s.characters.find(c=>c.id===s.stage.hostId),target=state.target||{name:activeCharacter?.name||'de presentator',characterId:s.stage.hostId};
 const targetName=target.name||s.characters.find(c=>c.id===target.characterId)?.name||'de presentator';
 const call=engine.liveCalls?.call,callerKey=JSON.stringify([call?.id,call?.entryId,call?.profileId,call?.context?.callName,call?.context?.pronunciation,call?.phase==='live']);
 const count=[...draft].length,ready=!!engine.whispers&&draft.trim().length>0&&count<=500&&!state.busy;
 const matchesPrepared=draft.trim()===state.instruction?.trim();
 useEffect(()=>{setDraft('');setLocalError('');},[s.game.id,s.production,s.stage.hostId,target.callId,target.callName,target.live,callerKey]);
 const send=async()=>{if(!ready)return;setLocalError('');try{await engine.whispers.send(draft.trim());}catch(e){setLocalError(e.message||'De aanwijzing kon niet worden verstuurd.');}};
 const retry=async()=>{setLocalError('');try{await engine.whispers.retry();}catch(e){setLocalError(e.message||'Probeer het later opnieuw.');}};
 const statusName=state.simulated&&state.phase==='completed'?'Simulatie afgerond':phaseNames[state.phase]||phaseNames.idle;
 const hasState=state.phase!=='idle',problem=['failed','uncertain'].includes(state.phase);
 return <>
  <button type="button" className="dw-trigger" aria-label={'Fluister naar '+targetName} title="Privé regieaanwijzing aan de presentator" onClick={()=>setOpen(true)}><Ear size={14}/><span>Fluisteren</span>{state.busy&&<i aria-label="Aanwijzing in behandeling"/>}</button>
  {open&&createPortal(<Modal title={'Fluister naar '+targetName} onClose={()=>setOpen(false)}>
   <div className="dw-panel">
    <div className="dw-target"><span><Ear size={22}/></span><div><small>REGIE → PRESENTATOR</small><strong>{targetName}</strong><p>{target.live?'Aanwijzing voor het actieve live gesprek':'Eerst een reactievoorstel. Jij kiest wanneer het mag klinken.'}</p></div><b>{state.simulated||s.demo?'DEMO':'PRIVÉ'}</b></div>
    <p className="dw-privacy"><LockKeyhole size={16}/><span>Deze aanwijzing wordt niet rechtstreeks als chat, ondertiteling of regie-audio doorgestuurd. De presentator kan er wel hoorbaar op reageren.</span></p>
    <label className="dw-field"><span>Wat wil je de presentator meegeven?</span><textarea aria-label="Privé regieaanwijzing" value={draft} maxLength={500} rows={4} onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();void send();}}} placeholder="Bijvoorbeeld: bouw rustig spanning op en vraag of iedereen klaarzit."/><small><span>Een aanwijzing, geen tekst die letterlijk wordt voorgelezen.</span><b>{count} / 500</b></small></label>
    <div className="dw-suggestions" role="group" aria-label="Voorbeelden van regieaanwijzingen">{suggestions.map(([label,text])=><button type="button" key={label} onClick={()=>setDraft(text)} disabled={state.busy}><Sparkles size={12}/>{label}</button>)}</div>
    {(localError||state.error)&&<div className="dw-error" role="alert"><AlertCircle size={16}/><span>{localError||state.error}</span></div>}
    <div className="dw-actions">{state.canResume?<Button kind="primary" icon={Volume2} onClick={()=>engine.whispers.resume()}>Stem vrijgeven</Button>:state.canApply&&matchesPrepared?<Button kind="primary" icon={Volume2} onClick={()=>engine.whispers.apply()}>Laat reactie uitspreken</Button>:<Button kind="primary" icon={Send} disabled={!ready} onClick={send}>{state.busy?'In behandeling…':state.canApply?'Verwerk nieuwe aanwijzing':'Fluister in'}</Button>}{(state.busy||state.canApply)&&<Button icon={Square} onClick={()=>engine.whispers.cancel()}>{target.live?'Stop wachten':state.canApply?'Voorstel wegleggen':'Annuleren'}</Button>}</div>
    {(state.simulated||s.demo)&&<p className="dw-demo"><Sparkles size={14}/>Voorbeeldmodus: geen OpenAI-aanvraag, audio of echte aflevering. De reactie wordt alleen hier getoond.</p>}
    {hasState&&<section className={'dw-status '+(problem?'problem':'')} aria-label="Status van de regieaanwijzing" aria-live="polite"><header>{problem?<AlertCircle size={17}/>:state.busy?<Clock size={17}/>:<CheckCircle2 size={17}/>}<strong>{statusName}</strong></header><p>{state.message||state.waitReason||''}</p>{state.waitReason&&state.message!==state.waitReason&&<small>{state.waitReason}</small>}{state.phase==='prepared'&&<small>Controleer dit voorstel. Pas met ‘Laat reactie uitspreken’ komt het na de huidige uitspraak aan bod. Een bingomelding, uitslag of actief showmoment blijft voorgaan.</small>}{state.phase==='accepted'&&<small>Dit bevestigt ontvangst in de sessie, niet dat de aanwijzing al is opgevolgd of uitgesproken.</small>}{state.reply&&<div className="dw-reply"><span>{state.simulated?'VOORBEELDREACTIE':'REACTIE VAN DE PRESENTATOR'}</span><p>{state.reply}</p></div>}{state.canRetry&&<Button icon={RotateCcw} onClick={retry}>Opnieuw proberen</Button>}</section>}
   </div>
  </Modal>,document.body)}
 </>;
}
