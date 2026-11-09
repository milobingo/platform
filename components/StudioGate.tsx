'use client';
import {useEffect, useState} from 'react';
import ShowApp from './ShowApp';
import {normalizedEntry} from '../server/site-entry.js';
import {isObsSource,obsSourceToken,obsFetch} from '../public/obs-access.js';
export default function StudioGate() {
  const [ready,setReady] = useState(false);
  const [error,setError] = useState('');
  const [attempt,setAttempt] = useState(0);
  const [obs,setObs] = useState(false);
  useEffect(() => {
    const canonical=normalizedEntry(location.href);
    if(canonical){location.replace(canonical.href);return;}
    const controller = new AbortController();
    if(isObsSource()){
      setObs(true);setReady(false);setError('');
      if(!obsSourceToken()){setError('De OBS-link is ongeldig of onvolledig. Maak in de regie bij Studio & camera’s een nieuwe OBS-link.');return ()=>controller.abort();}
      obsFetch('/api/obs/session',{signal:controller.signal}).then(async r=>{
        const session=await r.json();
        const expiresAt=new Date(session.expiresAt).getTime();
        if(!r.ok||session.authenticated!==true||session.role!=='output'||typeof session.gameId!=='string'||!session.gameId||!Number.isFinite(expiresAt)||expiresAt<=Date.now())throw Error('De OBS-link is verlopen, ingetrokken of niet meer beschikbaar. Maak een nieuwe link in de regie.');
        if(!controller.signal.aborted)setReady(true);
      }).catch(e=>{if(e.name!=='AbortError')setError('De OBS-link kon niet worden gecontroleerd. Controleer de verbinding of maak in de regie bij Studio & camera’s een nieuwe OBS-link.');});
      return ()=>controller.abort();
    }
    fetch('/api/auth/session',{cache:'no-store',signal:controller.signal}).then(r=>r.json()).then(session=>{
      if(session.authenticated && ['regie','owner','admin'].includes(session.role)) setReady(true);
      else if(session.authenticated) location.replace('/spelen');
      else location.replace('/login?next='+encodeURIComponent(location.pathname+location.search+location.hash));
    }).catch(e=>{if(e.name!=='AbortError')setError('De aanmelding kon niet worden gecontroleerd. Ververs om opnieuw te proberen.');});
    return ()=>controller.abort();
  },[attempt]);
  return ready ? <ShowApp/> : <div className="app-loading">{error?<div role="alert"><p>{error}</p>{obs&&<button type="button" onClick={()=>setAttempt(value=>value+1)}>Opnieuw controleren</button>}</div>:'Je studiotoegang wordt gecontroleerd…'}</div>;
}
