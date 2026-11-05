import test from 'node:test';
import assert from 'node:assert/strict';
import {familyBrandId,familyBrandAssets,selectFamilyGameId} from '../frontend/family-brand.js';

const now=Date.parse('2026-11-04T09:00Z');
const games=[
 {id:'vlampie-old',brandId:'vlampie',status:'draft',date:'2026-10-07'},
 {id:'milo-late',brandId:'milo',status:'draft',date:'2026-12-01'},
 {id:'milo-next',brandId:'milo',status:'draft',date:'2026-11-11'},
 {id:'milo-old',brandId:'milo',status:'draft',date:'2026-09-11'},
];

test('generic family entrance prefers the requested world and its nearest upcoming show without mutating the picker list',()=>{
 const source=structuredClone(games);
 assert.equal(selectFamilyGameId(games,{now}),'milo-next');
 assert.equal(selectFamilyGameId(games,{brandHint:'vlampie',now}),'vlampie-old');
 assert.equal(selectFamilyGameId([...games,{id:'milo-live',brandId:'milo',status:'running',date:'2026-11-04'}],{now}),'milo-live');
 assert.deepEqual(games,source);
});

test('exact show and book links never switch to another game, even before the referenced show is loaded',()=>{
 assert.equal(selectFamilyGameId(games,{requestedId:'vlampie-old',now}),'vlampie-old');
 assert.equal(selectFamilyGameId(games,{bookGameId:'exact-book-show',now}),'exact-book-show');
 assert.equal(selectFamilyGameId(games,{requestedId:'not-loaded',bookGameId:'exact-book-show',now}),'not-loaded');
});

test('no Milo show means a Milo welcome screen, while archived shows stay available in their own world',()=>{
 assert.equal(selectFamilyGameId([{id:'v-live',brandId:'vlampie',status:'running'}],{now}),'');
 assert.equal(selectFamilyGameId([],{now}),'');
 const past=games.filter(g=>g.brandId==='milo').map(g=>({...g,status:'finished'}));
 assert.equal(selectFamilyGameId(past,{now}),'milo-late');
 const drafts=[{id:'older',brandId:'milo',status:'draft',date:'2026-09-01'},{id:'recent',brandId:'milo',status:'draft',date:'2026-10-01'}];
 assert.equal(selectFamilyGameId(drafts,{now}),'recent');
});

test('trusted show identity determines logo and studio while old unbranded games keep the canonical Vlampie fallback',()=>{
 assert.equal(familyBrandId(null),'milo');
 assert.equal(familyBrandId('untrusted-brand'),'milo');
 assert.equal(familyBrandId({id:'legacy'}),'vlampie');
 assert.equal(familyBrandId({id:'m',brandId:'milo'}),'milo');
 assert.equal(familyBrandAssets('milo').logo,'/assets/milo-friends/logo.png');
 assert.equal(familyBrandAssets('milo').backdrop,'/assets/milo-friends/studio/sterrenplein-grand-room.webp');
 assert.equal(familyBrandAssets({id:'v',brandId:'vlampie'}).logo,'/assets/studio-logo.png');
 assert.equal(familyBrandAssets('rocco').logo,'/assets/hosts/rocco-logo.png');
});
