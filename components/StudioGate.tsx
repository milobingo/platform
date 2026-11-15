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
  const [retrying,setRetrying] = useState(false);
  useEffect(() => {
    const canonical=normalizedEntry(location.href);
    if(canonical){location.replace(canonical.href);return;}
    const controller = new AbortController();
    if(isObsSource()){
      let retryTimer:ReturnType<typeof setTimeout>|undefined,retries=0;
      setObs(true);setReady(false);setError('');setRetrying(false);
      if(!obsSourceToken()){setError('De OBS-link is ongeldig of onvolledig. Maak in de regie bij Studio & camera’s een nieuwe OBS-link.');return ()=>controller.abort();}
      const verify=async()=>{
        let retryable=true;
        try{
          const r=await obsFetch('/api/obs/session',{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(12000)])});
          retryable=[409,425,429].includes(r.status)||r.status>=500;
          if(!r.ok)throw Error('De OBS-link kon niet worden gecontroleerd.');
          const session=await r.json(),expiresAt=new Date(session.expiresAt).getTime();
          retryable=false;
          if(session.authenticated!==true||session.role!=='output'||typeof session.gameId!=='string'||!session.gameId||!Number.isFinite(expiresAt)||expiresAt<=Date.now())throw Error('Ongeldige uitzendtoegang.');
          if(!controller.signal.aborted){setRetrying(false);setError('');setReady(true);}
        }catch{
          if(controller.signal.aborted)return;
          setRetrying(retryable);
          if(retryable){
            setError('De uitzendverbinding is tijdelijk niet beschikbaar. OBS probeert automatisch opnieuw te verbinden.');
            retryTimer=setTimeout(()=>void verify(),Math.min(10000,1000*2**Math.min(retries++,4)));
          }else setError('De OBS-link kon niet worden gecontroleerd. De link is verlopen, ingetrokken of ongeldig. Maak in de regie bij Studio & camera’s een nieuwe OBS-link.');
        }
      };
      void verify();
      return ()=>{controller.abort();clearTimeout(retryTimer);};
    }
    fetch('/api/auth/session',{cache:'no-store',signal:controller.signal}).then(r=>r.json()).then(session=>{
      if(session.authenticated && ['regie','owner','admin'].includes(session.role)) setReady(true);
      else if(session.authenticated) location.replace('/spelen');
      else location.replace('/login?next='+encodeURIComponent(location.pathname+location.search+location.hash));
    }).catch(e=>{if(e.name!=='AbortError')setError('De aanmelding kon niet worden gecontroleerd. Ververs om opnieuw te proberen.');});
    return ()=>controller.abort();
  },[attempt]);
  return ready ? <ShowApp/> : <div className="app-loading">{error?<div role={retrying?'status':'alert'}><p>{error}</p>{obs&&<button type="button" onClick={()=>setAttempt(value=>value+1)}>Opnieuw controleren</button>}</div>:'Je studiotoegang wordt gecontroleerd…'}</div>;
}
