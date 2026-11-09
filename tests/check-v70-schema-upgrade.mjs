import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile,readdir} from 'node:fs/promises';

async function baseline(){
 const db=new DatabaseSync(':memory:');for(const name of (await readdir(new URL('../drizzle/',import.meta.url))).filter(name=>name.endsWith('.sql')&&name<'0009_').sort())db.exec(await readFile(new URL('../drizzle/'+name,import.meta.url),'utf8'));
 db.prepare('INSERT INTO bingo_games(id,owner_id,revision,document,updated_at) VALUES(?,?,?,?,?)').run('retained-show','fixture-adult',1,JSON.stringify({books:[{id:'original-book',code:'unchanged-code'}],orders:[{id:'original-order',status:'fulfilled'}],results:[{id:'original-result'}]}),1);return db;
}
const additions=['bingo_payment_receipts','studio_mail_records','studio_mail_subscriptions','studio_mail_suppressions','studio_mail_unsubscribe'];
test('v70 local SQLite migration preserves every existing show/card/order/result and creates only the reviewed additive tables',async()=>{
 const db=await baseline();try{
  const before=db.prepare('SELECT * FROM bingo_games').all(),oldTables=db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r=>r.name);
  db.exec('BEGIN');db.exec(await readFile(new URL('../drizzle/0009_studio_mail_v70.sql',import.meta.url),'utf8'));db.exec('COMMIT');
  assert.deepEqual(db.prepare('SELECT * FROM bingo_games').all(),before);
  const after=db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r=>r.name);assert.deepEqual(after.filter(name=>!oldTables.includes(name)).sort(),[...additions].sort());
  db.prepare('INSERT INTO bingo_payment_receipts VALUES(?,?,?,?)').run('a'.repeat(64),'retained-show','original-order',1);
  assert.throws(()=>db.prepare('INSERT INTO bingo_payment_receipts VALUES(?,?,?,?)').run('a'.repeat(64),'different-show','different-order',2));assert.equal(db.prepare('SELECT count(*) n FROM bingo_payment_receipts').get().n,1);
 }finally{db.close();}
});
test('v70 local SQLite refuses a preexisting empty addition and rolls the entire additive transaction back',async()=>{
 const db=await baseline();try{
  db.exec('CREATE TABLE studio_mail_records(id text PRIMARY KEY)');const before=db.prepare('SELECT * FROM bingo_games').all();
  const sql=await readFile(new URL('../drizzle/0009_studio_mail_v70.sql',import.meta.url),'utf8');db.exec('BEGIN');assert.throws(()=>db.exec(sql));db.exec('ROLLBACK');
  assert.equal(db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name='bingo_payment_receipts'").get(),undefined);assert.deepEqual(db.prepare('SELECT * FROM bingo_games').all(),before);
 }finally{db.close();}
});
