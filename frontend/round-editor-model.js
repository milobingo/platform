import {createBlock,newId} from '../server/plan-model.js';

export const roundBlocks=plan=>(plan.blocks||[]).filter(block=>block.type==='round');
const live=game=>game.status!=='draft';
export function roundEditAccess(game,{demo=false,busy=false,runnerActive=false}={}){
 const books=game.books||[],orders=game.orders||[],participating=books.some(book=>book.accountId);
 const locked=busy||runnerActive||(!demo&&live(game));
 const rulesBound=!demo&&!!game.rulesPublication&&(participating||orders.length>0);
 const cardsBound=!demo&&(books.length>0||orders.some(order=>!['cancelled','rejected'].includes(order.status)));
 return {locked,rulesBound,structureLocked:locked||rulesBound||cardsBound,goalsLocked:locked||rulesBound,
  message:!demo&&live(game)?'Deze show is gestart. Rondes en patronen blijven bewaard; ga verder in de live regie.':runnerActive?'Stop eerst de repetitie om rondes te wijzigen.':rulesBound?'De rondes, patronen en prijzen staan vast voor bestaande deelnemers of bestellingen. Maak een nieuwe show voor andere spelregels.':cardsBound?'Er zijn al rondekaarten gemaakt. Het aantal, de namen en de volgorde van de rondes staan vast voor deze boekjes.':busy?'Wacht tot de huidige actie klaar is.':''};
}
export function fullCardPattern(pattern){return pattern?.variant==='fixed'&&Array.from({length:25},(_,cell)=>cell).every(cell=>cell===12&&pattern.freeCenter||pattern.cells.includes(cell));}
function findRound(plan,id){const round=roundBlocks(plan).find(block=>block.id===id);if(!round)throw Error('Deze ronde bestaat niet meer. Open het draaiboek opnieuw.');return round;}
function goalPattern(plan,goal){return plan.patterns.find(pattern=>pattern.id===goal.patternId);}
export function addRound(plan,{production='milo',speakerId=plan.leadId}={}){
 const rounds=roundBlocks(plan);if(rounds.length>=8)throw Error('Een show ondersteunt maximaal acht rondes.');if(plan.blocks.length>=100)throw Error('Het draaiboek heeft al honderd showmomenten.');
 const round=createBlock('round',plan,production);round.speakerId=speakerId||production;round.interval=production==='milo'?15:4;round.newBoard=true;
 const suggested=production==='milo'?(rounds.length===3?['patroon-vol']:['patroon-hoeken','patroon-boven-onder','patroon-vol']):[];
 const available=suggested.filter(id=>plan.patterns.some(pattern=>pattern.id===id));
 if(available.length)round.goals=available.map(patternId=>({id:newId('doel'),patternId,prizeId:rounds.length===3&&plan.prizes.some(prize=>prize.id==='prijs-hoofdprijs')?'prijs-hoofdprijs':plan.prizes[0]?.id||''}));
 if(production==='milo'&&rounds.length===3)round.title='Finaleronde';
 const ending=plan.blocks.findIndex(block=>block.type==='finale');plan.blocks.splice(ending<0?plan.blocks.length:ending,0,round);return round;
}
export function removeRound(plan,id){if(roundBlocks(plan).length<=1)throw Error('Behoud minstens één bingoronde.');const round=findRound(plan,id);plan.blocks.splice(plan.blocks.indexOf(round),1);}
export function moveRound(plan,id,delta){
 const rounds=roundBlocks(plan),round=findRound(plan,id),index=rounds.indexOf(round),other=rounds[index+delta];if(!other)return false;
 const first=plan.blocks.indexOf(round),second=plan.blocks.indexOf(other);[plan.blocks[first],plan.blocks[second]]=[plan.blocks[second],plan.blocks[first]];return true;
}
export function addRoundGoal(plan,id){
 const round=findRound(plan,id);if(round.goals.length>=10)throw Error('Een ronde ondersteunt maximaal tien prijsstappen.');
 const existing=new Set(round.goals.map(goal=>goal.patternId)),hasFull=round.goals.some(goal=>fullCardPattern(goalPattern(plan,goal))),preferred=['patroon-hoeken','patroon-boven-onder','patroon-vol'].map(patternId=>plan.patterns.find(pattern=>pattern.id===patternId));
 const candidate=preferred.find(pattern=>pattern&&!existing.has(pattern.id)&&(!hasFull||!fullCardPattern(pattern)))||plan.patterns.find(pattern=>!existing.has(pattern.id)&&!fullCardPattern(pattern))||plan.patterns.find(pattern=>!fullCardPattern(pattern))||(!hasFull&&plan.patterns[0]);
 if(!candidate)throw Error('Maak eerst een ander speelpatroon aan. Volle kaart sluit de ronde af.');
 const goal={id:newId('doel'),patternId:candidate.id,prizeId:plan.prizes[0]?.id||''},full=round.goals.findIndex(value=>fullCardPattern(goalPattern(plan,value)));
 round.goals.splice(full<0?round.goals.length:full,0,goal);return goal;
}
export function removeRoundGoal(plan,id,goalId){const round=findRound(plan,id);if(round.goals.length<=1)throw Error('Behoud minstens één patroon en prijs in deze ronde.');const index=round.goals.findIndex(goal=>goal.id===goalId);if(index>=0)round.goals.splice(index,1);}
export function changeRoundGoal(plan,id,goalId,field,value){
 const round=findRound(plan,id),goal=round.goals.find(item=>item.id===goalId);if(!goal)throw Error('Deze prijsstap bestaat niet meer.');
 if(!['patternId','prizeId'].includes(field))throw Error('Kies een patroon of prijs.');
 if(!(field==='patternId'?plan.patterns:plan.prizes).some(item=>item.id===value))throw Error('Kies een bestaand patroon of een bestaande prijs.');
 if(field==='patternId'&&fullCardPattern(plan.patterns.find(pattern=>pattern.id===value))&&round.goals.some(item=>item.id!==goalId&&fullCardPattern(goalPattern(plan,item))))throw Error('Deze ronde heeft al een volle kaart. Die sluit de ronde af.');
 goal[field]=value;
 if(field==='patternId'&&fullCardPattern(goalPattern(plan,goal))){round.goals.splice(round.goals.indexOf(goal),1);round.goals.push(goal);}
}
export function canMoveRoundGoal(plan,round,goalId,delta){
 const index=round.goals.findIndex(goal=>goal.id===goalId),next=index+delta;if(index<0||next<0||next>=round.goals.length)return false;
 const goal=round.goals[index],other=round.goals[next];return !fullCardPattern(goalPattern(plan,goal))&&!fullCardPattern(goalPattern(plan,other));
}
export function moveRoundGoal(plan,id,goalId,delta){const round=findRound(plan,id);if(!canMoveRoundGoal(plan,round,goalId,delta))throw Error('Volle kaart blijft de laatste prijsstap van de ronde.');const index=round.goals.findIndex(goal=>goal.id===goalId);[round.goals[index],round.goals[index+delta]]=[round.goals[index+delta],round.goals[index]];}
