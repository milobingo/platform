import {BingoError,familyDefault} from './bingo-model.js';
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
 serialize(data){const serialized=JSON.stringify(data);if(new TextEncoder().encode(serialized).length>1500000)throw new BingoError('Dit spel is te groot. Maak een volgend spel voor nieuwe boekjes.');return serialized;}
 async create(game){game.revision=1;await this.db.prepare('INSERT INTO bingo_games (id,owner_id,revision,document,updated_at) VALUES (?,?,1,?,?)').bind(game.id,game.ownerId,this.serialize(game),Date.now()).run();return game;}
 async editFamily(id,email,operation){for(let tries=0;tries<8;tries++){const row=await this.family(id,email),data=structuredClone(row.data),result=await operation(data);const saved=await this.db.prepare('UPDATE bingo_families SET revision = ?, document = ? WHERE account_id = ? AND revision = ? RETURNING revision').bind(row.revision+1,this.serialize(data),id,row.revision).first();if(saved)return {family:data,result};}throw new BingoError('Een andere wijziging loopt nog. Probeer opnieuw.',409,'conflict');}
 async mutate(id,{accountId=null,email='',requestId=crypto.randomUUID()}={},operation){
  for(let tries=0;tries<8;tries++){
   const row=await this.game(id);if(!row)throw new BingoError('Dit spel bestaat niet.',404);
   if(row.data.ops?.includes(requestId))return {game:row.data,result:null,replayed:true};
   const familyRow=accountId?await this.family(accountId,email):null,game=structuredClone(row.data),family=familyRow?structuredClone(familyRow.data):null;
   const result=await operation(game,family);const attempt=crypto.randomUUID();game.lastOp=attempt;game.revision=row.revision+1;game.ops=[...(game.ops||[]),requestId].slice(-250);
   const revision=row.revision+1,serialized=this.serialize(game),newBooks=game.books.slice(row.data.books.length),codes=newBooks.map(b=>b.code),codeValues=codes.length?[JSON.stringify(codes)]:[],codeGuard=codes.length?' AND NOT EXISTS (SELECT 1 FROM bingo_codes WHERE code IN (SELECT value FROM json_each(?)))':'',extra=codes.length?[this.db.prepare("INSERT INTO bingo_codes (code,game_id) SELECT value,? FROM json_each(?) WHERE EXISTS (SELECT 1 FROM bingo_games WHERE id = ? AND revision = ? AND json_extract(document,'$.lastOp') = ?)").bind(id,JSON.stringify(codes),id,revision,attempt)]:[];let saved;
   if(familyRow){
    const results=await this.db.batch([
     this.db.prepare('UPDATE bingo_games SET revision = ?,document = ?,updated_at = ? WHERE id = ? AND revision = ? AND EXISTS (SELECT 1 FROM bingo_families WHERE account_id = ? AND revision = ?)'+codeGuard+' RETURNING revision').bind(revision,serialized,Date.now(),id,row.revision,accountId,familyRow.revision,...codeValues),
     this.db.prepare("UPDATE bingo_families SET revision = ?,document = ? WHERE account_id = ? AND revision = ? AND EXISTS (SELECT 1 FROM bingo_games WHERE id = ? AND revision = ? AND json_extract(document,'$.lastOp') = ?) RETURNING revision").bind(familyRow.revision+1,this.serialize(family),accountId,familyRow.revision,id,revision,attempt),
     ...extra,
    ]);saved=results[0]?.results?.length&&results[1]?.results?.length;
   }else if(codes.length){const results=await this.db.batch([this.db.prepare('UPDATE bingo_games SET revision = ?,document = ?,updated_at = ? WHERE id = ? AND revision = ?'+codeGuard+' RETURNING revision').bind(revision,serialized,Date.now(),id,row.revision,...codeValues),...extra]);saved=results[0]?.results?.length;}else saved=await this.db.prepare('UPDATE bingo_games SET revision = ?,document = ?,updated_at = ? WHERE id = ? AND revision = ? RETURNING revision').bind(revision,serialized,Date.now(),id,row.revision).first();
   if(saved)return {game,family,result};await new Promise(resolve=>setTimeout(resolve,25+crypto.getRandomValues(new Uint32Array(1))[0]%Math.min(400,50*(tries+1))));
  }throw new BingoError('Het spel wordt tegelijk bijgewerkt. Probeer opnieuw.',409,'conflict');
 }
}
