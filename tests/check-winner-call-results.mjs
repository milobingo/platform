import test from 'node:test';
import assert from 'node:assert/strict';
import {makeGame,generateBooks,activateBlock,beginBingo,claimBook,settleWindow,familyDefault} from '../server/bingo-model.js';
import {ensureWinnerCallCue} from '../server/call-cues.js';

// Real card completion and claim-window settlement, with fictitious families.
for(const roundIndex of [0,1,2,3])for(const tied of [false,true])test(`round ${roundIndex+1}: late-arriving earlier full card ${tied?'and official tied decision':'outranks the first claim'} before a winner call exists`,()=>{
 const g=makeGame({brandId:'milo',title:'Fictieve uitslagrepetitie',date:'2027-01-01T12:00:00Z',roundCount:4,settings:{retroBalls:3,cooldownSeconds:0,consolationEnabled:true,minigames:['horses']}},'fictional-host','https://example.invalid');
 generateBooks(g,3,'magic-official-'+roundIndex);g.status='running';
 const round=g.plan.blocks.filter(b=>b.type==='round')[roundIndex];round.callFullCardWinner=true;
 activateBlock(g,g.plan.blocks.indexOf(round),round.goals.length-1,100000);
 const card=[...g.books[0].cards[roundIndex]],numbers=card.filter(Boolean),replacement=Array.from({length:15},(_,i)=>i+1).find(n=>!numbers.includes(n));
 g.books[1].cards[roundIndex]=[...card];g.books[2].cards[roundIndex]=[...card];g.books[2].cards[roundIndex][0]=replacement;
 g.books.forEach((b,i)=>Object.assign(b,{accountId:'fictional-family-'+i,profileId:'fictional-child-'+i,name:['Noor','Sam','Mila'][i],admitted:true}));
 g.state.drawn=[...numbers,replacement];const families=g.books.map(()=>familyDefault());
 for(const [i,b]of g.books.entries())beginBingo(g,families[i],b.accountId,'claim-'+i,200000+i);
 assert.equal(claimBook(g,families[2],g.books[2].accountId,g.books[2].id,200010).status,'valid');
 assert.equal(claimBook(g,families[0],g.books[0].accountId,g.books[0].id,g.state.window.endsAt-2).status,'valid');
 if(tied)assert.equal(claimBook(g,families[1],g.books[1].accountId,g.books[1].id,g.state.window.endsAt-1).status,'valid');
 assert.equal(g.results.length,0);assert.equal(g.callCues,undefined);
 const result=settleWindow(g,g.state.window.endsAt);assert(result);assert.equal(result.completeAt,numbers.length);assert.equal(result.entrants.length,tied?2:1);
 assert(result.entrants.every(e=>e.profileId!=='fictional-child-2'));assert.equal(result.consolations.length,1);assert.equal(result.consolations[0].profileId,'fictional-child-2');
 assert.equal(ensureWinnerCallCue(g,result),null,'unpublished results and their consolation never invite');
 result.acknowledged=true;const cue=ensureWinnerCallCue(g,result);assert(cue);assert.equal(cue.winner.profileId,result.winner.profileId);assert.notEqual(cue.winner.profileId,'fictional-child-2');
 assert.equal(cue.status,'waiting-announcement');assert.equal(cue.resumeTarget,roundIndex===3?'ending':'next-round');assert.equal(ensureWinnerCallCue(g,result).id,cue.id);
});
