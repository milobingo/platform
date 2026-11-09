import {dispatchMailEvent} from './mail-service.js';
import {showBrand} from './show-brands.js';

export function recordAccountWelcome(family,{accountId,email,brandId,name},now=Date.now()){
 if(!['milo','vlampie'].includes(brandId))throw Object.assign(new Error('Kies een geldige showwereld.'),{status:400});
 family.welcomeMailEvents??={};
 family.welcomeMailEvents[brandId]??={eventId:`account/${accountId}/welcome/${brandId}/1`,brandId,email,name,createdAt:now};
 return family.welcomeMailEvents[brandId];
}
export async function recoverAccountWelcome({env,family,identity,brandId,origin}){
 const event=family.welcomeMailEvents?.[brandId];
 if(!event||event.email!==identity.email)return {status:'blocked',reason:'verified_recipient_changed'};
 const brand=showBrand(brandId);
 return dispatchMailEvent({env,eventId:event.eventId,templateId:'welcome',brandId,ownerId:'system',repairPreparation:true,origin,
  context:{voornaam:event.name,gezinsnaam:family.ownerName||event.name,organisatie_naam:brand.title,organisatie_email:env.MAIL_ORGANIZATION_EMAIL||'organisatie@voorbeeld.invalid',account_link:new URL('/spelen?brand='+brandId,origin).href},
  recipient:{accountId:identity.user,email:identity.email,name:event.name}});
}
