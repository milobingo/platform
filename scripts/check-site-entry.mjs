import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {normalizedEntry,isStudioEntry,isFamilyEntry} from '../server/site-entry.js';
const origin='https://bingo.example';
const expect=(path,next)=>assert.equal(normalizedEntry(origin+path)?.href||null,next===null?null:origin+next,path);
expect('/',null);expect('/?view=', '/');expect('/?view=regie','/');expect('/?view=show&game=abc','/uitzending?game=abc');expect('/index.html?view=overlay','/uitzending');expect('/regie','/#/live');expect('/regie#draaiboek','/#draaiboek');
for(const path of ['/index.html','/klassiek','/milo-studio.html','/studio-hub.html'])expect(path,'/');
for(const [old,next] of Object.entries({overzicht:'overview',regie:'live',spellen:'shows',voorbereiding:'script',chat:'audience',vlampie:'characters/vlampie',koppeling:'settings'}))expect('/#'+old,'/#/'+next);
expect('/player.html?spel=abc','/spelen?spel=abc');expect('/spelen/klassiek?spel=abc','/spelen?spel=abc');expect('/spelen?spel=abc',null);
expect('/uitzending',null);expect('/api/bingo/games',null);assert(isStudioEntry('/uitzending'));assert(isFamilyEntry('/spelen'));
console.log('✓ Canonical entry: old queries, hashes and HTML bookmarks enter the React workspace/output/family app');
const newHtml=await readFile('public/milo-studio.html','utf8');
for(const path of ['public/index.html','public/player.html','public/studio-hub.html'])assert.equal(await readFile(path,'utf8'),newHtml,path+' must never publish the legacy shell');
assert(newHtml.includes('milo-workspace'));assert(!newHtml.includes('dashboard-shell'));
console.log('✓ All public HTML entrances share the new React bootstrap');
if(process.argv.includes('--built')){
 const worker=(await import('../dist/server/index.js?qa='+Date.now())).default;
 const env={VLAMPIE_ADMIN_EMAIL:'owner@example.test'};
 for(const path of ['/','/index.html','/regie','/uitzending','/klassiek','/studio-hub.html','/milo-studio.html','/?view=show','/?view=overlay','/?view=unknown','/?view=']){
  const req=new Request(origin+path,{headers:{'oai-authenticated-user-id':'owner','oai-authenticated-user-email':'owner@example.test'}}),r=await worker.fetch(req,env);
  assert([200,302].includes(r.status),path);
  if(r.status===200){const html=await r.text();assert(html.includes('id="root"'),path);assert(!html.includes('dashboard-shell'),path);assert.equal(r.headers.get('X-Milo-Workspace'),'react-sterrenplein');}
  else assert(!r.headers.get('Location').includes('klassiek'),path);
  const denied=await worker.fetch(new Request(origin+path),env);assert.equal(denied.status,302,path);assert.equal(denied.headers.get('Location'),origin+'/spelen',path+' must retain admin protection');
 }
 for(const path of ['/spelen','/spelen/klassiek','/player.html?spel=abc']){const r=await worker.fetch(new Request(origin+path),env);assert([200,302].includes(r.status));if(r.status===200)assert((await r.text()).includes('id="root"'));}
 assert.equal(await readFile('dist/client/index.html','utf8'),newHtml);
 console.log('✓ Built Worker: every admin/output entry and family entry, HEAD-compatible, identity protection retained; static index is React');
 const assetCache='public, max-age=31536000, immutable';
 async function assetResponse(path,{status=200,method='GET'}={}){
  const assetEnv={...env,ASSETS:{fetch:async request=>new Response(request.method==='HEAD'||status===304?null:'asset body',{status,headers:{'Cache-Control':assetCache,'ETag':'"asset-version"','Content-Type':path.includes('.css')?'text/css':'text/javascript'}})}};
  return worker.fetch(new Request(origin+path,{method}),assetEnv);
 }
 for(const path of ['/app/main.js?v=55','/app/main.css?v=55'])for(const status of [200,304])for(const method of ['GET','HEAD']){
  const r=await assetResponse(path,{status,method});
  assert.equal(r.status,status,path+' '+status+' '+method);
  assert.equal(r.headers.get('Cache-Control'),'private, no-store',path+' must never reuse an obsolete bootstrap');
  assert.equal(r.headers.get('ETag'),'"asset-version"',path+' retains other asset headers');
  assert.equal(await r.text(),method==='HEAD'||status===304?'':'asset body',path+' '+status+' '+method+' retains asset body semantics');
 }
 for(const method of ['GET','HEAD']){
  const current=await assetResponse('/app/chunks/App-CURRENT123.js',{method});
  assert.equal(current.status,200);
  assert.equal(current.headers.get('Cache-Control'),assetCache,'Existing hashed chunks retain their asset cache policy');
  assert.equal(await current.text(),method==='HEAD'?'':'asset body');
  const missing=await assetResponse('/app/chunks/App-OBSOLETE123.js',{status:404,method});
  assert.equal(missing.status,404);
  assert.equal(missing.headers.get('Cache-Control'),'private, no-store','Missing chunks must not leave a cached 404 across deployment');
  assert.equal(missing.headers.get('ETag'),'"asset-version"');
  assert.equal(await missing.text(),method==='HEAD'?'':'asset body');
 }
 console.log('✓ Built Worker: bootstrap 200/304 responses and missing chunks cannot be cached; existing hashed chunks and HEAD bodies retain asset semantics');
}
