import {BingoError,familyDefault} from './bingo-model.js';
import {GAME_DOCUMENT_BYTES,assertGameMutationCapacity} from './game-capacity.js';
import {repairLegacyPlanBrand} from './show-brands.js';
// Interpret inherited stock copy once at the shared read boundary. GET performs
// no write; an authorized mutation persists the same repaired cue IDs/order.
const decode=row=>{if(!row)return null;const data=JSON.parse(row.document);if(data.brandId==='milo'&&Array.isArray(data.plan?.blocks)&&Array.isArray(data.books))data.plan=repairLegacyPlanBrand(data.plan,data);return {...row,data};};
export class BingoStore{
 constructor(db){this.db=db;}
 async game(id){return decode(await this.db.prepare('SELECT * FROM bingo_games WHERE id = ?').bind(id).first());}
 async games(){return (await this.db.prepare('SELECT * FROM bingo_games ORDER BY updated_at DESC').all()).results.map(decode);}
 async family(id,email=''){
  await this.db.prepare('INSERT INTO bingo_families (account_id,revision,document) VALUES (?,1,?) ON CONFLICT(account_id) DO NOTHING').bind(id,JSON.stringify(familyDefault(email))).run();
  return decode(await this.db.prepare('SELECT * FROM bingo_families WHERE account_id = ?').bind(id).first());
 }
 async families(){return (await this.db.prepare('SELECT * FROM bingo_families').all()).results.map(decode);}
 serialize(data){const serialized=JSON.stringify(data);if(new TextEncoder().encode(serialized).length>GAME_DOCUMENT_BYTES)throw new BingoError('Deze wijziging past niet binnen de showcapaciteit. Maak een volgend spel voor nieuwe boekjes.',409,'game_capacity');return serialized;}
 async create(game){game.revision=1;await this.db.prepare('INSERT INTO bingo_games (id,owner_id,revision,document,updated_at) VALUES (?,?,1,?,?)').bind(game.id,game.ownerId,this.serialize(game),Date.now()).run();return game;}
 async editFamily(id,email,operation){for(let tries=0;tries<8;tries++){const row=await this.family(id,email),data=structuredClone(row.data),result=await operation(data);const saved=await this.db.prepare('UPDATE bingo_families SET revision = ?, document = ? WHERE account_id = ? AND revision = ? RETURNING revision').bind(row.revision+1,this.serialize(data),id,row.revision).first();if(saved)return {family:data,result};}throw new BingoError('Een andere wijziging loopt nog. Probeer opnieuw.',409,'conflict');}
 async mutate(id,options={},operation){
  // Only explicitly selected internal family actions use the native queue.
  // Other writers remain concurrent and every original CAS guard still runs.
  if(options.serializeLocal===true&&this.db.kind==='postgres'&&typeof this.db.withGameMutation==='function')return this.db.withGameMutation(id,()=>this.#mutateCurrent(id,options,operation));
  return this.#mutateCurrent(id,options,operation);
 }
 async #mutateCurrent(id,{accountId=null,email='',requestId=crypto.randomUUID(),binding=null,authorize=null,receiptClaim=null,durableReplay=null}={},operation){
  for(let tries=0;tries<8;tries++){
   const row=await this.game(id);if(!row)throw new BingoError('Dit spel bestaat niet.',404);
   // Authorization always precedes replay lookup, including an exact retry.
   if(authorize)await authorize(row.data);
   const familyRow=accountId?await this.family(accountId,email):null,game=structuredClone(row.data),family=familyRow?structuredClone(familyRow.data):null;
   const durable=durableReplay?await durableReplay(row.data):null;if(durable)return {game:row.data,family,result:structuredClone(durable.result),replayed:true};
   const receipt=binding!==null?(row.data.operationReceipts||[]).find(receipt=>receipt.id===requestId):null;
   if(receipt){if(receipt.binding!==binding)throw new BingoError('Dit verzoek is met andere invoer gebruikt. Bevestig opnieuw.',409,'request_conflict');return {game:row.data,family,result:structuredClone(receipt.result),replayed:true};}
   if(row.data.ops?.includes(requestId)){if(binding!==null)throw new BingoError('Dit verzoek kan niet veilig worden herhaald. Bevestig opnieuw.',409,'request_conflict');return {game:row.data,family,result:null,replayed:true};}
   // Recompute on every attempt, after waiting and fresh authorization/replay.
   // Callbacks must use this server time for deadlines, cooldowns and leases.
   const executionNow=Date.now(),result=await operation(game,family,executionNow);const payment=receiptClaim?receiptClaim(game,result):null;if(payment){if(!/^[a-f0-9]{64}$/.test(payment.receiptHash)||typeof payment.orderId!=='string'||!game.orders?.some(order=>order.id===payment.orderId))throw new BingoError('Het betaalbewijs kon niet veilig worden gekoppeld.',409,'payment_receipt_conflict');const used=await this.db.prepare('SELECT game_id,order_id FROM bingo_payment_receipts WHERE receipt_hash = ?').bind(payment.receiptHash).first();if(used&&(used.game_id!==id||used.order_id!==payment.orderId))throw new BingoError('Dit betaalbewijs kan niet voor deze bestelling worden gebruikt.',409,'payment_receipt_conflict');}if(binding!==null)game.operationReceipts=[...(game.operationReceipts||[]),{id:requestId,binding,result:structuredClone(result??null)}].slice(-250);const attempt=crypto.randomUUID();game.lastOp=attempt;game.revision=row.revision+1;game.ops=[...(game.ops||[]),requestId].slice(-250);
   assertGameMutationCapacity(row.data,game);const revision=row.revision+1,receiptGuard=payment?' AND NOT EXISTS (SELECT 1 FROM bingo_payment_receipts WHERE receipt_hash = ? AND (game_id <> ? OR order_id <> ?))':'',receiptValues=payment?[payment.receiptHash,id,payment.orderId]:[],serialized=this.serialize(game),newBooks=game.books.slice(row.data.books.length),codes=newBooks.map(b=>b.code),codeValues=codes.length?[JSON.stringify(codes)]:[],codeGuard=codes.length?' AND NOT EXISTS (SELECT 1 FROM bingo_codes WHERE code IN (SELECT value FROM json_each(?)))':'',extra=codes.length?[this.db.prepare("INSERT INTO bingo_codes (code,game_id) SELECT value,? FROM json_each(?) WHERE EXISTS (SELECT 1 FROM bingo_games WHERE id = ? AND revision = ? AND json_extract(document,'$.lastOp') = ?)").bind(id,JSON.stringify(codes),id,revision,attempt)]:[];if(payment)extra.push(this.db.prepare("INSERT INTO bingo_payment_receipts (receipt_hash,game_id,order_id,created_at) SELECT ?,?,?,? WHERE EXISTS (SELECT 1 FROM bingo_games WHERE id = ? AND revision = ? AND json_extract(document,'$.lastOp') = ?) ON CONFLICT(receipt_hash) DO NOTHING").bind(payment.receiptHash,id,payment.orderId,Date.now(),id,revision,attempt),this.db.prepare('UPDATE bingo_games SET revision = revision WHERE id = ? AND revision = ? AND EXISTS (SELECT 1 FROM bingo_payment_receipts WHERE receipt_hash = ? AND game_id = ? AND order_id = ?) RETURNING revision').bind(id,revision,payment.receiptHash,id,payment.orderId));let saved;
   if(familyRow){
    const results=await this.db.batch([
     this.db.prepare('UPDATE bingo_games SET revision = ?,document = ?,updated_at = ? WHERE id = ? AND revision = ? AND EXISTS (SELECT 1 FROM bingo_families WHERE account_id = ? AND revision = ?)'+codeGuard+receiptGuard+' RETURNING revision').bind(revision,serialized,Date.now(),id,row.revision,accountId,familyRow.revision,...codeValues,...receiptValues),
     this.db.prepare("UPDATE bingo_families SET revision = ?,document = ? WHERE account_id = ? AND revision = ? AND EXISTS (SELECT 1 FROM bingo_games WHERE id = ? AND revision = ? AND json_extract(document,'$.lastOp') = ?) RETURNING revision").bind(familyRow.revision+1,this.serialize(family),accountId,familyRow.revision,id,revision,attempt),
     ...extra,
    ]);saved=results[0]?.results?.length&&results[1]?.results?.length;
   }else if(codes.length||payment){const results=await this.db.batch([this.db.prepare('UPDATE bingo_games SET revision = ?,document = ?,updated_at = ? WHERE id = ? AND revision = ?'+codeGuard+receiptGuard+' RETURNING revision').bind(revision,serialized,Date.now(),id,row.revision,...codeValues,...receiptValues),...extra]);saved=results[0]?.results?.length;}else saved=await this.db.prepare('UPDATE bingo_games SET revision = ?,document = ?,updated_at = ? WHERE id = ? AND revision = ? RETURNING revision').bind(revision,serialized,Date.now(),id,row.revision).first();
   if(saved)return {game,family,result};await new Promise(resolve=>setTimeout(resolve,25+crypto.getRandomValues(new Uint32Array(1))[0]%Math.min(400,50*(tries+1))));
  }throw new BingoError('Het spel wordt tegelijk bijgewerkt. Probeer opnieuw.',409,'conflict');
 }
}
