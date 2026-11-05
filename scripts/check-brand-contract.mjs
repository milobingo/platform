import {verifiedTestEnvironment} from './verified-test-identity.mjs';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {BingoStore} from '../server/bingo-store.js';
import {makeGame,generateBooks} from '../server/bingo-model.js';
import {handleBingo as verifiedhandleBingo} from '../server/bingo.js';
import {handlePlayerAuth as verifiedhandlePlayerAuth} from '../server/player-auth.js';
import {showPresentation,freezePresentation,defaultPresentation,speechStyle} from '../server/presentation-model.js';
import {presentationContext} from '../server/presentation-context.js';
import {bookPdf} from '../server/bingo-pdf.js';
import {PDFDocument} from 'pdf-lib';
const db=new DatabaseSync(':memory:');for(const f of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())db.exec(readFileSync('drizzle/'+f,'utf8'));
const statement=(sql,args=[])=>({bind:(...args)=>statement(sql,args),first:async()=>db.prepare(sql).get(...args)||null,run:async()=>({meta:db.prepare(sql).run(...args)}),all:async()=>({results:db.prepare(sql).all(...args)})});
const DB={prepare:sql=>statement(sql),batch:async statements=>{db.exec('BEGIN');try{const values=[];for(const s of statements)values.push(await s.all());db.exec('COMMIT');return values;}catch(e){db.exec('ROLLBACK');throw e;}}};
const env={DB,VLAMPIE_ADMIN_EMAIL:'host@example.test'},store=new BingoStore(DB),game=makeGame({brandId:'rocco',date:'2026-12-05T19:00'},'host','https://studio.example');generateBooks(game,2,'brand');game.status='running';game.state.drawn=[1,4,12,75];game.state.pending={number:33,token:'preserved'};game.presentationSnapshot=freezePresentation(game,{document:defaultPresentation(),revision:1});await store.create(game);
const req=(body,user='host')=>new Request(`https://studio.example/api/bingo/games/${game.id}/brand`,{method:'POST',headers:{origin:'https://studio.example','x-vlampie-bingo':'1','content-type':'application/json','oai-authenticated-user-id':user,'oai-authenticated-user-email':user+'@example.test'},body:JSON.stringify({regieId:'test-regie',...body})});
assert.equal((await handleBingo(req({brandId:'milo'},'player'),env)).status,403);assert.equal((await handleBingo(req({brandId:'forged'}),env)).status,400);
const before=JSON.stringify([game.books,game.results,game.state.drawn,game.state.pending]);
for(const id of ['milo','vlampie','rocco']){const response=await handleBingo(req({brandId:id}),env);assert.equal(response.status,200);const g=(await response.json()).game;assert.equal(g.brandId,id);assert.equal(JSON.stringify([g.books,g.results,g.state.drawn,g.state.pending]),before);const ctx=await presentationContext(env,'host',{gameId:game.id});assert.equal(ctx.profile.brandId,id);assert(speechStyle(ctx.profile).includes(id==='milo'?'Milo Magico':id==='rocco'?'Rocco Royale':'Vlampie'));const rule=showPresentation(g).rules.find(r=>r.id==='regel-chat');assert(rule.text.includes(id==='rocco'?'@Rocco':id==='milo'?'@Milo':'@Vlampie'));}
await store.mutate(game.id,{},g=>g.state.callId='active-call');assert.equal((await handleBingo(req({brandId:'milo'}),env)).status,409);await store.mutate(game.id,{},g=>g.state.callId=null);
const publicIdentity=await handlePlayerAuth(new Request('https://studio.example/api/player/brand?game='+game.id),env);assert.equal(publicIdentity.status,200);assert.deepEqual(await publicIdentity.json(),{brandId:'rocco'});
for(const id of ['rocco','milo'])for(const mode of ['color','mono']){game.brandId=id;const bytes=await bookPdf(game,[game.books[0].id],{mode}),pdf=await PDFDocument.load(bytes);assert.equal(pdf.getPageCount(),1);assert(Math.abs(pdf.getPage(0).getWidth()-419.5276)<.1);assert(pdf.getCreator().includes(id==='rocco'?'Rocco':'Milo'));}
db.close();console.log('Host switch permissions, live-call guard, immutable game outcomes, prompts/rules, public identity and four A5 templates passed.');

function handleBingo(request,env,...args){return verifiedhandleBingo(request,verifiedTestEnvironment(request,env),...args);}
function handlePlayerAuth(request,env,...args){return verifiedhandlePlayerAuth(request,verifiedTestEnvironment(request,env),...args);}
