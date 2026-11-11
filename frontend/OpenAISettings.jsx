import React,{useEffect,useRef,useState} from 'react';
import {KeyRound,RefreshCw,Save,Mic,ShieldCheck,Power,RotateCcw} from 'lucide-react';
import {Badge,Button,Panel,Field} from './components.jsx';
import {apiJSON} from '../public/openai-voice.js';

export default function OpenAISettings({s,engine,request=apiJSON}){
 const [status,setStatus]=useState(null),[key,setKey]=useState(''),[busy,setBusy]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState(''),[confirm,setConfirm]=useState('');
 const alive=useRef(true),epoch=useRef(0),locked=useRef(false);
 const accept=data=>{
  if(typeof data?.configured!=='boolean'||typeof data?.canManage!=='boolean')throw Error('De OpenAI-instellingen konden niet volledig worden geladen.');
  const safe={...data};for(const name of ['key','apiKey','apiSecret','OPENAI_API_KEY'])delete safe[name];
  setStatus(safe);
  if(engine){engine.apiStatus=safe;engine.emit?.();}
 };
 const load=async()=>{
  if(locked.current)return;
  const token=++epoch.current;setBusy('load');setError('');
  try{const data=await request('status',undefined,AbortSignal.timeout(15000));if(alive.current&&token===epoch.current){accept(data);setKey('');}}
  catch(e){if(alive.current&&token===epoch.current)setError(e.message||'De centrale koppeling kon niet worden geladen.');}
  finally{if(alive.current&&token===epoch.current)setBusy('');}
 };
 useEffect(()=>{alive.current=true;void load();return()=>{alive.current=false;epoch.current++;};},[]);
 const perform=async action=>{
  if(locked.current||busy||!status)return;
  locked.current=true;setBusy(action);setError('');setNotice('');setConfirm('');const token=++epoch.current;
  try{
   const route=action==='live-test'?'live-test':action==='test'&&!status.canManage?'test':'settings';
   const result=await request(route,route==='settings'?{action,revision:status.revision??null,...(action==='save'?{key:key.trim()}:{})}:{},AbortSignal.timeout(45000));
   if(!alive.current||token!==epoch.current)return;
   if(action==='save')setKey('');
   const next=await request('status',undefined,AbortSignal.timeout(15000));
   if(alive.current&&token===epoch.current){accept(next);setNotice(result.message||(action==='save'?'Sleutel versleuteld opgeslagen. Test nu de opgeslagen koppeling.':action==='remove'?'De OpenAI-koppeling is uitgeschakeld.':action==='environment'?'De serverinstellingen worden weer gebruikt.':'De serververbinding is gecontroleerd.'));}
  }catch(e){
   if(alive.current&&token===epoch.current&&action==='test'){
    setStatus(previous=>previous?{...previous,connectionTest:{tested:false,testedAt:null}}:previous);
    try{const next=await request('status',undefined,AbortSignal.timeout(15000));if(alive.current&&token===epoch.current)accept({...next,connectionTest:{tested:false,testedAt:next.connectionTest?.testedAt||null}});}catch{}
   }
   if(alive.current&&token===epoch.current)setError(e.message||'De wijziging is niet bevestigd. Herlaad de instellingen.');
  }
  finally{locked.current=false;if(alive.current&&token===epoch.current)setBusy('');}
 };
 const configured=!!status?.configured,canManage=status?.canManage===true,tested=status?.connectionTest?.tested===true;
 return <Panel title="Globale OpenAI-koppeling" subtitle="Eén gedeelde sleutel voor alle producties." action={<Badge tone={tested?'green':configured?'purple':'amber'} dot>{tested?'Sleutel gecontroleerd':configured?'Sleutel aanwezig · nog testen':'Nog niet ingesteld'}</Badge>}>
  <div className="mf-editor-content">
   <div className="mf-key-visual"><span><KeyRound size={27}/></span><div><h3>{s?.production==='vlampie'?'Eén sleutel. Vlampies eigen stem.':'Eén sleutel. Twaalf eigen stemmen.'}</h3><p>Beheer de centrale OpenAI-sleutel hier. Ieder personage behoudt zijn eigen stemprofiel en karakterboek.</p></div></div>
   {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
   {!status?<div><p>{busy?'Instellingen laden…':'De instellingen zijn niet beschikbaar.'}</p>{!busy&&<Button icon={RefreshCw} onClick={load}>Opnieuw laden</Button>}</div>:<>
    <p>{status.disabled?'De koppeling is bewust uitgeschakeld. Je kunt een sleutel opslaan of teruggaan naar de serverinstellingen.':status.source==='environment'?'De huidige koppeling gebruikt de serverinstellingen. Je kunt hieronder een eigen sleutel voor deze omgeving opslaan.':status.source==='regie'?'De koppeling wordt vanuit deze regie beheerd.':'Er is nog geen centrale OpenAI-koppeling ingesteld.'}</p>
    {canManage?<form onSubmit={e=>{e.preventDefault();void perform('save');}} autoComplete="off">
     <Field label="OpenAI API-sleutel" hint={configured?'Een sleutel is aanwezig en wordt nooit teruggestuurd. Vul alleen iets in om hem te vervangen.':'De sleutel wordt versleuteld op de server opgeslagen.'}>
      <input type="password" value={key} onChange={e=>{setKey(e.target.value);setNotice('');}} placeholder={configured?'Opgeslagen · vul een nieuwe sleutel in om te vervangen':'sk-…'} autoComplete="new-password" spellCheck={false} maxLength={512} required disabled={!!busy}/>
     </Field>
     <Button type="submit" icon={Save} disabled={!!busy||!key.trim()}>{busy==='save'?'Veilig opslaan…':'Sleutel veilig opslaan'}</Button>
    </form>:<p>De beveiligde instellingenopslag is niet beschikbaar. De aanwezige koppeling kan wel worden getest.</p>}
    {status.connectionTest?.testedAt&&<p>Laatste sleutelcontrole: {new Date(status.connectionTest.testedAt).toLocaleString('nl-NL',{dateStyle:'medium',timeStyle:'short'})} · {tested?'bevestigd':'niet bevestigd'}. Beluister apart de stemproef voor het geluid.</p>}
    <div className="mf-editor-actions">
     <Button icon={RefreshCw} disabled={!!busy||!configured||!!key.trim()} onClick={()=>perform('test')}>{busy==='test'?'Verbinding testen…':'Test verbinding'}</Button>
     <Button icon={Mic} disabled={!!busy||!configured||!!key.trim()} onClick={()=>perform('live-test')}>Test GPT-Live-toegang</Button>
     <Button icon={RefreshCw} kind="text" disabled={!!busy} onClick={load}>Herlaad</Button>
    </div>
    {canManage&&<div className="mf-editor-actions">
     {configured&&<Button icon={Power} kind="text" disabled={!!busy} onClick={()=>setConfirm('remove')}>Koppeling uitschakelen</Button>}
     {(status.source==='regie'||status.disabled)&&status.environmentConfigured&&<Button icon={RotateCcw} kind="text" disabled={!!busy} onClick={()=>setConfirm('environment')}>Serverinstellingen gebruiken</Button>}
    </div>}
    {confirm&&<div className="mf-tip" role="group" aria-label="Wijziging van de OpenAI-koppeling bevestigen"><p>{confirm==='remove'?'De OpenAI-koppeling voor alle producties uitschakelen?':'De opgeslagen sleutel loslaten en de serverinstellingen gebruiken?'}</p><Button disabled={!!busy} onClick={()=>perform(confirm)}>Bevestigen</Button><Button kind="text" onClick={()=>setConfirm('')}>Annuleren</Button></div>}
   </>}
   <div className="mf-tip"><ShieldCheck size={20}/><p>Opslaan start geen provideroproep. Test de verbinding bewust en beluister daarna de stem bij het personage. Tijdens een belmoment of onzekere audio-opruiming blijven wijzigingen geblokkeerd.</p></div>
  </div>
 </Panel>;
}
