import React,{useEffect,useRef,useState} from 'react';
import {Mail,CheckCircle2,RefreshCw,AlertCircle} from 'lucide-react';
import {getDemoMailPreferences,setDemoMailPreferences} from './mail-demo.js';
import './family-mail.css';

export default function FamilyMailPreferences({brandId='milo',accountId,demo=false}){
 const [data,setData]=useState(null),[choice,setChoice]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[reload,setReload]=useState(0),epoch=useRef(0);
 const title=brandId==='vlampie'?'Vlampie’s Bingo':'Milo & Friends BingoShow';
 useEffect(()=>{const id=++epoch.current,controller=new AbortController();setData(null);setChoice(false);setError('');setNotice('');setBusy(false);
  const read=async()=>{try{let result;if(demo)result=getDemoMailPreferences(brandId,accountId);else{const response=await fetch('/api/mail/preferences?brand='+encodeURIComponent(brandId),{credentials:'same-origin',headers:{'X-Vlampie-Player':'1'},signal:controller.signal});result=await response.json();if(!response.ok)throw Error(result.error?.message||result.error||'Je e-mailvoorkeur kon niet worden geladen.');}if(epoch.current!==id)return;setData(result);setChoice(result.subscribed===true);}catch(e){if(epoch.current===id&&e.name!=='AbortError')setError(e.message);}};void read();return()=>{epoch.current++;controller.abort();};
 },[brandId,accountId,demo,reload]);
 const save=async()=>{if(busy||!data)return;const id=epoch.current;setBusy(true);setError('');setNotice('');try{let result;if(demo)result=setDemoMailPreferences(brandId,accountId,choice);else{const response=await fetch('/api/mail/preferences',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-Milo-Mail':'1','X-Vlampie-Player':'1'},body:JSON.stringify({brandId,subscribed:choice})});result=await response.json();if(!response.ok)throw Error(result.error?.message||result.error||'Je keuze kon niet worden opgeslagen.');}if(epoch.current!==id)return;setData(result);setChoice(result.subscribed===true);setNotice(result.subscribed?'Je ontvangt voortaan nieuws over '+title+'.':'Je bent afgemeld voor nieuwsbrieven.');}catch(e){if(epoch.current===id)setError(e.message||'Probeer het later opnieuw.');}finally{if(epoch.current===id)setBusy(false);}};
 const changed=!!data&&choice!==data.subscribed;
 return <section className="fam-mail-preferences" aria-labelledby="fam-mail-heading">
  <header><span><Mail size={19}/></span><div><h3 id="fam-mail-heading">Een beetje show in je inbox.</h3><p>Nieuws en nieuwe shows van {title}.</p></div>{demo&&<small>DEMO</small>}</header>
  {error&&<p className="fam-mail-error" role="alert"><AlertCircle size={16}/>{error}<button type="button" disabled={busy} onClick={()=>setReload(n=>n+1)} aria-label="E-mailvoorkeur opnieuw laden"><RefreshCw size={15}/></button></p>}
  {!data&&!error?<p className="fam-mail-loading">Je e-mailvoorkeur wordt opgehaald…</p>:data&&<><label className="fam-mail-choice"><input type="checkbox" checked={choice} disabled={busy||data.newsletterEnabled===false&&!data.subscribed} onChange={e=>{setChoice(e.target.checked);setNotice('');}}/><span><strong>Ja, houd mij op de hoogte</strong><small>Op het e-mailadres van dit gezinsaccount. Je kunt je hier en onderaan elke nieuwsbrief afmelden.</small></span></label>{data.newsletterEnabled===false&&<p>De nieuwsbrief is momenteel gepauzeerd. Afmelden blijft mogelijk.</p>}<p className="fam-mail-essential">Inlogcodes en noodzakelijke berichten over je bestelling ontvang je ook zonder nieuwsbrief.</p><div className="fam-mail-actions"><span>{data.subscribed?'Aangemeld voor deze showwereld':'Nog niet aangemeld'}</span><button type="button" className="fam-button secondary" onClick={save} disabled={!changed||busy}>{busy?'Even opslaan…':'Mijn keuze opslaan'}</button></div></>}
  {notice&&<p className="fam-mail-saved" role="status"><CheckCircle2 size={16}/>{demo?'Voorbeeld opgeslagen: ':''}{notice}</p>}
 </section>;
}
