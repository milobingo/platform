import {brandId,validBrand,brandDefaults,repairLegacyPlanBrand} from './show-brands.js';
import {playerProduction,productionSettings,productionEvent} from './production-model.js';
import {defaultPlan,normalizePlan,planIssues,newId} from './plan-model.js';

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
 const allowed=minigamesForBrand(identity).map(m=>m.id);
 if(input.minigames!==undefined&&!Array.isArray(input.minigames))throw new BingoError('Kies beslisspellen uit de lijst.');
 const enabled=[...new Set(input.minigames??allowed)];if(!enabled.length||enabled.some(id=>!allowed.includes(id)))throw new BingoError('Activeer minstens één beslisspel uit de lijst van deze productie.');
 return {claimSeconds:integer(input.claimSeconds??30,30,600,'Meldvenster'),retroBalls:integer(input.retroBalls??3,0,75,'Terugkijkmarge'),cooldownSeconds:integer(input.cooldownSeconds??60,0,86400,'Afkoelperiode'),falseLimit:integer(input.falseLimit??3,1,100,'Blokkeren na valse bingo’s'),confirmFinale:input.confirmFinale!==false,youtubeId:input.youtubeId?cleanText(input.youtubeId,11,'YouTube-video-ID'):'',mode:['manual','guided','auto'].includes(input.mode)?input.mode:'guided',minigames:enabled};
}
export function makeGame(input,ownerId,origin,now=Date.now()){
 const count=integer(input.roundCount??4,1,8,'Aantal rondes'),plan=normalizePlan(input.plan?repairLegacyPlanBrand(input.plan,input.brandId):brandDefaults(defaultGamePlan(count),input.brandId));
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(input.date)||Number.isNaN(new Date(input.date).getTime()))throw new BingoError('Kies een geldige datum en begintijd.');
 if(plan.blocks.filter(b=>b.type==='round').length!==count)throw new BingoError('Het aantal rondes in de voorbereiding moet overeenkomen met het spel.');
 const issues=planIssues(plan);if(issues.length)throw new BingoError(issues[0]);
 plan.blocks.filter(b=>b.type==='round').forEach(b=>b.newBoard=true);
 // Printed 75-ball books always have a free centre, for all patterns in this show.
 plan.patterns.forEach(p=>p.freeCenter=true);
 return {id:crypto.randomUUID(),brandId:validBrand(input.brandId||'vlampie'),ownerId,title:cleanText(input.title||plan.title,60,'spelnaam'),date:cleanText(input.date,40,'datum'),origin,createdAt:now,status:'draft',settings:gameSettings(input.settings,input.brandId),plan,books:[],batches:[],results:[],events:[],ops:[],state:{phase:'lobby',blockIndex:-1,roundIndex:-1,goalIndex:0,goalOpenedAt:0,epoch:'',drawn:[],history:[],deck:[],pending:null,window:null,resultId:null,goalWon:false,paused:false}};
}
export function activeRound(game){return game.plan.blocks.filter(b=>b.type==='round')[game.state.roundIndex];}
export function activeGoal(game){const r=activeRound(game),g=r?.goals[game.state.goalIndex];if(!g)return null;return {id:g.id,round:r,pattern:game.plan.patterns.find(p=>p.id===g.patternId),prize:game.plan.prizes.find(p=>p.id===g.prizeId)};}
export function cardSignature(card){return Array.from({length:5},(_,col)=>card.filter((_,i)=>i%5===col).filter(Boolean).sort((a,b)=>a-b).join(',')).join('|');}
export function generateBooks(game,count,requestId,now=Date.now(),print={}){
 const prior=game.batches.find(b=>b.requestId===requestId);if(prior)return prior;
 if(game.status!=='draft')throw new BingoError('Genereer boekjes vóór de show wordt gestart.');
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
 const position=new Map(drawn.map((n,i)=>[n,i+1]));position.set(0,0);
 const complete=cells=>{const values=cells.map(i=>position.get(card[i]));return values.some(x=>x===undefined)?null:Math.max(0,...values);};
 if(['rows','doubleRows'].includes(pattern.variant)){const rows=Array.from({length:5},(_,r)=>complete(Array.from({length:5},(_,c)=>r*5+c))).filter(n=>n!==null).sort((a,b)=>a-b),needed=pattern.variant==='doubleRows'?2:1;return rows.length>=needed?rows[needed-1]:null;}
 return complete(pattern.cells);
}
export function activateBlock(game,index,goalIndex=0,now=Date.now()){
 if(game.state.window?.status==='open'||game.state.phase==='result')throw new BingoError('Rond het meldvenster en de uitslag eerst af.',409);
 const changed=game.state.blockIndex!==index||game.state.goalIndex!==goalIndex;
 const b=game.plan.blocks[integer(index,0,game.plan.blocks.length-1,'Showblok')];
 if(b.type==='round')assertDrawAvailable(game);
 game.state.blockIndex=index;game.state.paused=false;if(changed)productionEvent(game,'block-activated',{blockId:b.id,title:b.title,blockIndex:index,roundIndex:b.type==='round'?game.plan.blocks.slice(0,index+1).filter(x=>x.type==='round').length-1:game.state.roundIndex,goalIndex},now);
 if(b.type!=='round'){if(!game.state.drawHold){game.state.phase='interlude';game.state.pending=null;}return b;}
 const roundIndex=game.plan.blocks.slice(0,index+1).filter(b=>b.type==='round').length-1;
 goalIndex=integer(goalIndex,0,b.goals.length-1,'Patroon');
 if(roundIndex!==game.state.roundIndex){if(game.state.roundIndex>=0)game.state.history.push({roundIndex:game.state.roundIndex,drawn:[...game.state.drawn],closedAt:now});game.state.drawn=[];game.state.deck=shuffle(Array.from({length:75},(_,i)=>i+1));game.state.pending=null;}
 if(roundIndex!==game.state.roundIndex||goalIndex!==game.state.goalIndex||!game.state.epoch){game.state.epoch=crypto.randomUUID();if(game.state.pending)game.state.pending={number:game.state.pending.number,token:crypto.randomUUID(),epoch:game.state.epoch};game.state.goalOpenedAt=game.state.drawn.length;game.state.window=null;game.state.resultId=null;game.state.goalWon=false;}
 game.state.roundIndex=roundIndex;game.state.goalIndex=goalIndex;game.state.phase='running';return b;
}
export function assertDrawAvailable(game){if(game.state.drawHold)throw new BingoError('De trekking is geblokkeerd voor een belmoment. Bevestig eerst de terugkeer en hervat de trekking vanuit de belregie.',409,'call_draw_hold');}
export function reserveBall(game){
 assertDrawAvailable(game);const s=game.state;if(game.status!=='running'||s.phase!=='running'||s.paused||s.goalWon||!activeGoal(game))throw new BingoError('De trekking wacht op de regie of het meldvenster.',409,'draw_paused');
 if(s.drawn.length>=75)throw new BingoError('Alle 75 ballen zijn getrokken.',409);
 return s.pending??(s.pending={token:crypto.randomUUID(),number:s.deck[s.drawn.length],epoch:s.epoch});
}
export function commitBall(game,token,now=Date.now()){
 const s=game.state;if(s.lastCommit?.token===token)return s.lastCommit;
 assertDrawAvailable(game);
 if(s.phase!=='running'||s.paused||s.goalWon||s.window?.status==='open')throw new BingoError('Het meldvenster heeft de trekking stilgezet.',409,'draw_paused');
 if(!s.pending||s.pending.token!==token||s.pending.epoch!==s.epoch)throw new BingoError('Deze trekking is niet meer actief.',409);
 const number=s.pending.number;s.drawn.push(number);s.lastCommit={token,number,index:s.drawn.length,at:now};s.pending=null;productionEvent(game,'ball-committed',{number,index:s.drawn.length,roundIndex:s.roundIndex,goalIndex:s.goalIndex,epoch:s.epoch},now);return s.lastCommit;
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
 if(s.window?.status!=='open')s.window={id:crypto.randomUUID(),status:'open',startedAt:now,endsAt:now+game.settings.claimSeconds*1000,frozenAt:s.drawn.length,epoch:s.epoch,announcements:[],claims:[]};
 s.phase='window';let a=s.window.announcements.find(a=>a.accountId===accountId);if(!a){a={id:requestId,accountId,name:family.profiles[0]?.name||'Een deelnemer',at:now};s.window.announcements.push(a);}return a;
}
export function claimBook(game,family,accountId,bookId,now=Date.now()){
 const w=game.state.window;if(!w||w.status!=='open'||now>=w.endsAt)throw new BingoError('Het meldvenster is gesloten.',409,'closed');
 const prior=w.claims.find(c=>c.bookId===bookId);if(prior){if(prior.accountId!==accountId)throw new BingoError('Dit boekje hoort niet bij jouw account.',403);return prior;}
 checkAccount(family,game,now);if(!w.announcements.some(a=>a.accountId===accountId))throw new BingoError('Bevestig eerst: Heb je echt BINGO?!');
 const book=game.books.find(b=>b.id===bookId&&b.accountId===accountId&&b.admitted&&!b.revokedAt);if(!book)throw new BingoError('Dit boekje hoort niet bij jouw account of deze show.',403);
 const goal=activeGoal(game),raw=completionIndex(book.cards[game.state.roundIndex],goal.pattern,game.state.drawn),completeAt=raw===null?null:Math.max(raw,game.state.goalOpenedAt);
 const status=completeAt===null?'false':w.frozenAt-completeAt>game.settings.retroBalls?'late':'valid';
 const claim={id:crypto.randomUUID(),bookId,accountId,profileId:book.profileId,name:book.name,ticket:book.ticket,at:now,status,completeAt};w.claims.push(claim);
 if(status==='false'){family.falseCounts[game.id]=(family.falseCounts[game.id]||0)+1;family.cooldowns[game.id]=now+game.settings.cooldownSeconds*1000;if(family.falseCounts[game.id]>=game.settings.falseLimit)(family.blockedGames??={})[game.id]=true;}
 return claim;
}
export function settleWindow(game,now=Date.now()){
 const s=game.state,w=s.window;if(!w||w.status!=='open'||now<w.endsAt)return null;
 w.status='closed';w.closedAt=now;const production=productionSettings(game.production);for(const a of w.announcements){a.bookIds=w.claims.filter(c=>c.accountId===a.accountId).map(c=>c.bookId);a.status=a.bookIds.length?'complete':'incomplete';if(a.status==='incomplete'){const row=(game.emptyAnnouncements??={})[a.accountId]??={count:0,until:0};row.count++;if(row.count>=production.emptyLimit)row.until=now+production.emptyCooldownSeconds*1000;}}game.events.push({type:'window-closed',at:now,closedAt:now,windowId:w.id,startedAt:w.startedAt,endsAt:w.endsAt,frozenAt:w.frozenAt,roundIndex:s.roundIndex,goalIndex:s.goalIndex,claims:structuredClone(w.claims),announcements:structuredClone(w.announcements)});const valid=w.claims.filter(c=>c.status==='valid');
 if(!valid.length){s.phase='running';return {empty:true};}
 const first=Math.min(...valid.map(c=>c.completeAt)),entrants=valid.filter(c=>c.completeAt===first),winner=entrants[randomIndex(entrants.length)],goal=activeGoal(game);
 const pool=enabledMinigameIds(game);
 const result={id:crypto.randomUUID(),type:'bingo',epoch:s.epoch,roundIndex:s.roundIndex,goalIndex:s.goalIndex,pattern:goal.pattern,prize:goal.prize,completeAt:first,winner:{...winner},entrants:entrants.map(c=>({...c})),minigame:entrants.length>1?pool[randomIndex(pool.length)]:null,createdAt:now,acknowledged:false};
 game.results.push(result);s.resultId=result.id;s.goalWon=true;s.phase='result';return result;
}
export function familyDefault(email=''){return {email,profiles:[],blocked:false,blockedGames:{},falseCounts:{},cooldowns:{},ops:[]};}
export function playerGame(game,accountId){
 const {settings,plan,state}=game,goal=activeGoal(game),window=state.window;
  return {id:game.id,brandId:brandId(game),title:game.title,date:game.date,status:game.status,settings,rounds:plan.blocks.filter(b=>b.type==='round').map(b=>({id:b.id,title:b.title})),revision:game.revision,showRules:game.presentationSnapshot?.rules||[],production:playerProduction(game,accountId),state:{epoch:state.epoch,phase:state.phase,paused:state.paused,drawHold:state.drawHold?{id:state.drawHold.id,reason:'Belmoment: de trekking wacht op bevestigde terugkeer.',checkpoint:state.drawHold.checkpoint}:null,roundIndex:state.roundIndex,goalIndex:state.goalIndex,drawn:state.drawn,goal:goal?{pattern:goal.pattern,prize:{...goal.prize,image:goal.prize.image?`/api/bingo/prize-image?game=${game.id}&id=${goal.prize.image.split('/').at(-1)}`:''},round:goal.round.title,step:state.goalIndex+1,total:goal.round.goals.length,next:game.plan.patterns.find(p=>p.id===goal.round.goals[state.goalIndex+1]?.patternId)?.title||''}:null,window:window?{id:window.id,status:window.status,startedAt:window.startedAt,endsAt:window.endsAt,frozenAt:window.frozenAt,announced:window.announcements.some(a=>a.accountId===accountId),announcementStatus:window.announcements.find(a=>a.accountId===accountId)?.status||null,claims:window.claims.filter(c=>c.accountId===accountId)}:null},books:game.books.filter(b=>b.accountId===accountId).map(({token,...b})=>b),results:game.results.filter(r=>r.acknowledged).map(r=>({...r,winner:{name:r.winner.name,ticket:r.winner.ticket,bookId:r.winner.bookId},entrants:r.entrants.map(e=>({name:e.name,ticket:e.ticket,bookId:e.bookId})),prize:{...r.prize,image:r.prize.image?`/api/bingo/prize-image?game=${game.id}&id=${r.prize.image.split('/').at(-1)}`:''},mine:r.winner.accountId===accountId}))};
}
