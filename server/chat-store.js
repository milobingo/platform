// D1-only chat persistence. Each atomic batch increments the room cursor in SQL.
// Actor/target state and game/family revisions guard authorization, while unrelated
// accounts can send concurrently without retrying a shared room revision.
const messageJson = `json_object('id',m.id,'seq',m.seq,'memberId',m.member_id,'profileId',m.profile_id,'name',m.name,'role',CASE WHEN m.role='host' THEN 'host' ELSE coalesce(cm.role,'player') END,'text',CASE WHEN m.deleted_at>0 THEN '' ELSE m.body END,'at',m.created_at,'deleted',json(CASE WHEN m.deleted_at>0 THEN 'true' ELSE 'false' END))`;
const eventJson = `json_object('seq',e.seq,'type',e.type,'messageId',e.message_id,'message',CASE WHEN e.type='message' AND m.id IS NOT NULL THEN ${messageJson} ELSE NULL END,'member',CASE WHEN e.type='member' AND em.id IS NOT NULL THEN json_object('memberId',em.id,'role',em.role,'mutedUntil',em.muted_until) ELSE NULL END)`;
const decode = value => typeof value === 'string' ? JSON.parse(value) : value;
export class ChatStore {
 constructor(db) { this.db=db; }
 async open(gameId) {
  await this.db.prepare('INSERT INTO bingo_chat_rooms (game_id,revision,last_op) SELECT id,0,\'\' FROM bingo_games WHERE id=? ON CONFLICT(game_id) DO NOTHING').bind(gameId).run();
 }
 async read(gameId,accountId,{after=null,members=false,content=true,books=false}={}) {
  const history=content&&after===null?`(SELECT coalesce(json_group_array(json(entry)),'[]') FROM (SELECT ${messageJson} AS entry FROM bingo_chat_messages m LEFT JOIN bingo_chat_members cm ON cm.id=m.member_id WHERE m.game_id=g.id ORDER BY m.seq DESC LIMIT 100))`:`'[]'`;
  const events=content&&after!==null?`(SELECT coalesce(json_group_array(json(entry)),'[]') FROM (SELECT ${eventJson} AS entry FROM bingo_chat_events e LEFT JOIN bingo_chat_messages m ON m.id=e.message_id LEFT JOIN bingo_chat_members cm ON cm.id=m.member_id LEFT JOIN bingo_chat_members em ON em.id=e.member_id WHERE e.game_id=g.id AND e.seq>? ORDER BY e.seq LIMIT 101))`:`'[]'`;
  const roster=members?`(SELECT coalesce(json_group_array(json_object('id',rm.id,'accountId',rm.account_id,'role',rm.role,'mutedUntil',rm.muted_until,'family',json(coalesce(rf.document,'{}')))),'[]') FROM bingo_chat_members rm LEFT JOIN bingo_families rf ON rf.account_id=rm.account_id WHERE rm.game_id=g.id)`:`'[]'`;
  const gameView=books?`json_object('id',g.id,'status',json_extract(g.document,'$.status'),'books',json(json_extract(g.document,'$.books')))`:`json_object('id',g.id,'status',json_extract(g.document,'$.status'))`;
  const args=content&&after!==null?[after,accountId,accountId,gameId]:[accountId,accountId,gameId];
  const row=await this.db.prepare(`SELECT g.owner_id,g.revision AS game_revision,${gameView} AS game_document,EXISTS (SELECT 1 FROM json_each(g.document,'$.books') b WHERE json_extract(b.value,'$.accountId')=f.account_id AND json_extract(b.value,'$.admitted')=1) AS linked,r.revision AS cursor,f.revision AS family_revision,f.document AS family_document,member.id AS member_id,member.role AS member_role,member.muted_until,member.last_sent_at,${history} AS messages,${events} AS events,${roster} AS members FROM bingo_games g JOIN bingo_chat_rooms r ON r.game_id=g.id LEFT JOIN bingo_families f ON f.account_id=? LEFT JOIN bingo_chat_members member ON member.game_id=g.id AND member.account_id=? WHERE g.id=?`).bind(...args).first();
  if(!row)return null;
  return {...row,game:decode(row.game_document),family:decode(row.family_document||'{}'),messages:decode(row.messages).reverse(),events:decode(row.events),members:decode(row.members)};
 }
 async join(context,accountId) {
  await this.db.prepare("INSERT INTO bingo_chat_members (id,game_id,account_id,role,muted_until,last_sent_at) SELECT ?,id,?,'player',0,0 FROM bingo_games WHERE id=? AND revision=? ON CONFLICT(game_id,account_id) DO NOTHING").bind(crypto.randomUUID(),accountId,context.game.id,context.game_revision).run();
 }
 async joinParticipants(context) {
  const accounts=[...new Set(context.game.books.filter(b=>b.accountId&&b.admitted).map(b=>b.accountId))];
  if(!accounts.length)return;
  const candidates=JSON.stringify(accounts.map(accountId=>({id:crypto.randomUUID(),accountId})));
  await this.db.prepare("INSERT INTO bingo_chat_members (id,game_id,account_id,role,muted_until,last_sent_at) SELECT json_extract(j.value,'$.id'),g.id,json_extract(j.value,'$.accountId'),'player',0,0 FROM bingo_games g,json_each(?) j WHERE g.id=? AND g.revision=? ON CONFLICT(game_id,account_id) DO NOTHING").bind(candidates,context.game.id,context.game_revision).run();
 }
 async operation(gameId,accountId,requestId) {
  return this.db.prepare('SELECT action,result_id FROM bingo_chat_operations WHERE game_id=? AND account_id=? AND request_id=?').bind(gameId,accountId,requestId).first();
 }
 async message(gameId,id) {
  const row=await this.db.prepare(`SELECT ${messageJson} AS message,cm.account_id FROM bingo_chat_messages m LEFT JOIN bingo_chat_members cm ON cm.id=m.member_id WHERE m.game_id=? AND m.id=?`).bind(gameId,id).first();
  return row?{message:decode(row.message),accountId:row.account_id}:null;
 }
 async member(gameId,id) {
  return this.db.prepare('SELECT * FROM bingo_chat_members WHERE game_id=? AND id=?').bind(gameId,id).first();
 }
 async commit(context,accountId,{requestId,action,resultId,message=null,member=null,deletedId=null,authorizationTarget=null,now}) {
  const gameId=context.game.id,attempt=crypto.randomUUID();
  const familyGuard=context.family_revision===null?'NOT EXISTS (SELECT 1 FROM bingo_families WHERE account_id=?)':'EXISTS (SELECT 1 FROM bingo_families WHERE account_id=? AND revision=?)';
  const familyValues=context.family_revision===null?[accountId]:[accountId,context.family_revision];
  const guard="EXISTS (SELECT 1 FROM bingo_chat_rooms WHERE game_id=? AND last_op=?)";
  const values=[gameId,attempt],nextSeq="(SELECT revision FROM bingo_chat_rooms WHERE game_id=?)";
  const sentGuard=message?' AND last_sent_at=?':'',sentValues=message?[context.last_sent_at]:[];
  const targetGuard=authorizationTarget?' AND EXISTS (SELECT 1 FROM bingo_chat_members WHERE game_id=? AND id=? AND role=?)':'';
  const targetValues=authorizationTarget?[gameId,authorizationTarget.id,authorizationTarget.role]:[];
  const statements=[this.db.prepare(`UPDATE bingo_chat_rooms SET revision=revision+1,last_op=? WHERE game_id=? AND EXISTS (SELECT 1 FROM bingo_games WHERE id=? AND revision=?) AND ${familyGuard} AND EXISTS (SELECT 1 FROM bingo_chat_members WHERE game_id=? AND id=? AND role=? AND muted_until=?${sentGuard})${targetGuard} AND NOT EXISTS (SELECT 1 FROM bingo_chat_operations WHERE game_id=? AND account_id=? AND request_id=?) RETURNING revision`).bind(attempt,gameId,gameId,context.game_revision,...familyValues,gameId,context.member_id,context.member_role,context.muted_until,...sentValues,...targetValues,gameId,accountId,requestId)];
  if(message) {
   statements.push(this.db.prepare(`INSERT INTO bingo_chat_messages (id,game_id,seq,member_id,profile_id,name,role,body,created_at,deleted_at) SELECT ?,?,${nextSeq},?,?,?,?,?,?,0 WHERE ${guard}`).bind(message.id,gameId,gameId,context.member_id,message.profileId,message.name,message.role,message.text,now,...values));
   statements.push(this.db.prepare(`UPDATE bingo_chat_members SET last_sent_at=? WHERE id=? AND ${guard}`).bind(now,context.member_id,...values));
  }
  if(deletedId)statements.push(this.db.prepare(`UPDATE bingo_chat_messages SET body='',deleted_at=? WHERE game_id=? AND id=? AND ${guard}`).bind(now,gameId,deletedId,...values));
  if(member) {
   const column=action.startsWith('role:')?'role':'muted_until';
   statements.push(this.db.prepare(`UPDATE bingo_chat_members SET ${column}=? WHERE game_id=? AND id=? AND ${guard}`).bind(column==='role'?member.role:member.mutedUntil,gameId,member.id,...values));
  }
  statements.push(this.db.prepare(`INSERT INTO bingo_chat_events (game_id,seq,type,message_id,member_id,created_at) SELECT ?,${nextSeq},?,?,?,? WHERE ${guard}`).bind(gameId,gameId,message?'message':deletedId?'delete':'member',message?.id||deletedId||null,member?.id||null,now,...values));
  statements.push(this.db.prepare(`INSERT INTO bingo_chat_operations (game_id,account_id,request_id,action,result_id,created_at) SELECT ?,?,?,?,?,? WHERE ${guard}`).bind(gameId,accountId,requestId,action,resultId,now,...values));
  const result=await this.db.batch(statements);
  return !!result[0]?.results?.length;
 }
}
