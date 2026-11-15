import {FIXED_SHOW_SPEECH} from '../public/bingo-speech.js';
export const CALL_PRESENCE_MS=45000;
export const CALL_TECHNICAL_MS=30*60*1000;
const failure=(message,code='call_cue_conflict')=>{throw Object.assign(new Error(message),{status:409,code});};
const rounds=g=>(g.plan?.blocks||[]).filter(b=>b.type==='round');
export const openCallCue=c=>!!c&&!['completed','skipped'].includes(c.status);
export const winnerAnnouncementText=()=>FIXED_SHOW_SPEECH.winner;
export function canonicalRoundWinner(game,result){
 if(game.brandId!=='milo'||!result||result.type!=='bingo'||result.acknowledged!==true)return null;
 const rs=rounds(game),round=rs[result.roundIndex],goal=round?.goals?.[result.goalIndex],pattern=game.plan.patterns.find(p=>p.id===goal?.patternId),cells=new Set(pattern?.cells||[]);
 if(!round?.callFullCardWinner||!goal||result.goalIndex!==round.goals.length-1||result.roundId!==round.id||result.goalId!==goal.id||result.prize?.id!==goal.prizeId||result.pattern?.id!==pattern?.id||['rows','doubleRows'].includes(pattern?.variant)||Array.from({length:25},(_,i)=>i).some(i=>i!==12&&!cells.has(i)))return null;
 if(!result.winner?.accountId||!result.winner?.profileId||!result.entrants?.some(e=>e.bookId===result.winner.bookId&&e.accountId===result.winner.accountId&&e.profileId===result.winner.profileId&&e.completeAt===result.completeAt))return null;
 const canonical=game.results.find(r=>r.type==='bingo'&&r.roundId===round.id&&r.goalId===goal.id);if(canonical?.id!==result.id)return null;
 return {round,goal,roundIndex:result.roundIndex,resumeTarget:result.roundIndex===rs.length-1?'ending':'next-round'};
}
export function ensureWinnerCallCue(game,result,now=Date.now()){
 const canonical=canonicalRoundWinner(game,result);if(!canonical)return null;
 const cues=game.callCues??=[],id='winner:'+result.id,existing=cues.find(c=>c.id===id);if(existing)return existing;
 const cue={id,source:'winner',status:'waiting-announcement',resultId:result.id,roundId:canonical.round.id,roundIndex:canonical.roundIndex,resumeTarget:canonical.resumeTarget,createdAt:now,winner:structuredClone(result.winner),facts:{confirmed:true,resultId:result.id,round:canonical.round.title,prize:result.prize.title,type:'bingo'},fallbackText:'Een groot applaus voor onze winnaar! Milo tovert de felicitaties naar je toe.'};cues.push(cue);
 const roundBlockIndex=game.plan.blocks.findIndex(b=>b.id===canonical.round.id),following=game.plan.blocks[roundBlockIndex+1],randoms=game.plan.blocks.filter(b=>b.type==='random-call'),randomIndex=randoms.findIndex(b=>b.id===following?.id);
 if(following?.type==='random-call'&&randomIndex>=0&&randomIndex<2){const existingRandom=cues.find(c=>c.sourceBlockId===following.id);if(!existingRandom)cues.push({id:'random:'+following.id,source:'random',sourceBlockId:following.id,randomIndex:randomIndex+1,status:'deferred',resumeTarget:'draw',createdAt:now,reason:'De rondewinnaar gaat eerst; dit belletje wacht op de volgende geplande belpauze.',fallbackText:'Dan doet Milo het tovertrucje zelf! Tover maar gezellig met ons mee.'});else if(openCallCue(existingRandom)&&!existingRandom.callId){existingRandom.status='deferred';existingRandom.reason='De rondewinnaar gaat eerst; dit belletje wacht op de volgende geplande belpauze.';}}
 return cue;
}
export function assertCallCueProgress(game){if(game.brandId==='milo'&&(game.callCues||[]).some(c=>c.source!=='manual'&&!(c.source==='random'&&c.status==='deferred')&&openCallCue(c)))failure('Rond eerst de geplande belkaart af of sla dit belmoment bewust over.','call_cue_open');}
export function callEntryAvailability(game,entry,now=Date.now(),{blockedAccounts=new Set()}={}){
 if(!entry||!entry.child)return {available:false,reason:'Geen deelnemend kind.'};
 if(blockedAccounts.has(entry.accountId)||!game.books.some(b=>b.accountId===entry.accountId&&b.profileId===entry.profileId&&b.admitted&&!b.revokedAt))return {available:false,reason:'Geen geldig deelnemend boekje.'};
 if(!game.production?.calls?.enabled||entry.callConsentEnabled!==true||!entry.callConsentAt||entry.parentConsent!==true)return {available:false,reason:'Geen actuele beltoestemming voor dit kind en deze show.'};
 if(!entry.callPresenceAt||entry.callPresenceAt>now+5000||now-entry.callPresenceAt>CALL_PRESENCE_MS)return {available:false,reason:'De familieapp van dit kind is niet bereikbaar.'};
 if(entry.micChecked!==true||entry.headphones!==true||entry.connectionChecked!==true||!entry.technicalReadyAt||now-entry.technicalReadyAt>CALL_TECHNICAL_MS)return {available:false,reason:'Microfoon, koptelefoon of verbinding moeten opnieuw worden gecontroleerd.'};
 return {available:true,reason:'Toestemming, app en apparatuur zijn klaar.'};
}
export function eligibleCallEntries(game,now=Date.now(),{random=false,blockedAccounts=new Set()}={}){
 const prior=new Set((game.callHistory||[]).filter(h=>h.invitedAt).map(h=>JSON.stringify([h.accountId,h.profileId]))),seen=new Set();
 return (game.participation||[]).filter(e=>{const key=JSON.stringify([e.accountId,e.profileId]);if(seen.has(key)||random&&prior.has(key)||!callEntryAvailability(game,e,now,{blockedAccounts}).available)return false;seen.add(key);return true;});
}
export function scheduleCallCue(game,body,now=Date.now()){
 if(game.brandId!=='milo')failure('Deze belkaart hoort bij Milo.');
 const cues=game.callCues??=[];
 if(body.blockId){const blocks=game.plan.blocks.filter(b=>b.type==='random-call'),block=blocks.find(b=>b.id===body.blockId),index=blocks.indexOf(block);if(!block||index<0||index>=2)failure('Er zijn uitsluitend twee geplande willekeurige belkansen.');
  const existing=cues.find(c=>c.sourceBlockId===block.id);if(existing)return existing;if(cues.filter(c=>c.source==='random').length>=2)failure('De twee willekeurige belkansen zijn al gebruikt.');
  if(game.plan.blocks[game.state.blockIndex]?.id!==block.id)failure('Open eerst dit geplande belmoment uit het draaiboek.');
  const cue={id:'random:'+block.id,source:'random',sourceBlockId:block.id,randomIndex:index+1,status:'pending',resumeTarget:'draw',createdAt:now,fallbackText:'Dan doet Milo het tovertrucje zelf! Tover maar gezellig met ons mee.'};cues.push(cue);return cue;
 }
 if(typeof body.entryId!=='string')failure('Kies het juiste kind voor deze belkaart.');
 if(typeof body.requestId!=='string'||!/^[a-zA-Z0-9_-]{8,100}$/.test(body.requestId))failure('Plan dit belmoment opnieuw vanuit de regie.');const requestCue=cues.find(c=>c.id==='manual:'+body.requestId);if(requestCue){if(requestCue.entryId!==body.entryId)failure('Dit verzoek hoort bij een ander kind.');return requestCue;}
 const existing=cues.find(c=>c.source==='manual'&&openCallCue(c));if(existing){if(existing.entryId!==body.entryId)failure('Er staat al een handmatige belkaart klaar.');return existing;}
 if(cues.length>=100)failure('Deze show heeft al veel belkaarten.');
 const entry=game.participation?.find(e=>e.id===body.entryId);if(!entry)failure('Dit kind staat niet bij deze show.');
 const cue={id:'manual:'+body.requestId,source:'manual',entryId:entry.id,status:'pending',resumeTarget:'draw',createdAt:now,characterId:body.characterId||game.plan?.leadId||'milo',mode:body.mode||'prepared',context:structuredClone(body.context||{}),fallbackText:'We gaan gezellig verder met de show!'};cues.push(cue);return cue;
}
export function skipCallCue(game,cueId,reason,now=Date.now()){
 const cue=game.callCues?.find(c=>c.id===cueId);if(!cue)failure('Deze belkaart bestaat niet.');if(!openCallCue(cue))return cue;if(cue.callId)failure('Sluit eerst het bestaande gesprek en de terugkeer af.');cue.status='skipped';cue.reason=String(reason||'Overgeslagen door de regie.').slice(0,200);cue.completedAt=now;return cue;
}
function fairIndex(n){const limit=Math.floor(4294967296/n)*n;let value;do{value=crypto.getRandomValues(new Uint32Array(1))[0];}while(value>=limit);return value%n;}
export function reserveCallCue(game,cueId,now=Date.now(),{blockedAccounts=new Set(),randomIndex=fairIndex}={}){
 const cue=game.callCues?.find(c=>c.id===cueId);if(!cue)failure('Deze belkaart bestaat niet.');if(!openCallCue(cue)||cue.callId)return {cue,entry:null,replayed:true};
 if(cue.status==='waiting-announcement')failure('Laat eerst de officiële winnaar volledig in beeld en geluid bekendmaken.');
 const higher=game.callCues.find(c=>c.source==='winner'&&c.id!==cue.id&&openCallCue(c));if(cue.source!=='winner'&&higher){cue.status='deferred';cue.reason='De officiële rondewinnaar gaat eerst.';return {cue,entry:null};}
 if(game.status!=='running'||game.state.pending||game.state.window?.status==='open'||game.state.resultId||game.state.phase==='result'||game.state.drawHold||game.state.callId)failure('Wacht op een veilige showpauze na trekking, meldvenster en uitslag.');
 if(cue.source==='random'){
  const block=game.plan.blocks[game.state.blockIndex],sourceIndex=game.plan.blocks.findIndex(b=>b.id===cue.sourceBlockId);if(cue.status==='deferred'){if(sourceIndex>=0&&(game.state.blockIndex<=sourceIndex||!['pause','random-call','transition'].includes(block?.type)))return {cue,entry:null};}else if(block?.id!==cue.sourceBlockId){cue.status='skipped';cue.reason='Er is geen bruikbare geplande pauze meer.';cue.completedAt=now;return {cue,entry:null};}
 }
 let entry;
 if(cue.source==='winner')entry=game.participation?.find(e=>e.accountId===cue.winner.accountId&&e.profileId===cue.winner.profileId);
 else if(cue.source==='manual')entry=game.participation?.find(e=>e.id===cue.entryId);
 else if(cue.selectedAt){entry=game.participation?.find(e=>e.id===cue.entryId);if(entry&&(game.callHistory||[]).some(h=>h.invitedAt&&h.accountId===entry.accountId&&h.profileId===entry.profileId)){cue.status='skipped';cue.reason='Dit gekozen kind is intussen al uitgenodigd; er wordt niet opnieuw geloot.';cue.completedAt=now;return {cue,entry:null};}}
 else {const eligible=eligibleCallEntries(game,now,{random:true,blockedAccounts});entry=eligible.length?eligible[randomIndex(eligible.length)]:null;}
 const availability=callEntryAvailability(game,entry,now,{blockedAccounts});if(!availability.available){cue.status='skipped';cue.reason=availability.reason;cue.completedAt=now;return {cue,entry:null};}
 cue.selectedAt??=now;cue.entryId=entry.id;cue.profileId=entry.profileId;cue.accountId=entry.accountId;cue.name=entry.name;return {cue,entry};
}
export function completeCallCue(game,call,now=Date.now()){
 const cue=game.callCues?.find(c=>c.id===call.cueId);if(cue&&cue.callId===call.id){cue.status='completed';cue.outcome=call.outcome||'ended';cue.completedAt=now;}const history=game.callHistory?.find(h=>h.callId===call.id);if(history){history.outcome=call.outcome||'ended';history.completedAt=now;}
}

export function expireDeferredCallCues(game,now=Date.now()){for(const cue of game.callCues||[])if(cue.source==='random'&&cue.status==='deferred'&&!cue.callId){cue.status='skipped';cue.reason='De show sluit af; er is geen geplande bruikbare belpauze meer.';cue.completedAt=now;}}
