// Native deployment uses the server-owned DG adapter. Provider credentials and
// sender approval belong to the gateway, not to imported prototype settings.
export async function mailConfig(env){
 const adapter=env.ORDER_MAIL_DELIVERY;
 const contact=env.MAIL_ORGANIZATION_EMAIL||env.MAIL_FROM||env.VLAMPIE_ADMIN_EMAIL||'',contactReady=typeof contact==='string'&&/^[^\s@<>"'`]+@[^\s@<>"'`]+\.[^\s@<>"'`]+$/.test(contact)&&!contact.endsWith('.invalid');
 return {revision:null,value:{configured:!!adapter&&typeof adapter.send==='function'&&contactReady,contactReady,contactEmail:contactReady?contact:'',from:contactReady?env.MAIL_FROM||contact:'',source:'environment',canManage:false}};
}
