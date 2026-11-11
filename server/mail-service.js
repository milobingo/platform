import {MailStore,MailError} from './mail-store.js';
import {mailConfig} from './mail-config.js';
import {readPrivateSetting,writePrivateSetting,settingsReady} from './secrets.js';
import {digest} from './player-identity.js';
import {MAIL_TEMPLATES,listMailTemplates,validateMailTemplate,renderMailTemplate,sampleMailContext} from './mail-templates.js';
import {SHOW_BRANDS,brandId as gameBrandId} from './show-brands.js';

export const mailBrand=value=>{if(!['milo','vlampie'].includes(value))throw new MailError('Kies Milo & Friends of Vlampie.');return value;};
const email=value=>{const result=String(value||'').trim().toLowerCase();if(!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(result)||result.length>254)throw new MailError('Een bevestigd e-mailadres ontbreekt.');return result;};
export async function readMailSettings(env,brandId){mailBrand(brandId);const saved=await readPrivateSetting(env,'studio-mail-'+brandId);return {revision:saved.revision,value:{newsletterEnabled:true,templates:{},...(saved.value||{})}};}
export async function readEffectiveMailTemplate(env,brandId,id){const settings=await readMailSettings(env,brandId);return validateMailTemplate(id,settings.value.templates?.[id]||{});}
export async function saveMailSettings(env,brandId,revision,change){if(!settingsReady(env))throw new MailError('De beveiligde e-mailopslag is nog niet ingesteld.',503);const current=await readMailSettings(env,brandId);if(current.revision!==revision)throw new MailError('De mailinstellingen zijn gewijzigd. Ververs eerst.',409,'mail_conflict');const next=structuredClone(current.value);change(next);const saved=await writePrivateSetting(env,'studio-mail-'+brandId,next,revision);if(!saved)throw new MailError('Een andere wijziging was eerder opgeslagen. Ververs eerst.',409,'mail_conflict');return saved;}
const maskedEmail=value=>String(value||'').replace(/^(.)([^@]*)(@.*)$/,'$1***$3');
export const projectOutbox=record=>({id:record.id,templateId:record.templateId,brandId:record.brandId,status:['sending','offering'].includes(record.status)&&record.leaseUntil<Date.now()?'uncertain':record.status==='claimed'&&record.leaseUntil<Date.now()?'pending':record.status,recipientEmail:maskedEmail(record.recipientEmail),recipientName:'Volwassen accountbeheerder',subject:record.templateId==='auth-code'?'Testmail · persoonlijke inlogcode':MAIL_TEMPLATES.find(t=>t.id===record.templateId)?.name||'Servicebericht',createdAt:record.createdAt,acceptedAt:record.acceptedAt||null,error:record.error||null,campaignId:record.campaignId||null,test:!!record.test,canRetry:record.status==='failed'&&!record.uncertain&&!!record.payloadReady});
export const projectCampaign=record=>({id:record.id,brandId:record.brandId,name:record.name,revision:record.revision,status:record.status,template:record.template,templateId:record.templateId||'newsletter',showId:record.showId||null,newsletterTitle:record.newsletterTitle||'',newsletterText:record.newsletterText||'',changeText:record.changeText||'',stats:record.stats||{total:0,pending:0,accepted:0,failed:0,uncertain:0,skipped:0},createdAt:record.createdAt,updatedAt:record.updatedAt});
// Preparation can be repaired only before any possible provider contact. A
// stable domain event must supply the original binding again; this is not a
// general failed-delivery retry or a way to replace an existing frozen payload.
export const canRepairMailPreparation=record=>record?.kind==='delivery'&&record.status==='failed'&&record.payloadReady===false&&!record.uncertain&&!(record.attempts>0)&&!record.attemptId&&!record.offeredAt&&!record.acceptedAt&&!record.providerId;
const sameEventBinding=(record,binding)=>['id','brandId','ownerId','templateId','recipientEmail'].every(key=>record[key]===binding[key])&&['campaignId','accountId'].every(key=>(record[key]||null)===(binding[key]||null))&&!!record.test===!!binding.test&&(!record.eventId||record.eventId===binding.eventId);
async function orderOutbox(env,brandId,ownerId){
 const rows=(await env.DB.prepare('SELECT id,document FROM bingo_games ORDER BY updated_at DESC LIMIT 300').all()).results,result=[];
 for(const row of rows){const game=JSON.parse(row.document);if(gameBrandId(game)!==brandId||ownerId&&game.ownerId!==ownerId)continue;for(const order of game.orders||[])for(const [field,templateId] of [['paymentMail','payment-link'],['readyMail','books-ready']]){const mail=order[field];if(!mail||mail.status==='not_sent')continue;result.push({id:'order:'+game.id+':'+order.id+':'+field,source:'order',templateId,brandId,status:mail.status==='sent'?'accepted':mail.uncertain?'uncertain':mail.status==='sending'&&mail.leaseUntil<Date.now()?'uncertain':mail.status,recipientEmail:maskedEmail(order.email),recipientName:'Volwassen accountbeheerder',subject:templateId==='payment-link'?'Betaallink · '+order.number:'Bingobladen klaar · '+order.number,createdAt:mail.firstAttemptAt||order.updatedAt||order.createdAt,acceptedAt:mail.sentAt||null,error:mail.error||null,canRetry:false,href:'#/orders',gameId:game.id,orderId:order.id});}}
 return result;
}
export async function mailState(env,brandId){
 const ownerId=env.AUTH_IDENTITY?.user;
 const store=new MailStore(env.DB),settings=await readMailSettings(env,brandId),config=await mailConfig(env),subscribers=await store.subscribers(brandId),families=(await env.DB.prepare('SELECT count(*) AS total FROM bingo_families').first())?.total||0;
 const outbox=[...(await store.list('delivery',brandId)).filter(r=>!ownerId||r.ownerId===ownerId).map(projectOutbox),...await orderOutbox(env,brandId,ownerId)].sort((a,b)=>(b.createdAt||0)-(a.createdAt||0)).slice(0,200);
 return {brandId,revision:settings.revision,settings:{newsletterEnabled:settings.value.newsletterEnabled!==false},templates:listMailTemplates(brandId,settings.value.templates).map(t=>t.id==='auth-code'?{...t,editable:false,triggerLabel:'Supabase Auth · beheer buiten deze studio'}:t),campaigns:(await store.list('campaign',brandId)).filter(r=>!ownerId||r.ownerId===ownerId).map(projectCampaign),outbox,audience:{subscribed:new Set(subscribers.map(r=>r.email)).size,total:families},provider:{configured:config.value.configured,deliveryEnabled:config.value.deliveryEnabled,deliveryReason:config.value.deliveryReason||'',from:config.value.from||'',source:config.value.source,canManage:env.NATIVE_PROVIDER_SETTINGS===true&&settingsReady(env),marketingAvailable:config.delivery?.supportsMarketing===true,assetBaseConfigured:!!env.MAIL_ASSET_BASE_URL}};
}
async function frozenPayload(env,id){return (await readPrivateSetting(env,'mail-message-'+id)).value;}
async function persistPayload(env,id,payload){if(!settingsReady(env))return false;const prior=await readPrivateSetting(env,'mail-message-'+id);if(prior.value)return true;const saved=await writePrivateSetting(env,'mail-message-'+id,payload,null);return !!saved||!!(await readPrivateSetting(env,'mail-message-'+id)).value;}
async function deliveryPolicy(env,record,store,adapter=env.ORDER_MAIL_DELIVERY){
 if(!record.test&&(await readEffectiveMailTemplate(env,record.brandId,record.templateId)).enabled===false)return 'Dit mailtemplate is uitgeschakeld.';
 if(record.marketing&&!record.test){
  if((await readMailSettings(env,record.brandId)).value.newsletterEnabled===false)return 'De nieuwsbriefmodule is uitgeschakeld.';
  if(!await store.stillSubscribed(record.accountId,record.recipientEmail,record.brandId))return 'Toestemming ontbreekt of is ingetrokken voor deze showwereld.';
  const campaign=record.campaignId?await store.get(record.campaignId):null;
  if(!campaign||campaign.kind!=='campaign'||campaign.brandId!==record.brandId||campaign.ownerId!==record.ownerId||!['prepared','sending','completed'].includes(campaign.status))return 'De campagne is niet meer geldig.';
  if(adapter?.supportsMarketing!==true)return 'De ingestelde gateway is nog niet vrijgegeven voor marketing.';
 }
 return '';
}
export async function sendOutbox({env,id,fetcher=fetch,retry=false}){
 const store=new MailStore(env.DB),now=Date.now(),before=await store.get(id);
 if(!before||before.kind!=='delivery')throw new MailError('Dit mailbericht bestaat niet.',404);
 if(['accepted','delivered','bounced','skipped','blocked','uncertain'].includes(before.status)||before.uncertain)return {id,status:before.status,message:'Deze poging wordt niet automatisch herhaald.'};
 if(['offering','sending'].includes(before.status)){
  if(before.leaseUntil>now)return {id,status:before.status,message:'Een aanbieding is nog bezig.'};
  await store.mutate(id,r=>{if(['offering','sending'].includes(r.status)&&r.leaseUntil<=now){r.status='uncertain';r.uncertain=true;r.error='De aanbieding is onderbroken. Controleer de gateway; niet opnieuw aanbieden.';}});
  return {id,status:'uncertain',message:'De eerdere aanbieding moet worden onderzocht.'};
 }
 if(before.status==='claimed'&&before.leaseUntil>now)return {id,status:'claimed',message:'Een andere worker bereidt dit bericht voor.'};
 if(before.status==='failed'&&!retry)return {id,status:'failed',message:before.error};
 const resolved=await mailConfig(env),adapter=resolved.delivery,config=resolved.value;
 const policy=await deliveryPolicy(env,before,store,adapter);
 if(policy){await store.mutate(id,r=>{if(['pending','claimed','failed'].includes(r.status)){r.status='blocked';r.leaseUntil=0;r.error=policy;}});return {id,status:'blocked',message:policy};}
 if(!adapter||typeof adapter.send!=='function'||!config.contactReady){
  const reason=config.deliveryReason||'De mailgateway is nog niet ingesteld. Het bericht blijft bewaard.';
  await store.mutate(id,r=>{if(['pending','claimed','failed'].includes(r.status)){r.status='failed';r.error=reason;}});
  return {id,status:'failed',message:reason};
 }
 let payload=await frozenPayload(env,id);
 if(!payload){const missing=await store.mutate(id,r=>{if(!['pending','failed'].includes(r.status)||r.uncertain||r.attempts>0||r.offeredAt||r.acceptedAt||r.providerId)return false;r.status='failed';r.payloadReady=false;r.error='De beveiligde berichtopslag ontbreekt.';return true;});return {id,status:missing.record.status,message:'De beveiligde berichtopslag ontbreekt.'};}
 if(payload.__pendingContact&&!(before.attempts>0)){
  const pending=payload.__pendingContact,current=await readPrivateSetting(env,'mail-message-'+id);
  const bound=renderMailTemplate(pending.templateId,{...pending,context:{...pending.context,organisatie_email:config.contactEmail},from:config.from});
  if(before.test){bound.subject='[TEST · VOORBEELD] '+bound.subject;bound.text='TESTMAIL · ALLE GEGEVENS ZIJN FICTIEF.\n\n'+bound.text;bound.html=bound.html.replace(/(<body[^>]*>)/i,'$1<div>TESTMAIL · FICTIEVE VOORBEELDGEGEVENS</div>');}
  if(!await writePrivateSetting(env,'mail-message-'+id,bound,current.revision))return {id,status:'failed',message:'Een andere voorbereiding heeft het bericht gewijzigd.'};payload=bound;
 }
 const attemptId=crypto.randomUUID(),claim=await store.mutate(id,r=>{
  if(!['pending',...(retry?['failed']:[]),'claimed'].includes(r.status)||r.status==='claimed'&&r.leaseUntil>now||r.uncertain)return false;
  r.status='claimed';r.attemptId=attemptId;r.leaseUntil=now+30000;r.error=null;return true;
 });
 if(!claim.result)return {id,status:claim.record.status,message:'Een andere verzendpoging is bezig.'};
 // A claimed lease can be recovered before contact. Offering is durably marked
 // before the only outbound call; an interrupted offering is always uncertain.
 const current=await store.get(id),latePolicy=await deliveryPolicy(env,current,store,adapter);
 if(latePolicy){await store.mutate(id,r=>{if(r.attemptId===attemptId){r.status='blocked';r.leaseUntil=0;r.error=latePolicy;}});return {id,status:'blocked',message:latePolicy};}
 const offered=await store.mutate(id,r=>{if(r.attemptId!==attemptId||r.status!=='claimed'||r.leaseUntil<Date.now())return false;r.status='offering';r.attempts=(r.attempts||0)+1;r.offeredAt=Date.now();return true;});
 if(!offered.result)return {id,status:offered.record.status,message:'De verzendlease is verlopen.'};
 let status='uncertain',providerId=null,message='De gateway heeft de ontvangst niet bevestigd. Controleer de provider voordat je opnieuw aanbiedt.';
 try{
  const receipt=await adapter.send({message:structuredClone(payload),context:{kind:'studio',templateId:before.templateId,brandId:before.brandId,marketing:!!before.marketing,test:!!before.test},idempotencyKey:'studio-mail/'+id,signal:AbortSignal.timeout(6000)});
  if(receipt?.accepted===true&&typeof receipt.messageId==='string'&&receipt.messageId.length>0&&receipt.messageId.length<=200&&!/[\x00-\x1f\x7f]/.test(receipt.messageId)){status='accepted';providerId=receipt.messageId;message='Door de mailgateway aangenomen; aflevering is niet bewezen.';}
  else if(receipt?.accepted===false&&receipt.uncertain===false){status='failed';message='De mailgateway heeft deze aanbieding aantoonbaar niet geaccepteerd.';}
 }catch{}
 try{await store.mutate(id,r=>{if(r.attemptId!==attemptId)return false;r.status=status;r.uncertain=status==='uncertain';r.leaseUntil=0;r.providerId=providerId;r.acceptedAt=status==='accepted'?Date.now():null;r.error=status==='accepted'?null:message;});}
 catch{status='uncertain';message='De ontvangststatus kon niet veilig worden opgeslagen. Niet automatisch opnieuw aanbieden.';}
 return {id,status,message};
}
export async function processOutboxBatch({env,ownerId,brandId,limit=5}){
 const rows=(await new MailStore(env.DB).list('delivery',brandId,2000)).filter(r=>r.ownerId===ownerId&&(r.status==='pending'||r.status==='claimed'&&r.leaseUntil<=Date.now()||['offering','sending'].includes(r.status)&&r.leaseUntil<=Date.now())).slice(0,Math.min(5,limit));
 return Promise.all(rows.map(r=>sendOutbox({env,id:r.id})));
}
/** Stable domain event + adult recipient + brand deduplication. Never make an
 * existing game/account mutation fail because a mail provider is unavailable. */
export async function dispatchMailEvent({env,eventId,templateId,brandId,context,recipient,origin,fetcher=fetch,ownerId='system',campaignId=null,template:override=null,test=false,repairPreparation=false}){
 let id,store;try{
  mailBrand(brandId);const to=email(recipient.email);if(typeof eventId!=='string'||!eventId||eventId.length>300)throw new MailError('Ongeldige mailgebeurtenis.');id=await digest([brandId,templateId,eventId,to].join('|'));store=new MailStore(env.DB);const binding={id,eventId,brandId,ownerId,templateId,recipientEmail:to,campaignId,accountId:recipient.accountId||null,test},prior=await store.get(id);if(prior&&(!repairPreparation||!canRepairMailPreparation(prior)||!sameEventBinding(prior,binding)))return {id,status:projectOutbox(prior).status,message:'Dit bericht is al geregistreerd.'};
  const effective=await readEffectiveMailTemplate(env,brandId,templateId),template=override?validateMailTemplate(templateId,override):effective,config=(await mailConfig(env)).value,enabled=test||effective.enabled!==false&&template.enabled!==false;
  if(!enabled){if(prior)return {id,status:prior.status,message:'Dit mailtemplate is uitgeschakeld.'};const now=Date.now();await store.create({...binding,kind:'delivery',recipientName:String(recipient.name||'').slice(0,100),subject:MAIL_TEMPLATES.find(t=>t.id===templateId)?.name||'Uitgeschakelde mail',status:'skipped',payloadReady:false,createdAt:now,updatedAt:now});return {id,status:'skipped',message:'Dit mailtemplate is uitgeschakeld.'};}
  const data={...context};if(templateId==='newsletter'||campaignId){if(!(await readMailSettings(env,brandId)).value.newsletterEnabled)throw new MailError('De nieuwsbriefmodule is uitgeschakeld.',409);data.afmeldlink=await store.unsubscribeLink(to,brandId,origin);}
  const payload=renderMailTemplate(templateId,{brandId,template,context:data,origin,assetBaseUrl:env.MAIL_ASSET_BASE_URL,unsubscribeUrl:campaignId?data.afmeldlink:undefined,from:config.from||'nog-instellen@voorbeeld.invalid',to});
  if(!config.contactReady)payload.__pendingContact={templateId,brandId,template,context:data,origin,assetBaseUrl:env.MAIL_ASSET_BASE_URL,unsubscribeUrl:campaignId?data.afmeldlink:undefined,to};
  if(test){payload.subject='[TEST · VOORBEELD] '+payload.subject;payload.text='TESTMAIL · ALLE GEGEVENS ZIJN FICTIEF. Dit is geen echte prijs, bestelling of geldige inlogcode.\n\n'+payload.text;payload.html=payload.html.replace(/(<body[^>]*>)/i,'$1<div style="padding:15px;background:#fff1c8;color:#664b17;font:700 13px/1.6 Arial,sans-serif;text-align:center">TESTMAIL · FICTIEVE VOORBEELDGEGEVENS<br>Geen echte prijs, bestelling of geldige inlogcode.</div>');}
  if(templateId==='newsletter'||campaignId)payload.headers={...(payload.headers||{}),'List-Unsubscribe':`<${data.afmeldlink}>`,'List-Unsubscribe-Post':'List-Unsubscribe=One-Click'};
  const stored=await persistPayload(env,id,payload);let created;
  if(prior){
   if(!stored)return {id,status:'failed',message:'Beveiligde berichtopslag is nog niet ingesteld.'};
   const frozen=await frozenPayload(env,id),repaired=await store.mutate(id,r=>{if(!canRepairMailPreparation(r)||!sameEventBinding(r,binding))return false;r.eventId=eventId;r.subject=frozen.subject;r.status='pending';r.payloadReady=true;r.error=null;r.leaseUntil=0;return true;});
   if(!repaired.result)return {id,status:projectOutbox(repaired.record).status,message:'Dit bericht is al geregistreerd.'};created=repaired.record;
  }else created=await store.create({...binding,kind:'delivery',recipientName:String(recipient.name||'').slice(0,100),subject:payload.subject,marketing:templateId==='newsletter'||!!campaignId,consentAt:campaignId?recipient.consentAt||null:null,consentVersion:campaignId?recipient.consentVersion||null:null,status:stored?'pending':'failed',payloadReady:!!stored,error:stored?null:'Beveiligde berichtopslag is nog niet ingesteld.',createdAt:Date.now(),updatedAt:Date.now(),uncertain:false});
  if(created.status!=='pending')return {id,status:created.status,message:created.error||'Dit mailsjabloon is uitgeschakeld.'};return sendOutbox({env,id,fetcher});
 }catch(error){
  if(id&&store){try{await store.create({id,eventId,kind:'delivery',brandId,ownerId,templateId,campaignId,accountId:recipient?.accountId||null,recipientEmail:String(recipient?.email||'').trim().toLowerCase().slice(0,254),recipientName:String(recipient?.name||'').slice(0,100),subject:'',status:'failed',payloadReady:false,error:error.status?error.message:'Het mailbericht kon niet veilig worden voorbereid.',createdAt:Date.now(),updatedAt:Date.now(),uncertain:false,test});}catch{}}
  return {id:id||null,status:'failed',message:error.status?error.message:'Het mailbericht kon niet veilig worden voorbereid.'};
 }
}
export async function previewMail(env,{brandId,templateId,template,origin}){const effective=template?validateMailTemplate(templateId,template):await readEffectiveMailTemplate(env,brandId,templateId);const context=sampleMailContext(templateId,brandId,origin);return {...renderMailTemplate(templateId,{brandId,template:effective,context,origin,assetBaseUrl:env.MAIL_ASSET_BASE_URL,from:'studio@voorbeeld.invalid',to:'gezin@voorbeeld.invalid'}),simulated:true};}

const emptyStats=total=>({total,pending:total,accepted:0,failed:0,uncertain:0,skipped:0});
const campaignTypes=['newsletter','show-reminder','show-changed','show-thanks'];
const plain=(value,max,label)=>{const text=String(value||'').trim();if(text.length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)||/\{\{|\}\}/.test(text))throw new MailError('Vul gewone tekst zonder shortcodes in bij '+label+'.');return text;};
export async function campaignContext(env,campaign,origin,recipient={}){
 const config=(await mailConfig(env)).value,brand=SHOW_BRANDS[campaign.brandId],account=new URL('/spelen',origin);
 const context={voornaam:recipient.name||'beste ouder',gezinsnaam:recipient.name||'jullie gezin',organisatie_naam:brand.title,organisatie_email:config.from||env.VLAMPIE_ADMIN_EMAIL||'organisatie@voorbeeld.invalid',account_link:account.href,nieuwsbrief_titel:campaign.newsletterTitle||campaign.name,nieuwsbrief_tekst:campaign.newsletterText||'Er staat nieuws voor jullie klaar in de familie-app. Bekijk de actuele informatie via de knop hieronder.',wijziging_tekst:campaign.changeText||'',afmeldlink:new URL('/mail/afmelden?voorbeeld=alleen-controle',origin).href};
 if(campaign.showId){const row=await env.DB.prepare('SELECT document FROM bingo_games WHERE id = ? AND owner_id = ?').bind(campaign.showId,campaign.ownerId).first();if(!row)throw new MailError('De gekozen show is niet meer beschikbaar.',409);const game=JSON.parse(row.document);if(gameBrandId(game)!==campaign.brandId)throw new MailError('Deze show hoort bij een andere productie.',409);const local=/^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d(?:\.\d{1,3})?)?$/.exec(game.date||''),date=new Date(local?local[1]+'T12:00:00Z':game.date);if(!Number.isFinite(+date)||local&&date.toISOString().slice(0,10)!==local[1])throw new MailError('De datum van deze show moet eerst worden gecontroleerd.',409);context.show_naam=game.title;context.show_datum=new Intl.DateTimeFormat('nl-NL',{dateStyle:'long',timeZone:'Europe/Amsterdam'}).format(date);context.show_tijd=local?local[2]+':'+local[3]:new Intl.DateTimeFormat('nl-NL',{timeStyle:'short',timeZone:'Europe/Amsterdam'}).format(date);account.searchParams.set('spel',game.id);context.account_link=account.href;}
 return context;
}
export async function saveCampaign(env,ownerId,body){
 const store=new MailStore(env.DB),brandId=mailBrand(body.brandId),name=plain(body.name||'Nieuwe nieuwsbrief',100,'campagnenaam'),templateId=body.templateId||'newsletter';
 if(!name)throw new MailError('Geef de nieuwsbrief een naam.');if(!campaignTypes.includes(templateId))throw new MailError('Kies een nieuwsbrief of een handmatig showbericht.');
 if((await readEffectiveMailTemplate(env,brandId,templateId)).enabled===false)throw new MailError('Dit mailtemplate is uitgeschakeld. Schakel het eerst weer in.',409);
 const template=validateMailTemplate(templateId,{...(body.template||body),enabled:true}),showId=body.showId||null;
 if(templateId!=='newsletter'&&!showId)throw new MailError('Kies voor dit showbericht de bijbehorende show.');
 if(showId&&!/^[a-f0-9-]{36}$/.test(showId))throw new MailError('Kies een geldige show.');
 if(showId){const row=await env.DB.prepare('SELECT owner_id,document FROM bingo_games WHERE id = ?').bind(showId).first();if(!row||row.owner_id!==ownerId||gameBrandId(JSON.parse(row.document))!==brandId)throw new MailError('Deze show hoort niet bij deze productie.',403);}
 const content={name,template,templateId,showId,newsletterTitle:plain(body.newsletterTitle||name,140,'nieuwsbrieftitel'),newsletterText:plain(body.newsletterText||'',9000,'nieuwsbriefinhoud'),changeText:plain(body.changeText||'',4000,'bevestigde wijziging')};
 if(body.id){const changed=await store.mutate(body.id,r=>{if(r.kind!=='campaign'||r.ownerId!==ownerId||r.brandId!==brandId)throw new MailError('Deze nieuwsbrief hoort niet bij jouw werkplek.',403);if(r.status!=='draft')throw new MailError('Een klaargezette nieuwsbrief kan niet meer worden gewijzigd. Maak een nieuw concept.',409);if(body.revision!==r.revision)throw new MailError('Deze nieuwsbrief is gewijzigd. Ververs eerst.',409);Object.assign(r,content);});return projectCampaign(changed.record);}
 const now=Date.now(),r=await store.create({id:crypto.randomUUID(),kind:'campaign',brandId,ownerId,...content,status:'draft',recipientIds:[],stats:emptyStats(0),createdAt:now,updatedAt:now});return projectCampaign(r);
}
export async function ownedCampaign(store,id,ownerId,brandId){const r=await store.get(id);if(!r||r.kind!=='campaign')throw new MailError('Deze nieuwsbrief bestaat niet.',404);if(r.ownerId!==ownerId||r.brandId!==brandId)throw new MailError('Deze nieuwsbrief hoort niet bij jouw werkplek.',403);return r;}
export async function prepareCampaign(env,id,ownerId,brandId,revision,origin){
 if(!(await readMailSettings(env,brandId)).value.newsletterEnabled)throw new MailError('De nieuwsbriefmodule is uitgeschakeld.',409);
 const store=new MailStore(env.DB),r=await ownedCampaign(store,id,ownerId,brandId);if(r.status!=='draft')return projectCampaign(r);if(r.revision!==revision)throw new MailError('De nieuwsbrief is gewijzigd. Ververs eerst.',409);
 if((await readEffectiveMailTemplate(env,brandId,r.templateId)).enabled===false)throw new MailError('Dit mailtemplate is uitgeschakeld.',409);
 const context=await campaignContext(env,r,origin),config=(await mailConfig(env)).value;
 // Validate with server facts before freezing a recipient list. This preview is
 // not sent, and only its harmless placeholder unsubscribe URL is artificial.
 renderMailTemplate(r.templateId,{brandId,template:r.template,context,origin,assetBaseUrl:env.MAIL_ASSET_BASE_URL,unsubscribeUrl:context.afmeldlink,from:config.from||'organisatie@voorbeeld.invalid',to:'controle@voorbeeld.invalid'});
 let rows=await store.subscribers(brandId);
 if(r.showId){const gameRow=await env.DB.prepare('SELECT document FROM bingo_games WHERE id = ? AND owner_id = ?').bind(r.showId,ownerId).first();if(!gameRow)throw new MailError('Deze show is niet beschikbaar.',409);const game=JSON.parse(gameRow.document),participants=new Set((game.books||[]).filter(b=>b.accountId&&b.admitted&&!b.revokedAt).map(b=>b.accountId));for(const order of game.orders||[])if(!['cancelled','rejected'].includes(order.status))participants.add(order.accountId);rows=rows.filter(s=>participants.has(s.account_id));}
 const unique=[...new Map(rows.map(s=>[s.email,s])).values()];if(unique.length>1000)throw new MailError('Deze verzending bevat meer dan 1000 gezinnen. Splits de doelgroep.');if(!unique.length)throw new MailError('Er zijn nog geen aangemelde gezinnen in deze doelgroep.',409,'mail_no_audience');
 const updated=await store.mutate(id,current=>{if(current.revision!==revision||current.status!=='draft')throw new MailError('De nieuwsbrief is inmiddels gewijzigd.',409);current.recipientIds=unique.map(s=>({accountId:s.account_id,email:s.email,name:s.name,consentAt:s.consent_at,consentVersion:s.consent_version}));current.status='prepared';current.stats=emptyStats(unique.length);current.preparedAt=Date.now();});return projectCampaign(updated.record);
}
export async function sendCampaignBatch({env,id,ownerId,brandId,confirm,origin,fetcher=fetch}){
 if(confirm!==true)throw new MailError('Bevestig bewust de verzending naar de klaargezette doelgroep.');
 if(!(await readMailSettings(env,brandId)).value.newsletterEnabled)throw new MailError('De nieuwsbriefmodule is uitgeschakeld.',409);
 const store=new MailStore(env.DB),campaign=await ownedCampaign(store,id,ownerId,brandId);if(!['prepared','sending','completed'].includes(campaign.status))throw new MailError('Zet eerst de doelgroep klaar.',409);if(campaign.status==='completed')return {campaign:projectCampaign(campaign),processed:0,maxBatch:5};
 const config=await mailConfig(env);if(!config.delivery||!config.value.contactReady)throw new MailError(config.value.deliveryReason||'Stel eerst een toegestane e-mailkoppeling in. De campagne blijft bewaard.',409,'mail_disabled');
 if((await readEffectiveMailTemplate(env,brandId,campaign.templateId)).enabled===false)throw new MailError('Dit mailtemplate is uitgeschakeld.',409);
 const context=await campaignContext(env,campaign,origin),leaseId=crypto.randomUUID();
 // A campaign lease prevents browser tabs sending different batches at once.
 // Stable per-recipient claims provide the final idempotency boundary.
 await store.mutate(id,r=>{if(r.batchLeaseUntil>Date.now())throw new MailError('Deze nieuwsbrief wordt al aangeboden. Wacht op de actuele status.',409);r.batchLeaseId=leaseId;r.batchLeaseUntil=Date.now()+90000;r.status='sending';return true;});
 let processed=0;
 try{for(const recipient of campaign.recipientIds){const eventId='campaign/'+campaign.id,outboxId=await digest([brandId,campaign.templateId,eventId,recipient.email].join('|'));if(await store.get(outboxId))continue;if(processed>=5)break;processed++;
  if(!await store.stillSubscribed(recipient.accountId,recipient.email,brandId)){await store.create({id:outboxId,kind:'delivery',brandId,ownerId,templateId:campaign.templateId,campaignId:id,recipientEmail:recipient.email,recipientName:recipient.name,status:'skipped',payloadReady:false,subject:campaign.template.subject,createdAt:Date.now(),updatedAt:Date.now()});continue;}
  await dispatchMailEvent({env,eventId,templateId:campaign.templateId,brandId,context:{...context,voornaam:recipient.name||'beste ouder',gezinsnaam:recipient.name||'jullie gezin'},recipient,origin,ownerId,campaignId:id,template:campaign.template,fetcher});
 }}finally{const deliveries=await store.campaignDeliveries(id,brandId),stats=emptyStats(campaign.recipientIds.length);stats.pending=stats.total-deliveries.length;for(const item of deliveries){const status=projectOutbox(item).status;if(status==='accepted')stats.accepted++;else if(status==='failed')stats.failed++;else if(status==='uncertain'||status==='sending')stats.uncertain++;else if(status==='skipped')stats.skipped++;else stats.pending++;}
  await store.mutate(id,r=>{if(r.batchLeaseId!==leaseId)return false;r.stats=stats;r.batchLeaseUntil=0;r.status=stats.pending===0?'completed':'sending';});
 }
 return {campaign:projectCampaign(await store.get(id)),processed,maxBatch:5};
}
