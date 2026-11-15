import React from 'react';
import {Phone,Plus,CheckCircle2} from 'lucide-react';
import {Button} from './components.jsx';
import {addMissingRandomCalls,callRundownSummary} from '../server/call-rundown.js';

export default function CallPreparation({s,operator,run}){
 if(s.production!=='milo')return null;
 const summary=callRundownSummary(s.game.plan),editable=s.game.status==='draft'&&!s.runner?.active&&!s.working;
 return <section className="mf-call-preparation" aria-label="Belmomenten in deze show" style={{border:'1px solid var(--mf-border)',borderRadius:12,padding:16,margin:'16px 0'}}>
  <h3 style={{display:'flex',gap:8,alignItems:'center'}}><Phone size={18}/>Belmomenten in deze show</h3>
  <p>{summary.randomCount} van 2 willekeurige belmomenten gepland. Dit zijn twee kansen; beschikbaarheid bepaalt of een gesprek lukt.</p>
  {!summary.randomReady&&editable&&summary.randomCount<2&&<Button icon={Plus} onClick={()=>run(()=>operator.editPlan(plan=>addMissingRandomCalls(plan)))}>Twee magische belletjes klaarzetten</Button>}
  <ul>{summary.winnerRounds.map(round=><li key={round.id}>{round.title}: {round.enabled?'bel de bevestigde vollekaartwinnaar':'geen automatische winnaaroproep'}</li>)}</ul>
  <small><CheckCircle2 size={13}/>Live zetten en de show hervatten blijven bewuste regiehandelingen. Een belletje wijzigt geen uitslag.</small>
 </section>;
}
