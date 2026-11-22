import React,{useEffect,useRef,useState} from 'react';
import {Radio,Copy,RefreshCw,Cast} from 'lucide-react';
import {Button} from './components.jsx';
import {programBroadcastRequest} from './program-broadcast-api.js';
import './program-broadcast.css';

const phase={waiting:'Wachten op OBS',live:'Programma ontvangt beeld en geluid',ended:'Uitzending gestopt',reconnecting:'Uitzendbron wordt hersteld'};

/** Optional per-show route. It never starts/resumes drawing or alters a rundown. */
export default function ProgramBroadcastSettings({s}){
 const [open,setOpen]=useState(false),[status,setStatus]=useState(null),[credentials,setCredentials]=useState(null),[busy,setBusy]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const generation=useRef(0),requestIds=useRef(new Map()),id=s.game.id;
 useEffect(()=>{generation.current++;requestIds.current.clear();setStatus(null);setCredentials(null);setBusy('');setError('');setNotice('');return()=>{generation.current++;};},[id]);
 useEffect(()=>{
  if(!open||s.demo||s.game.brandId!=='milo')return;
  const abort=new AbortController();let pending=false;
  const refresh=async()=>{if(pending)return;pending=true;try{const data=await programBroadcastRequest(id,'status',{signal:abort.signal});if(!abort.signal.aborted)setStatus(data);}catch(cause){if(!abort.signal.aborted)setError(cause.message);}finally{pending=false;}};
  void refresh();const timer=setInterval(()=>void refresh(),6000);return()=>{abort.abort();clearInterval(timer);};
 },[id,open,s.demo,s.game.brandId]);
 if(s.game.brandId!=='milo'||s.demo)return null;
 const run=async(action)=>{
  if(busy)return;
  if(action==='stop'&&!globalThis.confirm('De rechtstreekse uitzending en tv-feed stoppen? De show en trekking worden hiermee niet gestopt.'))return;
  const current=generation.current;setBusy(action);setError('');setNotice('');
  if(!requestIds.current.has(action))requestIds.current.set(action,crypto.randomUUID());
  try{
   const data=await programBroadcastRequest(id,'control',{body:{action,requestId:requestIds.current.get(action)}});if(current!==generation.current)return;
   requestIds.current.delete(action);setStatus(data.status||data);
   if(action==='prepare'&&data.whip)setCredentials({whip:data.whip,encoder:data.encoder});
   if(action==='stop')setCredentials(null);
   setNotice(action==='prepare'?'Eigen uitzendroute staat klaar. Verbind OBS met de gegevens hieronder.':action==='start-hls'?'Tv-feed is aangevraagd. Cast en AirPlay worden beschikbaar zodra de liveplaylist is bevestigd.':action==='stop-hls'?'Tv-feed gestopt. Rechtstreekse WebRTC-kijkers blijven verbonden.':'Eigen uitzending gestopt. De spelstand blijft bewaard.');
  }catch(cause){if(current===generation.current)setError(cause.message);}
  finally{if(current===generation.current)setBusy('');}
 };
 const copy=async value=>{try{await navigator.clipboard.writeText(value);setNotice('Gekopieerd. Plaats dit alleen in je eigen OBS-uitvoer.');}catch{setError('Kopiëren lukte niet. Selecteer het veld en kopieer het handmatig.');}};
 const configured=status?.providerConfigured===true,terminal=s.game.status==='finished';
 return <details className="mf-program-broadcast-settings" open={open} onToggle={event=>setOpen(event.currentTarget.open)}><summary><Radio size={16}/> Rechtstreeks uitzenden & tv</summary>
  <p>OBS levert één programmabeeld en één audiomix aan de eigen uitzendserver. Gezinnen kijken op de showpagina. Privégesprekken en fluisteraudio horen uitsluitend in de aparte belverbinding.</p>
  {status?<div className="mf-program-status" role="status"><p><strong>{status.enabled?phase[status.state]||'Uitzendroute geselecteerd':configured?'Eigen uitzendserver beschikbaar':'Eigen uitzendserver nog niet ingesteld'}</strong></p>{status.enabled&&<p>WebRTC: {status.state==='live'?'programmabeeld ontvangen':'wachten op programmabeeld'} · Tv-feed: {status.hls?.available?'beschikbaar voor Cast en AirPlay':'nog niet beschikbaar'}</p>}{!configured&&<p>Laat de serverbeheerder de eigen LiveKit-, Ingress- en tv-feedconfiguratie voor deze omgeving aansluiten. Dit vraagt geen nieuw streamingabonnement.</p>}</div>:<p role="status">Uitzendinstellingen ophalen…</p>}
  <div className="mf-obs-actions"><Button icon={Radio} disabled={!configured||!!busy||terminal} onClick={()=>void run('prepare')}>{busy==='prepare'?'OBS-uitvoer voorbereiden…':status?.enabled?'OBS-gegevens ophalen':'Eigen uitzending voorbereiden'}</Button><Button icon={Cast} disabled={!configured||!!busy||terminal||status?.state!=='live'||status?.hls?.available} onClick={()=>void run('start-hls')}>{busy==='start-hls'?'Tv-feed starten…':'Start tv-feed'}</Button>{status?.hls?.available&&<Button disabled={!!busy} onClick={()=>void run('stop-hls')}>Stop tv-feed</Button>}{status?.enabled&&status?.state!=='ended'&&<Button disabled={!!busy} onClick={()=>void run('stop')}>Stop eigen uitzending</Button>}<Button icon={RefreshCw} disabled={!!busy} onClick={()=>void programBroadcastRequest(id,'status').then(setStatus).catch(cause=>setError(cause.message))}>Status vernieuwen</Button></div>
  {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
  {credentials&&<section className="mf-program-credentials" aria-label="Beschermde OBS-uitvoer"><strong>OBS → Instellingen → Stream → WHIP</strong><p>Deze gegevens geven publicatierechten op alleen deze show. Deel ze niet met kijkers. Ze worden niet in de browseropslag bewaard.</p><label>WHIP-server<input readOnly value={credentials.whip.url} autoComplete="off" spellCheck={false}/></label><Button icon={Copy} onClick={()=>void copy(credentials.whip.url)}>Kopieer WHIP-server</Button><label>WHIP-bearertoken<input type="password" readOnly value={credentials.whip.bearerToken} autoComplete="off" spellCheck={false}/></label><Button icon={Copy} onClick={()=>void copy(credentials.whip.bearerToken)}>Kopieer bearertoken</Button><p>Profiel: {credentials.encoder?.width} × {credentials.encoder?.height} · {credentials.encoder?.fps} fps · H.264/Opus · video {Math.round((credentials.encoder?.videoBitrate||0)/1000)} kbit/s · audio {Math.round((credentials.encoder?.audioBitrate||0)/1000)} kbit/s · keyframe elke {credentials.encoder?.keyframeSeconds} seconden. Er is één kwaliteitsprofiel; geen onbewezen lagere laag.</p><Button onClick={()=>setCredentials(null)}>Gegevens verbergen</Button></section>}
  <details><summary>Bron, geluid en doorgaan bij gesloten regie</summary><p>Houd OBS en het uitzendvenster dat OBS opneemt geopend. De verbinding OBS → eigen uitzendserver blijft bestaan als alleen de regietab sluit. Het bestaande uitzendvenster kan voor nieuwe showcues wel afhankelijk blijven van de regie; controleer de herstelstatus vóór hervatten. De server houdt de spelstand en blokkades vast.</p><p>Zend alleen de Program-mix uit. Algemene desktopaudio, privéregie en backstage horen niet in de OBS-mixer. Live zetten van een beller blijft een aparte bewuste regieactie.</p><p>Start de tv-feed nadat OBS echt beeld en geluid publiceert. Controleer daarna op een fysieke tv het livepunt, leesbare cijfers, geluid en de vertraging. Een groene verbinding is geen bewijs van afspelen op tv.</p></details>
 </details>;
}
