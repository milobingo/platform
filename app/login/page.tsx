'use client';
import {useEffect,useState,type FormEvent} from 'react';
type Session = {authenticated?:boolean;role?:string;localAvailable?:boolean;configured?:boolean};
export default function Login() {
  const [session,setSession]=useState<Session>({});
  const [email,setEmail]=useState('');
  const [token,setToken]=useState('');
  const [sent,setSent]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [next,setNext]=useState('/');
  useEffect(()=>{
    const value=new URLSearchParams(location.search).get('next');
    if(value?.startsWith('/')&&!value.startsWith('//')&&!/[\\\u0000-\u0020\u007f]/.test(value)){
      try{const decoded=decodeURIComponent(value);const target=new URL(value,location.origin);if(!decoded.startsWith('//')&&!/[\\\u0000-\u0020\u007f]/.test(decoded)&&target.origin===location.origin)setNext(target.pathname+target.search+target.hash);}catch{}
    }
    fetch('/api/auth/session',{cache:'no-store'}).then(r=>r.json()).then(setSession).catch(()=>setError('De aanmelding kon niet worden geladen.'));
  },[]);
  const post=async(path:string,body:object)=>{
    const response=await fetch(path,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const data=await response.json();
    if(!response.ok)throw new Error(data.error?.message||data.error||'Aanmelden is niet gelukt.');
    return data;
  };
  const run=async(operation:()=>Promise<void>)=>{setError('');setBusy(true);try{await operation();}catch(e){setError(e instanceof Error?e.message:'Aanmelden is niet gelukt.');}finally{setBusy(false);}};
  const submit=(event:FormEvent)=>{event.preventDefault();void run(async()=>{
    if(sent){await post('/auth/verify',{email,token});location.assign(next);}
    else{await post('/auth/otp',{email});setSent(true);}
  });};
  return <main className="login-page"><section className="login-card"><img src="/assets/milo-friends/logo.png" alt="Milo & Friends"/><span className="login-eyebrow">DE SHOW BEGINT SAMEN</span><h1>Welkom in de studio</h1><p>Log in met je ouderaccount of je toegewezen studiotoegang.</p>
    {error&&<p className="login-error" role="alert">{error}</p>}
    {session.configured&&<><form onSubmit={submit}><label>E-mailadres<input type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} required disabled={sent}/></label>{sent&&<label>Inlogcode<input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6,10}" minLength={6} maxLength={10} value={token} onChange={e=>setToken(e.target.value.replace(/\D/g,''))} required/></label>}<button disabled={busy}>{busy?'Even wachten…':sent?'Code controleren':'Stuur mijn inlogcode'}</button></form>{sent?<button className="secondary" disabled={busy} onClick={()=>{setSent(false);setToken('');}}>Ander e-mailadres</button>:<button className="secondary" disabled={busy} onClick={()=>void run(async()=>{const data=await post('/auth/google',{next});location.assign(data.url);})}>Verder met Google</button>}</>}
    {session.localAvailable&&<fieldset><legend>LOKALE TESTAANMELDING</legend><p className="login-note">Deze accounts bewaren gegevens op deze computer. E-mail en externe diensten zijn niet aangesloten.</p><button disabled={busy} onClick={()=>void run(async()=>{const data=await post('/auth/local',{role:'regie',next});location.assign(data.next);})}>Open lokale regie</button><button className="secondary" disabled={busy} onClick={()=>void run(async()=>{const data=await post('/auth/local',{role:'player',next:'/spelen'});location.assign(data.next);})}>Open lokaal ouderaccount</button></fieldset>}
    {!session.configured&&!session.localAvailable&&<p>Aanmelden wordt beschikbaar zodra Supabase voor deze omgeving is ingesteld.</p>}
    <p className="login-note"><a href="/spelen">Naar de familie-app</a></p>
  </section></main>;
}
