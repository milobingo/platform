/** Shared browser-local order examples. Never sends mail, fetches payment links
 * or creates a valid game entitlement. The real order server is independent. */
export const ORDER_DEMO_KEY='mf-orders-demo-v1';
export const ORDER_DEMO_EVENT='mf-orders-demo-change';
export const ORDER_DEMO_ACCOUNT='family-demo-account';
export const ORDER_DEMO_SHOW='milo-order-demo-show';
const copy=value=>structuredClone(value);
let fallback;
const now=()=>Date.now();
const profileInfo=id=>id==='noor-demo'?{name:'Noor',age:8}:id==='sem-demo'?{name:'Sem',age:6}:{name:'',age:null};
function demoCard(seed){
 let n=seed>>>0;const next=()=>{n=(Math.imul(n,1664525)+1013904223)>>>0;return n/4294967296;},card=Array(25);
 for(let col=0;col<5;col++){
  const nums=Array.from({length:15},(_,i)=>col*15+i+1);
  for(let i=nums.length-1;i>0;i--){const j=Math.floor(next()*(i+1));[nums[i],nums[j]]=[nums[j],nums[i]];}
  for(let row=0;row<5;row++)card[row*5+col]=row===2&&col===2?0:nums[row];
 }return card;
}
export function makeOrderDemoBooks(order,startTicket=2041){
 const seed=[...order.id].reduce((sum,c)=>(Math.imul(sum,31)+c.charCodeAt(0))>>>0,17);
 return Array.from({length:order.quantity},(_,i)=>{
  const profileId=order.profileIds?.[i]||null,profile=profileInfo(profileId),id=order.id+'-boek-'+(i+1),ticket=String(startTicket+i);
  return {id,ticket,code:'DEMO'+ticket,token:'ongeldig-voorbeeld-'+id,accountId:order.accountId,profileId,name:order.profileNames?.[i]||profile.name,age:order.profileAges?.[i]??profile.age,admitted:!!profileId,issueStatus:profileId?'assigned':'paid-ready',batchId:'demo-batch-'+order.id,orderId:order.id,cards:Array.from({length:4},(_,r)=>demoCard(seed+i*137+r*311)),simulated:true};
 });
}
function seedState(){
 const time=now(),config={enabled:true,unitPriceCents:350,maxQuantity:30,description:'Een fictieve bestelshow met vier rondes. Alle voorbeeldbladen zijn ongeldig.'};
 const show={id:ORDER_DEMO_SHOW,title:'Milo’s Magische BingoShow',date:'2026-11-18T13:30',status:'draft',brandId:'milo',roundCount:4,config:copy(config),ordering:copy(config),available:true};
 const common={accountId:ORDER_DEMO_ACCOUNT,customerName:'Familie Jansen',email:'familie.jansen@voorbeeld.invalid',show:{id:show.id,title:show.title,date:show.date,roundCount:4},quantity:2,profileIds:['noor-demo','sem-demo'],amountCents:700,bookIds:[],books:[],note:'',paymentUrl:'',paymentMail:{status:'queued'},readyMail:{status:'queued'},simulated:true};
 const rows=[
  {id:'demo-order-nieuw',reference:'MF-DEMO-1041',status:'requested',createdAt:time-20*60000},
  {id:'demo-order-betalen',reference:'MF-DEMO-1042',status:'payment_pending',createdAt:time-65*60000,paymentUrl:'https://payment.example.invalid/demo/1042',paymentMail:{status:'failed',error:'Voorbeeld: de betaalmail is nog niet bevestigd. Probeer de simulatie opnieuw.'}},
  {id:'demo-order-controleren',reference:'MF-DEMO-1043',status:'payment_reported',createdAt:time-2*3600000,paymentReportedAt:time-10*60000,paymentUrl:'https://payment.example.invalid/demo/1043',paymentMail:{status:'simulated',sentAt:time-90*60000}},
  {id:'demo-order-klaar',reference:'MF-DEMO-1044',status:'fulfilled',createdAt:time-86400000,approvedAt:time-23*3600000,paymentUrl:'https://payment.example.invalid/demo/1044',paymentMail:{status:'simulated',sentAt:time-86400000},readyMail:{status:'simulated',sentAt:time-23*3600000}},
  {id:'demo-order-ander-gezin',reference:'MF-DEMO-1045',status:'requested',createdAt:time-45*60000,accountId:'order-demo-ander-gezin',customerName:'Familie De Vries',email:'gezin.devries@voorbeeld.invalid',quantity:1,profileIds:[null],amountCents:350},
 ];
 const orders=rows.map(row=>({...copy(common),...row})),booksByOrder={};
 const ready=orders.find(o=>o.status==='fulfilled'),books=makeOrderDemoBooks(ready);
 booksByOrder[ready.id]=books;ready.bookIds=books.map(b=>b.id);ready.books=books.map(({cards,token,code,...book})=>book);
 return {version:1,orders,shows:[show],booksByOrder};
}
export function readOrderDemo(_context={}){
 try{const stored=JSON.parse(globalThis.localStorage?.getItem(ORDER_DEMO_KEY)||'null');if(stored?.version===1&&Array.isArray(stored.orders)&&Array.isArray(stored.shows)&&stored.booksByOrder)return copy(stored);}catch{}
 fallback??=seedState();return copy(fallback);
}
function persist(state){
 fallback=copy(state);try{globalThis.localStorage?.setItem(ORDER_DEMO_KEY,JSON.stringify(state));}catch{}
 if(typeof globalThis.dispatchEvent==='function'&&typeof CustomEvent==='function')globalThis.dispatchEvent(new CustomEvent(ORDER_DEMO_EVENT));
 return copy(state);
}
export function mutateOrderDemo(operation,context={}){const state=readOrderDemo(context);operation(state);return persist(state);}
export function resetOrderDemo(){return persist(seedState());}
