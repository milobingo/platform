'use client';
import dynamic from 'next/dynamic';
import { Component, useEffect, useState, type ReactNode } from 'react';
import {configureLocalPreview} from '../frontend/local-preview-access.js';
const Loading = () => <div className="app-loading">Een wereld vol verwondering wordt klaargezet…</div>;
const Studio = dynamic(() => import('../frontend/App.jsx'), { ssr: false, loading: Loading });
const Family = dynamic(() => import('../frontend/FamilyApp.jsx'), { ssr: false, loading: Loading });
class AppBoundary extends Component<{children: ReactNode}, {error: Error|null}> {
  state = {error: null as Error|null};
  static getDerivedStateFromError(error: Error) { return {error}; }
  render() {
    if (this.state.error) return <main className="app-loading"><div><h1>De studio kon niet starten.</h1><p>Je opgeslagen shows en boekjes blijven bewaard.</p><button onClick={() => location.reload()}>Opnieuw laden</button><p><a href="/spelen">Naar de familie-app</a></p></div></main>;
    return this.props.children;
  }
}
export default function ShowApp({ family = false }: {family?: boolean}) {
  const [familyReady,setFamilyReady]=useState(false);
  useEffect(()=>{
    if(!family)return;
    const controller=new AbortController();
    Reflect.set(window,'__MILO_LOCAL_PREVIEW_AVAILABLE__',false);
    fetch('/api/auth/session',{cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(12000)])})
      .then(response=>response.ok?response.json():null)
      .catch(()=>null)
      .then(session=>{
        if(controller.signal.aborted)return;
        configureLocalPreview(session);
        setFamilyReady(true);
      });
    return ()=>controller.abort();
  },[family]);
  if(family&&!familyReady)return <Loading/>;
  return <AppBoundary>{family ? <Family/> : <Studio/>}</AppBoundary>;
}
