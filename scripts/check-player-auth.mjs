// The original direct Resend OTP suite is preserved in docs/overdracht.
// Supabase now generates/verifies OTPs and owns provider rate limits. Reuse the
// authoritative runtime contract suite; do not emulate or weaken that provider.
import '../tests/check-node-runtime.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createSqliteDatabase} from '../server/node-storage.js';
import {handlePlayerAuth} from '../server/player-auth.js';
import {birthAge} from '../server/player-identity.js';
import {BingoStore} from '../server/bingo-store.js';

const request=body=>new Request('https://studio.example/api/player/onboarding',{method:'POST',headers:{Origin:'https://studio.example','Content-Type':'application/json','X-Vlampie-Player':'1'},body:JSON.stringify(body)});

test('birth dates reject impossible and future values and use the Amsterdam calendar',()=>{
 assert.equal(birthAge('2008-10-07',new Date('2026-10-07T12:00:00Z')),18);
 assert.equal(birthAge('2008-10-08',new Date('2026-10-07T12:00:00Z')),17);
 // It is already 8 October in Amsterdam while UTC still says 7 October.
 assert.equal(birthAge('2008-10-08',new Date('2026-10-07T22:30:00Z')),18);
 for(const value of ['2025-02-30','2099-01-01','1900-01-01','invalid'])assert.throws(()=>birthAge(value));
});

test('verified Supabase onboarding cannot change a foreign profile and can select an own profile at the limit',async t=>{
 const DB=createSqliteDatabase(':memory:');t.after(()=>DB.close());
 const env={DB,AUTH_IDENTITY:{user:'supabase-family-a',email:'parent-a@example.test',admin:false,method:'supabase'}};
 const store=new BingoStore(DB);
 await store.editFamily('supabase-family-a','parent-a@example.test',family=>{family.profiles=Array.from({length:30},(_,index)=>({id:'own-'+index,name:'Speler '+index,age:30}));});
 await store.editFamily('supabase-family-b','parent-b@example.test',family=>{family.profiles=[{id:'foreign-profile',name:'Ongewijzigd',age:12}];});
 const foreignBefore=(await store.family('supabase-family-b')).data;
 const rejected=await handlePlayerAuth(request({name:'Noor',dateOfBirth:'1990-01-01',profileId:'foreign-profile'}),env);
 assert.equal(rejected.status,403);assert.deepEqual((await store.family('supabase-family-b')).data,foreignBefore);
 const accepted=await handlePlayerAuth(request({name:'Noor',dateOfBirth:'1990-01-01',profileId:'own-5'}),env);
 assert.equal(accepted.status,200);const {family}=await accepted.json();
 assert.equal(family.profiles.length,30);assert.equal(family.accountProfileId,'own-5');assert.equal(family.profiles.find(profile=>profile.id==='own-5').name,'Noor');
 assert.equal((await store.family('supabase-family-a')).account_id,'supabase-family-a');
});
