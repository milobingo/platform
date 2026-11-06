import {createHash,createHmac,randomUUID} from 'node:crypto';

// DG's signed transactional envelope; provider credentials and the approved
// sender belong to the Supabase worker, never to the browser or this adapter.
// Missing configuration keeps orders usable and their outbox visibly failed.
export function createOrderMailDelivery(env,{fetcher=fetch,now=Date.now,randomId=randomUUID}={}){
 const mode=env.MAIL_MODE||'disabled';
 if(mode==='disabled')return null;
 if(!['allowlist','live'].includes(mode)||!['staging','production'].includes(env.MAIL_ENVIRONMENT)||mode==='live'&&env.MAIL_ENVIRONMENT!=='production')return null;
 let origin,key;
 try{
  const url=new URL(env.SUPABASE_URL);
  if(url.protocol!=='https:'||!url.hostname.endsWith('.supabase.co')||url.username||url.password||url.port||url.pathname!=='/'||url.search||url.hash)return null;
  origin=url.origin;
  const encoded=String(env.SEND_EMAIL_HOOK_SECRET||'').replace(/^v1,/, '').replace(/^whsec_/, '');
  if(!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))return null;
  key=Buffer.from(encoded,'base64');
  if(key.length<32||key.toString('base64')!==encoded)return null;
 }catch{return null;}
 const allowed=new Set(String(env.MAIL_ALLOWED_RECIPIENTS||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean));
 const validEmail=value=>typeof value==='string'&&value.length<=320&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
 if(mode==='allowlist'&&(!allowed.size||[...allowed].some(x=>!validEmail(x))))return null;
 const endpoint=origin+'/functions/v1/send-email-hook';
 return Object.freeze({
  id:'dg-mail-v1:'+createHash('sha256').update(endpoint).update(key).digest('hex'),
  // The deployed gateway's reconciliation/retention contract has not yet been
  // supplied for Milo. Never invent a provider idempotency guarantee.
  idempotencyWindowMs:0,
  async send({message,context,idempotencyKey,signal}){
   const recipient=message?.to?.length===1?String(message.to[0]).trim().toLowerCase():'';
   if(!validEmail(recipient)||mode==='allowlist'&&!allowed.has(recipient))return {accepted:false,uncertain:false};
   if(!['payment','ready'].includes(context?.kind)||typeof idempotencyKey!=='string'||!idempotencyKey||idempotencyKey.length>200)return {accepted:false,uncertain:false};
   if(typeof message.subject!=='string'||!message.subject||message.subject.length>200||typeof message.text!=='string'||!message.text||typeof message.html!=='string'||!message.html)return {accepted:false,uncertain:false};
   // Stable correlation stays under the gateway's 100-character bound.
   const outboxId='milo-'+createHash('sha256').update(idempotencyKey).digest('hex');
   const body=JSON.stringify({kind:'transactional',message:{to:recipient,subject:message.subject,text:message.text,html:message.html,outboxId,messageType:'milo_order_'+context.kind,providerProbe:false}});
   if(Buffer.byteLength(body)>128000)return {accepted:false,uncertain:false};
   const id='msg_'+randomId(),timestamp=String(Math.floor(now()/1000));
   const signature=createHmac('sha256',key).update(`${id}.${timestamp}.${body}`).digest('base64');
   let response;
   try{
    response=await fetcher(endpoint,{method:'POST',headers:{'content-type':'application/json','webhook-id':id,'webhook-timestamp':timestamp,'webhook-signature':'v1,'+signature},body,redirect:'error',cache:'no-store',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(10000)]):AbortSignal.timeout(10000)});
   }catch{return {accepted:false,uncertain:true};}
   if(!response.ok){
    // An upstream timeout, store failure or reconciliation response may follow
    // a committed send. Only explicit validation/policy rejection is definite.
    return {accepted:false,uncertain:![400,401,403,405,413,422].includes(response.status)&&response.headers.get('x-mail-status')!=='deferred'};
   }
   const status=response.headers.get('x-mail-status'),provider=response.headers.get('x-mail-provider'),receipt=response.headers.get('x-provider-message-id');
   if(status==='validated')return {accepted:false,uncertain:false};
   if(status!=='accepted'||!['resend','sendgrid'].includes(provider)||!receipt||receipt.length>180||/[\x00-\x1f\x7f]/.test(receipt))return {accepted:false,uncertain:true};
   return {accepted:true,messageId:provider+':'+receipt};
  },
 });
}
