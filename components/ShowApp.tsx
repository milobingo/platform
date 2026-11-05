'use client';
import dynamic from 'next/dynamic';
import { Component, type ReactNode } from 'react';
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
  return <AppBoundary>{family ? <Family/> : <Studio/>}</AppBoundary>;
}
