import assert from 'node:assert/strict';
import test from 'node:test';
import {familyPrizeAwards} from '../frontend/family-prizes.js';
import {ShowRuntime} from '../frontend/show-runtime.js';

const prize = {title:'Verrassingspakket',description:'Hoofdprijs',image:''};
const result = () => ({
 id:'result-1',acknowledged:true,mine:false,delivered:false,prize,
 winner:{name:'Een ander gezin',ticket:'0010',bookId:'main-book'},
 consolations:[
  {id:'award-1',name:'Noor',ticket:'0011',bookId:'our-book',mine:true,delivered:false,prize:{title:'Klein verrassingszakje',description:'Troostprijs',image:''}},
  {id:'award-2',name:'Andere speler',ticket:'0012',bookId:'other-book',mine:false,delivered:true,prize:{title:'Klein verrassingszakje',description:'Troostprijs',image:''}},
 ],
});

test('a consolation is a separate personal award and never makes another family’s main prize mine',()=>{
 const rows=familyPrizeAwards([result()]);
 assert.equal(rows.length,3);
 const mine=rows.filter(row=>row.mine);
 assert.equal(mine.length,1);
 assert.equal(mine[0].kind,'consolation');
 assert.equal(mine[0].winner.name,'Noor');
 assert.equal(mine[0].prize.title,'Klein verrassingszakje');
 assert.equal(rows.find(row=>row.kind==='main').mine,false);
 assert.equal(rows.find(row=>row.id==='award-2').delivered,true);
});

test('unannounced results expose no prize cards or consolation cards',()=>{
 assert.deepEqual(familyPrizeAwards([{...result(),acknowledged:false}]),[]);
 assert.deepEqual(familyPrizeAwards(undefined),[]);
 const original=result();
 familyPrizeAwards([original]);
 assert.equal(original.consolations[0].winner,undefined,'UI projection must not mutate server objects');
});

test('delivery targets the selected award and keeps the main prize and other children independent',async()=>{
 const r=result(),calls=[];
 const engine={demo:false,game:{id:'show',results:[r]},emit(){},post:async(action,body)=>calls.push({action,body})};
 const runtime=new ShowRuntime(engine);
 await runtime.deliver(r.id,true,'award-1');
 await runtime.deliver(r.id,true);
 assert.deepEqual(calls,[{action:'delivery',body:{resultId:r.id,delivered:true,awardId:'award-1'}},{action:'delivery',body:{resultId:r.id,delivered:true}}]);
 engine.demo=true;
 await runtime.deliver(r.id,true,'award-1');
 assert.equal(r.delivered,false);
 assert.equal(r.consolations[0].delivered,true);
 assert.equal(r.consolations[1].delivered,true);
 await runtime.deliver(r.id,false,'award-1');
 assert.equal(r.consolations[0].delivered,false);
 assert.equal(r.consolations[0].deliveredAt,null);
 assert.equal(r.consolations[1].delivered,true);
 await assert.rejects(()=>runtime.deliver(r.id,true,'unknown-award'),/niet beschikbaar/);
 assert.equal(r.delivered,false);
});
