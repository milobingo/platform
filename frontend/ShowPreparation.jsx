import React,{useEffect,useState} from 'react';
import {ArrowRight,CheckCircle2,Clapperboard,Play,RefreshCw} from 'lucide-react';
import {Button,Panel,Pattern} from './components.jsx';
import BroadcastPreparation from './BroadcastPreparation.jsx';
import {bindingRules,rulesContract} from '../server/game-rules.js';
import {canLoadStandardMilo,standardMiloDiffers,patternRequirement} from '../server/standard-show.js';
import {startReadiness} from './start-readiness.js';
import ShowAudioPreparation from './ShowAudioPreparation.jsx';

export function PreparationStatus({s,operator,run}){
 const [discard,setDiscard]=useState(false),state=s.preparation||{status:s.dirty?'saving':'saved'};
 useEffect(()=>setDiscard(false),[s.game.id]);
 if(s.production!=='milo')return null;
 return <div className={'mf-save-status '+(state.status==='error'?'has-error':'')} aria-live="polite" data-save-status={state.status}>
  {state.status==='error'?<><span>Niet opgeslagen — </span><Button kind="text" icon={RefreshCw} onClick={()=>run(()=>operator.retryPreparation())}>Opnieuw proberen</Button><p>{state.error} Je invoer blijft bewaard.</p>{state.conflict&&<><Button kind="text" onClick={()=>setDiscard(true)}>Opgeslagen versie bekijken</Button>{discard&&<div><p>Dit vervangt jouw lokale wijzigingen door de versie op de server. Kopieer eerst de tekst die je wilt bewaren.</p><Button onClick={()=>run(()=>operator.loadSavedPreparation())}>Mijn wijzigingen vervangen</Button><Button onClick={()=>setDiscard(false)}>Annuleren</Button></div>}</>}</>:<span>{state.status==='saving'?'Opslaan…':<><CheckCircle2 size={15}/> Opgeslagen</>}</span>}
 </div>;
}

export function ShowRulesPreview({game}){
 const entries=bindingRules(rulesContract(game)),rounds=game.plan.blocks.filter(block=>block.type==='round');
 return <div className="mf-standard-preview"><div className="mf-standard-rounds">{rounds.map((round,index)=><section key={round.id}><h3>{round.title}</h3><small>Rondekaart {index+1} · {round.newBoard?'leeg bord bij de nieuwe ronde':'getrokken nummers blijven staan'}</small><ol>{round.goals.map(goal=>{const pattern=game.plan.patterns.find(item=>item.id===goal.patternId),prize=game.plan.prizes.find(item=>item.id===goal.prizeId);return <li key={goal.id}><Pattern pattern={pattern}/><div><b>{pattern?.title||'Patroon kiezen'}</b><span>{prize?.title||'Prijs kiezen'}</span><small>{patternRequirement(pattern)}</small></div></li>;})}</ol></section>)}</div><details className="mf-rules-preview"><summary>Alle spelregels vóór deelname bekijken</summary><ol>{entries.map(entry=><li key={entry.id}><b>{entry.title}</b><p>{entry.text}</p></li>)}</ol></details></div>;
}

export function PreparationStart({s,operator,run,onStarted}){
 const live=operator.liveCalls?.getSnapshot?.()||{},readiness=startReadiness(s,live),running=s.game.status==='running',finished=s.game.status==='finished',verified=s.demo||s.serverStatusVerified===true;
 const blockers=readiness.blockers.filter(row=>!running||!['calls','result','voice'].includes(row.id));
 const resume=()=>run(async()=>{await operator.resumeRegie();onStarted?.();});
 return <Panel title={running?'Hervat regie':'Start show'} subtitle={running?'De serverstand blijft behouden. Pauze, meldingen en belblokkades worden niet vrijgegeven.':'Laatste wijzigingen worden eerst opgeslagen. De server legt daarna de actuele spelregels vast.'}>
  <div className="mf-editor-content mf-preparation-start"><PreparationStatus s={s} operator={operator} run={run}/><ShowAudioPreparation s={s} operator={operator} run={run}/>
   <p className="mf-rules-readonly" data-rules-state="readonly"><CheckCircle2 size={17}/>{s.game.rulesPublication?.finalizedAt?'Spelregels bij de start vastgelegd.':s.game.rulesPublication&&(s.game.orders?.length||s.game.books.some(book=>book.accountId))?'Deelnemers spelen met deze gepubliceerde regels.':'De spelregels staan klaar en worden bij de start automatisch vastgelegd.'}</p>
   {finished?<p>Deze show is afgelopen. Maak een nieuwe show om opnieuw te spelen.</p>:<>
    {!verified&&running&&<p>Controleer de actuele serverstand door de regie te hervatten.</p>}
    {blockers.length>0&&<div className="mf-preparation-blockers" role="status"><b>Dit vraagt nog aandacht:</b><ul>{blockers.map(row=><li key={row.id}>{row.detail}{row.id==='accounts'&&<> <a href="#/books">Naar de bingoboekjes</a></>}{row.id==='voice'&&<> <a href="#/settings">Stemkoppeling openen</a></>}</li>)}</ul></div>}
    <Button kind="primary" icon={Play} disabled={s.working||s.loading||(!running&&!readiness.canStart)} onClick={running?resume:()=>run(async()=>{await operator.start();onStarted?.();})}>{s.working?'Even bezig…':running?'Hervat regie':s.demo?'Start de repetitie':'Start show'}</Button>
   </>}
   <details className="mf-preparation-advanced"><summary>Geavanceerd</summary><div className="mf-check-list">{readiness.rows.filter(row=>row.id!=='saved'&&row.id!=='rules').map(row=><div key={row.id} data-check={row.id} data-status={row.status}><div><b>{row.label}</b><p>{row.detail}</p></div><small>{row.status==='ready'?'Gereed':row.status==='blocked'?'Aandacht nodig':'Controle'}</small></div>)}</div></details>
  </div>
 </Panel>;
}

export default function ShowPreparation({s,operator,run,onEdit,onNew,onOpenOutput,onStarted}){
 const [step,setStep]=useState(s.game.status==='running'?2:0),id=s.game.id;
 useEffect(()=>setStep(s.game.status==='running'?2:0),[id]);
 const assertSelected=gameId=>{if(operator.game.id!==gameId)throw Error('De gekozen show is gewijzigd. Open het juiste uitzendvenster.');};
 const prepare=async(gameId=id)=>{assertSelected(gameId);await operator.flushPreparation();assertSelected(gameId);if(operator.game.status==='running'&&!operator.runner.active)await operator.resumeRegie();assertSelected(gameId);await operator.bridge.connect();operator.emit();};
 const testSound=async(gameId=id)=>{assertSelected(gameId);await operator.bridge.testSound();assertSelected(gameId);operator.outputRouting=operator.bridge.routing;operator.emit();};
 const canLoad=s.game.status==='draft'&&canLoadStandardMilo(s.game)&&standardMiloDiffers(s.game);
 if(s.game.cancelledAt)return <div className="mf-simple-preparation"><header className="mf-page-head"><div><span className="mf-eyebrow">MILO & FRIENDS BINGOSHOW</span><h1>Productieoverzicht</h1><p>{s.game.title}</p></div>{onNew&&<Button onClick={onNew}>Nieuwe show</Button>}</header><Panel title="Geannuleerd" subtitle="Deze show is definitief gestopt en kan niet worden hervat."><div className="mf-editor-content"><p>Het draaiboek, de boekjes, getrokken nummers, BINGO-meldingen en bestaande uitslagen zijn bewaard. Openstaande uitslagen worden niet aangekondigd.</p>{s.game.cancellation?.reason&&<p><strong>Reden: </strong>{s.game.cancellation.reason}</p>}<div className="mf-editor-actions"><a className="mf-btn secondary" href="#/live">Spelhistorie bekijken</a><Button icon={Clapperboard} onClick={onEdit}>Draaiboek bekijken</Button></div></div></Panel></div>;
 return <div className="mf-simple-preparation">
  <header className="mf-page-head"><div><span className="mf-eyebrow">MILO & FRIENDS BINGOSHOW</span><h1>Productieoverzicht</h1><p>{s.game.title}</p></div>{onNew&&<Button onClick={onNew}>Nieuwe show</Button>}</header>
  <nav className="mf-preparation-steps" aria-label="Show voorbereiden">{['Voorbereiden','Uitzending testen','Start show'].map((label,index)=><button key={label} type="button" aria-current={step===index?'step':undefined} onClick={()=>setStep(index)}><span>{index+1}</span>{label}</button>)}</nav>
  {step!==2&&<ShowAudioPreparation s={s} operator={operator} run={run}/>}
  {step===0&&<Panel title="Voorbereiden" subtitle="Rondes, prijsstappen en spelregels staan bij elkaar."><div className="mf-editor-content"><PreparationStatus s={s} operator={operator} run={run}/>{s.demo?<p>Je oefenstudio staat klaar. Kies Nieuwe show om de voorbereiding als echte show te gebruiken.</p>:s.game.status==='running'?<p>{s.serverStatusVerified?'Show bezig — serverstatus gecontroleerd.':'Serverstatus controleren bij hervatten.'}</p>:<p>Pas het draaiboek en de prijzen aan. Wijzigingen worden automatisch opgeslagen.</p>}
   {canLoad&&<Button icon={RefreshCw} disabled={s.working} onClick={()=>run(()=>operator.loadStandardRules())}>Standaardregels laden</Button>}
   <ShowRulesPreview game={s.game}/><div className="mf-editor-actions"><Button icon={Clapperboard} onClick={onEdit}>Draaiboek bewerken</Button><Button kind="primary" icon={ArrowRight} onClick={()=>setStep(1)}>Uitzending testen</Button></div></div></Panel>}
  {step===1&&<><BroadcastPreparation s={s} bridge={operator.bridge} onPrepare={prepare} onOpenOutput={onOpenOutput} onTestSound={testSound}/><div className="mf-editor-actions"><Button onClick={()=>setStep(0)}>Terug naar voorbereiden</Button><Button kind="primary" icon={ArrowRight} onClick={()=>setStep(2)}>Naar start show</Button></div></>}
  {step===2&&<PreparationStart s={s} operator={operator} run={run} onStarted={onStarted}/>}
 </div>;
}
