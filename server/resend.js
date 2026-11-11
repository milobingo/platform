import {platformIdentity} from './player-identity.js';
import {readPrivateSetting,writePrivateSetting,settingsReady,secretFingerprint,providerTestReceipt,assertProviderSettingsLease} from './secrets.js';
import {withProviderSettingsLock} from './node-provider-settings.js';

const SETTING='native-provider-resend';
const actions=['save','test','remove','environment'];
export const resendError=(message,status=409,code='resend_settings')=>Object.assign(new Error(message),{status,code});
export const validMailAddress=value=>typeof value==='string'&&value.length<=254&&/^[A-Za-z0-9.!#$%&*+/=?^_{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/.test(value)&&!value.toLowerCase().endsWith('.invalid');
export function validateResend(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||typeof value.key!=='string'||!/^re_[A-Za-z0-9_-]{16,200}$/.test(value.key))throw resendError('Vul een geldige Resend API-sleutel in. Een leeg sleutelveld behoudt de bestaande sleutel.',400);
 if(!validMailAddress(value.from))throw resendError('Vul een geldig afzenderadres in op je geverifieerde Resend-domein.',400);
 if(typeof value.replyTo!=='string'||value.replyTo&&!validMailAddress(value.replyTo))throw resendError('Vul een geldig antwoordadres in of laat dit veld leeg.',400);
 return {key:value.key,from:value.from.toLowerCase(),replyTo:value.replyTo.toLowerCase()};
}
export const resendFingerprint=value=>secretFingerprint(JSON.stringify([value.key,value.from,value.replyTo]));
export function validateResendDelivery(mode,recipients){
 if(!['disabled','allowlist','live'].includes(mode)||!Array.isArray(recipients)||recipients.length>100||recipients.some(x=>typeof x!=='string'))throw resendError('Kies een geldige verzendmodus en maximaal 100 ontvangers.',400);
 const allowed=[...new Set(recipients.map(x=>x.trim().toLowerCase()))];
 if(allowed.some(x=>!validMailAddress(x))||mode==='allowlist'&&!allowed.length)throw resendError('Vul voor de ontvangerlijst geldige e-mailadressen in.',400);
 return {deliveryMode:mode,allowedRecipients:allowed};
}
export function mailDeliveryPolicy(env,selected=null){
 const environment=env.MAIL_ENVIRONMENT||'',hostMode=env.MAIL_MODE??null;
 let mode=selected?.deliveryMode??hostMode??'disabled',recipients=selected?.allowedRecipients??String(env.MAIL_ALLOWED_RECIPIENTS||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);
 const disabled=reason=>({allowed:false,mode,environment,recipients:[],reason});
 if(mode==='disabled')return {allowed:false,mode,environment,recipients:[],reason:'Verzending staat uit. Opslaan en de domeincontrole versturen geen e-mail.'};
 if(!['allowlist','live'].includes(mode)||!['staging','production'].includes(environment)||mode==='live'&&environment!=='production')return disabled('De verzendmodus past niet bij deze serveromgeving. Staging kan uitsluitend naar een ontvangerlijst verzenden.');
 if(mode==='allowlist'&&(!recipients.length||recipients.some(x=>!validMailAddress(x))))return disabled('Verzending vereist een geldige ontvangerlijst.');
 if(selected&&hostMode!==null){
  if(hostMode==='disabled')return disabled('Verzending is door de serverbeheerder geblokkeerd. Je gekozen instellingen blijven bewaard.');
  if(!['allowlist','live'].includes(hostMode)||hostMode==='live'&&environment!=='production')return disabled('De serverlimiet voor mailverzending is niet geldig. Laat de beheerder deze controleren.');
  if(hostMode==='allowlist'){
   const hostRecipients=String(env.MAIL_ALLOWED_RECIPIENTS||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);
   if(!hostRecipients.length||hostRecipients.some(x=>!validMailAddress(x)))return disabled('De serverlimiet vereist een geldige ontvangerlijst.');
   recipients=mode==='allowlist'?recipients.filter(x=>hostRecipients.includes(x)):hostRecipients;mode='allowlist';
   if(!recipients.length)return disabled('Geen gekozen ontvanger staat op de door de serverbeheerder toegestane lijst.');
  }
 }
 return {allowed:true,mode,environment,recipients,reason:mode==='allowlist'?'Alleen ontvangers op de serverlijst kunnen mail ontvangen.':'Verzending is op de productieserver vrijgegeven.'};
}
export async function resendSettings(env){
 const saved=await readPrivateSetting(env,SETTING),record=saved.value;
 if(saved.revision!==null&&(!record||record.version!==1||!['regie','environment','disabled'].includes(record.mode)))throw resendError('De opgeslagen Resend-instellingen kunnen niet veilig worden gelezen.',503,'settings_unavailable');
 let value={key:'',from:'',replyTo:''};
 if(record?.mode==='regie'){
  try{value=validateResend(record.credentials);}catch{throw resendError('De opgeslagen Resend-instellingen zijn ongeldig. Een andere mailroute wordt niet als vervanging gebruikt.',503,'settings_unavailable');}
 }
 let delivery;try{delivery=validateResendDelivery(record?.deliveryMode??'disabled',record?.allowedRecipients??[]);}catch{throw resendError('De opgeslagen verzendmodus kan niet veilig worden gelezen.',503,'settings_unavailable');}
 const fingerprint=await resendFingerprint(value),connectionTest=record?.fingerprint===fingerprint?providerTestReceipt(record.connectionTest):null;
 return {revision:saved.revision,mode:record?.mode||'environment',value,...delivery,connectionTest:connectionTest||{tested:false,testedAt:null}};
}
export function publicResend(saved,env){
 const native=env.NATIVE_PROVIDER_SETTINGS===true,environmentConfigured=!!env.ORDER_MAIL_DELIVERY&&typeof env.ORDER_MAIL_DELIVERY.send==='function';
 const direct=saved.mode==='regie',disabled=saved.mode==='disabled',configured=direct||!disabled&&environmentConfigured,policy=mailDeliveryPolicy(env,direct?saved:null);
 const from=direct?saved.value.from:disabled?'':env.MAIL_FROM||env.MAIL_ORGANIZATION_EMAIL||env.VLAMPIE_ADMIN_EMAIL||'';
 const sendingAllowed=configured&&policy.allowed;
 return {configured,keyConfigured:direct&&!!saved.value.key,canManage:native&&settingsReady(env),source:direct?'regie':!disabled&&environmentConfigured?'environment':'none',disabled,environmentConfigured,revision:saved.revision,from,replyTo:direct?saved.value.replyTo:'',connectionTest:saved.connectionTest,deliveryEnabled:sendingAllowed,sendingAllowed,deliveryMode:direct?saved.deliveryMode:policy.mode,effectiveDeliveryMode:policy.allowed?policy.mode:'disabled',allowedRecipients:direct?saved.allowedRecipients:policy.recipients,environment:policy.environment,hostPolicy:{mode:env.MAIL_MODE??null,limited:env.MAIL_MODE!==undefined},route:direct?'resend':!disabled&&environmentConfigured?'dg-gateway':'none',deliveryReason:!configured?'Sla een Resend-sleutel en afzender op of gebruik de bestaande serverkoppeling.':direct?policy.reason:'De bestaande servergateway bepaalt de toegestane verzending. Een Resend-sleutel is hier niet ingesteld.'};
}
export async function readResendJson(response,maxBytes=65536){
 const reader=response.body?.getReader();if(!reader)throw resendError('Resend gaf geen leesbare bevestiging.',502,'resend_response');
 const parts=[];let size=0;
 try{for(;;){const item=await reader.read();if(item.done)break;size+=item.value.byteLength;if(size>maxBytes){await reader.cancel();throw resendError('Resend gaf geen begrensde bevestiging.',502,'resend_response');}parts.push(item.value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}
 try{return JSON.parse(new TextDecoder().decode(bytes));}catch{throw resendError('Resend gaf geen leesbare bevestiging.',502,'resend_response');}
}
export async function testResendDomain(value,fetcher=fetch,{signal}={}){
 const domain=value.from.split('@')[1];let after='';
 for(let page=0;page<5;page++){
  let response;
  try{response=await fetcher('https://api.resend.com/domains?limit=100'+(after?'&after='+encodeURIComponent(after):''),{method:'GET',headers:{Authorization:'Bearer '+value.key,Accept:'application/json'},redirect:'error',cache:'no-store',signal:AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(12000)])});}
  catch{throw resendError('De Resend-domeincontrole kon niet worden bevestigd. Je opgeslagen gegevens blijven bewaard; er is geen e-mail verstuurd.',502,'resend_connection');}
  if(!response.ok){await response.body?.cancel();throw resendError(response.status===403?'Deze sleutel geeft geen toegang tot de domeincontrole. Een sleutel met alleen verzendrecht kan geldig zijn; er is geen testmail verstuurd.':response.status===401?'Resend accepteert deze sleutel niet. Controleer de opgeslagen API-sleutel.':'De Resend-domeincontrole kon niet worden bevestigd. Er is geen e-mail verstuurd.',502,'resend_connection');}
  const data=await readResendJson(response);
  if(!Array.isArray(data?.data))throw resendError('Resend gaf geen geldige domeincontrole terug.',502,'resend_response');
  const match=data.data.find(row=>row&&typeof row.name==='string'&&row.name.toLowerCase()===domain);
  if(match){if(match.status!=='verified')throw resendError('Het afzenderdomein is bij Resend nog niet geverifieerd. Controleer de DNS-instellingen in Resend; er is geen e-mail verstuurd.',502,'resend_domain');return;}
  if(data.has_more!==true)break;
  const next=data.data.at(-1)?.id;if(typeof next!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(next)||next===after)throw resendError('De Resend-domeincontrole is niet volledig.',502,'resend_response');after=next;
 }
 throw resendError('Het afzenderdomein is niet bevestigd in dit Resend-account. Controleer het domein en de rechten van de sleutel; er is geen e-mail verstuurd.',502,'resend_domain');
}
export async function manageResendSettings(request,env,body,fetcher=fetch){
 if(request.method==='GET')return publicResend(await resendSettings(env),env);
 return withProviderSettingsLock(env,async locked=>{
  if(!locked.NATIVE_PROVIDER_SETTINGS||!settingsReady(locked))throw resendError('De beveiligde instellingenopslag is niet beschikbaar.',503,'settings_unavailable');
  const saved=await resendSettings(locked);
  if(!actions.includes(body.action)||!(body.revision===null||typeof body.revision==='string'&&body.revision.length>0&&body.revision.length<=128))throw resendError('Ververs de instellingen en kies een geldige actie.',400);
  if(body.revision!==saved.revision)throw resendError('De instellingen zijn gewijzigd. Herlaad deze pagina.',409,'settings_conflict');
  let mode=saved.mode,value=saved.value,deliveryMode=saved.deliveryMode,allowedRecipients=saved.allowedRecipients,connectionTest={tested:false,testedAt:null},failure;
  if(body.action==='test'){
   if(['key','from','replyTo','deliveryMode','allowedRecipients'].some(field=>body[field]!==undefined))throw resendError('Sla wijzigingen eerst op. De controle gebruikt alleen de opgeslagen Resend-koppeling.',400);
   if(mode!=='regie')throw resendError('Sla eerst een Resend-sleutel en afzender op. De bestaande servergateway wordt hier niet getest.',409);
   try{await testResendDomain(value,fetcher,{signal:request.signal});connectionTest={tested:true,testedAt:Date.now()};}catch(error){connectionTest={tested:false,testedAt:Date.now()};failure=error;}
  }else if(body.action==='save'){
   if(['key','from','replyTo'].some(field=>body[field]!==undefined&&typeof body[field]!=='string'))throw resendError('Gebruik tekstvelden voor de Resend-instellingen.',400);
   value=validateResend({key:body.key?.trim()||value.key,from:body.from===undefined?value.from:body.from.trim(),replyTo:body.replyTo===undefined?value.replyTo:body.replyTo.trim()});
   ({deliveryMode,allowedRecipients}=validateResendDelivery(body.deliveryMode===undefined?deliveryMode:body.deliveryMode,body.allowedRecipients===undefined?allowedRecipients:body.allowedRecipients));
   if(deliveryMode==='live'&&locked.MAIL_ENVIRONMENT!=='production')throw resendError('Vrije verzending is alleen op de productieserver beschikbaar. Gebruik op staging een ontvangerlijst.',400);
   mode='regie';
  }else{mode=body.action==='remove'?'disabled':'environment';value={key:'',from:'',replyTo:''};deliveryMode='disabled';allowedRecipients=[];}
  if(request.signal.aborted)throw resendError('De aanvraag is geannuleerd.',408,'cancelled');
  assertProviderSettingsLease(locked);
  const stored={version:1,mode,...(mode==='regie'?{credentials:value}:{}),deliveryMode,allowedRecipients,fingerprint:await resendFingerprint(value),connectionTest};
  const result=await writePrivateSetting(locked,SETTING,stored,saved.revision);if(!result)throw resendError('Een andere wijziging is net opgeslagen. Herlaad de instellingen.',409,'settings_conflict');
  if(failure)throw failure;
  return {...publicResend({...saved,mode,value,deliveryMode,allowedRecipients,connectionTest,revision:result.revision},locked),saved:true,tested:connectionTest.tested};
 });
}
const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
export async function handleResend(request,env,fetcher=fetch){
 const url=new URL(request.url);
 try{
  const identity=platformIdentity(request,env);
  if(!identity.user)throw resendError('Log in om de e-mailkoppeling te beheren.',401,'sign_in');
  if(!identity.admin||request.headers.get('x-vlampie-player')==='1'||url.searchParams.get('player')==='1')throw resendError('Alleen de regie kan de e-mailkoppeling beheren.',403,'owner_only');
  if(url.pathname!=='/api/resend/settings')throw resendError('Deze e-mailinstelling bestaat niet.',404);
  if(!['GET','POST'].includes(request.method))throw resendError('Deze aanvraag wordt niet ondersteund.',405);
  if(request.headers.get('sec-fetch-site')==='cross-site'||request.headers.get('origin')&&request.headers.get('origin')!==url.origin||request.method==='POST'&&(request.headers.get('origin')!==url.origin||request.headers.get('x-vlampie-settings')!=='1'))throw resendError('Open de e-mailkoppeling vanuit de regie.',403,'origin');
  let body={};if(request.method==='POST'){const raw=await request.text();if(raw.length>32768)throw resendError('De instellingen zijn te groot.',413);try{body=JSON.parse(raw);if(!body||typeof body!=='object'||Array.isArray(body))throw Error();}catch{throw resendError('De instellingen zijn niet leesbaar.',400);}}
  return json(await manageResendSettings(request,env,body,fetcher));
 }catch(error){return json({error:{code:error.code||'resend_unavailable',message:error.status?error.message:'De e-mailinstellingen konden niet veilig worden bevestigd. Je opgeslagen gegevens blijven bewaard.'}},error.status||503);}
}
