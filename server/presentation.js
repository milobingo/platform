import {normalizePresentation} from './presentation-model.js';
import {PresentationStore} from './presentation-store.js';
import {platformIdentity} from './player-identity.js';
const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
export async function handlePresentation(request,env={}){
 const url=new URL(request.url),{user,admin}=platformIdentity(request,env);
 const fail=(status,code,message)=>json({error:{code,message}},status);
 if(!user)return fail(401,'sign_in','Log in om de presentatie voor te bereiden.');
 if(!admin)return fail(403,'owner_only','Alleen de host beheert de presentatie.');
 if(request.headers.get('sec-fetch-site')==='cross-site'||request.headers.get('origin')&&request.headers.get('origin')!==url.origin||request.method==='PUT'&&(request.headers.get('origin')!==url.origin||request.headers.get('x-vlampie-presentation')!=='1'))return fail(403,'origin','Gebruik deze instellingen vanuit de studio.');
 if(url.pathname!=='/api/presentation/document')return fail(404,'not_found','Deze functie bestaat niet.');
 if(!['GET','PUT'].includes(request.method))return fail(405,'method','Deze aanvraag wordt niet ondersteund.');
 if(!env.DB?.prepare)return fail(503,'unavailable','De presentatieopslag is niet beschikbaar.');
 try {const store=new PresentationStore(env.DB);if(request.method==='GET')return json(await store.read(user));
  const raw=await request.text();if(new TextEncoder().encode(raw).length>200000)return fail(413,'too_large','De instellingen zijn te groot.');let body,document;try{body=JSON.parse(raw);if(!Number.isSafeInteger(body.revision)||body.revision<0)throw new Error('Laad de instellingen opnieuw.');document=normalizePresentation(body.document);}catch(error){return fail(400,'invalid',error.message||'Controleer de instellingen.');}
  const saved=await store.save(user,document,body.revision);if(!saved)return fail(409,'conflict','De instellingen zijn in een ander venster gewijzigd. Je invoer blijft staan. Laad de opgeslagen versie om opnieuw te beginnen.');return json({...saved,document});
 }catch(error){console.error('Presentatieopslag:',error?.name);return fail(503,'unavailable','Opslaan of laden is niet bevestigd. Je invoer blijft staan.');}
}
