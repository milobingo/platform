import React from 'react';
import {Plus,Trash2,ArrowUp,ArrowDown} from 'lucide-react';
import {Button,Field,Pattern} from './components.jsx';

export default function ExplanationSteps({block,plan,onChange}){
 const steps=block.explanationSteps||[];
 const change=(index,patch)=>onChange({...block,explanationSteps:steps.map((step,i)=>i===index?{...step,...patch}:step)});
 const move=(index,delta)=>{const next=[...steps];[next[index],next[index+delta]]=[next[index+delta],next[index]];onChange({...block,explanationSteps:next});};
 return <div className="mf-dialogue-turns">
  <label><input type="checkbox" checked={steps.length>0} onChange={event=>onChange({...block,explanationSteps:event.target.checked?[{patternId:plan.patterns[0]?.id||'',text:block.text}]:[]})}/> Patronen één voor één uitleggen in het uitzendbeeld</label>
  {steps.length>0&&<><p>Elk patroon verschijnt bij de bijbehorende tekst. De volgende uitlegstap wacht tot de stem klaar is. Dit zijn voorbeelden; er worden geen ballen getrokken of spelrondes gestart.</p>
   {steps.map((step,index)=><section key={index} className="mf-dialogue-turn" aria-label={'Uitlegstap '+(index+1)}><Pattern pattern={plan.patterns.find(p=>p.id===step.patternId)}/><Field label={'Patroon uitlegstap '+(index+1)}><select value={step.patternId} onChange={event=>change(index,{patternId:event.target.value})}>{plan.patterns.map(p=><option key={p.id} value={p.id}>{p.title}</option>)}</select></Field><Field label={'Tekst uitlegstap '+(index+1)}><textarea rows={4} maxLength={10000} value={step.text} onChange={event=>change(index,{text:event.target.value})}/></Field><div className="mf-editor-small-actions"><button type="button" disabled={index===0} onClick={()=>move(index,-1)}><ArrowUp size={15}/>Hoger</button><button type="button" disabled={index===steps.length-1} onClick={()=>move(index,1)}><ArrowDown size={15}/>Lager</button><button type="button" disabled={steps.length===1} onClick={()=>onChange({...block,explanationSteps:steps.filter((_,i)=>i!==index)})}><Trash2 size={15}/>Uitlegstap verwijderen</button></div></section>)}
   <Button icon={Plus} disabled={steps.length>=10} onClick={()=>onChange({...block,explanationSteps:[...steps,{patternId:plan.patterns[0]?.id||'',text:''}]})}>Uitlegstap toevoegen</Button>
  </>}
 </div>;
}
