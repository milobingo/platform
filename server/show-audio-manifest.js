import {BingoStore} from './bingo-store.js';
import {CharacterSettingsStore} from './character-settings.js';
import {characterVoiceKey,voicePath,fixedSpeechFor} from './voice-cache.js';
import {splitSpeechText} from '../public/speech-text.js';
import {SPEECH_POLICY_VERSION,roundSpeech,prizeSpeech,MILO_BANTER,NUMBER_NINE_AUDIENCE} from '../public/bingo-speech.js';
import {showBrand} from './show-brands.js';
import {MAGIC_CUES} from './magic-cues.js';
import {CHARACTER_IDS} from './characters.js';
import {LIVE_CALL_LINES} from '../public/live-call-script.js';

const problem=(message,status=409,code='show_audio_unavailable')=>Object.assign(new Error(message),{status,code});
const hash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)))),byte=>byte.toString(16).padStart(2,'0')).join('');
export const MAX_SHOW_AUDIO_ITEMS=3000;
export function showCallPresenters(game){
 const plan=game.plan,presenters=new Set(),add=id=>{if(CHARACTER_IDS.includes(id))presenters.add(id);};
 add(plan.leadId||'milo');add(plan.cohostId);
 for(const block of plan.blocks){add(block.speakerId);for(const turn of block.dialogue||[])add(turn.speakerId);}
 for(const cue of plan.manualCues||[])add(cue.speakerId);
 // Keep deliberately chosen presenters for the rest of this show, including
 // completed/skipped cues: closing a conversation must never invalidate the
 // prepared bank. Available but unused profiles do not add preparation work.
 for(const cue of game.callCues||[])add(cue.characterId);
 return [...presenters];
}
export function showAudioScripts(game){
 const plan=game.plan,lead=plan.leadId||(game.brandId==='vlampie'?'vlampie':'milo'),brand=game.brandId==='vlampie'?'vlampie':'milo',scripts=[],roundSpeakers=new Set([lead]);
 const add=(text,characterId=lead,kind='plan',id=null)=>{if(typeof text==='string'&&text.trim())for(const [chunkIndex,chunk] of splitSpeechText(text).entries())scripts.push({text:chunk.trim(),characterId,kind,id,chunkIndex});};
 add(showBrand(brand).intro,lead,'opening','brand-opening');
 for(const block of plan.blocks){
  const speaker=block.speakerId||lead;
  if(block.type==='round'){
   roundSpeakers.add(speaker);
   for(const goal of block.goals){const pattern=plan.patterns.find(item=>item.id===goal.patternId),prize=plan.prizes.find(item=>item.id===goal.prizeId);if(pattern)add(roundSpeech(block.title,pattern.title),speaker,'round',goal.id);if(prize)add(prizeSpeech(prize.title),speaker,'prize',goal.id);}
  }else if(block.type==='explanation'&&block.explanationSteps?.length){for(const [index,step]of block.explanationSteps.entries())add(step.text,speaker,'explanation',block.id+'-'+index);}
  else if(block.type!=='show')add(block.text,speaker,'plan',block.id);
  if(block.type==='random-call')add(block.fallbackText,speaker,'call-fallback',block.id);
  if(block.type==='guest')for(const [index,turn] of (block.dialogue||[]).entries())add(turn.text,turn.speakerId||speaker,'dialogue',block.id+'-'+index);
 }
 for(const cue of plan.manualCues||[])add(cue.text,cue.speakerId||lead,'manual',cue.id);
 for(const speaker of roundSpeakers){for(const item of fixedSpeechFor(brand))add(item.text,speaker,item.id.startsWith('ball-')?'number':'fixed',item.id);if(brand==='milo'){for(const cue of MILO_BANTER)add(cue.text,speaker,'banter',cue.id);add(NUMBER_NINE_AUDIENCE.text,speaker,'banter',NUMBER_NINE_AUDIENCE.id);}}
 if(brand==='milo'){
  for(const cue of MAGIC_CUES)add(cue.intro,'milo','magic',cue.id);
  // Prepare only this show's chosen cast, including a deliberately scheduled
  // manual presenter. Other profiles remain available for an explicit change.
  // These scripts never contain a child's name or information from backstage.
  for(const speaker of showCallPresenters(game))for(const [key,text] of Object.entries(LIVE_CALL_LINES))add(text,speaker,'live-call',key);
 }
 return scripts;
}
export async function buildShowAudioManifest(env,owner,gameId,{includeReadiness=true}={}){
 if(typeof gameId!=='string'||!gameId||gameId.length>100)throw problem('Kies eerst de juiste opgeslagen show.',400,'invalid_game');
 const row=await new BingoStore(env.DB).game(gameId);if(!row||row.owner_id!==owner)throw problem('Deze show hoort niet bij jouw regie.',403,'forbidden');
 const game=row.data;if(game.cancelledAt||game.status==='finished')throw problem('Deze show is beëindigd. De presentator blijft stil.',409,'show_cancelled');
 const settings=await new CharacterSettingsStore(env.DB).read(owner),characters=new Map(settings.characters.map(character=>[character.id,character])),items=[],seen=new Map();
 for(const script of showAudioScripts(game)){
  const character=characters.get(script.characterId);if(!character)throw problem('Een spreker uit het draaiboek is niet beschikbaar.',400,'invalid_character');
  const speed=character.speed,key=await characterVoiceKey(owner,character,speed,script.text),previous=seen.get(key);
  if(previous){previous.sources.push({kind:script.kind,id:script.id,chunkIndex:script.chunkIndex});continue;}
  const item={key,clip:key,characterId:character.id,characterRevision:character.revision,speed,text:script.text,kind:script.kind,id:script.id,sources:[{kind:script.kind,id:script.id,chunkIndex:script.chunkIndex}],ready:false,durationMs:null};seen.set(key,item);items.push(item);
  if(items.length>MAX_SHOW_AUDIO_ITEMS)throw problem('Het draaiboek bevat te veel verschillende stemfragmenten. Verdeel het over meerdere shows.',413,'show_audio_capacity');
 }
 const fingerprint=await hash([SPEECH_POLICY_VERSION,game.id,game.preparationRevision||0,items.map(item=>[item.key,item.sources])]);
 if(includeReadiness){
  let index=0;await Promise.all(Array.from({length:Math.min(6,items.length)},async()=>{while(index<items.length){const item=items[index++],path=voicePath(owner,item.key),file=env.SETTINGS?.head?await env.SETTINGS.head(path):await env.SETTINGS?.get(path);item.ready=!!file&&file.customMetadata?.policyVersion===SPEECH_POLICY_VERSION&&file.customMetadata?.scriptVerified==='true';const duration=Number(file?.customMetadata?.durationMs);if(item.ready&&Number.isFinite(duration)&&duration>0&&duration<=120000)item.durationMs=duration;}}));
 }
 const ready=items.filter(item=>item.ready).length;
 return {version:1,gameId:game.id,policyVersion:SPEECH_POLICY_VERSION,fingerprint,items,total:items.length,ready,complete:includeReadiness&&ready===items.length};
}
export function scopedShowAudioManifest(manifest){return {version:manifest.version,gameId:manifest.gameId,policyVersion:manifest.policyVersion,fingerprint:manifest.fingerprint,total:manifest.total,ready:manifest.ready,complete:manifest.complete,items:manifest.items.map(({key,clip,durationMs,ready,characterId,sources})=>{const call=sources.find(source=>source.kind==='live-call');return {key,clip,durationMs,ready,...(call?{callKey:call.id,characterId}: {})};})};}
