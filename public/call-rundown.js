import {createBlock} from './plan-model.js';

export const RANDOM_CALL_LIMIT=2;
export const randomCallBlocks=plan=>(plan?.blocks||[]).filter(block=>block.type==='random-call');
export function callRundownSummary(plan){
 const random=randomCallBlocks(plan),rounds=(plan?.blocks||[]).filter(block=>block.type==='round');
 return {randomCount:random.length,randomReady:random.length===RANDOM_CALL_LIMIT,winnerRounds:rounds.map((round,index)=>({id:round.id,title:round.title,roundIndex:index,enabled:round.callFullCardWinner===true}))};
}
// This is called only for new shows or an explicit edit of an existing draft.
// Reading or normalizing a published/running plan never adds a call moment.
export function addMissingRandomCalls(plan){
 const existing=randomCallBlocks(plan);if(existing.length>=RANDOM_CALL_LIMIT)return [];
 const rounds=plan.blocks.filter(block=>block.type==='round'),added=[];
 for(let slot=existing.length;slot<RANDOM_CALL_LIMIT;slot++){
  const block=createBlock('random-call',plan,'milo');block.title=`Milo’s Magische Belletje ${slot+1}`;block.speakerId=plan.leadId||'milo';
  const preferred=rounds[slot===0?0:2],position=preferred?plan.blocks.findIndex(item=>item.id===preferred.id)+1:Math.max(0,plan.blocks.findIndex(item=>item.type==='finale'));
  plan.blocks.splice(position,0,block);added.push(block);
 }
 return added;
}
