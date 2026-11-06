/** Presentation-only blocking. Coordinates are on the 1920×1080 studio floor.
 * A distance clock ties each planted foot to actual travel, not snapshot rate.
 */
export const MILO_TOUR_ID='studio-tour';
export const MILO_TOUR_DURATION=64;
const clamp=(n,a=0,b=1)=>Math.max(a,Math.min(b,Number.isFinite(n)?n:a));
const ease=n=>{n=clamp(n);return clamp(n*n*n*(n*(n*6-15)+10));};
const mix=(a,b,t)=>a+(b-a)*t;
const routes=new Map();
const catmull=(a,b,c,d,t)=>.5*((2*b)+(-a+c)*t+(2*a-5*b+4*c-d)*t*t+(-a+3*b-3*c+d)*t*t*t);
function route(homeX){
 if(routes.has(homeX))return routes.get(homeX);
 // Cross each depth boundary at the side of the desk, never through its front.
 const points=[[homeX,822],[1330,820],[1660,824],[1655,938],[1515,1008],[960,1025],[405,1008],[265,938],[260,824],[590,820],[homeX,822]];
 const samples=[];let distance=0,bodyDistance=0,prior;
 for(let i=0;i<=700;i++){
  const u=i/700*(points.length-1),segment=Math.min(points.length-2,Math.floor(u)),t=u-segment;
  const a=points[Math.max(0,segment-1)],b=points[segment],c=points[segment+1],d=points[Math.min(points.length-1,segment+2)];
  const x=catmull(a[0],b[0],c[0],d[0],t),y=catmull(a[1],b[1],c[1],d[1],t);
  const height=370+100*clamp((y-822)/203);
  if(prior){const ds=Math.hypot(x-prior.x,y-prior.y);distance+=ds;bodyDistance+=ds/((height+prior.height)/2);}
  const point={x,y,height,distance,bodyDistance};samples.push(point);prior=point;
 }
 const value={samples,distance,bodyDistance};routes.set(homeX,value);return value;
}
function atDistance(path,fraction){
 const target=clamp(fraction)*path.distance,points=path.samples;
 let lo=0,hi=points.length-1;while(lo+1<hi){const mid=(lo+hi)>>1;if(points[mid].distance<target)lo=mid;else hi=mid;}
 const a=points[lo],b=points[hi],t=clamp((target-a.distance)/Math.max(.0001,b.distance-a.distance));
 const heading=Math.atan2(b.y-a.y,b.x-a.x);
 return {x:mix(a.x,b.x,t),y:mix(a.y,b.y,t),height:mix(a.height,b.height,t),bodyDistance:mix(a.bodyDistance,b.bodyDistance,t),direction:Math.cos(heading)};
}
export function studioTourAt(cue,{homeX=960,reducedMotion=false}={}){
 if(cue?.id!==MILO_TOUR_ID)return null;
 homeX=clamp(homeX,700,1100);
 const elapsed=clamp(Number(cue.elapsed),0,MILO_TOUR_DURATION+3),returnAt=Number.isFinite(cue.returnAt)?cue.returnAt:null;
 const age=returnAt===null?elapsed:clamp(returnAt,0,MILO_TOUR_DURATION);
 // Two seconds of ease at either edge, constant travel through the main lap.
 const integral=s=>s**6-3*s**5+2.5*s**4;
 const edge=2,total=MILO_TOUR_DURATION,travel=age<edge?edge*integral(age/edge):age>total-edge?total-edge-edge*integral((total-age)/edge):age-edge/2;
 const fraction=clamp(travel/(total-edge));
 let p=atDistance(route(homeX),fraction),alpha=1,motion='walk';
 const cameraX=p.x;
 let blend=Math.min(ease(age/edge),ease((total-age)/edge));
 const returning=returnAt!==null;
 if(returning){
  const back=clamp((elapsed-returnAt)/2.4);
  if(back<.5){alpha=1-ease(back*2);blend*=alpha;}
  else {p={x:homeX,y:822,height:370,bodyDistance:0,direction:0};alpha=ease((back-.5)*2);blend=0;motion='idle';}
 }
 if(reducedMotion){p={x:homeX,y:822,height:370,bodyDistance:0,direction:0};blend=0;alpha=1;motion='idle';}
 return {...p,cameraX,alpha,motion,blend,returning,layer:p.y>950?'front':'behind',cameraWeight:reducedMotion?0:Math.min(ease(age/3),ease((total-age)/3))*(returning?1-ease((elapsed-returnAt)/2.4):1)};
}
