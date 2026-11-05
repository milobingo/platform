import assert from 'node:assert/strict';
import test from 'node:test';
import {recoverStartup,clearStartupRecovery,freshStudioUrl} from '../frontend/startup-recovery.js';

const href='https://bingo.example/regie?show=feest&tag=een&tag=twee#/characters/vlampie';
const moduleError=new TypeError('Failed to fetch dynamically imported module: https://bingo.example/app/chunks/App-OLD.js');
const now=1_000_000;
function memoryStorage(){
 const values=new Map();
 return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};
}
function locationAt(value=href){const replacements=[];return {href:value,replace:value=>replacements.push(value),replacements};}

await test('a fresh studio URL preserves the route and query, including the Vlampie profile',()=>{
 const url=new URL(freshStudioUrl(href,now)),original=new URL(href);
 assert.equal(url.origin,original.origin);assert.equal(url.pathname,original.pathname);assert.equal(url.hash,'#/characters/vlampie');
 assert.equal(url.searchParams.get('show'),'feest');assert.deepEqual(url.searchParams.getAll('tag'),['een','twee']);
 assert.equal(url.searchParams.get('studio-refresh'),String(now));
 const refreshed=new URL(freshStudioUrl(url.href,now+1));
 assert.deepEqual(refreshed.searchParams.getAll('studio-refresh'),[String(now+1)]);
});

await test('browser module-load failures trigger one automatic fresh load of the same page',()=>{
 for(const error of [moduleError,new TypeError('error loading dynamically imported module'),new TypeError('Importing a module script failed.'),new Error('Failed to load module script')]){
  const location=locationAt(),storage=memoryStorage();
  assert.equal(recoverStartup(error,{location,storage,now}),true);
  assert.deepEqual(location.replacements,[freshStudioUrl(href,now)]);
  assert.equal(new URL(location.replacements[0]).hash,'#/characters/vlampie');
 }
});

await test('a repeated module-load failure within sixty seconds cannot cause a refresh loop',()=>{
 const storage=memoryStorage(),first=locationAt();
 assert.equal(recoverStartup(moduleError,{location:first,storage,now}),true);
 const next=locationAt(first.replacements[0]);
 assert.equal(recoverStartup(moduleError,{location:next,storage,now:now+1}),false);
 assert.equal(recoverStartup(moduleError,{location:next,storage,now:now+59_999}),false);
 assert.deepEqual(next.replacements,[]);
 assert.equal(recoverStartup(moduleError,{location:next,storage,now:now+60_000}),true);
 assert.equal(next.replacements.length,1);
});

await test('ordinary render and network errors do not reload the studio',()=>{
 for(const error of [new Error('Failed to fetch'),new TypeError('Cannot read properties of undefined'),new Error('OpenAI service unavailable'),null]){
  const location=locationAt(),storage={getItem(){throw Error('Storage must not be used');}};
  assert.equal(recoverStartup(error,{location,storage,now}),false);
  assert.deepEqual(location.replacements,[]);
 }
});

await test('unavailable or throwing session storage prevents automatic reloads',()=>{
 const descriptor=Object.getOwnPropertyDescriptor(globalThis,'sessionStorage');
 try{
  Object.defineProperty(globalThis,'sessionStorage',{value:undefined,configurable:true});
  const location=locationAt();
  assert.equal(recoverStartup(moduleError,{location,now}),false);
  assert.equal(recoverStartup(moduleError,{location,now:now+1}),false);
  assert.deepEqual(location.replacements,[]);
  assert.doesNotThrow(()=>clearStartupRecovery());
 }finally{if(descriptor)Object.defineProperty(globalThis,'sessionStorage',descriptor);else delete globalThis.sessionStorage;}
 for(const storage of [{getItem(){throw Error('Storage denied');}},{getItem:()=>null,setItem(){throw Error('Storage full');}}]){
  const location=locationAt();
  assert.equal(recoverStartup(moduleError,{location,storage,now}),false);
  assert.equal(recoverStartup(moduleError,{location,storage,now:now+1}),false);
  assert.deepEqual(location.replacements,[]);
 }
 assert.doesNotThrow(()=>clearStartupRecovery({removeItem(){throw Error('Storage denied');}}));
});

await test('successful startup clears the refresh guard so a later deployment may recover',()=>{
 const storage=memoryStorage(),location=locationAt();
 assert.equal(recoverStartup(moduleError,{location,storage,now}),true);
 assert.equal(recoverStartup(moduleError,{location,storage,now:now+1}),false);
 clearStartupRecovery(storage);
 assert.equal(recoverStartup(moduleError,{location,storage,now:now+2}),true);
 assert.equal(location.replacements.length,2);
});
