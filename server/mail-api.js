import {platformIdentity,playerIdentity} from './player-identity.js';
import {BingoStore} from './bingo-store.js';
import {MailStore,MailError} from './mail-store.js';
import {SHOW_BRANDS} from './show-brands.js';
import {validateMailTemplate,sampleMailContext} from './mail-templates.js';
import {recoverOrderMailEvents,dispatchPublishedPrizeMail} from './mail-domain-events.js';
import {mailBrand,mailState,readMailSettings,saveMailSettings,previewMail,dispatchMailEvent,saveCampaign,prepareCampaign,sendCampaignBatch,sendOutbox,processOutboxBatch} from './mail-service.js';

const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const json=(data,status=200)=>Response.json(data,{status,headers});
const publicHeaders={...headers,'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"};
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function readBody(request){const raw=await request.text();if(raw.length>18000)throw new MailError('De aanvraag is te groot.',413);try{const body=JSON.parse(raw||'{}');if(!body||typeof body!=='object'||Array.isArray(body))throw Error();return body;}catch{throw new MailError('De aanvraag is niet leesbaar.');}}
const safeWrite=(request,url,player=false)=>{if(request.headers.get('origin')!==url.origin||request.headers.get('sec-fetch-site')==='cross-site'||request.headers.get('x-milo-mail')!=='1'&&!(player&&request.headers.get('x-vlampie-player')==='1'))throw new MailError('Open deze functie vanuit de showstudio of familie-app.',403);};

async function unsubscribePage(request,env,url){
 if(!['GET','HEAD','POST'].includes(request.method))throw new MailError('Deze methode is niet beschikbaar.',405);
 let token=url.searchParams.get('token')||'';if(request.method==='POST'){const type=request.headers.get('content-type')||'';if(type.includes('application/json'))token=(await readBody(request)).token||token;else{const raw=await request.text();if(raw.length>5000)throw new MailError('De aanvraag is te groot.',413);token=new URLSearchParams(raw).get('token')||token;}}
 const store=new MailStore(env.DB),target=await store.unsubscribeTarget(token);if(!target)throw new MailError('Deze afmeldlink is ongeldig. Je kunt je voorkeuren ook in de familie-app aanpassen.',400,'mail_unsubscribe');
 const brand=SHOW_BRANDS[target.brand_id],confirmed=request.method==='POST',vlampie=brand.id==='vlampie',ink=vlampie?'#102747':'#442553',soft=vlampie?'#dfeaf4':'#eaddec',muted=vlampie?'#657b90':'#80698d',button=vlampie?'#173d60':'#48245e';if(confirmed)await store.suppress(target.email,target.brand_id);
 // Viewing a link never withdraws consent: scanners and email previews follow
 // GET links. Only this form POST / standards-based one-click POST changes it.
 const html=`<!doctype html><html lang="nl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Nieuwsbriefvoorkeur · ${escape(brand.title)}</title><style>*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:22px;background:radial-gradient(ellipse at 25% 0%,${soft},#f9f5ed 70%);font:16px/1.7 Arial,sans-serif;color:${ink}}main{width:100%;max-width:520px;border:1px solid #dfc58a;border-top:5px solid #e7c77f;border-radius:24px;background:#fffdf9;padding:36px;box-shadow:0 20px 80px #28143715}small{color:#ad8849;letter-spacing:2px}h1{font:700 36px/1.15 Georgia,serif;letter-spacing:-1px;margin:17px 0}p{color:${muted}}button,a{font:700 14px Arial,sans-serif;border:1px solid ${ink};background:${button};color:#fff5db;padding:15px 21px;border-radius:12px;text-decoration:none;display:inline-block;cursor:pointer}a.secondary{background:${soft};color:${ink};border-color:#e2d4ec;margin-top:12px}form{margin-top:25px}</style><main><small>${escape(brand.title.toUpperCase())}</small><h1>${confirmed?'Je bent afgemeld.':'Jullie nieuwsbriefkeuze.'}</h1><p>${confirmed?'Je ontvangt geen nieuwsbrieven meer van deze productie. Belangrijke serviceberichten over je account en bestellingen blijven beschikbaar.':'Wil je geen nieuwsbrieven meer ontvangen? Bevestig het hieronder. Je account, boekjes en bestellingen blijven gewoon bestaan.'}</p>${confirmed?'':`<form method="post" action="/mail/afmelden"><input type="hidden" name="token" value="${escape(token)}"><button type="submit">Afmelden voor de nieuwsbrief</button></form>`}<a class="secondary" href="/spelen">Naar de familieplek</a></main></html>`;
 return new Response(request.method==='HEAD'?null:html,{headers:publicHeaders});
}


function unsubscribeErrorPage(request,error){
 const status=error.status||503,unavailable=status>=500;
 const title=unavailable?'Even geen verbinding.':'Deze afmeldlink werkt niet.';
 const copy=unavailable?'Je nieuwsbriefvoorkeur kon op dit moment niet worden bevestigd. Probeer het later opnieuw of controleer je keuze in de familie-app.':'De link is ongeldig of niet meer beschikbaar. Open de familie-app om jullie nieuwsbriefkeuze te beheren. Je hoeft geen gegevens opnieuw per e-mail door te geven.';
 const html=`<!doctype html><html lang="nl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Nieuwsbriefvoorkeur · BingoShow</title><style>*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:22px;background:radial-gradient(ellipse at 25% 0%,#eaddec,#f9f5ed 70%);font:16px/1.7 Arial,sans-serif;color:#442553}main{width:100%;max-width:520px;border:1px solid #dfc58a;border-top:5px solid #e7c77f;border-radius:24px;background:#fffdf9;padding:36px;box-shadow:0 20px 80px #28143715}small{color:#ad8849;letter-spacing:2px}h1{font:700 36px/1.15 Georgia,serif;letter-spacing:-1px;margin:17px 0}p{color:#80698d}a{font:700 14px Arial,sans-serif;border:1px solid #754790;background:#48245e;color:#fff5db;padding:15px 21px;border-radius:12px;text-decoration:none;display:inline-block}</style><main><small>JULLIE NIEUWSBRIEFKEUZE</small><h1>${title}</h1><p>${copy}</p><a href="/spelen">Naar de familieplek</a></main></html>`;
 return new Response(request.method==='HEAD'?null:html,{status,headers:publicHeaders});
}

export async function handleMailAPI(request,env,fetcher=fetch){
 const url=new URL(request.url);
 try{
  if(url.pathname==='/mail/afmelden')return await unsubscribePage(request,env,url);
  if(!url.pathname.startsWith('/api/mail/'))throw new MailError('Deze mailfunctie bestaat niet.',404);
  const path=url.pathname.slice('/api/mail'.length),write=!['GET','HEAD'].includes(request.method);if(write)safeWrite(request,url,path==='/preferences');
  if(request.headers.get('sec-fetch-site')==='cross-site'||request.headers.get('origin')&&request.headers.get('origin')!==url.origin)throw new MailError('Open deze functie vanuit de showstudio of familie-app.',403);
  const body=write?await readBody(request):{},brandId=mailBrand(body.brandId||url.searchParams.get('brand')||url.searchParams.get('brandId')||'milo');
  if(path==='/preferences'){
   const identity=await playerIdentity(request,env);if(!identity.user||!identity.email)throw new MailError('Log eerst in om jullie nieuwsbriefkeuze te beheren.',401);
   const store=new MailStore(env.DB),settings=await readMailSettings(env,brandId);let pref;
   if(request.method==='POST'){
    if(typeof body.subscribed!=='boolean')throw new MailError('Kies of jullie de nieuwsbrief willen ontvangen.');if(body.subscribed&&settings.value.newsletterEnabled===false)throw new MailError('De organisatie heeft de nieuwsbrief tijdelijk uitgezet.',409);
    const family=(await new BingoStore(env.DB).family(identity.user,identity.email)).data;
    pref=await store.setPreference({accountId:identity.user,email:identity.email.trim().toLowerCase(),name:String(family.ownerName||'').slice(0,100),brandId,subscribed:body.subscribed});
   }else if(request.method==='GET')pref=await store.preference(identity.user,brandId);else throw new MailError('Deze methode is niet beschikbaar.',405);
   return json({brandId,subscribed:!!pref.subscribed,newsletterEnabled:settings.value.newsletterEnabled!==false,subscribedAt:pref.consent_at||null,consentVersion:pref.consent_version||null,updatedAt:pref.updated_at||null});
  }
  const identity=platformIdentity(request,env);if(!identity.admin||request.headers.get('x-vlampie-player')==='1'||url.searchParams.get('player')==='1')throw new MailError('Alleen de organisatie kan mailtemplates en nieuwsbrieven beheren.',403);
  if(path==='/state'&&request.method==='GET')return json(await mailState(env,brandId));
  if(path==='/recover'&&request.method==='POST'){
   if(body.confirm!==true)throw new MailError('Bevestig de gecontroleerde verwerking van ontbrekende servicemails.');
   const games=(await new BingoStore(env.DB).games()).filter(r=>r.owner_id===identity.user&&(r.data.brandId||'vlampie')===brandId),results=await processOutboxBatch({env,ownerId:identity.user,brandId,limit:5});
   for(const row of games.slice(0,20)){if(results.length>=5)break;try{results.push(...await recoverOrderMailEvents({env,game:row.data,origin:url.origin,limit:5-results.length}));for(const result of row.data.results||[]){if(results.length>=5)break;if(result.acknowledged&&result.mailEvent)results.push(await dispatchPublishedPrizeMail({env,game:row.data,result,origin:url.origin}));}}catch{results.push({status:'failed'});}}
   return json({processed:results.length,accepted:results.filter(r=>r.status==='accepted').length,attention:results.filter(r=>!['accepted','skipped'].includes(r.status)).length});
  }
  if(path==='/preview'&&request.method==='POST')return json(await previewMail(env,{brandId,templateId:body.templateId,template:body.template,origin:url.origin}));
  if(path==='/settings'&&request.method==='POST'){
   if(typeof body.newsletterEnabled!=='boolean')throw new MailError('Kies of de nieuwsbriefmodule aan of uit staat.');await saveMailSettings(env,brandId,body.revision,value=>{value.newsletterEnabled=body.newsletterEnabled;});return json(await mailState(env,brandId));
  }
  const templateMatch=path.match(/^\/templates\/([a-z-]+)$/);
  if(templateMatch&&request.method==='POST'){
   const id=templateMatch[1];if(id==='auth-code')throw new MailError('De echte inlogmail wordt door Supabase Auth beheerd. Dit studiovoorbeeld wijzigt die configuratie niet.',409,'auth_template_external');const template=validateMailTemplate(id,body.template||{});await saveMailSettings(env,brandId,body.revision,value=>{if(body.reset===true)delete value.templates[id];else value.templates[id]=template;});return json(await mailState(env,brandId));
  }
  if(path==='/test'&&request.method==='POST'){
   const store=new MailStore(env.DB),bucket='test-rate/'+identity.user+'/'+Math.floor(Date.now()/60000);await store.create({id:bucket,kind:'rate',brandId,ownerId:identity.user,count:0,createdAt:Date.now(),updatedAt:Date.now()});await store.mutate(bucket,r=>{if(r.count>=5)throw new MailError('Je hebt zojuist vijf testmails aangevraagd. Wacht een minuut.',429);r.count++;});
   // Preview context is intentionally fictional; the only real address is the
   // authenticated organizer. An API body cannot nominate another recipient.
   const context=sampleMailContext(body.templateId,brandId,url.origin);const result=await dispatchMailEvent({env,eventId:'test/'+crypto.randomUUID(),templateId:body.templateId,brandId,template:body.template,context,recipient:{accountId:identity.user,email:identity.email,name:'Organisatie · testmail'},ownerId:identity.user,origin:url.origin,fetcher,test:true});return json({...result,test:true,recipient:identity.email});
  }
  if(path==='/campaigns'&&request.method==='POST')return json({campaign:await saveCampaign(env,identity.user,{...body,brandId})});
  const campaignMatch=path.match(/^\/campaigns\/([a-f0-9-]{36})\/(prepare|send)$/);
  if(campaignMatch&&request.method==='POST')return json(campaignMatch[2]==='prepare'?{campaign:await prepareCampaign(env,campaignMatch[1],identity.user,brandId,body.revision,url.origin)}:await sendCampaignBatch({env,id:campaignMatch[1],ownerId:identity.user,brandId,confirm:body.confirm,origin:url.origin,fetcher}));
  const retryMatch=path.match(/^\/outbox\/([a-f0-9]{64})\/retry$/);
  if(retryMatch&&request.method==='POST'){
   if(body.confirm!==true)throw new MailError('Bevestig het opnieuw aanbieden van deze geweigerde mail.');const record=await new MailStore(env.DB).get(retryMatch[1]);if(!record||record.kind!=='delivery'||record.brandId!==brandId||record.ownerId!==identity.user)throw new MailError('Dit bericht bestaat niet in deze productie.',404);if(record.status!=='failed'||record.uncertain||!record.payloadReady)throw new MailError('Alleen een definitief geweigerde mail kan opnieuw worden aangeboden. Controleer onzekere ontvangst bij de provider.',409);return json(await sendOutbox({env,id:record.id,retry:true,fetcher}));
  }
  throw new MailError('Deze mailfunctie bestaat niet.',404);
 }catch(error){if(url.pathname==='/mail/afmelden')return unsubscribeErrorPage(request,error);return json({error:{message:error.status?error.message:'De e-mailadministratie is tijdelijk niet beschikbaar. Probeer opnieuw.',code:error.code||'mail_unavailable'}},error.status||503);}
}
export const handleMail=handleMailAPI;
