import {ALL_CHARACTER_IDS,CHARACTER_IDS,CHARACTERS,LIVE_VOICES,normaliseCharacterSettings} from './characters.js';
import {platformIdentity} from './player-identity.js';

const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
const json=(body,status=200)=>Response.json(body,{status,headers});
const fail=(status,code,message)=>json({error:{code,message}},status);
export class CharacterSettingsStore{
 constructor(db){this.db=db;}
 async read(owner){
  if(!this.db?.prepare)throw new Error('Personageopslag niet beschikbaar.');
  const row=await this.db.prepare('SELECT revision,document,updated_at FROM show_character_settings WHERE owner_id=?').bind(owner).first();
  const saved=row?JSON.parse(row.document):{};
  return {characters:ALL_CHARACTER_IDS.map(id=>normaliseCharacterSettings(id,saved[id]||{})),revision:row?.revision||0,updatedAt:row?.updated_at||null};
 }
 async save(owner,id,input,revision){
  const previous=await this.read(owner);if(previous.revision!==revision)return null;
  let characters;try{characters=previous.characters.map(c=>c.id===id?{...normaliseCharacterSettings(id,input,c),revision:c.revision+1}:c);}catch(error){throw Object.assign(error,{status:400});}
  const next=revision+1,updatedAt=new Date().toISOString(),raw=JSON.stringify(Object.fromEntries(characters.map(c=>[c.id,c])));
  const saved=revision===0?await this.db.prepare('INSERT INTO show_character_settings (owner_id,revision,document,updated_at) VALUES (?,?,?,?) ON CONFLICT(owner_id) DO NOTHING RETURNING revision').bind(owner,next,raw,updatedAt).first():await this.db.prepare('UPDATE show_character_settings SET revision=?,document=?,updated_at=? WHERE owner_id=? AND revision=? RETURNING revision').bind(next,raw,updatedAt,owner,revision).first();
  return saved?{characters,revision:saved.revision,updatedAt}:null;
 }
}
export async function savedCharacter(env,owner,id){
 if(!ALL_CHARACTER_IDS.includes(id))throw new Error('Dit personage bestaat niet.');
 const result=await new CharacterSettingsStore(env.DB).read(owner);return result.characters.find(c=>c.id===id);
}
export async function handleCharacterSettings(request,env={}){
 const url=new URL(request.url),identity=platformIdentity(request,env);
 if(!identity.user)return fail(401,'sign_in','Open de studio terwijl je bent ingelogd.');
 if(!identity.admin)return fail(403,'owner_only','Alleen de eigenaar kan personages instellen.');
 if(request.headers.get('sec-fetch-site')==='cross-site'||request.headers.get('origin')&&request.headers.get('origin')!==url.origin)return fail(403,'origin','Open de personages vanuit deze studio.');
 const match=url.pathname.match(/^\/api\/characters(?:\/([a-z]+))?\/?$/);if(!match)return fail(404,'not_found','Deze personagepagina bestaat niet.');
 const id=match[1];if(id&&!ALL_CHARACTER_IDS.includes(id))return fail(404,'not_found','Dit personage bestaat niet.');
 if(!['GET','PUT'].includes(request.method)||request.method==='PUT'&&!id)return fail(405,'method','Deze aanvraag wordt niet ondersteund.');
 if(request.method==='PUT'&&(request.headers.get('origin')!==url.origin||request.headers.get('x-milo-characters')!=='1'))return fail(403,'origin','Sla het personage op vanuit de instellingenpagina.');
 if(!env.DB?.prepare)return fail(503,'storage_unavailable','De personageopslag is nog niet beschikbaar. Je wijzigingen blijven in dit venster staan.');
 try{
  const store=new CharacterSettingsStore(env.DB);
  if(request.method==='GET'){
   const data=await store.read(identity.user);return json({...data,...(id?{character:data.characters.find(c=>c.id===id)}:{}),castIds:CHARACTER_IDS,voices:LIVE_VOICES,globalKey:true});
  }
  if(!(request.headers.get('content-type')||'').toLowerCase().startsWith('application/json'))return fail(400,'invalid_body','De instellingen konden niet worden gelezen.');
  const reader=request.body?.getReader();if(!reader)return fail(400,'invalid_body','De instellingen zijn leeg.');
  let size=0;const chunks=[];try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>90000){await reader.cancel();return fail(413,'invalid_body','Het personageboek is te groot.');}chunks.push(value);}}finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
  let body;try{body=JSON.parse(new TextDecoder().decode(bytes));}catch{return fail(400,'invalid_body','De instellingen konden niet worden gelezen.');}
  if(!Number.isSafeInteger(body?.revision)||body.revision<0)return fail(400,'invalid_revision','Ververs de instellingen en probeer opnieuw.');
  let data;try{data=await store.save(identity.user,id,body.settings,body.revision);}catch(error){if(error.status!==400)throw error;return fail(400,'invalid_settings',error.message||'De personage-instellingen zijn ongeldig.');}
  if(!data)return fail(409,'conflict','De personages zijn in een ander venster gewijzigd. Je eigen wijzigingen blijven staan; laad eerst de laatste versie.');
  return json({...data,character:data.characters.find(c=>c.id===id),globalKey:true});
 }catch{return fail(503,'storage_failed','Opslaan of laden is niet bevestigd. Je wijzigingen blijven in dit venster staan.');}
}
