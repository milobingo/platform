import {brandId,brandDefaults} from './show-brands.js';
import {defaultPlan,newId} from './plan-model.js';
import {addMissingRandomCalls} from './call-rundown.js';

// This marker opts a newly created (or explicitly converted) show into the
// official 15-second clock. Reading a historical show never adds the marker.
export const STANDARD_MILO_PROFILE='milo-standard-v1';
export const STANDARD_DRAW_INTERVAL_MS=15000;
export const STANDARD_DRAW_LEAD_MS=5450;
export const STANDARD_DRAW_RESERVATION_MS=4300;
export const automaticRules=game=>brandId(game)==='milo';
export const isStandardMiloGame=game=>brandId(game)==='milo'&&game.settings?.rulesProfile===STANDARD_MILO_PROFILE;
const goalCells=[0,1,2,3,4,20,21,22,23,24];
export const canLoadStandardMilo=game=>brandId(game)==='milo'&&game.status==='draft'&&!(game.orders||[]).length&&!game.books?.some(book=>book.accountId)&&(!game.books?.length||game.plan.blocks.filter(block=>block.type==='round').length===4);
export function patternRequirement(pattern){
 if(pattern?.variant==='rows')return 'Eén volledige horizontale rij is genoeg.';
 if(pattern?.variant==='doubleRows')return 'Er zijn twee volledige horizontale rijen nodig.';
 if(pattern?.variant==='fixed'&&JSON.stringify([...(pattern.cells||[])].sort((a,b)=>a-b))===JSON.stringify(goalCells))return 'De bovenste én de onderste rij moeten allebei vol zijn. Eén volle rij is geen bingo voor deze prijsstap.';
 return 'Alle gemarkeerde vakken moeten compleet zijn. Het middenvak is vrij.';
}
export function standardMiloPlan(){
 const plan=defaultPlan(),rounds=[];
 for(let i=0;i<4;i++){
  const final=i===3;
  rounds.push({id:newId('ronde'),type:'round',callFullCardWinner:true,title:final?'Finaleronde':`Ronde ${i+1}`,goals:(final?['patroon-vol']:['patroon-hoeken','patroon-boven-onder','patroon-vol']).map(patternId=>({id:newId('doel'),patternId,prizeId:final?'prijs-hoofdprijs':'prijs-verrassing'})),interval:15,newBoard:true});
  if(!final)rounds.push({id:newId('pauze'),type:'pause',title:'Magische pauze',seconds:60,unit:'seconds'});
 }
 plan.blocks=[...plan.blocks.slice(0,3),...rounds,plan.blocks.at(-1)];
 const branded=brandDefaults(plan,'milo');addMissingRandomCalls(branded);return branded;
}
// An explicit conversion changes the bingo profile, retaining presentation
// cues and prizes wherever a corresponding round already exists.
export function loadStandardMiloPlan(existing){
 const plan=structuredClone(existing),standard=standardMiloPlan(),rounds=plan.blocks.filter(block=>block.type==='round'),stock=standard.blocks.filter(block=>block.type==='round');
 plan.patterns=[...plan.patterns.filter(pattern=>!['patroon-hoeken','patroon-boven-onder','patroon-vol'].includes(pattern.id)),...standard.patterns.filter(pattern=>['patroon-hoeken','patroon-boven-onder','patroon-vol'].includes(pattern.id))];
 const replacements=stock.map((round,index)=>{
  const old=rounds[index],fallback=old?.goals?.find(goal=>plan.prizes.some(prize=>prize.id===goal.prizeId))?.prizeId||plan.prizes[0]?.id;
  return {...round,...(old?{id:old.id,title:old.title,callFullCardWinner:old.callFullCardWinner===true}:{}),goals:round.goals.map((goal,i)=>({...goal,...(old?.goals?.[i]?{id:old.goals[i].id}:{}),prizeId:old?.goals?.[i]&&plan.prizes.some(prize=>prize.id===old.goals[i].prizeId)?old.goals[i].prizeId:fallback||goal.prizeId}))};
 });
 if(!plan.prizes.length)plan.prizes=standard.prizes;
 if(rounds.length===4){let index=0;plan.blocks=plan.blocks.map(block=>block.type==='round'?replacements[index++]:block);}
 else {const first=plan.blocks.findIndex(block=>block.type==='round');plan.blocks=plan.blocks.flatMap((block,index)=>block.type==='round'?(index===first?replacements:[]):[block]);if(first<0)plan.blocks.splice(Math.max(0,plan.blocks.length-1),0,...replacements);}
 return plan;
}
export function standardMiloDiffers(game){
 if(brandId(game)!=='milo')return false;
 const plan=game.plan,rounds=plan?.blocks?.filter(block=>block.type==='round')||[];
 if(rounds.length!==4||game.settings?.mode!=='auto'||!isStandardMiloGame(game))return true;
 return rounds.some((round,index)=>{
  const expected=index===3?[Array.from({length:25},(_,i)=>i)]:[[0,4,20,24],goalCells,Array.from({length:25},(_,i)=>i)];
  return round.interval!==15||round.newBoard!==true||round.goals.length!==expected.length||round.goals.some((goal,i)=>{
   const pattern=plan.patterns.find(candidate=>candidate.id===goal.patternId);
   return !pattern||pattern.freeCenter!==true||pattern.variant!=='fixed'||JSON.stringify([...pattern.cells].sort((a,b)=>a-b))!==JSON.stringify(expected[i]);
  });
 });
}
export function resetDrawClock(game,now=Date.now()){
 if(isStandardMiloGame(game))game.state.drawClock={intervalMs:STANDARD_DRAW_INTERVAL_MS,nextAt:now+STANDARD_DRAW_INTERVAL_MS};
}
export function drawDueAt(game){
 if(!isStandardMiloGame(game))return null;
 const stored=game.state.drawClock?.nextAt;
 return Number.isSafeInteger(stored)?stored:(game.state.lastCommit?.at??game.startedAt??game.createdAt)+STANDARD_DRAW_INTERVAL_MS;
}
