import {resendSettings,mailDeliveryPolicy} from './resend.js';
import {createResendMailDelivery} from './node-resend-mail.js';
// Imported prototype credentials cannot choose a native mail transport. Only an
// explicit native regie record can replace the existing server-owned gateway.
export async function mailConfig(env){
 if(env.NATIVE_PROVIDER_SETTINGS){
  const saved=await resendSettings(env);
  if(saved.mode!=='environment'){
   const active=saved.mode==='regie',value=saved.value,adapter=active?await createResendMailDelivery(env,value,{deliveryMode:saved.deliveryMode,allowedRecipients:saved.allowedRecipients,fetcher:env.MAIL_PROVIDER_FETCH||fetch}):null;
   return {revision:saved.revision,delivery:adapter,value:{configured:active,deliveryEnabled:!!adapter,deliveryReason:active?mailDeliveryPolicy(env,saved).reason:'De e-mailkoppeling is bewust uitgeschakeld.',contactReady:active,contactEmail:active?value.replyTo||value.from:'',from:active?value.from:'',source:active?'regie':'none',canManage:true,disabled:!active}};
  }
 }
 const adapter=env.ORDER_MAIL_DELIVERY;
 const contact=env.MAIL_ORGANIZATION_EMAIL||env.MAIL_FROM||env.VLAMPIE_ADMIN_EMAIL||'',contactReady=typeof contact==='string'&&/^[^\s@<>"'`]+@[^\s@<>"'`]+\.[^\s@<>"'`]+$/.test(contact)&&!contact.endsWith('.invalid');
 return {revision:null,delivery:adapter,value:{configured:!!adapter&&typeof adapter.send==='function'&&contactReady,deliveryEnabled:!!adapter&&typeof adapter.send==='function'&&contactReady,contactReady,contactEmail:contactReady?contact:'',from:contactReady?env.MAIL_FROM||contact:'',source:'environment',canManage:false}};
}
