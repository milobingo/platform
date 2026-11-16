import React,{useEffect,useRef,useState} from 'react';
import {RefreshCw,Save,ShieldCheck,Power,RotateCcw} from 'lucide-react';
import {Badge,Button,Field,Panel} from './components.jsx';
import './provider-settings.css';

const emptyForm={key:'',from:'',replyTo:'',deliveryMode:'disabled',allowedRecipients:''};
const recipientList=text=>[...new Set(text.split(/[\n,;]+/).map(value=>value.trim().toLowerCase()).filter(Boolean))];
export async function requestResendSettings(path,body){
 const response=await fetch(path,{method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',headers:body===undefined?{}:{'Content-Type':'application/json','X-Vlampie-Settings':'1'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(20000)});
 const result=await response.json().catch(()=>({}));
 if(!response.ok)throw Object.assign(Error(typeof result.error==='string'?result.error:result.error?.message||'De e-mailkoppeling is nog niet bevestigd.'),{status:response.status,code:result.error?.code});
 return result;
}

export default function ResendSettings({request=requestResendSettings,onChanged}){
 const [settings,setSettings]=useState(null),[form,setForm]=useState(emptyForm),[busy,setBusy]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState(''),[confirm,setConfirm]=useState('');
 const alive=useRef(true),epoch=useRef(0),locked=useRef(false);
 const accept=data=>{
  const value=data?.settings||data;
  if(typeof value?.configured!=='boolean'||typeof value?.canManage!=='boolean'||typeof value?.keyConfigured!=='boolean')throw Error('De Resend-instellingen konden niet volledig worden geladen.');
  // Only public status is retained. Stored credentials are never accepted as
  // form values, even if an unexpected server field contains key material.
  const safe={configured:value.configured,keyConfigured:value.keyConfigured,canManage:value.canManage,source:value.source,disabled:value.disabled===true,environmentConfigured:value.environmentConfigured===true,revision:value.revision??null,from:typeof value.from==='string'?value.from:'',replyTo:typeof value.replyTo==='string'?value.replyTo:'',deliveryEnabled:value.deliveryEnabled===true,deliveryMode:value.deliveryMode,route:value.route,environment:value.environment,deliveryReason:typeof value.deliveryReason==='string'?value.deliveryReason:'',allowedRecipients:Array.isArray(value.allowedRecipients)?value.allowedRecipients.filter(item=>typeof item==='string'):[],hostPolicy:value.hostPolicy?{mode:value.hostPolicy.mode,limited:value.hostPolicy.limited===true}:null,connectionTest:{tested:value.connectionTest?.tested===true,testedAt:value.connectionTest?.testedAt||null}};
  setSettings(safe);setForm({key:'',from:safe.from,replyTo:safe.replyTo,deliveryMode:safe.source==='regie'&&['disabled','allowlist','live'].includes(safe.deliveryMode)?safe.deliveryMode:'disabled',allowedRecipients:safe.source==='regie'?safe.allowedRecipients.join(', '):''});
 };
 const load=async()=>{
  if(locked.current)return;
  const token=++epoch.current;setBusy('load');setError('');setNotice('');setConfirm('');
  try{const result=await request('/api/resend/settings');if(alive.current&&token===epoch.current)accept(result);}
  catch(e){if(alive.current&&token===epoch.current)setError(e.message||'De e-mailkoppeling kon niet worden geladen.');}
  finally{if(alive.current&&token===epoch.current)setBusy('');}
 };
 useEffect(()=>{alive.current=true;void load();return()=>{alive.current=false;epoch.current++;};},[]);
 const change=(name,value)=>{setForm(previous=>({...previous,[name]:value}));setNotice('');};
 const dirty=!!settings&&(!!form.key.trim()||form.from!==settings.from||form.replyTo!==settings.replyTo||form.deliveryMode!==(settings.source==='regie'?settings.deliveryMode:'disabled')||JSON.stringify(recipientList(form.allowedRecipients))!==JSON.stringify(settings.source==='regie'?settings.allowedRecipients:[])),tested=settings?.connectionTest?.tested===true,canManage=settings?.canManage===true;
 const perform=async action=>{
  if(locked.current||busy||!settings)return;
  locked.current=true;const token=++epoch.current;setBusy(action);setError('');setNotice('');setConfirm('');
  try{
   const result=await request('/api/resend/settings',{action,revision:settings.revision,...(action==='save'?{key:form.key.trim(),from:form.from.trim(),replyTo:form.replyTo.trim(),deliveryMode:form.deliveryMode,allowedRecipients:recipientList(form.allowedRecipients)}:{})});
   if(!alive.current||token!==epoch.current)return;
   if(action==='save')setForm(previous=>({...previous,key:''}));
   accept(result);
   setNotice(action==='save'?'De Resend-koppeling is veilig opgeslagen. Test nu de opgeslagen verbinding.':action==='remove'?'De Resend-koppeling is uitgeschakeld.':action==='environment'?'De bestaande serverinstellingen worden weer gebruikt.':'Resend heeft de sleutel gecontroleerd. Er is geen testmail verstuurd en bezorging is hiermee nog niet bevestigd.');
   await onChanged?.();
  }catch(e){
   if(!alive.current||token!==epoch.current)return;
   if(action==='test'){
    // A failed new test must never leave an earlier green receipt visible.
    setSettings(previous=>previous?{...previous,connectionTest:{tested:false,testedAt:null}}:previous);
    try{const result=await request('/api/resend/settings');if(alive.current&&token===epoch.current)accept(result);}catch{}
   }
   if(alive.current&&token===epoch.current)setError(e.message||'De wijziging is niet bevestigd. Herlaad de instellingen.');
  }finally{locked.current=false;if(alive.current&&token===epoch.current)setBusy('');}
 };
 const testedAt=settings?.connectionTest?.testedAt?new Date(settings.connectionTest.testedAt).toLocaleString('nl-NL',{dateStyle:'medium',timeStyle:'short'}):null;
 return <Panel className="mf-resend-settings" title="Resend e-mailkoppeling" subtitle="Eén veilige verbinding voor showmails en nieuwsbrieven." action={<Badge tone={tested?'green':settings?.configured?'purple':'amber'}>{tested?'Sleutel gecontroleerd':settings?.configured?'Opgeslagen · nog testen':'Nog niet gekoppeld'}</Badge>}>
  <div className="mf-editor-content">
   <p>Beheer hier de mailverbinding voor Milo & Friends en Vlampie. Hun eigen templates, nieuwsbrieven en toestemmingen blijven apart.</p>
   {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
   {!settings?<div><p>{busy==='load'?'Instellingen laden…':'De instellingen zijn niet beschikbaar.'}</p>{!busy&&<Button type="button" icon={RefreshCw} onClick={load}>Opnieuw laden</Button>}</div>:<>
    <p>{settings.disabled?'De koppeling is bewust uitgeschakeld.':settings.source==='regie'?'De mailverbinding wordt vanuit deze regie beheerd.':settings.source==='environment'?'Er staan bestaande serverinstellingen klaar. Je kunt hier een eigen Resend-koppeling opslaan.':'Voeg je Resend-sleutel en geverifieerde afzenderadres toe.'}</p>
    {canManage?<form method="post" onSubmit={e=>{e.preventDefault();void perform('save');}} autoComplete="off">
     <Field label="Resend API-sleutel" hint={settings.keyConfigured?'Een sleutel is aanwezig en wordt nooit teruggestuurd. Laat leeg om hem te behouden.':'Gebruik een Resend-sleutel die de afzender mag gebruiken en domeinen mag controleren.'}><input type="password" value={form.key} onChange={e=>change('key',e.target.value)} placeholder={settings.keyConfigured?'Opgeslagen · leeg laten om te behouden':'re_…'} autoComplete="new-password" spellCheck={false} maxLength={512} required={!settings.keyConfigured} disabled={!!busy}/></Field>
     <Field label="Afzenderadres" hint="Gebruik een e-mailadres van een in Resend geverifieerd domein."><input type="email" value={form.from} onChange={e=>change('from',e.target.value)} placeholder="show@jouwdomein.nl" autoComplete="off" spellCheck={false} maxLength={254} required disabled={!!busy}/></Field>
     <Field label="Antwoordadres" hint="Optioneel. Hier komen reacties van gezinnen binnen."><input type="email" value={form.replyTo} onChange={e=>change('replyTo',e.target.value)} placeholder="organisatie@jouwdomein.nl" autoComplete="off" spellCheck={false} maxLength={254} disabled={!!busy}/></Field>
     <Field label="Verzendmodus" hint="Een sleutel opslaan zet verzending niet automatisch aan. Kies bewust welke berichten deze koppeling mag versturen."><select value={form.deliveryMode} onChange={e=>change('deliveryMode',e.target.value)} disabled={!!busy}><option value="disabled">Uit — niets versturen</option><option value="allowlist">Alleen testontvangers</option><option value="live" disabled={settings.environment!=='production'}>Live — alle toegestane showmails</option></select></Field>
     {settings.environment!=='production'&&<p>De verzending is voor deze omgeving beperkt tot opgegeven adressen.</p>}
     {form.deliveryMode==='allowlist'&&<Field label="Toegestane testadressen" hint="Maximaal 100 adressen, gescheiden door komma’s of nieuwe regels. Alleen deze adressen kunnen mail ontvangen."><textarea rows={3} value={form.allowedRecipients} onChange={e=>change('allowedRecipients',e.target.value)} placeholder="jij@jouwdomein.nl, collega@jouwdomein.nl" maxLength={26000} required disabled={!!busy}/></Field>}
     {recipientList(form.allowedRecipients).length>100&&<p role="alert">Gebruik maximaal 100 verschillende testadressen.</p>}
     {form.deliveryMode==='live'&&<p>Na opslaan mogen showmails worden verstuurd. Nieuwsbrieven blijven alleen voor aangemelde ouders en vragen hun eigen verzendbevestiging.</p>}
     {settings.hostPolicy?.limited&&<p>Voor deze omgeving geldt een aanvullende verzendbeperking. {settings.hostPolicy.mode==='disabled'?'Mailverzending blijft uit, ook als je hierboven een ruimere modus kiest.':settings.hostPolicy.mode==='allowlist'?'Alleen de vooraf vrijgegeven adressen kunnen mail ontvangen; jouw lijst kan deze groep verder beperken.':'De toegestane verzendmodus blijft van kracht.'}</p>}
     <Button type="submit" icon={Save} disabled={!!busy||!dirty||!form.from.trim()||!settings.keyConfigured&&!form.key.trim()||recipientList(form.allowedRecipients).length>100||form.deliveryMode==='allowlist'&&!recipientList(form.allowedRecipients).length}>{busy==='save'?'Veilig opslaan…':'Instellingen en verzendmodus opslaan'}</Button>
    </form>:<p>De beveiligde instellingenopslag is niet beschikbaar. De aanwezige koppeling kan wel worden gecontroleerd.</p>}
    <div className="mf-editor-actions"><Button type="button" icon={RefreshCw} disabled={!!busy||!settings.configured||!settings.keyConfigured||dirty} onClick={()=>perform('test')}>{busy==='test'?'Sleutel controleren…':'Test Resend-koppeling'}</Button><Button type="button" icon={RefreshCw} kind="text" disabled={!!busy} onClick={load}>Herlaad</Button></div>
    {dirty&&<p>Je hebt wijzigingen. Sla deze eerst op voordat je de koppeling test.</p>}
    {testedAt&&<p>Laatste sleutelcontrole: {testedAt} · {tested?'bevestigd':'niet bevestigd'}. Een sleutelcontrole verstuurt geen mail.</p>}
    <p role="status">{settings.deliveryEnabled?settings.deliveryMode==='allowlist'||settings.hostPolicy?.mode==='allowlist'?'Mailverzending is beperkt tot de vrijgegeven testadressen.':'Mailverzending is vrijgegeven. Controleer de verzendlog voor de werkelijke status per bericht.':'Mailverzending staat uit. Het opslaan of testen van een sleutel zet de verzending niet aan.'}</p>
    {!settings.deliveryEnabled&&settings.deliveryReason&&<p>{settings.deliveryReason}</p>}
    {canManage&&<div className="mf-editor-actions">{settings.configured&&<Button type="button" icon={Power} kind="text" disabled={!!busy} onClick={()=>setConfirm('remove')}>Resend-koppeling uitschakelen</Button>}{(settings.source==='regie'||settings.disabled)&&settings.environmentConfigured&&<Button type="button" icon={RotateCcw} kind="text" disabled={!!busy} onClick={()=>setConfirm('environment')}>Serverinstellingen gebruiken</Button>}</div>}
    {confirm&&<div className="mf-tip" role="group" aria-label="Wijziging van de Resend-koppeling bevestigen"><p>{confirm==='remove'?'De Resend-koppeling voor alle producties uitschakelen?':'De opgeslagen Resend-gegevens loslaten en de bestaande serverinstellingen gebruiken?'}</p><Button type="button" disabled={!!busy} onClick={()=>perform(confirm)}>Bevestigen</Button><Button type="button" kind="text" onClick={()=>setConfirm('')}>Annuleren</Button></div>}
   </>}
   <div className="mf-tip"><ShieldCheck size={20}/><p>Sleutels worden versleuteld bewaard en na opslaan niet meer getoond. Een echte proefmail verstuur je bewust vanuit de mailwerkplek. Google-aanmelding en inlogcodes worden apart in Supabase Auth beheerd.</p></div>
  </div>
 </Panel>;
}
