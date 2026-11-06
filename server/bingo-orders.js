import {BingoError,playerGame,bingoPrintMode} from './bingo-model.js';
import {orderingConfig,orderingAvailable,orderShow,orderById,createOrder,setPaymentLink,reportOrderPaid,closeOrder,fulfillOrder,assignOrderBook,projectOrder} from './bingo-order-model.js';
import {dispatchOrderMail} from './bingo-order-mail.js';
import {bookPdf,printVersion} from './bingo-pdf.js';
import {brandId} from './show-brands.js';

const snapshots=(game,user,admin,now)=>({orders:(game.orders||[]).filter(o=>admin||o.accountId===user).map(o=>projectOrder(o,game,{admin})),config:orderingConfig(game.ordering),available:orderingAvailable(game,now),serverTime:now});
const emailKind=kind=>{if(!['payment','ready'].includes(kind))throw new BingoError('Kies de betaalmail of de boekjesmail.');return kind;};
export async function handleBingoOrders({path,request,url,body,requestId,user,email,admin:authorizedAdmin,store,env,now,json,hostGame}){
 // Opening the family portal as an organizer must retain the family's reduced
 // view. The header can reduce authority only; it never grants host access.
 const admin=authorizedAdmin&&request.headers.get('x-vlampie-player')!=='1'&&url.searchParams.get('player')!=='1';
 if(path==='/orders'&&request.method==='GET'){
  const rows=(await store.games()).filter(r=>!admin||r.owner_id===user),orders=[];
  for(const row of rows)for(const order of row.data.orders||[])if(admin||order.accountId===user)orders.push(projectOrder(order,row.data,{admin}));
  orders.sort((a,b)=>b.createdAt-a.createdAt);
  return json({orders,shows:rows.map(r=>orderShow(r.data,now)),serverTime:now});
 }
 const match=path.match(/^\/games\/([a-f0-9-]{36})\/orders(?:\/(config|[a-f0-9-]{36})(?:\/(payment-link|paid|approve|assign|cancel|reject|mail|pdf))?)?$/);
 if(!match)return null;
 const [_,gameId,part,action]=match,row=await store.game(gameId);
 if(!row)throw new BingoError('Deze show bestaat niet.',404);
 if(admin&&row.owner_id!==user)throw new BingoError('Deze show hoort bij een andere organisatie.',403);
 const requireHost=()=>{if(!admin)throw new BingoError('Alleen de organisatie kan deze bestelling goedkeuren of een betaallink instellen.',403);};
 const scopedId=`${user}:${request.method}:${path}:${requestId}`;
 const response=async(orderId,status=200,family=null)=>{
  const game=(await store.game(gameId)).data,order=orderId?orderById(game,orderId):null;
  return json({...snapshots(game,user,admin,Date.now()),...(order?{order:projectOrder(order,game,{admin})}:{}),game:admin?hostGame(game):playerGame(game,user),...(family?{family}:{})},status);
 };
 if(!part){
  if(request.method==='GET')return json(snapshots(row.data,user,admin,now));
  if(request.method!=='POST')throw new BingoError('Deze methode is niet beschikbaar.',405);
  const saved=await store.mutate(gameId,{requestId:scopedId,accountId:user,email},(game,family)=>createOrder(game,family,{accountId:user,email,requestId,quantity:body.quantity,profileIds:body.profileIds},now));
  const order=saved.result||(saved.game.orders||[]).find(o=>o.accountId===user&&o.createRequestId===requestId);
  if(!order)throw new BingoError('De bestelling kon nog niet worden bevestigd.',409);
  return response(order.id,saved.replayed?200:201,saved.family);
 }
 if(part==='config'){
  requireHost();if(request.method!=='POST')throw new BingoError('Deze methode is niet beschikbaar.',405);
  await store.mutate(gameId,{requestId:scopedId},game=>{if(game.status!=='draft')throw new BingoError('Bestellen kan alleen voor een show die nog niet is gestart.',409);game.ordering=orderingConfig(body);});
  return response(null);
 }
 const order=orderById(row.data,part);
 if(!admin&&order.accountId!==user)throw new BingoError('Deze bestelling hoort niet bij jouw account.',403,'order_ownership');
 if(!action&&request.method==='GET')return response(order.id);
 if(action==='pdf'&&request.method==='GET'){
  if(order.status!=='fulfilled')throw new BingoError('De organisatie heeft deze bestelling nog niet vrijgegeven.',403,'order_not_ready');
  if(order.bookIds.length!==order.quantity||order.bookIds.some(id=>!row.data.books.some(b=>b.id===id&&b.accountId===order.accountId&&b.orderId===order.id)))throw new BingoError('De bladen van deze bestelling moeten door de organisatie worden gecontroleerd.',409);
  const mode=bingoPrintMode(url.searchParams.get('mode')||'color'),format=url.searchParams.get('format')||'a5';
  if(!['a5','a4'].includes(format))throw new BingoError('Kies A5 of A4 als afdrukformaat.');
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(order.bookIds.join(':')))),v=>v.toString(16).padStart(2,'0')).join('');
  const key=`bingo-orders/${printVersion(row.data)}/${brandId(row.data)}/${gameId}/${order.id}/${format}/${mode}/${hash}`;
  const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Type':'application/pdf','Content-Disposition':`attachment; filename="Bingobladen-${order.number}-${format.toUpperCase()}-${mode==='color'?'kleur':'zwart-wit'}.pdf"`};
  const cached=await env.SETTINGS?.get(key);if(cached)return new Response(cached.body,{headers});
  const bytes=await bookPdf(row.data,order.bookIds,{mode,format});await env.SETTINGS?.put(key,bytes,{httpMetadata:{contentType:'application/pdf'}});return new Response(bytes,{headers});
 }
 if(request.method!=='POST')throw new BingoError('Deze methode is niet beschikbaar.',405);
 if(action==='payment-link'){
  requireHost();await store.mutate(gameId,{requestId:scopedId},game=>setPaymentLink(game,orderById(game,order.id),body,now));
  await dispatchOrderMail({store,gameId,orderId:order.id,kind:'payment',env,origin:url.origin,now});return response(order.id);
 }
 if(action==='approve'){
  requireHost();const saved=await store.mutate(gameId,{requestId:scopedId,accountId:order.accountId,email:order.email},(game,family)=>fulfillOrder(game,family,orderById(game,order.id),{paymentVerified:body.paymentVerified,hostId:user},now));
  await dispatchOrderMail({store,gameId,orderId:order.id,kind:'ready',env,origin:url.origin,now});return response(order.id,200,saved.family);
 }
 if(action==='assign'){
  const saved=await store.mutate(gameId,{requestId:scopedId,accountId:order.accountId,email:order.email},(game,family)=>{const current=orderById(game,order.id);if(!admin&&current.accountId!==user)throw new BingoError('Deze bestelling hoort niet bij jouw account.',403);return assignOrderBook(game,family,current,body,now);});return response(order.id,200,saved.family);
 }
 if(action==='paid'){
  if(admin)throw new BingoError('Een betaalmelding komt van het gezin. Gebruik goedkeuren nadat je de betaling hebt gecontroleerd.',409);
  await store.mutate(gameId,{requestId:scopedId},game=>reportOrderPaid(game,orderById(game,order.id),now));return response(order.id);
 }
 if(action==='cancel'||action==='reject'){
  if(action==='reject')requireHost();
  await store.mutate(gameId,{requestId:scopedId},game=>closeOrder(orderById(game,order.id),action==='cancel'?'cancelled':'rejected',body.reason,now));return response(order.id);
 }
 if(action==='mail'){
  requireHost();const kind=emailKind(body.kind);
  await dispatchOrderMail({store,gameId,orderId:order.id,kind,env,origin:url.origin,now});return response(order.id);
 }
 throw new BingoError('Deze bestelfunctie bestaat niet.',404);
}
