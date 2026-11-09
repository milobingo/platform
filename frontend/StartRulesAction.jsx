import React from 'react';
import {ShieldCheck,Save} from 'lucide-react';
import {Button} from './components.jsx';
import {bindingRules,rulesContract,rulesCurrent} from '../server/game-rules.js';

export default function StartRulesAction({s,operator,run,onSave,planReady=true}){
 const game=s.game,publication=game.rulesPublication,current=rulesCurrent(game);
 const locked=!!publication&&((game.orders||[]).length>0||game.books.some(book=>book.accountId));
 let preview=[];try{preview=current?publication.rules:bindingRules(rulesContract(game));}catch{}
 const publish=()=>run(async()=>{
  if(s.demo||s.working||s.dirty||current||locked||!planReady)return;
  if(operator.game&&operator.game.id!==game.id)throw Error('De geselecteerde show is gewijzigd. Open de startcheck opnieuw.');
  await operator.task(()=>operator.post('publish-rules'),'De spelregels voor deze show zijn gepubliceerd.');
 });
 return <div className="mf-start-rules">
  {current?<a href={'/spelregels?spel='+encodeURIComponent(game.id)} target="_blank" rel="noopener noreferrer">Bekijk gepubliceerde regels · versie {publication.version}</a>:<>
   <details><summary>Spelregels bekijken</summary><p>Deze regels volgen uit de rondes, patronen, prijzen en spelinstellingen van deze show. Publiceren maakt ze leesbaar voor gezinnen vóór deelname.</p>{preview.map(rule=><article key={rule.id}><h4>{rule.title}</h4><p>{rule.text}</p></article>)}</details>
   {locked?<p>Er zijn al deelnemers of bestellingen aan de gepubliceerde versie gekoppeld. Herstel de bijbehorende voorbereiding; de regels kunnen niet met één klik worden vervangen.</p>:s.dirty?<><p>Sla eerst je draaiboekwijzigingen op. Daarna kun je de opgeslagen regels publiceren.</p>{onSave&&<Button icon={Save} disabled={s.working} onClick={onSave}>Draaiboek opslaan</Button>}</>:<><Button icon={ShieldCheck} disabled={s.working||!planReady} onClick={publish}>{publication?'Publiceer actuele spelregels':'Publiceer spelregels'}</Button>{!planReady&&<p>Herstel eerst de rondes, patronen en prijzen hierboven.</p>}</>}
  </>}
 </div>;
}
