import React,{useState} from 'react';
import {Plus,Trash2,Volume2,BookOpen} from 'lucide-react';
import {Button,Field,Panel} from './components.jsx';
import {MANUAL_CUE_CONDITIONS,manualCueAvailability,manualCuePlaybackHeld} from '../server/manual-cues.js';
import './rundown-editor.css';

export default function ManualCueBank({s,operator,run,live=false}){
 const [selected,setSelected]=useState('');if(s.production!=='milo')return null;
 const cues=s.game.plan.manualCues||[],cue=cues.find(item=>item.id===selected)||cues[0],readonly=s.working||(!s.demo&&s.game.status!=='draft'),busy=s.voicePhase!=='idle';
 const edit=patch=>run(()=>operator.editPlan(plan=>{const item=plan.manualCues?.find(item=>item.id===cue.id);if(item)Object.assign(item,patch);}));
 const availability=cue?manualCueAvailability(cue,s.game):{allowed:false,reason:'Voeg eerst een spreekkaart toe.'};
 const playbackIssue=busy?'De presentator spreekt nog.':!s.demo&&s.game.status!=='running'?'Start eerst de show.':!manualCuePlaybackHeld(s.game)?'Pauzeer eerst de show om een spreekkaart af te spelen.':'';
 const content=<div className="mf-manual-bank">
  <p>Losse teksten voor regie, zonder extra bingorondes. Ze worden pas uitgesproken wanneer je op Afspelen drukt. Pauzeer eerst, of gebruik de bestaande bingo- of belblokkade. Na de tekst hervat je bewust.</p>
  {!live&&<Button icon={Plus} disabled={readonly||cues.length>=80} onClick={()=>run(()=>operator.editPlan(plan=>{const item={id:'spreekkaart-'+crypto.randomUUID(),title:'Nieuwe spreekkaart',text:'',speakerId:s.game.plan.leadId||'milo',condition:'always',notes:''};(plan.manualCues??=[]).push(item);setSelected(item.id);}))}>Spreekkaart toevoegen</Button>}
  {cues.length>0?<><Field label="Voorbereide tekst"><select value={cue.id} onChange={e=>setSelected(e.target.value)}>{cues.map(item=><option key={item.id} value={item.id}>{item.title}</option>)}</select></Field>
   {live?<><p className="mf-manual-spoken">{cue.text}</p>{cue.notes&&<p className="mf-operator-notes"><strong>Alleen regie: </strong>{cue.notes}</p>}</>:<fieldset disabled={readonly}>
    <Field label="Naam van de spreekkaart"><input value={cue.title} maxLength={90} onChange={e=>edit({title:e.target.value})}/></Field>
    <Field label="Spreektekst" hint="Maximaal 10.000 tekens. Alleen deze tekst wordt uitgesproken."><textarea value={cue.text} maxLength={10000} rows={6} onChange={e=>edit({text:e.target.value})}/></Field>
    <div className="mf-two-fields"><Field label="Spreker"><select value={cue.speakerId||s.game.plan.leadId||'milo'} onChange={e=>edit({speakerId:e.target.value})}>{s.characters.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></Field><Field label="Wanneer beschikbaar"><select value={cue.condition} onChange={e=>edit({condition:e.target.value})}>{Object.entries(MANUAL_CUE_CONDITIONS).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></Field></div>
    {cue.condition==='round-transition'&&<div className="mf-two-fields"><Field label="Ronde (vanaf 1)"><input type="number" min="1" max="10" value={(cue.roundIndex??0)+1} onChange={e=>edit({roundIndex:Math.max(0,Number(e.target.value)-1)})}/></Field><Field label="Nieuwe prijsstap (vanaf 1)"><input type="number" min="1" max="10" value={(cue.goalIndex??1)+1} onChange={e=>edit({goalIndex:Math.max(0,Number(e.target.value)-1)})}/></Field></div>}
    <Field label="Regienotitie — wordt niet voorgelezen"><textarea value={cue.notes||''} maxLength={3000} rows={3} onChange={e=>edit({notes:e.target.value})}/></Field>
    <Button icon={Trash2} onClick={()=>run(()=>operator.editPlan(plan=>{plan.manualCues=plan.manualCues.filter(item=>item.id!==cue.id);}))}>Spreekkaart verwijderen</Button>
   </fieldset>}
   {live&&<><Button icon={Volume2} disabled={s.working||!!playbackIssue||!availability.allowed||!cue.text.trim()} onClick={()=>run(()=>operator.playManualCue(cue.id))}>Afspelen</Button><p role="status">{playbackIssue||availability.reason||'Deze tekst past bij de actuele serverstand. De trekking blijft gepauzeerd.'}</p></>}
  </>:<p>Er zijn nog geen spreekkaarten. Voeg een eigen tekst toe of maak het première-draaiboek uit de bijlage.</p>}
 </div>;
 return live?<details className="mf-live-manual-cues"><summary><BookOpen size={18}/> Voorbereide spreekkaarten ({cues.length})</summary>{content}</details>:<Panel title="Spreekkaarten voor live regie" subtitle="Patroonwissels, meldingen en reserveteksten staan klaar buiten de tijdlijn.">{content}</Panel>;
}
