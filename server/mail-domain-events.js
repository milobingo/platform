import {dispatchMailEvent,canRepairMailPreparation} from './mail-service.js';
import {orderMailContext} from './bingo-order-mail.js';
import {brandId} from './show-brands.js';
import {showTimeParts} from './show-time.js';
import {MailStore} from './mail-store.js';
import {digest} from './player-identity.js';

export async function recoverOrderMailEvents({env,game,origin,limit=5}){
 try{
 const pending=[];
 for(const order of game.orders||[])for(const event of order.serviceEvents||[])pending.push({order,event});
 const results=[],store=new MailStore(env.DB);let processed=0;
 for(const {order,event} of pending){
  if(processed>=Math.min(20,limit))break;
  const organization=event.templateId==='org-order-new',email=organization?env.MAIL_ORGANIZATION_EMAIL||env.VLAMPIE_ADMIN_EMAIL:order.email;
  if(!email){if(results.length<20)results.push({eventId:event.eventId,status:'blocked',reason:'organization_recipient_missing'});continue;}
  const id=await digest([brandId(game),event.templateId,event.eventId,email.trim().toLowerCase()].join('|'));
  const prior=await store.get(id);if(prior&&!canRepairMailPreparation(prior))continue;processed++;
  const context={...orderMailContext(game,order,origin),...(event.context||{})};
  if(event.previousDate){const before=showTimeParts(event.previousDate);Object.assign(context,{oude_show_datum:before.date,oude_show_tijd:before.time,wijziging_tekst:event.reason,vervolgstap:event.followUp});}
  results.push(await dispatchMailEvent({env,eventId:event.eventId,templateId:event.templateId,brandId:brandId(game),context,recipient:{accountId:organization?game.ownerId:order.accountId,email,name:organization?'Organisatie':order.customerName},ownerId:game.ownerId,origin,repairPreparation:true}));
 }
 return results;
 }catch{return [{status:'failed',reason:'mail_storage_unavailable'}];}
}
export function recordResultMailEvent(game,result,now=Date.now()){
 if(!result?.acknowledged||!result.id||!result.winner?.accountId)return false;
 result.mailEvent??={eventId:`result/${game.id}/${result.id}/published/1`,templateId:'prize-confirmed',createdAt:now};return true;
}
export async function dispatchPublishedPrizeMail({env,game,result,origin}){
 if(!result?.acknowledged||!result.mailEvent||result.mailEvent.templateId!=='prize-confirmed')return {status:'blocked'};
 const family=await env.DB.prepare('SELECT document FROM bingo_families WHERE account_id = ?').bind(result.winner.accountId).first();
 if(!family)return {status:'blocked'};const adult=JSON.parse(family.document),when=showTimeParts(game.date);
 return dispatchMailEvent({env,eventId:result.mailEvent.eventId,templateId:'prize-confirmed',brandId:brandId(game),ownerId:game.ownerId,origin,repairPreparation:true,
  context:{gezinsnaam:adult.ownerName||'Jullie gezin',show_naam:game.title,show_datum:when.date,show_tijd:when.time,winnaar_naam:result.winner.name,prijs_naam:result.prize.title,uitslag_bevestigd:true},
  recipient:{accountId:result.winner.accountId,email:adult.email,name:adult.ownerName||'Volwassen accountbeheerder'}});
}
