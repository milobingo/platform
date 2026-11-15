import {brandId,validBrand,brandDefaults,repairLegacyPlanBrand} from './show-brands.js';
import {playerProduction,productionSettings,productionEvent} from './production-model.js';
import {defaultPlan,normalizePlan,planIssues,newId} from './plan-model.js';
import {assertWindowCapacity} from './game-capacity.js';
import {normalizeShowTime} from './show-time.js';
import {projectedGameRules} from './game-rules.js';
import {STANDARD_MILO_PROFILE,STANDARD_DRAW_RESERVATION_MS,standardMiloPlan,isStandardMiloGame,resetDrawClock,drawDueAt} from './standard-show.js';
import {addMissingRandomCalls} from './call-rundown.js';

export const MINIGAMES=Object.freeze([
 {id:'wheel',name:'Vlampie’s Vuurrad',kind:'wheel',description:'Het rad versnelt, de lampen jagen rond en de laatste tik beslist.'},
 {id:'gifts',name:'De Pakjesparade',kind:'gifts',description:'Volg jouw pakje tijdens de wissels. Eén deksel vliegt open voor de winnaar.'},
 {id:'gold',name:'De Gouden Bingobal',kind:'gold',description:'Gekleurde ballen draaien in een baan. De scanner laat één gouden bal naar voren komen.'},
 {id:'horses',name:'Vlampie’s Paardenrace',kind:'race',description:'Galop, horden en inhaalacties: wie wint de spannende eindsprint?'},
 {id:'cookies',name:'De Kruidnotenrace',kind:'race',description:'Rollende kruidnoten springen over schansen en laten kruimelsporen achter.'},
 {id:'rockets',name:'Raketten naar de Maan',kind:'race',description:'Een lancering met uitlaatsporen, boostpoorten en een landing op de maanbasis.'},
 {id:'boats',name:'De Pakjesbootrace',kind:'race',description:'Boten zoeken de snelle stroming en laten boeggolven achter op weg naar de haven.'},
 {id:'chimneys',name:'Het Schoorstenenparcours',kind:'path',description:'Pakjes slingeren door doorgangen en glijden naar de gouden cadeaukist.'},
 {id:'balloons',name:'Het Ballonnenfeest',kind:'eliminate',description:'Ballonnen stijgen en knallen één voor één. Welke blijft als laatste over?'},
 {id:'pinball',name:'Vlampie’s Bingo-Flipperkast',kind:'path',description:'Plunjers, bumpers, ricochets en bewegende flippers sturen de ballen naar het prijsenvak.'},
 {id:'disco',name:'De Gouden Discovloer',kind:'eliminate',description:'Lichtgolven, dansende sterren en verdwijnende spotlights: één tegel blijft goud.'},
 {id:'plingo',name:'Plingo',kind:'pegboard',description:'Een gouden bal stuitert langs lichtgevende pinnen en landt bij de officieel bevestigde winnaar.'},
 {id:'ribbons',name:'Het Lintenlabyrint',kind:'ribbons',brands:['milo'],description:'Gekleurde linten vlechten door een zwevend labyrint. Milo maakt de knoop los en onthult de gouden winnaarster.'},
 {id:'mirrors',name:'Het Spiegelpaleis',kind:'mirrors',brands:['milo'],description:'Magische spiegels vermenigvuldigen de finalistensymbolen. Eén weerspiegeling stapt naar voren voor de onthulling.'},
 {id:'potion',name:'De Bruisende Toverdrank',kind:'potion',brands:['milo'],description:'Milo mengt sterrenstof en maanlicht. Eén toverflesje onthult de officieel vastgelegde winnaar in een gouden fontein.'},
 {id:'butterfly',name:'De Keuze van de Sterrenvlinder',kind:'butterfly',brands:['milo'],description:'Milo’s sterrenvlinder vliegt langs de finalisten en brengt de gouden envelop naar de vastgelegde winnaar.'},
]);
export function minigamesForBrand(identity='vlampie'){const id=brandId(identity);return MINIGAMES.filter(game=>!game.brands||game.brands.includes(id));}
// Old saved selections remain untouched. Only the next reveal's eligible pool
// is filtered, so obsolete/foreign IDs can never pick a different production.
export function enabledMinigameIds(game){
 const allowed=minigamesForBrand(game).map(g=>g.id),selected=Array.isArray(game?.settings?.minigames)?game.settings.minigames:allowed;
 const enabled=[...new Set(selected.filter(id=>allowed.includes(id)))];return enabled.length?enabled:allowed;
}
export class BingoError extends Error{constructor(message,status=400,code='invalid'){super(message);this.status=status;this.code=code;}}
export function integer(v,min,max,label){const n=Number(v);if(!Number.isInteger(n)||n<min||n>max)throw new BingoError(`${label}: kies ${min} tot en met ${max}.`);return n;}
export function cleanText(v,max,label){if(typeof v!=='string'||!v.trim()||v.trim().length>max)throw new BingoError(`Vul een geldige ${label} in.`);return v.trim();}
export function bingoPrintMode(value='color'){if(!['color','mono'].includes(value))throw new BingoError('Kies kleur of zwart-wit voor de bingoboekjes.');return value;}
export function randomIndex(length,random=crypto){if(!length)throw new BingoError('Er zijn geen deelnemers.');const ceiling=Math.floor(4294967296/length)*length,word=new Uint32Array(1);do{random.getRandomValues(word);}while(word[0]>=ceiling);return word[0]%length;}
export function shuffle(values,random=crypto){const result=[...values];for(let i=result.length-1;i>0;i--){const j=randomIndex(i+1,random);[result[i],result[j]]=[result[j],result[i]];}return result;}
export function defaultGamePlan(roundCount=4){
 const plan=defaultPlan(),rounds=[];plan.patterns.push({id:'patroon-twee-rijen',title:'Twee horizontale rijen',cells:Array.from({length:10},(_,i)=>i),freeCenter:true,variant:'doubleRows'});for(let i=0;i<roundCount;i++){
  const last=i===roundCount-1,title=last?'Finaleronde':`Ronde ${i+1}`;
  rounds.push({id:newId('ronde'),type:'round',title,goals:(last?['patroon-vol']:['patroon-hoeken','patroon-boven-onder','patroon-vol']).map(patternId=>({id:newId('doel'),patternId,prizeId:last?'prijs-hoofdprijs':'prijs-verrassing'})),interval:4,newBoard:true});
  if(!last)rounds.push({id:newId('pauze'),type:'pause',title:'Pakjespauze',seconds:60,unit:'seconds'});
 }
 plan.blocks=[...plan.blocks.slice(0,3),...rounds,plan.blocks.at(-1)];return plan;
}
export function gameSettings(input={},identity='vlampie'){
 if(input.youtubeId&&!/^[A-Za-z0-9_-]{11}$/.test(input.youtubeId))throw new BingoError('Gebruik een geldige YouTube-video-ID.');
 if(input.consolationEnabled!==undefined&&typeof input.consolationEnabled!=='boolean')throw new BingoError('Zet de troostprijs aan of uit.');
 const allowed=minigamesForBrand(identity).map(m=>m.id);
 if(input.minigames!==undefined&&!Array.isArray(input.minigames))throw new BingoError('Kies beslisspellen uit de lijst.');
 const enabled=[...new Set(input.minigames??allowed)];if(!enabled.length||enabled.some(id=>!allowed.includes(id)))throw new BingoError('Activeer minstens één beslisspel uit de lijst van deze productie.');
 return {claimSeconds:integer(input.claimSeconds??30,30,600,'Meldvenster'),retroBalls:integer(input.retroBalls??3,0,75,'Terugkijkmarge'),cooldownSeconds:integer(input.cooldownSeconds??60,0,86400,'Afkoelperiode'),falseLimit:integer(input.falseLimit??3,1,100,'Blokkeren na valse bingo’s'),confirmFinale:input.confirmFinale!==false,consolationEnabled:input.consolationEnabled===true,consolationPrizeTitle:cleanText(input.consolationPrizeTitle??'Een kleine verrassing',90,'naam van de troostprijs'),youtubeId:input.youtubeId?cleanText(input.youtubeId,11,'YouTube-video-ID'):'',mode:['manual','guided','auto'].includes(input.mode)?input.mode:'guided',minigames:enabled,...(brandId(identity)==='milo'&&input.rulesProfile===STANDARD_MILO_PROFILE?{rulesProfile:STANDARD_MILO_PROFILE}:{})};
}
// Printed cards always have a free centre. Validate that effective rule before
// accepting a draft, printing books, publishing rules or starting an old show.
export function normalizeBingoPlan(input){
 let plan;try{plan=normalizePlan(input);}catch(error){throw new BingoError(error.message,400,'invalid_plan');}
 plan.patterns.forEach(pattern=>{pattern.freeCenter=true;if(!pattern.cells.some(cell=>cell!==12))throw new BingoError(`Patroon “${pattern.title||pattern.id}” moet minstens één echt getal buiten het vrije middenvak bevatten.`,400,'invalid_pattern');});
 plan.blocks.filter(block=>block.type==='round').forEach(block=>block.newBoard=true);
 const issues=planIssues(plan);if(issues.length)throw new BingoError(issues[0],400,'invalid_plan');return plan;
}
export function makeGame(input,ownerId,origin,now=Date.now()){
 const count=integer(input.roundCount??4,1,8,'Aantal rondes'),standard=brandId(input.brandId)==='milo'&&count===4&&!input.plan,plan=normalizeBingoPlan(input.plan?repairLegacyPlanBrand(input.plan,input.brandId):standard?standardMiloPlan():brandDefaults(defaultGamePlan(count),input.brandId));
 if(!input.plan&&brandId(input.brandId)==='milo')addMissingRandomCalls(plan);
 const schedule=normalizeShowTime(input.date,{timeZone:input.timeZone});
 if(plan.blocks.filter(b=>b.type==='round').length!==count)throw new BingoError('Het aantal rondes in de voorbereiding moet overeenkomen met het spel.');
 return {id:crypto.randomUUID(),brandId:validBrand(input.brandId||'vlampie'),ownerId,title:cleanText(input.title||plan.title,60,'spelnaam'),...schedule,origin,createdAt:now,status:'draft',preparationRevision:0,settings:gameSettings(standard?{...input.settings,mode:'auto',rulesProfile:STANDARD_MILO_PROFILE}:input.settings,input.brandId),plan,books:[],batches:[],results:[],events:[],ops:[],state:{phase:'lobby',blockIndex:-1,roundIndex:-1,goalIndex:0,goalOpenedAt:0,epoch:'',drawn:[],history:[],deck:[],pending:null,window:null,windowSequence:0,resultId:null,goalWon:false,paused:false}};
}
export function activeRound(game){return game.plan.blocks.filter(b=>b.type==='round')[game.state.roundIndex];}
export function activeGoal(game){const r=activeRound(game),g=r?.goals[game.state.goalIndex];if(!g)return null;return {id:g.id,round:r,pattern:game.plan.patterns.find(p=>p.id===g.patternId),prize:game.plan.prizes.find(p=>p.id===g.prizeId)};}
export function cardSignature(card){return Array.from({length:5},(_,col)=>card.filter((_,i)=>i%5===col).filter(Boolean).sort((a,b)=>a-b).join(',')).join('|');}
export function generateBooks(game,count,requestId,now=Date.now(),print={}){
 const prior=game.batches.find(b=>b.requestId===requestId);if(prior)return prior;
 if(game.status!=='draft')throw new BingoError('Genereer boekjes vóór de show wordt gestart.');
 normalizeBingoPlan(game.plan);
 const mode=bingoPrintMode(print?.mode);
 count=integer(count,1,150,'Aantal boekjes per PDF');const rounds=game.plan.blocks.filter(b=>b.type==='round').length;
 if((game.books.length+count)*rounds>4000||game.books.length+count>9999)throw new BingoError('Dit spel ondersteunt maximaal 4.000 rondekaarten en 9.999 lotnummers.');
 const signatures=new Set(game.books.flatMap(b=>b.cards.map(cardSignature))),codes=new Set(game.books.map(b=>b.code)),alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
 const batch={id:crypto.randomUUID(),requestId,createdAt:now,bookIds:[],print:{format:'A5',mode,template:brandId(game)==='milo'?'milo-friends-sterrenmagie-a5-v4':'a5-grand-show-v2'}};
 for(let n=0;n<count;n++){
  const ticket=String(game.books.length+1).padStart(4,'0');let code;do{code=Array.from({length:4},()=>alphabet[randomIndex(alphabet.length)]).join('')+ticket;}while(codes.has(code));codes.add(code);
  const cards=[];for(let r=0;r<rounds;r++){let card,signature;do{card=Array(25);for(let c=0;c<5;c++){const nums=shuffle(Array.from({length:15},(_,i)=>c*15+i+1));for(let row=0;row<5;row++)card[row*5+c]=row===2&&c===2?0:nums[row];}signature=cardSignature(card);}while(signatures.has(signature));signatures.add(signature);cards.push(card);}
  const book={id:crypto.randomUUID(),code,ticket,token:crypto.randomUUID()+crypto.randomUUID(),cards,accountId:null,profileId:null,name:'',age:null,admitted:true,issueStatus:'generated',batchId:batch.id};game.books.push(book);batch.bookIds.push(book.id);
 }game.batches.push(batch);return batch;
}
export function completionIndex(card,pattern,drawn){
 if(!Array.isArray(card)||!pattern||!Array.isArray(pattern.cells)||!pattern.cells.some(cell=>Number.isInteger(cell)&&cell>=0&&cell<25&&cell!==12))return null;
 const position=new Map(drawn.filter(n=>Number.isInteger(n)&&n>=1&&n<=75).map((n)=>[n,drawn.indexOf(n)+1]));position.set(0,0);
 const complete=cells=>{const required=cells.filter(i=>i!==12);if(!required.length||required.some(i=>!Number.isInteger(card[i])||card[i]<1||card[i]>75))return null;const values=required.map(i=>position.get(card[i]));return values.some(x=>x===undefined)?null:Math.max(...values);};
 if(['rows','doubleRows'].includes(pattern.variant)){const rows=Array.from({length:5},(_,r)=>complete(Array.from({length:5},(_,c)=>r*5+c))).filter(n=>n!==null).sort((a,b)=>a-b),needed=pattern.variant==='doubleRows'?2:1;return rows.length>=needed?rows[needed-1]:null;}
 return complete(pattern.cells);
}
export function goalIdentity(game,roundIndex=game.state.roundIndex,goalIndex=game.state.goalIndex){
 const round=game.plan.blocks.filter(block=>block.type==='round')[roundIndex],goal=round?.goals[goalIndex];return goal?JSON.stringify([game.id,round.id,goal.id]):null;
}
function savedGoalResult(game,roundIndex=game.state.roundIndex,goalIndex=game.state.goalIndex){
 const key=goalIdentity(game,roundIndex,goalIndex);return game.results.find(result=>result.type==='bingo'&&(result.goalKey?result.goalKey===key:result.roundIndex===roundIndex&&result.goalIndex===goalIndex));
}
export function activateBlock(game,index,goalIndex=0,now=Date.now()){
 if(game.state.window?.status==='open'||game.state.phase==='result'||game.results.some(result=>!result.acknowledged))throw new BingoError('Rond het meldvenster en de uitslag eerst af.',409);
 const b=game.plan.blocks[integer(index,0,game.plan.blocks.length-1,'Showblok')],roundIndex=game.plan.blocks.slice(0,index+1).filter(block=>block.type==='round').length-1;
 if(b.type==='round'){
  assertDrawAvailable(game);normalizeBingoPlan(game.plan);goalIndex=integer(goalIndex,0,b.goals.length-1,'Patroon');
  if(roundIndex<game.state.roundIndex||roundIndex===game.state.roundIndex&&goalIndex<game.state.goalIndex)throw new BingoError('Rondes en prijsstappen uit het verleden zijn alleen terug te kijken.',409,'goal_final');
  if(savedGoalResult(game,roundIndex,goalIndex))throw new BingoError('Deze prijsstap is definitief afgerond en kan niet opnieuw worden geopend.',409,'goal_final');
 }
 const changed=game.state.blockIndex!==index||game.state.goalIndex!==goalIndex;
 game.state.blockIndex=index;game.state.paused=game.brandId==='milo'&&!!game.state.drawHold&&game.state.paused===true;if(changed)productionEvent(game,'block-activated',{blockId:b.id,title:b.title,blockIndex:index,roundIndex:b.type==='round'?roundIndex:game.state.roundIndex,goalIndex},now);
 if(b.type!=='round'){if(!game.state.drawHold){game.state.phase='interlude';game.state.pending=null;}return b;}
 if(roundIndex!==game.state.roundIndex){if(game.state.roundIndex>=0)game.state.history.push({roundIndex:game.state.roundIndex,drawn:[...game.state.drawn],closedAt:now});game.state.drawn=[];game.state.lastCommit=null;game.state.deck=shuffle(Array.from({length:75},(_,i)=>i+1));game.state.pending=null;}
 if(roundIndex!==game.state.roundIndex||goalIndex!==game.state.goalIndex||!game.state.epoch){game.state.epoch=crypto.randomUUID();if(game.state.pending)game.state.pending={number:game.state.pending.number,token:crypto.randomUUID(),epoch:game.state.epoch};game.state.goalOpenedAt=game.state.drawn.length;game.state.window=null;game.state.windowSequence=0;game.state.resultId=null;game.state.goalWon=false;}
 game.state.roundIndex=roundIndex;game.state.goalIndex=goalIndex;game.state.phase='running';if(changed)resetDrawClock(game,now);return b;
}
// Use the normalized pattern itself as a collision-free, deterministic version.
export function claimContext(game){
 const goal=activeGoal(game),window=game.state.window;
 return {gameId:game.id,brandId:brandId(game),roundId:goal?.round.id||null,goalId:goal?.id||null,epoch:game.state.epoch,patternVersion:goal?JSON.stringify([goal.pattern.id,goal.pattern.variant,true,[...goal.pattern.cells].sort((a,b)=>a-b)]):null,windowId:window?.id||null,windowStatus:window?.status||null,windowSequence:game.state.windowSequence||0};
}
export function assertClaimContext(game,context,{claim=false}={}){
 const current=claimContext(game),changed=()=>{throw new BingoError('De spelcontext is veranderd. Bekijk de actuele stand en bevestig opnieuw.',409,'context_changed');};
 if(!context||typeof context!=='object'||Array.isArray(context))changed();
 for(const key of ['gameId','brandId','roundId','goalId','epoch','patternVersion'])if(context[key]!==current[key])changed();
 if(!Number.isInteger(context.windowSequence)||context.windowSequence<0||![null,'open','closed'].includes(context.windowStatus)||!Object.hasOwn(context,'windowId')||!Object.hasOwn(context,'windowStatus'))changed();
 const window=game.state.window,same=context.windowId===current.windowId&&context.windowSequence===current.windowSequence&&context.windowStatus===current.windowStatus;
 // A dialog opened before the shared first/next window may join that window.
 // A dialog opened while an old window was open may never open its successor.
 const joined=window?.status==='open'&&context.windowStatus!=='open'&&window.previousWindowId===context.windowId&&window.previousSequence===context.windowSequence;
 if(!same&&!joined||claim&&window?.status!=='open'||context.windowStatus==='open'&&window?.status!=='open')changed();
}
export function assertBookAccountsReady(game){
 const counts=new Map();for(const book of game.books)if(book.accountId&&!book.revokedAt){const count=(counts.get(book.accountId)||0)+1;counts.set(book.accountId,count);if(count>150)throw new BingoError('Een gezin heeft meer dan 150 geldige boekjes. Laat de bestaande uitgifte gecontroleerd beoordelen voordat je de regels publiceert of de show start.',409,'book_limit');}
}
export function assertBookAccountLimit(game,accountId,bookId=null,{additional=1}={}){
 if(bookId&&game.books.some(book=>book.id===bookId&&book.accountId===accountId&&!book.revokedAt))return;
 if(game.books.filter(book=>book.accountId===accountId&&!book.revokedAt).length+additional>150)throw new BingoError('Een gezinsaccount kan maximaal 150 bingoboekjes voor deze show koppelen. Vraag de organisatie om hulp.',409,'book_limit');
}
export function assertOwnedBook(game,accountId,bookId){
 const book=game.books.find(book=>book.id===bookId&&book.accountId===accountId&&book.admitted&&!book.revokedAt);
 if(!book)throw new BingoError('Dit boekje hoort niet bij jouw account of deze show.',403,'book_forbidden');return book;
}
export function assertDrawAvailable(game){if(game.state.drawHold||game.state.callId)throw new BingoError('De trekking is geblokkeerd voor een belmoment. Bevestig eerst de terugkeer en hervat de trekking vanuit de belregie.',409,'call_draw_hold');}
export function assertShowNotCancelled(game){if(game.cancellation)throw new BingoError('Deze show is definitief geannuleerd. De spelstand blijft bewaard; maak een nieuwe show om verder te spelen.',409,'show_cancelled');}
export function assertCancelledGameInvariant(before,after){
 if(!before.cancellation)return;
 const fields=['status','finishedAt','cancelledAt','cancelledReason','cancellation','plan','settings','rulesPublication','books','batches','results'];
 const stateFields=['phase','paused','pending','drawClock','control','blockIndex','roundIndex','goalIndex','goalOpenedAt','epoch','drawn','history','deck','window','windowSequence','resultId','goalWon','lastCommit'];
 if(fields.some(key=>JSON.stringify(before[key])!==JSON.stringify(after[key]))||stateFields.some(key=>JSON.stringify(before.state[key])!==JSON.stringify(after.state[key])))assertShowNotCancelled(before);
}
export function forceCancelGame(game,{by,reason,requestId,binding},now=Date.now()){
 if(game.status!=='running')throw new BingoError('Alleen een draaiende show kan geforceerd worden geannuleerd.',409,'show_not_running');
 const s=game.state;
 // Preserve the unresolved context without deciding a claim or announcing an
 // unpublished winner. Provider cleanup has its own separately proven outcome.
 game.cancellation={at:now,by,reason,requestId,binding,checkpoint:{phase:s.phase,paused:s.paused,roundIndex:s.roundIndex,goalIndex:s.goalIndex,epoch:s.epoch,drawnCount:s.drawn.length,windowId:s.window?.id||null,resultId:s.resultId||null,pending:s.pending?structuredClone(s.pending):null,callId:s.callId||s.drawHold?.callId||s.drawHold?.id||null}};
 game.status='finished';game.finishedAt=now;game.cancelledAt=now;game.cancelledReason=reason;
 if(s.window?.status==='open'){s.window.status='cancelled';s.window.cancelledAt=now;s.window.cancellationReason='show_cancelled';}
 s.phase='complete';s.paused=true;s.pending=null;s.drawClock=null;s.control=null;
 productionEvent(game,'show-force-cancelled',{by,reason,roundIndex:s.roundIndex,goalIndex:s.goalIndex,drawnCount:s.drawn.length,windowId:s.window?.id||null,resultId:s.resultId||null,callId:game.cancellation.checkpoint.callId},now);
 return {applied:true};
}
export function reserveBall(game,now=Date.now()){
 assertDrawAvailable(game);const s=game.state;if(game.status!=='running'||s.phase!=='running'||s.paused||s.goalWon||s.window?.status==='open'||s.resultId||!activeGoal(game))throw new BingoError('De trekking wacht op de regie of het meldvenster.',409,'draw_paused');
 if(s.drawn.length>=75)throw new BingoError('Alle 75 ballen zijn getrokken.',409);
 if(!s.pending&&isStandardMiloGame(game)&&now<drawDueAt(game)-STANDARD_DRAW_RESERVATION_MS)throw new BingoError('De volgende bal wacht op de officiële afteller van vijftien seconden.',409,'draw_wait');
 return s.pending??(s.pending={token:crypto.randomUUID(),number:s.deck[s.drawn.length],epoch:s.epoch});
}
export function commitBall(game,token,now=Date.now()){
 const s=game.state;if(s.lastCommit?.token===token)return s.lastCommit;
 assertDrawAvailable(game);
 if(game.status!=='running'||s.phase!=='running'||s.paused||s.goalWon||s.window?.status==='open')throw new BingoError('Het meldvenster heeft de trekking stilgezet.',409,'draw_paused');
 if(!s.pending||s.pending.token!==token||s.pending.epoch!==s.epoch)throw new BingoError('Deze trekking is niet meer actief.',409);
 if(isStandardMiloGame(game)&&now<drawDueAt(game))throw new BingoError('De volgende officiële bal wacht tot de vijftien seconden verstreken zijn.',409,'draw_wait');
 const number=s.pending.number;s.drawn.push(number);s.lastCommit={token,number,index:s.drawn.length,at:now};s.pending=null;resetDrawClock(game,now);productionEvent(game,'ball-committed',{number,index:s.drawn.length,roundIndex:s.roundIndex,goalIndex:s.goalIndex,epoch:s.epoch},now);return s.lastCommit;
}
export function checkAccount(family,game,now=Date.now()){
 if(family.blocked||family.blockedGames?.[game.id])throw new BingoError('Dit account is geblokkeerd. De host kan het deblokkeren.',403,'blocked');
 if((family.cooldowns[game.id]||0)>now)throw new BingoError('Dit account zit in een afkoelperiode.',429,'cooldown');
}
export function beginBingo(game,family,accountId,requestId,now=Date.now()){
 checkAccount(family,game,now);if((game.emptyAnnouncements?.[accountId]?.until||0)>now)throw new BingoError('Je hebt meerdere meldingen zonder boekje gedaan. Wacht even of vraag de host om hulp.',429,'empty_cooldown');const s=game.state;
 if(game.status!=='running'||!activeGoal(game)||!['running','window'].includes(s.phase)||s.goalWon)throw new BingoError('Je kunt nu geen bingo melden.',409);
 if(!game.books.some(b=>b.accountId===accountId&&b.admitted&&!b.revokedAt))throw new BingoError('Koppel eerst een boekje voor deze show.');
 if(s.window?.status==='open'&&now>=s.window.endsAt)throw new BingoError('Het meldvenster is gesloten.',409,'closed');
 if(s.window?.status!=='open'){assertWindowCapacity(game);const previousWindowId=s.window?.id||null,previousSequence=s.windowSequence||0;s.windowSequence=previousSequence+1;s.window={id:crypto.randomUUID(),previousWindowId,previousSequence,status:'open',startedAt:now,endsAt:now+game.settings.claimSeconds*1000,frozenAt:s.drawn.length,epoch:s.epoch,announcements:[],claims:[]};}
 s.phase='window';let a=s.window.announcements.find(a=>a.accountId===accountId);if(!a){a={id:requestId,accountId,name:family.profiles[0]?.name||'Een deelnemer',at:now};s.window.announcements.push(a);}return a;
}
export function claimBook(game,family,accountId,bookId,now=Date.now()){
 const book=assertOwnedBook(game,accountId,bookId);
 const w=game.state.window;if(!w||w.status!=='open'||now>=w.endsAt)throw new BingoError('Het meldvenster is gesloten.',409,'closed');
 const prior=w.claims.find(c=>c.bookId===bookId);if(prior){if(prior.accountId!==accountId)throw new BingoError('Dit boekje hoort niet bij jouw account.',403);return prior;}
 checkAccount(family,game,now);if(!w.announcements.some(a=>a.accountId===accountId))throw new BingoError('Bevestig eerst: Heb je echt BINGO?!');
 const goal=activeGoal(game);normalizeBingoPlan(game.plan);const raw=completionIndex(book.cards[game.state.roundIndex],goal.pattern,game.state.drawn),completeAt=raw===null?null:Math.max(raw,game.state.goalOpenedAt);
 const status=completeAt===null?'false':w.frozenAt-completeAt>game.settings.retroBalls?'late':'valid';
 const claim={id:crypto.randomUUID(),bookId,accountId,profileId:book.profileId,name:book.name,ticket:book.ticket,at:now,status,completeAt};w.claims.push(claim);
 if(status==='false'){family.falseCounts[game.id]=(family.falseCounts[game.id]||0)+1;family.cooldowns[game.id]=now+game.settings.cooldownSeconds*1000;if(family.falseCounts[game.id]>=game.settings.falseLimit)(family.blockedGames??={})[game.id]=true;}
 return claim;
}
export function settleWindow(game,now=Date.now()){
 const s=game.state,w=s.window;if(game.status==='finished'||!w||w.status!=='open'||now<w.endsAt)return null;
 w.status='closed';w.closedAt=now;const production=productionSettings(game.production);for(const a of w.announcements){a.bookIds=w.claims.filter(c=>c.accountId===a.accountId).map(c=>c.bookId);a.status=a.bookIds.length?'complete':'incomplete';if(a.status==='incomplete'){const row=(game.emptyAnnouncements??={})[a.accountId]??={count:0,until:0};row.count++;if(row.count>=production.emptyLimit)row.until=now+production.emptyCooldownSeconds*1000;}}game.events.push({type:'window-closed',at:now,closedAt:now,windowId:w.id,startedAt:w.startedAt,endsAt:w.endsAt,frozenAt:w.frozenAt,roundIndex:s.roundIndex,goalIndex:s.goalIndex,claims:structuredClone(w.claims),announcements:structuredClone(w.announcements)});const valid=w.claims.filter(c=>c.status==='valid');
 if(!valid.length){s.phase='running';if(isStandardMiloGame(game))s.pending=null;resetDrawClock(game,now);return {empty:true};}
 const prior=savedGoalResult(game);if(prior){s.resultId=prior.acknowledged?null:prior.id;s.goalWon=true;s.phase=prior.acknowledged?'running':'result';return prior;}
 const first=Math.min(...valid.map(c=>c.completeAt)),entrants=valid.filter(c=>c.completeAt===first),winner=entrants[randomIndex(entrants.length)],goal=activeGoal(game);
 const pool=enabledMinigameIds(game);
 const result={id:crypto.randomUUID(),type:'bingo',goalKey:goalIdentity(game),roundId:goal.round.id,goalId:goal.id,epoch:s.epoch,roundIndex:s.roundIndex,goalIndex:s.goalIndex,pattern:goal.pattern,prize:goal.prize,completeAt:first,winner:{...winner},entrants:entrants.map(c=>({...c})),minigame:entrants.length>1?pool[randomIndex(pool.length)]:null,createdAt:now,acknowledged:false};
 // A consolation never joins the main draw or changes its saved winner. One
 // child can have several books, but receives at most one consolation here.
 result.consolations=[];
 if(game.settings.consolationEnabled===true){
  // Legacy books without a child identity share one account bucket. A book
  // identifier must not grant a second consolation to the same unknown child.
  const personKey=c=>JSON.stringify([c.accountId,c.profileId?'profile':'account',c.profileId||null]);
  const awarded=new Set(entrants.map(personKey)),title=cleanText(game.settings.consolationPrizeTitle??'Een kleine verrassing',90,'naam van de troostprijs');
  for(const claim of valid.filter(c=>c.completeAt>first).sort((a,b)=>a.completeAt-b.completeAt)){
   const key=personKey(claim);if(awarded.has(key))continue;awarded.add(key);
   result.consolations.push({id:crypto.randomUUID(),bookId:claim.bookId,accountId:claim.accountId,profileId:claim.profileId,name:claim.name,ticket:claim.ticket,completeAt:claim.completeAt,prize:{title,description:'Troostprijs voor een geldige bingo binnen de terugkijkmarge.',image:''},delivered:false});
  }
 }
 game.results.push(result);s.resultId=result.id;s.goalWon=true;s.phase='result';return result;
}
export function familyDefault(email=''){return {email,profiles:[],blocked:false,blockedGames:{},falseCounts:{},cooldowns:{},ops:[]};}
export function playerGame(game,accountId){
 const {settings,plan,state}=game,goal=activeGoal(game),window=state.window;
  return {id:game.id,brandId:brandId(game),title:game.title,date:game.date,status:game.status,cancelledAt:game.cancelledAt||null,settings,rounds:plan.blocks.filter(b=>b.type==='round').map(b=>({id:b.id,title:b.title})),revision:game.revision,showRules:brandId(game)==='milo'?[...projectedGameRules(game).rules,...(game.presentationSnapshot?.rules||[]).filter(rule=>!rule.id?.startsWith('core-'))]:game.presentationSnapshot?.rules||[],rulesPublication:projectedGameRules(game),production:playerProduction(game,accountId),state:{epoch:state.epoch,claimContext:claimContext(game),history:(state.history||[]).filter(entry=>Number.isInteger(entry.roundIndex)&&entry.roundIndex>=0).map(entry=>({roundIndex:entry.roundIndex,drawn:[...new Set((entry.drawn||[]).filter(number=>Number.isInteger(number)&&number>=1&&number<=75))],closedAt:entry.closedAt})),phase:state.phase,paused:state.paused,drawHold:state.drawHold?{id:state.drawHold.id,reason:'Belmoment: de trekking wacht op bevestigde terugkeer.',checkpoint:state.drawHold.checkpoint}:null,roundIndex:state.roundIndex,goalIndex:state.goalIndex,drawn:state.drawn,goal:goal?{pattern:goal.pattern,prize:{...goal.prize,image:goal.prize.image?`/api/bingo/prize-image?game=${game.id}&id=${goal.prize.image.split('/').at(-1)}`:''},round:goal.round.title,step:state.goalIndex+1,total:goal.round.goals.length,next:game.plan.patterns.find(p=>p.id===goal.round.goals[state.goalIndex+1]?.patternId)?.title||''}:null,window:window?{id:window.id,status:window.status,startedAt:window.startedAt,endsAt:window.endsAt,frozenAt:window.frozenAt,announced:window.announcements.some(a=>a.accountId===accountId),announcementStatus:window.announcements.find(a=>a.accountId===accountId)?.status||null,claims:window.claims.filter(c=>c.accountId===accountId).map(({operation,...claim})=>claim)}:null},books:game.books.filter(b=>b.accountId===accountId).map(({token,...b})=>b),results:game.results.filter(r=>r.acknowledged).map(r=>{
 const prize=p=>({title:p.title,description:p.description,image:p.image?`/api/bingo/prize-image?game=${game.id}&id=${p.image.split('/').at(-1)}`:''});
 const entrant=e=>({name:e.name,ticket:e.ticket,...(e.accountId===accountId?{bookId:e.bookId}:{}),entrantId:`${r.id}:${r.entrants.findIndex(candidate=>candidate.bookId===e.bookId)}`});
 return {id:r.id,type:r.type,roundIndex:r.roundIndex,goalIndex:r.goalIndex,pattern:r.pattern?{id:r.pattern.id,title:r.pattern.title,cells:r.pattern.cells,freeCenter:true,variant:r.pattern.variant}:undefined,completeAt:r.completeAt,minigame:r.minigame,createdAt:r.createdAt,acknowledged:true,acknowledgedAt:r.acknowledgedAt,delivered:!!r.delivered,deliveredAt:r.deliveredAt??null,consolations:(r.consolations||[]).map(a=>({id:a.id,...(a.accountId===accountId?{bookId:a.bookId}:{}),name:a.name,ticket:a.ticket,completeAt:a.completeAt,prize:prize(a.prize),delivered:!!a.delivered,deliveredAt:a.deliveredAt??null,mine:a.accountId===accountId})),winner:entrant(r.winner),entrants:r.entrants.map(entrant),prize:prize(r.prize),mine:r.winner.accountId===accountId};
 })};
}
