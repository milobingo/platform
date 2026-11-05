export const FIXED_SPEECH=[...Array.from({length:75},(_,i)=>({id:`ball-${i+1}`,text:`Nummer ${i+1}. ${i+1}!`})),
 {id:'bingo',text:'Bingo! Wat spannend! We pauzeren even, zodat de regie de kaart kan controleren.'},
 {id:'false',text:'Deze kaart is nog niet helemaal compleet. Geeft niks! We spelen gezellig verder.'},
 {id:'pause',text:'We nemen even pauze. Leg je kaarten klaar, we gaan zo weer verder.'},
 {id:'wait',text:'Een klein momentje. De regie zorgt dat alles weer klaarstaat.'},
 {id:'incomplete',text:'Kies nog even het boekje waarmee je bingo wilt melden.'},
 {id:'thanks',text:'Wat een fantastische bingoavond! Bedankt voor het meespelen. Een groot applaus voor jullie allemaal!'}];
export async function voiceKey(user,model,voice,style,speed,text){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([user,model,voice,style,speed,text.trim()])));return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');}
export const voicePath=(user,key)=>`voice-cache/${encodeURIComponent(user)}/${key}.mp3`;
