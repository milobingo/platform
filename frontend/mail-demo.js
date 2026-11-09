// Explicit browser-only rehearsal. No request from this adapter reaches a mail provider.
import {listMailTemplates,renderMailTemplate,sampleMailContext,validateMailTemplate} from '../server/mail-templates.js';

const PREFIX='milo-mail-workspace-demo-v1:';
const clone=value=>structuredClone(value);
const editable=t=>Object.fromEntries(['subject','preheader','title','body','buttonLabel','buttonUrl','enabled'].map(k=>[k,t[k]]));
const id=()=>crypto.randomUUID();
const fail=message=>{throw new Error(message);};
const base=brand=>{
 const templates=listMailTemplates(brand),newsletter=templates.find(t=>t.id==='newsletter');
 return {brandId:brand,revision:0,settings:{newsletterEnabled:true},templates,campaigns:[{id:'demo-uitnodiging-'+brand,brandId:brand,name:'Een nieuwe show vol verwondering',revision:1,status:'draft',template:{...editable(newsletter),subject:'{{voornaam}}, er staat een beetje magie op jullie te wachten ✨',title:'Schuif gezellig aan.',body:'Een hoge hoed vol verrassingen, vier gezellige bingorondes en een bijzonder bezoek.\n\nKijk samen mee en beleef jullie eigen magische middag.',buttonLabel:'Ontdek de volgende show',buttonUrl:'{{account_link}}'},stats:{total:0,pending:0,accepted:0,failed:0,uncertain:0,skipped:0},createdAt:Date.now()-86400000,updatedAt:Date.now()-3600000}],outbox:[{id:'demo-log-1',brandId:brand,templateId:'books-ready',status:'accepted',recipientName:'Familie Jansen',recipientEmail:'familie.jansen@voorbeeld.invalid',subject:'Jullie bingobladen staan klaar',createdAt:Date.now()-7200000,acceptedAt:Date.now()-7200000,canRetry:false,simulated:true},{id:'demo-log-2',brandId:brand,templateId:'payment-link',status:'failed',recipientName:'Familie De Vries',recipientEmail:'gezin.devries@voorbeeld.invalid',subject:'Jullie plek in de show wacht',createdAt:Date.now()-9000000,error:'Voorbeeld: de maildienst heeft deze aanvraag geweigerd.',canRetry:true,simulated:true}],audience:{subscribed:18,total:26},provider:{configured:false,from:'organisatie@voorbeeld.invalid',testRecipient:'regie@voorbeeld.invalid'},simulated:true};
};
function read(brand){try{const value=JSON.parse(localStorage.getItem(PREFIX+brand)||'null');if(value?.brandId===brand&&Array.isArray(value.templates)&&Array.isArray(value.campaigns))return {...value,simulated:true};}catch{}return base(brand);}
function save(value){try{localStorage.setItem(PREFIX+value.brandId,JSON.stringify(value));}catch{fail('De browser kan de oefenwijzigingen niet bewaren.');}return clone(value);}
export function mailDemoState(brand='milo'){return clone(read(brand));}
export function getDemoMailPreferences(brandId='milo',accountId='family-demo'){
 const data=read(brandId),stored=data.demoPreferences?.[accountId];
 return {brandId,newsletterEnabled:data.settings.newsletterEnabled!==false,subscribed:stored?.subscribed===true,subscribedAt:stored?.subscribedAt||null,updatedAt:stored?.updatedAt||null,consentVersion:'newsletter-2026-11',simulated:true};
}
export function setDemoMailPreferences(brandId='milo',accountId='family-demo',subscribed=false){
 const data=read(brandId);data.demoPreferences??={};const before=data.demoPreferences[accountId]?.subscribed===true,next=subscribed===true;
 data.demoPreferences[accountId]={subscribed:next,subscribedAt:next?Date.now():null,updatedAt:Date.now(),consentVersion:'newsletter-2026-11'};
 data.audience.subscribed=Math.max(0,data.audience.subscribed+(before===next?0:next?1:-1));save(data);
 globalThis.dispatchEvent?.(new Event('mf-mail-demo-preferences'));
 return getDemoMailPreferences(brandId,accountId);
}
export async function mailDemoRequest(path,{method='GET',body={}}={}){
 const url=new URL('/api/mail'+path,globalThis.location?.origin||'https://voorbeeld.invalid'),brand=body.brandId||url.searchParams.get('brand')||'milo';
 if(!['milo','vlampie'].includes(brand))fail('Kies de juiste productie.');
 const data=read(brand),origin=globalThis.location?.origin||'https://voorbeeld.invalid',route=url.pathname.slice('/api/mail'.length);
 if(route==='/state'&&method==='GET')return clone(data);
 if(route==='/preview'||route==='/test'){
  const selected=data.templates.find(t=>t.id===body.templateId);if(!selected)fail('Kies een mailtemplate.');
  const rendered=renderMailTemplate(selected.id,{brandId:brand,template:body.template||editable(selected),context:sampleMailContext(selected.id,brand,origin),origin,from:'organisatie@voorbeeld.invalid',to:'regie@voorbeeld.invalid'});
  return route==='/preview'?{...rendered,simulated:true}:{status:'simulated',message:'Voorbeeldtest afgerond. Er is geen e-mail verstuurd.',simulated:true};
 }
 const templateId=route.match(/^\/templates\/([^/]+)$/)?.[1];
 if(templateId&&method==='POST'){
  if(body.revision!==data.revision)fail('De oefeninstellingen zijn intussen gewijzigd. Ververs eerst.');
  const i=data.templates.findIndex(t=>t.id===templateId);if(i<0)fail('Deze mailtemplate bestaat niet.');
  data.templates[i]={...data.templates[i],...validateMailTemplate(templateId,body.template)};data.revision++;return save(data);
 }
 if(route==='/settings'&&method==='POST'){
  if(body.revision!==data.revision)fail('De instellingen zijn intussen gewijzigd. Ververs eerst.');
  data.settings.newsletterEnabled=body.newsletterEnabled===true;data.revision++;return save(data);
 }
 if(route==='/campaigns'&&method==='POST'){
  if(!data.settings.newsletterEnabled)fail('Zet eerst de nieuwsbriefmodule aan.');
  let campaign=body.id?data.campaigns.find(c=>c.id===body.id):null;
  if(body.id&&!campaign)fail('Deze oefencampagne bestaat niet.');
  if(campaign&&campaign.status!=='draft')fail('Deze campagne is al klaargezet; maak een nieuwe versie.');
  if(campaign&&body.revision!==campaign.revision)fail('De campagne is intussen gewijzigd. Ververs eerst.');
  const templateId=body.templateId||campaign?.templateId||'newsletter';if(!['newsletter','show-reminder','show-changed','show-thanks'].includes(templateId))fail('Kies een nieuwsbrief of een beschikbaar showbericht.');
  if(templateId!=='newsletter'&&!body.showId)fail('Kies een show voor dit bericht.');
  const template=validateMailTemplate(templateId,body.template||body);
  // Validate rendering with the same pure renderer used by server templates.
  renderMailTemplate(templateId,{brandId:brand,template,context:{...sampleMailContext(templateId,brand,origin),...(body.changeText?{wijziging_tekst:body.changeText}:{})},origin,from:'organisatie@voorbeeld.invalid',to:'regie@voorbeeld.invalid'});
  if(!campaign){campaign={id:id(),brandId:brand,createdAt:Date.now(),revision:0,status:'draft',stats:{total:0,pending:0,accepted:0,failed:0,uncertain:0,skipped:0}};data.campaigns.unshift(campaign);}
  Object.assign(campaign,{name:String(body.name||template.title||'Nieuwe nieuwsbrief').trim(),templateId,showId:body.showId||'',changeText:body.changeText||'',newsletterTitle:body.newsletterTitle||'',newsletterText:body.newsletterText||'',template,revision:campaign.revision+1,updatedAt:Date.now()});save(data);return {campaign:clone(campaign),simulated:true};
 }
 const campaignMatch=route.match(/^\/campaigns\/([^/]+)\/(prepare|send)$/);
 if(campaignMatch&&method==='POST'){
  const campaign=data.campaigns.find(c=>c.id===campaignMatch[1]);if(!campaign)fail('Deze oefencampagne bestaat niet.');
  if(!data.settings.newsletterEnabled)fail('De nieuwsbriefmodule staat uit.');
  if(campaignMatch[2]==='prepare'){
   if(campaign.status!=='draft'||body.revision!==campaign.revision)fail('Sla eerst de actuele conceptversie op.');
   const own=Object.entries(data.demoPreferences||{}).filter(([,p])=>p.subscribed).map(([accountId])=>({accountId,own:true})),baseCount=Math.max(0,data.audience.subscribed-own.length);
   campaign.demoRecipients=[...Array.from({length:baseCount},(_,i)=>({accountId:'demo-subscriber-'+brand+'-'+i,own:false})),...own];
   Object.assign(campaign,{status:'prepared',revision:campaign.revision+1,stats:{total:campaign.demoRecipients.length,pending:campaign.demoRecipients.length,accepted:0,failed:0,uncertain:0,skipped:0}});
  }else{
   if(body.confirm!==true||!['prepared','sending'].includes(campaign.status))fail('Bevestig eerst deze voorbereide verzending.');
   const processed=Math.min(5,campaign.stats.pending),offset=campaign.stats.total-campaign.stats.pending,recipients=campaign.demoRecipients?.slice(offset,offset+processed)||Array.from({length:processed},()=>({own:false}));
   const skipped=recipients.filter(r=>r.own&&data.demoPreferences?.[r.accountId]?.subscribed!==true).length;campaign.stats.accepted+=processed-skipped;campaign.stats.skipped+=skipped;campaign.stats.pending-=processed;campaign.status=campaign.stats.pending?'sending':'completed';campaign.revision++;
   if(processed)data.outbox.unshift({id:id(),brandId:brand,templateId:'newsletter',status:'accepted',recipientName:'Fictieve voorbeeldontvangers',recipientEmail:processed+' voorbeeldadressen',subject:campaign.template.subject,createdAt:Date.now(),acceptedAt:Date.now(),canRetry:false,simulated:true});
  }
  campaign.updatedAt=Date.now();save(data);return {campaign:clone(campaign),processed:campaignMatch[2]==='send'?Math.min(5,campaign.stats.total):0,maxBatch:5,simulated:true};
 }
 const retry=route.match(/^\/outbox\/([^/]+)\/retry$/);
 if(retry&&method==='POST'){
  const row=data.outbox.find(r=>r.id===retry[1]);if(!row?.canRetry||body.confirm!==true)fail('Deze verzending kan niet veilig opnieuw worden aangeboden.');
  Object.assign(row,{status:'accepted',canRetry:false,error:null,acceptedAt:Date.now()});save(data);return {status:'simulated',message:'Opnieuw aanbieden is gesimuleerd; er is geen e-mail verstuurd.',simulated:true};
 }
 fail('Deze actie is niet beschikbaar in de lokale maildemo.');
}
