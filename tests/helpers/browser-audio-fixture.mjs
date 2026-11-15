import {createHash} from 'node:crypto';
import {CHARACTERS} from '../../server/characters.js';
import {showAudioScripts} from '../../server/show-audio-manifest.js';
import {characterVoiceKey} from '../../server/voice-cache.js';
import {SPEECH_POLICY_VERSION} from '../../public/bingo-speech.js';
import {pcmWave} from '../../server/gpt-live.js';

// Real script enumeration and cache identity, with a short synthetic WAV. This
// is isolated browser transport evidence, never an actual provider audition.
export function createBrowserAudioFixture({owner,getGame,characters=Object.values(CHARACTERS)}){
 const requests=[],profiles=new Map(characters.map(c=>[c.id,c]));
 const samples=new Uint8Array(4800),pcm=new DataView(samples.buffer);
 for(let i=0;i<samples.length/2;i++)pcm.setInt16(i*2,Math.sin(i/24000*2*Math.PI*523.25)*3000,true);
 const audio=Buffer.from(pcmWave([samples]));
 async function manifest(){
  const game=await getGame(),items=[],seen=new Map();
  for(const script of showAudioScripts(game)){
   const c=profiles.get(script.characterId),key=await characterVoiceKey(owner,c,c.speed,script.text),source={kind:script.kind,id:script.id,chunkIndex:script.chunkIndex};
   if(seen.has(key)){seen.get(key).sources.push(source);continue;}
   const item={key,clip:key,text:script.text,characterId:c.id,characterRevision:c.revision,speed:c.speed,kind:script.kind,id:script.id,sources:[source],ready:true,durationMs:100};items.push(item);seen.set(key,item);
  }
  const fingerprint=createHash('sha256').update(JSON.stringify([SPEECH_POLICY_VERSION,game.id,game.preparationRevision||0,items.map(i=>[i.key,i.sources])])).digest('hex');
  return {gameId:game.id,policyVersion:SPEECH_POLICY_VERSION,fingerprint,total:items.length,ready:items.length,complete:true,items};
 }
 return {requests,manifest,async readClip(key){const current=await manifest();if(!current.items.some(item=>item.key===key))throw Error('Clip is outside the current isolated manifest.');return audio;},async handle(route){
  const request=route.request(),url=new URL(request.url());if(!['/api/openai/show-audio','/api/openai/speech'].includes(url.pathname)||request.method()!=='POST')return false;
  const body=request.postDataJSON(),game=await getGame();requests.push({path:url.pathname,gameId:body.gameId,characterId:body.characterId,cacheOnly:body.cacheOnly===true});
  if(body.gameId!==game.id){await route.fulfill({status:409,json:{error:{message:'Isolated audio belongs to another show.'}}});return true;}
  const data=await manifest();
  if(url.pathname.endsWith('show-audio')){await route.fulfill({json:data});return true;}
  const item=data.items.find(i=>i.text===body.text?.trim()&&i.characterId===body.characterId&&i.speed===body.speed&&(!body.expectedKey||i.key===body.expectedKey));
  if(!item){await route.fulfill({status:409,json:{error:{message:'Audio was not in the isolated prepared manifest.'}}});return true;}
  await route.fulfill({body:audio,headers:{'Content-Type':'audio/wav','X-Vlampie-Clip':item.key,'X-Milo-Audio-Duration-Ms':'100','Cache-Control':'private, no-store'}});return true;
 }};
}
