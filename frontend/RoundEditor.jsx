import React,{useState} from 'react';
import {ArrowUp,ArrowDown,Plus,Trash2,BookOpen,ShieldCheck} from 'lucide-react';
import {Button,Badge,Panel,Field,Pattern} from './components.jsx';
import {isStandardMiloGame,patternRequirement} from '../server/standard-show.js';
import {roundBlocks,roundEditAccess,addRound,removeRound,moveRound,addRoundGoal,removeRoundGoal,changeRoundGoal,canMoveRoundGoal,moveRoundGoal} from './round-editor-model.js';
import './round-editor.css';

const accessFor=s=>roundEditAccess(s.game,{demo:s.demo,busy:s.working,runnerActive:s.runner?.active});

export function RoundGoalsEditor({s,operator,run,round,onChange}){
 const plan=s.game.plan,access=accessFor(s),standard=isStandardMiloGame(s.game);
 const edit=mutate=>run(()=>{if(access.goalsLocked)throw Error(access.message||'Deze ronde staat vast.');if(onChange){const draft=structuredClone(plan),index=draft.blocks.findIndex(block=>block.id===round.id);draft.blocks[index]=structuredClone(round);mutate(draft);onChange(draft.blocks[index]);}else operator.editPlan(mutate);});
 return <div className="mf-round-step-editor" data-round-goals={round.id}>
  <p className="mf-round-card-status"><BookOpen size={16}/>Eigen rondekaart · leeg bord bij start · nummers blijven staan tussen prijsstappen</p>
  <Field label="Tijd tussen trekkingen (seconden)" hint={standard?'De officiële Milo-trekker gebruikt 15 seconden vanaf de vorige getoonde bal. Pauzes en meldingen hebben voorrang.':undefined}><input type="number" min={0} max={60} step={1} value={standard?15:round.interval} readOnly={standard||access.goalsLocked} onChange={event=>edit(value=>{value.blocks.find(block=>block.id===round.id).interval=Number(event.target.value);})}/></Field>
  {s.production==='milo'&&<label className="mf-check-field"><input type="checkbox" checked={round.callFullCardWinner===true} disabled={s.working||(!s.demo&&s.game.status!=='draft')||s.runner?.active} onChange={event=>run(()=>{const enabled=event.target.checked;if(onChange)onChange({...round,callFullCardWinner:enabled});else operator.editPlan(value=>{value.blocks.find(block=>block.id===round.id).callFullCardWinner=enabled;});})}/><span>Bel de winnaar van de volle kaart<small>Na de officiële uitslag en het einde van deze ronde. Alleen dit winnende kind, als het beschikbaar is.</small></span></label>}
  <ol className="mf-round-step-list">{round.goals.map((goal,index)=>{const pattern=plan.patterns.find(value=>value.id===goal.patternId);return <li key={goal.id} data-goal-id={goal.id}>
   <div className="mf-round-step-pattern"><Pattern pattern={pattern}/><Badge tone="purple">{index+1}</Badge></div>
   <div className="mf-round-step-fields"><Field label={`Patroon prijsstap ${index+1}`}><select value={goal.patternId} disabled={access.goalsLocked} onChange={event=>edit(value=>changeRoundGoal(value,round.id,goal.id,'patternId',event.target.value))}>{plan.patterns.map(item=><option key={item.id} value={item.id}>{item.title}</option>)}</select></Field><small className="mf-round-pattern-rule">{patternRequirement(pattern)}</small><Field label={`Prijs prijsstap ${index+1}`}><select value={goal.prizeId} disabled={access.goalsLocked} onChange={event=>edit(value=>changeRoundGoal(value,round.id,goal.id,'prizeId',event.target.value))}>{!goal.prizeId&&<option value="">Kies een prijs</option>}{plan.prizes.map(item=><option key={item.id} value={item.id}>{item.title}</option>)}</select></Field>
    <div className="mf-round-step-actions"><Button kind="text" icon={ArrowUp} aria-label={`Prijsstap ${index+1} hoger`} disabled={access.goalsLocked||!canMoveRoundGoal(plan,round,goal.id,-1)} onClick={()=>edit(value=>moveRoundGoal(value,round.id,goal.id,-1))}>Hoger</Button><Button kind="text" icon={ArrowDown} aria-label={`Prijsstap ${index+1} lager`} disabled={access.goalsLocked||!canMoveRoundGoal(plan,round,goal.id,1)} onClick={()=>edit(value=>moveRoundGoal(value,round.id,goal.id,1))}>Lager</Button><Button kind="text" icon={Trash2} aria-label={`Prijsstap ${index+1} verwijderen`} disabled={access.goalsLocked||round.goals.length<=1} onClick={()=>edit(value=>removeRoundGoal(value,round.id,goal.id))}>Verwijderen</Button></div>
   </div></li>;})}</ol>
  <Button icon={Plus} disabled={access.goalsLocked||round.goals.length>=10} onClick={()=>edit(value=>addRoundGoal(value,round.id))}>Patroon en prijs toevoegen</Button>
 </div>;
}

export default function RoundEditor({s,operator,run,choose}){
 const rounds=roundBlocks(s.game.plan),access=accessFor(s),[deleteId,setDeleteId]=useState(null);
 const structural=mutate=>run(()=>{if(access.structureLocked)throw Error(access.message||'De ronde-indeling staat vast.');operator.editPlan(mutate);});
 const add=()=>structural(plan=>{const round=addRound(plan,{production:s.production,speakerId:s.hostId});operator.selectedCue=plan.blocks.indexOf(round);});
 const referenced=new Set(rounds.flatMap(round=>round.goals.map(goal=>goal.patternId)));
 return <div className="mf-round-editor">
  <div className="mf-round-editor-toolbar"><div><h2>Rondes en prijsstappen</h2><p>Voeg per ronde de patronen op volgorde toe. Dezelfde rondes staan direct in het draaiboek.</p></div><Button icon={Plus} kind="primary" disabled={access.structureLocked||rounds.length>=8||s.game.plan.blocks.length>=100} onClick={add}>Ronde toevoegen</Button></div>
  {access.message&&<p className="mf-round-read-status" role="status"><ShieldCheck size={18}/>{access.message}</p>}
  <div className="mf-rounds-grid mf-rounds-editable">{rounds.map((round,index)=><Panel key={round.id} title={round.title} subtitle={`Kaart ${index+1} · ${round.goals.length} prijsstap${round.goals.length===1?'':'pen'}`} action={<div className="mf-round-order-actions"><Button kind="text" icon={ArrowUp} aria-label={`${round.title} hoger`} disabled={access.structureLocked||index===0} onClick={()=>structural(plan=>moveRound(plan,round.id,-1))}/><Button kind="text" icon={ArrowDown} aria-label={`${round.title} lager`} disabled={access.structureLocked||index===rounds.length-1} onClick={()=>structural(plan=>moveRound(plan,round.id,1))}/></div>}>
   <div className="mf-round-editor-content"><Field label="Naam van de ronde"><input value={round.title} maxLength={60} readOnly={access.structureLocked} onChange={event=>structural(plan=>{plan.blocks.find(block=>block.id===round.id).title=event.target.value;})}/></Field><RoundGoalsEditor s={s} operator={operator} run={run} round={round}/>
    <div className="mf-round-delete">{deleteId===round.id?<><p>Deze ronde en de bijbehorende prijsstappen verwijderen?</p><Button kind="text" onClick={()=>setDeleteId(null)}>Behouden</Button><Button icon={Trash2} disabled={access.structureLocked} onClick={()=>{structural(plan=>removeRound(plan,round.id));setDeleteId(null);}}>Ronde verwijderen</Button></>:<Button kind="text" icon={Trash2} disabled={access.structureLocked||rounds.length<=1} onClick={()=>setDeleteId(round.id)}>Ronde verwijderen</Button>}</div>
   </div></Panel>)}</div>
  <details className="mf-preparation-advanced"><summary>Patronenbibliotheek · nieuw patroon tekenen</summary><Panel title="Patronenbibliotheek" subtitle="Boven én onder gebruikt beide buitenste rijen. Eén willekeurige rij is een ander patroon." action={<Button icon={Plus} kind="text" disabled={access.locked} onClick={()=>choose('pattern')}>Nieuw patroon</Button>}><div className="mf-pattern-library">{s.game.plan.patterns.map(pattern=><button key={pattern.id} disabled={access.locked||access.rulesBound&&referenced.has(pattern.id)} onClick={()=>choose('pattern',{pattern})}><Pattern pattern={pattern}/><b>{pattern.title}</b><small>{pattern.variant==='rows'?'Elke horizontale rij':pattern.variant==='doubleRows'?'Twee willekeurige rijen':pattern.cells.filter(cell=>cell!==12).length+' nummervakken'}</small></button>)}</div></Panel></details>
 </div>;
}
