import script from './premiere-script.json' with {type:'json'};
import {defaultPlan,createBlock,newId,normalizePlan} from './plan-model.js';
import {addMissingRandomCalls} from './call-rundown.js';

export const PREMIERE_TITLE=script.title;
export const PREMIERE_DATE=script.date;
const types={'Countdown':'countdown','Showelement':'show','Welkomstwoord':'welcome','Uitleg':'explanation','Verhaallijn':'story','Magiemoment':'magic','Bingoronde':'round','Pauze':'pause','Gastbezoek':'guest','Finale':'finale'};
const conditions={B1:'window-open',B2:'checking',B3:'no-valid-bingo',B4:'confirmed-bingo',B5:'confirmed-tie',B6:'confirmed-consolation',B7:'confirmed-finale',B8:'always',C1:'always',C2:'call-held',C3:'call-held',C4:'call-held',C5:'always'};

// Loading this attachment always creates a separate draft. Existing games,
// printed round cards and confirmed results are never converted implicitly.
export function premierePlan(){
 const plan={...defaultPlan(),title:PREMIERE_TITLE,leadId:'milo',cohostId:null,studioId:'sterrenplein',blocks:[]};let roundIndex=0;
 for(const cue of script.cues){
  const type=types[cue.type],block=createBlock(type,plan,'milo');
  Object.assign(block,{title:cue.title,speakerId:'milo',operatorNotes:cue.notes});
  if(cue.text)block.text=cue.text;
  if(type==='countdown')Object.assign(block,{seconds:60,unit:'seconds'});
  if(type==='pause')Object.assign(block,{seconds:90,unit:'seconds'});
  if(type==='show')Object.assign(block,{showCueId:cue.number===26?'curtain-call':'welcome-wave',duration:cue.number===26?10:6});
  if(type==='magic')Object.assign(block,{magicId:cue.number===22?'silk-stars':'star-hat',duration:cue.number===22?15:14,hold:1});
  if(type==='guest')Object.assign(block,{guestId:'piko',dialogue:structuredClone(cue.dialogue),camera:'entrance',hold:2});
  if(cue.number===6){
   const second=cue.text.indexOf('Dan boven'),third=cue.text.indexOf('Daarna gaan');
   block.explanationSteps=[{patternId:'patroon-hoeken',text:cue.text.slice(0,second).trim()},{patternId:'patroon-boven-onder',text:cue.text.slice(second,third).trim()},{patternId:'patroon-vol',text:cue.text.slice(third).trim()}];
  }
  if(type==='round'){
   const final=roundIndex++===3;
   Object.assign(block,{interval:15,newBoard:true,goals:(final?['patroon-vol']:['patroon-hoeken','patroon-boven-onder','patroon-vol']).map(patternId=>({id:newId('doel'),patternId,prizeId:final?'prijs-hoofdprijs':'prijs-verrassing'}))});
  }
  plan.blocks.push(block);
 }
 plan.manualCues=script.manualCues.map(cue=>({id:newId('spreekkaart'),title:cue.code+' · '+cue.title,text:cue.text,speakerId:'milo',condition:cue.code.startsWith('A')?'round-transition':conditions[cue.code],notes:cue.notes,...(cue.code.startsWith('A')?{roundIndex:Math.floor((Number(cue.code.slice(1))-1)/2),goalIndex:Number(cue.code.slice(1))%2?1:2}:{})}));
 const confirmed=plan.manualCues.find(cue=>cue.title.startsWith('B4 ·'));
 plan.manualCues.push({...confirmed,id:newId('spreekkaart'),title:'B4 · Bevestigde volle kaart, ronde afgelopen',condition:'round-complete',text:'Ja hoor, de bingo is bevestigd! Gefeliciteerd met deze prijs. Geef thuis maar een applausje. Leg deze kaart even opzij. Ik vertel zo welke kaart we hierna pakken.',notes:'Alleen na de bevestigde volle kaart van ronde 1, 2 of 3. Voor de finale gebruik je B7.'});
 addMissingRandomCalls(plan);return normalizePlan(plan);
}
