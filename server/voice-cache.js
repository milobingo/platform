import {bingoNumberText,FIXED_SHOW_SPEECH,SPEECH_POLICY_VERSION,bingoWindowText} from '../public/bingo-speech.js';
import {characterLiveInstructions,liveVoice} from './characters.js';
import {LIVE_MODEL} from './gpt-live.js';
export const fixedSpeechFor=(brand='milo')=>[...Array.from({length:75},(_,i)=>({id:`ball-${i+1}`,text:bingoNumberText(i+1,brand)})),...Object.entries(FIXED_SHOW_SPEECH).map(([id,text])=>({id,text:id==='bingo'?bingoWindowText(brand):text}))];
export const FIXED_SPEECH=fixedSpeechFor();
export async function voiceKey(user,model,voice,style,speed,text){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([SPEECH_POLICY_VERSION,user,model,voice,style,speed,text.trim()])));return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');}
export const characterCacheStyle=settings=>characterLiveInstructions(settings,{scripted:true})+`\nPersonage ${settings.id}; profielversie ${settings.revision}.`;
export const characterVoiceKey=(user,settings,speed,text)=>voiceKey(user,LIVE_MODEL,JSON.stringify(liveVoice(settings)),characterCacheStyle(settings),speed,text);
export function waveDurationMs(audio){const bytes=audio instanceof Uint8Array?audio:new Uint8Array(audio);if(bytes.byteLength<44)return null;const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),ascii=(offset,length)=>String.fromCharCode(...bytes.subarray(offset,offset+length));if(ascii(0,4)!=='RIFF'||ascii(8,4)!=='WAVE'||ascii(12,4)!=='fmt '||ascii(36,4)!=='data')return null;const rate=view.getUint32(28,true),size=view.getUint32(40,true);return rate&&size<=bytes.byteLength-44?Math.ceil(size/rate*1000):null;}
export const voicePath=(user,key)=>`voice-cache/${encodeURIComponent(user)}/${key}.mp3`;
