import {defaultPlan,normalizePlan} from './plan-model.js';
import {platformIdentity} from './player-identity.js';

const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
const json=(body,status=200)=>Response.json(body,{status,headers});
const fail=(status,code,message)=>json({error:{code,message}},status);
async function readBytes(request,max){
 if(Number(request.headers.get('content-length'))>max)throw new Error('te groot');
 const reader=request.body?.getReader();if(!reader)throw new Error('leeg');
 const parts=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();throw new Error('te groot');}parts.push(value);}}
 finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}return bytes;
}
function validImage(bytes,type){
 if(type==='image/png')return [137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v);
 if(type==='image/jpeg')return bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
 if(type==='image/webp')return new TextDecoder().decode(bytes.slice(0,4))==='RIFF'&&new TextDecoder().decode(bytes.slice(8,12))==='WEBP';
 return false;
}
export async function handlePlanner(request,env={}){
 const url=new URL(request.url),route=url.pathname.slice('/api/planner/'.length),{user,admin}=platformIdentity(request,env);
 if(!user)return fail(401,'sign_in','Open de studio terwijl je bent ingelogd.');
 if(!admin)return fail(403,'owner_only','Alleen de eigenaar kan de show voorbereiden.');
 if(request.headers.get('sec-fetch-site')==='cross-site'||(request.headers.get('origin')&&request.headers.get('origin')!==url.origin))return fail(403,'origin','Gebruik de voorbereiding vanuit Vlampie Studio.');
 const write=['POST','PUT'].includes(request.method);
 if(write&&(request.headers.get('origin')!==url.origin||request.headers.get('x-vlampie-planner')!=='1'))return fail(403,'origin','Sla wijzigingen op vanuit de showvoorbereiding.');
 try{
  if(route==='document'){
   if(!['GET','PUT'].includes(request.method))return fail(405,'method','Deze aanvraag wordt niet ondersteund.');
   if(!env.DB?.prepare)return fail(503,'unavailable','De showopslag is nog niet beschikbaar. Je wijzigingen blijven in dit venster staan.');
   if(request.method==='GET'){
    const row=await env.DB.prepare('SELECT revision, document, updated_at FROM show_workspaces WHERE owner_id = ?').bind(user).first();
    return json(row?{document:normalizePlan(JSON.parse(row.document)),revision:row.revision,updatedAt:row.updated_at}:{document:defaultPlan(),revision:0,updatedAt:null});
   }
   if(!(request.headers.get('content-type')||'').startsWith('application/json'))return fail(400,'invalid_body','De showvoorbereiding kon niet worden gelezen.');
   let body,document;try{
    body=JSON.parse(new TextDecoder().decode(await readBytes(request,256*1024)));
    if(!Number.isSafeInteger(body.revision)||body.revision<0)throw new Error('Ververs de voorbereiding en probeer opnieuw.');
    document=normalizePlan(body.document);
   }catch(error){return fail(400,'invalid_plan',error.message==='te groot'?'De voorbereiding is te groot. Gebruik maximaal 100 showblokken.':error.message||'De showvoorbereiding is ongeldig.');}
   const updatedAt=new Date().toISOString(),revision=body.revision+1,serialized=JSON.stringify(document);
   const row=body.revision===0
    ?await env.DB.prepare('INSERT INTO show_workspaces (owner_id, revision, document, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(owner_id) DO NOTHING RETURNING revision').bind(user,revision,serialized,updatedAt).first()
    :await env.DB.prepare('UPDATE show_workspaces SET revision = ?, document = ?, updated_at = ? WHERE owner_id = ? AND revision = ? RETURNING revision').bind(revision,serialized,updatedAt,user,body.revision).first();
   if(!row)return fail(409,'conflict','De voorbereiding is in een ander venster gewijzigd. Je eigen wijzigingen blijven staan; laad de opgeslagen versie alleen als je die wilt overnemen.');
   return json({revision:row.revision,updatedAt});
  }
  if(route==='images'&&request.method==='POST'){
   if(!env.SETTINGS?.put)return fail(503,'unavailable','Afbeeldingen kunnen nu niet worden opgeslagen. Probeer het opnieuw.');
   const type=(request.headers.get('content-type')||'').toLowerCase();let bytes;
   try{bytes=await readBytes(request,3*1024*1024);}catch{return fail(413,'image_size','Gebruik een afbeelding van maximaal 3 MB.');}
   if(!validImage(bytes,type))return fail(400,'invalid_image','Kies een JPG-, PNG- of WebP-afbeelding.');
   const imageId=crypto.randomUUID();await env.SETTINGS.put(`show-prizes/${encodeURIComponent(user)}/${imageId}`,bytes,{httpMetadata:{contentType:type,cacheControl:'private, no-store'}});
   return json({image:`/api/planner/images/${imageId}`},201);
  }
  const image=route.match(/^images\/([a-f0-9-]{36})$/);
  if(image&&['GET','HEAD'].includes(request.method)){
   const object=await env.SETTINGS?.get(`show-prizes/${encodeURIComponent(user)}/${image[1]}`);
   if(!object)return fail(404,'not_found','De prijsafbeelding is niet gevonden.');
   const type=object.httpMetadata?.contentType;if(!['image/png','image/jpeg','image/webp'].includes(type))return fail(404,'not_found','De prijsafbeelding is niet gevonden.');
   return new Response(request.method==='HEAD'?null:object.body,{headers:{...headers,'Content-Type':type}});
  }
  return fail(404,'not_found','Onbekende aanvraag.');
 }catch(error){console.error('Showopslag niet beschikbaar:',error?.name||'StorageError');return fail(503,'storage_failed','Opslaan of laden is niet bevestigd. Je wijzigingen blijven in dit venster staan. Probeer het opnieuw.');}
}
