import {normalizeBingoPlan} from './bingo-model.js';

// A concept may still need its real prizes. Validate every other game rule
// using a temporary, internal reference, then remove it before persistence.
// Starting, publishing and producing cards keep using normalizeBingoPlan.
export function normalizeUnpricedDraft(input){
 const copy=structuredClone(input);
 const goals=(copy?.blocks||[]).filter(block=>block.type==='round').flatMap(round=>round.goals||[]);
 if(!goals.some(goal=>goal.prizeId===''))return normalizeBingoPlan(input);
 let id='draft-price-validation';while((copy.prizes||[]).some(prize=>prize.id===id))id+='-x';
 copy.prizes=[...(copy.prizes||[]),{id,title:'Conceptcontrole',description:'',image:''}];
 for(const goal of goals)if(goal.prizeId==='')goal.prizeId=id;
 const plan=normalizeBingoPlan(copy);
 plan.prizes=plan.prizes.filter(prize=>prize.id!==id);
 for(const round of plan.blocks.filter(block=>block.type==='round'))for(const goal of round.goals)if(goal.prizeId===id)goal.prizeId='';
 return plan;
}
export const maySaveUnpricedDraft=game=>game.brandId==='milo'&&game.status==='draft'&&!game.cancelledAt&&!game.books.length&&!(game.orders||[]).length&&!game.rulesPublication?.finalizedAt;
