import React,{Suspense,lazy} from 'react';
import {createRoot} from 'react-dom/client';
import {normalizedEntry} from '../server/site-entry.js';
import {recoverStartup,clearStartupRecovery,freshStudioUrl} from './startup-recovery.js';
const entry=normalizedEntry(location.href);
if(entry){if(entry.pathname!==location.pathname)location.replace(entry.href);else history.replaceState(null,'',entry.href);}
document.documentElement.dataset.workspace='react-sterrenplein';
const App=lazy(async()=>{
 try{const app=await(location.pathname.startsWith('/spelen')?import('./FamilyApp.jsx'):import('./App.jsx'));clearStartupRecovery();return app;}
 catch(error){if(recoverStartup(error))return new Promise(()=>{});throw error;}
});
class ErrorBoundary extends React.Component{constructor(props){super(props);this.state={error:null};}static getDerivedStateFromError(error){return {error};}render(){if(this.state.error)return <main style={{fontFamily:'system-ui',padding:'50px 25px',maxWidth:600,margin:'auto',color:'#583674'}}><h1>De studio kon niet starten.</h1><p>Je opgeslagen shows en boekjes blijven bewaard. Ververs de pagina om de werkplek opnieuw te openen.</p><button onClick={()=>location.replace(freshStudioUrl(location.href))} style={{padding:12,marginRight:15}}>Opnieuw laden</button><a href={location.pathname.startsWith('/spelen')?'/spelen':'/'}>Terug naar de studio</a><pre style={{fontSize:11,whiteSpace:'pre-wrap',marginTop:25,color:'#9a80ad'}}>{this.state.error.message}</pre></main>;return this.props.children;}}
if(!entry||entry.pathname===location.pathname)createRoot(document.getElementById('root')).render(<ErrorBoundary><Suspense fallback={<div style={{minHeight:'100vh',display:'grid',placeItems:'center',fontFamily:'system-ui',background:'#f8f3fc',color:'#8955aa'}}>Een wereld vol verwondering wordt klaargezet…</div>}><App/></Suspense></ErrorBoundary>);
