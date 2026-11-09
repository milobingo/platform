import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {LiveChat} from '../public/live-chat.js';
import {FAMILY_REACTIONS} from '../public/family-reactions.js';
import {readFamilyViewing,saveFamilyViewing} from '../frontend/family-accessibility.js';
import {createSqliteDatabase} from '../server/node-storage.js';
import {BingoStore} from '../server/bingo-store.js';
import {makeGame,generateBooks} from '../server/bingo-model.js';
import {handleChat} from '../server/chat.js';
const origin='https://studio.example';

test('viewing preferences persist only booleans per device and brand and default to the system motion preference',()=>{
 const values=new Map(),storage={getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)},quiet=()=>({matches:true}),normal=()=>({matches:false});
 assert.deepEqual(readFamilyViewing('milo',{storage,matchMedia:quiet}),{captions:false,reducedMotion:true});saveFamilyViewing('milo',{captions:true,reducedMotion:false,email:'must-not-store'},{storage});
 assert.deepEqual(readFamilyViewing('milo',{storage,matchMedia:quiet}),{captions:true,reducedMotion:false});assert.deepEqual(readFamilyViewing('vlampie',{storage,matchMedia:normal}),{captions:false,reducedMotion:false});assert(![...values.values()].some(value=>value.includes('must-not-store')));
 values.set('milo-family-viewing-v1:vlampie','broken JSON');assert.deepEqual(readFamilyViewing('vlampie',{storage,matchMedia:quiet}),{captions:false,reducedMotion:true});
 const blocked={getItem(){throw Error('storage blocked');},setItem(){throw Error('storage blocked');}};assert.doesNotThrow(()=>saveFamilyViewing('milo',{captions:true},{storage:blocked}));assert.deepEqual(readFamilyViewing('milo',{storage:blocked,matchMedia:normal}),{captions:false,reducedMotion:false});
});

test('fixed family chat reactions preserve a typed draft, use the selected profile and retry with one stable request ID',async t=>{
 const {window}=parseHTML('<main id="chat"></main>'),previous=new Map(['window','document'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));Object.assign(globalThis,{window,document:window.document});
 const sent=[],self={memberId:'family-member',role:'player',canSend:true,profiles:[{id:'a',name:'Noor'},{id:'b',name:'Sem'}]},chat=new LiveChat({root:window.document.getElementById('chat'),quickReactions:true,streaming:false,fetcher:async(_url,options)=>{
  if(options.method==='POST'){const data=JSON.parse(options.body);sent.push(data);if(sent.length===1)throw Error('lost response');return Response.json({message:{id:'confirmed',seq:1,memberId:'family-member',name:'Sem',role:'player',profileId:data.profileId,text:data.text,at:Date.now()}},{status:201});}
  return Response.json({messages:[],cursor:0,self,serverTime:Date.now()});
 }});t.after(()=>{chat.dispose();for(const [key,descriptor] of previous)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];});await chat.setGame('show-a');chat.selectedProfile='b';chat.refs.input.value='Mijn eigen vraag blijft staan';chat.updateComposer();
 assert.equal(chat.reactionControls.length,4);await chat.send('applause');assert(sent.length>=2);assert.equal(new Set(sent.map(message=>message.requestId)).size,1);assert(sent.every(message=>message.profileId==='b'&&message.text==='👏 Applaus!'));assert.equal(chat.refs.input.value,'Mijn eigen vraag blijft staan');assert.equal(chat.messages.get('confirmed').name,'Sem');
 const count=sent.length;await chat.send('untrusted-text');assert.equal(sent.length,count);chat.self={...self,canSend:false};chat.updateComposer();assert(chat.reactionControls.every(control=>control.disabled));await chat.send('wave');assert.equal(sent.length,count);
});

test('family reaction requests use real chat authorization, rate limits and moderator removal without publishing to the programme',async t=>{
 const DB=createSqliteDatabase(':memory:');t.after(()=>DB.close());const store=new BingoStore(DB);await store.editFamily('family','parent@example.test',family=>{family.profiles=[{id:'child',name:'Noor',age:8}];});
 const game=makeGame({brandId:'milo',date:'2027-11-11T13:30',timeZone:'Europe/Amsterdam'},'host',origin);generateBooks(game,1,'reaction-test');Object.assign(game.books[0],{accountId:'family',profileId:'child',name:'Noor',issueStatus:'assigned'});game.status='running';await store.create(game);const before=await DB.prepare('SELECT revision,document FROM bingo_games WHERE id=?').bind(game.id).first();
 const request=async({body,user='family',action='',gameId=game.id}={})=>{const response=await handleChat(new Request(`${origin}/api/bingo/games/${gameId}/chat${action}`,{method:body?'POST':'GET',headers:{Origin:origin,'Content-Type':'application/json','X-Vlampie-Bingo':'1'},...(body?{body:JSON.stringify({requestId:crypto.randomUUID(),...body})}:{})}),{DB,AUTH_IDENTITY:{user,email:user+'@example.test',admin:user==='host'}});return {status:response.status,data:await response.json()};};
 const reaction=FAMILY_REACTIONS[0],requestId=crypto.randomUUID(),first=await request({body:{profileId:'child',text:reaction.text,requestId}});assert.equal(first.status,201);assert.equal(first.data.message.name,'Noor');assert(!JSON.stringify(first.data).includes('parent@example.test'));
 const replay=await request({body:{profileId:'child',text:reaction.text,requestId}});assert.equal(replay.status,201);assert.equal(replay.data.message.id,first.data.message.id);
 assert.equal((await request({body:{profileId:'child',text:FAMILY_REACTIONS[1].text}})).status,429);
 assert.equal((await request({user:'outsider',body:{profileId:'child',text:reaction.text}})).status,403);
 await DB.prepare('UPDATE bingo_chat_members SET last_sent_at=0 WHERE account_id=?').bind('family').run();assert.equal((await request({body:{profileId:'not-owned',text:reaction.text}})).status,400);
 const deleted=await request({user:'host',action:'/messages/'+first.data.message.id+'/delete',body:{}});assert.equal(deleted.status,200);const view=await request();assert.equal(view.data.messages.find(message=>message.id===first.data.message.id).text,'');
 assert.deepEqual(await DB.prepare('SELECT revision,document FROM bingo_games WHERE id=?').bind(game.id).first(),before);assert.equal(await DB.prepare('SELECT 1 FROM studio_outputs LIMIT 1').first(),null);
});
