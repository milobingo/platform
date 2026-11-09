import {makeGame,generateBooks,activateBlock,reserveBall,commitBall,beginBingo,claimBook,settleWindow,familyDefault,activeGoal} from './bingo-model.js';
export const DEMO_KEY='vlampie-studio-rehearsal-v40';
export function createRehearsal(){
 const game=makeGame({timeZone:'Europe/Amsterdam',brandId:'rocco',title:'Rocco’s grote kinderbingo',date:'2026-11-01T14:00',roundCount:4},'rehearsal','https://example.invalid');
 game.plan.prizes[0].title='Het verrassingspakket';game.plan.prizes[0].description='Een feestelijk pakket vol leuke verrassingen.';
 game.plan.prizes[1].title='De gouden hoofdprijs';game.plan.prizes[1].description='De grote verrassing van de finaleronde.';
 generateBooks(game,24,'rehearsal-batch');
 const names=['Noor','Sam','Mila','Daan','Luca','Sophie','Finn','Emma','Liam','Sara','Bo','Yara','Levi','Tess','Mees','Zoe'];
 game.books.slice(0,16).forEach((b,i)=>Object.assign(b,{accountId:'demo-'+Math.floor(i/2),profileId:'profile-'+i,name:names[i],age:5+i%7}));
 return {version:40,game,families:{},marks:{},scene:'welkom',checked:{sound:false,screen:false},chat:[{name:'Rocco',text:'Wat leuk dat je er bent! Heb je de stiften al klaarliggen?'},{name:'Noor',text:'Wij zijn er klaar voor!'}]};
}
export function demoStart(d){if(d.game.status==='finished')throw Error('De oefenshow is afgelopen. Begin een nieuwe oefenshow.');d.game.status='running';activateBlock(d.game,d.game.plan.blocks.findIndex(b=>b.type==='round'));d.scene='bingo';}
export function demoDraw(d){const p=reserveBall(d.game);return commitBall(d.game,p.token);}
export function demoClaim(d,bookId){const b=d.game.books.find(b=>b.id===bookId);if(!b?.accountId)throw Error('Koppel eerst een boekje.');const f=d.families[b.accountId]??=familyDefault();f.profiles=[{name:b.name}];beginBingo(d.game,f,b.accountId,crypto.randomUUID());return claimBook(d.game,f,b.accountId,b.id);}
export function demoSettle(d,now=Date.now()){return settleWindow(d.game,now);}
export function demoAdvance(d){const g=d.game,s=g.state,goal=activeGoal(g);if(!s.goalWon)throw Error('Rond eerst dit patroon af.');const r=g.results.find(r=>r.id===s.resultId);if(r)r.acknowledged=true;s.phase='running';s.resultId=null;
 if(s.goalIndex+1<goal.round.goals.length)activateBlock(g,s.blockIndex,s.goalIndex+1);else{const next=g.plan.blocks.findIndex((b,i)=>i>s.blockIndex&&b.type==='round');if(next<0){g.status='finished';s.phase='complete';d.scene='winnaar';}else activateBlock(g,next);}
}
export function formatShowDate(value){return new Intl.DateTimeFormat('nl-NL',{day:'numeric',month:'long',hour:'2-digit',minute:'2-digit',timeZone:'Europe/Amsterdam'}).format(new Date(value));}
export function readiness(g){return [{id:'plan',title:'Rondes & prijzen',detail:g.plan.blocks.filter(b=>b.type==='round').length+' rondes voorbereid',done:!!g.plan.blocks.filter(b=>b.type==='round').length},{id:'books',title:'Boekjes aangemaakt',detail:g.books.length+' unieke boekjes',done:g.books.length>0},{id:'people',title:'Spelers gekoppeld',detail:g.books.filter(b=>b.accountId).length+' boekjes gekoppeld',done:g.books.some(b=>b.accountId&&b.admitted)}];}
