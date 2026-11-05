import {motionFrame,hash,smooth,smoother} from './bingo-motion.js?v=36';
import {plingoChipPose,plingoPlan,plingoPhase} from './plingo-game.js?v=36';
import {MILO_MAGIC_GAMES,miloMagicObjectPose} from './milo-minigame-plan.js';
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v)),mix=(a,b,t)=>a+(b-a)*t;
const plans=new WeakMap(),curves=new WeakMap();
const timings=[0,.18,.36,.55,.74,.86,1];
// Shape-preserving Hermite splines keep racing objects moving forwards while
// independently seeded checkpoint speeds produce overtakes. No frame integration.
function raceCurve(group,game){
 let all=curves.get(group);if(!all){all={};curves.set(group,all);}if(all[game])return all[game];
 const values=timings.map((t,i)=>i===0?0:i===6?group.winning?1:.935+group.seed*.025:t*.88+Math.sin(hash(group.id+game+':'+i)%997)*.052*Math.sin(t*Math.PI));
 const slopes=values.slice(1).map((v,i)=>(v-values[i])/(timings[i+1]-timings[i]));
 const tangents=values.map((_,i)=>i===0||i===values.length-1?0:slopes[i-1]*slopes[i]<=0?0:2/(1/slopes[i-1]+1/slopes[i]));
 return all[game]={values,tangents};
}
export function competitionProgress(p,group,game='horses'){
 p=clamp(p);const {values,tangents}=raceCurve(group,game);let i=0;while(i<timings.length-2&&p>timings[i+1])i++;
 const h=timings[i+1]-timings[i],t=(p-timings[i])/h,t2=t*t,t3=t2*t;
 return clamp((2*t3-3*t2+1)*values[i]+(t3-2*t2+t)*h*tangents[i]+(-2*t3+3*t2)*values[i+1]+(t3-t2)*h*tangents[i+1]);
}
function sequence(p,points){let i=0;while(i<points.length-2&&p>points[i+1][0])i++;const [a,x]=points[i],[b,y]=points[i+1];return mix(x,y,smoother((p-a)/(b-a)));}
const wheelTimes=[0,.1,.29,.53,.74,.87,.94,1],wheelTurns=[0,.35,3.5,8.3,11.3,12.35,12.83,13],wheelSlopes=wheelTurns.slice(1).map((v,i)=>(v-wheelTurns[i])/(wheelTimes[i+1]-wheelTimes[i])),wheelTangents=wheelTurns.map((_,i)=>i===0||i===7?0:2/(1/wheelSlopes[i-1]+1/wheelSlopes[i]));
function wheelTravel(p){let i=0;while(i<6&&p>wheelTimes[i+1])i++;const h=wheelTimes[i+1]-wheelTimes[i],t=clamp((p-wheelTimes[i])/h),t2=t*t,t3=t2*t;return (2*t3-3*t2+1)*wheelTurns[i]+(t3-2*t2+t)*h*wheelTangents[i]+(-2*t3+3*t2)*wheelTurns[i+1]+(t3-t2)*h*wheelTangents[i+1];}
function layout(n){const cols=n<=3?n:n<=6?3:5,rows=Math.ceil(n/cols);return {cols,rows,slots:Array.from({length:n},(_,i)=>{const row=Math.floor(i/cols),count=Math.min(cols,n-row*cols),col=i%cols;return {x:960+(col-(count-1)/2)*Math.min(480,1530/cols),y:rows===1?540:361+row*329};})};}
function planFor(result,groups){
 if(plans.has(result))return plans.get(result);const losers=groups.filter(g=>!g.winning).sort((a,b)=>hash(a.id+':out')-hash(b.id+':out')),elimination=new Map(losers.map((g,i)=>[g.id,.37+(losers.length===1?.54:i/(losers.length-1)*.57)])),{slots,cols}=layout(groups.length);
 const swaps=Array.from({length:3},(_,round)=>{const pairs=[];for(let row=0;row<Math.ceil(groups.length/cols);row++)for(let col=round%2;col<cols-1;col+=2){const a=row*cols+col,b=a+1;if(b<groups.length)pairs.push([a,b]);}return {start:.12+round*.18,end:.25+round*.18,pairs};});
 const events=[{id:'count-3',at:0,kind:'count'},{id:'count-2',at:'intro-1',kind:'count'},{id:'count-1',at:'intro-2',kind:'count'},{id:'go',p:0,kind:'go'}];
 const game=result.minigame;
 if(['balloons','disco'].includes(game))for(const [id,p] of elimination)events.push({id:'out-'+id,p,kind:game==='balloons'?'pop':'beat'});
 else if(game==='plingo'){const path=plingoPlan(result,groups);for(const hit of path.impacts)events.push({id:'peg-'+hit.row,p:hit.at,kind:'bump'});for(const hit of path.points.filter(p=>p.lip))events.push({id:'lip-'+hit.at,p:hit.at,kind:'bump'});}
 else if(game==='pinball')for(let i=0;i<9;i++)events.push({id:'bump-'+i,p:.14+i*.078,kind:'bump'});
 else if(game==='wheel')for(let i=0;i<15;i++)events.push({id:'tick-'+i,p:.2+i*.054,kind:'tick'});
 else for(const [i,p] of [.19,.4,.63,.83].entries())events.push({id:'action-'+i,p,kind:game==='ribbons'||game==='mirrors'?'shuffle':game==='potion'?'water':game==='butterfly'?'scan':game==='gifts'?'shuffle':game==='rockets'?'boost':game==='gold'?'scan':game==='horses'?'hoof':game==='boats'?'water':'bump'});
 events.push({id:'tension',p:game==='plingo'?.74:.88,kind:'tension'},{id:'reveal',p:1,kind:'reveal'});
 const plan={slots,swaps,elimination,events};plans.set(result,plan);return plan;
}
export function gameFrame(stage,age,reduced=false){const frame=motionFrame(stage,age,reduced);return {...frame,game:stage.result.minigame,plan:planFor(stage.result,frame.groups),result:stage.result,reduced};}
export function gameEvents(stage){const f=gameFrame(stage,0),span=f.duration-1.2-f.intro;return f.plan.events.map(e=>({...e,time:typeof e.at==='number'?e.at:e.at==='intro-1'?f.intro/3:e.at==='intro-2'?f.intro*2/3:f.intro+e.p*span})).sort((a,b)=>a.time-b.time);}
export function wheelRotation(frame){const winner=frame.groups.findIndex(g=>g.winning),tau=Math.PI*2,target=-Math.PI/2-(winner+.5)*tau/frame.groups.length,start=hash(frame.result.id+':wheel-start')%360*Math.PI/180,end=target+(Math.ceil((start-target)/tau)+13)*tau;return start+(end-start)*wheelTravel(frame.progress)/13;}
export function objectPose(f,g){
 const {progress:p,groups,game,age,reveal}=f,n=groups.length,i=g.index,seed=g.seed,lane=1530/n,colorIndex=i,active=clamp(p*15),progress=competitionProgress(p,g,game);let x,y,size,angle=0,chipX,chipY,width,height=n>6?46:58,extra={};
 if(MILO_MAGIC_GAMES.includes(game))return miloMagicObjectPose(f,g);
 if(game==='plingo')return {...plingoChipPose(f,g),colorIndex:i};
 if(['horses','cookies','boats'].includes(game)){
  const h=600/n,ground=235+(i+.5)*h;x=195+progress*1305;y=ground;size=Math.min(170,h*1.05);width=Math.min(248,Math.max(195,h*2.2));
  if(game==='horses'){const jump=Math.max(...[.32+seed*.02,.64+seed*.025].map(t=>Math.max(0,1-Math.abs(p-t)/.047)**2));y-=jump*Math.min(30,h*.3);y-=Math.sin(age*12+seed*6)*3*active*(1-reveal);angle=-jump*.1;extra.jump=jump;}
  if(game==='cookies'){const ramp=Math.max(...[.25,.48,.72].map(t=>Math.max(0,1-Math.abs(progress-t)/.06)));y-=Math.sin(ramp*Math.PI/2)*Math.min(29,h*.29);angle=progress*22;extra.jump=ramp;}
  if(game==='boats'){y+=Math.sin(progress*12+seed*5)*Math.min(11,h*.13);angle=Math.cos(progress*12+seed*5)*.07;}
  chipX=x+size*.55+width*.5+11;chipY=y+10;
 }else if(game==='rockets'){
  x=195+(i+.5)*lane+Math.sin(progress*13+seed*6)*Math.min(20,lane*.085)*Math.sin(p*Math.PI);y=805-progress*535;size=Math.min(155,lane*.8);width=Math.min(214,lane*.83);chipX=x;chipY=y+size*.33;angle=Math.cos(progress*13+seed*6)*.08*Math.sin(p*Math.PI);
 }else if(game==='chimneys'){
  const column=135+(i+.5)*1650/n,amp=Math.min(32,1650/n*.075);x=column+Math.sin(progress*Math.PI*6+seed*5)*amp;y=247+progress*518;size=Math.min(150,1650/n*.64);width=Math.min(220,1650/n*.74);chipX=x;chipY=y+55;angle=Math.sin(progress*Math.PI*6+seed*5)*.22;extra.gate=clamp(Math.floor(p*4),0,3);
 }else if(game==='pinball'){
  const column=135+(i+.5)*1650/n,amp=Math.min(37,1650/n*.075);x=column+Math.sin(p*Math.PI*15+seed*8)*amp;
  y=sequence(p,[[0,766],[.13+seed*.015,290],[.26,535],[.38,360],[.52,600],[.66,425],[.8,690],[.88,530],[1,g.winning?784:704+seed*28]]);size=Math.min(120,1650/n*.55);width=Math.min(210,1650/n*.74);chipX=x;chipY=y+49;angle=p*24;extra.impact=Math.max(0,Math.cos(p*Math.PI*15+seed*8))**14;
 }else if(game==='gifts'){
  let slot=i,pose={...f.plan.slots[i]};for(const swap of f.plan.swaps){if(p<swap.start)break;const pair=swap.pairs.find(pair=>pair.includes(slot));if(!pair)continue;const dest=pair[0]===slot?pair[1]:pair[0],a=f.plan.slots[slot],b=f.plan.slots[dest],t=smoother((p-swap.start)/(swap.end-swap.start));pose={x:mix(a.x,b.x,t),y:a.y+Math.sin(t*Math.PI)*72*(pair[0]===slot?-1:1)};if(p>=swap.end){slot=dest;continue;}break;}
  x=pose.x;y=pose.y;size=n>6?190:230;width=n>6?224:278;height=58;chipX=x;chipY=y+103;
  const scan=p<.7?Math.floor(p*34)%n:p<.94?Math.floor(p*12)%n:f.groups.findIndex(g=>g.winning);extra.spotlight=scan===i;extra.open=g.winning?smooth((p-.96)/.04):0;angle=extra.spotlight&&p>.65?Math.sin(age*22)*.045:0;
 }else if(game==='gold'){
  const theta=i*Math.PI*2/n+Math.min(p,.86)*Math.PI*3,rx=Math.min(670,410+n*26),ry=175,depth=(Math.sin(theta)+1)/2,front=g.winning?smooth((p-.86)/.14):0;
  x=mix(960+Math.cos(theta)*rx,960,front);y=mix(537+Math.sin(theta)*ry,560,front);size=mix(130+depth*55,250,front);width=Math.min(225,n>8?176:207);height=50;chipX=x;chipY=y+size*.43;extra.depth=depth+front;extra.scan=Math.max(0,Math.cos(theta-p*28))**20;extra.gold=front;angle=p*4;
 }else if(game==='balloons'){
  const elimination=f.plan.elimination.get(g.id)??2,t=Math.min(p,elimination),wind=Math.sin(t*12+seed*5)*Math.min(19,lane*.045);x=195+(i+.5)*lane+wind;y=680-t*340+Math.sin(t*15+seed*8)*17;size=Math.min(210,lane*.9);width=Math.min(220,lane*.88);height=n>6?50:58;chipX=x;chipY=y+size*.32+40;extra.out=p>=elimination;extra.pop=clamp((p-elimination)/.06);extra.elimination=elimination;extra.burst=p>=elimination?(p-elimination)/.1:-1;
 }else if(game==='disco'){
  const slot=f.plan.slots[i],elimination=f.plan.elimination.get(g.id)??2;x=slot.x;y=slot.y;size=n>6?145:190;width=n>6?238:278;height=58;chipX=x;chipY=y+107;extra.out=p>=elimination;extra.fade=smooth((p-elimination)/.035);extra.beat=(Math.sin(age*6.8-i*.47)+1)/2;extra.spotlight=Math.floor(p*(p<.72?24:12))%n===i;extra.pop=clamp((p-elimination)/.06);
 }else{
  const theta=wheelRotation(f)+(i+.5)*Math.PI*2/n;x=960+Math.cos(theta)*219;y=548+Math.sin(theta)*219;size=0;width=n>6?146:n===6?190:216;height=n>6?47:58;chipX=x;chipY=y;
 }
 return {x,y,size,angle,chipX,chipY,width,height,progress,colorIndex,...extra};
}
export function gamePhase(f){
 if(f.reveal>=1)return 'De winnaar is bekend';if(f.age<f.intro)return 'Klaar voor de start?';const p=f.progress;
 if(f.game==='plingo')return {release:'De gouden bal komt los…',upper:'Van pin naar pin… volg de gouden bal!',lower:'De laatste pinnen… welke kant gaat hij op?',
  'last-bounce':'Nog een stuiter… hij kan nog weg!',settling:'Waar blijft de gouden bal liggen?',landed:'De gouden bal is geland!'}[plingoPhase(p)];
 const phrases={ribbons:['De linten zoeken hun weg…','Welke linten zitten in de knoop?','De gouden ster komt tevoorschijn!'],mirrors:['Het spiegelpaleis komt tot leven!','Echt of een spiegelbeeld?','Eén spiegel bewaart de verrassing!'],potion:['Een druppel maanlicht erbij…','Sterrenstof, bellen en een beetje spanning!','Welk flesje tovert een gouden fontein?'],butterfly:['De sterrenlinten beginnen te dansen…','Volg de vleugels door het Sterrenplein!','Voor wie brengt de vlinder een envelop?'],plingo:['Daar gaat de gouden bal!','Van pin naar pin… welke kant rolt hij op?','Het gouden vak is in zicht!'],horses:['De paarden gaan van start!','Over de horden!','Wie zet de eindsprint in?'],cookies:['Rollen maar!','Pas op voor de schansen!','Wie duikt als eerste in de schaal?'],rockets:['Motoren aan — lanceren!','Door de boostpoorten!','Landing op de maanbasis!'],boats:['De pakjesboten varen uit!','Pak de snelle stroming!','De haven is in zicht!'],chimneys:['De pakjes gaan het dak op!','Spring door de doorgangen!','De laatste glijbaan!'],pinball:['De plunjers schieten los!','Bumpers, flippers en ricochets!','Het gouden vak gaat open!'],gifts:['Houd jouw pakje in de gaten!','De pakjes wisselen van plek!','Welk deksel gaat open?'],gold:['De ballen gaan in een baan!','De gouden scanner draait!','Eén bal breekt naar voren!'],balloons:['De ballonnen stijgen op!','Wie blijft er in de lucht?','Nog even je adem inhouden…'],disco:['De vloer komt tot leven!','Tegels vallen één voor één af!','Op welke tegel stopt de spotlight?'],wheel:['Het vuurrad versnelt!','Iedere sector maakt nog kans!','Het rad maakt zijn laatste tikken…']};
 return (phrases[f.game]||phrases.wheel)[p<.3?0:p<.75?1:2];
}
