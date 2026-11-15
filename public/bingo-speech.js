// One script source for preparation, live direction and cache identity.
export const SPEECH_POLICY_VERSION='milo-dutch-bingo-v4-once';
const units=['nul','één','twee','drie','vier','vijf','zes','zeven','acht','negen'];
const teens=['tien','elf','twaalf','dertien','veertien','vijftien','zestien','zeventien','achttien','negentien'];
const tens=['','','twintig','dertig','veertig','vijftig','zestig','zeventig'];
export function dutchNumber(number){
 if(!Number.isInteger(number)||number<0||number>75)throw Error('Kies een bingogetal van nul tot vijfenzeventig.');
 if(number<10)return units[number];if(number<20)return teens[number-10];
 const unit=number%10;return unit?(unit===1?'een':units[unit])+(unit===2||unit===3?'ën':'en')+tens[Math.floor(number/10)]:tens[number/10];
}
export function bingoNumberText(number,brand='milo'){
 if(!Number.isInteger(number)||number<1||number>75)throw Error('Kies een bingogetal van één tot vijfenzeventig.');
 if(brand==='vlampie')return `Nummer ${number}. ${number}!`;
 const letter=['Bernhard','Izaak','Nico','Gerard','Otto'][Math.floor((number-1)/15)],word=dutchNumber(number);
 return `${letter} ${word}!`;
}
export const getBingoSpeech=bingoNumberText;
export const roundSpeech=(round,pattern)=>`We gaan verder met ${round}. We spelen voor: ${pattern}. Veel plezier!`;
export const prizeSpeech=prize=>`Kijk eens wat we deze ronde kunnen winnen! ${prize}.`;
export const FIXED_SHOW_SPEECH=Object.freeze({
 bingo:'Jaaa, we hebben een BINGO-melding! We zetten de ballen even stil. Heb jij ook bingo? Meld het nu, terwijl wij de kaart controleren!',
 false:'Deze kaart is nog niet helemaal compleet. Geeft niks! We spelen gezellig verder.',
 pause:'We nemen even pauze. Leg je kaarten klaar, we gaan zo weer verder.',
 wait:'Een klein momentje. De regie zorgt dat alles weer klaarstaat.',
 incomplete:'Kies nog even het boekje waarmee je bingo wilt melden.',
 winner:'Bingo bevestigd! Gefeliciteerd! Een groot applaus voor jou!',
 thanks:'Wat een fantastische bingoavond! Bedankt voor het meespelen. Een groot applaus voor jullie allemaal!',
});
export const bingoWindowText=(brand='milo')=>brand==='vlampie'?'Bingo! Wat spannend! We pauzeren even, zodat de regie de kaart kan controleren.':FIXED_SHOW_SPEECH.bingo;
export const NUMBER_NINE_AUDIENCE=Object.freeze({id:'number-nine-audience',text:'Ben jij ook negen jaar? Dan is deze vrolijke zwaai voor jou!'});
export const MILO_BANTER=Object.freeze([
 {id:'hat-bananas',text:'Mijn hoed zit weer vol bananen. Typisch!'},
 {id:'wand-socks',text:'Mijn toverstaf zoekt zijn sokken. Alweer!'},
 {id:'hat-sneeze',text:'Hoorde ik mijn hoed nou niezen?'},
 {id:'magic-smile',text:'Jullie glimlach is mijn favoriete goocheltruc!'},
 {id:'rabbit-break',text:'Het konijn heeft even wortelpauze.'},
 {id:'sparkle-sleeve',text:'Oeps! Sterrenstof in mijn mouw!'},
].map(cue=>Object.freeze(cue)));
export const optionalSpeechCue=id=>id===NUMBER_NINE_AUDIENCE.id?NUMBER_NINE_AUDIENCE:MILO_BANTER.find(cue=>cue.id===id)||null;
