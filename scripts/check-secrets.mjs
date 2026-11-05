import {verifiedTestEnvironment} from './verified-test-identity.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readSecret,saveSecret} from '../server/secrets.js';
import {handleOpenAI as verifiedhandleOpenAI} from '../server/openai.js';
import {readFile} from 'node:fs/promises';
class Bucket{
  objects=new Map();version=0;
  get value(){return this.objects.get('private/openai-key.v1')?.value??null;}
  async get(name){const object=this.objects.get(name);return object?{etag:object.etag,json:async()=>JSON.parse(object.value)}:null;}
  async put(name,value,{onlyIf}){
    const previous=this.objects.get(name);
    if(onlyIf.etagDoesNotMatch==='*'&&previous)return null;
    if(onlyIf.etagMatches!==undefined&&onlyIf.etagMatches!==previous?.etag)return null;
    const etag=String(++this.version);this.objects.set(name,{value,etag});return {etag};
  }
}
const settingsEnv=()=>({SETTINGS:new Bucket(),VLAMPIE_SETTINGS_KEY:'ab'.repeat(32),VLAMPIE_ADMIN_EMAIL:'owner@example.test'});
const testKey='sk-test-'+ 'x'.repeat(30);
let requestNumber=0;
const req=(body,headers={})=>new Request('https://studio.example/api/openai/settings',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://studio.example','X-Vlampie-Settings':'1','oai-authenticated-user-id':'owner-'+(++requestNumber),'oai-authenticated-user-email':'owner@example.test',...headers},body:JSON.stringify(body)});
const valid=async()=>Response.json({data:[]});
const noFetch=()=>{throw new Error('Unexpected upstream request');};

test('storage encrypts the whole key and uses a new IV for every write',async()=>{
  const env=settingsEnv();const first=await saveSecret(env,testKey,null);assert.equal(first.revision,'1');
  const bytes=env.SETTINGS.value;assert.ok(!bytes.includes(testKey));assert.ok(!bytes.includes('sk-test'));
  assert.equal((await readSecret(env)).key,testKey);
  const a=JSON.parse(bytes);await saveSecret(env,testKey,'1');const b=JSON.parse(env.SETTINGS.value);assert.notEqual(a.iv,b.iv);assert.notEqual(a.data,b.data);
  await assert.rejects(readSecret({...env,VLAMPIE_SETTINGS_KEY:'ff'.repeat(32)}));
});
test('save requires owner identity, exact Origin and custom header before validating or writing',async()=>{
  const env=settingsEnv();const body={action:'save',key:testKey,revision:null};
  for(const [headers,status] of [[{'oai-authenticated-user-id':''},401],[{'oai-authenticated-user-email':'visitor@example.test'},403],[{Origin:''},403],[{Origin:'https://bad.example'},403],[{'X-Vlampie-Settings':''},403]]){
    assert.equal((await handleOpenAI(req(body,headers),env,noFetch)).status,status);
  }
  assert.equal(env.SETTINGS.value,null);
});
test('save validates before storage and returns only safe status',async()=>{
  const env=settingsEnv();let calls=0;
  const response=await handleOpenAI(req({action:'save',key:testKey,revision:null}),env,async(url,options)=>{calls++;assert.equal(env.SETTINGS.value,null);assert.equal(url,'https://api.openai.com/v1/models');assert.equal(options.headers.Authorization,'Bearer '+testKey);return valid();});
  assert.equal(response.status,200);const text=await response.text();assert.ok(!text.includes(testKey));assert.ok(!text.includes('data'));assert.equal(calls,1);assert.equal((await readSecret(env)).key,testKey);
});
test('invalid replacement preserves the existing key',async()=>{
  const env=settingsEnv();await saveSecret(env,testKey,null);const previous=env.SETTINGS.value;
  const response=await handleOpenAI(req({action:'save',key:'sk-rejected-'+ 'y'.repeat(30),revision:'1'}),env,async()=>new Response('invalid',{status:401}));
  assert.equal(response.status,502);assert.equal(env.SETTINGS.value,previous);
});
test('a stale tab cannot overwrite a newer saved key',async()=>{
  const env=settingsEnv();await saveSecret(env,testKey,null);
  const response=await handleOpenAI(req({action:'save',key:'sk-another-'+ 'y'.repeat(30),revision:null}),env,valid);
  assert.equal(response.status,409);assert.equal((await readSecret(env)).key,testKey);
});
test('removal disables the saved key and any environment fallback',async()=>{
  const env={...settingsEnv(),OPENAI_API_KEY:'legacy-fallback'};await saveSecret(env,testKey,null);
  const response=await handleOpenAI(req({action:'remove',revision:'1'}),env,noFetch);
  assert.equal(response.status,200);assert.equal((await response.json()).configured,false);
  assert.equal((await readSecret(env)).key,'');assert.ok(!env.SETTINGS.value.includes(testKey));
  // A private settings object is not a voice-cache hit: real storage is keyed.
  const request=new Request('https://studio.example/api/openai/speech',{method:'POST',headers:{'Content-Type':'application/json','oai-authenticated-user-id':'owner','oai-authenticated-user-email':'owner@example.test'},body:JSON.stringify({text:'Hallo'})});
  assert.equal((await handleOpenAI(request,env,noFetch)).status,503);
});
test('storage failure returns an explicit safe error and does not expose key',async()=>{
  const env=settingsEnv();env.SETTINGS.put=async()=>{throw new Error(testKey);};
  const response=await handleOpenAI(req({action:'save',key:testKey,revision:null}),env,valid);
  assert.equal(response.status,503);assert.ok(!(await response.text()).includes(testKey));
});
test('native form submission cannot put a secret in URLs if JavaScript fails to load',async()=>{
  const html=await readFile(new URL('./fixtures/legacy-studio.html',import.meta.url),'utf8');
  const form=html.match(/<form[^>]*id="api-key-form"[^>]*>/)[0];
  assert.match(form,/method="post"/);
  const input=html.match(/<input[^>]*id="api-key"[^>]*>/)[0];
  assert.match(input,/type="password"/);assert.doesNotMatch(input,/\sname=/);
});

function handleOpenAI(request,env,...args){return verifiedhandleOpenAI(request,verifiedTestEnvironment(request,env),...args);}
