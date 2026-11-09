import test from 'node:test';
import assert from 'node:assert/strict';
import {MINIGAMES,gameSettings,makeGame,generateBooks} from '../server/bingo-model.js';
import {brandGameName} from '../server/show-brands.js';
import {gameFrame,objectPose,gameEvents,gamePhase} from '../public/bingo-choreography.js';
import {gameGroups} from '../public/bingo-motion.js';
import {fixture} from './live-calls-fixture.mjs';
import {handleBingo} from '../server/bingo.js';
import {plingoPlan,plingoBallPose,drawPlingo,PLINGO_BOARD,plingoPhase} from '../public/plingo-game.js';
const stage=(count=6,winner=count-1)=>{const entrants=Array.from({length:count},(_,i)=>({bookId:'book-'+i,ticket:String(i+1).padStart(4,'0'),name:['Noor','Sophie','Daan','Mila','Sam','Luca'][i%6]+' '+i}));return {type:'minigame',playId:'plingo-check',duration:20,result:{id:'plingo-result-'+count,minigame:'plingo',entrants,winner:entrants[winner],prize:{title:'De toverdoos'}}};};
test('Plingo is a selectable named game without rewriting an existing show selection',()=>{
 const g=MINIGAMES.find(x=>x.id==='plingo');assert(g);assert.equal(g.kind,'pegboard');assert.equal(brandGameName(g,'milo'),'Milo’s Sterrenplingo');assert.equal(brandGameName(g,'vlampie'),'Plingo');assert.deepEqual(gameSettings({minigames:['plingo']}).minigames,['plingo']);assert.deepEqual(gameSettings({minigames:['wheel','gifts']}).minigames,['wheel','gifts']);assert(gameSettings().minigames.includes('plingo'));
 const game=makeGame({brandId:'milo',timeZone:'Europe/Amsterdam',date:'2026-11-01T14:00',roundCount:1,settings:{minigames:['plingo']}},'host','https://bingo.example');generateBooks(game,2,'plingo-books');const cards=structuredClone(game.books);assert.deepEqual(game.settings.minigames,['plingo']);assert.deepEqual(game.books,cards);
});
test('the fixed groups include every entrant once, have stable slots and reveal exactly the canonical winner',()=>{
 for(const count of [1,2,6,10,12,100,400])for(const winner of [0,count-1]){
  const s=stage(count,winner),copy=structuredClone(s),groups=gameGroups(s.result),plan=plingoPlan(s.result);
  assert.equal(groups.flatMap(g=>g.members).length,count);assert.equal(new Set(groups.flatMap(g=>g.members).map(e=>e.bookId)).size,count);assert.equal(plan.targetBookId,s.result.winner.bookId);assert.equal(groups.filter(g=>g.winning).length,1);assert(groups[plan.winnerIndex].members.some(e=>e.bookId===s.result.winner.bookId));
  const end=plingoBallPose(s.result,1);assert.equal(end.x,plan.slots[plan.winnerIndex].x);assert.equal(end.y,PLINGO_BOARD.slotY);assert(end.finished);assert.deepEqual(s,copy,'Visuals may not mutate the canonical result, entrants or prize');
  const other=structuredClone(s);other.result.winner=other.result.entrants[winner===0?count-1:0];assert.deepEqual(gameGroups(other.result).map(g=>g.members.map(m=>m.bookId)),groups.map(g=>g.members.map(m=>m.bookId)));assert.equal(plingoBallPose(other.result,0).x,plingoBallPose(s.result,0).x,'Start position must not reveal the selected winner');
 }
});
test('seeded peg bounces are finite, continuous, seekable and freeze with the supplied clock',()=>{
 const s=stage(100),copy=structuredClone(s);let previous=plingoBallPose(s.result,0);
 for(let i=1;i<=10000;i++){const pose=plingoBallPose(s.result,i/10000);assert(Number.isFinite(pose.x)&&Number.isFinite(pose.y)&&Number.isFinite(pose.angle));assert(pose.x>=135&&pose.x<=1785);assert(pose.y>=180&&pose.y<=820);assert(Math.hypot(pose.x-previous.x,pose.y-previous.y)<4);previous=pose;}
 for(const p of [0,.07,.27,.51,.88,1])assert.deepEqual(plingoBallPose(s.result,p),plingoBallPose(copy.result,p));
 const a=gameFrame(s,8),b=gameFrame(s,8);assert.deepEqual(plingoBallPose(a.result,a.progress),plingoBallPose(b.result,b.progress));assert.equal(gameFrame(s,0,true).progress,1);assert.equal(plingoBallPose(s.result,1).x,plingoPlan(s.result).slots[plingoPlan(s.result).winnerIndex].x);
 const events=gameEvents(s).filter(e=>e.id.startsWith('peg-'));assert.equal(events.length,10);const f=gameFrame(s,0);assert.deepEqual(events.map(e=>e.time),plingoPlan(s.result).impacts.map(hit=>f.intro+hit.at*(f.duration-1.2-f.intro)),'Audio must follow actual peg impacts rather than a uniform old beat');assert.equal(gameEvents(s).filter(e=>e.id.startsWith('lip-')).length,3);assert(events.every(e=>e.time>0&&e.time<20));assert.match(gamePhase(gameFrame(s,10)),/pin/);
});
test('Plingo labels never overlap or leave the stage, even for hundreds of grouped booklets',()=>{
 for(const count of [1,2,3,6,10,100,400])for(const age of [0,3,8,15,20]){
  const s=stage(count),f=gameFrame(s,age),poses=f.groups.map(g=>objectPose(f,g));
  for(const p of poses){assert(p.chipX-p.width/2>=65&&p.chipX+p.width/2<=1855);assert(p.chipY-p.height/2>=177&&p.chipY+p.height/2<=897);}
  for(let i=1;i<poses.length;i++)assert(poses[i].chipX-poses[i-1].chipX>=(poses[i].width+poses[i-1].width)/2);
 }
});
test('the real renderer paints a pegboard and a single result ball without choosing or changing a winner',()=>{
 const gradient={addColorStop(){}},texts=[],circles=[],coords=[];
 const c=new Proxy({createLinearGradient:()=>gradient,createRadialGradient:()=>gradient,arc(...a){circles.push(a);},fillText(v){texts.push(String(v));}},{get:(o,k)=>o[k]??((...a)=>{coords.push(...a.filter(x=>typeof x==='number'));})});
 const ui={palettes:['#f0d289','#83d8ce'],glow(){},winnerHalo(){},label:(ctx,t)=>texts.push(String(t))};
 const s=stage(100),before=structuredClone(s);for(const age of [0,7,13,20])drawPlingo(c,gameFrame(s,age),{},ui);
 assert(circles.length>350,'A complete pin field should actually be drawn');assert(coords.every(Number.isFinite));assert(texts.some(x=>x.includes('GOUDEN BAL')));assert.deepEqual(s,before);
});


test('an enabled real game can persist a Plingo prize reveal while cards and drawn numbers remain unchanged',async t=>{
 const h=await fixture(t);await h.bingo.mutate(h.game.id,{},game=>{game.settings.minigames=['plingo'];});const before=(await h.bingo.game(h.game.id)).data;
 const response=await handleBingo(h.req('host',{regieId:h.ids.host,prize:'De magische verrassingsdoos'},{path:'/api/bingo/games/'+h.game.id+'/raffle'}),h.env);const data=await response.json();assert.equal(response.status,200,JSON.stringify(data));
 const after=(await h.bingo.game(h.game.id)).data,result=after.results.at(-1);assert.equal(result.minigame,'plingo');assert(after.books.some(b=>b.id===result.winner.bookId));assert.deepEqual(after.books,before.books);assert.deepEqual(after.state.drawn,before.state.drawn);
 const endpoint=plingoPlan(result),ball=plingoBallPose(result,1);assert.equal(ball.x,endpoint.slots[endpoint.winnerIndex].x);assert.equal(endpoint.targetBookId,result.winner.bookId);assert.equal((await h.bingo.game(h.game.id)).data.results.at(-1).winner.bookId,result.winner.bookId);
});


test('Plingo has distinct release, faster upper board, late ricochets and settling phases at a video frame rate',()=>{
 const s=stage(10),plan=plingoPlan(s.result),copy=structuredClone(s);
 assert.equal(plan.impacts.length,10);assert(plan.impacts.every((hit,i)=>i===0||hit.at>plan.impacts[i-1].at));
 const firstGap=plan.impacts[2].at-plan.impacts[1].at,lastGap=plan.impacts[9].at-plan.impacts[8].at;
 assert(lastGap>firstGap*1.8,'The lower board needs a visibly slower dramatic tempo');
 assert.equal(plingoPhase(0),'release');assert.equal(plingoPhase(.8),'last-bounce');assert.equal(plingoPhase(.98),'settling');assert.equal(plingoPhase(1),'landed');
 let previous=plingoBallPose(s.result,0),maxStep=0,lateDirection=0,changes=0,rebounds=0,previousVertical=0;
 for(let frame=1;frame<=24*60;frame++){
  const p=frame/(24*60),pose=plingoBallPose(s.result,p),dx=pose.x-previous.x,dy=pose.y-previous.y;
  maxStep=Math.max(maxStep,Math.hypot(dx,dy));
  if(p>.77&&Math.abs(dx)>.015){const direction=Math.sign(dx);if(lateDirection&&direction!==lateDirection)changes++;lateDirection=direction;}
  if(p>.66&&Math.abs(dy)>.015){const vertical=Math.sign(dy);if(previousVertical===1&&vertical===-1)rebounds++;previousVertical=vertical;}
  previous=pose;
 }
 assert(maxStep<18,'A 60fps frame must not teleport the ball across the board');
 assert(changes>=2,'The last receiver lip must keep the direction uncertain until settling');
 assert(rebounds>=2,'Late motion must show actual upward rebounds, not constant diagonal drift');
 assert.deepEqual(s,copy);
});


test('with two or three finalists the last catch still visits a different candidate before the fixed winning cup',()=>{
 for(const count of [2,3])for(let winner=0;winner<count;winner++){
  const s=stage(count,winner),plan=plingoPlan(s.result),near=plingoBallPose(s.result,.775),candidate=plan.slots[plan.nearMissIndex];
  assert.notEqual(plan.nearMissIndex,plan.winnerIndex);
  assert(near.x>candidate.x-candidate.width/2&&near.x<candidate.x+candidate.width/2,'Late catch must visibly enter the adjacent candidate’s cup area');
  assert.equal(plingoBallPose(s.result,1).x,plan.slots[plan.winnerIndex].x);
  let previous=plingoBallPose(s.result,0);
  for(let frame=1;frame<=24*60;frame++){const pose=plingoBallPose(s.result,frame/(24*60));assert(Math.hypot(pose.x-previous.x,pose.y-previous.y)<18,'Late near miss must not teleport across large receiver cups');previous=pose;}
 }
});
