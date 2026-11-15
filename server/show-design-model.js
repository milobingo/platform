import {createHash} from 'node:crypto';
import {CHARACTER_IDS,CHARACTERS,CAMERA_IDS} from './characters.js';
import {MAGIC_CUES} from './magic-cues.js';
import {SHOW_CUES} from './show-cues.js';
import {standardMiloPlan,STANDARD_MILO_PROFILE,standardMiloDiffers} from './standard-show.js';
import {normalizePlan} from './plan-model.js';
import {normalizeBingoPlan,makeGame} from './bingo-model.js';
import {bingoWindowText,FIXED_SHOW_SPEECH} from '../public/bingo-speech.js';

export const DESIGN_VERSION='milo-design-v1';
export const DESIGN_MODEL='gpt-4.1-2025-04-14';
export const DIRECTIONS=Object.freeze([
 {id:'avontuur',title:'Samenhangend verhaal',instruction:'Schrijf een samenhangend verhaal met een helder doel, een terugkerend motief en een warme afronding. Een zoektocht of mysterie is alleen een mogelijke vorm wanneer de briefing en ongewenste onderdelen dat toelaten; het is geen verplichte verhaallijn.'},
 {id:'publiek',title:'Interactief spektakel',instruction:'Leg het accent op afwisselende publiekskeuzes en kleine opdrachten, met een verbindend motief. Houd de expliciet gevraagde verhaallijn en verplichte onderdelen intact en vermijd wat in de briefing ongewenst is.'},
 {id:'komedie',title:'Karakterkomedie',instruction:'Leg het accent op vriendelijke karakterkomedie, afwisselende dialogen en een verrassende gezamenlijke oplossing binnen de gevraagde show. Respecteer alle verplichte en ongewenste creatieve onderdelen; onderscheid de timing en invalshoek van de andere voorstellen.'},
]);
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const designError=(code,message,status=400)=>Object.assign(new Error(message),{code,status});
function plain(value,max,label,{empty=true}={}){
 if(typeof value!=='string'||value.length>max||!empty&&!value.trim()||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value))throw designError('invalid_input',`${label}: gebruik gewone tekst van maximaal ${max} tekens.`);
 return value.trim();
}
function privateInput(value){if(/\bsk-[A-Za-z0-9_-]{12,}|\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|(?:\+\d[\d ()-]{8,}\d)|https?:\/\//i.test(value))throw designError('private_input','Gebruik alleen creatieve showwensen; verwijder sleutels, contactgegevens en links.');return value;}
export function normalizeDesignBriefing(briefing,input={}){
 briefing=privateInput(plain(briefing,8000,'De showbeschrijving',{empty:false}));
 if(briefing.length<20)throw designError('briefing_short','Beschrijf de gewenste show in minimaal twintig tekens.');
 if(!input||typeof input!=='object'||Array.isArray(input))throw designError('invalid_options','De showwensen konden niet worden gelezen.');
 const leadId=input.leadId||'milo';if(!CHARACTER_IDS.includes(leadId))throw designError('invalid_host','Kies een beschikbare Milo-presentator.');
 const guestIds=input.guestIds??CHARACTER_IDS.filter(id=>id!==leadId&&new RegExp(`\\b${id}\\b`,'i').test(briefing));
 if(!Array.isArray(guestIds)||guestIds.length>3||new Set(guestIds).size!==guestIds.length||guestIds.some(id=>!CHARACTER_IDS.includes(id)||id===leadId))throw designError('invalid_guest','Kies maximaal drie beschikbare, verschillende gasten uit de personages.');
 const winnerCalls=input.winnerCalls??[true,true,true,true];if(!Array.isArray(winnerCalls)||winnerCalls.length!==4||winnerCalls.some(v=>typeof v!=='boolean'))throw designError('invalid_rounds','Kies per ronde of de vollekaartwinnaar gebeld mag worden.');
 const magicCount=input.magicCount??2;if(!Number.isInteger(magicCount)||magicCount<0||magicCount>4)throw designError('invalid_magic','Kies nul tot vier bestaande magiemomenten.');
 const targetMinutes=input.targetMinutes==null||input.targetMinutes===''?null:Number(input.targetMinutes);if(targetMinutes!==null&&(!Number.isFinite(targetMinutes)||targetMinutes<35||targetMinutes>240))throw designError('duration_unavailable','Vier rondes met vijftien seconden per bal passen niet in een heel korte show. Kies minimaal 35 minuten; de daadwerkelijke bingoduur blijft variabel.');
 const options={leadId,guestIds:[...guestIds],winnerCalls:[...winnerCalls],magicCount,targetMinutes};for(const [key,max] of [['title',60],['theme',160],['audience',160],['tone',160],['required',1600],['unwanted',1600],['interaction',400]])options[key]=privateInput(plain(input[key]??'',max,key));
 if(input.assetIds!==undefined&&(!Array.isArray(input.assetIds)||input.assetIds.length>20||new Set(input.assetIds).size!==input.assetIds.length||input.assetIds.some(id=>!MAGIC_CUES.some(c=>c.id===id)&&!SHOW_CUES.some(c=>c.id===id))))throw designError('invalid_asset','Kies alleen bestaande showelementen of magiemomenten.');options.assetIds=[...(input.assetIds||[])];
 return {briefing,options};
}
export function designCatalog(){
 const data={version:DESIGN_VERSION,characters:CHARACTER_IDS.map(id=>({id,name:CHARACTERS[id].name,persona:CHARACTERS[id].persona.slice(0,500)})),magic:MAGIC_CUES.map(({id,title,duration})=>({id,title,duration})),showCues:SHOW_CUES.map(({id,title,duration})=>({id,title,duration})),cameras:[...CAMERA_IDS],format:{rounds:4,goals:[3,3,3,1],intervalSeconds:15,freeCenter:true,newBoardPerRound:true,randomCalls:2,randomAfterRounds:[1,3],winnerCalls:'Per ronde, uitsluitend na definitieve vollekaartwinst; finale keert terug naar afsluiting.'}};
 return {...data,version:digest(data),warnings:['Prijsnamen en persoonlijke winnaarsgegevens komen uitsluitend uit bevestigde spelgegevens.','De duur van bingo, meldvensters en gesprekken kan variëren.']};
}
export function designSlots(options){
 const slots=[{id:'welcome',role:'welcome',title:'Welkom',purpose:'Open het verhaal met een helder doel en een volledig warm welkomstwoord.'},{id:'explanation',role:'explanation',title:'Zo speel je mee',purpose:'Korte creatieve inleiding; de server voegt daarna de bindende speluitleg toe.'},{id:'before-round-1',role:'story',title:'Op naar ronde 1',purpose:'Bouw verwachting voor de eerste ronde, zonder een getal of prijs te noemen.'},{id:'after-round-1',role:'story',title:'Overgang na ronde 1',purpose:'Verbind de eerste ronde met het verhaal; geen uitslag verzinnen.'},{id:'random-1',role:'random-call',title:'Magisch belletje 1',purpose:'Geef precies drie spreekbeurten, elk maximaal vijfhonderd tekens: begroeting, een keuze tussen sterren en bubbels, warme afsluiting. Geef antwoordruimte als regienotitie. Eén fallback van maximaal vijfhonderd tekens bij weigering, geen gehoor of uitval.'},{id:'before-round-2',role:'story',title:'Op naar ronde 2',purpose:'Zet het verhaal voort en geef een korte publieksopdracht.'},{id:'after-round-2',role:'story',title:'Overgang na ronde 2',purpose:'Laat het centrale motief terugkeren en verbind met de volgende ronde.'},{id:'before-round-3',role:'story',title:'Op naar ronde 3',purpose:'Verhoog de vrolijke verwachting zonder spelregels te veranderen.'},{id:'after-round-3',role:'story',title:'Overgang na ronde 3',purpose:'Werk toe naar een tweede interactief belmoment en de finale.'},{id:'random-2',role:'random-call',title:'Magisch belletje 2',purpose:'Ander kort gesprekje in precies drie spreekbeurten van elk maximaal vijfhonderd tekens: begroeting, keuze tussen sterren en bubbels, afsluiting. Geef antwoordruimte als regienotitie. Eén volledig uitgesproken fallback van maximaal vijfhonderd tekens bij geen gesprek.'},{id:'before-round-4',role:'story',title:'Op naar de finaleronde',purpose:'Bereid het publiek op de laatste volle kaart voor; geen extra prijsstappen.'},{id:'closing',role:'finale',title:'Groot slot',purpose:'Los het centrale verhaal warm op, bedank iedereen en sluit de show volledig af.'}];
 for(let i=0;i<options.magicCount;i++)slots.push({id:`magic-${i+1}`,role:'magic',title:`Magiemoment ${i+1}`,purpose:'Schrijf een volledige speelse introductie en afronding bij één werkelijk beschikbaar magisch effect; alleen Milo voert de truc uit.'});
 if(options.guestIds.length)slots.push({id:'guest',role:'guest',title:'De gast komt langs',purpose:'Volledige dialoog met afzonderlijke spreekbeurten van hoofdhost en gekozen gast; geef antwoordruimte.'});
 for(const [id,condition,title,purpose] of [['checking','window-open','Bingomelding in controle','Er is een melding, nog geen winnaar. Moedig andere geldige meldingen binnen het venster aan.'],['winner','confirmed-bingo','Definitieve winnaar','Algemene enthousiaste felicitatie zonder naam of prijs; officiële persoonlijke aankondiging blijft de bestaande serverroute.'],['pattern','round-transition','Volgende patroon','Korte overgang: de getrokken nummers blijven binnen de ronde op het bord.'],['call','call-held','Belmoment gaat door','Een warme korte gespreksintro zonder een beschikbaar gezin te beloven.'],['no-call','always','Geen gesprek','Speelbare warme brug bij geen gehoor, weigering of uitval; de show gaat verder.'],['no-prize','always','Prijsnaam niet beschikbaar','Algemene felicitatie zonder een prijs te verzinnen.'],['round-complete','round-complete','Ronde afgerond','Feliciteer algemeen met de afgeronde volle kaart; niets beloven over beschikbaarheid.'],['final-result','confirmed-finale','Finale bevestigd','Korte algemene felicitatie voor de definitieve finale en overgang naar het slot.']])slots.push({id:`cue-${id}`,role:'conditional',condition,title,purpose});
 return slots;
}
const object=properties=>({type:'object',additionalProperties:false,properties,required:Object.keys(properties)});
const boundedString=(max,min=0)=>({type:'string',minLength:min,maxLength:max});
const schemaTurn=(speakers,max=4000)=>object({speakerId:{type:'string',enum:speakers},text:boundedString(max,1)});
const schemaTurns=(speakers,{min=1,max=3,textMax=4000}={})=>({type:'array',minItems:min,maxItems:max,items:schemaTurn(speakers,textMax)});
export const DESIGN_SCHEMA_VERSION='milo-design-slots-v2';
export function designSchema(options,onlySlot=null){
 const slots=designSlots(options).filter(slot=>!onlySlot||slot.id===onlySlot),scenes={};
 for(const slot of slots){
  const speaker=slot.role==='magic'?'milo':options.leadId,random=slot.role==='random-call',fallback=['random-call','magic','guest'].includes(slot.role);
  // A required property per fixed slot prevents a completed schema response
  // from omitting or duplicating a slot. Speaker constraints mirror the domain
  // validator, rather than letting every role choose from the whole cast.
  const speakerTurns=slot.role==='guest'?object({hostOpening:schemaTurn([options.leadId]),guestReply:schemaTurn(options.guestIds),hostClosing:schemaTurn([options.leadId])}):schemaTurns([speaker],{min:random?3:1,max:random?3:3,textMax:random?500:4000});
  scenes[slot.id]=object({slotId:{type:'string',enum:[slot.id]},title:boundedString(60,1),purpose:boundedString(500,1),speakerTurns,operatorNotes:boundedString(1600),cameraId:{anyOf:[{type:'string',enum:CAMERA_IDS},{type:'null'}]},cueId:slot.role==='magic'?{anyOf:[{type:'string',enum:MAGIC_CUES.map(c=>c.id)},{type:'null'}]}:{type:'null'},durationEstimate:{type:'integer',minimum:1,maximum:300},fallbackTurns:schemaTurns([speaker],{min:fallback?1:0,max:fallback?1:0,textMax:random?500:4000})});
 }
 return object({title:boundedString(60,1),logline:boundedString(400,1),storyForm:boundedString(200,1),tone:boundedString(200,1),productionNotes:{type:'array',minItems:0,maxItems:12,items:boundedString(500)},scenes:object(scenes)});
}
export function normalizeDesignProviderContract(proposal,options,{onlySlot=null}={}){
 // Already materialized designs use the public array contract. The provider's
 // stricter keyed contract is adapted here and never changes editor/API data.
 if(!proposal||typeof proposal!=='object'||Array.isArray(proposal.scenes))return proposal;
 const slots=designSlots(options).filter(slot=>!onlySlot||slot.id===onlySlot),scenes=proposal.scenes;
 if(!scenes||typeof scenes!=='object'||Object.keys(scenes).length!==slots.length||Object.keys(scenes).some(id=>!slots.some(slot=>slot.id===id)))throw designError('incomplete_proposal','Niet alle verplichte scènes zijn volledig geschreven.');
 return {...proposal,scenes:slots.map(slot=>{const scene=scenes[slot.id];if(!scene||scene.slotId!==slot.id)throw designError('invalid_slot','Het antwoord veranderde een beschermd scèneslot.');if(slot.role!=='guest'||Array.isArray(scene.speakerTurns))return scene;const dialogue=scene.speakerTurns,keys=['hostOpening','guestReply','hostClosing'];if(!dialogue||typeof dialogue!=='object'||Object.keys(dialogue).length!==keys.length||keys.some(key=>!Object.hasOwn(dialogue,key)))throw designError('invalid_guest','Het gastbezoek mist een uitgewerkte gastdialoog.');return {...scene,speakerTurns:keys.map(key=>dialogue[key])};})};
}
const forbiddenSpeech=/\[[^\]]+\]|\{[^}]+\}|https?:\/\/|<\/?(?:script|iframe)|\bsk-[A-Za-z0-9_-]+/i;
function validateTurns(value,allowed,label,{required=true}={}){
 if(!Array.isArray(value)||value.length>12||required&&!value.length)throw designError('invalid_content',`${label}: volledige spreektekst ontbreekt.`);
 return value.map(turn=>{if(!turn||Object.keys(turn).some(k=>!['speakerId','text'].includes(k))||!allowed.includes(turn.speakerId))throw designError('invalid_speaker','Het voorstel gebruikt een niet beschikbare spreker.');const text=plain(turn.text,4000,label,{empty:false});if(forbiddenSpeech.test(text))throw designError('invalid_content','Spreekteksten mogen geen invulhaken, links of uitvoerbare inhoud bevatten.');privateInput(text);return {speakerId:turn.speakerId,text};});
}
export function validateDesignProposal(input,options,{onlySlot=null,idPrefix='design'}={}){
 if(!input||typeof input!=='object'||Object.keys(input).some(k=>!['title','logline','storyForm','tone','productionNotes','scenes'].includes(k)))throw designError('invalid_schema','Het antwoord heeft niet het afgesproken ontwerpformaat.');
 const slots=designSlots(options).filter(slot=>!onlySlot||slot.id===onlySlot),allowed=[...new Set([options.leadId,...options.guestIds,...(options.magicCount?['milo']:[])])];
 if(!Array.isArray(input.scenes)||input.scenes.length!==slots.length||new Set(input.scenes.map(s=>s?.slotId)).size!==slots.length)throw designError('incomplete_proposal','Niet alle verplichte scènes zijn volledig geschreven.');
 const scenes=slots.map(slot=>{
  const row=input.scenes.find(s=>s.slotId===slot.id);if(!row||Object.keys(row).some(k=>!['slotId','title','purpose','speakerTurns','operatorNotes','cameraId','cueId','durationEstimate','fallbackTurns'].includes(k)))throw designError('invalid_slot','Het antwoord veranderde een beschermd scèneslot.');
  const speakerTurns=validateTurns(row.speakerTurns,allowed,slot.title),fallbackTurns=validateTurns(row.fallbackTurns,allowed,'Alternatieve spreektekst',{required:['random-call','magic','guest'].includes(slot.role)});
  if(slot.role==='random-call'&&(speakerTurns.length!==3||speakerTurns.some(t=>t.text.length>500)||fallbackTurns.length!==1||fallbackTurns[0].text.length>500))throw designError('invalid_content','Een voorbereid belmoment heeft precies drie korte spreekkaarten en één uitgesproken alternatief, elk maximaal vijfhonderd tekens.');
  if(slot.role==='magic'&&speakerTurns.some(t=>t.speakerId!=='milo'))throw designError('invalid_speaker','Alleen Milo kan deze bestaande magietruc uitvoeren.');
  if(!['guest','story'].includes(slot.role)&&speakerTurns.some(t=>t.speakerId!==(slot.role==='magic'?'milo':options.leadId)))throw designError('invalid_speaker','Deze scène gebruikt niet de gekozen presentator.');
  if(slot.role==='guest'&&(speakerTurns[0].speakerId!==options.leadId||!speakerTurns.some(t=>options.guestIds.includes(t.speakerId))))throw designError('invalid_guest','Het gastbezoek mist een uitgewerkte gastdialoog.');
  if(row.cameraId!==null&&!CAMERA_IDS.includes(row.cameraId)||row.cueId!==null&&!MAGIC_CUES.some(c=>c.id===row.cueId))throw designError('invalid_asset','Het voorstel verwijst naar een niet beschikbaar beeld of effect.');
  if(slot.role!=='magic'&&row.cueId!==null)throw designError('invalid_asset','Een magisch effect hoort uitsluitend bij het gereserveerde magiemoment.');
  if(!Number.isInteger(row.durationEstimate)||row.durationEstimate<1||row.durationEstimate>300)throw designError('invalid_duration','Een scène heeft een ongeldige tijdschatting.');
  return {id:`${idPrefix}-${slot.id}`,slotId:slot.id,role:slot.role,...(slot.condition?{condition:slot.condition}:{}),title:plain(row.title,60,'Scènetitel',{empty:false}),purpose:plain(row.purpose,500,'Scènedoel',{empty:false}),speakerTurns,operatorNotes:plain(row.operatorNotes,1600,'Regienotitie'),cameraId:row.cameraId,cueId:row.cueId,durationEstimate:row.durationEstimate,fallbackTurns};
 });
 if(!Array.isArray(input.productionNotes)||input.productionNotes.length>12)throw designError('invalid_content','De productienotities zijn te groot.');
 return {title:plain(input.title,60,'Voorsteltitel',{empty:false}),logline:plain(input.logline,400,'Logline',{empty:false}),storyForm:plain(input.storyForm,200,'Verhaalvorm',{empty:false}),tone:plain(input.tone,200,'Sfeer',{empty:false}),productionNotes:input.productionNotes.map(s=>plain(s,500,'Productienotitie')),scenes};
}
export function assertDistinctProposal(proposal,others){
 const tokens=p=>new Set(p.scenes.filter(s=>['welcome','story','finale','guest'].includes(s.role)).flatMap(s=>s.speakerTurns).map(t=>t.text.toLowerCase()).join(' ').split(/[^\p{L}]+/u).filter(w=>w.length>3));
 const own=tokens(proposal);for(const other of others){if(!other)continue;const theirs=tokens(other),intersection=[...own].filter(w=>theirs.has(w)).length,union=new Set([...own,...theirs]).size;if(proposal.title.toLowerCase()===other.title.toLowerCase()||union&&intersection/union>.78)throw designError('similar_proposal','Dit voorstel lijkt te veel op een andere optie. Schrijf een inhoudelijk andere opening, verhaallijn en afsluiting.');}
}
export const DESIGN_CONTROL_SPEECH_VERSION='milo-design-control-v1';
const canonicalControlSpeech=()=>({
 'cue-checking':{condition:'window-open',text:bingoWindowText('milo')},
 'cue-winner':{condition:'confirmed-bingo',text:FIXED_SHOW_SPEECH.winner},
 'cue-pattern':{condition:'round-transition',text:'We gaan door naar het volgende patroon binnen dezelfde ronde. De getrokken nummers blijven op het bord staan. Kijk in de app welk patroon nu geldt.'},
 'cue-call':{condition:'call-held',text:'De trekking staat stil voor een belmoment. We kijken of er een gezin klaarzit om mee te doen.'},
 'cue-no-call':{condition:'always',text:'Er komt nu geen gesprek. Dat is helemaal goed. We gaan gezellig verder met de show.'},
 'cue-no-prize':{condition:'always',text:'Een groot applaus voor iedereen die meespeelt! Kijk in de app voor de officiële uitslag en de verdere afhandeling.'},
 'cue-round-complete':{condition:'round-complete',text:'De volle kaart en deze ronde zijn officieel afgerond. Een groot applaus voor de winnaar! We gaan verder met het volgende showmoment.'},
 'cue-final-result':{condition:'confirmed-finale',text:'De laatste volle kaart is officieel bevestigd. Van harte gefeliciteerd! Een groot applaus voor de winnaar en voor iedereen die heeft meegespeeld. We gaan naar de afsluiting.'},
});
const join=turns=>turns.map(t=>t.text).join('\n\n');
const canonicalExplanation='We spelen vier rondes, met voor elke ronde de bijbehorende nieuwe kaart en een leeg ballenbord. Het middenvak is vrij. In ronde één, twee en drie spelen we eerst voor vier hoeken. Daarna moeten de bovenste én de onderste rij allebei vol zijn. Eén volle rij is dan geen bingo. Daarna spelen we voor de volle kaart. In de finaleronde telt alleen de volle kaart. Binnen een ronde blijven de getrokken nummers staan wanneer het patroon verandert. Er komt iedere vijftien seconden een officieel nummer, behalve tijdens een pauze, bingocontrole of belmoment. Heb je het getoonde patroon compleet? Meld bingo via de app. De spelserver controleert alle meldingen volgens de officiële spelregels. Wacht de bevestigde uitslag af.';
export function compileDesignProposal(proposal,options){
 const controls=canonicalControlSpeech();
 proposal={...proposal,scenes:proposal.scenes.map(scene=>{const control=controls[scene.slotId];if(!control)return scene;return {...scene,condition:control.condition,serverControlled:true,serverTextVersion:DESIGN_CONTROL_SPEECH_VERSION,editorialSpeakerTurns:structuredClone(scene.editorialSpeakerTurns||scene.speakerTurns),speakerTurns:[{speakerId:options.leadId,text:control.text}],fallbackTurns:[]};})};
 const base=standardMiloPlan(),prefix=proposal.scenes[0].id.replace(/-welcome$/,''),rounds=base.blocks.filter(b=>b.type==='round').map((round,i)=>({...round,id:`${prefix}-round-${i+1}`,callFullCardWinner:options.winnerCalls[i],goals:round.goals.map((g,j)=>({...g,id:`${prefix}-goal-${i+1}-${j+1}`,prizeId:''}))}));
 base.title=proposal.title;base.leadId=options.leadId;base.cohostId=null;base.studioId='sterrenplein';base.prizes=[];
 const scenes=new Map(proposal.scenes.map(s=>[s.slotId,s])),blocks=[],warnings=[];
 const append=id=>{const scene=scenes.get(id);if(!scene)return;const notes=[scene.operatorNotes,`Doel: ${scene.purpose}`,scene.fallbackTurns.length&&`Alternatief: ${join(scene.fallbackTurns)}`].filter(Boolean).join('\n');
  if(scene.role==='conditional')return;
  if(scene.role==='random-call'){blocks.push({id:scene.id,type:'random-call',title:scene.title,speakerId:options.leadId,text:'We kijken of er een toverassistent klaarzit voor een gezellig magisch belletje!',fallbackText:join(scene.fallbackTurns),preparedCallLines:{greeting:scene.speakerTurns[0].text,choice:scene.speakerTurns[1].text,thank:scene.speakerTurns[2].text,fallback:join(scene.fallbackTurns)},seconds:45,unit:'seconds',advance:'manual',operatorNotes:notes});return;}
  if(scene.role==='magic'){const cue=MAGIC_CUES.find(c=>c.id===scene.cueId)||MAGIC_CUES[0];if(!scene.cueId)warnings.push(`${scene.title}: bestaand effect ${cue.title} als speelbare fallback.`);blocks.push({id:scene.id,type:'magic',title:scene.title,speakerId:'milo',text:join(scene.speakerTurns),magicId:cue.id,camera:'magic',animation:'magic',duration:cue.duration,hold:2,operatorNotes:notes});return;}
  if(scene.role==='guest'||scene.speakerTurns.some(t=>t.speakerId!==options.leadId)){const guestId=scene.speakerTurns.find(t=>t.speakerId!==options.leadId)?.speakerId||options.guestIds[0];blocks.push({id:scene.id,type:'guest',title:scene.title,speakerId:options.leadId,guestId,text:'',dialogue:scene.speakerTurns,hold:2,duration:Math.min(180,scene.durationEstimate),operatorNotes:notes,...(scene.cameraId?{camera:scene.cameraId}:{})});blocks.at(-1).text=scene.speakerTurns[0].text;blocks.at(-1).dialogue=scene.speakerTurns.slice(1);return;}
  blocks.push({id:scene.id,type:scene.role==='explanation'?'explanation':scene.role==='welcome'?'welcome':scene.role==='finale'?'finale':'story',title:scene.title,speakerId:options.leadId,text:join(scene.speakerTurns),hold:2,operatorNotes:notes,...(scene.cameraId?{camera:scene.cameraId}:{})});if(scene.role==='explanation')blocks.at(-1).text+='\n\n'+canonicalExplanation;
 };
 blocks.push({id:`${proposal.scenes[0].id}-countdown`,type:'countdown',title:'We gaan beginnen',seconds:30,unit:'seconds'});append('welcome');for(const id of options.assetIds||[]){const cue=SHOW_CUES.find(c=>c.id===id);if(cue)blocks.push({id:`${prefix}-asset-${cue.id}`,type:'show',title:cue.title,showCueId:cue.id,duration:cue.duration,hold:0,...(cue.hostId?{speakerId:cue.hostId}:{})});}append('explanation');append('before-round-1');blocks.push(rounds[0]);append('after-round-1');append('random-1');append('magic-1');append('before-round-2');blocks.push(rounds[1]);append('after-round-2');append('guest');append('magic-2');append('before-round-3');blocks.push(rounds[2]);append('after-round-3');append('random-2');append('magic-3');append('magic-4');append('before-round-4');blocks.push(rounds[3]);append('closing');
 base.blocks=blocks;base.manualCues=proposal.scenes.filter(s=>s.role==='conditional').map(s=>({id:s.id,title:s.title,speakerId:options.leadId,text:join(s.speakerTurns),condition:s.condition,notes:s.operatorNotes}));
 const plan=normalizePlan(base);const validationPlan=structuredClone(plan);validationPlan.prizes=[{id:'verification-only',title:'Alleen validatie',description:'',image:''}];for(const r of validationPlan.blocks.filter(b=>b.type==='round'))for(const g of r.goals)g.prizeId='verification-only';normalizeBingoPlan(validationPlan);
 const formatGame={brandId:'milo',settings:{mode:'auto',rulesProfile:STANDARD_MILO_PROFILE},plan};if(standardMiloDiffers(formatGame))throw designError('protected_rules','Het ontwerp wijkt af van het beschermde Milo-spelformaat.');
 if(plan.blocks.filter(b=>b.type==='random-call').length!==2||plan.blocks.at(-1)?.type!=='finale')throw designError('protected_calls','Het ontwerp mist de twee veilige belpauzes of het slot.');
 const fixedSeconds=30+(options.assetIds||[]).reduce((sum,id)=>sum+(SHOW_CUES.find(c=>c.id===id)?.duration||0),0)+proposal.scenes.filter(s=>s.role!=='conditional'&&s.role!=='random-call').reduce((sum,s)=>sum+Math.max(s.durationEstimate,Math.ceil(join(s.speakerTurns).split(/\s+/).length/2.3)),0);
 return {...proposal,plan,duration:{fixedSeconds,totalRange:null,explanation:'Vaste presentatie geschat uit spreektempo en cue-duur; bingo, meldvensters en gesprekken variëren.'},warnings:[...warnings,'Koppel in de bestaande editor de echte prijzen aan alle tien prijsstappen; het model doet geen prijstoezeggingen.',...(options.targetMinutes&&options.targetMinutes<75?['De gewenste totale duur is ambitieus: vier bingorondes en meldvensters kunnen langer duren.']:[])]};
}
export function makeDesignGame(proposal,options,{owner,origin,id,date,now=Date.now()}){
 // Missing prizes remain an honest startcheck issue. makeGame validates domain
 // structure with a temporary price, then the persisted draft keeps no fiction.
 const plan=structuredClone(proposal.plan),validation=structuredClone(plan);validation.prizes=[{id:'verification-only',title:'Nog te koppelen prijs',description:'',image:''}];for(const round of validation.blocks.filter(b=>b.type==='round'))for(const goal of round.goals)goal.prizeId='verification-only';
 const game=makeGame({brandId:'milo',title:proposal.title,date:date||new Date(now+86400000).toISOString(),timeZone:'Europe/Amsterdam',roundCount:4,plan:validation,settings:{mode:'auto',rulesProfile:STANDARD_MILO_PROFILE}},owner,origin,now);game.id=id;game.plan=plan;game.designOrigin={version:DESIGN_VERSION};if(standardMiloDiffers(game)||game.status!=='draft'||game.books.length)throw designError('protected_rules','Het concept kon niet veilig worden samengesteld.');return game;
}
