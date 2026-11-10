import React,{useEffect,useRef,useState} from 'react';
import {Copy,Monitor,RefreshCw,ShieldCheck} from 'lucide-react';
import {Button,Field,Panel} from './components.jsx';

async function requestAccess(gameId,body){
 const response=await fetch('/api/obs/access'+(body?'':'?gameId='+encodeURIComponent(gameId)),{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',headers:body?{'Content-Type':'application/json','X-Milo-OBS-Manage':'1'}:{},...(body?{body:JSON.stringify({...body,gameId})}:{}),signal:AbortSignal.timeout(15000)});
 const data=await response.json();if(!response.ok)throw Error(data.error?.message||'De OBS-link kon niet worden beheerd. Probeer opnieuw.');
 if(data.gameId!==gameId||data.requestedGameId!==gameId||typeof data.configured!=='boolean'||data.currentAccessId!==null&&typeof data.currentAccessId!=='string'||data.activeGameId!==null&&typeof data.activeGameId!=='string'||data.configured&&(!data.currentAccessId||!Number.isFinite(new Date(data.expiresAt).getTime())))throw Error('De OBS-link hoort niet bij de geselecteerde show. Laad opnieuw.');
 return data;
}
const expiry=value=>value?new Intl.DateTimeFormat('nl-NL',{dateStyle:'medium',timeStyle:'short',timeZone:'Europe/Amsterdam'}).format(new Date(value)):'';
export default function ObsSourceSettings({s,request=requestAccess,onConnect,preparation=false,entryLabel='OBS-link beheren',copyLabel='OBS-link kopiëren'}){
 const [state,setState]=useState(null),[opened,setOpened]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[url,setUrl]=useState(''),[copied,setCopied]=useState(false),[confirm,setConfirm]=useState(null),[sending,setSending]=useState(false);
 const epoch=useRef(0),lock=useRef(false),gameId=s.game.id,current=useRef(gameId);current.current=gameId;
 useEffect(()=>{epoch.current++;lock.current=false;setState(null);setOpened(false);setBusy(false);setError('');setUrl('');setCopied(false);setConfirm(null);setSending(false);return()=>{epoch.current++;};},[gameId,s.demo]);
 const perform=async(action)=>{
  if(s.demo||lock.current)return;const id=gameId,token=++epoch.current;lock.current=true;setBusy(true);setError('');setCopied(false);if(action)setUrl('');
  try{
   const data=await request(id,action?{action,expectedAccessId:state?.currentAccessId??null}:undefined);
   if(token!==epoch.current||current.current!==id)return;
   const {configured,expiresAt,expired,currentAccessId,activeGameId}=data;setState({configured,gameId:id,expiresAt,expired:expired===true,currentAccessId:currentAccessId??null,activeGameId});setOpened(true);setConfirm(null);
   if(action==='create'){
    if(!/^[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/.test(data.token||''))throw Error('De nieuwe OBS-link is niet bevestigd. Maak opnieuw een link.');
    setUrl(location.origin+'/uitzending#obs='+data.token);
   }else setUrl('');
  }catch(e){if(token===epoch.current&&current.current===id)setError(e.message||'De OBS-link is niet bevestigd.');}
  finally{if(token===epoch.current){lock.current=false;setBusy(false);}}
 };
 const mutate=action=>{if(state?.configured)setConfirm(action);else void perform(action);};
 const connect=async()=>{if(s.demo||s.dirty||s.working||lock.current||!onConnect)return;const token=++epoch.current,id=gameId;lock.current=true;setBusy(true);setError('');try{await onConnect(id);if(token===epoch.current&&id===current.current)setSending(true);}catch(e){if(token===epoch.current)setError(e.message||'Het regiebeeld kon niet worden verbonden.');}finally{if(token===epoch.current){lock.current=false;setBusy(false);}}};
 const copy=async()=>{const token=epoch.current,id=gameId;try{await navigator.clipboard.writeText(url);if(token===epoch.current&&id===current.current)setCopied(true);}catch{if(token===epoch.current)setError('Kopiëren is niet toegestaan. Selecteer en kopieer de link uit het veld.');}};
 return <Panel title={preparation?"OBS-link voor deze show":"OBS-browserbron"} subtitle="Beeld en geluid voor de gekozen show."><div className="mf-editor-content mf-obs-settings">
  <p>OBS heeft een eigen browser. Maak hier een aparte uitzendlink; aanmelden met Google in OBS is dan niet nodig.</p>
  {s.demo?<p>Sla eerst een show op om een OBS-link te maken.</p>:<>
   {onConnect&&<><Button icon={Monitor} disabled={busy||s.working||s.dirty} onClick={()=>void connect()}>Beeld naar OBS sturen</Button>{sending&&<p role="status">Het regiebeeld wordt naar OBS gestuurd. Houd deze regiepagina open.</p>}{s.dirty&&<p>Sla eerst de wijzigingen van deze show op.</p>}</>}
   {!opened?<Button icon={Monitor} disabled={busy} onClick={()=>void perform()}>{entryLabel}</Button>:<>
    <p className="mf-obs-status">{state?.configured?(state.activeGameId&&state.activeGameId!==gameId?'Er is een actieve OBS-link voor een andere show. Een nieuwe link vervangt die toegang.':state.expired?'De vorige OBS-link is verlopen.':`OBS-link actief${state.expiresAt?' tot '+expiry(state.expiresAt):''}.`):'Er is nog geen actieve OBS-link voor deze show.'}</p>
    <div className="mf-obs-actions"><Button icon={ShieldCheck} disabled={busy} onClick={()=>mutate('create')}>{state?.configured?'Nieuwe OBS-link maken':'OBS-link maken'}</Button>{state?.configured&&<Button disabled={busy} onClick={()=>mutate('revoke')}>OBS-link intrekken</Button>}<Button icon={RefreshCw} disabled={busy} onClick={()=>void perform()}>Status vernieuwen</Button></div>
    {confirm&&<div className="mf-obs-confirm" role="group" aria-label="OBS-link wijzigen bevestigen"><p>{confirm==='revoke'?'De huidige OBS-browserbron verliest direct toegang.':'Een nieuwe link vervangt de huidige link. De huidige OBS-browserbron verliest direct toegang.'}</p><Button disabled={busy} onClick={()=>void perform(confirm)}>Bevestigen</Button><Button disabled={busy} onClick={()=>setConfirm(null)}>Annuleren</Button></div>}
    {url&&<><Field label="OBS-browserbron URL" hint="Deze link geeft toegang tot het uitzendbeeld en geluid van deze show. Deel hem alleen met de persoon die OBS bedient."><input value={url} readOnly autoComplete="off" spellCheck={false} onFocus={e=>e.target.select()}/></Field><Button icon={Copy} onClick={()=>void copy()}>{copied?'OBS-link gekopieerd':copyLabel}</Button></>}
   </>}
   {busy&&<p role="status">OBS-link controleren…</p>}{error&&<p role="alert">{error}</p>}
  </>}
  <ol><li>Kies <strong>{preparation?'Open uitzendvenster':'Beeld naar OBS sturen'}</strong> en houd de regiepagina open.</li><li>Voeg in OBS een <strong>Browserbron</strong> toe en plak de gemaakte link. Kies <strong>1920 × 1080</strong> en zet <strong>Audio beheren via OBS</strong> aan.</li><li>Controleer beeld en geluid en kies in de live regie geluid via het uitzendvenster. Als geluid niet vanzelf start, kies <strong>OBS → Bronnen → rechtsklik → Interactie → Beeld & geluid activeren</strong>.</li></ol>
  <small>Een link is zeven dagen geldig. Het gewone uitzendvenster blijft beschikbaar voor je aangemelde regiebrowser.</small>
 </div></Panel>;
}
