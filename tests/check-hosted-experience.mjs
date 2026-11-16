import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {configureLocalPreview} from '../frontend/local-preview-access.js';
import {isFamilyDemo} from '../frontend/family-demo.js';
import {CHARACTERS} from '../server/characters.js';

function browserTarget(href){
 const location=new URL(href),changes=[],state={navigation:'preserved'};
 return {location,changes,history:{state,replaceState(value,_title,path){changes.push({value,path});location.href=new URL(path,location).href;}}};
}

test('hosted production and staging remove every demo flag while preserving show, book, order, brand and route',()=>{
 for(const origin of ['https://milo.dgwebservices.nl','https://milo-staging.dgwebservices.nl']){
  const target=browserTarget(origin+'/spelen?demo=1&spel=chosen-show&boek=private-book&bestelling=order-id&brand=vlampie&demo=1#/books');
  target.__MILO_LOCAL_PREVIEW_AVAILABLE__=true;
  assert.equal(configureLocalPreview({localAvailable:false},target),false);
  assert.equal(target.__MILO_LOCAL_PREVIEW_AVAILABLE__,false);
  assert.equal(target.location.searchParams.has('demo'),false);
  assert.equal(target.location.searchParams.get('spel'),'chosen-show');
  assert.equal(target.location.searchParams.get('boek'),'private-book');
  assert.equal(target.location.searchParams.get('bestelling'),'order-id');
  assert.equal(target.location.searchParams.get('brand'),'vlampie');
  assert.equal(target.location.hash,'#/books');
  assert.equal(target.changes[0].value,target.history.state);
 }
});

test('missing, failed or malformed session evidence cannot grant a fixture capability; explicit local server evidence can',()=>{
 for(const session of [null,undefined,{}, {localAvailable:'true'},{localAvailable:1},{authenticated:true,role:'admin'}]){
  const target=browserTarget('https://milo.dgwebservices.nl/login?demo=1&next=%2Fspelen');
  assert.equal(configureLocalPreview(session,target),false);
  assert.equal(target.location.searchParams.get('next'),'/spelen');
  assert.equal(target.location.searchParams.has('demo'),false);
 }
 const target=browserTarget('http://localhost:4173/spelen?demo=1');
 assert.equal(configureLocalPreview({localAvailable:true},target),true);
 assert.equal(target.changes.length,0);
 assert.equal(target.location.searchParams.get('demo'),'1');
});

test('a demo URL and old preview permission alone never provide a family account',()=>{
 for(const capability of [undefined,false,'true']){
  globalThis.__MILO_LOCAL_PREVIEW_AVAILABLE__=capability;
  assert.equal(isFamilyDemo('https://milo.dgwebservices.nl/spelen?demo=1'),false);
  assert.equal(isFamilyDemo('http://localhost:4173/spelen?demo=1'),false);
 }
 globalThis.__MILO_LOCAL_PREVIEW_AVAILABLE__=true;
 assert.equal(isFamilyDemo('http://localhost:4173/spelen?demo=1'),true);
 assert.equal(isFamilyDemo('http://localhost:4173/spelen'),false);
 delete globalThis.__MILO_LOCAL_PREVIEW_AVAILABLE__;
});

const original={setInterval:globalThis.setInterval,clearInterval:globalThis.clearInterval,fetch:globalThis.fetch};
globalThis.setInterval=()=>0;globalThis.clearInterval=()=>{};
globalThis.location={origin:'https://milo.dgwebservices.nl',pathname:'/',href:'https://milo.dgwebservices.nl/?demo=1'};
const values=new Map();
globalThis.localStorage={getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,String(value))};
globalThis.sessionStorage={getItem:()=>null,setItem(){},removeItem(){}};
globalThis.document={body:{dataset:{brand:'milo'},classList:{contains:()=>false}}};
globalThis.BroadcastChannel=class{postMessage(){}close(){}};
globalThis.speechSynthesis={getVoices:()=>[],cancel(){},pause(){},resume(){}};
const {StudioEngine}=await import('../frontend/engine.js');
after(()=>Object.assign(globalThis,original));
const settled=async engine=>{for(let count=0;count<30&&engine.loading;count++)await new Promise(resolve=>setImmediate(resolve));assert.equal(engine.loading,false);};
function transport({localAvailable=false,failGames=false,failSession=false}={}){
 const calls=[];
 globalThis.fetch=async(path,options={})=>{
  calls.push({path,method:options.method||'GET'});
  if(path==='/api/auth/session')return failSession?Response.json({error:{message:'Aanmelding kon niet worden gecontroleerd.'}},{status:503}):Response.json({authenticated:true,role:'regie',localAvailable});
  if(path==='/api/bingo/games')return failGames?Response.json({error:{message:'Shows tijdelijk niet bereikbaar.'}},{status:503}):Response.json({games:[]});
  if(path==='/api/characters')return Response.json({characters:Object.values(CHARACTERS),revision:0});
  if(path==='/api/openai/status')return Response.json({configured:false});
  throw Error('Unexpected hosted-experience fixture request '+path);
 };
 return calls;
}

for(const options of [{},{failGames:true},{failSession:true}])test('hosted studio has no fictional participants or orders after empty/failed loading: '+JSON.stringify(options),async()=>{
 values.clear();values.set('mf-production','milo');
 values.set('mf-rehearsal-plan-milo',JSON.stringify({title:'An old fictional rehearsal'}));
 const calls=transport(options),engine=new StudioEngine();
 try{
  assert.equal(engine.game.books.length,0,'No sample accounts may flash before session verification');
  await settled(engine);
  assert.equal(engine.localPreviewAvailable,false);
  assert.equal(engine.game.books.length,0);
  assert.equal(engine.game.batches.length,0);
  assert.equal(engine.game.results.length,0);
  assert.deepEqual(engine.games,[]);
  assert.notEqual(engine.game.title,'An old fictional rehearsal');
  assert.equal(engine.preparedAudio.state.complete,false);
  if(options.failGames)assert.match(engine.snapshot().gamesLoadError,/Shows tijdelijk niet bereikbaar/);
  await assert.rejects(engine.openRehearsal(),/Maak of open een show/);
  await engine.productionSwitch('vlampie');
  assert.equal(engine.production,'vlampie');
  assert.equal(engine.game.books.length,0,'The separate Vlampie environment also stays empty without saved shows');
  await engine.productionSwitch('milo');
  assert.equal(engine.game.books.length,0);
  assert(calls.every(call=>call.method==='GET'),'Loading or changing the empty production must not create backend data');
 }finally{engine.dispose();}
});

test('explicit development session retains isolated rehearsal fixtures',async()=>{
 values.clear();transport({localAvailable:true});const engine=new StudioEngine();
 try{await settled(engine);assert.equal(engine.localPreviewAvailable,true);assert.equal(engine.game.books.length,12);assert(engine.game.books.some(book=>book.accountId?.startsWith('demo-')));}
 finally{engine.dispose();}
});
