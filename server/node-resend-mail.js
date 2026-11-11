import {mailDeliveryPolicy,validMailAddress,validateResend,resendFingerprint,readResendJson,resendSettings} from './resend.js';
import {withProviderSettingsLock} from './node-provider-settings.js';
import {assertProviderSettingsLease} from './secrets.js';

// Explicit regie configuration selects this route; MAIL_MODE remains a separate
// host policy. Saving settings and checking domains never call this adapter.
export async function createResendMailDelivery(env,value,{deliveryMode='disabled',allowedRecipients=[],fetcher=fetch}={}){
 const policy=mailDeliveryPolicy(env,{deliveryMode,allowedRecipients});if(!policy.allowed)return null;
 let settings;try{settings=validateResend(value);}catch{return null;}
 const fingerprint=await resendFingerprint(settings);
 const deliver=async({message,context,idempotencyKey,signal},policy,lease={})=>{
   const allowed=new Set(policy.recipients);
   const recipient=message?.to?.length===1?String(message.to[0]).trim().toLowerCase():'';
   if(!validMailAddress(recipient)||policy.mode==='allowlist'&&!allowed.has(recipient)||typeof idempotencyKey!=='string'||!idempotencyKey||idempotencyKey.length>200)return {accepted:false,uncertain:false};
   const studio=context?.kind==='studio',transactional=['payment','ready'].includes(context?.kind);
   if(!studio&&!transactional||context?.marketing&&!studio)return {accepted:false,uncertain:false};
   const sender=typeof message.from==='string'?message.from.trim():'';
   const senderAddress=sender.match(/^"[^"\\\x00-\x1f\x7f]{1,120}" <([^<>]+)>$/)?.[1]||sender;
   // Never rewrite an old frozen sender after provider/sender rotation.
   if(senderAddress.toLowerCase()!==settings.from||!validMailAddress(senderAddress))return {accepted:false,uncertain:false};
   if(typeof message.subject!=='string'||!message.subject||message.subject.length>300||/[\x00-\x1f\x7f]/.test(message.subject)||typeof message.text!=='string'||!message.text||typeof message.html!=='string'||!message.html)return {accepted:false,uncertain:false};
   const headers=message.headers||{};
   if(typeof headers!=='object'||Array.isArray(headers)||Object.keys(headers).some(key=>!['List-Unsubscribe','List-Unsubscribe-Post'].includes(key)))return {accepted:false,uncertain:false};
   if(Object.keys(headers).length){
    let unsubscribe;try{const match=/^<([^<>\s]+)>$/.exec(headers['List-Unsubscribe']||'');unsubscribe=new URL(match?.[1]||'');}catch{return {accepted:false,uncertain:false};}
    if(unsubscribe.protocol!=='https:'||unsubscribe.origin!==env.APP_URL||unsubscribe.pathname!=='/mail/afmelden'||headers['List-Unsubscribe-Post']!=='List-Unsubscribe=One-Click')return {accepted:false,uncertain:false};
   }
   if(context?.marketing&&!Object.keys(headers).length)return {accepted:false,uncertain:false};
   const body=JSON.stringify({from:sender,to:[recipient],subject:message.subject,text:message.text,html:message.html,...(settings.replyTo?{reply_to:settings.replyTo}:{}),...(Object.keys(headers).length?{headers}:{})});
   if(new TextEncoder().encode(body).byteLength>300000)return {accepted:false,uncertain:false};
   try{assertProviderSettingsLease(lease);}catch{return {accepted:false,uncertain:false};}
   if(signal?.aborted||lease.PROVIDER_SETTINGS_SIGNAL?.aborted)return {accepted:false,uncertain:false};
   let response;try{response=await fetcher('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+settings.key,'Content-Type':'application/json','Idempotency-Key':idempotencyKey},body,redirect:'error',cache:'no-store',signal:AbortSignal.any([...(signal?[signal]:[]),...(lease.PROVIDER_SETTINGS_SIGNAL?[lease.PROVIDER_SETTINGS_SIGNAL]:[]),AbortSignal.timeout(Math.max(1,Math.min(10000,(lease.PROVIDER_SETTINGS_DEADLINE||Infinity)-Date.now())))])});}catch{return {accepted:false,uncertain:true};}
   if(!response.ok){await response.body?.cancel();return {accepted:false,uncertain:![400,401,403,404,405,413,422,429].includes(response.status)};}
   try{const receipt=await readResendJson(response,4096);if(typeof receipt.id!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(receipt.id))return {accepted:false,uncertain:true};return {accepted:true,messageId:'resend:'+receipt.id};}catch{return {accepted:false,uncertain:true};}
 };
 return Object.freeze({id:'resend-v1:'+fingerprint,idempotencyWindowMs:24*60*60*1000,supportsMarketing:true,
  async send(input){
   if(!env.NATIVE_PROVIDER_SETTINGS)return deliver(input,policy);
   return withProviderSettingsLock(env,async locked=>{
    // An adapter can wait behind a save/remove. Re-read the encrypted record
    // only after admission, so neither an old key nor an old recipient list can
    // authorize a provider contact after the settings operation has completed.
    if(locked.AUTH_IDENTITY?.admin){
     let role;try{role=await locked.DB?.prepare('SELECT role FROM app_user_roles WHERE user_id = ?').bind(locked.AUTH_IDENTITY.user).first();}catch{return {accepted:false,uncertain:false};}
     if(role?.role!=='regie')return {accepted:false,uncertain:false};
    }else if(input.context?.test||input.context?.marketing)return {accepted:false,uncertain:false};
    let current;try{current=await resendSettings(locked);}catch{return {accepted:false,uncertain:false};}
    if(current.mode!=='regie'||await resendFingerprint(current.value)!==fingerprint)return {accepted:false,uncertain:false};
    const latest=mailDeliveryPolicy(locked,current);if(!latest.allowed)return {accepted:false,uncertain:false};
    return deliver(input,latest,locked);
   });
  },
 });
}
