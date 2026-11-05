'use client';
import {useEffect, useState} from 'react';
import ShowApp from './ShowApp';
import {normalizedEntry} from '../server/site-entry.js';
export default function StudioGate() {
  const [ready,setReady] = useState(false);
  const [error,setError] = useState('');
  useEffect(() => {
    const canonical=normalizedEntry(location.href);
    if(canonical){location.replace(canonical.href);return;}
    const controller = new AbortController();
    fetch('/api/auth/session',{cache:'no-store',signal:controller.signal}).then(r=>r.json()).then(session=>{
      if(session.authenticated && ['regie','owner','admin'].includes(session.role)) setReady(true);
      else if(session.authenticated) location.replace('/spelen');
      else location.replace('/login?next='+encodeURIComponent(location.pathname+location.search+location.hash));
    }).catch(e=>{if(e.name!=='AbortError')setError('De aanmelding kon niet worden gecontroleerd. Ververs om opnieuw te proberen.');});
    return ()=>controller.abort();
  },[]);
  return ready ? <ShowApp/> : <div className="app-loading">{error || 'Je studiotoegang wordt gecontroleerd…'}</div>;
}
