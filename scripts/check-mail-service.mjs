import test from 'node:test';
import {verifiedTestEnvironment} from './verified-test-identity.mjs';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {handleMailAPI} from '../server/mail-api.js';
import {MailStore} from '../server/mail-store.js';
import {dispatchMailEvent,sendOutbox,saveCampaign,prepareCampaign,sendCampaignBatch,readMailSettings,campaignContext} from '../server/mail-service.js';
import {BingoStore} from '../server/bingo-store.js';
import {makeGame} from '../server/bingo-model.js';
import {recoverOrderMailEvents,recordResultMailEvent,dispatchPublishedPrizeMail} from '../server/mail-domain-events.js';

function fixture(t){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());for(const file of readdirSync(new URL('../drizzle/',import.meta.url)).filter(x=>x.endsWith('.sql')).sort())db.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));
 const statement=(sql,args=[])=>({sql,args,bind:(...next)=>statement(sql,next),first:async()=>db.prepare(sql).get(...args)||null,all:async()=>({results:db.prepare(sql).all(...args)}),run:async()=>({meta:db.prepare(sql).run(...args)})});
 const objects=new Map(),env={VLAMPIE_ADMIN_EMAIL:'host@example.test',VLAMPIE_SETTINGS_KEY:'07'.repeat(32),MAIL_FROM:'studio@example.test',DB:{prepare:sql=>statement(sql),batch:async rows=>{db.exec('BEGIN');try{const output=rows.map(r=>/RETURNING|^SELECT/i.test(r.sql)?{results:db.prepare(r.sql).all(...r.args)}:{results:[],meta:db.prepare(r.sql).run(...r.args)});db.exec('COMMIT');return output;}catch(e){db.exec('ROLLBACK');throw e;}}},SETTINGS:{get:async key=>{const value=objects.get(key);return value?{etag:value.etag,json:async()=>JSON.parse(value.data)}:null;},put:async(key,data,options={})=>{const prior=objects.get(key),condition=options.onlyIf;if(condition?.etagDoesNotMatch==='*'&&prior||condition?.etagMatches&&condition.etagMatches!==prior?.etag)return null;const result={etag:crypto.randomUUID(),data};objects.set(key,result);return result;}}};
 const sent=[];let provider='accepted';const fetcher=async()=>{throw Error('No HTTP provider allowed');};
 const adapter={id:'test-dg-mail',supportsMarketing:true,send:async({message,idempotencyKey})=>{sent.push({payload:structuredClone(message),key:idempotencyKey});if(provider==='network')throw Error('synthetic timeout');if(provider==='rejected')return {accepted:false,uncertain:false};return {accepted:true,messageId:'provider-mock-'+sent.length};}};env.ORDER_MAIL_DELIVERY=adapter;
 const request=(path,body,who='host',extra={})=>new Request('https://studio.example'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',Origin:'https://studio.example','X-Milo-Mail':'1',...(who==='host'?{'oai-authenticated-user-id':'host','oai-authenticated-user-email':'host@example.test'}:who?{'oai-authenticated-user-id':who,'oai-authenticated-user-email':who+'@example.test'}:{}),...extra},body:body===undefined?undefined:JSON.stringify(body)});
 const api=async(path,body,status=200,who='host',extra={})=>{const result=await handleMailAPI(request(path,body,who,extra),verifiedTestEnvironment(request(path,body,who,extra),env),fetcher),data=await result.json();assert.equal(result.status,status,JSON.stringify(data));return data;};
 return {db,env,objects,sent,fetcher,request,api,provider:value=>provider=value,store:new MailStore(env.DB)};
}
const origin='https://studio.example';
const welcome={ownerId:'host',eventId:'first-account',templateId:'welcome',brandId:'milo',context:{voornaam:'Noor',gezinsnaam:'Familie Test',account_link:origin+'/spelen',organisatie_email:'studio@example.test'},recipient:{accountId:'parent',email:'parent@example.test',name:'Familie Test'},origin};

test('mail administration and writes require organizer identity and exact-origin CSRF protection; preview never trusts client facts',async t=>{
 const h=fixture(t);await h.api('/api/mail/state?brand=milo',undefined,403,'parent');await h.api('/api/mail/settings',{brandId:'milo',revision:null,newsletterEnabled:false},403,'host',{Origin:'https://elsewhere.example'});await h.api('/api/mail/state?brand=milo',undefined,403,'host',{'X-Vlampie-Player':'1'});
 const state=await h.api('/api/mail/state?brand=milo');assert.equal(state.settings.newsletterEnabled,true);assert.equal(state.templates.length,17);const preview=await h.api('/api/mail/preview',{brandId:'milo',templateId:'welcome',context:{voornaam:'DO-NOT-TRUST'}});assert.equal(preview.simulated,true);assert(!preview.html.includes('DO-NOT-TRUST'));assert.equal(h.sent.length,0);
 await h.api('/api/mail/templates/welcome',{brandId:'milo',revision:null,template:{title:'Welkom in de show!'}});const saved=await h.api('/api/mail/state?brand=milo');assert.equal(saved.templates.find(x=>x.id==='welcome').title,'Welkom in de show!');assert(![...h.objects.values()].some(x=>x.data.includes('Welkom in de show!')));await h.api('/api/mail/settings',{brandId:'milo',revision:null,newsletterEnabled:false},409);
});
test('newsletter feature defaults enabled while account consent defaults off; own verified address is authoritative and historical consent survives withdrawal',async t=>{
 const h=fixture(t);let pref=await h.api('/api/mail/preferences?brand=milo',undefined,200,'parent');assert.equal(pref.subscribed,false);assert.equal(pref.newsletterEnabled,true);
 pref=await h.api('/api/mail/preferences',{brandId:'milo',subscribed:true,email:'foreign@example.test'},200,'parent');assert.equal(pref.subscribed,true);const consentAt=pref.subscribedAt;assert.equal((await h.store.subscribers('milo'))[0].email,'parent@example.test');assert.equal((await h.store.subscribers('vlampie')).length,0);
 pref=await h.api('/api/mail/preferences',{brandId:'milo',subscribed:false},200,'parent');assert.equal(pref.subscribed,false);assert.equal(pref.subscribedAt,consentAt);assert.equal((await h.store.subscribers('milo')).length,0);
});
test('public unsubscribe GET is harmless; token POST withdraws all matching-brand subscriptions and raw tokens are never stored',async t=>{
 const h=fixture(t);await h.store.setPreference({accountId:'a',email:'shared@example.test',brandId:'milo',subscribed:true});await h.store.setPreference({accountId:'b',email:'shared@example.test',brandId:'milo',subscribed:true});await h.store.setPreference({accountId:'c',email:'shared@example.test',brandId:'vlampie',subscribed:true});const link=await h.store.unsubscribeLink('shared@example.test','milo',origin),token=new URL(link).searchParams.get('token');
 let response=await handleMailAPI(new Request(link),h.env,h.fetcher);assert.equal(response.status,200);assert((await response.text()).includes('Bevestig het hieronder'));assert.equal((await h.store.subscribers('milo')).length,2);assert(!JSON.stringify(h.db.prepare('SELECT * FROM studio_mail_unsubscribe').all()).includes(token));
 response=await handleMailAPI(new Request(link,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'List-Unsubscribe=One-Click'}),h.env,h.fetcher);assert.equal(response.status,200);assert.equal((await h.store.subscribers('milo')).length,0);assert.equal((await h.store.subscribers('vlampie')).length,1);assert.equal(h.sent.length,0);
});
test('real dispatch is durable and idempotent per event, adult email and production; encrypted snapshots never enter admin responses',async t=>{
 const h=fixture(t),first=await dispatchMailEvent({...welcome,env:h.env,fetcher:h.fetcher});assert.equal(first.status,'accepted');assert.equal((await dispatchMailEvent({...welcome,env:h.env,fetcher:h.fetcher})).status,'accepted');assert.equal(h.sent.length,1);
 await dispatchMailEvent({...welcome,brandId:'vlampie',env:h.env,fetcher:h.fetcher});await dispatchMailEvent({...welcome,recipient:{...welcome.recipient,email:'other@example.test'},env:h.env,fetcher:h.fetcher});assert.equal(h.sent.length,3);const state=await h.api('/api/mail/state?brand=milo');assert.equal(state.outbox.length,2);assert(state.outbox.every(r=>r.recipientEmail.includes('***')));assert(!JSON.stringify(state).includes('mail-message-'));assert(!JSON.stringify(state).includes('<!doctype'));assert([...h.objects.values()].every(v=>!v.data.includes('Familie Test')));
});
test('ambiguous provider receipt is never retried, while a definitive rejection reuses the identical frozen sender/payload',async t=>{
 const h=fixture(t);h.provider('network');const uncertain=await dispatchMailEvent({...welcome,env:h.env,fetcher:h.fetcher});assert.equal(uncertain.status,'uncertain');await sendOutbox({env:h.env,id:uncertain.id,retry:true,fetcher:h.fetcher});assert.equal(h.sent.length,1);
 h.provider('rejected');const rejected=await dispatchMailEvent({...welcome,eventId:'next-event',env:h.env,fetcher:h.fetcher});assert.equal(rejected.status,'failed');const firstPayload=h.sent.at(-1);h.env.MAIL_FROM='changed@example.test';h.provider('accepted');assert.equal((await sendOutbox({env:h.env,id:rejected.id,retry:true,fetcher:h.fetcher})).status,'accepted');assert.deepEqual(h.sent.at(-1),firstPayload);
});
test('a missing native adapter preserves a recoverable encrypted message and a later explicit retry uses the frozen content',async t=>{
 const h=fixture(t),adapter=h.env.ORDER_MAIL_DELIVERY;delete h.env.ORDER_MAIL_DELIVERY;
 const pending=await dispatchMailEvent({...welcome,env:h.env});assert.equal(pending.status,'failed');assert.equal(h.sent.length,0);
 h.env.ORDER_MAIL_DELIVERY=adapter;h.env.MAIL_FROM='new-sender@example.test';assert.equal((await sendOutbox({env:h.env,id:pending.id,retry:true})).status,'accepted');assert(h.sent[0].payload.from.endsWith('<studio@example.test>'));
});
test('campaigns deduplicate parent addresses, send in explicit batches of five and recheck brand consent after preparation',async t=>{
 const h=fixture(t);for(let i=0;i<7;i++)await h.store.setPreference({accountId:'p'+i,email:'parent'+i+'@example.test',name:'Ouder '+i,brandId:'milo',subscribed:true});await h.store.setPreference({accountId:'duplicate',email:'parent6@example.test',name:'Zelfde ouder',brandId:'milo',subscribed:true});await h.store.setPreference({accountId:'other-brand',email:'vlampie@example.test',brandId:'vlampie',subscribed:true});
 let draft=await saveCampaign(h.env,'host',{brandId:'milo',name:'De volgende show',subject:'Nieuws voor {{voornaam}}',title:'Onze familieplek',body:'Bekijk de actuele shows in jullie account.'});let campaign=await prepareCampaign(h.env,draft.id,'host','milo',draft.revision,origin);assert.equal(campaign.stats.total,7);await h.store.setPreference({accountId:'p0',email:'parent0@example.test',brandId:'milo',subscribed:false});
 await assert.rejects(sendCampaignBatch({env:h.env,id:draft.id,ownerId:'host',brandId:'milo',origin,fetcher:h.fetcher}),/Bevestig/);let sent=await sendCampaignBatch({env:h.env,id:draft.id,ownerId:'host',brandId:'milo',confirm:true,origin,fetcher:h.fetcher});assert.equal(sent.processed,5);assert.equal(sent.campaign.stats.pending,2);sent=await sendCampaignBatch({env:h.env,id:draft.id,ownerId:'host',brandId:'milo',confirm:true,origin,fetcher:h.fetcher});assert.equal(sent.campaign.status,'completed');assert.equal(sent.campaign.stats.skipped,1);assert.equal(h.sent.length,6);assert(h.sent.every(x=>x.payload.to.length===1));assert(h.sent.every(x=>x.payload.html.includes('Afmelden voor de nieuwsbrief')));assert(!JSON.stringify(h.sent).includes('Voorbeeldshow'));assert(!JSON.stringify(h.sent).includes('parent0@example.test'));assert(!JSON.stringify(h.sent).includes('vlampie@example.test'));
});
test('show campaigns use owned server show facts, reject sample fallbacks and never permit arbitrary prize announcements',async t=>{
 const h=fixture(t);await h.store.setPreference({accountId:'parent',email:'parent@example.test',brandId:'milo',subscribed:true});const game=makeGame({title:'Echte opgeslagen show',date:'2026-12-05T19:00',timeZone:'Europe/Amsterdam'},'host',origin);game.brandId='milo';game.books=[{accountId:'parent',admitted:true}];await new BingoStore(h.env.DB).create(game);
 const missing=await saveCampaign(h.env,'host',{brandId:'milo',name:'Niet zomaar een show verzinnen',body:'Onze show is {{show_naam}} op {{show_datum}}'});await assert.rejects(prepareCampaign(h.env,missing.id,'host','milo',missing.revision,origin),/waarde/);assert.equal(h.sent.length,0);
 const draft=await saveCampaign(h.env,'host',{brandId:'milo',templateId:'show-reminder',showId:game.id,name:'Herinnering'});await prepareCampaign(h.env,draft.id,'host','milo',draft.revision,origin);await sendCampaignBatch({env:h.env,id:draft.id,ownerId:'host',brandId:'milo',confirm:true,origin,fetcher:h.fetcher});assert(h.sent[0].payload.html.includes('Echte opgeslagen show'));assert(h.sent[0].payload.html.includes('Afmelden voor de nieuwsbrief'));assert(!h.sent[0].payload.html.includes('Voorbeeldshow'));await assert.rejects(saveCampaign(h.env,'host',{brandId:'milo',templateId:'prize-confirmed',showId:game.id,name:'Prijs'}),/handmatig showbericht/);
});
test('test mails can only target the authenticated organizer and contain an unremovable fictitious-data label',async t=>{
 const h=fixture(t);const result=await h.api('/api/mail/test',{brandId:'milo',templateId:'auth-code',to:'someone-else@example.test',context:{inlogcode:'999999'}});assert.equal(result.status,'accepted');assert.deepEqual(h.sent[0].payload.to,['host@example.test']);assert(h.sent[0].payload.subject.startsWith('[TEST · VOORBEELD]'));assert(h.sent[0].payload.html.includes('FICTIEVE VOORBEELDGEGEVENS'));assert(h.sent[0].payload.text.startsWith('TESTMAIL'));const state=await h.api('/api/mail/state?brand=milo');assert(!JSON.stringify(state.outbox).includes('482619'));assert(!JSON.stringify(state.outbox).includes('999999'));
});

test('show emails preserve an offsetless Amsterdam wall time while explicit UTC timestamps are converted',async t=>{
 const h=fixture(t),game=makeGame({title:'Amsterdam show',date:'2026-11-18T13:30',timeZone:'Europe/Amsterdam'},'host',origin);game.brandId='milo';const store=new BingoStore(h.env.DB);await store.create(game);const campaign={brandId:'milo',ownerId:'host',showId:game.id,name:'Herinnering'};assert.equal((await campaignContext(h.env,campaign,origin)).show_tijd,'13:30');await store.mutate(game.id,{},g=>{g.date='2026-11-18T13:30:00Z';});assert.equal((await campaignContext(h.env,campaign,origin)).show_tijd,'14:30');
});

test('invalid public unsubscribe links return friendly HTML without changing preferences or revealing account data',async t=>{
 const h=fixture(t);await h.store.setPreference({accountId:'parent',email:'private-parent@example.test',brandId:'milo',subscribed:true});const before=h.db.prepare('SELECT * FROM studio_mail_subscriptions').all();const response=await handleMailAPI(new Request(origin+'/mail/afmelden?token=not-a-valid-token'),h.env,h.fetcher);assert.equal(response.status,400);assert.match(response.headers.get('content-type'),/text\/html/);assert.match(response.headers.get('content-security-policy'),/frame-ancestors 'none'/);const html=await response.text();assert(html.startsWith('<!doctype html>'));assert(html.includes('Naar de familieplek'));assert(!html.includes('not-a-valid-token'));assert(!html.includes('private-parent@example.test'));assert.deepEqual(h.db.prepare('SELECT * FROM studio_mail_subscriptions').all(),before);assert.equal(h.sent.length,0);
});

test('MAIL-01 expired pre-contact claims recover once under parallel workers, while a lost offering remains uncertain',async t=>{
 const h=fixture(t),adapter=h.env.ORDER_MAIL_DELIVERY;delete h.env.ORDER_MAIL_DELIVERY;
 const queued=await dispatchMailEvent({...welcome,eventId:'crash-before-contact',env:h.env});h.env.ORDER_MAIL_DELIVERY=adapter;
 await h.store.mutate(queued.id,r=>{r.status='claimed';r.leaseUntil=Date.now()-1;r.attemptId='dead-before-contact';});
 await Promise.all([sendOutbox({env:h.env,id:queued.id}),sendOutbox({env:h.env,id:queued.id})]);assert.equal(h.sent.length,1);assert.equal((await h.store.get(queued.id)).status,'accepted');
 delete h.env.ORDER_MAIL_DELIVERY;const lost=await dispatchMailEvent({...welcome,eventId:'crash-after-contact',env:h.env});h.env.ORDER_MAIL_DELIVERY=adapter;
 await h.store.mutate(lost.id,r=>{r.status='offering';r.leaseUntil=Date.now()-1;r.attemptId='possibly-accepted';});
 assert.equal((await sendOutbox({env:h.env,id:lost.id,retry:true})).status,'uncertain');assert.equal(h.sent.length,1);assert.equal((await h.store.get(lost.id)).uncertain,true);
});

test('MAIL-01 retry rechecks disabled module and withdrawn brand consent; unrelated service mail stays usable',async t=>{
 const h=fixture(t);await h.store.setPreference({accountId:'parent',email:'parent@example.test',brandId:'milo',subscribed:true});
 const draft=await saveCampaign(h.env,'host',{brandId:'milo',name:'Veilige retry',body:'Een gewone showupdate.'});await prepareCampaign(h.env,draft.id,'host','milo',draft.revision,origin);
 h.provider('rejected');await sendCampaignBatch({env:h.env,id:draft.id,ownerId:'host',brandId:'milo',confirm:true,origin});const out=(await h.store.campaignDeliveries(draft.id,'milo'))[0],count=h.sent.length;
 const settings=await readMailSettings(h.env,'milo');await h.api('/api/mail/settings',{brandId:'milo',revision:settings.revision,newsletterEnabled:false});h.provider('accepted');
 assert.equal((await sendOutbox({env:h.env,id:out.id,retry:true})).status,'blocked');assert.equal(h.sent.length,count);
 assert.equal((await dispatchMailEvent({...welcome,eventId:'service-with-marketing-off',env:h.env})).status,'accepted');assert.equal(h.sent.length,count+1);
 // A second production's consent and suppression remain independent.
 await h.store.setPreference({accountId:'parent',email:'parent@example.test',brandId:'vlampie',subscribed:true});await h.store.suppress('parent@example.test','milo');assert(await h.store.stillSubscribed('parent','parent@example.test','vlampie'));
});

test('MAIL-02 durable domain markers repair missing enqueue and only published results target the adult winner once',async t=>{
 const h=fixture(t),game=makeGame({title:'Herstelshow',date:'2026-11-18T12:30:00Z',brandId:'milo'},'host',origin),store=new BingoStore(h.env.DB);
 game.orders=[{id:'order-one',number:'MF-0001',accountId:'parent',email:'parent@example.test',customerName:'Volwassen ouder',quantity:1,amountCents:250,show:{title:game.title,date:game.date},serviceEvents:[{eventId:'durable/order-one/received/1',templateId:'order-received'}]}];
 await store.create(game);await recoverOrderMailEvents({env:h.env,game,origin});await recoverOrderMailEvents({env:h.env,game,origin});assert.equal(h.sent.length,1);assert.deepEqual(h.sent[0].payload.to,['parent@example.test']);
 await store.family('winner-parent','winner-parent@example.test');const result={id:'official-result',acknowledged:false,winner:{accountId:'winner-parent',name:'Fictieve winnaar'},prize:{title:'Bevestigde testprijs'}};
 assert.equal(recordResultMailEvent(game,result),false);await dispatchPublishedPrizeMail({env:h.env,game,result,origin});assert.equal(h.sent.length,1);
 result.acknowledged=true;recordResultMailEvent(game,result);delete h.env.VLAMPIE_SETTINGS_KEY;assert.equal((await dispatchPublishedPrizeMail({env:h.env,game,result,origin})).status,'failed');assert.equal(h.sent.length,1);h.env.VLAMPIE_SETTINGS_KEY='07'.repeat(32);
 await dispatchPublishedPrizeMail({env:h.env,game,result,origin});await dispatchPublishedPrizeMail({env:h.env,game,result,origin});assert.equal(h.sent.length,2);assert.deepEqual(h.sent[1].payload.to,['winner-parent@example.test']);assert(h.sent[1].payload.text.includes('Bevestigde testprijs'));
});

test('MAIL-01 domain recovery repairs missing encrypted preparation once after configuration or object-storage failure, without replaying provider attempts',async t=>{
 for(const failure of ['configuration','object-storage']){
  const h=fixture(t),game=makeGame({title:'Voorbereiding herstellen',date:'2026-11-18T12:30:00Z',brandId:'milo'},'host',origin);
  game.orders=[{id:'recover-order',number:'MF-0007',accountId:'parent',email:'parent@example.test',customerName:'Volwassen ouder',quantity:1,amountCents:250,show:{title:game.title,date:game.date},serviceEvents:[{eventId:'durable/recover-order/received/1',templateId:'order-received'}]}];
  const settingsKey=h.env.VLAMPIE_SETTINGS_KEY,put=h.env.SETTINGS.put,adapter=h.env.ORDER_MAIL_DELIVERY;
  if(failure==='configuration'){delete h.env.VLAMPIE_SETTINGS_KEY;delete h.env.ORDER_MAIL_DELIVERY;}else h.env.SETTINGS.put=async()=>{throw Error('synthetic private-object storage outage');};
  const initial=await recoverOrderMailEvents({env:h.env,game,origin});assert.equal(initial[0].status,'failed');assert.equal(h.sent.length,0);
  const before=(await h.store.list('delivery','milo'))[0];assert.equal(before.payloadReady,false);assert.equal(before.attempts,undefined);assert.equal(before.eventId,game.orders[0].serviceEvents[0].eventId);
  h.env.VLAMPIE_SETTINGS_KEY=settingsKey;h.env.SETTINGS.put=put;h.env.ORDER_MAIL_DELIVERY=adapter;
  // A different organizer cannot use the same event/recipient hash to rebind it.
  await recoverOrderMailEvents({env:h.env,game:{...game,ownerId:'other-host'},origin});assert.equal(h.sent.length,0);assert.equal((await h.store.get(before.id)).payloadReady,false);
  await Promise.all([recoverOrderMailEvents({env:h.env,game,origin}),recoverOrderMailEvents({env:h.env,game,origin})]);
  const after=await h.store.get(before.id);assert.equal(after.id,before.id);assert.equal(after.eventId,before.eventId);assert.equal(after.status,'accepted');assert.equal(after.attempts,1);assert.equal(h.sent.length,1);
  const savedObjects=[...h.objects.entries()];await recoverOrderMailEvents({env:h.env,game,origin});assert.equal(h.sent.length,1);assert.deepEqual([...h.objects.entries()],savedObjects,'an accepted message retains its frozen payload');
 }
});

test('MAIL-01 preparation recovery refuses offering, uncertain, previously contacted and mismatched event records',async t=>{
 for(const fields of [{status:'offering',attempts:1},{status:'uncertain',uncertain:true},{status:'failed',attempts:1},{status:'failed',providerId:'prior-contact'},{status:'failed',eventId:'different-domain-event'}]){
  const h=fixture(t);delete h.env.VLAMPIE_SETTINGS_KEY;const pending=await dispatchMailEvent({...welcome,env:h.env});assert.equal(pending.status,'failed');
  await h.store.mutate(pending.id,r=>Object.assign(r,fields));h.env.VLAMPIE_SETTINGS_KEY='07'.repeat(32);const before=await h.store.get(pending.id);
  await dispatchMailEvent({...welcome,env:h.env,repairPreparation:true});assert.equal(h.sent.length,0);assert.deepEqual(await h.store.get(pending.id),before);assert.equal(h.objects.size,0);
 }
});
