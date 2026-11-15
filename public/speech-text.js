// The script limit belongs to the regie UI. Speech requests and OBS clips stay
// deliberately short so each existing audio acknowledgement remains exact.
export const MAX_SPEECH_CHARACTERS=10000;
export const MAX_SPEECH_CHUNK_CHARACTERS=400;
export const MAX_SPEECH_REQUEST_CHARACTERS=500;
export const speechCharacterCount=text=>Array.from(String(text??'')).length;
export function assertSpeechText(text){
 if(typeof text!=='string'||!text.trim())throw Error('Vul tekst in voor de presentator.');
 if(speechCharacterCount(text)>MAX_SPEECH_CHARACTERS)throw Error(`Gebruik maximaal ${MAX_SPEECH_CHARACTERS.toLocaleString('nl-NL')} tekens voor de presentator. Je tekst is bewaard.`);
 return text;
}
export function splitSpeechText(text,maximum=MAX_SPEECH_CHUNK_CHARACTERS){
 assertSpeechText(text);if(!Number.isSafeInteger(maximum)||maximum<1||maximum>MAX_SPEECH_REQUEST_CHARACTERS)throw Error('Ongeldige stemfragmentlengte.');
 const characters=Array.from(text),chunks=[];let offset=0;
 while(offset<characters.length){let end=Math.min(offset+maximum,characters.length);
  if(end<characters.length){const floor=offset+Math.floor(maximum/2);let word=-1,sentence=-1;
   for(let i=end-1;i>=floor;i--){if(/\s/u.test(characters[i])){if(word===-1)word=i+1;if(i>offset&&/[.!?。！？]/u.test(characters[i-1])){sentence=i+1;break;}}}
   if(sentence!==-1)end=sentence;else if(word!==-1)end=word;
  }
  chunks.push(characters.slice(offset,end).join(''));offset=end;
 }
 return chunks;
}
