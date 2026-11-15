export const CALL_PHASE_LABELS=Object.freeze({preparing:'Klaar om te bellen',ringing:'De Bingoshow belt je!',backstage:'Privé met regie',staged:'Klaar voor live',live:'Nu hoorbaar in de uitzending',returning:'Terug naar de uitzending',returned:'Terugkeer gecontroleerd',completed:'Afgerond'});
export const cueOpen=cue=>!!cue&&!['completed','skipped','cancelled','failed','unavailable'].includes(cue.status);
export function callSourceLabel(value){
 if(value?.source==='winner')return 'Winnaar volle kaart'+(value.roundTitle||value.facts?.round?' · '+(value.roundTitle||value.facts.round):Number.isInteger(value.roundIndex)?' · ronde '+(value.roundIndex+1):'');
 if(value?.source==='random')return 'Willekeurig '+(value.randomIndex||value.randomNumber||value.ordinal||value.number||1)+' van 2';
 return 'Handmatig gepland';
}
export const callResumeLabel=call=>call?.resumeTarget==='ending'?'Verder naar afsluiting':call?.resumeTarget==='next-round'?'Start volgende ronde':'Hervat trekking';
export function childAvailability(entry,now=Date.now(),simulation=false){
 if(!entry)return {ready:false,label:'Nog geen kindje geselecteerd'};
 if(simulation)return {ready:true,label:'Oefenkind · gesimuleerd bereikbaar'};
 if(entry.child!==true||entry.callConsentEnabled!==true||!entry.callConsentAt||entry.parentConsent!==true)return {ready:false,label:'Geen actuele toestemming voor dit kindje'};
 if(entry.micChecked!==true||entry.connectionChecked!==true||entry.headphones!==true||!entry.technicalReadyAt||now-Number(entry.technicalReadyAt)>30*60*1000)return {ready:false,label:'Microfoon, koptelefoon en verbinding nog controleren'};
 if(!entry.callPresenceAt||Number(entry.callPresenceAt)>now+5000||now-Number(entry.callPresenceAt)>45000)return {ready:false,label:'App niet recent bereikbaar'};
 return {ready:true,label:'Bereikbaar · toestemming en apparaat gecontroleerd'};
}
export function nextCallCue(cues=[]){return cues.filter(cueOpen).sort((a,b)=>(a.source==='winner'?0:1)-(b.source==='winner'?0:1)||(a.createdAt||0)-(b.createdAt||0))[0]||null;}
