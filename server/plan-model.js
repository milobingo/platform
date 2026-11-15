// Shared with the browser by scripts/build-worker.mjs.
import {ALL_CHARACTER_IDS,ANIMATIONS,CAMERA_IDS,MAGIC_IDS,CHARACTERS} from './characters.js';
import {showBrand} from './show-brands.js';
import {getShowCue} from './show-cues.js';
import {getMagicCue} from './magic-cues.js';
import {MANUAL_CUE_CONDITIONS} from './manual-cues.js';
import {MAX_SPEECH_CHARACTERS,speechCharacterCount,splitSpeechText} from './speech-text.js';
export const MAX_PLAN_SPEECH_CHUNKS=2200;
export const BLOCK_TYPES=Object.freeze({
 countdown:{name:'Countdown',short:'Aftellen',icon:'i-rest',description:'Een timer vóór de show of een ronde.'},
 welcome:{name:'Welkomstwoord',short:'Welkom',icon:'i-wave',description:'De presentator verwelkomt het publiek met jouw tekst.'},
 story:{name:'Verhaallijn',short:'Verhaal',icon:'i-star',description:'Een bewerkbaar avontuur van de presentator tussen de rondes.'},
 explanation:{name:'Uitleg',short:'Uitleg',icon:'i-chat',description:'Laat de presentator de spelregels of een bericht vertellen.'},
 round:{name:'Bingoronde',short:'Bingoronde',icon:'i-grid',description:'Koppel patronen en prijzen; ballen volgen vanzelf.'},
 pause:{name:'Pauze',short:'Pauze',icon:'i-rest',description:'Een pauzescherm met een instelbare timer.'},
 call:{name:'Belronde',short:'Belronde',icon:'i-volume',description:'Reserveer een moment voor een gesprek met de presentator.'},
 'random-call':{name:'Willekeurig belmoment',short:'Magisch belletje',icon:'i-volume',description:'Eén gelijke lotingskans voor een beschikbaar kind. Twee geplande kansen per Milo-show.'},
 show:{name:'Showelement',short:'Show',icon:'i-star',description:'Een getimed gebaar met licht, effect en jingle op het Sterrenplein.'},
 magic:{name:'Magiemoment',short:'Magie',icon:'i-star',description:'Een geprogrammeerde goocheltruc van Milo, los van de officiële trekking.'},
 guest:{name:'Gastbezoek',short:'Gast',icon:'i-wave',description:'Laat een vriend volgens het draaiboek binnenkomen, spreken en vertrekken.'},
 finale:{name:'Finale',short:'Finale',icon:'i-star',description:'De presentator bedankt het publiek en sluit de show af.'},
});
export const newId=prefix=>`${prefix}-${crypto.randomUUID()}`;
export const formatDuration=value=>{const s=Math.max(0,Math.round(Number(value)||0));return s<60?`${s} sec`:s%60?`${Math.floor(s/60)} min ${s%60} sec`:`${s/60} min`;};
export function createBlock(type,document={blocks:[]},identity){
 if(!Object.hasOwn(BLOCK_TYPES,type))throw new Error('Onbekend showblok.');
 const brand=showBrand(identity??(document.studioId==='sterrenplein'||document.leadId&&document.leadId!=='vlampie'?'milo':'vlampie')),presenter=CHARACTERS[document.leadId]||CHARACTERS[brand.id]||CHARACTERS.milo;
 const b={id:newId('blok'),type,title:BLOCK_TYPES[type].name};
 if(type==='countdown')Object.assign(b,{seconds:60,unit:'seconds'});
 if(type==='pause')Object.assign(b,{seconds:180,unit:'minutes'});
 if(['welcome','explanation','story','finale'].includes(type))Object.assign(b,{text:type==='welcome'?`Hallo allemaal! Welkom bij ${brand.title}. Pak je kaart erbij, we maken er een gezellige show van!`:type==='finale'?'Bedankt voor het meespelen! Een groot applaus voor iedereen. Tot de volgende keer!':'',hold:2});
 if(type==='round'){const number=document.blocks.filter(x=>x.type==='round').length+1;b.title=`Ronde ${number}`;Object.assign(b,{goals:[{id:newId('doel'),patternId:document.patterns?.[0]?.id||'',prizeId:document.prizes?.[0]?.id||''}],interval:4,newBoard:true});}
 if(type==='call')Object.assign(b,{seconds:120,unit:'minutes',text:`Tijd voor een gezellig moment met ${presenter.short||presenter.name}!`,advance:'manual'});
 if(type==='random-call'){if(brand.id==='vlampie')throw new Error('Willekeurige belmomenten horen bij Milo & Friends.');Object.assign(b,{seconds:45,unit:'seconds',text:'Wie wordt onze toverassistent? Er komt een magisch belletje aan!',fallbackText:'Dit keer doe ik de truc zelf. Tover allemaal gezellig mee!',advance:'manual'});}
 if(type==='show')Object.assign(b,{showCueId:'welcome-wave',duration:6,hold:0});
 if(type==='magic')Object.assign(b,{speakerId:'milo',magicId:'star-hat',text:'Mijn hoed heeft een kleine verrassing. Kijk maar mee!',duration:14,hold:2,camera:'magic',animation:'magic'});
 if(type==='guest')Object.assign(b,{speakerId:'milo',guestId:'kora',text:'Wat gezellig! Er komt iemand op bezoek op het Sterrenplein.',duration:18,hold:2,camera:'entrance',animation:'wave',dialogue:[{speakerId:'kora',text:'Ahoy vrienden! Wat fijn om jullie te zien.',animation:'wave'},{speakerId:'milo',text:'Welkom op het Sterrenplein, kapitein Kora!',animation:'welcome'}]});
 return b;
}
export function defaultPlan(){
 const patterns=[
  {id:'patroon-hoeken',title:'Vier hoeken',cells:[0,4,20,24],freeCenter:true,variant:'fixed'},
  {id:'patroon-boven-onder',title:'Bovenste én onderste rij',cells:[0,1,2,3,4,20,21,22,23,24],freeCenter:true,variant:'fixed'},
  {id:'patroon-rij',title:'Eén rij',cells:[0,1,2,3,4],freeCenter:true,variant:'rows'},
  {id:'patroon-diagonaal',title:'Diagonaal',cells:[0,6,12,18,24],freeCenter:true,variant:'fixed'},
  {id:'patroon-vol',title:'Volle kaart',cells:Array.from({length:25},(_,i)=>i),freeCenter:true,variant:'fixed'},
 ];
 const prizes=[{id:'prijs-verrassing',title:'Verrassingspakket',description:'Een feestelijk pakket voor de winnaar.',image:''},{id:'prijs-hoofdprijs',title:'De hoofdprijs',description:'Het mooiste cadeau voor een volle kaart.',image:''}];
 return {version:1,title:'Vlampie’s Bingo',patterns,prizes,blocks:[
  {id:'blok-countdown',type:'countdown',title:'We gaan beginnen',seconds:60,unit:'seconds'},
  {id:'blok-welkom',type:'welcome',title:'Welkom bij Vlampie',text:'Hallo allemaal! Welkom bij Vlampie’s pakjesavondbingo! Leg je kaarten klaar en speel gezellig mee.',hold:2},
  {id:'blok-uitleg',type:'explanation',title:'Zo speel je mee',text:'Streep elk genoemd nummer af. Kijk goed naar het patroon van de ronde. Heb je het patroon compleet? Meld dan bingo! De regie controleert je kaart voordat we de winnaar feliciteren.',hold:2},
  {id:'blok-ronde-1',type:'round',title:'Ronde 1',goals:[{id:'doel-1',patternId:'patroon-hoeken',prizeId:'prijs-verrassing'}],interval:4,newBoard:true},
  {id:'blok-pauze',type:'pause',title:'Even een pauze',seconds:180,unit:'minutes'},
  {id:'blok-ronde-2',type:'round',title:'Ronde 2',goals:[{id:'doel-2',patternId:'patroon-vol',prizeId:'prijs-hoofdprijs'}],interval:4,newBoard:true},
  {id:'blok-finale',type:'finale',title:'Bedankt voor het meespelen',text:'Wat een gezellige bingoavond! Bedankt voor het meespelen en een groot applaus voor de winnaars. Tot de volgende keer!',hold:2},
 ]};
}
const id=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(v);
function text(v,max,label){if(typeof v!=='string'||v.length>max)throw new Error(`${label} is te lang of ongeldig.`);return v.trim();}
function number(v,min,max,label){if(!Number.isFinite(v)||v<min||v>max)throw new Error(`Kies een geldige waarde voor ${label}.`);return Math.round(v*100)/100;}
function list(v,max,label){if(!Array.isArray(v)||v.length>max)throw new Error(`${label} bevat te veel onderdelen.`);return v;}
function unique(rows,label){const seen=new Set();for(const row of rows){if(!row||!id(row.id)||seen.has(row.id))throw new Error(`${label} bevat een ongeldig of dubbel onderdeel.`);seen.add(row.id);}}
export function normalizePlan(input){
 if(!input||input.version!==1)throw new Error('De showvoorbereiding heeft een onbekend formaat.');
 const patterns=list(input.patterns,80,'Patronen').map(p=>{
  if(!p||typeof p.freeCenter!=='boolean'||!['fixed','rows','doubleRows'].includes(p.variant))throw new Error('Het patroon is ongeldig.');
  const cells=list(p.cells,25,'Patroonvakjes');if(cells.some(n=>!Number.isInteger(n)||n<0||n>24)||new Set(cells).size!==cells.length)throw new Error('Het patroon bevat ongeldige vakjes.');
  return {id:p.id,title:text(p.title,60,'Patroonnaam'),cells:p.variant==='rows'?[0,1,2,3,4]:p.variant==='doubleRows'?Array.from({length:10},(_,i)=>i):[...cells].sort((a,b)=>a-b),freeCenter:p.freeCenter,variant:p.variant};
 });unique(patterns,'Patronen');
 const prizes=list(input.prizes,100,'Prijzen').map(p=>{
  const image=text(p.image,180,'Prijsafbeelding');if(image&&!/^\/api\/planner\/images\/[a-f0-9-]{36}$/.test(image))throw new Error('Gebruik een geüploade prijsafbeelding.');
  return {id:p.id,title:text(p.title,90,'Prijsnaam'),description:text(p.description,180,'Prijsomschrijving'),image};
 });unique(prizes,'Prijzen');
 const blocks=list(input.blocks,100,'De tijdlijn').map(b=>{
  if(!b||!Object.hasOwn(BLOCK_TYPES,b.type))throw new Error('De tijdlijn bevat een onbekend showblok.');
  const out={id:b.id,type:b.type,title:text(b.title,60,'Bloktitel')};
  if(b.operatorNotes!==undefined)out.operatorNotes=text(b.operatorNotes,10000,'Regienotities');
  if(b.speakerId!==undefined){if(!ALL_CHARACTER_IDS.includes(b.speakerId))throw new Error('Kies een bestaand sprekend personage.');out.speakerId=b.speakerId;}
  if(b.camera!==undefined){if(!CAMERA_IDS.includes(b.camera))throw new Error('Kies een beschikbare camera.');out.camera=b.camera;}
  if(b.animation!==undefined){if(!ANIMATIONS.includes(b.animation))throw new Error('Kies een beschikbare beweging.');out.animation=b.animation;}
  if(['countdown','pause','call','random-call'].includes(b.type)){out.seconds=number(b.seconds,1,86400,'de timer');out.unit=b.unit==='minutes'?'minutes':'seconds';}
  if(['welcome','explanation','story','finale','call','random-call','magic','guest'].includes(b.type))out.text=speechText(b.text,'Presentatietekst');
  if(b.type==='random-call'){if(input.leadId==='vlampie'||input.studioId&&input.studioId!=='sterrenplein'&&input.studioId!=='magico')throw new Error('Willekeurige belmomenten horen bij Milo & Friends.');out.fallbackText=speechText(b.fallbackText??'Dit keer doe ik de truc zelf. Tover allemaal gezellig mee!','Brug bij een overgeslagen belletje');out.advance='manual';}
  if(b.type==='explanation'&&b.explanationSteps!==undefined)out.explanationSteps=list(b.explanationSteps,10,'Uitlegstappen').map(step=>{
   if(!step||typeof step.patternId!=='string'||step.patternId.length>80)throw new Error('Kies voor elke uitlegstap een geldig patroon.');
   return {patternId:step.patternId,text:speechText(step.text,'Tekst uitlegstap')};
  });
  if(['welcome','explanation','story','finale','magic','guest'].includes(b.type))out.hold=number(b.hold,0,60,'de wachttijd');
  if(['magic','guest'].includes(b.type))out.duration=number(b.duration??(b.type==='magic'?getMagicCue(b.magicId)?.duration:undefined),2,180,'de cue-duur');
  if(b.type==='show'){const cue=getShowCue(b.showCueId);if(!cue)throw new Error('Kies een bestaand showelement.');if((input.studioId&&input.studioId!=='sterrenplein')||(!input.studioId&&(!input.leadId||input.leadId==='vlampie'))||input.leadId==='vlampie'||out.speakerId==='vlampie')throw new Error('Showelementen horen bij de Milo & Friends-productie.');if(cue.hostId)out.speakerId=cue.hostId;out.showCueId=cue.id;out.duration=cue.duration;out.hold=0;}
  if(b.type==='magic'){if(!MAGIC_IDS.includes(b.magicId))throw new Error('Kies een bestaand magiemoment.');if(out.speakerId&&out.speakerId!=='milo')throw new Error('Milo voert deze goocheltruc uit.');out.speakerId='milo';out.magicId=b.magicId;}
  if(b.type==='guest'){
   if(!ALL_CHARACTER_IDS.includes(b.guestId))throw new Error('Kies een bestaand gastpersonage.');out.guestId=b.guestId;
   out.dialogue=list(b.dialogue||[],12,'Dialoogbeurten').map(turn=>{if(!turn||!ALL_CHARACTER_IDS.includes(turn.speakerId))throw new Error('Kies voor elke dialoogbeurt een spreker.');if(turn.animation!==undefined&&!ANIMATIONS.includes(turn.animation))throw new Error('Kies een beschikbare dialoogbeweging.');return {speakerId:turn.speakerId,text:speechText(turn.text,'Dialoogtekst'),...(turn.animation?{animation:turn.animation}:{})};});
  }
  if(b.type==='call')out.advance=b.advance==='auto'?'auto':'manual';
  if(b.type==='round'){
   if(b.callFullCardWinner!==undefined){if(typeof b.callFullCardWinner!=='boolean')throw new Error('Kies of de vollekaartwinnaar gebeld mag worden.');out.callFullCardWinner=b.callFullCardWinner;}
   if(typeof b.newBoard!=='boolean')throw new Error('Kies of de ronde een nieuw bingobord krijgt.');
   out.newBoard=b.newBoard;out.interval=number(b.interval,0,60,'de tijd tussen trekkingen');
   out.goals=list(b.goals,10,'Winnende combinaties').map(g=>{if(!g||!id(g.id)||typeof g.patternId!=='string'||typeof g.prizeId!=='string'||g.patternId.length>80||g.prizeId.length>80)throw new Error('De winnende combinatie is ongeldig.');return {id:g.id,patternId:g.patternId,prizeId:g.prizeId};});unique(out.goals,'Winnende combinaties');
  }return out;
 });unique(blocks,'De tijdlijn');
 const out={version:1,title:text(input.title,60,'Showtitel'),patterns,prizes,blocks};
 if(input.manualCues!==undefined){
  out.manualCues=list(input.manualCues,80,'Microfoonteksten').map(cue=>{
   if(!cue||!Object.hasOwn(MANUAL_CUE_CONDITIONS,cue.condition||'always'))throw new Error('Kies een geldige afspeelvoorwaarde voor de microfoontekst.');
   const row={id:cue.id,title:text(cue.title,90,'Naam microfoontekst'),text:speechText(cue.text,'Microfoontekst'),condition:cue.condition||'always'};
   if(cue.speakerId!==undefined){if(!ALL_CHARACTER_IDS.includes(cue.speakerId))throw new Error('Kies een bestaand sprekend personage.');row.speakerId=cue.speakerId;}
   if(cue.notes!==undefined)row.notes=text(cue.notes,10000,'Regienotities');
   for(const name of ['roundIndex','goalIndex'])if(cue[name]!==undefined){if(!Number.isSafeInteger(cue[name])||cue[name]<0||cue[name]>(name==='roundIndex'?99:9))throw new Error('Koppel de microfoontekst aan een geldige ronde en prijsstap.');row[name]=cue[name];}
   return row;
  });unique(out.manualCues,'Microfoonteksten');
 }
 const scripts=blocks.flatMap(block=>[...(block.explanationSteps?.length?block.explanationSteps.map(step=>step.text):[block.text]),block.fallbackText,...(block.dialogue||[]).map(turn=>turn.text)]).concat((out.manualCues||[]).map(cue=>cue.text));
 if(scripts.reduce((count,value)=>count+(value?.trim()?splitSpeechText(value).length:0),0)>MAX_PLAN_SPEECH_CHUNKS)throw new Error('Het draaiboek bevat te veel stemfragmenten. Verdeel de teksten over meerdere shows.');
 if(input.leadId!==undefined){if(!ALL_CHARACTER_IDS.includes(input.leadId))throw new Error('Kies een bestaande hoofdhost.');out.leadId=input.leadId;}
 out.cohostId=input.cohostId??null;
 if(out.cohostId!==null&&!ALL_CHARACTER_IDS.includes(out.cohostId))throw new Error('Kies een bestaande copresentator.');
 if(out.cohostId&&out.cohostId===out.leadId)throw new Error('Kies twee verschillende presentatoren.');
 if(input.studioId!==undefined){if(!['sterrenplein','showtime','sinterklaas','royale','magico'].includes(input.studioId))throw new Error('Kies een bestaande studio.');out.studioId=input.studioId;}
 return out;
}
function speechText(value,label){if(typeof value!=='string'||speechCharacterCount(value)>MAX_SPEECH_CHARACTERS)throw new Error(`${label}: gebruik maximaal 10.000 tekens.`);return value.trim();}
export function planIssues(document){
 const issues=[];if(!document.title.trim())issues.push('Geef de show een titel.');if(!document.blocks.length)issues.push('Voeg een showblok toe.');
 if(document.blocks.filter(block=>block.type==='random-call').length>2)issues.push('Een Milo-show heeft maximaal twee willekeurige belmomenten. Verwijder het derde moment.');
 for(const b of document.blocks){
  const name=b.title||BLOCK_TYPES[b.type].name;
  if(!b.title.trim())issues.push('Geef elk showblok een titel.');
  if(['welcome','explanation','story','finale','magic','guest'].includes(b.type)&&!b.text.trim()&&!b.explanationSteps?.length)issues.push(`${name}: vul de presentatietekst in.`);
  if(b.type==='explanation')for(const step of b.explanationSteps||[]){
   const pattern=document.patterns.find(item=>item.id===step.patternId);
   if(!pattern||!pattern.title.trim()||!pattern.cells.some(cell=>cell!==12||!pattern.freeCenter))issues.push(`${name}: kies voor elke uitlegstap een compleet patroon.`);
   if(!step.text.trim())issues.push(`${name}: vul de tekst van elke uitlegstap in.`);
  }
  if(b.type==='guest'&&b.dialogue?.some(turn=>!turn.text.trim()))issues.push(`${name}: vul elke dialoogbeurt in.`);
  if(b.type==='round'){
   if(!b.goals.length)issues.push(`${name}: voeg een patroon en prijs toe.`);
   for(const [step,g] of b.goals.entries()){const p=document.patterns.find(p=>p.id===g.patternId),prize=document.prizes.find(p=>p.id===g.prizeId);
    if(!p||!p.title||!p.cells.some(n=>n!==12||!p.freeCenter))issues.push(`${name}: kies een compleet patroon.`);
    if(p&&p.variant==='fixed'&&Array.from({length:25},(_,i)=>i).every(i=>i===12&&p.freeCenter||p.cells.includes(i))&&step!==b.goals.length-1)issues.push(`${name}: zet volle kaart als laatste patroon; daarna is de ronde afgelopen.`);
    if(!prize||!prize.title)issues.push(`${name}: kies een prijs.`);
   }
  }
 }
 for(const cue of document.manualCues||[]){if(!cue.title.trim())issues.push('Geef elke microfoontekst een naam.');if(!cue.text.trim())issues.push(`${cue.title||'Microfoontekst'}: vul de presentatietekst in.`);}
 return [...new Set(issues)];
}
export function moveBlock(document,id,beforeId=null){
 const from=document.blocks.findIndex(b=>b.id===id);if(from<0||id===beforeId)return false;
 const target=beforeId===null?document.blocks.length:document.blocks.findIndex(b=>b.id===beforeId);if(target<0)return false;
 const [b]=document.blocks.splice(from,1);document.blocks.splice(target-(from<target?1:0),0,b);return true;
}
export function blockSummary(block,document){
 if(['countdown','pause'].includes(block.type))return formatDuration(block.seconds);
 if(block.type==='round')return block.goals.map(g=>`${document.patterns.find(p=>p.id===g.patternId)?.title||'Kies een patroon'} · ${document.prizes.find(p=>p.id===g.prizeId)?.title||'Kies een prijs'}`).join(' / ');
 if(block.type==='show'){const cue=getShowCue(block.showCueId);return cue?`${cue.title} · ${formatDuration(cue.duration)}`:'Kies een showelement';}
 if(block.type==='call')return `${formatDuration(block.seconds)} · ${block.advance==='auto'?'automatisch verder':'regie gaat verder'}`;
 if(block.type==='random-call')return 'Eén beschikbaar kind · serverloting · maximaal twee kansen per show';
 return block.text||'Vul een tekst in voor de presentator';
}
