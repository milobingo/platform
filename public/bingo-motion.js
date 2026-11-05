const clamp=v=>Math.max(0,Math.min(1,v));
export const smooth=v=>{const t=clamp(v);return t*t*(3-2*t);};
export const smoother=v=>{const t=clamp(v);return t*t*t*(t*(t*6-15)+10);};
export function hash(value){let n=2166136261;for(const c of String(value)){n^=c.charCodeAt(0);n=Math.imul(n,16777619);}return n>>>0;}
const capacity=game=>game==='wheel'?8:game==='horses'||game==='cookies'||game==='boats'||game==='rockets'||game==='chimneys'||game==='pinball'?8:10;
const cached=new WeakMap();
// Membership is independent of time and the winner. Larger fields are represented
// by fixed groups; every book belongs to exactly one object throughout the reveal.
export function gameGroups(result){
 if(cached.has(result))return cached.get(result);
 const entrants=[...result.entrants].sort((a,b)=>hash(`${result.id}:${a.bookId}`)-hash(`${result.id}:${b.bookId}`)||String(a.bookId).localeCompare(String(b.bookId))),count=Math.min(capacity(result.minigame),entrants.length),groups=Array.from({length:count},(_,i)=>({id:`${result.id}:groep-${i}`,members:[],index:i}));
 entrants.forEach((entry,i)=>groups[i%count].members.push(entry));
 groups.forEach(g=>{g.entry=g.members[0];g.winning=g.members.some(e=>e.bookId===result.winner.bookId);g.seed=hash(g.id)%1000/1000;});cached.set(result,groups);return groups;
}
export function motionFrame(stage,age,reduced=false){
 const duration=Math.max(4,stage.duration||20),intro=Math.min(2,duration*.12),finish=duration-1.2,p=reduced?1:clamp((Math.max(0,age)-intro)/(finish-intro)),run=smoother(p),reveal=reduced?1:smooth((age-finish)/1.2);
 return {age:reduced?duration:Math.min(duration,Math.max(0,age)),duration,intro,progress:p,run,reveal,finished:reveal>=1,groups:gameGroups(stage.result)};
}
export function raceProgress(run,group){
 const surge=smooth((run-.58)/.42),ripple=Math.sin(run*Math.PI*4+group.seed*6)*.032*run*(1-run),base=run+ripple;
 return clamp(base*(group.winning?1:1-(.09+group.seed*.035)*surge));
}
// A monotonic visual clock smooths incoming snapshots. It never changes show
// control, ball selection, deadlines or the durably stored winner.
export class GameMotionClock{
 constructor(){this.reset();}
 reset(){this.key='';this.age=0;this.now=0;this.paused=false;this.sourceAge=0;this.sourceAt=0;this.seekRevision=null;}
 read(show,now){
  if(show?.scene!=='minigame'||show.gameStage?.type!=='minigame'){this.reset();return show;}
  const stage=show.gameStage,key=stage.playId||`${stage.result.id}:${stage.result.minigame}`,target=Math.max(0,show.age||0),paused=!!show.paused;
  const seekRevision=stage.seekRevision??show.seekRevision??null;
  if(key!==this.key||seekRevision!==null&&seekRevision!==this.seekRevision){this.key=key;this.age=target;this.now=now;this.paused=paused;this.sourceAge=target;this.sourceAt=now;this.seekRevision=seekRevision;return {...show,age:this.age};}
  const elapsed=Math.max(0,(now-this.now)/1000),pauseEdge=paused!==this.paused;this.now=now;
  // A duplicate packet is not a new anchor. Extrapolate its original timestamp
  // rather than treating its old age as the current time on every RAF frame.
  if(target>this.sourceAge||pauseEdge){this.sourceAge=target;this.sourceAt=now;}
  if(!paused&&!this.paused){const projected=this.sourceAge+Math.max(0,(now-this.sourceAt)/1000),predicted=this.age+elapsed,correction=Math.max(-elapsed*.15,Math.min(elapsed*.35,projected-predicted));this.age=Math.max(this.age,predicted+correction);}
  this.paused=paused;return {...show,age:this.age};
 }
}
