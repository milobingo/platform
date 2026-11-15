import React,{useEffect,useId,useRef,useState} from 'react';
import {CheckCircle2,RefreshCw} from 'lucide-react';
import {Button,Field,Panel} from './components.jsx';
import {normalizeYoutubeId} from '../server/broadcast-settings.js';
import './broadcast-settings.css';

/** Show-bound operational metadata; never saves a plan or unlocks game rules. */
export default function BroadcastSettings({s,engine,delay=650}){
 const game=s.game,id=game.id,serverId=game.settings.youtubeId||'',revision=game.broadcastRevision||0;
 const editable=!s.demo&&!game.cancelledAt&&['draft','running'].includes(game.status),helpId=useId();
 const [input,setInput]=useState(serverId),[phase,setPhase]=useState('saved'),[error,setError]=useState(''),[conflict,setConflict]=useState(false);
 const current=useRef({id,input:serverId,version:0,edited:false,base:revision,known:{youtubeId:serverId,revision},locked:false,retry:null,alive:true});
 const state=current.current;state.input=input;state.editable=editable;
 useEffect(()=>{current.current.alive=true;return()=>{current.current.alive=false;};},[]);
 useEffect(()=>{
  const value=current.current;if(revision<value.known.revision)return;
  value.known={youtubeId:serverId,revision};
  if(value.locked)return;
  let desired;try{desired=normalizeYoutubeId(value.input);}catch{}
  if(!value.edited||desired===serverId){value.edited=false;value.base=revision;value.retry=null;setInput(serverId);setPhase('saved');setError('');setConflict(false);}
  else if(revision>value.base){setPhase('error');setConflict(true);setError('De uitzending is in een ander venster gewijzigd. Je invoer blijft bewaard. Controleer de opgeslagen uitzending voordat je opnieuw probeert.');}
 },[id,serverId,revision]);
 const save=async(manual=false)=>{
  const value=current.current;if(!value.alive||!value.editable||value.locked||!value.edited)return;
  let youtubeId;try{youtubeId=normalizeYoutubeId(value.input);}catch(cause){setPhase('error');setError(cause.message);setConflict(false);return;}
  if(youtubeId===value.known.youtubeId){value.edited=false;value.retry=null;value.base=value.known.revision;setInput(youtubeId);setPhase('saved');setError('');setConflict(false);return;}
  if(manual&&conflict){value.base=value.known.revision;value.retry=null;}
  const payload=value.retry?.youtubeId===youtubeId?value.retry:{gameId:id,youtubeId,expectedBroadcastRevision:value.base,requestId:crypto.randomUUID()},version=value.version;
  value.retry=payload;value.locked=true;setPhase('saving');setError('');
  try{
   const response=await engine.saveBroadcast(payload);if(!value.alive)return;
   const confirmed=response.broadcast||{youtubeId:response.game.settings.youtubeId||'',revision:response.game.broadcastRevision||0};value.known=confirmed;value.base=confirmed.revision;value.retry=null;
   if(version!==value.version){setPhase('waiting');return;}
   if(confirmed.youtubeId!==youtubeId){setConflict(true);setPhase('error');setError('De opgeslagen uitzending is intussen gewijzigd. Je invoer blijft bewaard. Controleer de opgeslagen uitzending.');return;}
   value.edited=false;setInput(confirmed.youtubeId);setPhase('saved');setConflict(false);
  }catch(cause){
   if(!value.alive)return;
   if(cause.broadcast&&cause.broadcast.revision>=value.known.revision)value.known=cause.broadcast;
   if(version!==value.version){value.retry=null;setPhase('waiting');return;}
   setConflict(cause.code==='broadcast_conflict');setPhase('error');setError(cause.message||'De uitzending is niet opgeslagen. Je invoer blijft bewaard. Probeer opnieuw.');
  }finally{value.locked=false;}
 };
 useEffect(()=>{if(phase!=='waiting'||!editable)return;const timer=setTimeout(()=>void save(),delay);return()=>clearTimeout(timer);},[input,phase,editable,delay]);
 const change=value=>{const local=current.current;if(!local.edited)local.base=local.known.revision;local.edited=true;local.version++;local.retry=null;setInput(value);setError('');setConflict(false);setPhase(local.locked?'saving':'waiting');};
 const useSaved=()=>{const local=current.current;local.edited=false;local.retry=null;local.base=local.known.revision;setInput(local.known.youtubeId);setPhase('saved');setError('');setConflict(false);};
 return <Panel title="YouTube-uitzending" subtitle="De video voor gezinnen. Dit verandert geen spelregels of spelstand."><div className="mf-editor-content mf-broadcast-settings">
  <Field label="YouTube-video-ID of link" hint={editable?'Plak de elf tekens van de video-ID of een YouTube-link. Wijzigingen worden automatisch opgeslagen.':'De opgeslagen YouTube-uitzending van deze show.'}><input value={editable?input:serverId} disabled={!editable} onChange={event=>change(event.target.value)} onBlur={()=>{if(phase==='waiting')void save();}} aria-describedby={helpId} autoComplete="off" spellCheck={false} maxLength={2048} placeholder="Bijvoorbeeld ezsA3hsxIEc of een YouTube-link"/></Field>
  {!editable?<p id={helpId} className="mf-broadcast-readonly">{s.demo?'Maak een opgeslagen show om een YouTube-uitzending te koppelen.':game.cancelledAt?'Deze show is geannuleerd. De opgeslagen uitzending blijft bewaard.':'Deze show is afgelopen. De opgeslagen uitzending blijft bewaard.'}</p>:<>
   <div id={helpId} className={'mf-broadcast-save-state '+(phase==='error'?'has-error':'')} role={phase==='error'?'alert':'status'}>{phase==='error'?<><strong>Niet opgeslagen</strong><p>{error}</p><Button icon={RefreshCw} onClick={()=>void save(true)}>Opnieuw proberen</Button>{conflict&&<><p>Nu opgeslagen: <b>{current.current.known.youtubeId||'geen uitzending'}</b>. Opnieuw proberen bewaart jouw invoer.</p><Button kind="text" onClick={useSaved}>Opgeslagen uitzending gebruiken</Button></>}</>:phase==='saved'?<><CheckCircle2 size={16}/><span>Opgeslagen{current.current.known.youtubeId?' · '+current.current.known.youtubeId:''}</span></>:<span>Opslaan…</span>}</div>
   <p className="mf-broadcast-save-help">{game.status==='running'?'Een nieuwe video opent bij gezinnen zodra hun familie-app de wijziging ontvangt. De trekking blijft ongewijzigd.':'Gezinnen zien deze video zodra de show is gestart.'} Controleer zelf dat de video ingesloten mag worden.</p>
  </>}
 </div></Panel>;
}
